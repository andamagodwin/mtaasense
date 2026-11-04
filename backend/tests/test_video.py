import io
import json
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.db.models import Media, ModelCall, ProcessingJob, VideoTrack
from app.db.models.enums import JobKind, MediaVariant, ModelOperation, VideoStatus
from app.db.session import session_scope
from app.services import media as media_module
from app.services import video_analysis as va
from app.services.media import VideoInfo, sniff_video
from app.services.segmentation import parse_sam_video_events
from app.workers.runner import _queue_follow_ups, process
from tests.conftest import make_image, submit

INFO = VideoInfo(duration_s=5.0, width=640, height=480, fps=10.0, frames=50)

# Same record grammar as the still-image fixture, with a frame header per frame.
OBJ0 = (
    "0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>"
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>"
)
OBJ1 = (
    ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>"
    "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>"
)
VIDEO_TEXT = "".join(f"<{i}f>{OBJ0}{OBJ1}\n" for i in range(3))


def video_sse() -> str:
    lane = {"item_id": "msg_1", "output_index": 0, "content_index": 0}
    events = [
        {"type": "response.created", "response": {"id": "resp_vid", "status": "in_progress"}},
        {"type": "response.output_text.delta", **lane, "delta": VIDEO_TEXT[:120]},
        {"type": "response.output_text.delta", **lane, "delta": VIDEO_TEXT[120:]},
        {
            "type": "response.content_part.done",
            **lane,
            "part": {"type": "output_text", "text": VIDEO_TEXT},
        },
        {"type": "response.completed", "response": {"id": "resp_vid", "status": "completed"}},
    ]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)


ASSESSMENT = {
    "hazard_visible": True,
    "summary": "Water covers the left lane.",
    "motion": "Water flows steadily from left to right.",
    "spread": "The water reaches the kerb and holds steady.",
    "changes_through_clip": "The leading edge advances a metre.",
    "confidence": "high",
    "uncertainties": [],
}


@pytest.fixture
def no_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    """ffmpeg never runs in tests; probe/transcode/extract are pure seams."""
    monkeypatch.setattr(media_module, "probe_video_bytes", lambda data: INFO)
    monkeypatch.setattr(va, "probe_video_bytes", lambda data: INFO)
    monkeypatch.setattr(va, "transcode_display_video", lambda data, info: (b"display-mp4", INFO))
    monkeypatch.setattr(va, "extract_frame", lambda data, t: make_image())


def test_sniff_video_containers() -> None:
    assert sniff_video(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64) == "mp4"
    assert sniff_video(b"\x00\x00\x00\x18ftypqt  " + b"\x00" * 64) == "mp4"  # MOV shares ftyp
    assert sniff_video(b"\x1a\x45\xdf\xa3" + b"\x00" * 64) == "webm"
    assert sniff_video(b"%PDF-1.4 nope" + b"\x00" * 64) is None


def test_probe_falls_back_without_frame_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        media_module,
        "_ffprobe",
        lambda path, timeout: {
            "format": {"duration": "4.0"},
            "streams": [{"codec_type": "video", "width": 640, "height": 480, "avg_frame_rate": "0/0"}],
        },
    )
    info = media_module.probe_video_bytes(b"whatever")
    assert (info.fps, info.frames) == (30.0, 120)


def test_resolve_concept_prefers_analysis_then_category() -> None:
    from app.db.models.enums import HazardCategory

    class R:
        def __init__(self, analysis: Any, hazard: Any, reporter: Any) -> None:
            self.analysis = analysis
            self.hazard_category = hazard
            self.reporter_category = reporter

    assert va.resolve_concept(R({"result": {"segmentation_concept": "standing water"}}, None, None)) == "water"
    assert va.resolve_concept(R({"result": {"segmentation_concept": "pothole"}}, None, None)) == "pothole"
    assert va.resolve_concept(R({}, HazardCategory.flooding, None)) == "water"
    assert va.resolve_concept(R({}, None, HazardCategory.pothole)) == "pothole"
    assert va.resolve_concept(R({"result": {"segmentation_concept": "none"}}, None, None)) is None
    assert va.resolve_concept(R({}, None, None)) is None


def test_sample_frames_prefers_tracked() -> None:
    assert va.sample_frames([0, 10, 20, 30, 40], 5.0, 10.0) == [(0, 0.0), (20, 2.0), (40, 4.0)]
    assert va.sample_frames([], 10.0, 10.0) == [(None, 1.0), (None, 5.0), (None, 9.0)]


def test_draw_outlines_marks_boxes() -> None:
    plain = make_image(color=(20, 20, 20))
    regions = [{"object_id": "o0", "box": {"left": 100, "top": 100, "right": 200, "bottom": 200}}]
    out = Image.open(io.BytesIO(va.draw_outlines(plain, regions, 640, 480)))
    assert out.size == (640, 480)
    assert sum(out.getpixel((100, 100))) > 400  # box edge drawn bright
    assert sum(out.getpixel((10, 10))) < 150  # elsewhere kept dark


def test_draw_outlines_without_regions_keeps_frame() -> None:
    out = Image.open(io.BytesIO(va.draw_outlines(make_image(), [], 640, 480)))
    assert out.size == (640, 480)


