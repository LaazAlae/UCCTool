"""AI extraction layer — takes OCR blocks, returns structured records.

Swap providers by changing AI_PROVIDER in .env.
Input:  list of OCR blocks from ocr.py
Output: list of extraction records with bounding boxes mapped from block IDs.
"""

import json
import re

import anthropic

from config import settings

EXTRACTION_PROMPT = """You are an expert document analyst specializing in UCC (Uniform Commercial Code) filings and related public record documents used in corporate due diligence.

You are analyzing OCR-processed text blocks from a scanned legal document. Each block is labeled [BLOCK_N] with its page number. Your job is to extract structured data and CITE which block each value came from.

## Important: Multiple Records

Many documents contain a TABLE or LIST of multiple records. You MUST extract ALL rows/records, not just the first one.

The DEBTOR/ENTITY NAME is usually a document-level field shown once at the top. Copy it into every record.

## CRITICAL: No Duplicates

The same case/filing may appear across MULTIPLE pages (e.g., details on one page, continuation on the next). Do NOT create duplicate records for the same case/file number. If a case number like "523606/2020" appears on page 1 and page 2, create only ONE record for it. Use the FIRST occurrence's block IDs for source attribution.

## Document Classification Rules

Classify each record into exactly ONE of these file types:

**UCC** — Financing statements. Look for: "UCC-1", "UCC-3", "Financing Statement", "DEBTOR", "SECURED PARTY", "COLLATERAL"
**Federal Tax Lien** — "Notice of Federal Tax Lien", "IRS", "Internal Revenue Service"
**State Tax Lien** — "State Tax Lien", "Tax Warrant", state tax authority
**Judgment Lien** — "Certificate of Judgment", "Judgment Lien", "Abstract of Judgment"
**Suit** — "Complaint", "Petition", "Summons", "Civil Action", "STATE SUITS" in search results
**Judgment** — Court decision/ruling not recorded as a lien
**Other** — Only if none of the above fit

UCC filings have "Debtor" and "Secured Party" together — do NOT confuse with suits/judgments.

## Field Extraction

For EACH record extract:

1. **fileType** — Use exact category name (e.g., "UCC", "Suit")
2. **entityName** — The DEBTOR, taxpayer, or defendant. Exact legal name as printed. Usually same for all records on one page.
3. **entityType** — Individual, Corporation, LLC, Partnership, Trust, or Other. "Inc"→Corporation, "LLC"→LLC, personal names→Individual, "INDIVIDUAL RESULTS"→Individual.
4. **fileNumber** — Filing/case/serial number
5. **fileDate** — Date filed/recorded as MM/DD/YYYY
6. **securedParty** — Creditor, secured party, reverse party, plaintiff, or taxing authority

## Source Attribution

For each field, include "blockId" — the number N from [BLOCK_N] where you found that value. This is critical for verification. Reference the SPECIFIC block containing the value, not a nearby block.

## Confidence Scoring

- 1.0: Clearly visible and unambiguous
- 0.8-0.9: Present but requires minor inference
- 0.5-0.7: Inferred from context
- 0.1-0.4: Best guess
- 0.0: Cannot determine

## Response Format

Return ALL records as JSON. Respond ONLY with valid JSON:
{
  "records": [
    {
      "fileType": { "value": "", "confidence": 0.0, "blockId": 0 },
      "entityName": { "value": "", "confidence": 0.0, "blockId": 0 },
      "entityType": { "value": "", "confidence": 0.0, "blockId": 0 },
      "fileNumber": { "value": "", "confidence": 0.0, "blockId": 0 },
      "fileDate": { "value": "", "confidence": 0.0, "blockId": 0 },
      "securedParty": { "value": "", "confidence": 0.0, "blockId": 0 }
    }
  ]
}

If a field cannot be found, set value to "", confidence to 0, blockId to -1."""

FIELDS = ["fileType", "entityName", "entityType", "fileNumber", "fileDate", "securedParty"]


def extract_records(blocks: list[dict]) -> list[dict]:
    if settings.ai_provider == "claude":
        return _claude_extract(blocks)
    raise ValueError(f"Unknown AI provider: {settings.ai_provider}")


def _map_field(field: dict | None, blocks: list[dict]) -> dict:
    if not field:
        return {"value": "", "confidence": 0, "boundingBox": None}

    block_id = field.get("blockId")
    block = blocks[block_id] if isinstance(block_id, int) and 0 <= block_id < len(blocks) else None

    return {
        "value": field.get("value", ""),
        "confidence": field.get("confidence", 0),
        "boundingBox": {
            "page": block["page"],
            "x": block["x"],
            "y": block["y"],
            "width": block["width"],
            "height": block["height"],
        } if block else None,
    }


def _claude_extract(blocks: list[dict]) -> list[dict]:
    client = anthropic.Anthropic(api_key=settings.ai_api_key)

    block_text = "\n\n".join(
        f"[BLOCK_{b['index']}] Page {b['page'] + 1}\n{b['text']}"
        for b in blocks
    )

    response = client.messages.create(
        model=settings.ai_model,
        max_tokens=4096,
        messages=[{"role": "user", "content": f"{EXTRACTION_PROMPT}\n\nDOCUMENT BLOCKS:\n\n{block_text}"}],
    )

    text = response.content[0].text.strip()
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        text = match.group()

    parsed = json.loads(text)
    raw_records = parsed.get("records", [parsed])

    # Dedup by file number
    seen: set[str] = set()
    records: list[dict] = []
    for r in raw_records:
        fn = r.get("fileNumber", {}).get("value", "").strip()
        if fn and fn in seen:
            continue
        if fn:
            seen.add(fn)
        records.append({f: _map_field(r.get(f), blocks) for f in FIELDS})

    return records
