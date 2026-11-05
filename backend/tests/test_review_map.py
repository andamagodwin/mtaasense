from fastapi.testclient import TestClient

from tests.conftest import make_image, submit
from tests.test_assistant import _incident


def test_review_map_requires_a_reviewer(client: TestClient) -> None:
    assert client.get("/api/v1/review/map/features").status_code == 401


def test_review_map_shows_every_report_with_reviewer_detail(reviewer: TestClient) -> None:
    incident = _incident(reviewer)
    created = submit(
        reviewer,
        make_image(),
        description="Pothole on my street, getting worse",
        category="pothole",
        lat=0.32,
        lon=32.58,
        location_source="map_pin",
    )
    awaiting_ref = created.json()["reference"]
    submit(reviewer, make_image(), description="No location on this one", category="flooding")

    res = reviewer.get("/api/v1/review/map/features")
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["incidents"][0]["reference"] == incident["reference"]
    by_ref = {r["reference"]: r for r in body["reports"]}
    # Decided reports stay on the reviewer map; the public map drops them.
    assert incident["report_ref"] in by_ref
    assert by_ref[incident["report_ref"]]["status"] == "confirmed"
    mine = by_ref[awaiting_ref]
    assert mine["status"] == "submitted"
    assert mine["description"] == "Pothole on my street, getting worse"
    assert mine["location"] == {"lat": 0.32, "lon": 32.58}
    assert mine["thumbnail"] is not None
    assert mine["open_duplicate_suggestions"] == 0
    assert body["unlocated_reports"] == 1
    assert body["unlocated_incidents"] == 0


def test_review_map_category_filter(reviewer: TestClient) -> None:
    _incident(reviewer)
    submit(
        reviewer,
        make_image(),
        description="Pothole on my street",
        category="pothole",
        lat=0.32,
        lon=32.58,
        location_source="map_pin",
    )

    res = reviewer.get("/api/v1/review/map/features", params={"category": "pothole"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["incidents"] == []
    assert len(body["reports"]) == 1
    assert body["reports"][0]["hazard_category"] == "pothole"
