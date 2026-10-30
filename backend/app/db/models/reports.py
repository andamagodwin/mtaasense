import uuid
from datetime import datetime
from typing import Any

from geoalchemy2 import Geography, WKBElement, WKTElement
from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPk, str_enum
from app.db.models.enums import (
    AnalysisStatus,
    HazardCategory,
    IncidentStatus,
    LocationSource,
    Priority,
    Provenance,
    ReportStatus,
    Severity,
)
from app.db.models.media import Media

# WGS 84 lon/lat, stored as geography so ST_DWithin distances are metres.
POINT = Geography(geometry_type="POINT", srid=4326, spatial_index=False)


class Report(UUIDPk, Timestamps, Base):
    """One resident observation. Original evidence is immutable once submitted."""

    __tablename__ = "reports"

    reference: Mapped[str] = mapped_column(String(16), unique=True)

    # --- Resident-provided facts (never overwritten by AI) ---
    description: Mapped[str] = mapped_column(Text, default="")
    voice_transcript: Mapped[str | None] = mapped_column(Text)
    voice_transcript_machine: Mapped[str | None] = mapped_column(Text)
    reporter_category: Mapped[HazardCategory | None] = mapped_column(str_enum(HazardCategory, "reporter_category"))
    location: Mapped[WKBElement | None] = mapped_column(POINT)
    location_source: Mapped[LocationSource] = mapped_column(
        str_enum(LocationSource, "location_source"), default=LocationSource.none
    )
    location_accuracy_m: Mapped[float | None] = mapped_column(Float)
    location_note: Mapped[str | None] = mapped_column(String(200))
    image_media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media.id", ondelete="RESTRICT"))
    display_media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media.id", ondelete="RESTRICT"))
    audio_media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))

    # --- Model-generated interpretation ---
    ai_category: Mapped[HazardCategory | None] = mapped_column(str_enum(HazardCategory, "ai_category"))
    analysis: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    analysis_status: Mapped[AnalysisStatus] = mapped_column(
        str_enum(AnalysisStatus, "analysis_status"), default=AnalysisStatus.pending
    )
    analysis_provenance: Mapped[Provenance | None] = mapped_column(str_enum(Provenance, "provenance"))
    analysis_model: Mapped[str | None] = mapped_column(String(64))
    analysis_error_code: Mapped[str | None] = mapped_column(String(64))
    analysis_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_severity: Mapped[Severity | None] = mapped_column(str_enum(Severity, "severity"))
    ai_priority: Mapped[Priority | None] = mapped_column(str_enum(Priority, "priority"))

    # --- Reviewer decisions ---
    reviewer_category: Mapped[HazardCategory | None] = mapped_column(str_enum(HazardCategory, "reviewer_category"))
    # Effective category = reviewer ?? reporter ?? AI. Denormalised for filtering/matching.
    hazard_category: Mapped[HazardCategory | None] = mapped_column(str_enum(HazardCategory, "hazard_category"))
    status: Mapped[ReportStatus] = mapped_column(
        str_enum(ReportStatus, "report_status"), default=ReportStatus.submitted
    )
    incident_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("incidents.id", ondelete="SET NULL"), index=True)

    # --- Provenance / abuse protection ---
    is_sample: Mapped[bool] = mapped_column(default=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), unique=True)
    receipt_token_hash: Mapped[str] = mapped_column(String(64))
    submitter_fingerprint: Mapped[str | None] = mapped_column(String(64), index=True)

    image: Mapped[Media] = relationship(foreign_keys=[image_media_id], lazy="joined")
    display_image: Mapped[Media] = relationship(foreign_keys=[display_media_id], lazy="joined")
    audio: Mapped[Media | None] = relationship(foreign_keys=[audio_media_id], lazy="joined")
    incident: Mapped["Incident | None"] = relationship(
        back_populates="reports", foreign_keys=[incident_id], lazy="selectin"
    )

    __table_args__ = (
        Index("ix_reports_location", "location", postgresql_using="gist"),
        Index("ix_reports_status_created", "status", "created_at"),
        Index("ix_reports_category_created", "hazard_category", "created_at"),
        # Trigram index for candidate retrieval by description similarity.
        Index(
            "ix_reports_description_trgm",
            "description",
            postgresql_using="gin",
            postgresql_ops={"description": "gin_trgm_ops"},
        ),
        CheckConstraint("(location IS NULL) = (location_source = 'none')", name="location_source_consistent"),
        CheckConstraint("length(description) <= 2000", name="description_length"),
    )


class Incident(UUIDPk, Timestamps, Base):
    """Canonical incident created by a reviewer; consolidates one or more reports."""

    __tablename__ = "incidents"

    reference: Mapped[str] = mapped_column(String(16), unique=True)
    title: Mapped[str] = mapped_column(String(160))
    summary: Mapped[str] = mapped_column(Text, default="")
    hazard_category: Mapped[HazardCategory] = mapped_column(str_enum(HazardCategory, "hazard_category"))
    # Loaded as WKB; assigned as WKT (copied from a report's point).
    location: Mapped[WKBElement | WKTElement | None] = mapped_column(POINT)
    status: Mapped[IncidentStatus] = mapped_column(
        str_enum(IncidentStatus, "incident_status"), default=IncidentStatus.confirmed
    )
    priority: Mapped[Priority] = mapped_column(str_enum(Priority, "priority"), default=Priority.routine)
    severity: Mapped[Severity] = mapped_column(str_enum(Severity, "severity"), default=Severity.undetermined)
    primary_report_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("reports.id", ondelete="SET NULL", use_alter=True)
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_note: Mapped[str | None] = mapped_column(Text)
    is_sample: Mapped[bool] = mapped_column(default=False)

    reports: Mapped[list[Report]] = relationship(
        back_populates="incident", foreign_keys=[Report.incident_id], lazy="selectin", order_by=Report.created_at
    )

    __table_args__ = (
        Index("ix_incidents_location", "location", postgresql_using="gist"),
        Index("ix_incidents_status_category", "status", "hazard_category"),
        CheckConstraint("(status = 'resolved') = (resolved_at IS NOT NULL)", name="resolved_at_consistent"),
    )
