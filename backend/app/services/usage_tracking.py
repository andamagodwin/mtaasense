import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, time
from decimal import Decimal

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.errors import AppError
from app.db.models import ModelCall
from app.db.models.enums import ModelOperation, Provenance
from app.db.session import session_scope


class BudgetExhausted(AppError):
    status_code = 503
    code = "model_budget_exhausted"


@dataclass
class CallRecord:
    operation: ModelOperation
    model: str
    endpoint: str
    provenance: Provenance = Provenance.live
    success: bool = False
    http_status: int | None = None
    error_code: str | None = None
    latency_ms: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_tokens: int | None = None
    reasoning_tokens: int | None = None
    image_count: int = 0
    audio_ms: int | None = None
    estimated_cost_usd: Decimal = field(default_factory=lambda: Decimal("0"))
    provider_response_id: str | None = None
    report_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None


def record_call(record: CallRecord) -> None:
    """Persist a model call in its own short transaction (never inside a caller's transaction)."""
    with session_scope() as db:
        db.add(ModelCall(**record.__dict__))


@dataclass(frozen=True)
class SpendSummary:
    today_usd: Decimal
    total_usd: Decimal
    daily_limit_usd: Decimal
    total_limit_usd: Decimal

    @property
    def exhausted(self) -> bool:
        return self.today_usd >= self.daily_limit_usd or self.total_usd >= self.total_limit_usd


def spend_summary() -> SpendSummary:
    settings = get_settings()
    start_of_day = datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC)
    with session_scope() as db:
        live = ModelCall.provenance == Provenance.live
        total = db.scalar(select(func.coalesce(func.sum(ModelCall.estimated_cost_usd), 0)).where(live))
        today = db.scalar(
            select(func.coalesce(func.sum(ModelCall.estimated_cost_usd), 0)).where(
                live, ModelCall.created_at >= start_of_day
            )
        )
    return SpendSummary(
        today_usd=Decimal(today or 0),
        total_usd=Decimal(total or 0),
        daily_limit_usd=Decimal(str(settings.model_daily_budget_usd)),
        total_limit_usd=Decimal(str(settings.model_total_budget_usd)),
    )


def ensure_budget() -> None:
    summary = spend_summary()
    if summary.exhausted:
        raise BudgetExhausted(
            "The configured model budget has been reached; AI processing is paused.",
        )
