"""Test fixtures. Uses a separate PostGIS database (mtaasense_test) and a temp media directory.

The Meta Model API is never called: tests install an httpx.MockTransport-backed MetaClient.
"""

import io
import json
import os
import tempfile
from collections.abc import Callable, Iterator
from typing import Any

import pytest

_MEDIA = tempfile.mkdtemp(prefix="mtaa-test-media-")
os.environ.update(
    {
        "APP_ENV": "test",
        "DATABASE_URL": os.environ.get(
            "TEST_DATABASE_URL", "postgresql+psycopg://mtaasense:mtaasense_dev_only@localhost:5433/mtaasense_test"
        ),
        "MEDIA_STORAGE_PATH": _MEDIA,
        "SECRET_KEY": "test-secret-key-test-secret-key-0123456789",
        "CORS_ORIGINS": "http://testserver,http://localhost:3000",
        "MODEL_API_KEY": "",
        "DEMO_FIXTURES_ENABLED": "false",
        "REPORT_RATE_LIMIT_PER_HOUR": "1000",
        "LOGIN_RATE_LIMIT_PER_15MIN": "1000",
        "DUPLICATE_MODEL_ASSIST": "false",
        "LOG_LEVEL": "WARNING",
    }
)

import httpx  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import text  # noqa: E402

from alembic import command  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.services import meta_client as meta_client_module  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _migrated_db() -> None:
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
def _clean_db() -> Iterator[None]:
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def client() -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as c:
        yield c


def make_image(width: int = 640, height: int = 480, color: tuple[int, int, int] = (120, 110, 100)) -> bytes:
    img = Image.new("RGB", (width, height), color)
    for x in range(0, width, 16):  # some texture so JPEG isn't trivially tiny
        for y in range(0, height, 16):
            img.putpixel((x, y), (x % 255, y % 255, 90))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


@pytest.fixture
def image_bytes() -> bytes:
    return make_image()


def submit(client: TestClient, image: bytes, **fields: Any) -> httpx.Response:
    data = {"description": "Large pothole near the market entrance", **{k: str(v) for k, v in fields.items()}}
    headers = {}
    if "idempotency_key" in data:
        headers["Idempotency-Key"] = data.pop("idempotency_key")
    return client.post(
        "/api/v1/reports", data=data, files={"image": ("photo.jpg", image, "image/jpeg")}, headers=headers
    )


def create_user(email: str, password: str, role: str) -> None:
    from app.cli import create_user as _create
    from app.db.models.enums import UserRole

    _create(email, email.split("@")[0].title(), UserRole(role), password)


@pytest.fixture
def reviewer(client: TestClient) -> TestClient:
    create_user("reviewer@test.local", "reviewer-password-123", "reviewer")
    res = client.post("/api/v1/auth/login", json={"email": "reviewer@test.local", "password": "reviewer-password-123"})
    assert res.status_code == 200, res.text
    return client


# ---------------------------------------------------------------- fake Meta API

Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def fake_meta(monkeypatch: pytest.MonkeyPatch) -> Callable[[Handler], list[httpx.Request]]:
    """Install a MetaClient whose transport is `handler`. Returns the list of captured requests."""

    def install(handler: Handler) -> list[httpx.Request]:
        seen: list[httpx.Request] = []

        def wrapped(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        settings = get_settings()
        monkeypatch.setattr(settings, "model_api_key", __import__("pydantic").SecretStr("test-key"))
        monkeypatch.setattr(meta_client_module.time, "sleep", lambda _s: None)
        client = meta_client_module.MetaClient(transport=httpx.MockTransport(wrapped))
        monkeypatch.setattr(meta_client_module, "_client", client)
        return seen

    return install


def responses_body(payload: dict[str, Any] | str, *, status: str = "completed") -> dict[str, Any]:
    text_value = payload if isinstance(payload, str) else json.dumps(payload)
    return {
        "id": "resp_test_1",
        "object": "response",
        "status": status,
        "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text_value}]}],
        "usage": {
            "input_tokens": 1500,
            "output_tokens": 600,
            "input_tokens_details": {"cached_tokens": 0},
            "output_tokens_details": {"reasoning_tokens": 200},
        },
        "error": None,
        "incomplete_details": None,
    }


VALID_ASSESSMENT: dict[str, Any] = {
    "is_infrastructure_hazard": True,
    "hazard_category": "pothole",
    "summary": "A deep pothole occupies most of the left lane near a market entrance.",
    "observations": [
        {"text": "Large irregular depression in the asphalt with broken edges", "source": "image"},
        {"text": "Located near the market entrance", "source": "description"},
    ],
    "severity": "high",
    "severity_rationale": "Appears wide enough to force vehicles to swerve.",
    "confidence": "medium",
    "uncertainties": ["Depth cannot be determined from the photo."],
    "missing_information": ["Exact street name"],
    "suggested_review_priority": "elevated",
    "description_consistency": "consistent",
    "consistency_note": "The photo shows a pothole as described.",
    "image_quality": "good",
    "segmentation_concept": "pothole",
}

SAM_TEXT = (
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>"
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>"
    ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>"
    "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n"
)


def sam_sse(text_value: str = SAM_TEXT) -> str:
    lane = {"item_id": "msg_1", "output_index": 0, "content_index": 0}
    events = [
        {"type": "response.created", "response": {"id": "resp_sam_1", "status": "in_progress"}},
        {"type": "response.output_text.delta", **lane, "delta": text_value[:90]},
        {"type": "response.output_text.delta", **lane, "delta": text_value[90:]},
        {"type": "response.content_part.done", **lane, "part": {"type": "output_text", "text": text_value}},
        {"type": "response.completed", "response": {"id": "resp_sam_1", "status": "completed"}},
    ]
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
