"""Muse Voice Transcribe for optional voice notes.

The resident records or uploads a short note, sees the machine transcript, edits it, and
submits the corrected text with the report. The machine transcript is kept server-side.
"""

import logging
import uuid
from dataclasses import dataclass

from app.core.config import get_settings
from app.core.logging import log_event
from app.core.security import hash_token, new_token
from app.db.models import Media
from app.db.models.enums import ModelOperation
from app.db.session import session_scope
from app.services.media import store_audio, wav_for
from app.services.media_storage import get_storage
from app.services.meta_client import CallContext, ModelAPIError, get_meta_client

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TranscriptionOutcome:
    media_id: uuid.UUID
    claim_token: str | None
    duration_ms: int
    transcript: str | None
    error_code: str | None


def _transcribe_wav(wav: Media, report_id: uuid.UUID | None) -> tuple[str | None, str | None]:
    client = get_meta_client()
    if not client.configured:
        return None, "not_configured"
    data = get_storage().get(wav.storage_key)
    try:
        body, _ = client.transcribe(
            CallContext(ModelOperation.transcription, report_id=report_id),
            data,
            model=get_settings().transcription_model,
            audio_ms=wav.duration_ms or 0,
        )
    except ModelAPIError as exc:
        return None, exc.code
    transcript = body.get("transcript")
    if not isinstance(transcript, str):
        return None, "malformed_response"
    return transcript.strip(), None


def transcribe_draft(data: bytes, fingerprint: str | None) -> TranscriptionOutcome:
    claim_token = new_token()
    with session_scope() as db:
        stored = store_audio(db, data, fingerprint=fingerprint)
        stored.original.claim_token_hash = hash_token(claim_token)
        original_id, wav = stored.original.id, stored.wav
        duration = stored.original.duration_ms or 0

    transcript, error = _transcribe_wav(wav, None)
    if transcript is not None:
        with session_scope() as db:
            media = db.get(Media, original_id)
            assert media is not None
            media.machine_transcript = transcript
    log_event(logger, "transcription", ok=error is None, code=error, duration_ms=duration)
    return TranscriptionOutcome(original_id, claim_token, duration, transcript, error)


def retranscribe(audio_id: uuid.UUID, report_id: uuid.UUID) -> TranscriptionOutcome:
    """Reviewer-triggered re-run for a report's attached voice note."""
    with session_scope() as db:
        audio = db.get(Media, audio_id)
        assert audio is not None
        wav = wav_for(db, audio)
        duration = audio.duration_ms or 0
    if wav is None:
        return TranscriptionOutcome(audio_id, None, duration, None, "wav_missing")
    transcript, error = _transcribe_wav(wav, report_id)
    if transcript is not None:
        with session_scope() as db:
            media = db.get(Media, audio_id)
            assert media is not None
            media.machine_transcript = transcript
    return TranscriptionOutcome(audio_id, None, duration, transcript, error)
