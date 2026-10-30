import json
import uuid
from decimal import Decimal
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import ModelCall, ProcessingJob, Report, Segmentation
from app.db.models.enums import AnalysisStatus, JobKind, ModelOperation, Provenance, ReportStatus
from app.db.session import session_scope
from app.services import pricing
from app.services.analysis import AnalysisFailed, parse_assessment, run_analysis
from app.services.segmentation import parse_sam_events
from app.workers.runner import process
from tests.conftest import VALID_ASSESSMENT, responses_body, sam_sse, submit


def _job(report_id: str, kind: JobKind) -> ProcessingJob:
    with session_scope() as db:
        job = db.scalar(
            select(ProcessingJob).where(ProcessingJob.report_id == uuid.UUID(report_id), ProcessingJob.kind == kind)
        )
        assert job is not None
        return job


def _run(job: ProcessingJob) -> None:
    process(job.id, job.kind, job.report_id, job.segmentation_id, dict(job.options or {}), 1, job.max_attempts)


def test_parse_assessment_validates_schema() -> None:
    ok = parse_assessment(responses_body(VALID_ASSESSMENT))
    assert ok.hazard_category == "pothole" and ok.observations[0].source == "image"
    with pytest.raises(AnalysisFailed) as bad:
        parse_assessment(responses_body({**VALID_ASSESSMENT, "severity": "apocalyptic"}))
    assert bad.value.code == "malformed_output"
    with pytest.raises(AnalysisFailed) as not_json:
        parse_assessment(responses_body("Sure! Here's the analysis: it's a pothole."))
    assert not_json.value.code == "malformed_output"
    with pytest.raises(AnalysisFailed) as extra:
        parse_assessment(responses_body({**VALID_ASSESSMENT, "verified_by_kcca": True}))
    assert extra.value.code == "malformed_output"
    refusal = {
        "id": "r",
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "no"}]}],
    }
    with pytest.raises(AnalysisFailed) as refused:
        parse_assessment(refusal)
    assert refused.value.code == "model_refused"


def test_analysis_request_and_result(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    seen = fake_meta(lambda req: httpx.Response(200, json=responses_body(VALID_ASSESSMENT)))
    body = submit(client, image_bytes, category="pothole").json()
    _run(_job(body["id"], JobKind.analyze_report))

    request = json.loads(seen[0].content)
    assert seen[0].url.path == "/v1/responses" and seen[0].headers["authorization"] == "Bearer test-key"
    assert request["model"] == "muse-spark-1.3" and request["store"] is False
    assert request["text"]["format"]["type"] == "json_schema" and request["text"]["format"]["strict"] is True
    content = request["input"][0]["content"]
    assert content[1]["type"] == "input_image" and content[1]["image_url"].startswith("data:image/jpeg;base64,")
    assert "<resident_description>Large pothole near the market entrance</resident_description>" in content[0]["text"]

    with session_scope() as db:
        report = db.get(Report, uuid.UUID(body["id"]))
        assert report is not None
        assert report.status == ReportStatus.under_review
        assert report.analysis_status == AnalysisStatus.completed
        assert report.analysis_provenance == Provenance.live
        assert report.description == "Large pothole near the market entrance"  # resident text untouched
        assert report.analysis is not None and report.analysis["meta"]["response_id"] == "resp_test_1"
        call = db.scalar(select(ModelCall).where(ModelCall.operation == ModelOperation.analysis))
        assert call is not None and call.success and call.input_tokens == 1500
        assert call.estimated_cost_usd == pricing.token_cost("muse-spark-1.3", 1500, 600)


def test_malformed_output_is_retried_once_then_succeeds(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    replies = iter([responses_body("{not json"), responses_body(VALID_ASSESSMENT)])
    seen = fake_meta(lambda req: httpx.Response(200, json=next(replies)))
    body = submit(client, image_bytes).json()
    _run(_job(body["id"], JobKind.analyze_report))
    assert len(seen) == 2
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(body["id"]))
        assert report is not None and report.analysis_status == AnalysisStatus.completed


def test_persistent_malformed_output_marks_failure_but_keeps_report(
    client: TestClient, image_bytes: bytes, fake_meta: Any
) -> None:
    fake_meta(lambda req: httpx.Response(200, json=responses_body("{still not json")))
    body = submit(client, image_bytes).json()
    _run(_job(body["id"], JobKind.analyze_report))
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(body["id"]))
        assert report is not None
        assert report.analysis_status == AnalysisStatus.failed and report.status == ReportStatus.processing_failed
        assert report.analysis_error_code == "malformed_output"
        # Matching still runs on resident-provided data.
        assert (
            db.scalar(
                select(ProcessingJob).where(
                    ProcessingJob.report_id == report.id, ProcessingJob.kind == JobKind.match_duplicates
                )
            )
            is not None
        )


