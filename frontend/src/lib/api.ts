// Typed client for the MtaaSense FastAPI backend. All calls are same-origin (/api/v1/*) and are
// rewritten to NEXT_PUBLIC_API_BASE_URL by next.config.ts.

import type {
  AppConfig,
  AuditView,
  DuplicateSuggestionView,
  EvaluationSummary,
  IncidentDetail,
  IncidentSummary,
  IncidentStatus,
  JobView,
  MapFeatures,
  NoteView,
  Page,
  Priority,
  PublicStats,
  ReportCreated,
  ReportDetail,
  ReportStatus,
  ReportSummary,
  ReviewSummary,
  SegmentationView,
  Severity,
  HazardCategory,
  TranscriptionResult,
  UsageReport,
  UserView,
} from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const FRIENDLY: Record<number, string> = {
  0: "We couldn't reach MtaaSense. Check your connection and try again.",
  502: "The MtaaSense service is temporarily unavailable.",
  503: "The MtaaSense service is temporarily unavailable.",
  504: "The request took too long. Please try again.",
};

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body.error?.message) {
      return new ApiError(res.status, body.error.code ?? "error", body.error.message, body.error.details);
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, "http_error", FRIENDLY[res.status] ?? "Something went wrong. Please try again.");
}

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(withQuery(`${BASE}${path}`, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body,
      credentials: "same-origin",
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", FRIENDLY[0]);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** multipart upload with progress (fetch has no upload progress events). */
export function upload<T>(
  path: string,
  form: FormData,
  { headers, onProgress, signal }: { headers?: Record<string, string>; onProgress?: (f: number) => void; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    xhr.setRequestHeader("Accept", "application/json");
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, "network_error", FRIENDLY[0]));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.onload = () => {
      const res = new Response(xhr.responseText, { status: xhr.status, headers: { "Content-Type": "application/json" } });
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as T);
      else parseError(res).then(reject, reject);
    };
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

const tokenHeader = (token?: string | null): Record<string, string> | undefined =>
  token ? { "X-Report-Token": token } : undefined;

export const api = {
  config: () => request<AppConfig>("/config"),
  stats: () => request<PublicStats>("/stats"),

  submitReport: (form: FormData, idempotencyKey: string, onProgress?: (f: number) => void) =>
    upload<ReportCreated>("/reports", form, { headers: { "Idempotency-Key": idempotencyKey }, onProgress }),
  transcribe: (form: FormData, onProgress?: (f: number) => void) =>
    upload<TranscriptionResult>("/transcriptions", form, { onProgress }),
  report: (id: string, token?: string | null, signal?: AbortSignal) =>
    request<ReportDetail>(`/reports/${id}`, { headers: tokenHeader(token), signal }),
  segment: (id: string, prompt: string, token?: string | null) =>
    request<SegmentationView>(`/reports/${id}/segment`, { method: "POST", body: { prompt }, headers: tokenHeader(token) }),

  mapFeatures: (query: { category?: HazardCategory[]; status?: IncidentStatus[]; include_unreviewed?: boolean }) =>
    request<MapFeatures>("/map/features", { query }),
  incidents: (query: Query) => request<Page<IncidentSummary>>("/incidents", { query }),
  incident: (id: string) => request<IncidentDetail>(`/incidents/${id}`),

  // Reviewer
  session: () => request<{ user: UserView | null }>("/auth/session"),
  login: (email: string, password: string) =>
    request<UserView>("/auth/login", { method: "POST", body: { email, password } }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  reviewSummary: () => request<ReviewSummary>("/review/summary"),
  reports: (query: { status?: ReportStatus[]; category?: HazardCategory; q?: string; has_location?: boolean; limit?: number; offset?: number }) =>
    request<Page<ReportSummary>>("/reports", { query }),
  reanalyze: (id: string) => request<JobView>(`/reports/${id}/analyze`, { method: "POST" }),
  rematch: (id: string) => request<JobView>(`/reports/${id}/match`, { method: "POST" }),
  retranscribe: (id: string) => request<TranscriptionResult>(`/reports/${id}/transcribe`, { method: "POST" }),
  duplicatesFor: (id: string) => request<DuplicateSuggestionView[]>(`/reports/${id}/duplicates`),
  suggestions: (query: Query) => request<Page<DuplicateSuggestionView>>("/duplicate-suggestions", { query }),
  suggestion: (id: string) => request<DuplicateSuggestionView>(`/duplicate-suggestions/${id}`),
  decide: (id: string, decision: "confirm" | "reject" | "defer", note?: string) =>
    request<DuplicateSuggestionView>(`/duplicate-suggestions/${id}/decision`, { method: "POST", body: { decision, note } }),
  reviewReport: (id: string, body: { action: "confirm_incident" | "reject" | "reopen"; title?: string; priority?: Priority; note?: string }) =>
    request<ReportDetail>(`/reports/${id}/review`, { method: "POST", body }),
  correctCategory: (id: string, reviewer_category: HazardCategory, note?: string) =>
    request<ReportDetail>(`/reports/${id}`, { method: "PATCH", body: { reviewer_category, note } }),
  reportNotes: (id: string) => request<NoteView[]>(`/reports/${id}/notes`),
  addReportNote: (id: string, body: string) => request<NoteView>(`/reports/${id}/notes`, { method: "POST", body: { body } }),
  reportAudit: (id: string) => request<AuditView[]>(`/reports/${id}/audit`),
  updateIncident: (
    id: string,
    body: Partial<{ title: string; summary: string; status: IncidentStatus; priority: Priority; severity: Severity; hazard_category: HazardCategory; resolution_note: string; note: string }>,
  ) => request<IncidentDetail>(`/incidents/${id}`, { method: "PATCH", body }),
  incidentNotes: (id: string) => request<NoteView[]>(`/incidents/${id}/notes`),
  addIncidentNote: (id: string, body: string) =>
    request<NoteView>(`/incidents/${id}/notes`, { method: "POST", body: { body } }),
  incidentAudit: (id: string) => request<AuditView[]>(`/incidents/${id}/audit`),

  // Admin
  usage: () => request<UsageReport>("/admin/usage"),
  evaluation: () => request<EvaluationSummary>("/admin/evaluation"),
};
