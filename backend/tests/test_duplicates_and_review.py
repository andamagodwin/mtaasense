import json
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import AuditEvent, DuplicateSuggestion, Report
from app.db.models.enums import ModelVerdict, ReportStatus
from app.db.session import session_scope
from app.services.duplicate_matching import run_matching
from tests.conftest import make_image, responses_body, submit

# Two points ~40 m apart on the Kampala–Jinja road at Namanve; a third ~1.2 km away.
NEAR_A = {"lat": 0.35760, "lon": 32.69520}
NEAR_B = {"lat": 0.35780, "lon": 32.69550}
FAR = {"lat": 0.36800, "lon": 32.69520}


def _report(
    client: TestClient,
    description: str,
    category: str | None,
    loc: dict[str, float] | None,
    color: tuple[int, int, int] = (120, 110, 100),
) -> str:
    fields: dict[str, Any] = {"description": description}
    if category:
        fields["category"] = category
    if loc:
        fields |= {**loc, "location_source": "map_pin"}
    res = submit(client, make_image(color=color), **fields)
    assert res.status_code == 201, res.text
    rid: str = res.json()["id"]
    _mark_reviewable(rid)
    return rid


def _mark_reviewable(report_id: str) -> None:
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(report_id))
        assert report is not None
        report.status = ReportStatus.under_review


def _suggestions(source_id: str) -> list[DuplicateSuggestion]:
    with session_scope() as db:
        return list(
            db.scalars(select(DuplicateSuggestion).where(DuplicateSuggestion.source_report_id == uuid.UUID(source_id)))
        )


def test_nearby_same_category_reports_are_suggested(client: TestClient) -> None:
    a = _report(client, "Road flooded at Namanve near industrial park", "flooding", NEAR_A)
    b = _report(client, "Flooded section of the highway at Namanve", "flooding", NEAR_B)
    assert run_matching(uuid.UUID(b)) == 1
    (s,) = _suggestions(b)
    assert s.candidate_report_id == uuid.UUID(a)
    assert 30 < s.signals["distance_m"] < 60
    assert s.signals["category_relation"] == "same" and s.score > 0.6
    assert s.model_verdict is None  # model assistance disabled in tests: no invented verdict


def test_far_apart_or_different_family_not_suggested(client: TestClient) -> None:
    _report(client, "Road flooded at Namanve", "flooding", FAR)
    _report(client, "Deep pothole near the junction", "pothole", NEAR_A)
    src = _report(client, "Road flooded at Namanve", "flooding", NEAR_B)
    assert run_matching(uuid.UUID(src)) == 0


def test_same_family_counts_as_partial_category_match(client: TestClient) -> None:
    _report(client, "Water standing on the road after rain", "flooding", NEAR_A)
    src = _report(client, "Blocked drain causing water on the road", "blocked_drainage", NEAR_B)
    run_matching(uuid.UUID(src))
    (s,) = _suggestions(src)
    assert s.signals["category_relation"] == "same_family" and s.signals["components"]["category"] == 0.6


def test_unlocated_report_matches_only_on_similar_wording(client: TestClient) -> None:
    _report(client, "Huge pothole outside Kalerwe market gate swallowing boda bodas", "pothole", NEAR_A)
    _report(client, "Drain is blocked with plastic", "pothole", NEAR_B)
    src = _report(client, "Huge pothole outside Kalerwe market gate", "pothole", None)
    run_matching(uuid.UUID(src))
    (s,) = _suggestions(src)
    assert s.signals["distance_m"] is None and "location" not in s.signals["components"]


