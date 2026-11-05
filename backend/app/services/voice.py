"""Hands-free voice for Elvis.

The browser streams the reviewer's microphone here and we relay it to Muse Voice Transcribe's realtime API,
because the browser can't hold the Model API key. Meta's ENDPOINTING mode decides where each spoken turn ends;
each finished turn goes back to the browser as an `utterance`, which it asks Elvis like a typed question.
Elvis's answer is read aloud by the browser's own speech synthesis.

From the browser: binary frames of 16-bit little-endian mono PCM at 24 kHz, 80 ms each, in real time. The
transcriber rejects audio that falls behind real time, so the browser keeps sending (silence while Elvis is
thinking or speaking). A text frame {"type": "stop"} ends the session.

To the browser (JSON text frames), then the socket closes:
    {"type": "ready"}                            listening
    {"type": "partial", "text": "..."}           what has been heard so far in this turn
    {"type": "utterance", "text": "..."}         a finished turn
    {"type": "ended", "reason": "idle" | "time_limit" | "stopped"}
    {"type": "error", "code": "...", "message": "..."}
"""

import asyncio
import contextlib
import json
import logging
import time
from typing import Any, Protocol

import websockets
from fastapi import WebSocket
from starlette.websockets import WebSocketState

from app.core.config import get_settings
from app.core.logging import log_event
from app.db.models.enums import ModelOperation
from app.services import pricing
from app.services.usage_tracking import BudgetExhausted, CallRecord, ensure_budget, record_call

logger = logging.getLogger(__name__)

FRAME_BYTES = 3840  # 80 ms of 16-bit mono PCM at 24 kHz
BYTES_PER_MS = 48
_MAX_FRAME_BYTES = FRAME_BYTES * 4

# Words a reviewer is likely to say that a general model may not expect.
KEYWORDS = [
    "MtaaSense", "Elvis", "pothole", "potholes", "blocked drain", "drainage", "incident", "duplicate", "KCCA",
    "Kampala", "Bombo Road", "Kalerwe", "Nakawa", "Ntinda", "Wandegeya", "Kawempe", "Makindye", "Rubaga",
    "Kireka", "Kansanga", "Mukono", "Entebbe",
]  # fmt: skip

MESSAGES = {
    "not_configured": "Voice needs the Meta Model API, which isn't set up on this server.",
    "budget_exhausted": "Voice has used today's AI budget. Type your question instead.",
    "rate_limited": "Voice is busy right now. Try again in a minute, or type your question.",
    "transcriber_unavailable": "Voice isn't available right now. Try again in a minute, or type your question.",
    "transcriber_error": "Voice stopped working. Turn it on again, or type your question.",
}


class Transcriber(Protocol):
    async def send(self, message: str | bytes) -> None: ...
    async def recv(self) -> str | bytes: ...
    def __aiter__(self) -> Any: ...
    async def close(self) -> None: ...


async def open_transcriber() -> Transcriber:
    """Connect to Muse Voice Transcribe's realtime endpoint. Replaced in tests."""
    return await websockets.connect(get_settings().voice_realtime_url, max_size=2**20, open_timeout=10)


