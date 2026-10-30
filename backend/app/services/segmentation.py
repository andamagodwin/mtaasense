"""SAM 3.1 concept segmentation.

The request streams special-token text; the official `meta-sam-parser` validates the stream
and decodes masks. Masks arrive cropped to their box (H x W raster positioned at the box's
top-left), so regions are stored as an SVG path in mask-local pixels plus the box in
source-image pixels; the UI places the path with translate(box.left, box.top).
"""

import asyncio
import logging
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from meta_sam_parser import (
    InvalidSegmentationMaskError,
    ResponsesStreamError,
    ResponsesStreamFailedError,
    ResponsesStreamRefusalError,
    SegmentationBoxRecord,
    SegmentationMaskRecord,
    decode_mask_to_raster,
    decode_mask_to_svg_path,
    image_segmentation_format,
    parse_responses_stream,
)
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.core.logging import log_event
from app.db.models import AuditEvent, ProcessingJob, Report, Segmentation
from app.db.models.enums import JobKind, ModelOperation, Provenance, SegmentationStatus
from app.db.session import session_scope
from app.services import pricing
from app.services.fixtures import fixture_for
from app.services.media import image_data_url
from app.services.meta_client import CallContext, ModelAPIError, get_meta_client

logger = logging.getLogger(__name__)

# Short noun phrases per SAM guidance (one concept per request).
CONCEPTS = ("pothole", "damaged road surface", "drainage channel", "standing water", "puddle")
_FRAME_SIZE = re.compile(r"<\|box;[^|]*?\bw=(\d+);h=(\d+)")


class SegmentationFailed(Exception):
    def __init__(self, code: str, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def normalise_concept(prompt: str) -> str:
    concept = " ".join(prompt.strip().lower().split())
    if concept not in CONCEPTS:
        raise ValidationFailed(f"Choose one of: {', '.join(CONCEPTS)}.", code="unsupported_concept")
    return concept


async def _replay(events: list[dict[str, Any]]) -> AsyncIterator[dict[str, Any]]:
    for event in events:
        yield event


def parse_sam_events(events: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], tuple[int, int] | None]:
    """Parse collected SSE events into regions. Returns (regions, (frame_w, frame_h) if reported)."""

    text_events = ("response.output_text.delta", "response.output_text.done", "response.content_part.done")
    if not any(e.get("type") in text_events for e in events) and any(
        e.get("type") == "response.completed" for e in events
    ):
        # Zero matches: a completed response with no output text. Not an error.
        return [], None

    async def _final() -> Any:
        return await parse_responses_stream(_replay(events), image_segmentation_format()).final_result()

    try:
        result = asyncio.run(_final())
    except ResponsesStreamRefusalError as exc:
        raise SegmentationFailed("model_refused", retryable=False) from exc
    except ResponsesStreamFailedError as exc:
        raise SegmentationFailed("provider_stream_failed", retryable=True) from exc
    except ResponsesStreamError as exc:
        raise SegmentationFailed("malformed_stream", retryable=False) from exc

    boxes: dict[str, SegmentationBoxRecord] = {}
    regions: list[dict[str, Any]] = []
    for record in result.records:
        if isinstance(record, SegmentationBoxRecord):
            boxes[record.object_id] = record
        elif isinstance(record, SegmentationMaskRecord):
            try:
                raster = decode_mask_to_raster(record.mask)
                svg_path = decode_mask_to_svg_path(record.mask)
            except InvalidSegmentationMaskError as exc:
                raise SegmentationFailed("invalid_mask", retryable=False) from exc
            box = boxes.get(record.object_id)
            b = record.bounds
            regions.append(
                {
                    "object_id": record.object_id,
                    "box": {"left": b.left, "top": b.top, "right": b.right, "bottom": b.bottom},
                    "confidence": record.confidence
                    if record.confidence is not None
                    else (box.confidence if box else None),
                    "mask": {
                        "width": record.mask.width,
                        "height": record.mask.height,
                        "svg_path": svg_path,
                        "area_px": sum(raster),
                    },
                }
            )
    for diag in result.diagnostics:
        if diag.severity == "error":
            log_event(logger, "sam_diagnostic", logging.WARNING, code=diag.code)
    match = _FRAME_SIZE.search(result.raw_output)
    frame = (int(match.group(1)), int(match.group(2))) if match else None
    return regions, frame


