import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError, isAbort } from './api';

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  /** Reload and resolve once the new response (or error) has landed, e.g. for pull-to-refresh. */
  refresh: () => Promise<void>;
}

/** Load data when `key` changes; aborts stale requests and keeps the last data while reloading. */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  key: string | null
): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{
    token: string | null;
    data: T | null;
    error: ApiError | null;
  }>({
    token: null,
    data: null,
    error: null,
  });
  const fetcherRef = useRef(fetcher);
  const waiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const token = key === null ? null : `${key}#${nonce}`;

  useEffect(() => {
    if (token === null) return;
    const ctrl = new AbortController();
    const settle = () => {
      const done = waiters.current;
      waiters.current = [];
      done.forEach((resolve) => resolve());
    };
    fetcherRef
      .current(ctrl.signal)
      .then((value) => {
        setState({ token, data: value, error: null });
        settle();
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return;
        const error =
          err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Something went wrong.');
        setState((prev) => ({ token, data: prev.data, error }));
        settle();
      });
    return () => ctrl.abort();
  }, [token]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiters.current.push(resolve);
        setNonce((n) => n + 1);
      }),
    []
  );
  return {
    data: state.data,
    error: state.error,
    loading: token !== null && state.token !== token,
    reload,
    refresh,
  };
}

/** Poll while `active` is true and the app is in the foreground; stops on unmount. */
export function usePolling(callback: () => void, intervalMs: number, active: boolean): void {
  const cb = useRef(callback);
  useEffect(() => {
    cb.current = callback;
  });
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (AppState.currentState === 'active') cb.current();
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => clearTimeout(timer);
  }, [active, intervalMs]);
}