def _sse_events(body: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    kind = ""
    for line in body.split("\n"):
        if line.startswith("event:"):
            kind = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            events.append({"type": kind, **json.loads(line[5:])})
    return events


def test_parse_video_groups_frames() -> None:
    events = _sse_events(video_sse())
    frames, dims = parse_sam_video_events(events)
    assert dims == (320, 334) and sorted(frames) == [0, 1, 2]
    assert [r["object_id"] for r in frames[0]] == ["0", "1"]
    assert frames[0][0]["box"]["left"] == 211
    assert frames[2][0]["mask"]["area_px"] > 0


def test_parse_video_zero_match() -> None:
    frames, dims = parse_sam_video_events([{"type": "response.completed", "id": "r"}])
    assert frames == {} and dims is None


def _video_meta(seen: list[Any]) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/files":
            return httpx.Response(200, json={"id": "file-test"})
        body = json.loads(request.content)
        if body.get("stream"):
            return httpx.Response(200, text=video_sse(), headers={"content-type": "text/event-stream"})
        seen.append(body)
        return httpx.Response(
            200,
            json={
                "id": "resp_spark",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(ASSESSMENT)}]}],
                "usage": {"input_tokens": 1300, "output_tokens": 120},
            },
        )

    return handler


def _submit_clip(client: TestClient, image_bytes: bytes, category: str = "flooding") -> dict[str, Any]:
    clip = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 4096
    sent = client.post(
        "/api/v1/reports",
        data={"description": "Water across the whole road", "category": category},
        files={"image": ("photo.jpg", image_bytes, "image/jpeg"), "video": ("clip.mp4", clip, "video/mp4")},
    )
    assert sent.status_code == 201, sent.text
    return sent.json()


def _track(db: Any, report_id: str) -> Any:
    return db.scalar(select(VideoTrack).where(VideoTrack.report_id == uuid.UUID(report_id)))


def _video_job(db: Any, report_id: str) -> Any:
    return db.scalar(
        select(ProcessingJob).where(
            ProcessingJob.kind == JobKind.analyze_video,
            ProcessingJob.report_id == uuid.UUID(report_id),
        )
    )


def _run_video_job(report_id: str) -> None:
    with session_scope() as db:
        job = _video_job(db, report_id)
        assert job is not None
        args = (job.id, job.kind, job.report_id, job.segmentation_id, dict(job.options or {}), 1, job.max_attempts)
    process(*args)


def test_clip_chains_off_photo_analysis(reviewer: TestClient, image_bytes: bytes, no_ffmpeg: None) -> None:
    body = _submit_clip(reviewer, image_bytes)
    _queue_follow_ups(uuid.UUID(body["id"]), segment=False)
    with session_scope() as db:
        track = _track(db, body["id"])
        assert track is not None and track.status == VideoStatus.queued
        assert _video_job(db, body["id"]) is not None


def test_video_pipeline_end_to_end(reviewer: TestClient, image_bytes: bytes, no_ffmpeg: None, fake_meta: Any) -> None:
    seen: list[Any] = []
    fake_meta(_video_meta(seen))
    body = _submit_clip(reviewer, image_bytes)
    _queue_follow_ups(uuid.UUID(body["id"]), segment=False)
    _run_video_job(body["id"])

    with session_scope() as db:
        track = _track(db, body["id"])
        assert track is not None and track.status == VideoStatus.completed
        assert track.concept == "water" and track.file_id == "file-test"
        assert track.tracked_objects == 2 and len(track.frames or []) == 3
        assert (track.assessment or {})["motion"].startswith("Water flows")
        stills = db.scalars(
            select(Media).where(Media.report_id == uuid.UUID(body["id"]), Media.variant == MediaVariant.tracked_still)
        ).all()
        assert len(stills) == 3
        ops = sorted(
            (c.operation.value, c.endpoint)
            for c in db.scalars(select(ModelCall).where(ModelCall.report_id == uuid.UUID(body["id"])))
        )
        assert ops == [
            ("file_upload", "files"),
            ("video_description", "responses"),
            ("video_tracking", "responses:stream"),
        ]
        tracked = db.scalar(select(ModelCall).where(ModelCall.operation == ModelOperation.video_tracking))
        assert tracked is not None and tracked.video_frames == 50

    spark_body = seen[0]
    parts = spark_body["input"][0]["content"]
    assert parts[1] == {"type": "input_file", "file_id": "file-test"}

    detail = reviewer.get(f"/api/v1/reports/{body['id']}").json()
    assert detail["has_video"] is True
    video = detail["video"]
    assert video["status"] == "completed" and video["concept"] == "water"
    assert video["clip"] is not None and len(video["stills"]) == 3
    assert video["stills"][0]["track_count"] == 2 and video["assessment"]["hazard_visible"] is True
    assert reviewer.get(video["clip"]["url"]).status_code == 200


def test_resident_sees_own_clip(client: TestClient, image_bytes: bytes, no_ffmpeg: None, fake_meta: Any) -> None:
    fake_meta(_video_meta([]))
    body = _submit_clip(client, image_bytes)
    _queue_follow_ups(uuid.UUID(body["id"]), segment=False)
    _run_video_job(body["id"])
    detail = client.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    assert detail["video"] is not None and detail["video"]["clip"] is not None
    assert client.get(detail["video"]["clip"]["url"]).status_code == 200


def test_report_without_clip_has_no_video(reviewer: TestClient, image_bytes: bytes) -> None:
    body = submit(reviewer, image_bytes).json()
    detail = reviewer.get(f"/api/v1/reports/{body['id']}").json()
    assert detail["has_video"] is False and detail["video"] is None
