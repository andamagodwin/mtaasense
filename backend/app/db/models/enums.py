from enum import StrEnum


class UserRole(StrEnum):
    reviewer = "reviewer"
    admin = "admin"


class HazardCategory(StrEnum):
    pothole = "pothole"
    road_surface_damage = "road_surface_damage"
    blocked_drainage = "blocked_drainage"
    flooding = "flooding"


# Categories in the same family are plausible descriptions of the same physical
# problem (a deep pothole vs. broken surface; a blocked drain vs. the flood it causes).
HAZARD_FAMILY: dict[HazardCategory, str] = {
    HazardCategory.pothole: "road",
    HazardCategory.road_surface_damage: "road",
    HazardCategory.blocked_drainage: "drainage",
    HazardCategory.flooding: "drainage",
}


class ReportStatus(StrEnum):
    submitted = "submitted"
    processing = "processing"
    under_review = "under_review"
    confirmed = "confirmed"
    duplicate = "duplicate"
    rejected = "rejected"
    resolved = "resolved"
    processing_failed = "processing_failed"


class IncidentStatus(StrEnum):
    confirmed = "confirmed"
    resolved = "resolved"


class AnalysisStatus(StrEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    unavailable = "unavailable"


class Provenance(StrEnum):
    """Where an AI result came from. Shown in the UI next to every result."""

    live = "live"
    cached = "cached"
    fixture = "fixture"


class Severity(StrEnum):
    low = "low"
    moderate = "moderate"
    high = "high"
    critical = "critical"
    undetermined = "undetermined"


class Priority(StrEnum):
    routine = "routine"
    elevated = "elevated"
    urgent = "urgent"


class LocationSource(StrEnum):
    map_pin = "map_pin"
    device_gps = "device_gps"
    none = "none"


class MediaKind(StrEnum):
    image = "image"
    audio = "audio"


class MediaVariant(StrEnum):
    original = "original"
    display = "display"
    wav = "wav"


class SuggestionStatus(StrEnum):
    pending = "pending"
    deferred = "deferred"
    confirmed = "confirmed"
    rejected = "rejected"


class ModelVerdict(StrEnum):
    likely_same = "likely_same"
    possibly_same = "possibly_same"
    likely_different = "likely_different"
    insufficient_evidence = "insufficient_evidence"


class JobKind(StrEnum):
    analyze_report = "analyze_report"
    segment_image = "segment_image"
    match_duplicates = "match_duplicates"


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class SegmentationStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class ModelOperation(StrEnum):
    analysis = "analysis"
    segmentation = "segmentation"
    transcription = "transcription"
    duplicate_assessment = "duplicate_assessment"
