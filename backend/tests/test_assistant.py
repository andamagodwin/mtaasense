import json
import uuid
from collections.abc import Callable
from typing import Any

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import ModelCall, Report
from app.db.models.enums import ModelOperation, ReportStatus
from app.db.session import session_scope
from tests.conftest import make_image, responses_body, submit

USAGE = {"input_tokens": 900, "output_tokens": 120, "input_tokens_details": {"cached_tokens": 0}}


def _call(name: str, arguments: dict[str, Any], call_id: str = "call_1") -> dict[str, Any]:
    return {
        "id": "resp_tools",
        "status": "completed",
        "output": [
            {"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque", "status": "completed"},
            {
                "type": "message",
                "role": "assistant",
                "phase": "commentary",
                "content": [{"type": "output_text", "text": "Let me look."}],
            },
            {"type": "function_call", "call_id": call_id, "name": name, "arguments": json.dumps(arguments)},
        ],
        "usage": USAGE,
    }


def _model(
    first: dict[str, Any], final: Callable[[list[dict[str, Any]]], str]
) -> Callable[[httpx.Request], httpx.Response]:
    """Round one asks for a tool; round two answers with `final(tool_outputs)`."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        outputs = [json.loads(i["output"]) for i in body["input"] if i.get("type") == "function_call_output"]
        if not outputs:
            return httpx.Response(200, json=first)
        return httpx.Response(200, json=responses_body(final(outputs)))

    return handler


def _events(res: httpx.Response) -> list[dict[str, Any]]:
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    return [json.loads(line[6:]) for line in res.text.splitlines() if line.startswith("data: ")]


def _incident(reviewer: TestClient, description: str = "Drain full of rubbish near Kalerwe market") -> dict[str, Any]:
    created = submit(
        reviewer,
        make_image(),
        description=description,
        category="blocked_drainage",
        lat=0.358,
        lon=32.566,
        location_source="map_pin",
    )
    report_id = created.json()["id"]
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None
        report.status = ReportStatus.under_review
    detail = reviewer.post(f"/api/v1/reports/{report_id}/review", json={"action": "confirm_incident"}).json()
    return {"report_id": report_id, "report_ref": detail["reference"], **detail["incident"]}


def _ask(client: TestClient, mode: str, question: str, context: dict[str, Any] | None = None) -> httpx.Response:
    body: dict[str, Any] = {"messages": [{"role": "user", "content": question}]}
    if context:
        body["context"] = context
    return client.post(f"/api/v1/assistant/{mode}", json=body)


def test_map_assistant_runs_tools_and_cites_records(reviewer: TestClient, fake_meta: Any) -> None:
    incident = _incident(reviewer)
    reviewer.cookies.clear()  # the rest of the test is a member of the public
    seen = fake_meta(
        _model(
            _call(
                "search_incidents",
                {
                    "text": None,
                    "category": "blocked_drainage",
                    "near_lat": 0.358,
                    "near_lon": 32.566,
                    "radius_km": 2,
                    "status": "open",
                },
            ),
            lambda outs: f"One open blocked drain: {outs[0]['incidents'][0]['reference']}. MS-ZZZZZZ is not real.",
        )
    )

    events = _events(
        _ask(
            reviewer,
            "map",
            "Any blocked drains near Kalerwe?",
            {"bounds": {"south": 0.3, "west": 32.5, "north": 0.4, "east": 32.6}},
        )
    )

    assert [e["type"] for e in events] == ["progress", "answer"]
    assert "blocked drain" in events[0]["text"]
    answer = events[-1]
    # Only records the tools returned are linked; an invented reference is not.
    assert [r["reference"] for r in answer["refs"]] == [incident["reference"]]
    assert answer["refs"][0]["location"] == {"lat": 0.358, "lon": 32.566}
    assert answer["proposals"] == []

    first = json.loads(seen[0].content)
    assert {t["name"] for t in first["tools"]} == {
        "search_incidents",
        "get_incident",
        "nearby_unreviewed_reports",
        "overview",
        "rain_forecast",
    }
    assert "latitude 0.3000 to 0.4000" in first["input"][-1]["content"][0]["text"]
    second = json.loads(seen[1].content)
    # The reasoning and the call are replayed before the tool output.
    assert [i["type"] for i in second["input"][-4:]] == [
        "reasoning",
        "message",
        "function_call",
        "function_call_output",
    ]
    with session_scope() as db:
        ops = db.scalars(select(ModelCall.operation)).all()
    assert ops == [ModelOperation.map_assistant, ModelOperation.map_assistant]


def test_map_assistant_never_sees_residents_words(reviewer: TestClient, fake_meta: Any) -> None:
    incident = _incident(reviewer, description="Secret words only reviewers should see")
    # The incident's own summary is public; the report behind it is not.
    reviewer.patch(f"/api/v1/incidents/{incident['id']}", json={"summary": "Blocked drain by the market."})
    reviewer.cookies.clear()
    seen = fake_meta(_model(_call("get_incident", {"reference": incident["reference"]}), lambda outs: "Done."))

    _events(_ask(reviewer, "map", f"Tell me about {incident['reference']}"))

    output = next(i["output"] for i in json.loads(seen[1].content)["input"] if i.get("type") == "function_call_output")
    assert incident["reference"] in output
    assert "Secret words" not in output
    assert "linked_reports" not in output
    assert incident["report_ref"] not in output


def test_review_assistant_requires_a_reviewer(client: TestClient) -> None:
    assert _ask(client, "review", "What is in the queue?").status_code == 401


def test_review_assistant_proposes_but_does_not_act(reviewer: TestClient, fake_meta: Any) -> None:
    created = submit(reviewer, make_image(), description="Photo of my lunch", category="pothole")
    report_id = created.json()["id"]
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None
        report.status = ReportStatus.under_review
        ref = report.reference
    fake_meta(
        _model(
            _call(
                "propose_action",
                {
                    "action": "reject_report",
                    "target": ref,
                    "reason": "No hazard in the photo.",
                    "title": None,
                    "priority": None,
                    "text": None,
                    "fix_check_id": None,
                },
            ),
            lambda outs: f"{ref} shows no hazard; I suggested rejecting it.",
        )
    )

    events = _events(_ask(reviewer, "review", "Anything I can reject?", {"report_id": report_id}))

    answer = events[-1]
    assert answer["type"] == "answer"
    assert answer["proposals"] == [
        {
            "id": "p1",
            "action": "reject_report",
            "label": f"Reject {ref}",
            "reason": "No hazard in the photo.",
            "target": {"kind": "report", "id": report_id, "reference": ref},
            "params": {},
        }
    ]
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None and report.status == ReportStatus.under_review


def test_invalid_proposal_goes_back_to_the_model(reviewer: TestClient, fake_meta: Any) -> None:
    incident = _incident(reviewer)
    seen = fake_meta(
        _model(
            _call(
                "propose_action",
                {
                    "action": "resolve_incident",
                    "target": incident["reference"],
                    "reason": "Fixed.",
                    "title": None,
                    "priority": None,
                    "text": None,
                    "fix_check_id": None,
                },
            ),
            lambda outs: "I need a resolution note first.",
        )
    )

    events = _events(_ask(reviewer, "review", f"Resolve {incident['reference']}"))

    assert events[-1]["proposals"] == []
    output = next(i["output"] for i in json.loads(seen[1].content)["input"] if i.get("type") == "function_call_output")
    assert "resolution note" in output


def test_assistant_without_model_key_explains(client: TestClient) -> None:
    events = _events(_ask(client, "map", "Any potholes?"))
    assert events == [
        {"type": "error", "message": "The assistant needs the Meta Model API, which isn't set up on this server."}
    ]


def test_question_must_come_last(client: TestClient) -> None:
    res = client.post("/api/v1/assistant/map", json={"messages": [{"role": "assistant", "content": "Hello"}]})
    assert res.status_code == 422
