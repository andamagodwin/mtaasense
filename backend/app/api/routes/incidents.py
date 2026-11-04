import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, UploadFile, status
from sqlalchemy import ColumnElement, func, select

from app.api.dependencies import DB, Fingerprint, OptionalUser, Reviewer
from app.api.routes.reports import read_limited
from app.api.serializers import fix_check_view, incident_detail, incident_summary
from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.db.models import AuditEvent, Incident, Report, ReviewNote
from app.db.models.enums import HazardCategory, IncidentStatus, Priority
from app.schemas.api import (
    AuditView,
    FixCheckView,
    IncidentDetail,
    IncidentSummary,
    IncidentUpdate,
    NoteCreate,
    NoteView,
    Page,
)
from app.services import review
from app.services.fix_verification import create_fix_check

router = APIRouter(tags=["incidents"])


@router.get("/incidents", response_model=Page[IncidentSummary])
def list_incidents(
    db: DB,
    status_: Annotated[list[IncidentStatus] | None, Query(alias="status")] = None,
    category: Annotated[list[HazardCategory] | None, Query()] = None,
    priority: Priority | None = None,
    has_location: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[IncidentSummary]:
    conditions: list[ColumnElement[bool]] = []
    if status_:
        conditions.append(Incident.status.in_(status_))
    if category:
        conditions.append(Incident.hazard_category.in_(category))
    if priority:
        conditions.append(Incident.priority == priority)
    if has_location is not None:
        conditions.append(Incident.location.isnot(None) if has_location else Incident.location.is_(None))
    total = db.scalar(select(func.count()).select_from(Incident).where(*conditions)) or 0
    rows = (
        db.scalars(select(Incident).where(*conditions).order_by(Incident.updated_at.desc()).limit(limit).offset(offset))
        .unique()
        .all()
    )
    return Page(items=[incident_summary(i) for i in rows], total=total, limit=limit, offset=offset)


@router.get("/incidents/{incident_id}", response_model=IncidentDetail)
def get_incident(db: DB, incident_id: uuid.UUID, user: OptionalUser) -> IncidentDetail:
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise NotFound("Incident not found.")
    # The public sees the canonical record; reviewers also see the linked reports and their evidence.
    return incident_detail(db, incident, reviewer=user is not None)


@router.patch("/incidents/{incident_id}", response_model=IncidentDetail)
def patch_incident(db: DB, incident_id: uuid.UUID, body: IncidentUpdate, user: Reviewer) -> IncidentDetail:
    incident = db.get(Incident, incident_id, with_for_update={"of": Incident})
    if incident is None:
        raise NotFound("Incident not found.")
    review.update_incident(db, incident, user, body)
    db.commit()
    db.refresh(incident)
    return incident_detail(db, incident, reviewer=True)


@router.post("/incidents/{incident_id}/fix-checks", response_model=FixCheckView, status_code=status.HTTP_202_ACCEPTED)
async def check_incident_fix(
    db: DB,
    fp: Fingerprint,
    incident_id: uuid.UUID,
    user: Reviewer,
    image: Annotated[UploadFile, File(description="A recent photo of the same spot")],
    note: Annotated[str | None, Form(max_length=500)] = None,
    before_report_id: Annotated[uuid.UUID | None, Form()] = None,
) -> FixCheckView:
    """Compare a recent photo with a report's original photo. Advisory: resolving stays a reviewer decision."""
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise NotFound("Incident not found.")
    # Compare with the incident's primary report unless the reviewer picks another linked report.
    before_id = before_report_id or incident.primary_report_id
    before = db.get(Report, before_id) if before_id else None
    if before is None or before.incident_id != incident.id:
        raise ValidationFailed("Choose a report linked to this incident to compare with.", code="invalid_before_report")
    data = await read_limited(image, get_settings().max_image_bytes, "photo")
    check, _ = create_fix_check(db, incident, data, before=before, fingerprint=fp, user=user, note=note)
    db.commit()
    db.refresh(check)
    return fix_check_view(db, check, reviewer=True)


@router.get("/incidents/{incident_id}/notes", response_model=list[NoteView])
def incident_notes(db: DB, incident_id: uuid.UUID, _: Reviewer) -> list[NoteView]:
    rows = db.scalars(
        select(ReviewNote).where(ReviewNote.incident_id == incident_id).order_by(ReviewNote.created_at)
    ).all()
    return [
        NoteView(id=n.id, created_at=n.created_at, author=n.author.display_name if n.author else None, body=n.body)
        for n in rows
    ]


@router.post("/incidents/{incident_id}/notes", response_model=NoteView, status_code=status.HTTP_201_CREATED)
def add_incident_note(db: DB, incident_id: uuid.UUID, body: NoteCreate, user: Reviewer) -> NoteView:
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise NotFound("Incident not found.")
    note = review.add_note(db, user, body.body, incident=incident)
    db.commit()
    return NoteView(id=note.id, created_at=note.created_at, author=user.display_name, body=note.body)


@router.get("/incidents/{incident_id}/audit", response_model=list[AuditView])
def incident_audit(db: DB, incident_id: uuid.UUID, _: Reviewer) -> list[AuditView]:
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise NotFound("Incident not found.")
    report_ids = [r.id for r in incident.reports]
    rows = db.scalars(
        select(AuditEvent)
        .where((AuditEvent.incident_id == incident_id) | AuditEvent.report_id.in_(report_ids))
        .order_by(AuditEvent.created_at)
    ).all()
    return [AuditView.model_validate(e) for e in rows]