def test_model_assessment_only_accepts_supplied_labels(
    client: TestClient, fake_meta: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "duplicate_model_assist", True)
    a = _report(client, "Road flooded at Namanve near industrial park", "flooding", NEAR_A)
    b = _report(client, "Flooded section of the highway at Namanve", "flooding", NEAR_B)

    def handler(req: httpx.Request) -> httpx.Response:
        payload = json.loads(req.content)
        labels = payload["text"]["format"]["schema"]["properties"]["comparisons"]["items"]["properties"]["candidate"][
            "enum"
        ]
        assert labels == ["C1"]
        return httpx.Response(
            200,
            json=responses_body(
                {
                    "comparisons": [
                        {
                            "candidate": "C1",
                            "verdict": "likely_same",
                            "visual_comparison": "Same pylon and wall.",
                            "reasoning": "x",
                        },
                        {
                            "candidate": "C9",
                            "verdict": "likely_same",
                            "visual_comparison": "invented",
                            "reasoning": "x",
                        },
                        {
                            "candidate": str(uuid.uuid4()),
                            "verdict": "likely_same",
                            "visual_comparison": "invented",
                            "reasoning": "x",
                        },
                    ]
                }
            ),
        )

    seen = fake_meta(handler)
    run_matching(uuid.UUID(b))
    assert len(seen) == 1
    (s,) = _suggestions(b)
    assert s.candidate_report_id == uuid.UUID(a)
    assert s.model_verdict == ModelVerdict.likely_same
    assert s.model_assessment is not None and s.model_assessment["visual_comparison"] == "Same pylon and wall."


