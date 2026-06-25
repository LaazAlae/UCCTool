import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pypdf import PdfReader

from ai_extract import extract_records
from config import settings
from cost import check_daily_budget, check_job_budget, record_usage, total_cost, estimate_ocr_cost
from errors import AppError, app_error_handler
from ocr import run_ocr
from pdf_gen import generate_listing_pdf
from schemas import LogBody, PdfBody, SaveBody, all_fields_confirmed

app = FastAPI()
app.add_exception_handler(AppError, app_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA = Path(settings.data_dir)
DATA.mkdir(parents=True, exist_ok=True)


def job_dir(job_id: str) -> Path:
    path = DATA / job_id
    if not path.exists():
        raise AppError("JOB_NOT_FOUND", "Job not found.", 404)
    return path


def write_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2))


def read_json(path: Path, fallback):
    return json.loads(path.read_text()) if path.exists() else fallback


def log_event(job_id: str, action: str, detail: dict | None = None):
    log_file = DATA / job_id / "activity.json"
    log = read_json(log_file, {"job_id": job_id, "events": []})
    log["events"].append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "detail": detail or {},
    })
    write_json(log_file, log)


@app.post("/api/upload")
async def upload(evidence: UploadFile):
    if not evidence.filename or not evidence.filename.lower().endswith(".pdf"):
        raise AppError("UPLOAD_NOT_PDF", "Only PDF files are accepted.", 400)

    content = await evidence.read()
    size_mb = len(content) / (1024 * 1024)
    if size_mb > settings.max_file_size_mb:
        raise AppError("UPLOAD_TOO_LARGE", "File exceeds size limit.", 400, {
            "sizeMb": round(size_mb, 2), "maxFileSizeMb": settings.max_file_size_mb,
        })

    job_id = str(uuid.uuid4())
    path = DATA / job_id
    path.mkdir(parents=True)
    pdf_path = path / "evidence.pdf"
    pdf_path.write_bytes(content)

    try:
        page_count = len(PdfReader(pdf_path).pages)
    except Exception as exc:
        raise AppError("UPLOAD_INVALID_PDF", "Uploaded file is not a readable PDF.", 400) from exc

    if page_count > settings.max_pages:
        raise AppError("UPLOAD_TOO_MANY_PAGES", "PDF exceeds page limit.", 400, {
            "pages": page_count, "maxPages": settings.max_pages,
        })

    estimated = estimate_ocr_cost(page_count)
    check_job_budget(estimated["estimatedCostUsd"])
    check_daily_budget(DATA, estimated["estimatedCostUsd"])
    log_event(job_id, "upload", {
        "fileName": evidence.filename, "pages": page_count,
        "sizeMb": round(size_mb, 2), "estimatedOcrCostUsd": estimated["estimatedCostUsd"],
    })

    return {"jobId": job_id, "fileName": evidence.filename, "pageCount": page_count}


@app.post("/api/ocr/{job_id}")
def ocr(job_id: str):
    path = job_dir(job_id)
    ocr_file = path / "ocr_blocks.json"

    if ocr_file.exists():
        blocks = read_json(ocr_file, [])
        return {"jobId": job_id, "blocks": len(blocks), "cached": True}

    log_event(job_id, "ocr_start", {"provider": settings.ocr_provider})
    t0 = time.time()
    blocks, ocr_usage = run_ocr(str(path / "evidence.pdf"))
    log_event(job_id, "ocr_complete", {
        **ocr_usage, "blocks": len(blocks), "durationMs": int((time.time() - t0) * 1000),
    })
    write_json(ocr_file, blocks)

    return {"jobId": job_id, "blocks": len(blocks), "cached": False}


@app.post("/api/extract/{job_id}")
def extract(job_id: str):
    path = job_dir(job_id)
    cached = path / "extraction.json"
    cost_file = path / "cost.json"

    if cached.exists():
        cached_data = read_json(cached, [])
        has_real_data = any(
            any(f.get("value") for f in rec.values() if isinstance(f, dict))
            for rec in cached_data if isinstance(rec, dict)
        )
        if has_real_data:
            return {"jobId": job_id, "extractions": cached_data, "cost": read_json(cost_file, {})}
        cached.unlink()

    ocr_file = path / "ocr_blocks.json"
    if not ocr_file.exists():
        raise AppError("OCR_NOT_DONE", "Run OCR before extraction.", 400)

    blocks = read_json(ocr_file, [])
    page_count = len(set(b["page"] for b in blocks))
    ocr_cost = estimate_ocr_cost(page_count)

    log_event(job_id, "extraction_start", {"provider": settings.ai_provider, "model": settings.ai_model})
    t0 = time.time()
    records, ai_usage = extract_records(blocks, path)

    usage = {
        "ocr": ocr_cost,
        "ai": ai_usage,
        "totalEstimatedCostUsd": total_cost(ocr_cost, ai_usage),
        "maxJobCostUsd": settings.max_job_cost_usd,
    }
    check_job_budget(usage["totalEstimatedCostUsd"])
    record_usage(DATA, job_id, usage)
    log_event(job_id, "extraction_complete", {
        **ai_usage, "records": len(records),
        "totalEstimatedCostUsd": usage["totalEstimatedCostUsd"],
        "durationMs": int((time.time() - t0) * 1000),
    })

    write_json(cached, records)
    write_json(cost_file, usage)
    return {"jobId": job_id, "extractions": records, "cost": usage}


@app.get("/api/evidence/{job_id}")
def get_evidence(job_id: str):
    pdf_path = job_dir(job_id) / "evidence.pdf"
    if not pdf_path.exists():
        raise AppError("EVIDENCE_NOT_FOUND", "Evidence PDF not found.", 404)
    return FileResponse(str(pdf_path), media_type="application/pdf")


@app.post("/api/save/{job_id}")
def save_listing(job_id: str, body: SaveBody):
    path = job_dir(job_id)
    if not all_fields_confirmed(body.entries):
        raise AppError("SAVE_REQUIRES_CONFIRMATION", "Every field must be confirmed before saving.", 400)

    payload = [entry.model_dump() for entry in body.entries]
    write_json(path / "listing.json", payload)
    if body.meta:
        write_json(path / "listing_meta.json", body.meta.model_dump())
    log_event(job_id, "save", {"entries": len(payload)})
    return {"jobId": job_id}


@app.post("/api/pdf/{job_id}")
def generate_pdf(job_id: str, body: PdfBody):
    path = job_dir(job_id)
    output = path / "listing_page.pdf"
    generate_listing_pdf(body.meta.model_dump(), body.records, output)
    log_event(job_id, "pdf_generated", {"records": len(body.records)})
    return FileResponse(str(output), media_type="application/pdf", filename="listing_page.pdf")


@app.post("/api/log/{job_id}")
def log_action(job_id: str, body: LogBody):
    job_dir(job_id)
    log_event(job_id, body.action, body.detail)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
