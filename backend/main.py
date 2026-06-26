"""FastAPI routes — the only file that handles HTTP.

Each endpoint is thin: validate input, call the right module, return JSON.
Data goes through db.py (MongoDB + GridFS), OCR through ocr.py, AI through ai_extract.py.
NOTHING lives on disk — all files and metadata are in MongoDB.
"""

import io
import logging
import time
import uuid

from fastapi import FastAPI, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pypdf import PdfReader

from ai_extract import extract_records
from config import settings
from cost import check_job_budget, estimate_ocr_cost, total_cost
from db import (
    check_daily_budget,
    create_job,
    create_project,
    get_evidence_count,
    get_extraction,
    get_job,
    get_ocr,
    get_pdf,
    get_project,
    get_project_evidence,
    get_project_trash,
    list_projects,
    log_event,
    next_evidence_order,
    record_usage,
    reorder_evidence,
    restore_evidence,
    save_extraction,
    save_listing as db_save_listing,
    save_ocr,
    soft_delete_evidence,
    store_pdf,
    update_evidence_included,
    update_project,
)
from errors import AppError, app_error_handler
from ocr import run_ocr
from pdf_gen import compile_project_pdf, generate_listing_pdf, preview_listing_with_evidence, view_evidence_pdf
from schemas import (
    CreateProject,
    LogBody,
    NoRecordsMeta,
    PdfBody,
    ReorderBody,
    SaveBody,
    UpdateProject,
    all_fields_confirmed,
)

# ── Logging setup ───────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s  %(levelname)-5s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("pymongo").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("botocore").setLevel(logging.WARNING)

log = logging.getLogger(__name__)