def request_segmentation(db: Any, report: Report, prompt: str) -> tuple[Segmentation, ProcessingJob | None]:
    """Return the cached segmentation for (image, concept) or create one and queue a job."""
    concept = normalise_concept(prompt)
    existing = db.scalar(
        select(Segmentation).where(Segmentation.media_id == report.display_media_id, Segmentation.prompt == concept)
    )
    if existing is not None and existing.status != SegmentationStatus.failed:
        return existing, None
    seg = existing or Segmentation(report_id=report.id, media_id=report.display_media_id, prompt=concept)
    seg.status = SegmentationStatus.queued
    seg.error_code = None
    db.add(seg)
    db.flush()
    from app.services.jobs import enqueue  # local import avoids a cycle

    job = enqueue(db, JobKind.segment_image, report.id, segmentation_id=seg.id, dedupe=f"segment:{seg.id}")
    return seg, job


def run_segmentation(segmentation_id: uuid.UUID, job_id: uuid.UUID | None = None) -> Provenance:
    settings = get_settings()
    with session_scope() as db:
        seg = db.get(Segmentation, segmentation_id)
        if seg is None:
            raise SegmentationFailed("segmentation_missing", retryable=False)
        report = db.get(Report, seg.report_id)
        assert report is not None
        seg.status = SegmentationStatus.running
        prompt, report_id = seg.prompt, report.id
        sample, sha = report.is_sample, report.image.sha256
        display = report.display_image

    fixture = fixture_for(sha, is_sample=sample, section=f"segmentation:{prompt}")
    provenance = Provenance.live
    try:
        client = get_meta_client()
        if not client.configured and fixture is not None:
            raise SegmentationFailed("not_configured", retryable=False)
        image_url, width, height = image_data_url(display, settings.display_image_max_edge)
        payload = {
            "model": settings.segmentation_model,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {"type": "input_image", "image_url": image_url},
                    ],
                }
            ],
            "metadata": {"include_confidence": "true"},
            "store": False,
        }
        ctx = CallContext(ModelOperation.segmentation, report_id=report_id, job_id=job_id)
        try:
            events, _ = client.stream_response(ctx, payload, image_count=1, cost=pricing.sam_image_cost(1))
        except ModelAPIError as exc:
            raise SegmentationFailed(exc.code, retryable=exc.retryable) from exc
        regions, frame = parse_sam_events(events)
        frame_w, frame_h = frame or (width, height)
    except SegmentationFailed:
        if fixture is None:
            raise
        regions, frame_w, frame_h = fixture["regions"], fixture["image_width"], fixture["image_height"]
        provenance = Provenance.fixture

    with session_scope() as db:
        seg = db.get(Segmentation, segmentation_id, with_for_update={"of": Segmentation})
        assert seg is not None
        seg.regions = regions
        seg.image_width, seg.image_height = frame_w, frame_h
        seg.model = settings.segmentation_model
        seg.provenance = provenance
        seg.status = SegmentationStatus.completed
        seg.completed_at = datetime.now(UTC)
        db.add(
            AuditEvent(
                actor_label="system",
                action="segmentation_completed",
                report_id=report_id,
                data={"prompt": prompt, "regions": len(regions), "provenance": provenance.value},
            )
        )
    log_event(logger, "segmentation_completed", report_id=str(report_id), regions=len(regions))
    return provenance


def mark_segmentation_failed(segmentation_id: uuid.UUID, code: str) -> None:
    with session_scope() as db:
        seg = db.get(Segmentation, segmentation_id, with_for_update={"of": Segmentation})
        if seg is not None:
            seg.status = SegmentationStatus.failed
            seg.error_code = code
