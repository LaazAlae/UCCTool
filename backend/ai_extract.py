"""AI extraction layer: OCR blocks -> structured listing records.

Provider contract:
  extract_records(blocks, debug_dir) returns (records, usage)
To add/swap models, add a provider function and register it in extract_records().
Provider-specific SDK imports stay inside provider functions.
"""

import json
from pathlib import Path

from config import settings
from cost import estimate_ai_cost
from errors import AppError
from schemas import FIELD_KEYS

EXTRACTION_PROMPT = """You are an expert document analyst specializing in UCC filings and related public record documents used in corporate due diligence.

You receive OCR text blocks. Each block is labeled [BLOCK_N] and has a page number. Extract structured data and cite the exact block ID used for each value.

Rules:
- Extract ALL table/list rows, not only the first row.
- Do NOT duplicate the same case/file number across pages.
- Use the first occurrence for source attribution if the same case appears multiple times.
- Copy document-level debtor/entity name into every record when applicable.
- Each distinct legal filing/case is ONE record. Multiple pages of the same filing (addenda, continuations, amendments) are NOT separate records.

FILE NUMBER RULES (critical):
- Always use the OFFICIAL file number assigned by the government recording office (from their stamp, seal, or recording notation), NOT internal document IDs, barcode numbers, or preparation reference numbers.
- If multiple reference numbers appear on the document, the one from the official government stamp/seal/recording block is correct.

FILE DATE RULES (critical):
- Always use the OFFICIAL "Recorded", "Filed", or "Recorded/Filed" date from the government office stamp or recording notation.
- Do NOT use "Document Date", "Preparation Date", "Execution Date", or "Effective Date" — those are different.
- The recorded/filed date is when the government office officially accepted the filing.
- If only one date appears, use that date.

File type categories: UCC, Federal Tax Lien, State Tax Lien, Judgment Lien, Suit, Judgment, Other.

Fields per record:
1. fileType
2. entityName
3. entityType: Individual, Corporation, LLC, Partnership, Trust, or Other
4. fileNumber
5. fileDate as MM/DD/YYYY
6. securedParty: creditor, secured party, reverse party, plaintiff, or taxing authority

For each field return:
{ "value": string, "confidence": number between 0 and 1, "blockId": number }

If unknown, use value "", confidence 0, blockId -1.

Return ONLY a JSON object: {"records": [...]}
No explanation, no markdown, no code fences. Just the JSON."""


# Public entry point. Routes never call a vendor SDK directly.
def extract_records(blocks: list[dict], debug_dir: str | Path | None = None) -> tuple[list[dict], dict]:
    if not blocks:
        raise AppError("AI_NO_OCR_BLOCKS", "AI extraction cannot run without OCR blocks.", 422)

    providers = {"claude": _claude_extract}
    provider = providers.get(settings.ai_provider)
    if not provider:
        raise AppError("UNKNOWN_AI_PROVIDER", f"Unknown AI provider: {settings.ai_provider}", 500)
    return provider(blocks, Path(debug_dir) if debug_dir else None)


# Convert model block citations into frontend-ready highlight coordinates.
def _map_field(field: dict | None, blocks: list[dict]) -> dict:
    block_id = field.get("blockId") if isinstance(field, dict) else None
    block = blocks[block_id] if isinstance(block_id, int) and 0 <= block_id < len(blocks) else None

    return {
        "value": str(field.get("value", "") if isinstance(field, dict) else "").strip(),
        "confidence": max(0, min(float(field.get("confidence", 0) if isinstance(field, dict) else 0), 1)),
        "boundingBox": {
            "page": block["page"],
            "x": block["x"],
            "y": block["y"],
            "width": block["width"],
            "height": block["height"],
        } if block else None,
        "confirmed": False,
    }


def _claude_extract(blocks: list[dict], debug_dir: Path | None) -> tuple[list[dict], dict]:
    # Keep vendor import local so switching providers does not affect app startup.
    import anthropic

    client = anthropic.Anthropic(api_key=settings.ai_api_key)
    block_text = "\n\n".join(f"[BLOCK_{b['index']}] Page {b['page'] + 1}\n{b['text']}" for b in blocks)

    try:
        response = client.messages.create(
            model=settings.ai_model,
            max_tokens=8192,
            messages=[{"role": "user", "content": f"{EXTRACTION_PROMPT}\n\nDOCUMENT BLOCKS:\n\n{block_text}"}],
        )
    except Exception as exc:
        raise AppError("AI_PROVIDER_FAILED", "AI provider request failed.", 502, {"message": str(exc)}) from exc

    if debug_dir:
        (debug_dir / "ai_raw_response.json").write_text(json.dumps(
            _response_debug_payload(response), indent=2, default=str
        ))

    if getattr(response, "stop_reason", None) == "max_tokens":
        raise AppError("AI_RESPONSE_TRUNCATED", "AI response was truncated — document may be too large.", 502, {"rawSaved": bool(debug_dir)})

    text = "".join(item.text for item in response.content if getattr(item, "type", None) == "text")
    parsed = _parse_json_from_text(text)
    if not parsed:
        raise AppError("AI_INVALID_JSON", "AI did not return usable structured extraction data.", 502, {"rawSaved": bool(debug_dir)})

    raw_records = parsed.get("records") if "records" in parsed else [parsed]
    if not isinstance(raw_records, list) or not raw_records:
        raise AppError("AI_INVALID_SHAPE", "AI response did not contain a records array.", 502)

    # Dedup protects against one legal matter appearing on multiple evidence pages.
    seen: set[str] = set()
    records: list[dict] = []
    for raw in raw_records:
        if not isinstance(raw, dict):
            continue
        file_number = str(raw.get("fileNumber", {}).get("value", "")).strip()
        if file_number and file_number in seen:
            continue
        if file_number:
            seen.add(file_number)
        records.append({key: _map_field(raw.get(key), blocks) for key in FIELD_KEYS})

    if not records:
        raise AppError("AI_NO_RECORDS", "AI extraction completed but found no records.", 422)

    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    return records, estimate_ai_cost(input_tokens, output_tokens)


def _parse_json_from_text(text: str) -> dict | None:
    decoder = json.JSONDecoder()
    for idx, char in enumerate(text):
        if char != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[idx:])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


def _response_debug_payload(response) -> dict:
    text_parts = []
    for item in getattr(response, "content", []):
        if getattr(item, "type", None) == "text":
            text_parts.append(item.text)

    usage = getattr(response, "usage", None)
    return {
        "text": "\n".join(text_parts),
        "stopReason": getattr(response, "stop_reason", None),
        "usage": {
            "inputTokens": int(getattr(usage, "input_tokens", 0) or 0),
            "outputTokens": int(getattr(usage, "output_tokens", 0) or 0),
        },
    }