# ── App setup ───────────────────────────────────────────────────────────────
app = FastAPI()
app.add_exception_handler(AppError, app_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health check ────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    """Quick connectivity check for the API + MongoDB."""
    from db import get_db
    try:
        get_db().command("ping")
        return {"status": "ok", "db": "connected"}
    except Exception as exc:
        return JSONResponse(status_code=503, content={"status": "error", "db": str(exc)})


# ── Job info ──────────────────────────────────────────────────────────────────
@app.get("/api/job/{job_id}")
def get_job_info(job_id: str):
    job = get_job(job_id)
    return {
        "jobId": job["_id"],
        "fileName": job.get("fileName", ""),
        "pageCount": job.get("pageCount", 0),
        "resultType": job.get("resultType", "Records Found"),
        "projectId": job.get("projectId"),
    }


# ── Upload ──────────────────────────────────────────────────────────────────
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

    # Validate PDF and count pages (from bytes, no disk needed)
    try:
        page_count = len(PdfReader(io.BytesIO(content)).pages)
    except Exception as exc:
        raise AppError("UPLOAD_INVALID_PDF", "Uploaded file is not a readable PDF.", 400) from exc

    if page_count > settings.max_pages:
        raise AppError("UPLOAD_TOO_MANY_PAGES", "PDF exceeds page limit.", 400, {
            "pages": page_count, "maxPages": settings.max_pages,
        })

    # Budget check before any paid work
    estimated = estimate_ocr_cost(page_count)
    check_job_budget(estimated["estimatedCostUsd"])
    check_daily_budget(estimated["estimatedCostUsd"])

    # Store PDF in GridFS, then create job in MongoDB
    job_id = str(uuid.uuid4())
    pdf_file_id = store_pdf(job_id, evidence.filename, content)
    create_job(job_id, evidence.filename, page_count, pdf_file_id)
    log_event(job_id, "upload", {
        "fileName": evidence.filename, "pages": page_count,
        "sizeMb": round(size_mb, 2), "estimatedOcrCostUsd": estimated["estimatedCostUsd"],
    })
    log.info("Uploaded: %s (%d pages, %.1f MB) -> job %s", evidence.filename, page_count, size_mb, job_id)

    return {"jobId": job_id, "fileName": evidence.filename, "pageCount": page_count}


# ── OCR ─────────────────────────────────────────────────────────────────────
@app.post("/api/ocr/{job_id}")
def ocr(job_id: str):
    # Return cached result if OCR already ran
    cached = get_ocr(job_id)
    if cached is not None:
        log.debug("OCR cache hit: %s (%d blocks)", job_id, len(cached))
        return {"jobId": job_id, "blocks": len(cached), "cached": True}

    # Pull PDF from GridFS and run OCR
    pdf_bytes = get_pdf(job_id)
    log_event(job_id, "ocr_start", {"provider": settings.ocr_provider})
    t0 = time.time()
    blocks, ocr_usage = run_ocr(pdf_bytes)
    elapsed = int((time.time() - t0) * 1000)

    # Save blocks to MongoDB
    save_ocr(job_id, blocks)
    log_event(job_id, "ocr_complete", {**ocr_usage, "blocks": len(blocks), "durationMs": elapsed})
    log.info("OCR done: %s — %d blocks in %dms", job_id, len(blocks), elapsed)

    return {"jobId": job_id, "blocks": len(blocks), "cached": False}


# ── AI Extraction ───────────────────────────────────────────────────────────
@app.post("/api/extract/{job_id}")
def extract(job_id: str):
    # Return cached result if extraction already ran
    cached = get_extraction(job_id)
    if cached:
        records, cost = cached
        log.debug("Extraction cache hit: %s (%d records)", job_id, len(records))
        return {"jobId": job_id, "extractions": records, "cost": cost}

    # OCR must run first
    blocks = get_ocr(job_id)
    if blocks is None:
        raise AppError("OCR_NOT_DONE", "Run OCR before extraction.", 400)

    # Run AI extraction
    page_count = len(set(b["page"] for b in blocks))
    ocr_cost = estimate_ocr_cost(page_count)
    log_event(job_id, "extraction_start", {"provider": settings.ai_provider, "model": settings.ai_model})

    t0 = time.time()
    records, ai_usage, debug = extract_records(blocks)
    elapsed = int((time.time() - t0) * 1000)

    # Compute total cost and enforce limits
    usage = {
        "ocr": ocr_cost,
        "ai": ai_usage,
        "totalEstimatedCostUsd": total_cost(ocr_cost, ai_usage),
        "maxJobCostUsd": settings.max_job_cost_usd,
    }
    check_job_budget(usage["totalEstimatedCostUsd"])
    record_usage(job_id, usage)

    # Save everything to MongoDB (extraction + cost + debug AI response)
    save_extraction(job_id, records, usage, debug)
    log_event(job_id, "extraction_complete", {
        **ai_usage, "records": len(records),
        "totalEstimatedCostUsd": usage["totalEstimatedCostUsd"],
        "durationMs": elapsed,
    })
    log.info("Extraction done: %s — %d records in %dms ($%.4f)", job_id, len(records), elapsed, usage["totalEstimatedCostUsd"])

    return {"jobId": job_id, "extractions": records, "cost": usage}


# ── Evidence PDF ────────────────────────────────────────────────────────────
@app.get("/api/evidence/{job_id}")
def get_evidence(job_id: str):
    """Serve the uploaded evidence PDF from GridFS."""
    pdf_bytes = get_pdf(job_id)
    return Response(content=pdf_bytes, media_type="application/pdf")


@app.get("/api/evidence/{job_id}/view")
def view_evidence(job_id: str):
    """View evidence with its listing page on top (Records Found) or Individual Results (No Records)."""
    job = get_job(job_id)
    evidence_bytes = get_pdf(job_id)
    project = None
    if job.get("projectId"):
        try:
            project = get_project(job["projectId"])
        except Exception:
            pass
    pdf_bytes = view_evidence_pdf(job, evidence_bytes, project)
    return Response(content=pdf_bytes, media_type="application/pdf")


# ── Save confirmed listing ─────────────────────────────────────────────────
@app.post("/api/save/{job_id}")
def save(job_id: str, body: SaveBody):
    get_job(job_id)
    if not all_fields_confirmed(body.entries):
        raise AppError("SAVE_REQUIRES_CONFIRMATION", "Every field must be confirmed before saving.", 400)

    entries = [entry.model_dump() for entry in body.entries]
    meta = body.meta.model_dump() if body.meta else None
    db_save_listing(job_id, entries, meta)
    log_event(job_id, "save", {"entries": len(entries)})
    log.info("Listing saved: %s (%d entries)", job_id, len(entries))

    return {"jobId": job_id}


# ── Generate PDF ────────────────────────────────────────────────────────────
@app.post("/api/pdf/{job_id}")
def generate_pdf(job_id: str, body: PdfBody):
    get_job(job_id)
    evidence_bytes = get_pdf(job_id)
    pdf_bytes = bytes(preview_listing_with_evidence(body.meta.model_dump(), body.records, evidence_bytes))
    log_event(job_id, "pdf_generated", {"records": len(body.records)})
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=listing_page.pdf"},
    )


