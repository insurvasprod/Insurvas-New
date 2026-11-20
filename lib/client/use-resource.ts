"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { load, mutate as put, peek, subscribe, type Entry } from "./resource-cache";

const noSubscribe = () => () => {};

/**
 * True while React is hydrating this component from the server's HTML, false on every other render (a client
 * navigation, a re-render after hydration). Read it before a `useState` initializer that calls `seed`: the shell
 * marks the app hydrated in its own effect, but the page sits in a Suspense boundary (loading.tsx) that React
 * hydrates in a later pass, after that effect has run, so `seed` alone would hand the page a kept answer the
 * server's HTML never had (a hydration mismatch, 2026-11-20 on /app/campaigns).
 */
export function useHydrating(): boolean {
  return useSyncExternalStore(noSubscribe, () => false, () => true);
}

/**
 * A `/api/app/…` read with the app's client cache (resource-cache.ts): the last answer at once, a fresh one behind it.
 *
 *   const { data, error, loading, revalidate } = useResource<LeadsPage>(`/api/app/leads?${query}`);
 *
 * - `data` is the cached answer straight away when this address was read before in this tab (or, with `persist`, in
 *   this browser session); `loading` is true only while there is nothing to show yet.
 * - On mount (and whenever `key` changes) it asks again behind what is shown, unless the answer is younger than
 *   `freshFor` ms (default 0: always ask again).
 * - `revalidate()` asks again now and resolves with the new data: call it after a change, where a page called its
 *   own `load()`.
 * - `key: null` skips the read (a page that has nothing to ask for yet).
 */
export function useResource<T>(key: string | null, opts: { persist?: boolean; freshFor?: number; read?: (url: string) => Promise<T> } = {}) {
  const { persist = false, freshFor = 0, read } = opts;
  const entry = useSyncExternalStore(
    useCallback((listener: () => void) => (key ? subscribe(key, listener) : () => {}), [key]),
    () => (key ? peek<T>(key, persist) : undefined),
    () => undefined,
  ) as Entry<T> | undefined;

  const revalidate = useCallback(() => (key ? load<T>(key, { persist, read }) : Promise.resolve(undefined as T)), [key, persist, read]);

  useEffect(() => {
    if (!key) return;
    const now = peek<T>(key, persist);
    if (now?.pending) return;
    if (now?.data !== undefined && freshFor > 0 && Date.now() - now.at < freshFor) return;
    load<T>(key, { persist, read }).catch(() => { /* the error is in the entry */ });
    // Asks once per key; `read` is expected to be stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, persist, freshFor]);

  const mutate = useCallback((data: T | ((current: T | undefined) => T)) => { if (key) put<T>(key, data, persist); }, [key, persist]);

  return {
    data: entry?.data,
    error: entry?.error ?? null,
    /** Nothing to show yet (first visit): draw the skeleton. */
    loading: Boolean(key) && entry?.data === undefined && !entry?.error,
    /** A refresh is in flight behind what is shown. */
    refreshing: Boolean(entry?.pending) && entry?.data !== undefined,
    revalidate,
    mutate,
  };
}
