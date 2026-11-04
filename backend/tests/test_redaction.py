import io
import json
import uuid
from typing import Any

import httpx
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.db.models import FixCheck, Media, ModelCall, ProcessingJob, Redaction, Report
from app.db.models.enums import JobKind, MediaVariant, ModelOperation, Provenance, ReportStatus
from app.db.session import session_scope
from app.services.redaction import blur_regions
from app.workers.runner import process
from tests.conftest import make_image, sam_sse, submit


def _half_red_half_blue(width: int = 200, height: int = 200) -> bytes:
    img = Image.new("RGB", (width, height))
    img.paste((255, 0, 0), (0, 0, width // 2, height))
    img.paste((0, 0, 255), (width // 2, 0, width, height))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def test_blur_only_touches_detected_boxes() -> None:
    raw = _half_red_half_blue()
    # A box straddling the red/blue edge.
    regions = [{"box": {"left": 80, "top": 0, "right": 120, "bottom": 200}}]
    out = Image.open(io.BytesIO(blur_regions(raw, regions, 200, 200)))
    assert out.size == (200, 200)

    edge = out.getpixel((100, 100))
    assert isinstance(edge, tuple)
    assert edge[0] > 50 and edge[2] > 50  # the sharp edge is now mixed

    far = out.getpixel((10, 10))
    assert isinstance(far, tuple)
    assert far[0] > 200 and far[2] < 60  # far from the box, still red


def test_blur_with_no_regions_keeps_dimensions() -> None:
    out = Image.open(io.BytesIO(blur_regions(make_image(), [], 640, 480)))
    assert out.size == (640, 480)


def _sam_findings(_: Any) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content).get("stream") is True
        return httpx.Response(200, text=sam_sse(), headers={"content-type": "text/event-stream"})

    return handler


def _run_redact_job(display_id: Any) -> None:
    with session_scope() as db:
        job = db.scalar(
            select(ProcessingJob).where(
                ProcessingJob.kind == JobKind.redact_image, ProcessingJob.dedupe_key == f"redact:{display_id}"
            )
        )
        assert job is not None
        args = (job.id, job.kind, job.report_id, job.segmentation_id, dict(job.options or {}), 1, job.max_attempts)
    process(*args)


def _display_id(report_id: str) -> Any:
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None
        return report.display_media_id


def _resident() -> TestClient:
    from app.main import app

    return TestClient(app)


def test_submit_queues_a_redaction(client: TestClient, image_bytes: bytes) -> None:
    body = submit(client, image_bytes).json()
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(body["id"]))
        assert report is not None
        red = db.scalar(select(Redaction).where(Redaction.media_id == report.display_media_id))
        assert red is not None and red.status.value == "queued" and red.redacted_media_id is None


def test_resident_sees_placeholder_until_blur_is_ready(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    fake_meta(_sam_findings(None))
    body = submit(client, image_bytes).json()
    detail = client.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    assert detail["image"] is None and detail["thumbnail"] is None
    assert detail["redacted"] is False and detail["redaction_status"] == "queued"
    assert detail["original_image"] is None  # the original stays private for reviewers


def test_resident_gets_blurred_photo_once_ready(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    seen = fake_meta(_sam_findings(None))
    body = submit(client, image_bytes).json()
    _run_redact_job(_display_id(body["id"]))

    assert len(seen) == 2  # one SAM call per privacy concept
    prompts = [json.loads(r.content)["input"][0]["content"][0]["text"] for r in seen]
    assert prompts == ["face", "number plate"]

    resident = _resident()
    detail = resident.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    assert detail["redacted"] is True and detail["redaction_status"] == "completed"
    assert detail["image"] is not None and detail["thumbnail"] is not None
    shown = resident.get(detail["image"]["url"])
    assert shown.status_code == 200 and shown.headers["content-type"] == "image/jpeg"

    with session_scope() as db:
        ops = sorted(c.operation for c in db.scalars(select(ModelCall)).all())
        assert ops == [ModelOperation.redaction, ModelOperation.redaction]
        red = db.scalar(select(Redaction).where(Redaction.media_id == _display_id(body["id"])))
        assert red is not None and red.provenance == Provenance.live
        assert red.redacted_media_id is not None
        blurred = db.get(Media, red.redacted_media_id)
        assert blurred is not None and blurred.variant == MediaVariant.redacted
        assert (blurred.width, blurred.height) == (640, 480)  # same frame, so overlays still align
        assert len(red.regions or []) == 4  # two faces-plus-plates findings per concept in the fixture


def test_reviewer_keeps_unblurred_photos(reviewer: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    fake_meta(_sam_findings(None))
    body = submit(reviewer, image_bytes).json()
    _run_redact_job(_display_id(body["id"]))
    detail = reviewer.get(f"/api/v1/reports/{body['id']}").json()
    assert detail["redacted"] is False and detail["redaction_status"] is None
    assert detail["image"] is not None and detail["original_image"] is not None
    assert detail["image"]["id"] != detail["original_image"]["id"]


def test_failed_blur_falls_back_to_display(client: TestClient, image_bytes: bytes) -> None:
    body = submit(client, image_bytes).json()
    _run_redact_job(_display_id(body["id"]))  # no API key: not_configured, not retried
    detail = client.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    assert detail["image"] is not None and detail["redacted"] is False
    assert detail["redaction_status"] == "failed"


def test_unconfigured_ai_falls_back_to_display(client: TestClient, image_bytes: bytes) -> None:
    body = submit(client, image_bytes).json()
    detail = client.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    assert detail["image"] is not None and detail["thumbnail"] is not None
    assert detail["redacted"] is False and detail["redaction_status"] == "queued"


def test_lazy_ensure_redacts_legacy_photos(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    fake_meta(_sam_findings(None))
    body = submit(client, image_bytes).json()
    display_id = _display_id(body["id"])
    with session_scope() as db:  # simulate a photo uploaded before the privacy blur existed
        red = db.scalar(select(Redaction).where(Redaction.media_id == display_id))
        assert red is not None
        db.delete(red)
        job = db.scalar(
            select(ProcessingJob).where(
                ProcessingJob.kind == JobKind.redact_image, ProcessingJob.dedupe_key == f"redact:{display_id}"
            )
        )
        assert job is not None
        db.delete(job)
        db.commit()

    first = client.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    assert first["image"] is None and first["redaction_status"] == "queued"
    _run_redact_job(display_id)
    second = client.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    assert second["redacted"] is True and second["image"] is not None


def test_fix_check_after_photo_is_blurred_for_residents(
    reviewer: TestClient, image_bytes: bytes, fake_meta: Any
) -> None:
    fake_meta(_sam_findings(None))
    created = submit(reviewer, image_bytes, category="pothole").json()
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(created["id"]))
        assert report is not None
        report.status = ReportStatus.under_review
    reviewer.post(f"/api/v1/reports/{created['id']}/review", json={"action": "confirm_incident"})

    resident = _resident()
    sent = resident.post(
        f"/api/v1/reports/{created['id']}/fix-checks",
        headers={"X-Report-Token": created["receipt_token"]},
        files={"image": ("after.jpg", make_image(color=(60, 60, 60)), "image/jpeg")},
    )
    assert sent.status_code == 202, sent.text
    assert sent.json()["after"]["image"] is None  # blur queued with the upload

    with session_scope() as db:
        check_id = uuid.UUID(sent.json()["id"])
        check = db.get(FixCheck, check_id)
        assert check is not None
        after_display = check.display_media_id
    _run_redact_job(after_display)

    seen_by_resident = resident.get(
        f"/api/v1/reports/{created['id']}", headers={"X-Report-Token": created["receipt_token"]}
    ).json()["fix_checks"][0]
    assert seen_by_resident["after"]["image"] is not None and seen_by_resident["after"]["redacted"] is True
    seen_by_reviewer = reviewer.get(f"/api/v1/reports/{created['id']}").json()["fix_checks"][0]
    assert seen_by_reviewer["after"]["image"] is not None and seen_by_reviewer["after"]["redacted"] is False
