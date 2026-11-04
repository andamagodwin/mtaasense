"""Video reports: SAM 3.1 tracks the hazard frame by frame, Muse Spark describes the motion.

Each report carries at most one short clip alongside its photo. The worker transcodes the upload,
sends it to the Files API once, tracks the photo analysis' concept across frames, burns the tracks
onto three stills, and asks Spark what the motion shows that the photo cannot. Stills carry the
outlines so clients need no frame-accurate sync.
"""

import hashlib
import io
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from PIL import Image, ImageDraw
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.core.logging import log_event
from app.db.models import AuditEvent, Media, ProcessingJob, Report, VideoTrack
from app.db.models.enums import (
    HazardCategory,
    JobKind,
    MediaKind,
    MediaVariant,
    ModelOperation,
    Provenance,
    VideoStatus,
)
from app.db.session import session_scope
from app.schemas.analysis import VideoAssessment
from app.services.media import (
    extract_frame,
    probe_video_bytes,
    transcode_display_video,
)
from app.services.media_storage import get_storage, new_storage_key
from app.services.meta_client import CallContext, ModelAPIError, get_meta_client, response_output_text
from app.services.pricing import sam_video_cost
from app.services.segmentation import SegmentationFailed, parse_sam_video_events

logger = logging.getLogger(__name__)

# Still concept -> video prompt. Measured live per hazard: every still phrase tracks on video
# except "standing water", which finds nothing where "water" tracks the flood.
VIDEO_PROMPTS = {
    "pothole": "pothole",
    "damaged road surface": "damaged road surface",
    "drainage channel": "drainage channel",
    "standing water": "water",
    "puddle": "puddle",
}
_CATEGORY_DEFAULT = {
    HazardCategory.pothole: "pothole",
    HazardCategory.road_surface_damage: "damaged road surface",
    HazardCategory.blocked_drainage: "drainage channel",
    HazardCategory.flooding: "standing water",
}
STILL_COUNT = 3
_FILES_SIZE_LIMIT = 20 * 1024 * 1024

VIDEO_INSTRUCTIONS = """\
You help a human reviewer understand a short clip attached to a road or drainage report. The clip \
may include sound; use it when it helps. Describe only what you can see or hear: how things move, \
how far the hazard spreads, and what changes between the start and the end. Compare against the \
report context when it helps, but never contradict the photo with a guess. Set hazard_visible \
false when the reported problem is not visible. Write plain sentences without em dashes; use \
commas, colons or full stops instead."""

_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "hazard_visible",
        "summary",
        "motion",
        "spread",
        "changes_through_clip",
        "confidence",
        "uncertainties",
    ],
    "properties": {
        "hazard_visible": {"type": "boolean"},
        "summary": {"type": "string", "description": "One or two neutral sentences on what the clip shows."},
        "motion": {"type": "string", "description": "How things move: flow direction and relative speed."},
        "spread": {"type": "string", "description": "How far the hazard reaches and whether it grows."},
        "changes_through_clip": {"type": "string", "description": "What visibly changes start to end."},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "uncertainties": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Up to four things that cannot be determined; empty if none.",
        },
    },
}

OUTLINE_FILL = (255, 0, 255, 100)
OUTLINE_EDGE = (255, 255, 255, 255)


class VideoFailed(Exception):
    def __init__(self, code: str, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def resolve_concept(report: Report) -> str | None:
    """What SAM should track: the photo analysis' concept, else the category default. None skips tracking."""
    suggested = ((report.analysis or {}).get("result") or {}).get("segmentation_concept")
    if isinstance(suggested, str) and suggested in VIDEO_PROMPTS:
        return VIDEO_PROMPTS[suggested]
    for category in (report.hazard_category, report.reporter_category):
        if isinstance(category, HazardCategory) and category in _CATEGORY_DEFAULT:
            return VIDEO_PROMPTS[_CATEGORY_DEFAULT[category]]
    return None


def request_video_analysis(db: Session, report: Report) -> tuple[VideoTrack | None, ProcessingJob | None]:
    """Queue clip analysis for a report with a video. Returns (track, job); (None, None) without a clip."""
    if report.video_media_id is None:
        return None, None
    track = db.scalar(select(VideoTrack).where(VideoTrack.report_id == report.id))
    if track is not None and track.status != VideoStatus.failed:
        return track, None
    track = track or VideoTrack(report_id=report.id)
    track.status = VideoStatus.queued
    track.error_code = None
    db.add(track)
    db.flush()
    from app.services.jobs import enqueue  # local import avoids a cycle

    job = enqueue(db, JobKind.analyze_video, report.id, dedupe=f"video:{report.id}")
    return track, job


def draw_outlines(still: bytes, regions: list[dict[str, Any]], frame_w: int, frame_h: int) -> bytes:
    """Burn tracked boxes and masks onto a still. Pure pixel math; clients draw nothing."""
    with Image.open(io.BytesIO(still)) as img:
        base = img.convert("RGB")
    width, height = base.size
    sx, sy = (width / frame_w if frame_w else 1.0), (height / frame_h if frame_h else 1.0)
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    edge = ImageDraw.Draw(overlay)
    for region in regions:
        box = region["box"]
        left, top = box["left"] * sx, box["top"] * sy
        right, bottom = box["right"] * sx, box["bottom"] * sy
        mask = region.get("mask") or {}
        raster = mask.get("raster")
        if raster and mask.get("width") and mask.get("height"):
            cells = Image.new("L", (mask["width"], mask["height"]))
            cells.putdata([255 if cell else 0 for cell in raster])
            cells = cells.resize((max(1, round(right - left)), max(1, round(bottom - top))), Image.Resampling.NEAREST)
            fill = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            fill.paste(Image.new("RGBA", cells.size, OUTLINE_FILL), (round(left), round(top)), cells)
            overlay = Image.alpha_composite(overlay, fill)
            edge = ImageDraw.Draw(overlay)
        edge.rectangle([left, top, right, bottom], outline=OUTLINE_EDGE, width=2)
    out = Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=86, optimize=True)
    return buf.getvalue()


