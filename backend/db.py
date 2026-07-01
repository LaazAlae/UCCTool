"""Database layer: MongoDB connection, all CRUD, and file storage (GridFS).

Every read/write goes through this file — if data breaks, look here first.
NOTHING lives on disk. PDFs are in GridFS, metadata in collections.

Collections:
  projects — one doc per project (groups evidence for a final compiled report)
  jobs     — one doc per uploaded evidence (OCR blocks + extractions embedded)
  activity — append-only audit log for every user/system action
  usage    — daily cost tracking (one record per calendar day)
  fs.files + fs.chunks — GridFS stores PDFs here automatically
"""

import io
import logging
from datetime import datetime, timezone

import gridfs
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

from config import settings
from errors import AppError

log = logging.getLogger(__name__)

# ── Connection ──────────────────────────────────────────────────────────────
# Lazy singleton: first call connects, all subsequent calls reuse the client.
_client: MongoClient | None = None


def get_db():
    """Return the MongoDB database. Creates connection on first call."""
    global _client
    if _client is None:
        # Log host only — never credentials
        safe_url = settings.mongo_url.split("@")[-1] if "@" in settings.mongo_url else settings.mongo_url
        log.info("Connecting to MongoDB: %s (db=%s)", safe_url, settings.mongo_db)
        try:
            _client = MongoClient(settings.mongo_url, serverSelectionTimeoutMS=5000)
            _client.admin.command("ping")
            log.info("MongoDB connected successfully")
        except ConnectionFailure as exc:
            _client = None
            raise AppError(
                "DB_CONNECTION_FAILED",
                "Cannot connect to MongoDB. Is it running? (docker compose up -d)",
                503, {"message": str(exc)},
            ) from exc
    return _client[settings.mongo_db]


def _get_gridfs():
    """Return a GridFS instance for storing/retrieving files."""
    return gridfs.GridFS(get_db())


# ── File storage (GridFS) ──────────────────────────────────────────────────
# GridFS splits files into 255KB chunks and stores them across two collections
# (fs.files + fs.chunks). This handles PDFs up to 16TB — way beyond our needs.

def store_pdf(job_id: str, filename: str, content: bytes):
    """Store a PDF in GridFS. Returns the GridFS file ObjectId."""
    file_id = _get_gridfs().put(content, filename=filename, job_id=job_id)
    log.debug("PDF stored in GridFS: %s (%s, %.1f KB)", job_id, filename, len(content) / 1024)
    return file_id


def get_pdf(job_id: str) -> bytes:
    """Retrieve the evidence PDF for a job from GridFS."""
    job = get_job(job_id)
    file_id = job.get("pdfFileId")
    if not file_id:
        raise AppError("EVIDENCE_NOT_FOUND", "Evidence PDF not found.", 404)
    try:
        return _get_gridfs().get(file_id).read()
    except gridfs.NoFile:
        raise AppError("EVIDENCE_NOT_FOUND", "Evidence PDF missing from storage.", 404)


def get_pdf_stream(job_id: str) -> io.BytesIO:
    """Return a BytesIO stream of the evidence PDF (for serving to browser)."""
    return io.BytesIO(get_pdf(job_id))


# ── Jobs ────────────────────────────────────────────────────────────────────

def create_job(job_id: str, file_name: str, page_count: int, pdf_file_id,
               project_id: str | None = None, order: int = 0,
               result_type: str = "Records Found") -> dict:
    """Insert a new job after PDF upload. _id = job_id (UUID string)."""
    doc = {
        "_id": job_id,
        "fileName": file_name,
        "pageCount": page_count,
        "pdfFileId": pdf_file_id,
        "projectId": project_id,
        "order": order,
        "resultType": result_type,
        "included": True,
        "deletedAt": None,
        "ocrBlocks": None,
        "extractions": None,
        "cost": None,
        "listing": None,
        "listingMeta": None,
        "debugAiResponse": None,
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc),
    }
    get_db().jobs.insert_one(doc)
    log.debug("Job created: %s (%s, %d pages, project=%s)", job_id, file_name, page_count, project_id)
    return doc


def get_job(job_id: str) -> dict:
    """Fetch a job by ID. Raises 404 if not found."""
    doc = get_db().jobs.find_one({"_id": job_id})
    if not doc:
        raise AppError("JOB_NOT_FOUND", "Job not found.", 404)
    return doc


def _update_job(job_id: str, fields: dict):
    """Internal: $set fields on a job doc. Always bumps updatedAt."""
    fields["updatedAt"] = datetime.now(timezone.utc)
    result = get_db().jobs.update_one({"_id": job_id}, {"$set": fields})
    if result.matched_count == 0:
        raise AppError("JOB_NOT_FOUND", "Job not found.", 404)


