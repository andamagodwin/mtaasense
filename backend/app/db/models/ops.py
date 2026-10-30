import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk, str_enum, utcnow
from app.db.models.enums import JobKind, JobStatus, ModelOperation, Provenance


class ProcessingJob(UUIDPk, Timestamps, Base):
    """Persistent work queue row. Workers claim with FOR UPDATE SKIP LOCKED."""

    __tablename__ = "processing_jobs"

    kind: Mapped[JobKind] = mapped_column(str_enum(JobKind, "job_kind"))
    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    segmentation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("segmentations.id", ondelete="CASCADE"))
    status: Mapped[JobStatus] = mapped_column(str_enum(JobStatus, "job_status"), default=JobStatus.queued)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(String(64))
    # Safe, user-presentable classification only — never raw provider messages.
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_detail: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    # Prevents two live jobs doing the same expensive work (e.g. double-clicked "analyze").
    dedupe_key: Mapped[str] = mapped_column(String(160))

    __table_args__ = (
        Index(
            "uq_processing_jobs_active_dedupe",
            "dedupe_key",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
        Index("ix_processing_jobs_claim", "status", "run_after"),
    )


class ModelCall(UUIDPk, Base):
    """One request to the Meta Model API (or a labeled fixture). Basis for cost tracking."""

    __tablename__ = "model_calls"

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    operation: Mapped[ModelOperation] = mapped_column(str_enum(ModelOperation, "model_operation"))
    model: Mapped[str] = mapped_column(String(64))
    endpoint: Mapped[str] = mapped_column(String(64))
    provenance: Mapped[Provenance] = mapped_column(str_enum(Provenance, "provenance"))
    success: Mapped[bool]
    http_status: Mapped[int | None]
    error_code: Mapped[str | None] = mapped_column(String(64))
    latency_ms: Mapped[int]
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    cached_tokens: Mapped[int | None]
    reasoning_tokens: Mapped[int | None]
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    audio_ms: Mapped[int | None]
    estimated_cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"))
    provider_response_id: Mapped[str | None] = mapped_column(String(128))
    report_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reports.id", ondelete="SET NULL"), index=True)
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("processing_jobs.id", ondelete="SET NULL"))

    __table_args__ = (Index("ix_model_calls_created", "created_at"),)


class RateLimitBucket(Base):
    """Fixed-window counters shared by all API processes."""

    __tablename__ = "rate_limit_buckets"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    count: Mapped[int] = mapped_column(Integer)
