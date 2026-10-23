'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export interface Resource<T> {
  data: T | undefined;
  meta: Record<string, any>;
  error: ApiError | null;
  loading: boolean;
  /** True while re-fetching with data already shown. */
  refreshing: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Fetch a resource. A newer request (or a changed path, e.g. after switching
 * product) always wins: late responses from old requests are discarded.
 */
export function useResource<T = any>(path: string | null): Resource<T> {
  const [state, setState] = useState<{ data: T | undefined; meta: Record<string, any>; error: ApiError | null; loading: boolean; refreshing: boolean; path: string | null }>({
    data: undefined, meta: {}, error: null, loading: Boolean(path), refreshing: false, path,
  });
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async (p: string | null, keepData: boolean) => {
    const my = ++seq.current;
    ctrl.current?.abort();
    if (!p) {
      setState({ data: undefined, meta: {}, error: null, loading: false, refreshing: false, path: p });
      return;
    }
    const ac = new AbortController();
    ctrl.current = ac;
    setState((s) => ({ ...s, path: p, loading: !keepData || s.data === undefined, refreshing: keepData && s.data !== undefined, error: keepData ? s.error : null, ...(keepData ? {} : { data: undefined, meta: {} }) }));
    try {
      const r = await api.get<T>(p, { signal: ac.signal });
      if (my !== seq.current) return;
      setState({ data: r.data, meta: r.meta, error: null, loading: false, refreshing: false, path: p });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || my !== seq.current) return;
      setState((s) => ({ ...s, error: e instanceof ApiError ? e : new ApiError(0, { code: 'INTERNAL', message: '讀取失敗。', fieldErrors: {}, retryable: true, requestId: '' }), loading: false, refreshing: false }));
    }
  }, []);

  useEffect(() => {
    void load(path, false);
    return () => ctrl.current?.abort();
  }, [path, load]);

  const reload = useCallback(() => load(path, true), [path, load]);
  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? (updater as (p: T | undefined) => T)(s.data) : updater }));
  }, []);
  return { data: state.path === path ? state.data : undefined, meta: state.meta, error: state.error, loading: state.loading || state.path !== path, refreshing: state.refreshing, reload, setData };
}

/** Run `fn` every `ms` while the page is visible; pause in the background, refresh on focus. */
export function useVisiblePolling(fn: () => void, ms: number, enabled = true) {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => saved.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        saved.current();
        start();
      } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [ms, enabled]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
