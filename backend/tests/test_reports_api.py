from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import ProcessingJob, Report
from app.db.session import session_scope
from tests.conftest import make_image, submit


def test_health_and_ready(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
    ready = client.get("/ready").json()
    assert ready["database"] == "ok" and ready["migrations"] == "ok" and ready["media_storage"] == "ok"
    assert ready["model_api"] == "not_configured"


def test_submit_report_persists_evidence_and_queues_job(client: TestClient, image_bytes: bytes) -> None:
    res = submit(
        client,
        image_bytes,
        category="pothole",
        lat=0.3476,
        lon=32.5825,
        location_source="map_pin",
        location_note="Opposite the fuel station",
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["reference"].startswith("MS-") and body["status"] == "submitted" and body["job_id"]

    with session_scope() as db:
        report = db.get(Report, body["id"])
        assert report is not None
        assert report.description == "Large pothole near the market entrance"
        assert report.hazard_category is not None and report.hazard_category.value == "pothole"
        assert report.image.sha256 and report.display_image.width == 640
        assert report.receipt_token_hash != body["receipt_token"]  # only the hash is stored
        job = db.scalar(select(ProcessingJob).where(ProcessingJob.report_id == report.id))
        assert job is not None and job.kind.value == "analyze_report"


def test_photo_and_text_without_location_is_accepted(client: TestClient, image_bytes: bytes) -> None:
    res = submit(client, image_bytes)
    assert res.status_code == 201
    detail = client.get(
        f"/api/v1/reports/{res.json()['id']}", headers={"X-Report-Token": res.json()["receipt_token"]}
    ).json()
    assert detail["location"] is None and detail["location_source"] == "none"


def test_rejects_non_image_upload(client: TestClient) -> None:
    res = client.post(
        "/api/v1/reports",
        data={"description": "pothole here please fix"},
        files={"image": ("photo.jpg", b"%PDF-1.4 not an image at all" * 20, "image/jpeg")},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_image"


def test_rejects_missing_description(client: TestClient, image_bytes: bytes) -> None:
    res = submit(client, image_bytes, description="")
    assert res.status_code == 422 and res.json()["error"]["code"] == "description_required"


def test_rejects_location_outside_uganda(client: TestClient, image_bytes: bytes) -> None:
    res = submit(client, image_bytes, lat=51.5, lon=-0.12, location_source="map_pin")
    assert res.status_code == 422 and res.json()["error"]["code"] == "location_out_of_area"


def test_rejects_tiny_image(client: TestClient) -> None:
    res = submit(client, make_image(32, 32))
    assert res.status_code == 422 and res.json()["error"]["code"] == "image_too_small"


def test_idempotent_retry_returns_same_report(client: TestClient, image_bytes: bytes) -> None:
    key = "retry-key-0123456789abcdef"
    first = submit(client, image_bytes, idempotency_key=key)
    second = submit(client, image_bytes, idempotency_key=key)
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["receipt_token"] == second.json()["receipt_token"]
    assert second.json()["duplicate_of_request"] is True
    with session_scope() as db:
        assert len(db.scalars(select(Report)).all()) == 1


def test_receipt_token_controls_access(client: TestClient, image_bytes: bytes) -> None:
    body = submit(client, image_bytes).json()
    url = f"/api/v1/reports/{body['id']}"
    assert client.get(url).status_code == 404
    assert client.get(url, headers={"X-Report-Token": "wrong"}).status_code == 404
    ok = client.get(url, headers={"X-Report-Token": body["receipt_token"]})
    assert ok.status_code == 200 and ok.json()["reference"] == body["reference"]
    assert ok.json()["allowed_actions"] == []  # residents can't take reviewer actions


def test_media_requires_valid_signature(client: TestClient, image_bytes: bytes) -> None:
    body = submit(client, image_bytes).json()
    detail = client.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    url = detail["image"]["url"]
    ok = client.get(url)
    assert ok.status_code == 200 and ok.headers["content-type"] == "image/jpeg"
    assert ok.content[:3] == b"\xff\xd8\xff"
    tampered = url.replace("sig=", "sig=0")
    assert client.get(tampered).status_code == 404
    expired = url.split("?")[0] + "?exp=1000&sig=" + url.split("sig=")[1]
    assert client.get(expired).status_code == 404


def test_display_variant_strips_exif(client: TestClient) -> None:
    from PIL import Image

    img = Image.new("RGB", (400, 300), (10, 120, 30))
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    import io

    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    body = submit(client, buf.getvalue()).json()
    detail = client.get(f"/api/v1/reports/{body['id']}", headers={"X-Report-Token": body["receipt_token"]}).json()
    shown = client.get(detail["image"]["url"]).content
    assert b"PhoneMaker" not in shown
    assert b"PhoneMaker" in client.get(detail["original_image"]["url"]).content  # original preserved
