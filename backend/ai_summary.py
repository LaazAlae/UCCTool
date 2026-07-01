"""AI extraction for UCS Project Summary pages.

Takes OCR blocks from a summary PDF and returns structured project data:
project metadata + ordered list of search lines with debtor/type/jurisdiction/result.
"""

import json

from config import settings
from cost import estimate_ai_cost
from errors import AppError

SUMMARY_PROMPT = """You are an expert document analyst. You are reading a UCS (United Corporate Services) Project Summary page.

Extract ALL information from this document into the following JSON structure:

{
  "projectNumber": "the Project ID value (e.g. MULTI63091&)",
  "preparedFor": "full Prepared For text including firm name on second line if present, joined by newline",
  "clientMatter": "Client Matter # value",
  "projectManager": "Project Manager name",
  "searchLines": [
    {
      "debtor": "debtor name exactly as shown",
      "searchType": "Search/Filing Type exactly as shown (e.g. Fixtures, Federal Tax Liens, State Tax Liens, Judgment Liens, Federal Suits & Judgments, Suits & Judgments, UCC)",
      "jurisdiction": "full Jurisdiction - Recording Office text exactly as shown",
      "thruDate": "Thru Date value as shown (e.g. 6/25/2025)",
      "resultType": "No Records" or "Records Found"
    }
  ]
}

CRITICAL RULES:
- searchLines must be in EXACT document order (top to bottom, page by page)
- Every single search line must be included — do not skip any
- Each search type row under a debtor is ONE search line, even if it says "No Records"
- Debtor names appear as headers — repeat the debtor name for each search line under that debtor
- The Prepared For field may have two lines: the person's name and their firm — join with \\n
- resultType is EXACTLY "No Records" or "Records Found" — nothing else
- Copy debtor names EXACTLY as they appear (preserve capitalization)
- Copy jurisdiction text EXACTLY as shown
- Copy search type EXACTLY as shown
- If a line says "Records Found" with "Comments: See attached", resultType is "Records Found"

Return ONLY the JSON object. No explanation, no markdown, no code fences."""


def extract_summary(blocks: list[dict]) -> tuple[dict, dict, dict | None]:
    if not blocks:
        raise AppError("AI_NO_OCR_BLOCKS", "Cannot extract summary without OCR blocks.", 422)

    providers = {"claude": _claude_extract}
    provider = providers.get(settings.ai_provider)
    if not provider:
        raise AppError("UNKNOWN_AI_PROVIDER", f"Unknown AI provider: {settings.ai_provider}", 500)
    return provider(blocks)


def _claude_extract(blocks: list[dict]) -> tuple[dict, dict, dict | None]:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.ai_api_key)
    block_text = "\n\n".join(
        f"[BLOCK_{b['index']}] Page {b['page'] + 1}\n{b['text']}" for b in blocks
    )

    try:
        response = client.messages.create(
            model=settings.ai_model,
            max_tokens=8192,
            messages=[{"role": "user", "content": f"{SUMMARY_PROMPT}\n\nDOCUMENT BLOCKS:\n\n{block_text}"}],
        )
    except Exception as exc:
        raise AppError("AI_PROVIDER_FAILED", "AI provider request failed.", 502, {"message": str(exc)}) from exc

    debug = _debug_payload(response)

    text = "".join(item.text for item in response.content if getattr(item, "type", None) == "text")
    parsed = _parse_json(text)
    if not parsed:
        raise AppError("AI_INVALID_JSON", "AI did not return valid summary extraction.", 502)

    lines = parsed.get("searchLines")
    if not isinstance(lines, list) or not lines:
        raise AppError("AI_INVALID_SHAPE", "AI response missing searchLines array.", 502)

    for line in lines:
        if line.get("resultType") not in ("No Records", "Records Found"):
            line["resultType"] = "No Records"

    usage = getattr(response, "usage", None)
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
    return parsed, estimate_ai_cost(input_tokens, output_tokens), debug


def _parse_json(text: str) -> dict | None:
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


def _debug_payload(response) -> dict:
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
