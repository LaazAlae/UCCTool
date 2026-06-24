"""OCR layer — extracts text blocks with bounding boxes from a PDF.

Swap providers by changing OCR_PROVIDER in .env.
Each provider function takes a PDF path and returns a flat list of blocks:
  [{"index": 0, "text": "...", "page": 0, "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.02}, ...]
Coordinates are normalized 0-1 fractions of page dimensions. Pages are 0-indexed.
"""

import io
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from pypdf import PdfReader, PdfWriter

from config import settings


def run_ocr(pdf_path: str) -> list[dict]:
    if settings.ocr_provider == "textract":
        return _textract_ocr(pdf_path)
    raise ValueError(f"Unknown OCR provider: {settings.ocr_provider}")


def _textract_ocr(pdf_path: str) -> list[dict]:
    client = boto3.client("textract", region_name=settings.aws_region)
    reader = PdfReader(pdf_path)
    page_count = min(len(reader.pages), settings.max_pages)

    def process_page(page_idx: int) -> list[dict]:
        writer = PdfWriter()
        writer.add_page(reader.pages[page_idx])
        buf = io.BytesIO()
        writer.write(buf)

        try:
            resp = client.analyze_document(
                Document={"Bytes": buf.getvalue()},
                FeatureTypes=["TABLES"],
            )
        except Exception as e:
            print(f"Textract failed on page {page_idx + 1}: {e}")
            return []

        blocks = []
        for b in resp.get("Blocks", []):
            if b["BlockType"] == "LINE" and b.get("Text"):
                bb = b.get("Geometry", {}).get("BoundingBox", {})
                blocks.append({
                    "index": 0,
                    "text": b["Text"],
                    "page": page_idx,
                    "x": bb.get("Left", 0),
                    "y": bb.get("Top", 0),
                    "width": bb.get("Width", 0),
                    "height": bb.get("Height", 0),
                })
        return blocks

    results: dict[int, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(process_page, i): i for i in range(page_count)}
        for future in as_completed(futures):
            results[futures[future]] = future.result()

    all_blocks: list[dict] = []
    for i in range(page_count):
        for block in results.get(i, []):
            block["index"] = len(all_blocks)
            all_blocks.append(block)

    return all_blocks
