import type {
  AnalysisStatus,
  HazardCategory,
  ModelVerdict,
  Priority,
  Provenance,
  ReportStatus,
  Severity,
} from "./types";

export const CATEGORY_LABEL: Record<HazardCategory, string> = {
  pothole: "Pothole",
  road_surface_damage: "Damaged road surface",
  blocked_drainage: "Blocked drainage",
  flooding: "Localized flooding",
};

export const CATEGORY_HINT: Record<HazardCategory, string> = {
  pothole: "A hole or depression in the road",
  road_surface_damage: "Cracked, broken or eroded road surface",
  blocked_drainage: "Drain or channel blocked by rubbish or silt",
  flooding: "Standing water covering a road or path",
};

/** CSS custom property per category (defined in globals.css @theme). */
export const CATEGORY_COLOR: Record<HazardCategory, string> = {
  pothole: "var(--color-cat-pothole)",
  road_surface_damage: "var(--color-cat-road)",
  blocked_drainage: "var(--color-cat-drain)",
  flooding: "var(--color-cat-flood)",
};

/** Hex values for contexts that can't read CSS variables (MapLibre paint). */
export const CATEGORY_HEX: Record<HazardCategory, string> = {
  pothole: "#b4562f",
  road_surface_damage: "#8a6a3c",
  blocked_drainage: "#2b6f78",
  flooding: "#3b5fa3",
};

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  submitted: "Submitted",
  processing: "Processing",
  under_review: "Awaiting review",
  confirmed: "Confirmed incident",
  duplicate: "Linked duplicate",
  rejected: "Rejected",
  resolved: "Resolved",
  processing_failed: "Processing failed",
};

export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  pending: "Queued",
  running: "Analysing",
  completed: "Analysed",
  failed: "Analysis failed",
  unavailable: "AI unavailable",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Critical",
  undetermined: "Undetermined",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  routine: "Routine",
  elevated: "Elevated",
  urgent: "Urgent",
};

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  live: "Live model call",
  cached: "Cached result",
  fixture: "Demo fixture",
};

export const VERDICT_LABEL: Record<ModelVerdict, string> = {
  likely_same: "Likely the same",
  possibly_same: "Possibly the same",
  likely_different: "Likely different",
  insufficient_evidence: "Not enough evidence",
};

const ERROR_LABEL: Record<string, string> = {
  not_configured: "The Meta Model API key isn't configured on the server.",
  budget_exhausted: "The configured model budget has been reached.",
  model_budget_exhausted: "The configured model budget has been reached.",
  rate_limited: "The model provider is rate-limiting requests; it will retry.",
  provider_unavailable: "The model provider was unavailable.",
  timeout: "The model request timed out.",
  gateway_timeout: "The model request timed out.",
  malformed_output: "The model returned output that failed validation.",
  model_refused: "The model declined to analyse this image.",
  model_not_found: "The configured model isn't available to this account.",
  auth_failed: "The model API rejected the server's credentials.",
  content_policy_violation: "The provider declined this media under its content policy.",
  invalid_mask: "SAM returned a mask that failed validation.",
  internal_error: "An internal error occurred; it will retry.",
};

export function errorLabel(code: string | null | undefined): string {
  if (!code) return "Unknown error.";
  return ERROR_LABEL[code] ?? code.replaceAll("_", " ");
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined) return "Unknown";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatHours(h: number): string {
  if (h < 1) return "< 1 hour";
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