def test_rate_limit_is_retried_then_succeeds(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    replies = iter(
        [
            httpx.Response(
                429,
                headers={"retry-after": "1"},
                json={"error": {"type": "rate_limit_error", "code": "rate_limit_exceeded"}},
            ),
            httpx.Response(200, json=responses_body(VALID_ASSESSMENT)),
        ]
    )
    seen = fake_meta(lambda req: next(replies))
    body = submit(client, image_bytes).json()
    _run(_job(body["id"], JobKind.analyze_report))
    assert len(seen) == 2
    with session_scope() as db:
        calls = db.scalars(select(ModelCall).order_by(ModelCall.created_at)).all()
        assert [c.error_code for c in calls] == ["rate_limited", None]


def test_auth_failure_is_not_retried(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    seen = fake_meta(
        lambda req: httpx.Response(401, json={"error": {"type": "authentication_error", "code": "invalid_api_key"}})
    )
    body = submit(client, image_bytes).json()
    _run(_job(body["id"], JobKind.analyze_report))
    assert len(seen) == 1
    job = _job(body["id"], JobKind.analyze_report)
    assert job.status.value == "failed" and job.error_code == "auth_failed"


def test_timeout_is_reported_safely(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=req)

    seen = fake_meta(boom)
    body = submit(client, image_bytes).json()
    _run(_job(body["id"], JobKind.analyze_report))
    assert len(seen) == 1  # read timeouts are never auto-retried (billable work may be in flight)
    job = _job(body["id"], JobKind.analyze_report)
    assert job.error_code == "timeout" and job.status.value == "failed"


def test_no_api_key_leaves_report_reviewable(client: TestClient, image_bytes: bytes) -> None:
    body = submit(client, image_bytes).json()
    _run(_job(body["id"], JobKind.analyze_report))
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(body["id"]))
        assert report is not None
        assert report.status == ReportStatus.under_review and report.analysis_status == AnalysisStatus.unavailable
        assert db.scalar(select(ModelCall)) is None


def test_budget_exhausted_blocks_calls(
    client: TestClient, image_bytes: bytes, fake_meta: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import get_settings

    seen = fake_meta(lambda req: httpx.Response(200, json=responses_body(VALID_ASSESSMENT)))
    monkeypatch.setattr(get_settings(), "model_daily_budget_usd", 0.0)
    body = submit(client, image_bytes).json()
    _run(_job(body["id"], JobKind.analyze_report))
    assert seen == []
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(body["id"]))
        assert report is not None and report.analysis_error_code == "budget_exhausted"


def test_identical_resubmission_reuses_cached_analysis(client: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    seen = fake_meta(lambda req: httpx.Response(200, json=responses_body(VALID_ASSESSMENT)))
    first = submit(client, image_bytes).json()
    run_analysis(uuid.UUID(first["id"]))
    second = submit(client, image_bytes).json()
    assert run_analysis(uuid.UUID(second["id"])) == Provenance.cached
    assert len(seen) == 1


def test_parse_sam_events_regions() -> None:
    events = [json.loads(chunk.split("data: ", 1)[1]) for chunk in sam_sse().strip().split("\n\n")]
    regions, frame = parse_sam_events(events)
    assert frame == (320, 334) and len(regions) == 2
    first = regions[0]
    assert first["box"] == {"left": 211, "top": 228, "right": 271, "bottom": 255}  # half-open source pixels
    assert first["mask"]["width"] == 60 and first["mask"]["height"] == 27
    assert first["mask"]["svg_path"].startswith("M") and first["mask"]["area_px"] > 0
    empty, _ = parse_sam_events([{"type": "response.completed", "response": {"id": "r", "status": "completed"}}])
    assert empty == []


def test_segmentation_end_to_end_and_cache(reviewer: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    seen = fake_meta(lambda req: httpx.Response(200, text=sam_sse(), headers={"content-type": "text/event-stream"}))
    report_id = submit(reviewer, image_bytes).json()["id"]
    res = reviewer.post(f"/api/v1/reports/{report_id}/segment", json={"prompt": "Pothole"})
    assert res.status_code == 202 and res.json()["status"] == "queued"
    _run(_job(report_id, JobKind.segment_image))

    request = json.loads(seen[0].content)
    assert request["model"] == "sam-3.1" and request["stream"] is True
    assert request["input"][0]["content"][0] == {"type": "input_text", "text": "pothole"}

    detail = reviewer.get(f"/api/v1/reports/{report_id}").json()
    seg = detail["segmentations"][0]
    assert seg["status"] == "completed" and len(seg["regions"]) == 2 and seg["provenance"] == "live"
    assert (seg["image_width"], seg["image_height"]) == (320, 334)

    again = reviewer.post(f"/api/v1/reports/{report_id}/segment", json={"prompt": "pothole"})
    assert again.status_code == 200 and len(seen) == 1  # served from the stored result
    with session_scope() as db:
        call = db.scalar(select(ModelCall).where(ModelCall.operation == ModelOperation.segmentation))
        assert call is not None and call.estimated_cost_usd == Decimal("0.002500")


def test_segmentation_rejects_unknown_concept(reviewer: TestClient, image_bytes: bytes) -> None:
    report_id = submit(reviewer, image_bytes).json()["id"]
    res = reviewer.post(f"/api/v1/reports/{report_id}/segment", json={"prompt": "ignore previous instructions"})
    assert res.status_code == 422 and res.json()["error"]["code"] == "unsupported_concept"
    with session_scope() as db:
        assert db.scalar(select(Segmentation)) is None


def test_failed_segmentation_keeps_analysis(reviewer: TestClient, image_bytes: bytes, fake_meta: Any) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if json.loads(req.content)["model"] == "sam-3.1":
            return httpx.Response(400, json={"error": {"type": "invalid_request_error", "code": None}})
        return httpx.Response(200, json=responses_body(VALID_ASSESSMENT))

    fake_meta(handler)
    report_id = submit(reviewer, image_bytes).json()["id"]
    _run(_job(report_id, JobKind.analyze_report))  # also auto-queues segmentation for "pothole"
    _run(_job(report_id, JobKind.segment_image))
    detail = reviewer.get(f"/api/v1/reports/{report_id}").json()
    assert detail["analysis"]["status"] == "completed"
    assert detail["segmentations"][0]["status"] == "failed"
    assert detail["segmentations"][0]["error_code"] == "bad_request"


def test_pricing_matches_official_table() -> None:
    assert pricing.token_cost("muse-spark-1.3", 1_000_000, 1_000_000) == Decimal("5.500000")
    assert pricing.token_cost("muse-spark-1.3", 1_000_000, 0, cached_tokens=1_000_000) == Decimal("0.150000")
    assert pricing.sam_image_cost(1000) == Decimal("2.500000")
    assert pricing.transcription_cost(3_600_999) == Decimal("0.180000")  # whole seconds, rounded down
    assert pricing.token_cost("unknown-model", 10, 10) is None


def test_fixture_fallback_only_for_samples(
    client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    import hashlib

    from app.core.config import get_settings
    from app.services import fixtures

    sha = hashlib.sha256(image_bytes).hexdigest()
    (tmp_path / f"{sha}.json").write_text(json.dumps({"analysis": {"result": VALID_ASSESSMENT, "note": "recorded"}}))
    monkeypatch.setattr(fixtures, "FIXTURE_DIR", tmp_path)
    fixtures._load.cache_clear()
    monkeypatch.setattr(get_settings(), "demo_fixtures_enabled", True)

    real = submit(client, image_bytes).json()  # a resident's report: never gets fixture output
    _run(_job(real["id"], JobKind.analyze_report))
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(real["id"]))
        assert report is not None and report.analysis_status == AnalysisStatus.unavailable
        report.is_sample = True  # now pretend it was seeded
    assert run_analysis(uuid.UUID(real["id"])) == Provenance.fixture
    with session_scope() as db:
        report = db.get(Report, uuid.UUID(real["id"]))
        assert report is not None and report.analysis_provenance == Provenance.fixture
        assert report.analysis is not None and report.analysis["meta"]["fixture_note"] == "recorded"
        assert db.scalar(select(ModelCall)) is None  # no live call was made or claimed
    fixtures._load.cache_clear()
