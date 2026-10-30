import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.enums import (
    AnalysisStatus,
    HazardCategory,
    IncidentStatus,
    JobKind,
    JobStatus,
    LocationSource,
    ModelVerdict,
    Priority,
    Provenance,
    ReportStatus,
    SegmentationStatus,
    Severity,
    SuggestionStatus,
    UserRole,
)
from app.schemas.analysis import HazardAssessment


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LatLon(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class MediaRef(Out):
    id: uuid.UUID
    url: str
    content_type: str
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    size_bytes: int


class AnalysisView(Out):
    status: AnalysisStatus
    provenance: Provenance | None
    model: str | None
    completed_at: datetime | None
    error_code: str | None
    result: HazardAssessment | None
    meta: dict[str, Any] | None


class SegmentationRegion(BaseModel):
    object_id: str
    box: dict[str, float]
    confidence: float | None
    mask: dict[str, Any]


class SegmentationView(Out):
    id: uuid.UUID
    prompt: str
    status: SegmentationStatus
    regions: list[SegmentationRegion] | None
    image_width: int | None
    image_height: int | None
    model: str | None
    provenance: Provenance | None
    error_code: str | None
    created_at: datetime
    completed_at: datetime | None


class JobView(Out):
    id: uuid.UUID
    kind: JobKind
    status: JobStatus
    attempts: int
    max_attempts: int
    error_code: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class IncidentBrief(Out):
    id: uuid.UUID
    reference: str
    title: str
    status: IncidentStatus


class ReportSummary(Out):
    id: uuid.UUID
    reference: str
    created_at: datetime
    status: ReportStatus
    hazard_category: HazardCategory | None
    reporter_category: HazardCategory | None
    ai_category: HazardCategory | None
    reviewer_category: HazardCategory | None
    description: str
    location: LatLon | None
    location_source: LocationSource
    location_note: str | None
    analysis_status: AnalysisStatus
    analysis_provenance: Provenance | None
    ai_summary: str | None
    ai_severity: Severity | None
    ai_priority: Priority | None
    incident: IncidentBrief | None
    is_sample: bool
    has_audio: bool
    thumbnail: MediaRef | None
    open_duplicate_suggestions: int = 0


class ReportDetail(ReportSummary):
    voice_transcript: str | None
    voice_transcript_machine: str | None
    location_accuracy_m: float | None
    image: MediaRef
    original_image: MediaRef
    audio: MediaRef | None
    analysis: AnalysisView
    segmentations: list[SegmentationView]
    jobs: list[JobView]
    allowed_actions: list[str]


class ReportCreated(BaseModel):
    id: uuid.UUID
    reference: str
    receipt_token: str
    status: ReportStatus
    job_id: uuid.UUID | None
    duplicate_of_request: bool = False


class TranscriptionResult(BaseModel):
    audio_id: uuid.UUID
    claim_token: str | None
    duration_ms: int
    transcript: str | None
    error_code: str | None


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class DuplicateSuggestionView(Out):
    id: uuid.UUID
    status: SuggestionStatus
    score: float
    signals: dict[str, Any]
    model_verdict: ModelVerdict | None
    model_assessment: dict[str, Any] | None
    model_provenance: Provenance | None
    decided_by: str | None
    decided_at: datetime | None
    decision_note: str | None
    created_at: datetime
    source: ReportSummary
    candidate: ReportSummary


class SuggestionDecision(BaseModel):
    decision: Literal["confirm", "reject", "defer"]
    note: str | None = Field(default=None, max_length=2000)


class IncidentSummary(Out):
    id: uuid.UUID
    reference: str
    title: str
    hazard_category: HazardCategory
    status: IncidentStatus
    priority: Priority
    severity: Severity
    location: LatLon | None
    report_count: int
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    is_sample: bool


class IncidentDetail(IncidentSummary):
    summary: str
    resolution_note: str | None
    primary_report_id: uuid.UUID | None
    reports: list[ReportSummary] | None = None
    first_reported_at: datetime | None
    last_reported_at: datetime | None


class IncidentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=3, max_length=160)
    summary: str | None = Field(default=None, max_length=4000)
    status: IncidentStatus | None = None
    priority: Priority | None = None
    severity: Severity | None = None
    hazard_category: HazardCategory | None = None
    resolution_note: str | None = Field(default=None, max_length=4000)
    note: str | None = Field(default=None, max_length=2000)


class ReviewAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["confirm_incident", "reject", "reopen"]
    title: str | None = Field(default=None, min_length=3, max_length=160)
    priority: Priority | None = None
    note: str | None = Field(default=None, max_length=2000)


class ReportUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reviewer_category: HazardCategory
    note: str | None = Field(default=None, max_length=2000)


class SegmentRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=64)


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class NoteView(Out):
    id: uuid.UUID
    created_at: datetime
    author: str | None
    body: str


class AuditView(Out):
    id: uuid.UUID
    created_at: datetime
    actor_label: str
    action: str
    data: dict[str, Any]
    note: str | None


class MapReport(BaseModel):
    id: uuid.UUID
    reference: str
    hazard_category: HazardCategory | None
    status: ReportStatus
    location: LatLon
    created_at: datetime
    is_sample: bool


class MapFeatures(BaseModel):
    incidents: list[IncidentSummary]
    reports: list[MapReport]
    unlocated_incidents: int
    unlocated_reports: int


class PublicStats(BaseModel):
    reports_total: int
    incidents_confirmed: int
    incidents_resolved: int
    reports_under_review: int
    sample_records: int


class ReviewSummary(BaseModel):
    reports_total: int
    reports_awaiting_review: int
    reports_processing: int
    processing_failures: int
    incidents_confirmed: int
    incidents_resolved: int
    potential_duplicates: int
    unlocated_reports: int
    sample_records: int
    by_category: dict[str, int]


class UserView(Out):
    id: uuid.UUID
    email: str
    display_name: str
    role: UserRole


class SessionView(BaseModel):
    user: UserView | None


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class AppConfig(BaseModel):
    model_api_configured: bool
    demo_fixtures_enabled: bool
    analysis_model: str
    segmentation_model: str
    transcription_model: str
    segmentation_concepts: list[str]
    categories: list[HazardCategory]
    max_image_mb: int
    max_audio_seconds: int
    map_bounds: dict[str, float]


class UsageBucket(BaseModel):
    key: str
    calls: int
    failures: int
    input_tokens: int
    output_tokens: int
    images: int
    audio_seconds: float
    estimated_cost_usd: Decimal
    avg_latency_ms: float | None


class ModelCallView(Out):
    id: uuid.UUID
    created_at: datetime
    operation: str
    model: str
    endpoint: str
    provenance: Provenance
    success: bool
    http_status: int | None
    error_code: str | None
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None
    reasoning_tokens: int | None
    image_count: int
    audio_ms: int | None
    estimated_cost_usd: Decimal


class UsageReport(BaseModel):
    estimated_total_usd: Decimal
    estimated_today_usd: Decimal
    daily_limit_usd: Decimal
    total_limit_usd: Decimal
    budget_exhausted: bool
    by_operation: list[UsageBucket]
    by_model: list[UsageBucket]
    by_day: list[UsageBucket]
    recent: list[ModelCallView]
    pricing_source: str
    pricing_retrieved: str
    note: str
