import hmac
import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, Query, Response, UploadFile, status
from sqlalchemy import ColumnElement, func, or_, select

from app.api.dependencies import DB, Fingerprint, OptionalUser, Reviewer
from app.api.serializers import open_suggestion_counts, report_detail, report_summary, suggestion_view
from app.core.config import get_settings
from app.core.errors import Forbidden, NotFound, PayloadTooLarge, ValidationFailed
from app.core.security import derive_token, hash_token
from app.db.models import AuditEvent, DuplicateSuggestion, ProcessingJob, Report, ReviewNote, User
from app.db.models.enums import HazardCategory, JobKind, LocationSource, ReportStatus
from app.schemas.api import (
    AuditView,
    DuplicateSuggestionView,
    JobView,
    NoteCreate,
    NoteView,
    Page,
    ReportCreated,
    ReportDetail,
    ReportSummary,
    ReportUpdate,
    ReviewAction,
    SegmentationView,
    SegmentRequest,
    TranscriptionResult,
)
from app.services import rate_limit, review
from app.services.jobs import enqueue
from app.services.reports import NewReport, create_report, existing_for_key
from app.services.segmentation import request_segmentation
from app.services.transcription import retranscribe, transcribe_draft

router = APIRouter(tags=["reports"])

_CHUNK = 1024 * 1024


async def read_limited(upload: UploadFile, limit: int, label: str) -> bytes:
    """Read an upload without ever buffering more than `limit` bytes."""
    data = bytearray()
    while chunk := await upload.read(_CHUNK):
        data.extend(chunk)
        if len(data) > limit:
            raise PayloadTooLarge(f"The {label} is larger than {limit // (1024 * 1024)} MB.")
    return bytes(data)


def _receipt_for(report_id: uuid.UUID, idempotency_key: str) -> str:
    # Deterministic for idempotent retries; only the original client knows the key.
    return derive_token("receipt", f"{report_id}:{idempotency_key}")


def load_report(db: DB, report_id: uuid.UUID, user: User | None, token: str | None) -> Report:
    """Reviewers see every report; residents see their own via the receipt token."""
    report = db.get(Report, report_id)
    if report is None:
        raise NotFound("Report not found.")
    if user is not None:
        return report
    if token and hmac.compare_digest(hash_token(token), report.receipt_token_hash):
        return report
    raise NotFound("Report not found.")


@router.post("/reports", response_model=ReportCreated, status_code=status.HTTP_201_CREATED)
async def submit_report(
    db: DB,
    fp: Fingerprint,
    response: Response,
    image: Annotated[UploadFile, File(description="JPEG, PNG or WebP photo")],
    description: Annotated[str, Form(max_length=2000)] = "",
    voice_transcript: Annotated[str | None, Form(max_length=4000)] = None,
    category: Annotated[HazardCategory | None, Form()] = None,
    lat: Annotated[float | None, Form(ge=-90, le=90)] = None,
    lon: Annotated[float | None, Form(ge=-180, le=180)] = None,
    location_source: Annotated[LocationSource, Form()] = LocationSource.none,
    location_accuracy_m: Annotated[float | None, Form(ge=0, le=100000)] = None,
    location_note: Annotated[str | None, Form(max_length=200)] = None,
    audio_id: Annotated[uuid.UUID | None, Form()] = None,
    audio_claim_token: Annotated[str | None, Form(max_length=128)] = None,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=64)] = None,
) -> ReportCreated:
    settings = get_settings()
    if idempotency_key is not None and len(idempotency_key) < 16:
        raise ValidationFailed("Idempotency-Key must be at least 16 characters.", code="invalid_idempotency_key")
    existing = existing_for_key(db, idempotency_key)
    if existing is not None and idempotency_key is not None:
        if existing.submitter_fingerprint != fp:
            raise Forbidden("This submission key belongs to another client.")
        response.status_code = status.HTTP_200_OK
        return ReportCreated(
            id=existing.id,
            reference=existing.reference,
            receipt_token=_receipt_for(existing.id, idempotency_key),
            status=existing.status,
            job_id=None,
            duplicate_of_request=True,
        )

    rate_limit.hit(db, f"report:{fp}", settings.report_rate_limit_per_hour, timedelta(hours=1))
    rate_limit.hit(db, "report:global", settings.public_global_rate_limit_per_hour, timedelta(hours=1))
    data = await read_limited(image, settings.max_image_bytes, "photo")
    new = NewReport(
        image=data,
        description=description,
        voice_transcript=voice_transcript,
        reporter_category=category,
        lat=lat,
        lon=lon,
        location_source=location_source,
        location_accuracy_m=location_accuracy_m,
        location_note=location_note,
        audio_id=audio_id,
        audio_claim_token=audio_claim_token,
        idempotency_key=idempotency_key,
        fingerprint=fp,
    )
    report, receipt, job = create_report(db, new)
    if idempotency_key is not None:
        receipt = _receipt_for(report.id, idempotency_key)
        report.receipt_token_hash = hash_token(receipt)
    db.commit()
    return ReportCreated(
        id=report.id, reference=report.reference, receipt_token=receipt, status=report.status, job_id=job.id
    )


