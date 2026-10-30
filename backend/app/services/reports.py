"""Report intake: validate, store evidence, persist, queue processing — in one short transaction."""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, ValidationFailed
from app.core.security import hash_token, new_reference, new_token
from app.db.models import AuditEvent, Media, ProcessingJob, Report
from app.db.models.enums import HazardCategory, JobKind, LocationSource, MediaKind, MediaVariant, ReportStatus
from app.services.geo import point, within_uganda
from app.services.jobs import enqueue
from app.services.lifecycle import refresh_category
from app.services.media import store_image


@dataclass(frozen=True)
class NewReport:
    image: bytes
    description: str
    voice_transcript: str | None
    reporter_category: HazardCategory | None
    lat: float | None
    lon: float | None
    location_source: LocationSource
    location_accuracy_m: float | None
    location_note: str | None
    audio_id: uuid.UUID | None
    audio_claim_token: str | None
    idempotency_key: str | None
    fingerprint: str | None
    is_sample: bool = False


def validate(new: NewReport) -> None:
    text = (new.description or "").strip()
    transcript = (new.voice_transcript or "").strip()
    if len(text) < 5 and len(transcript) < 5:
        raise ValidationFailed(
            "Add a short description (at least 5 characters) or a voice note.", code="description_required"
        )
    if len(text) > 2000 or len(transcript) > 4000:
        raise ValidationFailed("The description is too long.", code="description_too_long")
    has_coords = new.lat is not None and new.lon is not None
    if (new.lat is None) != (new.lon is None):
        raise ValidationFailed("Both latitude and longitude are required for a location.", code="invalid_location")
    if has_coords:
        assert new.lat is not None and new.lon is not None
        if not within_uganda(new.lat, new.lon):
            raise ValidationFailed("The location must be within Uganda.", code="location_out_of_area")
        if new.location_source == LocationSource.none:
            raise ValidationFailed("Say how the location was chosen.", code="invalid_location")
    elif new.location_source != LocationSource.none:
        raise ValidationFailed("A location source was given without coordinates.", code="invalid_location")
    if (new.audio_id is None) != (new.audio_claim_token is None):
        raise ValidationFailed("Voice note reference is incomplete.", code="invalid_audio_reference")


def existing_for_key(db: Session, key: str | None) -> Report | None:
    if not key:
        return None
    return db.scalar(select(Report).where(Report.idempotency_key == key))


def _claim_audio(db: Session, audio_id: uuid.UUID, token: str) -> Media:
    audio = db.get(Media, audio_id, with_for_update={"of": Media})
    if (
        audio is None
        or audio.kind != MediaKind.audio
        or audio.variant != MediaVariant.original
        or audio.report_id is not None
        or audio.claim_token_hash is None
        or audio.claim_token_hash != hash_token(token)
    ):
        raise ValidationFailed("That voice note can't be attached.", code="invalid_audio_reference")
    audio.claim_token_hash = None
    return audio


def create_report(db: Session, new: NewReport) -> tuple[Report, str, ProcessingJob]:
    validate(new)
    stored = store_image(db, new.image, fingerprint=new.fingerprint, is_sample=new.is_sample)
    receipt = new_token()
    report = Report(
        id=uuid.uuid4(),
        reference=new_reference("MS"),
        description=(new.description or "").strip(),
        voice_transcript=(new.voice_transcript or "").strip() or None,
        reporter_category=new.reporter_category,
        location=point(new.lat, new.lon) if new.lat is not None and new.lon is not None else None,
        location_source=new.location_source,
        location_accuracy_m=new.location_accuracy_m,
        location_note=(new.location_note or "").strip() or None,
        image_media_id=stored.original.id,
        display_media_id=stored.display.id,
        status=ReportStatus.submitted,
        is_sample=new.is_sample,
        idempotency_key=new.idempotency_key,
        receipt_token_hash=hash_token(receipt),
        submitter_fingerprint=new.fingerprint,
    )
    refresh_category(report)
    db.add(report)
    db.flush()
    stored.original.report_id = report.id
    stored.display.report_id = report.id
    if new.audio_id is not None and new.audio_claim_token is not None:
        audio = _claim_audio(db, new.audio_id, new.audio_claim_token)
        audio.report_id = report.id
        report.audio_media_id = audio.id
        report.voice_transcript_machine = audio.machine_transcript
        for child in db.scalars(select(Media).where(Media.parent_id == audio.id)):
            child.report_id = report.id
    db.add(
        AuditEvent(
            actor_label="resident",
            action="report_submitted",
            report_id=report.id,
            data={
                "has_location": report.location is not None,
                "has_audio": report.audio_media_id is not None,
                "reporter_category": new.reporter_category.value if new.reporter_category else None,
            },
        )
    )
    job = enqueue(db, JobKind.analyze_report, report.id, dedupe=f"analyze:{report.id}")
    try:
        db.flush()
    except IntegrityError as exc:
        raise Conflict("This report was already submitted.", code="duplicate_submission") from exc
    return report, receipt, job
