import json
import uuid
from typing import Any

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import FixCheck, ModelCall, ProcessingJob, Report
from app.db.models.enums import FixCheckStatus, JobKind, ReportStatus
from app.db.session import session_scope
from app.workers.runner import process
from tests.conftest import make_image, responses_body, sam_sse, submit

FIX_ASSESSMENT: dict[str, Any] = {
    "same_place": "same",
    "verdict": "repaired",
    "before_condition": "A deep pothole with broken edges in the left lane.",
    "after_condition": "The same lane with a fresh, level asphalt patch.",
    "visible_changes": "The pothole has been filled and sealed.",
    "reasoning": "The kerb and the drain cover match, and the depression is gone.",
    "remaining_concerns": ["The patch edges may need sealing after rain."],
}


def _no_matches() -> str:
    events = [
        {"type": "response.created", "response": {"id": "resp_sam_2", "status": "in_progress"}},
        {"type": "response.completed", "response": {"id": "resp_sam_2", "status": "completed"}},
    ]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)


def _fake_model(fake_meta: Any, verdict: dict[str, Any] = FIX_ASSESSMENT) -> list[httpx.Request]:
    """Muse Spark returns `verdict`; SAM finds the pothole in the first photo and nothing in the second."""
    sam_calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body.get("stream"):
            sam_calls.append(1)
            text = sam_sse() if len(sam_calls) == 1 else _no_matches()
            return httpx.Response(200, text=text, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json=responses_body(verdict))

    seen: list[httpx.Request] = fake_meta(handler)
    return seen


def _confirmed_report(reviewer: TestClient) -> tuple[str, str, str]:
    """A resident's report confirmed as an incident. Returns (report_id, receipt_token, incident_id)."""
    created = submit(reviewer, make_image(), category="pothole", lat=0.3576, lon=32.6952, location_source="map_pin")
    report_id, token = created.json()["id"], created.json()["receipt_token"]
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None
        report.status = ReportStatus.under_review
    detail = reviewer.post(f"/api/v1/reports/{report_id}/review", json={"action": "confirm_incident"}).json()
    return report_id, token, detail["incident"]["id"]


def _run_fix_job(check_id: str) -> None:
    with session_scope() as db:
        job = db.scalar(
            select(ProcessingJob).where(
                ProcessingJob.kind == JobKind.verify_fix, ProcessingJob.dedupe_key == f"fix:{check_id}"
            )
        )
        assert job is not None
        args = (job.id, job.kind, job.report_id, job.segmentation_id, dict(job.options or {}), 1, job.max_attempts)
    process(*args)


def _anonymous() -> TestClient:
    from app.main import app

    return TestClient(app)


def test_resident_fix_check_end_to_end(reviewer: TestClient, fake_meta: Any) -> None:
    report_id, token, incident_id = _confirmed_report(reviewer)
    seen = _fake_model(fake_meta)

    resident = _anonymous()
    sent = resident.post(
        f"/api/v1/reports/{report_id}/fix-checks",
        headers={"X-Report-Token": token},
        data={"note": "Crew came on Monday"},
        files={"image": ("after.jpg", make_image(color=(60, 60, 60)), "image/jpeg")},
    )
    assert sent.status_code == 202, sent.text
    check = sent.json()
    assert check["status"] == "queued" and check["submitted_by"] == "Resident"
    _run_fix_job(check["id"])

    compare = json.loads(seen[0].content)
    assert compare["model"] == "muse-spark-1.3"
    assert compare["text"]["format"]["name"] == "fix_assessment" and compare["text"]["format"]["strict"] is True
    content = compare["input"][0]["content"]
    assert [part["type"] for part in content].count("input_image") == 2
    assert "Crew came on Monday" in content[0]["text"]  # the note is passed as data

    result = resident.get(f"/api/v1/reports/{report_id}", headers={"X-Report-Token": token}).json()["fix_checks"][0]
    assert result["status"] == "completed" and result["verdict"] == "repaired" and result["provenance"] == "live"
    assert result["assessment"]["same_place"] == "same"
    assert result["concept"] == "pothole"
    assert result["before"]["coverage"] > 0 and result["after"]["coverage"] == 0
    assert len(result["before"]["regions"]) == 2 and result["after"]["regions"] == []
    with session_scope() as db:
        ops = sorted(c.operation.value for c in db.scalars(select(ModelCall)))
    assert ops == ["fix_verification", "segmentation", "segmentation"]

    # The check is advice: the incident stays open until a reviewer resolves it, citing the check.
    assert reviewer.get(f"/api/v1/incidents/{incident_id}").json()["status"] == "confirmed"
    resolved = reviewer.patch(
        f"/api/v1/incidents/{incident_id}",
        json={
            "status": "resolved",
            "resolution_note": "Repair confirmed by the resident's photo.",
            "fix_check_id": check["id"],
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["resolution_check"]["verdict"] == "repaired"

    public = resident.get(f"/api/v1/incidents/{incident_id}").json()
    assert public["resolution_check"]["id"] == check["id"] and public["fix_checks"] is None


def test_fix_check_needs_a_confirmed_incident_and_the_receipt(reviewer: TestClient) -> None:
    created = submit(reviewer, make_image()).json()
    resident = _anonymous()
    photo = {"image": ("after.jpg", make_image(), "image/jpeg")}
    unconfirmed = resident.post(
        f"/api/v1/reports/{created['id']}/fix-checks", headers={"X-Report-Token": created["receipt_token"]}, files=photo
    )
    assert unconfirmed.status_code == 409

    report_id, _, _ = _confirmed_report(reviewer)
    wrong_token = resident.post(
        f"/api/v1/reports/{report_id}/fix-checks", headers={"X-Report-Token": "not-the-token"}, files=photo
    )
    assert wrong_token.status_code == 404


def test_resolution_only_cites_completed_checks_of_the_incident(reviewer: TestClient) -> None:
    _, _, incident_id = _confirmed_report(reviewer)
    pending = reviewer.post(
        f"/api/v1/incidents/{incident_id}/fix-checks", files={"image": ("after.jpg", make_image(), "image/jpeg")}
    )
    assert pending.status_code == 202 and pending.json()["submitted_by"] == "Reviewer"
    res = reviewer.patch(
        f"/api/v1/incidents/{incident_id}",
        json={"status": "resolved", "resolution_note": "Looks fixed", "fix_check_id": pending.json()["id"]},
    )
    assert res.status_code == 422 and res.json()["error"]["code"] == "invalid_fix_check"


def test_failed_fix_check_is_recorded(reviewer: TestClient, fake_meta: Any) -> None:
    _, _, incident_id = _confirmed_report(reviewer)
    fake_meta(lambda request: httpx.Response(401, json={"error": {"message": "bad key"}}))
    check = reviewer.post(
        f"/api/v1/incidents/{incident_id}/fix-checks", files={"image": ("after.jpg", make_image(), "image/jpeg")}
    ).json()
    _run_fix_job(check["id"])
    with session_scope() as db:
        stored = db.get(FixCheck, uuid.UUID(check["id"]))
        assert stored is not None
        assert stored.status == FixCheckStatus.failed and stored.error_code == "auth_failed"
        assert stored.verdict is None