def sample_frames(tracked: list[int], duration_s: float, fps: float) -> list[tuple[int | None, float]]:
    """(frame index, time) for stills: first/middle/last tracked frame, else thirds of the clip."""
    if tracked:
        picks = [tracked[0], tracked[len(tracked) // 2], tracked[-1]]
        return [(i, i / fps if fps else 0.0) for i in picks]
    return [(None, duration_s * f) for f in (0.1, 0.5, 0.9)]


def _context(report: Report) -> str:
    category = report.hazard_category or report.reporter_category
    parts = [f"category: {category.value if category else 'unknown'}"]
    if report.description:
        parts.append(f"resident description: {report.description[:300]}")
    summary = ((report.analysis or {}).get("result") or {}).get("summary")
    if summary:
        parts.append(f"photo analysis: {summary[:300]}")
    return "; ".join(parts)


def run_video_analysis(report_id: uuid.UUID, job_id: uuid.UUID | None = None) -> Provenance:
    settings = get_settings()
    with session_scope() as db:
        track = db.scalar(select(VideoTrack).where(VideoTrack.report_id == report_id))
        if track is None:
            raise VideoFailed("video_missing", retryable=False)
        track_id = track.id
        report = db.get(Report, track.report_id)
        original = db.get(Media, report.video_media_id) if report and report.video_media_id else None
        if report is None or original is None:
            raise VideoFailed("media_missing", retryable=False)
        track.status = VideoStatus.running
        have_display = report.video_display_media_id is not None

    client = get_meta_client()
    if not client.configured:
        raise VideoFailed("not_configured", retryable=False)

    storage = get_storage()
    raw = storage.get(original.storage_key)
    try:
        info = probe_video_bytes(raw)
        if have_display:
            with session_scope() as db:
                display_row = db.get(Media, db.get(Report, track.report_id).video_display_media_id)  # type: ignore[union-attr]
                assert display_row is not None
                display_bytes = storage.get(display_row.storage_key)
            display_info = probe_video_bytes(display_bytes)
        else:
            display_bytes, display_info = transcode_display_video(raw, info)
    except ValidationFailed as exc:
        raise VideoFailed(exc.code or "invalid_video", retryable=False) from exc
    if len(display_bytes) > _FILES_SIZE_LIMIT:
        raise VideoFailed("video_too_large", retryable=False)

    upload_ctx = CallContext(ModelOperation.file_upload, report_id=report.id, job_id=job_id)
    try:
        file_id = client.upload_file(upload_ctx, display_bytes, "clip.mp4")
    except ModelAPIError as exc:
        raise VideoFailed(exc.code, retryable=exc.retryable) from exc

    concept: str | None
    with session_scope() as db:
        concept = resolve_concept(db.get(Report, track.report_id))  # type: ignore[arg-type]

    tracks: dict[int, list[dict[str, Any]]] = {}
    frame_w, frame_h = display_info.width, display_info.height
    if concept is not None:
        track_ctx = CallContext(ModelOperation.video_tracking, report_id=report.id, job_id=job_id)
        payload = {
            "model": settings.segmentation_model,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": concept},
                        {"type": "input_video", "file_id": file_id},
                    ],
                }
            ],
            "metadata": {"include_confidence": "true"},
            "store": False,
        }
        try:
            events, _ = client.stream_response(
                track_ctx, payload, video_frames=display_info.frames, cost=sam_video_cost(display_info.frames)
            )
            tracks, frame = parse_sam_video_events(events)
            if frame is not None:
                frame_w, frame_h = frame
        except ModelAPIError as exc:
            raise VideoFailed(exc.code, retryable=exc.retryable) from exc
        except SegmentationFailed as exc:
            raise VideoFailed(exc.code, retryable=exc.retryable) from exc

    tracked_ids = sorted({r["object_id"] for regions in tracks.values() for r in regions})
    stills: list[tuple[int | None, float, bytes, list[dict[str, Any]]]] = []
    for frame_index, time_s in sample_frames(sorted(tracks), display_info.duration_s, display_info.fps):
        try:
            still = extract_frame(display_bytes, time_s)
        except ValidationFailed as exc:
            raise VideoFailed(exc.code or "invalid_video", retryable=False) from exc
        regions = tracks.get(frame_index, []) if frame_index is not None else []
        stills.append((frame_index, time_s, draw_outlines(still, regions, frame_w, frame_h), regions))

    with session_scope() as db:
        report = db.get(Report, track.report_id)
        assert report is not None
        context = _context(report)
    describe_ctx = CallContext(ModelOperation.video_description, report_id=report.id, job_id=job_id)
    spark_payload = {
        "model": settings.analysis_model,
        "instructions": VIDEO_INSTRUCTIONS,
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": f"Report context: {context}. Describe this clip."},
                    {"type": "input_file", "file_id": file_id},
                ],
            }
        ],
        "text": {"format": {"type": "json_schema", "name": "video_assessment", "schema": _SCHEMA, "strict": True}},
        "reasoning": {"effort": settings.analysis_reasoning_effort},
        "max_output_tokens": settings.analysis_max_output_tokens,
        "store": False,
    }
    try:
        spark = client.create_response(describe_ctx, spark_payload)
    except ModelAPIError as exc:
        raise VideoFailed(exc.code, retryable=exc.retryable) from exc
    text, refusal = response_output_text(spark.body)
    if refusal or not text:
        raise VideoFailed("model_refused", retryable=False)
    try:
        assessment = VideoAssessment.model_validate_json(text)
    except ValidationError as exc:
        raise VideoFailed("invalid_model_output", retryable=True) from exc

    with session_scope() as db:
        track = db.get(VideoTrack, track_id, with_for_update={"of": VideoTrack})
        assert track is not None
        report = db.get(Report, track.report_id)
        assert report is not None
        original = db.get(Media, report.video_media_id)
        assert original is not None
        if report.video_display_media_id is None:
            key = new_storage_key("video", "mp4")
            storage.put(key, display_bytes)
            display = Media(
                kind=MediaKind.video,
                variant=MediaVariant.display,
                parent_id=original.id,
                storage_key=key,
                content_type="video/mp4",
                size_bytes=len(display_bytes),
                sha256=hashlib.sha256(display_bytes).hexdigest(),
                width=display_info.width,
                height=display_info.height,
                duration_ms=int(display_info.duration_s * 1000),
                report_id=report.id,
                uploader_fingerprint=original.uploader_fingerprint,
                is_sample=original.is_sample,
            )
            db.add(display)
            db.flush()
            report.video_display_media_id = display.id
            track.media_id = display.id
        frames: list[dict[str, Any]] = []
        for frame_index, time_s, still_bytes, regions in stills:
            key = new_storage_key("image", "jpg")
            storage.put(key, still_bytes)
            still_media = Media(
                kind=MediaKind.image,
                variant=MediaVariant.tracked_still,
                parent_id=report.video_display_media_id,
                storage_key=key,
                content_type="image/jpeg",
                size_bytes=len(still_bytes),
                sha256=hashlib.sha256(still_bytes).hexdigest(),
                width=display_info.width,
                height=display_info.height,
                report_id=report.id,
                uploader_fingerprint=original.uploader_fingerprint,
                is_sample=original.is_sample,
            )
            db.add(still_media)
            db.flush()
            frames.append(
                {
                    "frame_index": frame_index,
                    "time_s": round(time_s, 2),
                    "still_media_id": str(still_media.id),
                    "regions": [
                        {
                            "object_id": r["object_id"],
                            "box": r["box"],
                            "confidence": r.get("confidence"),
                        }
                        for r in regions
                    ],
                }
            )
        track.concept = concept
        track.file_id = file_id
        track.frames = frames
        track.assessment = assessment.model_dump() | {"response_id": spark.response_id}
        track.tracked_objects = len(tracked_ids)
        track.model = settings.segmentation_model
        track.provenance = Provenance.live
        track.status = VideoStatus.completed
        track.error_code = None
        track.completed_at = datetime.now(UTC)
        db.add(
            AuditEvent(
                actor_label="system",
                action="video_analysis_completed",
                report_id=report.id,
                data={"concept": concept, "objects": len(tracked_ids)},
            )
        )
    log_event(logger, "video_analysis_completed", objects=len(tracked_ids))
    return Provenance.live


def mark_video_failed(track_id: uuid.UUID, code: str) -> None:
    with session_scope() as db:
        track = db.get(VideoTrack, track_id, with_for_update={"of": VideoTrack})
        if track is not None:
            track.status = VideoStatus.failed
            track.error_code = code
