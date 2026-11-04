"""Rain-aware early warning.

One Kampala-wide forecast from Open-Meteo (free, no key): when heavy rain is expected in the
next 24 hours, the map shows a warning, blocked drains jump to the top of the review queue,
and the app lists open drain incidents to clear. The forecast is cached in-process; when the
provider is unreachable there is simply no warning, never an error page.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from app.core.config import get_settings
from app.core.logging import log_event

logger = logging.getLogger(__name__)

KAMPALA_LAT = 0.3476
KAMPALA_LON = 32.5825
KAMPALA_TZ = ZoneInfo("Africa/Kampala")
_API_URL = "https://api.open-meteo.com/v1/forecast"
_WINDOW_HOURS = 24


class RainUnavailable(Exception):
    """The provider call failed or its payload was unusable. Callers treat this as 'no warning'."""


@dataclass(frozen=True)
class RainWarning:
    active: bool
    available: bool
    expected_mm_24h: float
    peak_hour: datetime | None
    peak_hour_mm: float | None
    fetched_at: datetime | None
    threshold_mm: float


def fetch_forecast(client: httpx.Client) -> dict[str, Any]:
    """One Open-Meteo call for Kampala's hourly precipitation. Raises RainUnavailable."""
    try:
        response = client.get(
            _API_URL,
            params={
                "latitude": KAMPALA_LAT,
                "longitude": KAMPALA_LON,
                "hourly": "precipitation",
                "forecast_days": 2,
                "timezone": "Africa/Kampala",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RainUnavailable(type(exc).__name__) from exc
    hourly = body.get("hourly") if isinstance(body, dict) else None
    if (
        not isinstance(hourly, dict)
        or not isinstance(hourly.get("time"), list)
        or not isinstance(hourly.get("precipitation"), list)
        or len(hourly["time"]) != len(hourly["precipitation"])
    ):
        raise RainUnavailable("unexpected_payload")
    return {"time": hourly["time"], "precipitation": hourly["precipitation"]}


def summarise(hourly: dict[str, Any], now: datetime) -> tuple[float, datetime | None, float | None]:
    """Next-24h total and wettest hour from hourly arrays. Times are Kampala-local ISO strings."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=KAMPALA_TZ)
    end = now + timedelta(hours=_WINDOW_HOURS)
    total = 0.0
    peak_time: datetime | None = None
    peak_mm: float | None = None
    for stamp, mm in zip(hourly["time"], hourly["precipitation"], strict=True):
        try:
            hour = datetime.fromisoformat(stamp)
        except (ValueError, TypeError):
            continue
        if hour.tzinfo is None:
            hour = hour.replace(tzinfo=KAMPALA_TZ)
        if not now < hour <= end:
            continue
        amount = mm if isinstance(mm, (int, float)) else 0.0
        total += amount
        if peak_mm is None or amount > peak_mm:
            peak_mm, peak_time = amount, hour
    return total, peak_time, peak_mm


_cache: dict[str, Any] = {}


def clear_cache() -> None:
    _cache.clear()


def _cached() -> RainWarning | None:
    warning = _cache.get("warning")
    expires = _cache.get("expires")
    if isinstance(warning, RainWarning) and isinstance(expires, datetime) and datetime.now(UTC) < expires:
        return warning
    return None


def get_warning(client: httpx.Client | None = None) -> RainWarning:
    """The current warning, cached. Never raises for provider problems."""
    settings = get_settings()
    if not settings.rain_enabled:
        return RainWarning(False, False, 0.0, None, None, None, settings.rain_heavy_mm_24h)
    if (hit := _cached()) is not None and hit.threshold_mm == settings.rain_heavy_mm_24h:
        return hit
    own_client = client is None
    client = client or httpx.Client()
    try:
        try:
            hourly = fetch_forecast(client)
        except RainUnavailable as exc:
            log_event(logger, "rain_unavailable", logging.WARNING, reason=str(exc))
            return RainWarning(False, False, 0.0, None, None, None, settings.rain_heavy_mm_24h)
        total, peak_time, peak_mm = summarise(hourly, datetime.now(KAMPALA_TZ))
        warning = RainWarning(
            active=total >= settings.rain_heavy_mm_24h,
            available=True,
            expected_mm_24h=round(total, 1),
            peak_hour=peak_time,
            peak_hour_mm=round(peak_mm, 1) if peak_mm is not None else None,
            fetched_at=datetime.now(UTC),
            threshold_mm=settings.rain_heavy_mm_24h,
        )
    finally:
        if own_client:
            client.close()
    _cache["warning"] = warning
    _cache["expires"] = datetime.now(UTC) + timedelta(minutes=settings.rain_cache_minutes)
    return warning