class _Failed(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def refuse(ws: WebSocket, code: str, message: str) -> None:
    """Tell the browser why, then close. The socket must already be accepted."""
    with contextlib.suppress(Exception):
        await ws.send_json({"type": "error", "code": code, "message": message})
        await ws.close(code=1000)


def _handshake() -> dict[str, Any]:
    settings = get_settings()
    key = settings.model_api_key.get_secret_value() if settings.model_api_key else ""
    return {
        "authorization": {"accessToken": f"Bearer {key}"},
        "audioEncoding": "PCM_24KHZ",
        "model": settings.transcription_model,
        "mode": "ENDPOINTING",
        "partialMode": "CUMULATIVE",
        "emitAudioProgress": False,
        "languageBias": ["English"],
        "keywords": KEYWORDS,
    }


def _close_code(exc: BaseException) -> str:
    if isinstance(exc, websockets.ConnectionClosed) and exc.rcvd is not None and exc.rcvd.code == 1013:
        return "rate_limited"
    return "transcriber_error"


async def relay(ws: WebSocket) -> None:
    """Run one voice session on an accepted socket from a signed-in reviewer, until either side ends it."""
    settings = get_settings()
    if not settings.model_api_configured:
        await refuse(ws, "not_configured", MESSAGES["not_configured"])
        return
    try:
        await asyncio.to_thread(ensure_budget)
    except BudgetExhausted:
        await refuse(ws, "budget_exhausted", MESSAGES["budget_exhausted"])
        return

    started = time.monotonic()
    audio_bytes = 0
    utterances = 0
    session_id: str | None = None
    error: str | None = None
    ended = "disconnect"
    meta: Transcriber | None = None
    try:
        try:
            meta = await open_transcriber()
            await meta.send(json.dumps(_handshake()))
            ack = json.loads(await asyncio.wait_for(meta.recv(), 10))
        except (OSError, TimeoutError, websockets.WebSocketException, json.JSONDecodeError) as exc:
            raise _Failed("transcriber_unavailable") from exc
        session_id = ack.get("sessionId") if isinstance(ack, dict) else None
        if not session_id:
            raise _Failed("transcriber_unavailable")
        await ws.send_json({"type": "ready"})
        last_heard = time.monotonic()
        transcriber = meta

        async def from_browser() -> str:
            nonlocal audio_bytes
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    return "disconnect"
                data = message.get("bytes")
                if data is not None:
                    if 0 < len(data) <= _MAX_FRAME_BYTES and len(data) % 2 == 0:
                        audio_bytes += len(data)
                        await transcriber.send(data)
                elif message.get("text"):
                    with contextlib.suppress(ValueError, AttributeError):
                        if json.loads(message["text"]).get("type") == "stop":
                            return "stopped"
                now = time.monotonic()
                if now - started > settings.voice_max_session_seconds:
                    return "time_limit"
                if now - last_heard > settings.voice_idle_seconds:
                    return "idle"

        async def from_transcriber() -> str:
            nonlocal last_heard, utterances
            async for raw in transcriber:
                if isinstance(raw, bytes):
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                kind = event.get("type")
                text = (event.get("transcript") or "").strip() if isinstance(event.get("transcript"), str) else ""
                if kind == "speechStart":
                    last_heard = time.monotonic()
                elif kind == "transcript" and not event.get("final") and text:
                    last_heard = time.monotonic()
                    await ws.send_json({"type": "partial", "text": text})
                elif kind == "speechComplete" and text:
                    last_heard = time.monotonic()
                    utterances += 1
                    await ws.send_json({"type": "utterance", "text": text[:1000]})
                elif kind == "error":
                    log_event(
                        logger, "voice_transcriber_error", logging.WARNING, code=event.get("errorCode"),
                        message=str(event.get("message"))[:200],
                    )  # fmt: skip
                    raise _Failed("transcriber_error")
            return "transcriber_closed"

        browser = asyncio.create_task(from_browser())
        listener = asyncio.create_task(from_transcriber())
        try:
            done, _ = await asyncio.wait({browser, listener}, return_when=asyncio.FIRST_COMPLETED)
            if browser in done:
                ended = browser.result()
                # Let the transcriber finish the turn in progress before closing.
                with contextlib.suppress(Exception):
                    await meta.send(json.dumps({"type": "endStream"}))
                if ended != "disconnect":
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(asyncio.shield(listener), 5)
            else:
                ended = listener.result()
        finally:
            for task in (browser, listener):
                task.cancel()
            await asyncio.gather(browser, listener, return_exceptions=True)
        if ended in ("idle", "time_limit", "stopped", "transcriber_closed"):
            with contextlib.suppress(Exception):
                await ws.send_json({"type": "ended", "reason": ended})
    except _Failed as exc:
        error = exc.code
    except websockets.ConnectionClosed as exc:
        error = _close_code(exc)
    finally:
        if meta is not None:
            with contextlib.suppress(Exception):
                await meta.close()
        # Record usage before closing, so a closed socket means the session is fully accounted for.
        audio_ms = audio_bytes // BYTES_PER_MS
        duration_ms = int((time.monotonic() - started) * 1000)
        if session_id or error:
            await asyncio.to_thread(
                record_call,
                CallRecord(
                    operation=ModelOperation.voice_assistant,
                    model=settings.transcription_model,
                    endpoint="asr/realtime",
                    success=error is None,
                    error_code=error,
                    latency_ms=duration_ms,
                    audio_ms=audio_ms,
                    estimated_cost_usd=pricing.transcription_cost(audio_ms),
                    provider_response_id=session_id[:128] if session_id else None,
                ),
            )
        if error:
            await refuse(ws, error, MESSAGES[error])
        elif ws.application_state != WebSocketState.DISCONNECTED:
            with contextlib.suppress(Exception):
                await ws.close(code=1000)
        log_event(
            logger, "voice_session", ok=error is None, code=error, ended=ended, audio_ms=audio_ms,
            utterances=utterances, duration_ms=duration_ms,
        )  # fmt: skip
