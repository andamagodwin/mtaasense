// Mirrors backend/app/schemas/api.py and schemas/analysis.py. Keep in sync with the OpenAPI schema.

export type HazardCategory = "pothole" | "road_surface_damage" | "blocked_drainage" | "flooding";
export type ReportStatus =
  | "submitted"
  | "processing"
  | "under_review"
  | "confirmed"
  | "duplicate"
  | "rejected"
  | "resolved"
  | "processing_failed";
export type IncidentStatus = "confirmed" | "resolved";
export type AnalysisStatus = "pending" | "running" | "completed" | "failed" | "unavailable";
export type Provenance = "live" | "cached" | "fixture";
export type Severity = "low" | "moderate" | "high" | "critical" | "undetermined";
export type Priority = "routine" | "elevated" | "urgent";
export type LocationSource = "map_pin" | "device_gps" | "none";
export type SuggestionStatus = "pending" | "deferred" | "confirmed" | "rejected";
export type ModelVerdict = "likely_same" | "possibly_same" | "likely_different" | "insufficient_evidence";
export type SegmentationStatus = "queued" | "running" | "completed" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type UserRole = "reviewer" | "admin";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface MediaRef {
  id: string;
  url: string;
  content_type: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  size_bytes: number;
}

export interface Observation {
  text: string;
  source: "image" | "description" | "image_and_description";
}

export interface HazardAssessment {
  is_infrastructure_hazard: boolean;
  hazard_category: HazardCategory | "other_hazard" | "not_applicable" | "unclear";
  summary: string;
  observations: Observation[];
  severity: Severity;
  severity_rationale: string;
  confidence: "low" | "medium" | "high";
  uncertainties: string[];
  missing_information: string[];
  suggested_review_priority: Priority;
  description_consistency: "consistent" | "partially_consistent" | "inconsistent" | "no_description";
  consistency_note: string;
  image_quality: "good" | "fair" | "poor" | "unusable";
  segmentation_concept: string;
}

export interface AnalysisView {
  status: AnalysisStatus;
  provenance: Provenance | null;
  model: string | null;
  completed_at: string | null;
  error_code: string | null;
  result: HazardAssessment | null;
  meta: Record<string, unknown> | null;
}

export interface SegmentationRegion {
  object_id: string;
  box: { left: number; top: number; right: number; bottom: number };
  confidence: number | null;
  mask: { width: number; height: number; svg_path: string; area_px: number };
}

