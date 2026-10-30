"""Postgres-backed job queue.

Jobs survive API/worker restarts because they live in `processing_jobs`. Workers claim
with `FOR UPDATE SKIP LOCKED`, so several workers can run safely. A partial unique index
on `dedupe_key` (active jobs only) stops duplicate expensive work from being queued.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.models import ProcessingJob
from app.db.models.enums import JobKind, JobStatus

_ACTIVE = (JobStatus.queued.value, JobStatus.running.value)


def enqueue(
    db: Session,
    kind: JobKind,
    report_id: uuid.UUID,
    *,
    dedupe: str,
    segmentation_id: uuid.UUID | None = None,
    options: dict[str, Any] | None = None,
    delay_seconds: int = 0,
    max_attempts: int = 3,
) -> ProcessingJob:
    """Queue a job, or return the already-active job with the same dedupe key."""
    stmt = (
        insert(ProcessingJob)
        .values(
            id=uuid.uuid4(),
            kind=kind,
            report_id=report_id,
            segmentation_id=segmentation_id,
            status=JobStatus.queued,
            attempts=0,
            max_attempts=max_attempts,
            run_after=datetime.now(UTC) + timedelta(seconds=delay_seconds),
            dedupe_key=dedupe,
            options=options or {},
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"], index_where=text("status IN ('queued', 'running')"))
        .returning(ProcessingJob.id)
    )
    new_id = db.execute(stmt).scalar_one_or_none()
    if new_id is not None:
        job = db.get(ProcessingJob, new_id)
    else:
        job = db.scalar(
            select(ProcessingJob).where(ProcessingJob.dedupe_key == dedupe, ProcessingJob.status.in_(_ACTIVE))
        )
    assert job is not None
    return job


def claim_next(db: Session, worker_id: str) -> ProcessingJob | None:
    candidate = (
        select(ProcessingJob.id)
        .where(ProcessingJob.status == JobStatus.queued, ProcessingJob.run_after <= datetime.now(UTC))
        .order_by(ProcessingJob.run_after)
        .limit(1)
        .with_for_update(skip_locked=True)
        .scalar_subquery()
    )
    job_id = db.execute(
        update(ProcessingJob)
        .where(ProcessingJob.id == candidate)
        .values(
            status=JobStatus.running,
            locked_at=datetime.now(UTC),
            locked_by=worker_id,
            attempts=ProcessingJob.attempts + 1,
        )
        .returning(ProcessingJob.id)
    ).scalar_one_or_none()
    return db.get(ProcessingJob, job_id) if job_id else None


def mark_succeeded(db: Session, job_id: uuid.UUID) -> None:
    db.execute(
        update(ProcessingJob)
        .where(ProcessingJob.id == job_id)
        .values(
            status=JobStatus.succeeded,
            completed_at=datetime.now(UTC),
            locked_at=None,
            error_code=None,
            error_detail=None,
        )
    )


def mark_failed(db: Session, job: ProcessingJob, code: str, *, retryable: bool, detail: str | None = None) -> bool:
    """Record a failure. Returns True if the job will be retried."""
    retry = retryable and job.attempts < job.max_attempts
    values: dict[str, Any] = {"error_code": code, "error_detail": detail, "locked_at": None}
    if retry:
        backoff = 20 * 2 ** (job.attempts - 1)
        values |= {"status": JobStatus.queued, "run_after": datetime.now(UTC) + timedelta(seconds=backoff)}
    else:
        values |= {"status": JobStatus.failed, "completed_at": datetime.now(UTC)}
    db.execute(update(ProcessingJob).where(ProcessingJob.id == job.id).values(**values))
    return retry


def reap_stale(db: Session, timeout_seconds: int) -> int:
    """Requeue jobs whose worker died mid-run (or fail them if out of attempts)."""
    cutoff = datetime.now(UTC) - timedelta(seconds=timeout_seconds)
    stale = and_(ProcessingJob.status == JobStatus.running, ProcessingJob.locked_at < cutoff)
    requeued = db.execute(
        update(ProcessingJob)
        .where(stale, ProcessingJob.attempts < ProcessingJob.max_attempts)
        .values(status=JobStatus.queued, locked_at=None, locked_by=None, error_code="worker_lost")
        .returning(ProcessingJob.id)
    ).all()
    db.execute(
        update(ProcessingJob)
        .where(stale, ProcessingJob.attempts >= ProcessingJob.max_attempts)
        .values(status=JobStatus.failed, completed_at=datetime.now(UTC), error_code="worker_lost")
    )
    return len(requeued)
