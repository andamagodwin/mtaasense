"""Automatic privacy blur.

SAM 3.1 finds faces and number plates in each display image; the blurred copy is what
non-reviewers see. The blur is a plain Gaussian blur composited over the detected boxes,
so it cannot invent content the way a generated edit could. Reviewers keep the original
and the unblurred display image.
"""

import hashlib
import io
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import log_event
from app.db.models import AuditEvent, Media, ProcessingJob, Redaction
from app.db.models.enums import JobKind, MediaKind, MediaVariant, ModelOperation, Provenance, RedactionStatus
from app.db.session import session_scope
from app.services.media_storage import get_storage, new_storage_key
from app.services.meta_client import CallContext, get_meta_client
from app.services.segmentation import SegmentationFailed, segment_media

logger = logging.getLogger(__name__)

# Short noun phrases, one SAM call each (verified live on seed photos: 4/4 faces, 1/1 plate).
PRIVACY_CONCEPTS = ("face", "number plate")


class RedactionFailed(Exception):
    def __init__(self, code: str, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def request_redaction(db: Session, display: Media, report_id: uuid.UUID) -> tuple[Redaction, ProcessingJob | None]:
    """Return the redaction for a display image, creating and queueing it when missing."""
    existing = db.scalar(select(Redaction).where(Redaction.media_id == display.id))
    if existing is not None and existing.status != RedactionStatus.failed:
        return existing, None
    red = existing or Redaction(media_id=display.id)
    red.status = RedactionStatus.queued
    red.error_code = None
    db.add(red)
    db.flush()
    from app.services.jobs import enqueue  # local import avoids a cycle

    job = enqueue(
        db, JobKind.redact_image, report_id, dedupe=f"redact:{display.id}", options={"redaction_id": str(red.id)}
    )
    return red, job


def blur_regions(raw: bytes, regions: list[dict[str, Any]], width: int, height: int) -> bytes:
    """Gaussian-blur the given boxes. Pure pixel math: nothing is generated or inpainted."""
    with Image.open(io.BytesIO(raw)) as img:
        base = img.convert("RGB")
    if base.size != (width, height):
        base = base.resize((width, height), Image.Resampling.LANCZOS)
    if not regions:
        return _encode(base)
    radius = max(12, min(width, height) // 40)
    blurred = base.filter(ImageFilter.GaussianBlur(radius))
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for region in regions:
        box = region["box"]
        pad_x = max(6.0, (box["right"] - box["left"]) * 0.25)
        pad_y = max(6.0, (box["bottom"] - box["top"]) * 0.25)
        draw.rectangle(
            [
                max(0, box["left"] - pad_x),
                max(0, box["top"] - pad_y),
                min(width, box["right"] + pad_x),
                min(height, box["bottom"] + pad_y),
            ],
            fill=255,
        )
    mask = mask.filter(ImageFilter.GaussianBlur(max(3, radius // 4)))
    return _encode(Image.composite(blurred, base, mask))


def _encode(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=86, optimize=True)
    return buf.getvalue()


def run_redaction(redaction_id: uuid.UUID, job_id: uuid.UUID | None = None) -> Provenance:
    with session_scope() as db:
        red = db.get(Redaction, redaction_id)
        if red is None:
            raise RedactionFailed("redaction_missing", retryable=False)
        display = db.get(Media, red.media_id)
        if display is None:
            raise RedactionFailed("media_missing", retryable=False)
        red.status = RedactionStatus.running
        job = db.get(ProcessingJob, job_id) if job_id else None
        report_id = job.report_id if job and job.report_id else display.report_id
        sample = display.is_sample

    if not get_meta_client().configured:
        raise RedactionFailed("not_configured", retryable=False)
    ctx = CallContext(ModelOperation.redaction, report_id=report_id, job_id=job_id)
    found: list[dict[str, Any]] = []
    frame_w, frame_h = 0, 0
    try:
        for concept in PRIVACY_CONCEPTS:
            regions, frame_w, frame_h = segment_media(display, concept, ctx)
            found.extend({"concept": concept, **r} for r in regions)
    except SegmentationFailed as exc:
        raise RedactionFailed(exc.code, retryable=exc.retryable) from exc

    # SAM boxes are in the frame it was sent (downscaled for the model); scale to display pixels.
    sx = (display.width or frame_w) / frame_w if frame_w else 1.0
    sy = (display.height or frame_h) / frame_h if frame_h else 1.0
    boxes = [
        {
            "concept": r["concept"],
            "box": {
                "left": r["box"]["left"] * sx,
                "top": r["box"]["top"] * sy,
                "right": r["box"]["right"] * sx,
                "bottom": r["box"]["bottom"] * sy,
            },
            "confidence": r["confidence"],
        }
        for r in found
    ]
    raw = get_storage().get(display.storage_key)
    redacted_bytes = blur_regions(raw, boxes, display.width or frame_w, display.height or frame_h)

    settings = get_settings()
    with session_scope() as db:
        red = db.get(Redaction, redaction_id, with_for_update={"of": Redaction})
        assert red is not None
        display = db.get(Media, red.media_id)
        assert display is not None
        key = new_storage_key("image", "jpg")
        get_storage().put(key, redacted_bytes)
        redacted = Media(
            kind=MediaKind.image,
            variant=MediaVariant.redacted,
            parent_id=display.id,
            storage_key=key,
            content_type="image/jpeg",
            size_bytes=len(redacted_bytes),
            sha256=hashlib.sha256(redacted_bytes).hexdigest(),
            width=display.width,
            height=display.height,
            report_id=display.report_id,
            uploader_fingerprint=display.uploader_fingerprint,
            is_sample=sample,
        )
        db.add(redacted)
        db.flush()
        red.regions = boxes
        red.redacted_media_id = redacted.id
        red.model = settings.segmentation_model
        red.provenance = Provenance.live
        red.status = RedactionStatus.completed
        red.error_code = None
        red.completed_at = datetime.now(UTC)
        db.add(
            AuditEvent(
                actor_label="system",
                action="redaction_completed",
                report_id=display.report_id,
                data={"regions": len(boxes)},
            )
        )
    log_event(logger, "redaction_completed", regions=len(boxes))
    return Provenance.live


def mark_redaction_failed(redaction_id: uuid.UUID, code: str) -> None:
    with session_scope() as db:
        red = db.get(Redaction, redaction_id, with_for_update={"of": Redaction})
        if red is not None:
            red.status = RedactionStatus.failed
            red.error_code = code


def ensure_redactions(db: Session, display_ids: list[uuid.UUID], report_id: uuid.UUID) -> None:
    """Queue redactions for images that predate the feature. New uploads queue at creation."""
    if not display_ids:
        return
    have = set(db.scalars(select(Redaction.media_id).where(Redaction.media_id.in_(display_ids))).all())
    for media_id in display_ids:
        if media_id in have:
            continue
        display = db.get(Media, media_id)
        if display is not None:
            request_redaction(db, display, report_id)