export interface SegmentationView {
  id: string;
  prompt: string;
  status: SegmentationStatus;
  regions: SegmentationRegion[] | null;
  image_width: number | null;
  image_height: number | null;
  model: string | null;
  provenance: Provenance | null;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface JobView {
  id: string;
  kind: "analyze_report" | "segment_image" | "match_duplicates";
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface IncidentBrief {
  id: string;
  reference: string;
  title: string;
  status: IncidentStatus;
}

export interface ReportSummary {
  id: string;
  reference: string;
  created_at: string;
  status: ReportStatus;
  hazard_category: HazardCategory | null;
  reporter_category: HazardCategory | null;
  ai_category: HazardCategory | null;
  reviewer_category: HazardCategory | null;
  description: string;
  location: LatLon | null;
  location_source: LocationSource;
  location_note: string | null;
  analysis_status: AnalysisStatus;
  analysis_provenance: Provenance | null;
  ai_summary: string | null;
  ai_severity: Severity | null;
  ai_priority: Priority | null;
  incident: IncidentBrief | null;
  is_sample: boolean;
  has_audio: boolean;
  thumbnail: MediaRef | null;
  open_duplicate_suggestions: number;
}

export interface ReportDetail extends ReportSummary {
  voice_transcript: string | null;
  voice_transcript_machine: string | null;
  location_accuracy_m: number | null;
  image: MediaRef;
  original_image: MediaRef;
  audio: MediaRef | null;
  analysis: AnalysisView;
  segmentations: SegmentationView[];
  jobs: JobView[];
  allowed_actions: string[];
}

export interface ReportCreated {
  id: string;
  reference: string;
  receipt_token: string;
  status: ReportStatus;
  job_id: string | null;
  duplicate_of_request: boolean;
}

export interface TranscriptionResult {
  audio_id: string;
  claim_token: string | null;
  duration_ms: number;
  transcript: string | null;
  error_code: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface DuplicateSignals {
  distance_m: number | null;
  hours_apart: number;
  source_category: HazardCategory | null;
  candidate_category: HazardCategory | null;
  category_relation: "same" | "same_family" | "different" | null;
  text_similarity: number;
  summary_similarity: number | null;
  components: Partial<Record<"location" | "category" | "text" | "time", number>>;
  method: string;
  radius_m: number;
  window_days: number;
}

export interface DuplicateSuggestionView {
  id: string;
  status: SuggestionStatus;
  score: number;
  signals: DuplicateSignals;
  model_verdict: ModelVerdict | null;
  model_assessment: { visual_comparison: string; reasoning: string; model: string; created_at: string } | null;
  model_provenance: Provenance | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  source: ReportSummary;
  candidate: ReportSummary;
}

export interface IncidentSummary {
  id: string;
  reference: string;
  title: string;
  hazard_category: HazardCategory;
  status: IncidentStatus;
  priority: Priority;
  severity: Severity;
  location: LatLon | null;
  report_count: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  is_sample: boolean;
}

export interface IncidentDetail extends IncidentSummary {
  summary: string;
  resolution_note: string | null;
  primary_report_id: string | null;
  reports: ReportSummary[] | null;
  first_reported_at: string | null;
  last_reported_at: string | null;
}

export interface MapReport {
  id: string;
  reference: string;
  hazard_category: HazardCategory | null;
  status: ReportStatus;
  location: LatLon;
  created_at: string;
  is_sample: boolean;
}

export interface MapFeatures {
  incidents: IncidentSummary[];
  reports: MapReport[];
  unlocated_incidents: number;
  unlocated_reports: number;
}

export interface PublicStats {
  reports_total: number;
  incidents_confirmed: number;
  incidents_resolved: number;
  reports_under_review: number;
  sample_records: number;
}

export interface ReviewSummary {
  reports_total: number;
  reports_awaiting_review: number;
  reports_processing: number;
  processing_failures: number;
  incidents_confirmed: number;
  incidents_resolved: number;
  potential_duplicates: number;
  unlocated_reports: number;
  sample_records: number;
  by_category: Record<string, number>;
}

export interface UserView {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
}

export interface NoteView {
  id: string;
  created_at: string;
  author: string | null;
  body: string;
}

export interface AuditView {
  id: string;
  created_at: string;
  actor_label: string;
  action: string;
  data: Record<string, unknown>;
  note: string | null;
}

export interface AppConfig {
  model_api_configured: boolean;
  demo_fixtures_enabled: boolean;
  analysis_model: string;
  segmentation_model: string;
  transcription_model: string;
  segmentation_concepts: string[];
  categories: HazardCategory[];
  max_image_mb: number;
  max_audio_seconds: number;
  map_bounds: { min_lat: number; max_lat: number; min_lon: number; max_lon: number };
}

export interface UsageBucket {
  key: string;
  calls: number;
  failures: number;
  input_tokens: number;
  output_tokens: number;
  images: number;
  audio_seconds: number;
  estimated_cost_usd: string;
  avg_latency_ms: number | null;
}

export interface ModelCallView {
  id: string;
  created_at: string;
  operation: string;
  model: string;
  endpoint: string;
  provenance: Provenance;
  success: boolean;
  http_status: number | null;
  error_code: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  image_count: number;
  audio_ms: number | null;
  estimated_cost_usd: string;
}

export interface UsageReport {
  estimated_total_usd: string;
  estimated_today_usd: string;
  daily_limit_usd: string;
  total_limit_usd: string;
  budget_exhausted: boolean;
  by_operation: UsageBucket[];
  by_model: UsageBucket[];
  by_day: UsageBucket[];
  recent: ModelCallView[];
  pricing_source: string;
  pricing_retrieved: string;
  note: string;
}

export interface EvaluationSummary {
  available: boolean;
  message?: string;
  [key: string]: unknown;
}
