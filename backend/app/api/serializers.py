"""ORM -> API views. Signed media URLs are only minted here, for callers already authorised."""

from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import sign_media
from app.db.models import DuplicateSuggestion, Incident, Media, ProcessingJob, Report, Segmentation
from app.db.models.enums import SuggestionStatus
from app.schemas.analysis import HazardAssessment
from app.schemas.api import (
    AnalysisView,
    DuplicateSuggestionView,
    IncidentBrief,
    IncidentDetail,
    IncidentSummary,
    JobView,
    LatLon,
    MediaRef,
    ReportDetail,
    ReportSummary,
    SegmentationView,
)
from app.services.geo import to_latlon
from app.services.lifecycle import REVIEWABLE

API_PREFIX = "/api/v1"
# Model-call metadata that is safe and useful to show reviewers.
_META_KEYS = (
    "model",
    "prompt_version",
    "created_at",
    "latency_ms",
    "input_tokens",
    "output_tokens",
    "response_id",
    "provenance",
    "reasoning_effort",
    "image_size_sent",
    "cached_from_response_id",
    "cached_from_created_at",
    "fixture_note",
    "live_error",
)


def _assessment(result: Any) -> HazardAssessment | None:
    """Stored model output from an older schema version is shown as unavailable rather than failing the request."""
    if not result:
        return None
    try:
        return HazardAssessment.model_validate(result)
    except ValidationError:
        return None


def media_ref(media: Media | None) -> MediaRef | None:
    if media is None:
        return None
    expires, sig = sign_media(media.id)
    return MediaRef(
        id=media.id,
        url=f"{API_PREFIX}/media/{media.id}?exp={expires}&sig={sig}",
        content_type=media.content_type,
        width=media.width,
        height=media.height,
        duration_ms=media.duration_ms,
        size_bytes=media.size_bytes,
    )


def latlon(value: Any) -> LatLon | None:
    decoded = to_latlon(value)
    return LatLon(lat=decoded[0], lon=decoded[1]) if decoded else None


def report_summary(report: Report, *, open_suggestions: int = 0, with_media: bool = True) -> ReportSummary:
    result = (report.analysis or {}).get("result") or {}
    incident = report.incident
    return ReportSummary(
        id=report.id,
        reference=report.reference,
        created_at=report.created_at,
        status=report.status,
        hazard_category=report.hazard_category,
        reporter_category=report.reporter_category,
        ai_category=report.ai_category,
        reviewer_category=report.reviewer_category,
        description=report.description,
        location=latlon(report.location),
        location_source=report.location_source,
        location_note=report.location_note,
        analysis_status=report.analysis_status,
        analysis_provenance=report.analysis_provenance,
        ai_summary=result.get("summary"),
        ai_severity=report.ai_severity,
        ai_priority=report.ai_priority,
        incident=IncidentBrief.model_validate(incident) if incident else None,
        is_sample=report.is_sample,
        has_audio=report.audio_media_id is not None,
        thumbnail=media_ref(report.display_image) if with_media else None,
        open_duplicate_suggestions=open_suggestions,
    )


def open_suggestion_counts(db: Session, report_ids: list[Any]) -> dict[Any, int]:
    if not report_ids:
        return {}
    rows = db.execute(
        select(DuplicateSuggestion.source_report_id, func.count())
        .where(
            DuplicateSuggestion.source_report_id.in_(report_ids),
            DuplicateSuggestion.status.in_([SuggestionStatus.pending, SuggestionStatus.deferred]),
        )
        .group_by(DuplicateSuggestion.source_report_id)
    ).all()
    return {r[0]: r[1] for r in rows}


def allowed_actions(report: Report) -> list[str]:
    actions: list[str] = []
    if report.status in REVIEWABLE:
        actions += ["confirm_incident", "reject"]
    if report.status.value == "rejected":
        actions.append("reopen")
    return actions


def report_detail(db: Session, report: Report, *, reviewer: bool) -> ReportDetail:
    summary = report_summary(report, open_suggestions=open_suggestion_counts(db, [report.id]).get(report.id, 0))
    analysis = report.analysis or {}
    result = analysis.get("result")
    meta = {k: v for k, v in (analysis.get("meta") or {}).items() if k in _META_KEYS} or None
    segs = db.scalars(
        select(Segmentation).where(Segmentation.report_id == report.id).order_by(Segmentation.created_at)
    ).all()
    jobs = (
        db.scalars(
            select(ProcessingJob)
            .where(ProcessingJob.report_id == report.id)
            .order_by(ProcessingJob.created_at.desc())
            .limit(10)
        ).all()
        if reviewer
        else []
    )
    image, original = media_ref(report.display_image), media_ref(report.image)
    assert image is not None and original is not None
    return ReportDetail(
        **summary.model_dump(),
        voice_transcript=report.voice_transcript,
        voice_transcript_machine=report.voice_transcript_machine if reviewer else None,
        location_accuracy_m=report.location_accuracy_m,
        image=image,
        original_image=original,
        audio=media_ref(report.audio),
        analysis=AnalysisView(
            status=report.analysis_status,
            provenance=report.analysis_provenance,
            model=report.analysis_model,
            completed_at=report.analysis_completed_at,
            error_code=report.analysis_error_code,
            result=_assessment(result),
            meta=meta,
        ),
        segmentations=[SegmentationView.model_validate(s) for s in segs],
        jobs=[JobView.model_validate(j) for j in jobs],
        allowed_actions=allowed_actions(report) if reviewer else [],
    )


def incident_summary(incident: Incident) -> IncidentSummary:
    return IncidentSummary(
        id=incident.id,
        reference=incident.reference,
        title=incident.title,
        hazard_category=incident.hazard_category,
        status=incident.status,
        priority=incident.priority,
        severity=incident.severity,
        location=latlon(incident.location),
        report_count=len(incident.reports),
        created_at=incident.created_at,
        updated_at=incident.updated_at,
        resolved_at=incident.resolved_at,
        is_sample=incident.is_sample,
    )


def incident_detail(db: Session, incident: Incident, *, reviewer: bool) -> IncidentDetail:
    reports = incident.reports
    counts = open_suggestion_counts(db, [r.id for r in reports]) if reviewer else {}
    return IncidentDetail(
        **incident_summary(incident).model_dump(),
        summary=incident.summary,
        resolution_note=incident.resolution_note,
        primary_report_id=incident.primary_report_id,
        reports=[report_summary(r, open_suggestions=counts.get(r.id, 0)) for r in reports] if reviewer else None,
        first_reported_at=min((r.created_at for r in reports), default=None),
        last_reported_at=max((r.created_at for r in reports), default=None),
    )


def suggestion_view(db: Session, s: DuplicateSuggestion) -> DuplicateSuggestionView:
    return DuplicateSuggestionView(
        id=s.id,
        status=s.status,
        score=s.score,
        signals=s.signals,
        model_verdict=s.model_verdict,
        model_assessment=s.model_assessment,
        model_provenance=s.model_provenance,
        decided_by=s.decided_by.display_name if s.decided_by else None,
        decided_at=s.decided_at,
        decision_note=s.decision_note,
        created_at=s.created_at,
        source=report_summary(s.source_report),
        candidate=report_summary(s.candidate_report),
    )
