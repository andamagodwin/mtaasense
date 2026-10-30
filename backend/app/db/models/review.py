import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPk, str_enum, utcnow
from app.db.models.enums import ModelVerdict, Provenance, SegmentationStatus, SuggestionStatus
from app.db.models.reports import Report
from app.db.models.users import User


class DuplicateSuggestion(UUIDPk, Timestamps, Base):
    """A machine-generated hypothesis that two reports describe the same incident.

    Never acted on automatically: only a reviewer decision links reports.
    """

    __tablename__ = "duplicate_suggestions"

    source_report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    candidate_report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    # Deterministic retrieval score in [0, 1]; see services/duplicate_matching.py.
    score: Mapped[float] = mapped_column(Float)
    # Signals actually computed: distance, time gap, category, text similarity.
    signals: Mapped[dict[str, Any]] = mapped_column(JSONB)
    model_verdict: Mapped[ModelVerdict | None] = mapped_column(str_enum(ModelVerdict, "model_verdict"))
    model_assessment: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    model_provenance: Mapped[Provenance | None] = mapped_column(str_enum(Provenance, "provenance"))
    status: Mapped[SuggestionStatus] = mapped_column(
        str_enum(SuggestionStatus, "suggestion_status"), default=SuggestionStatus.pending
    )
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)

    source_report: Mapped[Report] = relationship(foreign_keys=[source_report_id], lazy="joined")
    candidate_report: Mapped[Report] = relationship(foreign_keys=[candidate_report_id], lazy="joined")
    decided_by: Mapped[User | None] = relationship(lazy="joined")

    __table_args__ = (
        UniqueConstraint("source_report_id", "candidate_report_id", name="uq_duplicate_pair"),
        CheckConstraint("source_report_id <> candidate_report_id", name="not_self"),
        CheckConstraint("score >= 0 AND score <= 1", name="score_range"),
        Index("ix_duplicate_suggestions_status", "status"),
    )


class Segmentation(UUIDPk, Timestamps, Base):
    """SAM 3.1 output for one (image, concept prompt). Cached by that pair."""

    __tablename__ = "segmentations"

    report_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media.id", ondelete="CASCADE"))
    prompt: Mapped[str] = mapped_column(String(64))
    status: Mapped[SegmentationStatus] = mapped_column(
        str_enum(SegmentationStatus, "segmentation_status"), default=SegmentationStatus.queued
    )
    # [{object_id, box: {left, top, right, bottom}, confidence, mask: {width, height, svg_path, area_px}}]
    regions: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    image_width: Mapped[int | None]
    image_height: Mapped[int | None]
    model: Mapped[str | None] = mapped_column(String(64))
    provenance: Mapped[Provenance | None] = mapped_column(str_enum(Provenance, "provenance"))
    error_code: Mapped[str | None] = mapped_column(String(64))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (UniqueConstraint("media_id", "prompt", name="uq_segmentation_media_prompt"),)


class ReviewNote(UUIDPk, Base):
    __tablename__ = "review_notes"

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    report_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    incident_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)

    author: Mapped[User | None] = relationship(lazy="joined")

    __table_args__ = (
        CheckConstraint("(report_id IS NULL) <> (incident_id IS NULL)", name="one_target"),
        CheckConstraint("length(body) BETWEEN 1 AND 4000", name="body_length"),
    )


class AuditEvent(UUIDPk, Base):
    """Append-only record of reviewer/admin/system decisions."""

    __tablename__ = "audit_events"

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(64))
    report_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reports.id", ondelete="SET NULL"), index=True)
    incident_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("incidents.id", ondelete="SET NULL"), index=True)
    suggestion_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("duplicate_suggestions.id", ondelete="SET NULL"))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    note: Mapped[str | None] = mapped_column(Text)
