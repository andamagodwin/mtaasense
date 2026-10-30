import json
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from sqlalchemy import Integer, case, cast, func, select

from app.api.dependencies import DB, Admin
from app.db.models import ModelCall
from app.schemas.api import ModelCallView, UsageBucket, UsageReport
from app.services import pricing
from app.services.usage_tracking import spend_summary

router = APIRouter(prefix="/admin", tags=["admin"])

EVAL_SUMMARY = Path(__file__).resolve().parents[3] / "eval" / "results" / "summary.json"


def _buckets(db: DB, key: Any) -> list[UsageBucket]:
    rows = db.execute(
        select(
            key.label("key"),
            func.count(),
            func.sum(case((ModelCall.success.is_(False), 1), else_=0)),
            func.coalesce(func.sum(ModelCall.input_tokens), 0),
            func.coalesce(func.sum(ModelCall.output_tokens), 0),
            func.coalesce(func.sum(ModelCall.image_count), 0),
            func.coalesce(func.sum(ModelCall.audio_ms), 0),
            func.coalesce(func.sum(ModelCall.estimated_cost_usd), 0),
            func.avg(cast(ModelCall.latency_ms, Integer)),
        )
        .group_by(key)
        .order_by(key)
    ).all()
    return [
        UsageBucket(
            key=str(r[0]),
            calls=r[1],
            failures=r[2] or 0,
            input_tokens=r[3],
            output_tokens=r[4],
            images=r[5],
            audio_seconds=round((r[6] or 0) / 1000, 1),
            estimated_cost_usd=Decimal(r[7]).quantize(Decimal("0.0001")),
            avg_latency_ms=round(float(r[8]), 0) if r[8] is not None else None,
        )
        for r in rows
    ]


@router.get("/usage", response_model=UsageReport)
def usage(db: DB, _: Admin) -> UsageReport:
    spend = spend_summary()
    recent = db.scalars(select(ModelCall).order_by(ModelCall.created_at.desc()).limit(50)).all()
    return UsageReport(
        estimated_total_usd=spend.total_usd.quantize(Decimal("0.0001")),
        estimated_today_usd=spend.today_usd.quantize(Decimal("0.0001")),
        daily_limit_usd=spend.daily_limit_usd,
        total_limit_usd=spend.total_limit_usd,
        budget_exhausted=spend.exhausted,
        by_operation=_buckets(db, ModelCall.operation),
        by_model=_buckets(db, ModelCall.model),
        by_day=_buckets(db, func.to_char(func.date_trunc("day", ModelCall.created_at), "YYYY-MM-DD")),
        recent=[ModelCallView.model_validate(c) for c in recent],
        pricing_source=pricing.PRICES_SOURCE,
        pricing_retrieved=pricing.PRICES_RETRIEVED,
        note=(
            "Estimates = provider-reported token/image/audio usage × the official price list. "
            "This is not the account balance; check the Meta developer console for billing."
        ),
    )


@router.get("/evaluation")
def evaluation(_: Admin) -> dict[str, Any]:
    if not EVAL_SUMMARY.is_file():
        return {"available": False, "message": "No evaluation has been run yet."}
    return {"available": True, **json.loads(EVAL_SUMMARY.read_text())}
