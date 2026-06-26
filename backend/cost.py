"""Cost estimation — pure calculations only, no storage.

All actual cost tracking (daily budgets, usage ledger) lives in db.py.
This file just does math so it's easy to test and swap pricing.
"""

from config import settings
from errors import AppError


def estimate_ocr_cost(page_count: int) -> dict:
    """Estimate Textract cost for N pages. Returns provider + cost dict."""
    return {
        "provider": settings.ocr_provider,
        "pages": page_count,
        "estimatedCostUsd": round(page_count * settings.textract_analyze_page_usd, 6),
    }


def estimate_ai_cost(input_tokens: int, output_tokens: int) -> dict:
    """Estimate Claude cost from token counts. Returns provider + cost dict."""
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
    """Sum estimatedCostUsd from multiple cost dicts."""
    return round(sum(float(part.get("estimatedCostUsd", 0)) for part in parts), 6)


def check_job_budget(estimated_cost: float):
    """Raise 402 if a single job's estimated cost exceeds the per-job limit."""
    if estimated_cost > settings.max_job_cost_usd:
        raise AppError(
            "JOB_COST_LIMIT_EXCEEDED",
            f"Estimated job cost ${estimated_cost:.4f} exceeds ${settings.max_job_cost_usd:.2f} limit.",
            402,
            {"estimatedCostUsd": estimated_cost, "maxJobCostUsd": settings.max_job_cost_usd},
        )
