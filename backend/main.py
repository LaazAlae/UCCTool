import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pypdf import PdfReader

from config import settings
from ocr import run_ocr
from ai_extract import extract_records

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA = Path(settings.data_dir)
DATA.mkdir(parents=True, exist_ok=True)


# ── Helpers ──────────────────────────────────────────────────────────

def job_dir(job_id: str) -> Path:
    p = DATA / job_id
    if not p.exists():
        raise HTTPException(404, "Job not found")
    return p


def log_event(job_id: str, action: str, detail: dict | None = None):
    log_file = DATA / job_id / "activity.json"
    log = json.loads(log_file.read_text()) if log_file.exists() else {"job_id": job_id, "events": []}
    log["events"].append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "detail": detail or {},
    })
    log_file.write_text(json.dumps(log, indent=2))


# ── Routes ───────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload(evidence: UploadFile):
    if not evidence.filename or not evidence.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted")

    content = await evidence.read()
    size_mb = len(content) / (1024 * 1024)
    if size_mb > settings.max_file_size_mb:
        raise HTTPException(400, f"File too large ({size_mb:.1f}MB > {settings.max_file_size_mb}MB)")

    job_id = str(uuid.uuid4())
    d = DATA / job_id
    d.mkdir(parents=True)

    pdf_path = d / "evidence.pdf"
    pdf_path.write_bytes(content)

    page_count = len(PdfReader(pdf_path).pages)

    log_event(job_id, "upload", {
        "fileName": evidence.filename,
        "pages": page_count,
        "sizeMb": round(size_mb, 2),
    })

    return {"jobId": job_id, "fileName": evidence.filename, "pageCount": page_count}


@app.post("/api/extract/{job_id}")
def extract(job_id: str):
    jp = job_dir(job_id)
    pdf_path = jp / "evidence.pdf"

    cache = jp / "extraction.json"
    if cache.exists():
        return {"jobId": job_id, "extractions": json.loads(cache.read_text())}

    # OCR
    log_event(job_id, "ocr_start", {"provider": settings.ocr_provider})
    t0 = time.time()
    blocks = run_ocr(str(pdf_path))
    ocr_ms = int((time.time() - t0) * 1000)
    log_event(job_id, "ocr_complete", {"provider": settings.ocr_provider, "blocks": len(blocks), "durationMs": ocr_ms})
    (jp / "ocr_blocks.json").write_text(json.dumps(blocks, indent=2))

    # AI extraction
    log_event(job_id, "extraction_start", {"provider": settings.ai_provider, "model": settings.ai_model})
    t0 = time.time()
    records = extract_records(blocks)
    ext_ms = int((time.time() - t0) * 1000)
    log_event(job_id, "extraction_complete", {"provider": settings.ai_provider, "records": len(records), "durationMs": ext_ms})

    cache.write_text(json.dumps(records, indent=2))

    return {"jobId": job_id, "extractions": records}


@app.get("/api/evidence/{job_id}")
def get_evidence(job_id: str):
    pdf_path = job_dir(job_id) / "evidence.pdf"
    return FileResponse(str(pdf_path), media_type="application/pdf")


class SaveBody(BaseModel):
    entries: list[dict]

@app.post("/api/save/{job_id}")
def save_listing(job_id: str, body: SaveBody):
    jp = job_dir(job_id)
    (jp / "listing.json").write_text(json.dumps(body.entries, indent=2))
    log_event(job_id, "save", {"entries": len(body.entries)})
    return {"jobId": job_id}


class LogBody(BaseModel):
    action: str
    detail: dict = {}

@app.post("/api/log/{job_id}")
def log_action(job_id: str, body: LogBody):
    log_event(job_id, body.action, body.detail)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