@router.post("/transcriptions", response_model=TranscriptionResult)
async def transcribe_voice_note(
    db: DB, fp: Fingerprint, audio: Annotated[UploadFile, File(description="Short voice note")]
) -> TranscriptionResult:
    settings = get_settings()
    rate_limit.hit(db, f"transcribe:{fp}", settings.transcription_rate_limit_per_hour, timedelta(hours=1))
    rate_limit.hit(db, "transcribe:global", settings.public_global_rate_limit_per_hour, timedelta(hours=1))
    data = await read_limited(audio, settings.max_audio_bytes, "recording")
    outcome = transcribe_draft(data, fp)
    return TranscriptionResult(
        audio_id=outcome.media_id,
        claim_token=outcome.claim_token,
        duration_ms=outcome.duration_ms,
        transcript=outcome.transcript,
        error_code=outcome.error_code,
    )


@router.get("/reports", response_model=Page[ReportSummary])
def list_reports(
    db: DB,
    _: Reviewer,
    status_: Annotated[list[ReportStatus] | None, Query(alias="status")] = None,
    category: HazardCategory | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    has_location: bool | None = None,
    sample: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ReportSummary]:
    conditions: list[ColumnElement[bool]] = []
    if status_:
        conditions.append(Report.status.in_(status_))
    if category:
        conditions.append(Report.hazard_category == category)
    if q:
        like = f"%{q.strip()}%"
        conditions.append(or_(Report.reference.ilike(like), Report.description.ilike(like)))
    if has_location is not None:
        conditions.append(Report.location.isnot(None) if has_location else Report.location.is_(None))
    if sample is not None:
        conditions.append(Report.is_sample.is_(sample))
    total = db.scalar(select(func.count()).select_from(Report).where(*conditions)) or 0
    rows = (
        db.scalars(select(Report).where(*conditions).order_by(Report.created_at.desc()).limit(limit).offset(offset))
        .unique()
        .all()
    )
    counts = open_suggestion_counts(db, [r.id for r in rows])
    return Page(
        items=[report_summary(r, open_suggestions=counts.get(r.id, 0)) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/reports/{report_id}", response_model=ReportDetail)
def get_report(
    db: DB,
    report_id: uuid.UUID,
    user: OptionalUser,
    x_report_token: Annotated[str | None, Header(max_length=128)] = None,
) -> ReportDetail:
    report = load_report(db, report_id, user, x_report_token)
    return report_detail(db, report, reviewer=user is not None)


@router.post("/reports/{report_id}/analyze", response_model=JobView, status_code=status.HTTP_202_ACCEPTED)
def reanalyze(db: DB, report_id: uuid.UUID, user: Reviewer) -> JobView:
    report = load_report(db, report_id, user, None)
    job = enqueue(db, JobKind.analyze_report, report.id, dedupe=f"analyze:{report.id}", options={"force": True})
    db.add(
        AuditEvent(
            actor_user_id=user.id, actor_label=user.display_name, action="analysis_requested", report_id=report.id
        )
    )
    db.commit()
    return JobView.model_validate(job)


@router.post("/reports/{report_id}/segment", response_model=SegmentationView, status_code=status.HTTP_202_ACCEPTED)
def segment(
    db: DB,
    fp: Fingerprint,
    report_id: uuid.UUID,
    body: SegmentRequest,
    user: OptionalUser,
    response: Response,
    x_report_token: Annotated[str | None, Header(max_length=128)] = None,
) -> SegmentationView:
    report = load_report(db, report_id, user, x_report_token)
    if user is None:
        rate_limit.hit(db, f"segment:{fp}", 10, timedelta(hours=1))
    seg, job = request_segmentation(db, report, body.prompt)
    if job is None:
        response.status_code = status.HTTP_200_OK
    db.commit()
    return SegmentationView.model_validate(seg)


@router.post("/reports/{report_id}/transcribe", response_model=TranscriptionResult)
def transcribe_attached(db: DB, report_id: uuid.UUID, user: Reviewer) -> TranscriptionResult:
    report = load_report(db, report_id, user, None)
    if report.audio_media_id is None:
        raise ValidationFailed("This report has no voice note.", code="no_audio")
    outcome = retranscribe(report.audio_media_id, report.id)
    if outcome.transcript is not None:
        db.refresh(report)
        report.voice_transcript_machine = outcome.transcript
        db.add(
            AuditEvent(
                actor_user_id=user.id, actor_label=user.display_name, action="transcription_rerun", report_id=report.id
            )
        )
        db.commit()
    return TranscriptionResult(
        audio_id=outcome.media_id,
        claim_token=None,
        duration_ms=outcome.duration_ms,
        transcript=outcome.transcript,
        error_code=outcome.error_code,
    )


@router.get("/reports/{report_id}/duplicates", response_model=list[DuplicateSuggestionView])
def duplicates_for(db: DB, report_id: uuid.UUID, user: Reviewer) -> list[DuplicateSuggestionView]:
    load_report(db, report_id, user, None)
    rows = (
        db.scalars(
            select(DuplicateSuggestion)
            .where(DuplicateSuggestion.source_report_id == report_id)
            .order_by(DuplicateSuggestion.score.desc())
        )
        .unique()
        .all()
    )
    return [suggestion_view(db, s) for s in rows]


@router.post("/reports/{report_id}/match", response_model=JobView, status_code=status.HTTP_202_ACCEPTED)
def rematch(db: DB, report_id: uuid.UUID, user: Reviewer) -> JobView:
    report = load_report(db, report_id, user, None)
    job = enqueue(db, JobKind.match_duplicates, report.id, dedupe=f"match:{report.id}")
    db.commit()
    return JobView.model_validate(job)


@router.post("/reports/{report_id}/review", response_model=ReportDetail)
def review_action(db: DB, report_id: uuid.UUID, body: ReviewAction, user: Reviewer) -> ReportDetail:
    report = db.get(Report, report_id, with_for_update={"of": Report})
    if report is None:
        raise NotFound("Report not found.")
    review.review_report(db, report, user, body.action, title=body.title, priority=body.priority, note=body.note)
    db.commit()
    db.refresh(report)
    return report_detail(db, report, reviewer=True)


@router.patch("/reports/{report_id}", response_model=ReportDetail)
def update_report(db: DB, report_id: uuid.UUID, body: ReportUpdate, user: Reviewer) -> ReportDetail:
    report = db.get(Report, report_id, with_for_update={"of": Report})
    if report is None:
        raise NotFound("Report not found.")
    review.correct_category(db, report, user, body.reviewer_category, body.note)
    db.commit()
    return report_detail(db, report, reviewer=True)


@router.get("/reports/{report_id}/notes", response_model=list[NoteView])
def report_notes(db: DB, report_id: uuid.UUID, _: Reviewer) -> list[NoteView]:
    rows = db.scalars(select(ReviewNote).where(ReviewNote.report_id == report_id).order_by(ReviewNote.created_at)).all()
    return [
        NoteView(id=n.id, created_at=n.created_at, author=n.author.display_name if n.author else None, body=n.body)
        for n in rows
    ]


@router.post("/reports/{report_id}/notes", response_model=NoteView, status_code=status.HTTP_201_CREATED)
def add_report_note(db: DB, report_id: uuid.UUID, body: NoteCreate, user: Reviewer) -> NoteView:
    report = load_report(db, report_id, user, None)
    note = review.add_note(db, user, body.body, report=report)
    db.commit()
    return NoteView(id=note.id, created_at=note.created_at, author=user.display_name, body=note.body)


@router.get("/reports/{report_id}/audit", response_model=list[AuditView])
def report_audit(db: DB, report_id: uuid.UUID, _: Reviewer) -> list[AuditView]:
    rows = db.scalars(select(AuditEvent).where(AuditEvent.report_id == report_id).order_by(AuditEvent.created_at)).all()
    return [AuditView.model_validate(e) for e in rows]


@router.get("/jobs/{job_id}", response_model=JobView)
def get_job(
    db: DB,
    job_id: uuid.UUID,
    user: OptionalUser,
    x_report_token: Annotated[str | None, Header(max_length=128)] = None,
) -> JobView:
    job = db.get(ProcessingJob, job_id)
    if job is None:
        raise NotFound("Job not found.")
    load_report(db, job.report_id, user, x_report_token)
    return JobView.model_validate(job)
