from fastapi.testclient import TestClient

from tests.conftest import create_user, submit


def test_login_rejects_bad_password(client: TestClient) -> None:
    create_user("r@test.local", "correct-password-1", "reviewer")
    res = client.post("/api/v1/auth/login", json={"email": "r@test.local", "password": "wrong"})
    assert res.status_code == 401 and res.json()["error"]["code"] == "invalid_credentials"
    assert client.post("/api/v1/auth/login", json={"email": "nobody@test.local", "password": "x"}).status_code == 401


def test_session_cookie_is_httponly(client: TestClient) -> None:
    create_user("r@test.local", "correct-password-1", "reviewer")
    res = client.post("/api/v1/auth/login", json={"email": "R@test.local", "password": "correct-password-1"})
    assert res.status_code == 200
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/v1/auth/session").json()["user"]["role"] == "reviewer"


def test_reviewer_endpoints_require_session(client: TestClient, image_bytes: bytes) -> None:
    report_id = submit(client, image_bytes).json()["id"]
    assert client.get("/api/v1/reports").status_code == 401
    assert client.get("/api/v1/review/summary").status_code == 401
    assert client.post(f"/api/v1/reports/{report_id}/review", json={"action": "reject"}).status_code == 401
    assert client.post(f"/api/v1/reports/{report_id}/analyze").status_code == 401
    assert client.get("/api/v1/admin/usage").status_code == 401


def test_role_sent_by_client_is_ignored(client: TestClient) -> None:
    # There is no way to claim a role: only the server-side session decides.
    res = client.get("/api/v1/reports", headers={"X-Role": "admin", "Cookie": "role=admin"})
    assert res.status_code == 401


def test_reviewer_cannot_read_admin_usage(reviewer: TestClient) -> None:
    assert reviewer.get("/api/v1/reports").status_code == 200
    assert reviewer.get("/api/v1/admin/usage").status_code == 403


def test_logout_revokes_session(reviewer: TestClient) -> None:
    assert reviewer.post("/api/v1/auth/logout").status_code == 204
    assert reviewer.get("/api/v1/auth/session").json() == {"user": None}
    assert reviewer.get("/api/v1/reports").status_code == 401


def test_cross_origin_write_with_cookie_is_blocked(reviewer: TestClient, image_bytes: bytes) -> None:
    report_id = submit(reviewer, image_bytes).json()["id"]
    res = reviewer.post(
        f"/api/v1/reports/{report_id}/review", json={"action": "reject"}, headers={"Origin": "https://evil.example"}
    )
    assert res.status_code == 403 and res.json()["error"]["code"] == "origin_not_allowed"


def test_admin_usage_report(client: TestClient) -> None:
    create_user("a@test.local", "admin-password-123", "admin")
    client.post("/api/v1/auth/login", json={"email": "a@test.local", "password": "admin-password-123"})
    body = client.get("/api/v1/admin/usage").json()
    assert body["estimated_total_usd"] == "0.0000" and body["budget_exhausted"] is False
    assert "not the account balance" in body["note"]