# ── Activity logging (from frontend) ───────────────────────────────────────
@app.post("/api/log/{job_id}")
def log_action(job_id: str, body: LogBody):
    get_job(job_id)
    log_event(job_id, body.action, body.detail)
    return {"ok": True}


# ── Projects ──────────────────────────────────────────────────────────────

@app.post("/api/projects")
def create_project_route(body: CreateProject):
    project_id = str(uuid.uuid4())
    doc = create_project(project_id, body.name, body.model_dump())
    log_event(project_id, "project_created", {"name": body.name})
    log.info("Project created: %s (%s)", project_id, body.name)
    return _serialize(doc)


@app.get("/api/projects")
def list_projects_route():
    projects = list_projects()
    for p in projects:
        p["evidenceCount"] = get_evidence_count(p["_id"])
    return [_serialize(p) for p in projects]


@app.get("/api/projects/{project_id}")
def get_project_route(project_id: str):
    project = _serialize(get_project(project_id))
    evidence = get_project_evidence(project_id)
    project["evidence"] = [_serialize_evidence(e) for e in evidence]
    return project


@app.put("/api/projects/{project_id}")
def update_project_route(project_id: str, body: UpdateProject):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise AppError("NO_FIELDS", "No fields to update.", 400)
    update_project(project_id, fields)
    log_event(project_id, "project_updated", fields)
    return {"ok": True}


# ── Project evidence management ──────────────────────────────────────────

@app.post("/api/projects/{project_id}/upload")
async def upload_to_project(project_id: str, evidence: UploadFile, result_type: str = "Records Found"):
    """Upload evidence into a project. result_type is 'Records Found' or 'No Records'."""
    get_project(project_id)

    if not evidence.filename or not evidence.filename.lower().endswith(".pdf"):
        raise AppError("UPLOAD_NOT_PDF", "Only PDF files are accepted.", 400)

    content = await evidence.read()
    size_mb = len(content) / (1024 * 1024)
    if size_mb > settings.max_file_size_mb:
        raise AppError("UPLOAD_TOO_LARGE", "File exceeds size limit.", 400, {
            "sizeMb": round(size_mb, 2), "maxFileSizeMb": settings.max_file_size_mb,
        })

    try:
        page_count = len(PdfReader(io.BytesIO(content)).pages)
    except Exception as exc:
        raise AppError("UPLOAD_INVALID_PDF", "Uploaded file is not a readable PDF.", 400) from exc

    if page_count > settings.max_pages:
        raise AppError("UPLOAD_TOO_MANY_PAGES", "PDF exceeds page limit.", 400, {
            "pages": page_count, "maxPages": settings.max_pages,
        })

    if result_type == "Records Found":
        estimated = estimate_ocr_cost(page_count)
        check_job_budget(estimated["estimatedCostUsd"])
        check_daily_budget(estimated["estimatedCostUsd"])

    job_id = str(uuid.uuid4())
    order = next_evidence_order(project_id)
    pdf_file_id = store_pdf(job_id, evidence.filename, content)
    create_job(job_id, evidence.filename, page_count, pdf_file_id,
               project_id=project_id, order=order, result_type=result_type)
    log_event(job_id, "evidence_uploaded", {
        "projectId": project_id, "fileName": evidence.filename,
        "pages": page_count, "resultType": result_type,
    })
    log.info("Evidence uploaded to project %s: %s (%s)", project_id, evidence.filename, result_type)

    return {"jobId": job_id, "fileName": evidence.filename, "pageCount": page_count, "resultType": result_type}


@app.post("/api/projects/{project_id}/evidence/{job_id}/no-records-meta")
def save_no_records_meta(project_id: str, job_id: str, body: NoRecordsMeta):
    """Save metadata for a 'No Records' evidence (no OCR/extraction needed)."""
    get_project(project_id)
    job = get_job(job_id)
    if job.get("projectId") != project_id:
        raise AppError("EVIDENCE_NOT_IN_PROJECT", "Evidence does not belong to this project.", 400)
    meta = {
        "debtor": body.debtor,
        "summary": body.searchType,
        "jurisdiction": body.jurisdiction,
        "thruDate": body.thruDate,
        "yearsSearched": body.yearsSearched,
    }
    db_save_listing(job_id, [], meta)
    log_event(job_id, "no_records_meta_saved", meta)
    return {"ok": True}


