"""Public map data, public stats, the reviewer dashboard summary and client config."""

from typing import Annotated, Any

from fastapi import APIRouter, Query
from sqlalchemy import ColumnElement, func, select

from app.api.dependencies import DB, Reviewer
from app.api.serializers import incident_summary, latlon
from app.core.config import get_settings
from app.db.models import DuplicateSuggestion, Incident, Report
from app.db.models.enums import HazardCategory, IncidentStatus, ReportStatus, SuggestionStatus
from app.schemas.api import AppConfig, MapFeatures, MapReport, PublicStats, ReviewSummary
from app.services.geo import UGANDA_BOUNDS
from app.services.lifecycle import REVIEWABLE
from app.services.segmentation import CONCEPTS

router = APIRouter(tags=["overview"])

# Unreviewed reports appear on the public map only as category + location, never photos or text.
_PUBLIC_REPORT_STATES = [
    ReportStatus.submitted,
    ReportStatus.processing,
    ReportStatus.under_review,
    ReportStatus.processing_failed,
]


@router.get("/map/features", response_model=MapFeatures)
def map_features(
    db: DB,
    category: Annotated[list[HazardCategory] | None, Query()] = None,
    status_: Annotated[list[IncidentStatus] | None, Query(alias="status")] = None,
    include_unreviewed: bool = True,
) -> MapFeatures:
    inc_conditions: list[ColumnElement[bool]] = []
    if category:
        inc_conditions.append(Incident.hazard_category.in_(category))
    if status_:
        inc_conditions.append(Incident.status.in_(status_))
    incidents = (
        db.scalars(
            select(Incident)
            .where(*inc_conditions, Incident.location.isnot(None))
            .order_by(Incident.updated_at.desc())
            .limit(1000)
        )
        .unique()
        .all()
    )
    unlocated_incidents = (
        db.scalar(select(func.count()).select_from(Incident).where(*inc_conditions, Incident.location.is_(None))) or 0
    )

    reports: list[MapReport] = []
    unlocated_reports = 0
    if include_unreviewed:
        rep_conditions = [Report.status.in_(_PUBLIC_REPORT_STATES), Report.incident_id.is_(None)]
        if category:
            rep_conditions.append(Report.hazard_category.in_(category))
        rows = db.execute(
            select(
                Report.id,
                Report.reference,
                Report.hazard_category,
                Report.status,
                Report.location,
                Report.created_at,
                Report.is_sample,
            )
            .where(*rep_conditions, Report.location.isnot(None))
            .order_by(Report.created_at.desc())
            .limit(1000)
        ).all()
        for r in rows:
            loc = latlon(r.location)
            if loc is not None:
                reports.append(
                    MapReport(
                        id=r.id,
                        reference=r.reference,
                        hazard_category=r.hazard_category,
                        status=r.status,
                        location=loc,
                        created_at=r.created_at,
                        is_sample=r.is_sample,
                    )
                )
        unlocated_reports = (
            db.scalar(select(func.count()).select_from(Report).where(*rep_conditions, Report.location.is_(None))) or 0
        )
    return MapFeatures(
        incidents=[incident_summary(i) for i in incidents],
        reports=reports,
        unlocated_incidents=unlocated_incidents,
        unlocated_reports=unlocated_reports,
    )


def _count(db: DB, model: type[Any], *conditions: ColumnElement[bool]) -> int:
    return db.scalar(select(func.count()).select_from(model).where(*conditions)) or 0


@router.get("/stats", response_model=PublicStats)
def public_stats(db: DB) -> PublicStats:
    return PublicStats(
        reports_total=_count(db, Report),
        incidents_confirmed=_count(db, Incident, Incident.status == IncidentStatus.confirmed),
        incidents_resolved=_count(db, Incident, Incident.status == IncidentStatus.resolved),
        reports_under_review=_count(db, Report, Report.status.in_(_PUBLIC_REPORT_STATES)),
        sample_records=_count(db, Report, Report.is_sample.is_(True)),
    )


@router.get("/review/summary", response_model=ReviewSummary)
def review_summary(db: DB, _: Reviewer) -> ReviewSummary:
    by_category = dict(
        db.execute(
            select(Report.hazard_category, func.count())
            .where(Report.status.in_(REVIEWABLE))
            .group_by(Report.hazard_category)
        ).all()
    )
    pending_pairs = (
        select(func.count())
        .select_from(DuplicateSuggestion)
        .join(Report, Report.id == DuplicateSuggestion.source_report_id)
        .where(
            DuplicateSuggestion.status.in_([SuggestionStatus.pending, SuggestionStatus.deferred]),
            Report.status.in_(REVIEWABLE),
        )
    )
    return ReviewSummary(
        reports_total=_count(db, Report),
        reports_awaiting_review=_count(db, Report, Report.status == ReportStatus.under_review),
        reports_processing=_count(db, Report, Report.status.in_([ReportStatus.submitted, ReportStatus.processing])),
        processing_failures=_count(db, Report, Report.status == ReportStatus.processing_failed),
        incidents_confirmed=_count(db, Incident, Incident.status == IncidentStatus.confirmed),
        incidents_resolved=_count(db, Incident, Incident.status == IncidentStatus.resolved),
        potential_duplicates=db.scalar(pending_pairs) or 0,
        unlocated_reports=_count(db, Report, Report.location.is_(None), Report.status != ReportStatus.rejected),
        sample_records=_count(db, Report, Report.is_sample.is_(True)),
        by_category={(k.value if k else "uncategorised"): v for k, v in by_category.items()},
    )


@router.get("/config", response_model=AppConfig)
def app_config() -> AppConfig:
    s = get_settings()
    return AppConfig(
        model_api_configured=s.model_api_configured,
        demo_fixtures_enabled=s.demo_fixtures_enabled,
        analysis_model=s.analysis_model,
        segmentation_model=s.segmentation_model,
        transcription_model=s.transcription_model,
        segmentation_concepts=list(CONCEPTS),
        categories=list(HazardCategory),
        max_image_mb=s.max_image_bytes // (1024 * 1024),
        max_audio_seconds=s.max_audio_seconds,
        map_bounds=UGANDA_BOUNDS,
    )
