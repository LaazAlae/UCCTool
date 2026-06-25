"""OCR layer: PDF -> text blocks with normalized bounding boxes.

Provider contract:
  run_ocr(path) returns (blocks, usage)
  blocks are flat, ordered, and use 0-indexed page numbers with 0-1 coordinates.
"""

import io
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from pypdf import PdfReader, PdfWriter

from config import settings
from cost import estimate_ocr_cost
from errors import AppError


def run_ocr(pdf_path: str) -> tuple[list[dict], dict]:
    providers = {"textract": _textract_ocr}
    provider = providers.get(settings.ocr_provider)
    if not provider:
        raise AppError("UNKNOWN_OCR_PROVIDER", f"Unknown OCR provider: {settings.ocr_provider}", 500)
    return provider(pdf_path)


def _textract_ocr(pdf_path: str) -> tuple[list[dict], dict]:
    client = boto3.client("textract", region_name=settings.aws_region)
    reader = PdfReader(pdf_path)
    page_count = len(reader.pages)

    # Textract sync APIs work page-by-page for PDFs sent as bytes.
    def process_page(page_idx: int) -> list[dict]:
        writer = PdfWriter()
        writer.add_page(reader.pages[page_idx])
        buf = io.BytesIO()
        writer.write(buf)

        resp = client.analyze_document(
            Document={"Bytes": buf.getvalue()},
            FeatureTypes=["TABLES"],
        )

        blocks = []
        for block in resp.get("Blocks", []):
            if block.get("BlockType") == "LINE" and block.get("Text"):
                bb = block.get("Geometry", {}).get("BoundingBox", {})
                blocks.append({
                    "index": 0,
                    "text": block["Text"],
                    "page": page_idx,
                    "x": bb.get("Left", 0),
                    "y": bb.get("Top", 0),
                    "width": bb.get("Width", 0),
                    "height": bb.get("Height", 0),
                })
        return blocks

    # Pages run concurrently for speed, then get reassembled in page order below.
    results: dict[int, list[dict]] = {}
    errors: list[dict] = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(process_page, i): i for i in range(page_count)}
        for future in as_completed(futures):
            page_idx = futures[future]
            try:
                results[page_idx] = future.result()
            except Exception as exc:
                errors.append({"page": page_idx + 1, "message": str(exc)})

    if errors:
        raise AppError("OCR_PROVIDER_FAILED", "OCR failed on one or more pages.", 502, {"pages": errors})

    all_blocks: list[dict] = []
    for page_idx in range(page_count):
        for block in results.get(page_idx, []):
            block["index"] = len(all_blocks)
            all_blocks.append(block)

    # Empty OCR is a hard failure because downstream AI would guess from nothing.
    if not all_blocks:
        raise AppError("OCR_EMPTY_RESULT", "OCR completed but returned no readable text blocks.", 422)

    return all_blocks, estimate_ocr_cost(page_count)
