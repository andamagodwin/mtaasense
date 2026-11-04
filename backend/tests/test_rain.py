import uuid
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db.models import Report
from app.db.models.enums import ReportStatus
from app.db.session import session_scope
from app.services import rain
from app.services.rain import RainUnavailable, fetch_forecast, get_warning, summarise
from tests.conftest import submit

KAMPALA = ZoneInfo("Africa/Kampala")


@pytest.fixture(autouse=True)
def _fresh_cache() -> Any:
    rain.clear_cache()
    yield
    rain.clear_cache()


@pytest.fixture
def rain_on(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "rain_enabled", True)


def _hourly(amounts: list[float], start: datetime | None = None) -> dict[str, Any]:
    start = start or datetime.now(KAMPALA).replace(minute=0, second=0, microsecond=0)
    return {
        "time": [(start + timedelta(hours=i)).isoformat() for i in range(len(amounts))],
        "precipitation": amounts,
    }


def _heavy(monkeypatch: pytest.MonkeyPatch, total: float = 12.5) -> None:
    assert total >= 10.0
    rest = total - 7.5
    monkeypatch.setattr(rain, "fetch_forecast", lambda client: _hourly([0.0, 7.5, rest] + [0.0] * 45))


def _dry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rain, "fetch_forecast", lambda client: _hourly([0.0] * 48))


def test_heavy_rain_activates_at_threshold() -> None:
    now = datetime.now(KAMPALA)
    total, peak_time, peak_mm = summarise(_hourly([0.0, 6.0, 4.0] + [0.0] * 45), now)
    assert total == 10.0 and peak_mm == 6.0 and peak_time is not None
    total_below, _, _ = summarise(_hourly([0.0, 6.0, 3.9] + [0.0] * 45), now)
    assert total_below < 10.0


def test_window_ignores_past_and_distant_hours() -> None:
    now = datetime.now(KAMPALA).replace(minute=0, second=0, microsecond=0)
    hourly = _hourly([50.0] + [0.0] * 25 + [50.0] + [0.0] * 21, start=now - timedelta(hours=1))
    total, _, _ = summarise(hourly, now + timedelta(minutes=30))
    assert total == 0.0  # the wet hours are behind us and beyond the 24h window


def test_missing_values_count_as_dry() -> None:
    now = datetime.now(KAMPALA)
    hourly = _hourly([0.0] * 48)
    hourly["precipitation"] = [None, None, 12.0] + [0.0] * 45
    total, _, peak = summarise(hourly, now)
    assert total == 12.0 and peak == 12.0


def test_fetch_parses_open_meteo_payload() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["timezone"] == "Africa/Kampala"
        assert "precipitation" in request.url.params["hourly"]
        return httpx.Response(200, json={"hourly": {"time": ["2026-11-04T07:00"], "precipitation": [3.5]}})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert fetch_forecast(client) == {"time": ["2026-11-04T07:00"], "precipitation": [3.5]}


def test_fetch_failure_is_unavailable() -> None:
    down = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(500, json={})))
    with pytest.raises(RainUnavailable):
        fetch_forecast(down)
    weird = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, json={"hourly": {}})))
    with pytest.raises(RainUnavailable):
        fetch_forecast(weird)


def test_warning_is_cached(rain_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def counting(client: httpx.Client) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        return _hourly([0.0, 11.0] + [0.0] * 46)

    monkeypatch.setattr(rain, "fetch_forecast", counting)
    first, second = get_warning(), get_warning()
    assert calls == 1 and first.active and second is first


def test_provider_outage_means_no_warning(rain_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    def failing(client: httpx.Client) -> dict[str, Any]:
        raise RainUnavailable("connect_error")

    monkeypatch.setattr(rain, "fetch_forecast", failing)
    warning = get_warning()
    assert warning.active is False and warning.available is False


def test_disabled_means_no_warning() -> None:
    assert get_warning().available is False  # RAIN_ENABLED=false in tests


def test_rain_endpoint_when_heavy(client: TestClient, rain_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    _heavy(monkeypatch)
    body = client.get("/api/v1/rain").json()
    assert body["active"] is True and body["available"] is True
    assert body["expected_mm_24h"] == 12.5 and body["threshold_mm"] == 10.0
    assert body["peak_hour_mm"] == 7.5 and body["peak_hour"] is not None
    assert body["source"] == "open-meteo" and body["fetched_at"] is not None


def test_rain_endpoint_when_dry(client: TestClient, rain_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    _dry(monkeypatch)
    body = client.get("/api/v1/rain").json()
    assert body["active"] is False and body["available"] is True and body["expected_mm_24h"] == 0.0


def _under_review(report_id: str) -> None:
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None
        report.status = ReportStatus.under_review


def test_blocked_drains_jump_the_queue_when_heavy(
    reviewer: TestClient, image_bytes: bytes, rain_on: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _heavy(monkeypatch)
    drain = submit(reviewer, image_bytes, category="blocked_drainage").json()["id"]
    pothole = submit(reviewer, image_bytes, category="pothole").json()["id"]
    _under_review(drain)
    _under_review(pothole)
    page = reviewer.get("/api/v1/reports", params={"status": "under_review"}).json()
    assert page["rain_boosted"] is True
    assert [r["id"] for r in page["items"]] == [drain, pothole]  # drain first despite older


def test_queue_stays_chronological_when_dry(
    reviewer: TestClient, image_bytes: bytes, rain_on: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _dry(monkeypatch)
    drain = submit(reviewer, image_bytes, category="blocked_drainage").json()["id"]
    pothole = submit(reviewer, image_bytes, category="pothole").json()["id"]
    _under_review(drain)
    _under_review(pothole)
    page = reviewer.get("/api/v1/reports", params={"status": "under_review"}).json()
    assert page["rain_boosted"] is False
    assert [r["id"] for r in page["items"]] == [pothole, drain]
