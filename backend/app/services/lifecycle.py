"""Status lifecycles. Every status change goes through these tables; the API never sets status directly."""

from app.core.errors import InvalidTransition
from app.db.models import Report
from app.db.models.enums import HazardCategory, IncidentStatus, ReportStatus

R = ReportStatus

REPORT_TRANSITIONS: dict[ReportStatus, set[ReportStatus]] = {
    R.submitted: {R.processing, R.under_review, R.processing_failed},
    R.processing: {R.under_review, R.processing_failed},
    R.processing_failed: {R.processing, R.under_review, R.confirmed, R.duplicate, R.rejected},
    R.under_review: {R.confirmed, R.duplicate, R.rejected},
    R.confirmed: {R.resolved},
    R.duplicate: {R.resolved},
    R.rejected: {R.under_review},
    R.resolved: {R.confirmed, R.duplicate},
}

INCIDENT_TRANSITIONS: dict[IncidentStatus, set[IncidentStatus]] = {
    IncidentStatus.confirmed: {IncidentStatus.resolved},
    IncidentStatus.resolved: {IncidentStatus.confirmed},
}

# Reports a reviewer can still act on (link, confirm, reject).
REVIEWABLE = {R.under_review, R.processing_failed}
# Reports that may be offered as duplicate candidates.
MATCHABLE = {R.submitted, R.processing, R.under_review, R.processing_failed, R.confirmed, R.duplicate}


def transition_report(report: Report, target: ReportStatus) -> None:
    if target == report.status:
        return
    if target not in REPORT_TRANSITIONS[report.status]:
        raise InvalidTransition(f"A report cannot move from '{report.status.value}' to '{target.value}'.")
    report.status = target


def check_incident_transition(current: IncidentStatus, target: IncidentStatus) -> None:
    if target != current and target not in INCIDENT_TRANSITIONS[current]:
        raise InvalidTransition(f"An incident cannot move from '{current.value}' to '{target.value}'.")


def effective_category(report: Report) -> HazardCategory | None:
    """Reviewer correction wins, then what the resident chose, then the model's suggestion."""
    return report.reviewer_category or report.reporter_category or report.ai_category


def refresh_category(report: Report) -> None:
    report.hazard_category = effective_category(report)
