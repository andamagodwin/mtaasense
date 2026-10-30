"""Reviewer decisions. Every change here is authorised by the caller and written to the audit log."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import InvalidTransition, ValidationFailed
from app.core.security import new_reference
from app.db.models import AuditEvent, DuplicateSuggestion, Incident, Report, ReviewNote, User
from app.db.models.enums import (
    HazardCategory,
    IncidentStatus,
    Priority,
    ReportStatus,
    Severity,
    SuggestionStatus,
)
from app.schemas.api import IncidentUpdate
from app.services.geo import copy_point
from app.services.lifecycle import REVIEWABLE, check_incident_transition, refresh_category, transition_report

CATEGORY_TITLES = {
    HazardCategory.pothole: "Pothole",
    HazardCategory.road_surface_damage: "Damaged road surface",
    HazardCategory.blocked_drainage: "Blocked drainage",
    HazardCategory.flooding: "Localized flooding",
}


def _audit(
    db: Session,
    actor: User,
    action: str,
    *,
    report: Report | None = None,
    incident: Incident | None = None,
    suggestion: DuplicateSuggestion | None = None,
    data: dict[str, Any] | None = None,
    note: str | None = None,
) -> None:
    db.add(
        AuditEvent(
            actor_user_id=actor.id,
            actor_label=f"{actor.display_name} ({actor.role.value})",
            action=action,
            report_id=report.id if report else None,
            incident_id=incident.id if incident else None,
            suggestion_id=suggestion.id if suggestion else None,
            data=data or {},
            note=note,
        )
    )


def _default_title(report: Report) -> str:
    assert report.hazard_category is not None
    base = CATEGORY_TITLES[report.hazard_category]
    return f"{base} — {report.location_note}"[:160] if report.location_note else base


def create_incident_from(
    db: Session, report: Report, actor: User, *, title: str | None = None, priority: Priority | None = None
) -> Incident:
    if report.hazard_category is None:
        raise ValidationFailed("Set a hazard category before confirming this report.", code="category_required")
    result = (report.analysis or {}).get("result") or {}
    incident = Incident(
        reference=new_reference("INC"),
        title=title or _default_title(report),
        summary=result.get("summary") or report.description[:400],
        hazard_category=report.hazard_category,
        location=copy_point(report.location),
        status=IncidentStatus.confirmed,
        priority=priority or report.ai_priority or Priority.routine,
        severity=report.ai_severity or Severity.undetermined,
        primary_report_id=report.id,
        created_by_id=actor.id,
        is_sample=report.is_sample,
    )
    db.add(incident)
    db.flush()
    transition_report(report, ReportStatus.confirmed)
    report.incident_id = incident.id
    _audit(
        db,
        actor,
        "incident_created",
        report=report,
        incident=incident,
        data={"title": incident.title, "category": incident.hazard_category.value, "priority": incident.priority.value},
    )
    return incident


def review_report(
    db: Session,
    report: Report,
    actor: User,
    action: str,
    *,
    title: str | None = None,
    priority: Priority | None = None,
    note: str | None = None,
) -> Report:
    before = report.status.value
    if action == "confirm_incident":
        if report.status not in REVIEWABLE:
            raise InvalidTransition("Only reports awaiting review can be confirmed.")
        create_incident_from(db, report, actor, title=title, priority=priority)
    elif action == "reject":
        if report.status not in REVIEWABLE:
            raise InvalidTransition("Only reports awaiting review can be rejected.")
        transition_report(report, ReportStatus.rejected)
    elif action == "reopen":
        transition_report(report, ReportStatus.under_review)
    _audit(db, actor, f"report_{action}", report=report, data={"from": before, "to": report.status.value}, note=note)
    return report


def correct_category(db: Session, report: Report, actor: User, category: HazardCategory, note: str | None) -> None:
    before = report.hazard_category.value if report.hazard_category else None
    report.reviewer_category = category
    refresh_category(report)
    _audit(
        db,
        actor,
        "category_corrected",
        report=report,
        data={
            "from": before,
            "to": category.value,
            "ai_category": report.ai_category.value if report.ai_category else None,
        },
        note=note,
    )


def decide_suggestion(
    db: Session, suggestion: DuplicateSuggestion, actor: User, decision: str, note: str | None
) -> DuplicateSuggestion:
    if suggestion.status in (SuggestionStatus.confirmed, SuggestionStatus.rejected):
        raise InvalidTransition("This suggestion has already been decided.")
    source = db.get(Report, suggestion.source_report_id, with_for_update={"of": Report})
    candidate = db.get(Report, suggestion.candidate_report_id, with_for_update={"of": Report})
    assert source is not None and candidate is not None

    if decision == "confirm":
        if source.status not in REVIEWABLE:
            raise InvalidTransition("The new report is no longer awaiting review.")
        if candidate.status == ReportStatus.rejected:
            raise InvalidTransition("The candidate report was rejected and cannot anchor an incident.")
        incident = db.get(Incident, candidate.incident_id) if candidate.incident_id else None
        if incident is None:
            # The candidate had not been confirmed yet: confirming the pair confirms it too.
            if candidate.status not in REVIEWABLE:
                raise InvalidTransition("The candidate report cannot be confirmed in its current state.")
            incident = create_incident_from(db, candidate, actor)
        transition_report(source, ReportStatus.duplicate)
        source.incident_id = incident.id
        if incident.location is None and source.location is not None:
            incident.location = copy_point(source.location)
        if source.reviewer_category is None and source.hazard_category != incident.hazard_category:
            source.reviewer_category = incident.hazard_category
            refresh_category(source)
        if incident.status == IncidentStatus.resolved:
            # A fresh report of a resolved incident; keep it linked but flag it for the reviewer.
            note = ((note or "") + " [linked to a resolved incident]").strip()
        suggestion.status = SuggestionStatus.confirmed
        _audit(
            db,
            actor,
            "duplicate_confirmed",
            report=source,
            incident=incident,
            suggestion=suggestion,
            data={
                "candidate_report": candidate.reference,
                "incident": incident.reference,
                "score": suggestion.score,
                "model_verdict": suggestion.model_verdict.value if suggestion.model_verdict else None,
            },
            note=note,
        )
    elif decision == "reject":
        suggestion.status = SuggestionStatus.rejected
        _audit(
            db,
            actor,
            "duplicate_rejected",
            report=source,
            suggestion=suggestion,
            data={"candidate_report": candidate.reference, "score": suggestion.score},
            note=note,
        )
    else:
        suggestion.status = SuggestionStatus.deferred
        _audit(
            db,
            actor,
            "duplicate_deferred",
            report=source,
            suggestion=suggestion,
            data={"candidate_report": candidate.reference},
            note=note,
        )

    suggestion.decided_by_id = actor.id
    suggestion.decided_at = datetime.now(UTC)
    suggestion.decision_note = note
    return suggestion


def update_incident(db: Session, incident: Incident, actor: User, change: IncidentUpdate) -> Incident:
    diff: dict[str, Any] = {}
    for field in ("title", "summary", "priority", "severity", "hazard_category"):
        value = getattr(change, field)
        if value is not None and value != getattr(incident, field):
            diff[field] = {"from": _plain(getattr(incident, field)), "to": _plain(value)}
            setattr(incident, field, value)

    if change.status is not None and change.status != incident.status:
        check_incident_transition(incident.status, change.status)
        if change.status == IncidentStatus.resolved:
            if not (change.resolution_note and change.resolution_note.strip()):
                raise ValidationFailed("Describe how the resolution was confirmed.", code="resolution_note_required")
            incident.resolved_at = datetime.now(UTC)
            incident.resolution_note = change.resolution_note.strip()
            for report in incident.reports:
                if report.status in (ReportStatus.confirmed, ReportStatus.duplicate):
                    transition_report(report, ReportStatus.resolved)
        else:
            incident.resolved_at = None
            for report in incident.reports:
                if report.status == ReportStatus.resolved:
                    is_primary = report.id == incident.primary_report_id
                    transition_report(report, ReportStatus.confirmed if is_primary else ReportStatus.duplicate)
        diff["status"] = {"from": incident.status.value, "to": change.status.value}
        incident.status = change.status

    if not diff and not change.note:
        return incident
    action = (
        "incident_resolved"
        if diff.get("status", {}).get("to") == "resolved"
        else ("incident_reopened" if "status" in diff else "incident_updated")
    )
    _audit(db, actor, action, incident=incident, data=diff, note=change.note or change.resolution_note)
    return incident


def add_note(
    db: Session, actor: User, body: str, *, report: Report | None = None, incident: Incident | None = None
) -> ReviewNote:
    note = ReviewNote(
        author_id=actor.id,
        report_id=report.id if report else None,
        incident_id=incident.id if incident else None,
        body=body.strip(),
    )
    db.add(note)
    _audit(db, actor, "note_added", report=report, incident=incident)
    return note


def _plain(value: Any) -> Any:
    return getattr(value, "value", value)


def open_suggestion_count(db: Session, report_id: Any) -> int:
    return len(
        db.scalars(
            select(DuplicateSuggestion.id).where(
                DuplicateSuggestion.source_report_id == report_id,
                DuplicateSuggestion.status.in_([SuggestionStatus.pending, SuggestionStatus.deferred]),
            )
        ).all()
    )
