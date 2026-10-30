"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (value: T) => void;
}

/** Load data on mount / when `key` changes; aborts stale requests and keeps the last data while reloading. */
export function useApi<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: string | null): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ token: string | null; data: T | null; error: ApiError | null }>({
    token: null,
    data: null,
    error: null,
  });
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const token = key === null ? null : `${key}#${nonce}`;

  useEffect(() => {
    if (token === null) return;
    const ctrl = new AbortController();
    fetcherRef
      .current(ctrl.signal)
      .then((value) => setState({ token, data: value, error: null }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const error = err instanceof ApiError ? err : new ApiError(0, "unknown", "Something went wrong.");
        setState((prev) => ({ token, data: prev.data, error }));
      });
    return () => ctrl.abort();
  }, [token]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((value: T) => setState((prev) => ({ ...prev, data: value })), []);
  return { data: state.data, error: state.error, loading: token !== null && state.token !== token, reload, setData };
}

/**
 * Poll while `active` is true. Pauses when the tab is hidden; stops on unmount.
 */
export function usePolling(callback: () => void, intervalMs: number, active: boolean): void {
  const cb = useRef(callback);
  useEffect(() => {
    cb.current = callback;
  });
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") cb.current();
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => clearTimeout(timer);
  }, [active, intervalMs]);
}
