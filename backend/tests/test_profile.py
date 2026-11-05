import uuid

from fastapi.testclient import TestClient

from app.db.models import Report
from app.db.models.enums import ReportStatus
from app.db.session import session_scope
from tests.conftest import make_image, submit

EMAIL, PASSWORD = "reviewer@test.local", "reviewer-password-123"


def _login(client: TestClient, password: str = PASSWORD) -> int:
    return client.post("/api/v1/auth/login", json={"email": EMAIL, "password": password}).status_code


def test_update_display_name(reviewer: TestClient) -> None:
    res = reviewer.patch("/api/v1/auth/me", json={"display_name": "  Grace Namaganda "})
    assert res.status_code == 200, res.text
    assert res.json()["display_name"] == "Grace Namaganda"
    assert reviewer.get("/api/v1/auth/session").json()["user"]["display_name"] == "Grace Namaganda"
    assert reviewer.patch("/api/v1/auth/me", json={"display_name": "x"}).status_code == 422


def test_change_password_signs_out_other_sessions(reviewer: TestClient, client: TestClient) -> None:
    from app.main import app

    other = TestClient(app)
    assert other.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code == 200
    assert len(reviewer.get("/api/v1/auth/sessions").json()) == 2

    wrong = reviewer.post(
        "/api/v1/auth/password", json={"current_password": "nope", "new_password": "a-new-password-456"}
    )
    assert wrong.status_code == 422 and wrong.json()["error"]["code"] == "wrong_password"
    short = reviewer.post("/api/v1/auth/password", json={"current_password": PASSWORD, "new_password": "short"})
    assert short.status_code == 422

    ok = reviewer.post(
        "/api/v1/auth/password", json={"current_password": PASSWORD, "new_password": "a-new-password-456"}
    )
    assert ok.status_code == 204, ok.text
    # This session stays signed in; the other one is signed out.
    sessions = reviewer.get("/api/v1/auth/sessions").json()
    assert [s["current"] for s in sessions] == [True]
    assert other.get("/api/v1/auth/session").json()["user"] is None
    reviewer.cookies.clear()
    assert _login(reviewer) == 401
    assert _login(reviewer, "a-new-password-456") == 200


def test_sign_out_other_devices(reviewer: TestClient) -> None:
    from app.main import app

    other = TestClient(app)
    other.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    res = reviewer.post("/api/v1/auth/sessions/revoke-others")
    assert res.json() == {"revoked": 1}
    assert other.get("/api/v1/auth/session").json()["user"] is None
    assert reviewer.get("/api/v1/auth/session").json()["user"]["email"] == EMAIL


def test_activity_lists_my_decisions(reviewer: TestClient) -> None:
    report_id = submit(reviewer, make_image(), category="pothole").json()["id"]
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None
        report.status = ReportStatus.under_review
        reference = report.reference
    reviewer.post(f"/api/v1/reports/{report_id}/review", json={"action": "reject", "note": "No hazard"})

    activity = reviewer.get("/api/v1/auth/me/activity").json()
    assert activity["counts"] == {"report_reject": 1}  # sign-ins are not decisions
    assert activity["recent"][0]["action"] == "report_reject"
    assert activity["recent"][0]["report"]["reference"] == reference
    assert activity["recent"][0]["note"] == "No hazard"


def test_account_endpoints_need_a_reviewer(client: TestClient) -> None:
    assert client.get("/api/v1/auth/me/activity").status_code == 401
    assert client.patch("/api/v1/auth/me", json={"display_name": "Someone"}).status_code == 401
