import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.core.errors import InvalidTransition
from app.db.models import ProcessingJob, Report
from app.db.models.enums import JobKind, JobStatus, ReportStatus
from app.db.session import session_scope
from app.services import jobs
from app.services.lifecycle import transition_report
from tests.conftest import submit


def test_active_jobs_are_deduplicated(client: TestClient, image_bytes: bytes) -> None:
    rid = uuid.UUID(submit(client, image_bytes).json()["id"])
    with session_scope() as db:
        first = jobs.enqueue(db, JobKind.match_duplicates, rid, dedupe=f"match:{rid}")
        second = jobs.enqueue(db, JobKind.match_duplicates, rid, dedupe=f"match:{rid}")
        assert first.id == second.id


def test_claim_retry_backoff_and_final_failure(client: TestClient, image_bytes: bytes) -> None:
    submit(client, image_bytes)
    with session_scope() as db:
        job = jobs.claim_next(db, "test-worker")
        assert job is not None and job.status == JobStatus.running and job.attempts == 1
        assert jobs.claim_next(db, "other-worker") is None  # nothing else queued
        assert jobs.mark_failed(db, job, "rate_limited", retryable=True) is True
    with session_scope() as db:
        refreshed = db.get(ProcessingJob, job.id)
        assert refreshed is not None and refreshed.status == JobStatus.queued
        assert refreshed.run_after > datetime.now(UTC)  # backoff
        db.execute(update(ProcessingJob).values(run_after=datetime.now(UTC) - timedelta(seconds=1)))
    with session_scope() as db:
        job = jobs.claim_next(db, "w")
        assert job is not None and job.attempts == 2
        assert jobs.mark_failed(db, job, "bad_request", retryable=False) is False
    with session_scope() as db:
        final = db.get(ProcessingJob, job.id)
        assert final is not None and final.status == JobStatus.failed and final.error_code == "bad_request"


def test_stale_running_jobs_are_requeued(client: TestClient, image_bytes: bytes) -> None:
    submit(client, image_bytes)
    with session_scope() as db:
        job = jobs.claim_next(db, "dead-worker")
        assert job is not None
        db.execute(update(ProcessingJob).values(locked_at=datetime.now(UTC) - timedelta(hours=1)))
    with session_scope() as db:
        assert jobs.reap_stale(db, timeout_seconds=600) == 1
        assert db.get(ProcessingJob, job.id).status == JobStatus.queued  # type: ignore[union-attr]


def test_report_transitions_are_enforced(client: TestClient, image_bytes: bytes) -> None:
    rid = uuid.UUID(submit(client, image_bytes).json()["id"])
    with session_scope() as db:
        report = db.get(Report, rid)
        assert report is not None
        with pytest.raises(InvalidTransition):
            transition_report(report, ReportStatus.resolved)  # submitted -> resolved skips review
        transition_report(report, ReportStatus.processing)
        transition_report(report, ReportStatus.under_review)
        transition_report(report, ReportStatus.rejected)
        with pytest.raises(InvalidTransition):
            transition_report(report, ReportStatus.duplicate)


def test_rate_limit_on_public_submission(
    client: TestClient, image_bytes: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "report_rate_limit_per_hour", 2)
    assert submit(client, image_bytes).status_code == 201
    assert submit(client, image_bytes).status_code == 201
    limited = submit(client, image_bytes)
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "rate_limited"
