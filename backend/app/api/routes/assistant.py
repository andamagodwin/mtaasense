"""The review assistant (reviewers) and Ask the map (public). Each answer streams as server-sent events:
`progress` lines while the tools run, then one `answer` (or `error`). Reviewers can also talk to Elvis
hands-free over a WebSocket that relays their microphone to the transcriber."""

import asyncio
import json
import logging
import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, WebSocket
from fastapi.responses import StreamingResponse

from app.api.dependencies import DB, Fingerprint, Reviewer, is_reviewer, user_for_token
from app.core.config import get_settings
from app.core.errors import RateLimited
from app.db.session import session_scope
from app.schemas.api import AssistantRequest
from app.services import assistant, rate_limit, voice

logger = logging.getLogger(__name__)

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


@router.post("/assistant/site")
def site_assistant(db: DB, fp: Fingerprint, body: AssistantRequest) -> StreamingResponse:
    """Public questions about MtaaSense on the website. Sees only what the public map shows."""
    settings = get_settings()
    rate_limit.hit(db, f"assistant:site:{fp}", settings.assistant_rate_limit_per_hour, timedelta(hours=1))
    rate_limit.hit(db, "assistant:global", settings.public_global_rate_limit_per_hour, timedelta(hours=1))
    body.context = None
    body.voice = False
    return _stream(assistant.answer("site", body))


def _voice_access(token: str | None) -> tuple[uuid.UUID | None, str | None]:
    """The reviewer behind this session cookie and whether they may start a voice session."""
    settings = get_settings()
    with session_scope() as db:
        user = user_for_token(db, token)
        if user is None:
            return None, "unauthorized"
        if not is_reviewer(user):
            return None, "forbidden"
        try:
            rate_limit.hit(db, f"voice:user:{user.id}", settings.voice_sessions_per_hour, timedelta(hours=1))
        except RateLimited:
            return user.id, "rate_limited"
        return user.id, None


_REFUSALS = {
    "origin_not_allowed": "This page isn't allowed to use voice.",
    "unauthorized": "Sign in as a reviewer to talk to Elvis.",
    "forbidden": "Reviewer access is required.",
    "rate_limited": "You've started a lot of voice sessions this hour. Type your question, or try again later.",
}


@router.websocket("/assistant/voice")
async def voice_session(ws: WebSocket) -> None:
    """Hands-free Elvis: microphone audio in, what the reviewer said out. See app.services.voice."""
    settings = get_settings()
    origin = ws.headers.get("origin")
    await ws.accept()
    # Browsers always send Origin on a WebSocket handshake, so a cookie can't be ridden from another site.
    if origin is not None and origin not in settings.cors_origins:
        await voice.refuse(ws, "origin_not_allowed", _REFUSALS["origin_not_allowed"])
        return
    _, problem = await asyncio.to_thread(_voice_access, ws.cookies.get(settings.session_cookie_name))
    if problem:
        await voice.refuse(ws, problem, _REFUSALS[problem])
        return
    try:
        await voice.relay(ws)
    except Exception:
        logger.exception("voice session failed")
        await voice.refuse(ws, "transcriber_error", voice.MESSAGES["transcriber_error"])
