// Typed client for the MtaaSense API. Residents never sign in: a report is readable with the receipt token the
// API returns on submission, sent back in X-Report-Token.

import { API_BASE, API_ORIGIN } from './config';
import type {
  AppConfig,
  FixCheck,
  MapFeatures,
  MediaRef,
  ReportCreated,
  ReportDetail,
  SegmentationView,
  TranscriptionResult,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const FRIENDLY: Record<number, string> = {
  0: "We couldn't reach MtaaSense. Check your connection and try again.",
  502: 'The MtaaSense service is temporarily unavailable.',
  503: 'The MtaaSense service is temporarily unavailable.',
  504: 'The request took too long. Please try again.',
};

function errorFrom(status: number, text: string): ApiError {
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (body.error?.message)
      return new ApiError(status, body.error.code ?? 'error', body.error.message);
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(
    status,
    'http_error',
    FRIENDLY[status] ?? 'Something went wrong. Please try again.'
  );
}

export const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

// React Native's URLSearchParams is incomplete, so the query string is built by hand.
function withQuery(path: string, query?: Query): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(withQuery(`${API_BASE}${path}`, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(0, 'network_error', FRIENDLY[0]);
  }
  if (!res.ok) throw errorFrom(res.status, await res.text());
  return (await res.json()) as T;
}

/** A local file for a multipart field, in the shape React Native's FormData sends from disk. */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

export function appendFile(form: FormData, field: string, file: UploadFile): void {
  form.append(field, file as unknown as Blob);
}

/** Multipart upload with progress; fetch has no upload progress events. */
export function upload<T>(
  path: string,
  form: FormData,
  {
    headers,
    onProgress,
  }: { headers?: Record<string, string>; onProgress?: (f: number) => void } = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.timeout = 120_000;
    xhr.setRequestHeader('Accept', 'application/json');
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'network_error', FRIENDLY[0]));
    xhr.ontimeout = () => reject(new ApiError(0, 'timeout', FRIENDLY[504]));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(
            new ApiError(xhr.status, 'bad_response', 'The server sent an unreadable response.')
          );
        }
      } else reject(errorFrom(xhr.status, xhr.responseText));
    };
    xhr.send(form);
  });
}

const tokenHeader = (token: string) => ({ 'X-Report-Token': token });

/** Evidence URLs are signed, short-lived and relative to the API origin. */
export const mediaUrl = (ref: MediaRef) => `${API_ORIGIN}${ref.url}`;

export const api = {
  config: (signal?: AbortSignal) => request<AppConfig>('/config', { signal }),
  mapFeatures: (signal?: AbortSignal) =>
    request<MapFeatures>('/map/features', { query: { include_unreviewed: true }, signal }),

  submitReport: (form: FormData, idempotencyKey: string, onProgress?: (f: number) => void) =>
    upload<ReportCreated>('/reports', form, {
      headers: { 'Idempotency-Key': idempotencyKey },
      onProgress,
    }),
  transcribe: (form: FormData, onProgress?: (f: number) => void) =>
    upload<TranscriptionResult>('/transcriptions', form, { onProgress }),
  report: (id: string, token: string, signal?: AbortSignal) =>
    request<ReportDetail>(`/reports/${id}`, { headers: tokenHeader(token), signal }),
  checkFix: (id: string, form: FormData, token: string, onProgress?: (f: number) => void) =>
    upload<FixCheck>(`/reports/${id}/fix-checks`, form, {
      headers: tokenHeader(token),
      onProgress,
    }),
  segment: (id: string, prompt: string, token: string) =>
    request<SegmentationView>(`/reports/${id}/segment`, {
      method: 'POST',
      body: { prompt },
      headers: tokenHeader(token),
    }),
};
