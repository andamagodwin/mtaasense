import asyncio
import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import ModelCall, Report
from app.db.models.enums import ModelOperation, ReportStatus
from app.db.session import session_scope
from app.services import voice
from tests.conftest import make_image, responses_body, submit
from tests.test_assistant import _call, _events, _model

URL = "/api/v1/assistant/voice"
FRAME = b"\0" * voice.FRAME_BYTES


class FakeTranscriber:
    """Muse Voice Transcribe's realtime socket: hears one turn after three frames, finishes on endStream."""

    def __init__(self) -> None:
        self.sent: list[str | bytes] = []
        self.events: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self.closed = False

    async def send(self, message: str | bytes) -> None:
        self.sent.append(message)
        if isinstance(message, bytes):
            if sum(isinstance(m, bytes) for m in self.sent) == 3:
                await self.events.put({"type": "speechStart", "turnId": 0, "audioProcessedMs": 80})
                await self.events.put({"type": "transcript", "transcript": "How many reports", "final": False})
                await self.events.put(
                    {"type": "speechComplete", "turnId": 0, "transcript": " How many reports are waiting? "}
                )
        elif json.loads(message).get("type") == "endStream":
            await self.events.put(None)

    async def recv(self) -> str:
        return json.dumps({"sessionId": "voice-session-1"})

    def __aiter__(self) -> "FakeTranscriber":
        return self

    async def __anext__(self) -> str:
        event = await self.events.get()
        if event is None:
            raise StopAsyncIteration
        return json.dumps(event)

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def transcriber(monkeypatch: pytest.MonkeyPatch) -> list[FakeTranscriber]:
    monkeypatch.setattr(get_settings(), "model_api_key", SecretStr("test-key"))
    opened: list[FakeTranscriber] = []

    async def open_fake() -> FakeTranscriber:
        fake = FakeTranscriber()  # created on the app's event loop
        opened.append(fake)
        return fake

    monkeypatch.setattr(voice, "open_transcriber", open_fake)
    return opened


def test_voice_needs_a_signed_in_reviewer(client: TestClient) -> None:
    with client.websocket_connect(URL) as ws:
        assert ws.receive_json()["code"] == "unauthorized"


def test_voice_refuses_other_sites(reviewer: TestClient, transcriber: list[FakeTranscriber]) -> None:
    with reviewer.websocket_connect(URL, headers={"origin": "https://elsewhere.example"}) as ws:
        assert ws.receive_json()["code"] == "origin_not_allowed"
    assert transcriber == []


def test_voice_without_model_key_explains(reviewer: TestClient) -> None:
    with reviewer.websocket_connect(URL) as ws:
        assert ws.receive_json() == {
            "type": "error",
            "code": "not_configured",
            "message": "Voice needs the Meta Model API, which isn't set up on this server.",
        }


def test_voice_relays_turns_and_records_usage(reviewer: TestClient, transcriber: list[FakeTranscriber]) -> None:
    with reviewer.websocket_connect(URL, headers={"origin": "http://localhost:3000"}) as ws:
        assert ws.receive_json() == {"type": "ready"}
        for _ in range(3):
            ws.send_bytes(FRAME)
        assert ws.receive_json() == {"type": "partial", "text": "How many reports"}
        assert ws.receive_json() == {"type": "utterance", "text": "How many reports are waiting?"}
        ws.send_text(json.dumps({"type": "stop"}))
        assert ws.receive_json() == {"type": "ended", "reason": "stopped"}
        assert ws.receive()["type"] == "websocket.close"

    fake = transcriber[0]
    handshake = json.loads(fake.sent[0])
    assert handshake["authorization"] == {"accessToken": "Bearer test-key"}
    assert (handshake["mode"], handshake["audioEncoding"]) == ("ENDPOINTING", "PCM_24KHZ")
    assert [m for m in fake.sent if isinstance(m, bytes)] == [FRAME] * 3
    assert fake.closed
    with session_scope() as db:
        call = db.scalars(select(ModelCall)).one()
    assert call.operation == ModelOperation.voice_assistant
    assert (call.success, call.audio_ms, call.provider_response_id) == (True, 240, "voice-session-1")


def test_spoken_question_can_open_a_record(reviewer: TestClient, fake_meta: Any) -> None:
    report_id = submit(reviewer, make_image(), description="Deep pothole", category="pothole").json()["id"]
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None
        report.status = ReportStatus.under_review
        ref = report.reference
    spoken = "m s " + " ".join(ref[3:].lower())  # how the transcriber may write MS-XXXXXX
    seen = fake_meta(
        _model(
            _call("open_page", {"page": "record", "reference": spoken}),
            lambda outs: f"Here is {outs[0]['opened']}, a deep pothole.",
        )
    )

    res = reviewer.post(
        "/api/v1/assistant/review",
        json={"messages": [{"role": "user", "content": f"Open {spoken}"}], "voice": True},
    )

    events = _events(res)
    assert events[0] == {"type": "progress", "text": f"Opening {spoken}"}
    answer = events[-1]
    assert answer["navigate"] == {"href": f"/review/reports/{report_id}", "label": ref}
    assert [r["reference"] for r in answer["refs"]] == [ref]
    assert "hands-free" in json.loads(seen[0].content)["instructions"]


def test_typed_questions_do_not_get_voice_rules(reviewer: TestClient, fake_meta: Any) -> None:
    seen = fake_meta(lambda request: __import__("httpx").Response(200, json=responses_body("Nothing waiting.")))
    events = _events(reviewer.post("/api/v1/assistant/review", json={"messages": [{"role": "user", "content": "Hi"}]}))
    assert events[-1]["navigate"] is None
    assert "hands-free" not in json.loads(seen[0].content)["instructions"]


def test_spoken_references_are_understood() -> None:
    from app.services.assistant import _reference

    assert _reference("m s y f g b s five") == "MS-YFGBS5"
    assert _reference("MS YFGBS5") == "MS-YFGBS5"
    assert _reference("I N C, 7 K Q 2 M D") == "INC-7KQ2MD"
    assert _reference("MS-4F7K2P") == "MS-4F7K2P"
    assert _reference("pothole") == "POTHOLE"
