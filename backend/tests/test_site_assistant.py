import json
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import ModelCall
from app.db.models.enums import ModelOperation
from app.db.session import session_scope
from tests.test_assistant import _call, _events, _incident, _model


def _ask(client: TestClient, question: str, **extra: Any) -> list[dict[str, Any]]:
    body = {"messages": [{"role": "user", "content": question}], **extra}
    return _events(client.post("/api/v1/assistant/site", json=body))


def test_site_assistant_answers_with_public_tools(client: TestClient, fake_meta: Any) -> None:
    seen = fake_meta(_model(_call("overview", {}), lambda outs: "MtaaSense helps residents report hazards."))

    events = _ask(client, "What is MtaaSense?")

    assert [e["type"] for e in events] == ["progress", "answer"]
    assert events[-1]["text"] == "MtaaSense helps residents report hazards."
    first = json.loads(seen[0].content)
    assert first["instructions"].startswith("You are Ask MtaaSense")
    assert "not an official government service" in first["instructions"]
    assert {t["name"] for t in first["tools"]} == {"search_incidents", "get_incident", "overview", "rain_forecast"}
    with session_scope() as db:
        ops = set(db.scalars(select(ModelCall.operation)).all())
    assert ops == {ModelOperation.site_assistant}


def test_site_assistant_never_sees_residents_words(reviewer: TestClient, fake_meta: Any) -> None:
    incident = _incident(reviewer, description="Secret words only reviewers should see")
    reviewer.patch(f"/api/v1/incidents/{incident['id']}", json={"summary": "Blocked drain by the market."})
    reviewer.cookies.clear()
    seen = fake_meta(_model(_call("get_incident", {"reference": incident["reference"]}), lambda outs: "Done."))

    # A context naming the report is ignored: the website assistant takes no context at all.
    _ask(reviewer, f"Tell me about {incident['reference']}", context={"report_id": incident["report_id"]})

    first = json.loads(seen[0].content)
    assert "Context:" not in first["input"][-1]["content"][0]["text"]
    output = next(i["output"] for i in json.loads(seen[1].content)["input"] if i.get("type") == "function_call_output")
    assert incident["reference"] in output
    assert "Secret words" not in output
    assert incident["report_ref"] not in output
