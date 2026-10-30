import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DB, Reviewer
from app.api.serializers import suggestion_view
from app.core.errors import NotFound
from app.db.models import DuplicateSuggestion, Report
from app.db.models.enums import SuggestionStatus
from app.schemas.api import DuplicateSuggestionView, Page, SuggestionDecision
from app.services import review
from app.services.lifecycle import REVIEWABLE

router = APIRouter(tags=["duplicates"])


@router.get("/duplicate-suggestions", response_model=Page[DuplicateSuggestionView])
def list_suggestions(
    db: DB,
    _: Reviewer,
    status_: Annotated[list[SuggestionStatus] | None, Query(alias="status")] = None,
    actionable: bool = True,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[DuplicateSuggestionView]:
    statuses = status_ or [SuggestionStatus.pending, SuggestionStatus.deferred]
    source = aliased(Report)
    stmt = (
        select(DuplicateSuggestion)
        .join(source, source.id == DuplicateSuggestion.source_report_id)
        .where(DuplicateSuggestion.status.in_(statuses))
    )
    if actionable:
        # Only pairs whose new report still awaits a decision.
        stmt = stmt.where(source.status.in_(REVIEWABLE))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        db.scalars(
            stmt.order_by(DuplicateSuggestion.score.desc(), DuplicateSuggestion.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .unique()
        .all()
    )
    return Page(items=[suggestion_view(db, s) for s in rows], total=total, limit=limit, offset=offset)


@router.get("/duplicate-suggestions/{suggestion_id}", response_model=DuplicateSuggestionView)
def get_suggestion(db: DB, suggestion_id: uuid.UUID, _: Reviewer) -> DuplicateSuggestionView:
    suggestion = db.get(DuplicateSuggestion, suggestion_id)
    if suggestion is None:
        raise NotFound("Suggestion not found.")
    return suggestion_view(db, suggestion)


@router.post("/duplicate-suggestions/{suggestion_id}/decision", response_model=DuplicateSuggestionView)
def decide(db: DB, suggestion_id: uuid.UUID, body: SuggestionDecision, user: Reviewer) -> DuplicateSuggestionView:
    suggestion = db.get(DuplicateSuggestion, suggestion_id, with_for_update={"of": DuplicateSuggestion})
    if suggestion is None:
        raise NotFound("Suggestion not found.")
    review.decide_suggestion(db, suggestion, user, body.decision, body.note)
    db.commit()
    db.refresh(suggestion)
    return suggestion_view(db, suggestion)