@app.delete("/api/projects/{project_id}/evidence/{job_id}")
def delete_evidence(project_id: str, job_id: str):
    """Soft-delete evidence (never actually removed)."""
    get_project(project_id)
    job = get_job(job_id)
    if job.get("projectId") != project_id:
        raise AppError("EVIDENCE_NOT_IN_PROJECT", "Evidence does not belong to this project.", 400)
    soft_delete_evidence(job_id)
    log_event(job_id, "evidence_deleted", {"projectId": project_id})
    return {"ok": True}


@app.post("/api/projects/{project_id}/evidence/{job_id}/restore")
def restore_evidence_route(project_id: str, job_id: str):
    """Restore soft-deleted evidence."""
    get_project(project_id)
    job = get_job(job_id)
    if job.get("projectId") != project_id:
        raise AppError("EVIDENCE_NOT_IN_PROJECT", "Evidence does not belong to this project.", 400)
    restore_evidence(job_id)
    log_event(job_id, "evidence_restored", {"projectId": project_id})
    return {"ok": True}


@app.put("/api/projects/{project_id}/evidence/reorder")
def reorder_evidence_route(project_id: str, body: ReorderBody):
    """Update display order of evidence."""
    get_project(project_id)
    reorder_evidence(project_id, body.jobIds)
    log_event(project_id, "evidence_reordered", {"count": len(body.jobIds)})
    return {"ok": True}


@app.put("/api/projects/{project_id}/evidence/{job_id}/include")
def toggle_include(project_id: str, job_id: str, included: bool = True):
    """Toggle whether evidence is included in compilation."""
    get_project(project_id)
    job = get_job(job_id)
    if job.get("projectId") != project_id:
        raise AppError("EVIDENCE_NOT_IN_PROJECT", "Evidence does not belong to this project.", 400)
    update_evidence_included(job_id, included)
    log_event(job_id, "evidence_include_toggled", {"included": included})
    return {"ok": True}


@app.get("/api/projects/{project_id}/trash")
def get_trash(project_id: str):
    get_project(project_id)
    return [_serialize_evidence(e) for e in get_project_trash(project_id)]


@app.post("/api/projects/{project_id}/compile")
def compile_report(project_id: str):
    """Compile the final project PDF (summary + individual results + evidence)."""
    project = get_project(project_id)
    evidence = [e for e in get_project_evidence(project_id) if e.get("included", True)]
    if not evidence:
        raise AppError("NO_EVIDENCE", "No evidence to compile.", 400)

    evidence_pdfs = {}
    for e in evidence:
        if e.get("pdfFileId"):
            try:
                evidence_pdfs[e["_id"]] = get_pdf(e["_id"])
            except Exception:
                pass

    pdf_bytes = compile_project_pdf(project, evidence, evidence_pdfs)
    log_event(project_id, "report_compiled", {"evidenceCount": len(evidence)})
    log.info("Report compiled: project %s (%d evidence)", project_id, len(evidence))

    filename = f"{project.get('projectNumber') or project.get('name', 'report')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )


# ── Serialization helpers ─────────────────────────────────────────────────

def _serialize(doc: dict) -> dict:
    """Convert MongoDB doc to JSON-safe dict (ObjectId -> str)."""
    out = {**doc}
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    for key in ("pdfFileId", "createdAt", "updatedAt", "deletedAt"):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    return out


def _serialize_evidence(doc: dict) -> dict:
    """Serialize a job/evidence doc for the project detail API."""
    meta = doc.get("listingMeta") or {}
    listing = doc.get("listing") or []
    return {
        "id": str(doc["_id"]),
        "fileName": doc.get("fileName", ""),
        "pageCount": doc.get("pageCount", 0),
        "resultType": doc.get("resultType", "Records Found"),
        "included": doc.get("included", True),
        "order": doc.get("order", 0),
        "debtor": meta.get("debtor", ""),
        "searchType": meta.get("summary", ""),
        "jurisdiction": meta.get("jurisdiction", ""),
        "thruDate": meta.get("thruDate", ""),
        "recordCount": len(listing),
        "hasListing": bool(listing),
        "hasMeta": bool(meta),
        "createdAt": str(doc.get("createdAt", "")),
        "updatedAt": str(doc.get("updatedAt", "")),
        "deletedAt": str(doc["deletedAt"]) if doc.get("deletedAt") else None,
    }


# ── Dev server ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
