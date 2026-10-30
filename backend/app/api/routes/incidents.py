import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import ColumnElement, func, select

from app.api.dependencies import DB, OptionalUser, Reviewer
from app.api.serializers import incident_detail, incident_summary
from app.core.errors import NotFound
from app.db.models import AuditEvent, Incident, ReviewNote
from app.db.models.enums import HazardCategory, IncidentStatus, Priority
from app.schemas.api import AuditView, IncidentDetail, IncidentSummary, IncidentUpdate, NoteCreate, NoteView, Page
from app.services import review

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
