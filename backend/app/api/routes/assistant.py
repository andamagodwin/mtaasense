"""The review assistant (reviewers) and Ask the map (public). Each answer streams as server-sent events:
`progress` lines while the tools run, then one `answer` (or `error`)."""

import json
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.dependencies import DB, Fingerprint, Reviewer
from app.core.config import get_settings
from app.schemas.api import AssistantRequest
from app.services import assistant, rate_limit

router = APIRouter(tags=["assistant"])


def _stream(events: Iterator[dict[str, Any]]) -> StreamingResponse:
    def body() -> Iterator[str]:
        for event in events:
            yield f"data: {json.dumps(event, default=str, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/assistant/review")
def review_assistant(db: DB, body: AssistantRequest, user: Reviewer) -> StreamingResponse:
    """Questions about the queue and the evidence. Proposed decisions come back for the reviewer to confirm."""
    rate_limit.hit(
        db, f"assistant:user:{user.id}", get_settings().assistant_reviewer_rate_limit_per_hour, timedelta(hours=1)
    )
    return _stream(assistant.answer("review", body))


@router.post("/assistant/map")
def map_assistant(db: DB, fp: Fingerprint, body: AssistantRequest) -> StreamingResponse:
    """Public questions about the map. Sees only what the public map shows."""
    settings = get_settings()
    rate_limit.hit(db, f"assistant:{fp}", settings.assistant_rate_limit_per_hour, timedelta(hours=1))
    rate_limit.hit(db, "assistant:global", settings.public_global_rate_limit_per_hour, timedelta(hours=1))
    if body.context is not None:
        # The public assistant only takes the map view and a selected incident as context.
        body.context = body.context.model_copy(update={"report_id": None, "suggestion_id": None})
    return _stream(assistant.answer("map", body))