# ── OCR ─────────────────────────────────────────────────────────────────────

def save_ocr(job_id: str, blocks: list[dict]):
    """Store OCR text blocks after successful Textract run."""
    _update_job(job_id, {"ocrBlocks": blocks})
    log.debug("OCR saved: %s (%d blocks)", job_id, len(blocks))


def get_ocr(job_id: str) -> list[dict] | None:
    """Return cached OCR blocks, or None if OCR hasn't run yet."""
    doc = get_job(job_id)
    return doc.get("ocrBlocks")


# ── Extraction ──────────────────────────────────────────────────────────────

def save_extraction(job_id: str, records: list[dict], cost: dict, debug: dict | None = None):
    """Store AI extraction results, cost, and optional debug response."""
    fields = {"extractions": records, "cost": cost}
    if debug:
        fields["debugAiResponse"] = debug
    _update_job(job_id, fields)
    log.debug("Extraction saved: %s (%d records)", job_id, len(records))


def get_extraction(job_id: str) -> tuple[list[dict], dict] | None:
    """Return cached (records, cost), or None if extraction hasn't run.
    Clears cache and returns None if extraction was all-blank (forces re-extract)."""
    doc = get_job(job_id)
    records = doc.get("extractions")
    if records is None:
        return None
    # All-blank extraction = something went wrong, re-extract
    has_real_data = any(
        any(f.get("value") for f in rec.values() if isinstance(f, dict))
        for rec in records if isinstance(rec, dict)
    )
    if not has_real_data:
        _update_job(job_id, {"extractions": None, "cost": None})
        log.warning("Cleared blank extraction cache for %s", job_id)
        return None
    return records, doc.get("cost") or {}


# ── Listing (user-confirmed data) ──────────────────────────────────────────

def save_listing(job_id: str, entries: list[dict], meta: dict | None):
    """Store confirmed listing entries + metadata after user review."""
    _update_job(job_id, {"listing": entries, "listingMeta": meta})
    log.debug("Listing saved: %s (%d entries)", job_id, len(entries))


# ── Activity log ────────────────────────────────────────────────────────────
# Separate collection — append-only, can grow large.
# Never throws: logging must never break the main operation.

def log_event(job_id: str, action: str, detail: dict | None = None):
    """Append an audit event. Swallows errors so logging never breaks the app."""
    try:
        get_db().activity.insert_one({
            "jobId": job_id,
            "action": action,
            "detail": detail or {},
            "ts": datetime.now(timezone.utc),
        })
    except Exception as exc:
        log.warning("Failed to log event '%s' for job %s: %s", action, job_id, exc)


# ── Usage / daily cost tracking ─────────────────────────────────────────────
# One record per day. Uses $inc for atomic updates (safe with concurrent requests).

def check_daily_budget(estimated_cost: float):
    """Raise 402 if adding estimated_cost would exceed the daily spending limit."""
    today = datetime.now(timezone.utc).date().isoformat()
    doc = get_db().usage.find_one({"_id": today})
    current = float(doc["totalCostUsd"]) if doc else 0.0
    projected = round(current + estimated_cost, 6)
    if projected > settings.max_daily_cost_usd:
        raise AppError(
            "DAILY_COST_LIMIT_EXCEEDED",
            f"Estimated daily cost would exceed ${settings.max_daily_cost_usd:.2f}.",
            402,
            {"projectedCostUsd": projected, "maxDailyCostUsd": settings.max_daily_cost_usd},
        )


def record_usage(job_id: str, usage: dict):
    """Record a job's cost to today's usage. Checks budget first."""
    cost = float(usage.get("totalEstimatedCostUsd", 0))
    check_daily_budget(cost)
    today = datetime.now(timezone.utc).date().isoformat()
    get_db().usage.update_one(
        {"_id": today},
        {
            "$inc": {"totalCostUsd": round(cost, 6)},
            "$push": {"jobs": {"jobId": job_id, "costUsd": cost}},
        },
        upsert=True,
    )
    log.debug("Usage recorded: job %s — $%.6f", job_id, cost)


# ── Projects ───────────────────────────────────────────────────────────────

def create_project(project_id: str, name: str, meta: dict, summary_pdf_file_id=None) -> dict:
    """Create a new project that groups evidence for a compiled report."""
    doc = {
        "_id": project_id,
        "name": name,
        "preparedFor": meta.get("preparedFor", ""),
        "clientMatter": meta.get("clientMatter", ""),
        "projectManager": meta.get("projectManager", ""),
        "projectNumber": meta.get("projectNumber", ""),
        "summaryPdfFileId": summary_pdf_file_id,
        "createdBy": None,
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc),
    }
    get_db().projects.insert_one(doc)
    log.debug("Project created: %s (%s)", project_id, name)
    return doc


