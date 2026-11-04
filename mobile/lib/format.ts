import { colors } from '@/theme/tokens';

import type {
  AnalysisStatus,
  FixCheck,
  FixVerdict,
  HazardCategory,
  ReportStatus,
  Severity,
} from './types';

export const CATEGORIES: HazardCategory[] = [
  'pothole',
  'road_surface_damage',
  'blocked_drainage',
  'flooding',
];

export const CATEGORY_LABEL: Record<HazardCategory, string> = {
  pothole: 'Pothole',
  road_surface_damage: 'Damaged road surface',
  blocked_drainage: 'Blocked drainage',
  flooding: 'Localized flooding',
};

export const FIX_VERDICT_LABEL: Record<FixVerdict, string> = {
  repaired: 'Looks repaired',
  partially_repaired: 'Partly repaired',
  not_repaired: 'Not repaired yet',
  different_place: 'Different spot',
  insufficient_evidence: 'Can’t tell from the photos',
};

export const SAME_PLACE_LABEL: Record<NonNullable<FixCheck['assessment']>['same_place'], string> = {
  same: 'Same spot as your original photo',
  likely_same: 'Probably the same spot',
  unclear: 'Can’t confirm it’s the same spot',
  different: 'Looks like a different spot',
};

export const CATEGORY_HINT: Record<HazardCategory, string> = {
  pothole: 'A hole or depression in the road',
  road_surface_damage: 'Cracked, broken or eroded road surface',
  blocked_drainage: 'Drain or channel blocked by rubbish or silt',
  flooding: 'Standing water covering a road or path',
};

export const CATEGORY_HEX: Record<HazardCategory, string> = {
  pothole: colors.cat.pothole,
  road_surface_damage: colors.cat.road,
  blocked_drainage: colors.cat.drain,
  flooding: colors.cat.flood,
};

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  submitted: 'Submitted',
  processing: 'Processing',
  under_review: 'Awaiting review',
  confirmed: 'Confirmed incident',
  duplicate: 'Linked duplicate',
  rejected: 'Rejected',
  resolved: 'Resolved',
  processing_failed: 'Processing failed',
};

export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  pending: 'Queued',
  running: 'Analysing',
  completed: 'Analysed',
  failed: 'Analysis failed',
  unavailable: 'AI unavailable',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
  undetermined: 'Undetermined',
};

const ERROR_LABEL: Record<string, string> = {
  not_configured: "The model API isn't configured on the server.",
  budget_exhausted: 'The model budget has been reached.',
  model_budget_exhausted: 'The model budget has been reached.',
  rate_limited: 'The model provider is busy.',
  provider_unavailable: 'The model provider was unavailable.',
  timeout: 'The model request timed out.',
  gateway_timeout: 'The model request timed out.',
};

export function errorLabel(code: string | null | undefined): string {
  if (!code) return 'Unknown error.';
  return ERROR_LABEL[code] ?? code.replaceAll('_', ' ');
}

// Hermes on Android has no Intl.RelativeTimeFormat, so relative times are spelled out by hand.
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return ago(Math.max(1, Math.round(seconds / 60)), 'minute');
  if (seconds < 86400) return ago(Math.round(seconds / 3600), 'hour');
  if (seconds < 86400 * 2) return 'yesterday';
  if (seconds < 86400 * 30) return ago(Math.round(seconds / 86400), 'day');
  return formatDate(iso);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function formatHour(iso: string): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: true }).format(at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thatDay = new Date(at);
  thatDay.setHours(0, 0, 0, 0);
  const daysOut = Math.round((thatDay.getTime() - today.getTime()) / 86400000);
  if (daysOut <= 0) return time;
  if (daysOut === 1) return `${time} tomorrow`;
  return `${time} ${new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(at)}`;
}

export const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