def test_confirm_duplicate_creates_incident_and_preserves_both_reports(reviewer: TestClient) -> None:
    a = _report(reviewer, "Road flooded at Namanve near industrial park", "flooding", NEAR_A)
    b = _report(reviewer, "Flooded section of the highway at Namanve", "flooding", NEAR_B)
    run_matching(uuid.UUID(b))
    (s,) = _suggestions(b)

    res = reviewer.post(
        f"/api/v1/duplicate-suggestions/{s.id}/decision", json={"decision": "confirm", "note": "Same pylon"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "confirmed"

    ra = reviewer.get(f"/api/v1/reports/{a}").json()
    rb = reviewer.get(f"/api/v1/reports/{b}").json()
    assert ra["status"] == "confirmed" and rb["status"] == "duplicate"
    assert ra["incident"]["id"] == rb["incident"]["id"]
    assert rb["description"] == "Flooded section of the highway at Namanve"  # evidence untouched

    incident = reviewer.get(f"/api/v1/incidents/{ra['incident']['id']}").json()
    assert incident["report_count"] == 2 and incident["primary_report_id"] == a
    assert {r["id"] for r in incident["reports"]} == {a, b}

    # A second decision on the same pair is refused.
    again = reviewer.post(f"/api/v1/duplicate-suggestions/{s.id}/decision", json={"decision": "reject"})
    assert again.status_code == 409
    with session_scope() as db:
        actions = [e.action for e in db.scalars(select(AuditEvent).order_by(AuditEvent.created_at))]
        assert "incident_created" in actions and "duplicate_confirmed" in actions


def test_reject_and_defer_leave_reports_unlinked(reviewer: TestClient) -> None:
    _report(reviewer, "Road flooded at Namanve", "flooding", NEAR_A)
    b = _report(reviewer, "Road flooded at Namanve again", "flooding", NEAR_B)
    run_matching(uuid.UUID(b))
    (s,) = _suggestions(b)
    deferred = reviewer.post(f"/api/v1/duplicate-suggestions/{s.id}/decision", json={"decision": "defer"}).json()
    assert deferred["status"] == "deferred"
    assert reviewer.get("/api/v1/duplicate-suggestions").json()["total"] == 1  # still unresolved
    rejected = reviewer.post(f"/api/v1/duplicate-suggestions/{s.id}/decision", json={"decision": "reject"}).json()
    assert rejected["status"] == "rejected"
    assert reviewer.get(f"/api/v1/reports/{b}").json()["incident"] is None
    # Re-running matching never overwrites a reviewer's decision.
    run_matching(uuid.UUID(b))
    assert _suggestions(b)[0].status.value == "rejected"


def test_unauthenticated_decision_rejected(client: TestClient) -> None:
    _report(client, "Road flooded at Namanve", "flooding", NEAR_A)
    b = _report(client, "Road flooded at Namanve again", "flooding", NEAR_B)
    run_matching(uuid.UUID(b))
    (s,) = _suggestions(b)
    assert (
        client.post(f"/api/v1/duplicate-suggestions/{s.id}/decision", json={"decision": "confirm"}).status_code == 401
    )
    assert _suggestions(b)[0].status.value == "pending"


def test_incident_lifecycle_and_transitions(reviewer: TestClient) -> None:
    rid = _report(reviewer, "Pothole by the school", "pothole", NEAR_A)
    detail = reviewer.post(
        f"/api/v1/reports/{rid}/review", json={"action": "confirm_incident", "title": "Pothole at school"}
    ).json()
    inc_id = detail["incident"]["id"]

    # Resolving needs a human-written note.
    bad = reviewer.patch(f"/api/v1/incidents/{inc_id}", json={"status": "resolved"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "resolution_note_required"
    ok = reviewer.patch(
        f"/api/v1/incidents/{inc_id}", json={"status": "resolved", "resolution_note": "Patched, site visit 30 Oct"}
    )
    assert ok.status_code == 200 and ok.json()["status"] == "resolved"
    assert reviewer.get(f"/api/v1/reports/{rid}").json()["status"] == "resolved"

    reopened = reviewer.patch(f"/api/v1/incidents/{inc_id}", json={"status": "confirmed"}).json()
    assert reopened["status"] == "confirmed" and reopened["resolved_at"] is None
    assert reviewer.get(f"/api/v1/reports/{rid}").json()["status"] == "confirmed"

    # A confirmed report can't be rejected or confirmed again.
    assert reviewer.post(f"/api/v1/reports/{rid}/review", json={"action": "reject"}).status_code == 409
    assert reviewer.post(f"/api/v1/reports/{rid}/review", json={"action": "confirm_incident"}).status_code == 409


def test_category_correction_is_audited(reviewer: TestClient) -> None:
    rid = _report(reviewer, "Water on the road", "pothole", NEAR_A)
    res = reviewer.patch(
        f"/api/v1/reports/{rid}", json={"reviewer_category": "flooding", "note": "It's standing water"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["hazard_category"] == "flooding" and body["reporter_category"] == "pothole"
    audit = reviewer.get(f"/api/v1/reports/{rid}/audit").json()
    correction = next(e for e in audit if e["action"] == "category_corrected")
    assert correction["data"]["from"] == "pothole" and correction["data"]["to"] == "flooding"


def test_reject_and_reopen_report(reviewer: TestClient) -> None:
    rid = _report(reviewer, "This is a picture of my lunch", None, None)
    assert (
        reviewer.post(f"/api/v1/reports/{rid}/review", json={"action": "reject", "note": "Not a hazard"}).json()[
            "status"
        ]
        == "rejected"
    )
    assert reviewer.post(f"/api/v1/reports/{rid}/review", json={"action": "reopen"}).json()["status"] == "under_review"


def test_dashboard_counts_come_from_database(reviewer: TestClient) -> None:
    _report(reviewer, "Road flooded at Namanve", "flooding", NEAR_A)
    b = _report(reviewer, "Road flooded at Namanve again", "flooding", NEAR_B)
    _report(reviewer, "Pothole somewhere unknown", "pothole", None)
    run_matching(uuid.UUID(b))
    summary = reviewer.get("/api/v1/review/summary").json()
    assert summary["reports_total"] == 3 and summary["reports_awaiting_review"] == 3
    assert summary["potential_duplicates"] == 1 and summary["unlocated_reports"] == 1
    features = reviewer.get("/api/v1/map/features").json()
    assert len(features["reports"]) == 2 and features["unlocated_reports"] == 1