def get_project(project_id: str) -> dict:
    """Fetch a project by ID. Raises 404 if not found."""
    doc = get_db().projects.find_one({"_id": project_id})
    if not doc:
        raise AppError("PROJECT_NOT_FOUND", "Project not found.", 404)
    return doc


def list_projects() -> list[dict]:
    """Return all projects, newest first."""
    return list(get_db().projects.find().sort("createdAt", -1))


def update_project(project_id: str, fields: dict):
    """Update project metadata."""
    fields["updatedAt"] = datetime.now(timezone.utc)
    result = get_db().projects.update_one({"_id": project_id}, {"$set": fields})
    if result.matched_count == 0:
        raise AppError("PROJECT_NOT_FOUND", "Project not found.", 404)


# ── Evidence management (project-scoped job queries) ──────────────────────

def get_project_evidence(project_id: str) -> list[dict]:
    """Return active (non-deleted) evidence for a project, in display order."""
    return list(get_db().jobs.find(
        {"projectId": project_id, "deletedAt": None},
    ).sort("order", 1))


def get_project_trash(project_id: str) -> list[dict]:
    """Return soft-deleted evidence for a project."""
    return list(get_db().jobs.find(
        {"projectId": project_id, "deletedAt": {"$ne": None}},
    ).sort("deletedAt", -1))


def next_evidence_order(project_id: str) -> int:
    """New evidence goes to the top (order 0). Push existing orders up by 1."""
    get_db().jobs.update_many(
        {"projectId": project_id, "deletedAt": None},
        {"$inc": {"order": 1}},
    )
    return 0


def soft_delete_evidence(job_id: str):
    """Soft-delete evidence (set deletedAt, never actually remove)."""
    _update_job(job_id, {"deletedAt": datetime.now(timezone.utc)})
    log.debug("Evidence soft-deleted: %s", job_id)


def restore_evidence(job_id: str):
    """Restore soft-deleted evidence."""
    job = get_job(job_id)
    order = next_evidence_order(job.get("projectId", ""))
    _update_job(job_id, {"deletedAt": None, "order": order})
    log.debug("Evidence restored: %s", job_id)


def reorder_evidence(project_id: str, job_ids: list[str]):
    """Set display order for evidence based on the provided ID list."""
    db = get_db()
    for i, jid in enumerate(job_ids):
        db.jobs.update_one(
            {"_id": jid, "projectId": project_id},
            {"$set": {"order": i, "updatedAt": datetime.now(timezone.utc)}},
        )
    log.debug("Evidence reordered: project %s (%d items)", project_id, len(job_ids))


def update_evidence_included(job_id: str, included: bool):
    """Toggle whether evidence is included in compilation."""
    _update_job(job_id, {"included": included})


def get_summary_pdf(project_id: str) -> bytes | None:
    """Return the uploaded summary PDF for a project, or None."""
    project = get_project(project_id)
    file_id = project.get("summaryPdfFileId")
    if not file_id:
        return None
    try:
        return _get_gridfs().get(file_id).read()
    except gridfs.NoFile:
        return None


def attach_pdf_to_job(job_id: str, pdf_file_id, file_name: str, page_count: int):
    """Attach an uploaded PDF to an existing placeholder job."""
    _update_job(job_id, {"pdfFileId": pdf_file_id, "fileName": file_name, "pageCount": page_count})
    log.debug("PDF attached to job: %s (%s, %d pages)", job_id, file_name, page_count)


def get_evidence_count(project_id: str) -> int:
    """Count active (non-deleted) evidence for a project."""
    return get_db().jobs.count_documents({"projectId": project_id, "deletedAt": None})


# ── Cleanup (call this when retention policy is decided) ────────────────────

def delete_jobs_older_than(days: int) -> int:
    """Delete old jobs + their GridFS PDFs. Returns count of jobs deleted.
    Activity logs are NEVER deleted — they are a permanent audit trail."""
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    db = get_db()
    fs = _get_gridfs()

    # Delete associated GridFS files first
    old_jobs = list(db.jobs.find({"createdAt": {"$lt": cutoff}}, {"pdfFileId": 1}))
    for job in old_jobs:
        if job.get("pdfFileId"):
            try:
                fs.delete(job["pdfFileId"])
            except Exception:
                pass

    # Delete job docs (metadata, OCR blocks, extractions — all regenerable)
    result = db.jobs.delete_many({"createdAt": {"$lt": cutoff}})
    log.info("Cleanup: deleted %d jobs older than %d days (activity logs preserved)", result.deleted_count, days)
    return result.deleted_count
