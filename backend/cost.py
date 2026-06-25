import json
from datetime import datetime, timezone
from pathlib import Path

from config import settings
from errors import AppError


# Estimates are intentionally centralized so provider swaps do not hide cost math.
def estimate_ocr_cost(page_count: int) -> dict:
    return {
        "provider": settings.ocr_provider,
        "pages": page_count,
        "estimatedCostUsd": round(page_count * settings.textract_analyze_page_usd, 6),
    }


def estimate_ai_cost(input_tokens: int, output_tokens: int) -> dict:
    return {
        "provider": settings.ai_provider,
        "model": settings.ai_model,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "estimatedCostUsd": round(
            (input_tokens / 1_000_000 * settings.ai_input_1m_tokens_usd)
            + (output_tokens / 1_000_000 * settings.ai_output_1m_tokens_usd),
            6,
        ),
    }


def total_cost(*parts: dict) -> float:
    return round(sum(float(part.get("estimatedCostUsd", 0)) for part in parts), 6)


# Fail closed before expensive work proceeds beyond configured limits.
def check_job_budget(estimated_cost: float):
    if estimated_cost > settings.max_job_cost_usd:
        raise AppError(
            "JOB_COST_LIMIT_EXCEEDED",
            f"Estimated job cost ${estimated_cost:.4f} exceeds ${settings.max_job_cost_usd:.2f} limit.",
            402,
            {"estimatedCostUsd": estimated_cost, "maxJobCostUsd": settings.max_job_cost_usd},
        )


def _daily_payload(data_dir: Path) -> tuple[dict, dict]:
    ledger = data_dir / "usage.json"
    today = datetime.now(timezone.utc).date().isoformat()
    payload = json.loads(ledger.read_text()) if ledger.exists() else {"days": {}}
    day = payload["days"].setdefault(today, {"totalCostUsd": 0, "jobs": []})
    return payload, day


def check_daily_budget(data_dir: Path, estimated_cost: float):
    _, day = _daily_payload(data_dir)
    projected = round(float(day["totalCostUsd"]) + estimated_cost, 6)
    if projected > settings.max_daily_cost_usd:
        raise AppError(
            "DAILY_COST_LIMIT_EXCEEDED",
            f"Estimated daily cost would exceed ${settings.max_daily_cost_usd:.2f}.",
            402,
            {"projectedCostUsd": projected, "maxDailyCostUsd": settings.max_daily_cost_usd},
        )


# Append estimated usage after successful extraction; later this can move to a DB table.
def record_usage(data_dir: Path, job_id: str, usage: dict):
    payload, day = _daily_payload(data_dir)
    cost = float(usage.get("totalEstimatedCostUsd", 0))
    check_daily_budget(data_dir, cost)
    day["totalCostUsd"] = round(float(day["totalCostUsd"]) + cost, 6)
    day["jobs"].append({"jobId": job_id, "costUsd": cost})
    (data_dir / "usage.json").write_text(json.dumps(payload, indent=2))
