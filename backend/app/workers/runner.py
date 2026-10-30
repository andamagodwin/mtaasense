"""Background worker: `python -m app.workers.runner`.

Pipeline per report: analyze_report -> (segment_image for the suggested concept) + match_duplicates.
Matching always runs, even when AI analysis is unavailable, using resident-provided data.
"""

import logging
import os
import signal
import socket
import time
import uuid
from types import FrameType

from app.core.config import get_settings
from app.core.logging import configure_logging, log_event
from app.db.models import ProcessingJob, Report
from app.db.models.enums import JobKind
from app.db.session import session_scope
from app.services import jobs
from app.services.analysis import AnalysisFailed, mark_analysis_unavailable, run_analysis
from app.services.duplicate_matching import run_matching
from app.services.segmentation import (
    SegmentationFailed,
    mark_segmentation_failed,
    request_segmentation,
    run_segmentation,
)

logger = logging.getLogger("app.worker")
_stop = False


def _handle_stop(signum: int, frame: FrameType | None) -> None:
    global _stop
    _stop = True


def _queue_follow_ups(report_id: uuid.UUID, *, segment: bool) -> None:
    with session_scope() as db:
        jobs.enqueue(db, JobKind.match_duplicates, report_id, dedupe=f"match:{report_id}")
        if not segment:
            return
        report = db.get(Report, report_id)
        result = ((report.analysis or {}).get("result") or {}) if report else {}
        concept = result.get("segmentation_concept")
        if report is not None and result.get("is_infrastructure_hazard") and concept and concept != "none":
            request_segmentation(db, report, concept)


def process(
    job_id: uuid.UUID,
    kind: JobKind,
    report_id: uuid.UUID,
    segmentation_id: uuid.UUID | None,
    options: dict[str, object],
    attempts: int,
    max_attempts: int,
) -> None:
    try:
        if kind == JobKind.analyze_report:
            run_analysis(report_id, job_id, force=bool(options.get("force")))
            auto_segment = get_settings().auto_segment_after_analysis and not options.get("force")
            _queue_follow_ups(report_id, segment=auto_segment)
        elif kind == JobKind.segment_image:
            assert segmentation_id is not None
            run_segmentation(segmentation_id, job_id)
        elif kind == JobKind.match_duplicates:
            run_matching(report_id, job_id)
        with session_scope() as db:
            jobs.mark_succeeded(db, job_id)
    except (AnalysisFailed, SegmentationFailed) as exc:
        _fail(job_id, kind, report_id, segmentation_id, exc.code, exc.retryable, attempts, max_attempts)
    except Exception as exc:
        logger.exception("job_crashed", extra={"fields": {"job_id": str(job_id), "kind": kind.value}})
        _fail(
            job_id,
            kind,
            report_id,
            segmentation_id,
            "internal_error",
            True,
            attempts,
            max_attempts,
            detail=type(exc).__name__,
        )


def _fail(
    job_id: uuid.UUID,
    kind: JobKind,
    report_id: uuid.UUID,
    segmentation_id: uuid.UUID | None,
    code: str,
    retryable: bool,
    attempts: int,
    max_attempts: int,
    detail: str | None = None,
) -> None:
    # Missing credentials or budget are not transient: don't burn retries on them.
    if code in ("not_configured", "budget_exhausted", "auth_failed", "billing_not_configured"):
        retryable = False
    with session_scope() as db:
        job = db.get(ProcessingJob, job_id)
        assert job is not None
        will_retry = jobs.mark_failed(db, job, code, retryable=retryable, detail=detail)
    log_event(
        logger,
        "job_failed",
        logging.WARNING,
        job_id=str(job_id),
        kind=kind.value,
        code=code,
        will_retry=will_retry,
        attempt=attempts,
    )
    if kind == JobKind.analyze_report:
        mark_analysis_unavailable(report_id, code, final=not will_retry)
        if not will_retry:
            _queue_follow_ups(report_id, segment=False)
    elif kind == JobKind.segment_image and not will_retry and segmentation_id is not None:
        mark_segmentation_failed(segmentation_id, code)


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    log_event(logger, "worker_started", worker=worker_id, model_api_configured=settings.model_api_configured)
    last_reap = 0.0
    while not _stop:
        if time.monotonic() - last_reap > 60:
            with session_scope() as db:
                requeued = jobs.reap_stale(db, settings.worker_job_timeout_seconds)
            if requeued:
                log_event(logger, "jobs_requeued", count=requeued)
            last_reap = time.monotonic()
        with session_scope() as db:
            job = jobs.claim_next(db, worker_id)
            claimed = (
                (
                    job.id,
                    job.kind,
                    job.report_id,
                    job.segmentation_id,
                    dict(job.options or {}),
                    job.attempts,
                    job.max_attempts,
                )
                if job
                else None
            )
        if claimed is None:
            time.sleep(settings.worker_poll_seconds)
            continue
        log_event(logger, "job_started", job_id=str(claimed[0]), kind=claimed[1].value, attempt=claimed[5])
        try:
            process(*claimed)
        except Exception:
            logger.exception("job_bookkeeping_failed", extra={"fields": {"job_id": str(claimed[0])}})
    log_event(logger, "worker_stopped", worker=worker_id)


if __name__ == "__main__":
    main()
