// The parts of backend/app/schemas/api.py the app uses; frontend/src/lib/types.ts mirrors the full schema.

export type HazardCategory = 'pothole' | 'road_surface_damage' | 'blocked_drainage' | 'flooding';
export type ReportStatus =
  | 'submitted'
  | 'processing'
  | 'under_review'
  | 'confirmed'
  | 'duplicate'
  | 'rejected'
  | 'resolved'
  | 'processing_failed';
export type IncidentStatus = 'confirmed' | 'resolved';
export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unavailable';
export type Provenance = 'live' | 'cached' | 'fixture';
export type Severity = 'low' | 'moderate' | 'high' | 'critical' | 'undetermined';
export type Priority = 'routine' | 'elevated' | 'urgent';
export type LocationSource = 'map_pin' | 'device_gps' | 'none';
export type SegmentationStatus = 'queued' | 'running' | 'completed' | 'failed';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

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
  source: 'image' | 'description' | 'image_and_description';
}

export interface HazardAssessment {
  is_infrastructure_hazard: boolean;
  hazard_category: HazardCategory | 'other_hazard' | 'not_applicable' | 'unclear';
  summary: string;
  observations: Observation[];
  severity: Severity;
  severity_rationale: string;
  confidence: 'low' | 'medium' | 'high';
  uncertainties: string[];
  missing_information: string[];
  suggested_review_priority: Priority;
  description_consistency:
    'consistent' | 'partially_consistent' | 'inconsistent' | 'no_description';
  consistency_note: string;
  image_quality: 'good' | 'fair' | 'poor' | 'unusable';
  segmentation_concept: string;
}

export interface AnalysisView {
  status: AnalysisStatus;
  provenance: Provenance | null;
  model: string | null;
  completed_at: string | null;
  error_code: string | null;
  result: HazardAssessment | null;
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
  error_code: string | null;
  created_at: string;
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
  description: string;
  location: LatLon | null;
  location_source: LocationSource;
  location_note: string | null;
  analysis_status: AnalysisStatus;
  ai_summary: string | null;
  ai_severity: Severity | null;
  incident: IncidentBrief | null;
  is_sample: boolean;
  has_audio: boolean;
  thumbnail: MediaRef | null;
}

export interface ReportDetail extends ReportSummary {
  voice_transcript: string | null;
  location_accuracy_m: number | null;
  image: MediaRef;
  audio: MediaRef | null;
  analysis: AnalysisView;
  segmentations: SegmentationView[];
  fix_checks: FixCheck[];
}

export type FixVerdict =
  'repaired' | 'partially_repaired' | 'not_repaired' | 'different_place' | 'insufficient_evidence';

export interface FixImage {
  image: MediaRef;
  regions: SegmentationRegion[] | null;
  width: number | null;
  height: number | null;
  coverage: number | null;
}

/** A newer photo of the spot compared with the report's original. A reviewer still decides. */
export interface FixCheck {
  id: string;
  created_at: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  verdict: FixVerdict | null;
  assessment: {
    same_place: 'same' | 'likely_same' | 'unclear' | 'different';
    visible_changes: string;
    reasoning: string;
    remaining_concerns: string[];
  } | null;
  concept: string | null;
  before: FixImage;
  after: FixImage;
  provenance: Provenance | null;
  error_code: string | null;
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
  is_sample: boolean;
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

export interface AppConfig {
  model_api_configured: boolean;
  segmentation_concepts: string[];
  categories: HazardCategory[];
  max_image_mb: number;
  max_audio_seconds: number;
  map_bounds: { min_lat: number; max_lat: number; min_lon: number; max_lon: number };
}
