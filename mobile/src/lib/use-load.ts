import { useEffect, useEffectEvent, useState } from "react";

import { ApiError } from "./api";

/**
 * Load once per `deps`, keep the last answer on screen while refreshing (pull to refresh, or `every` ms
 * while the screen is open). An error keeps the last good data; `error` is the server's own words.
 * `loading` is true until the answer for the current deps arrives (derived, so no state is set during
 * an effect — the app runs the React Compiler).
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], options: { every?: number } = {}) {
  const key = JSON.stringify(deps);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<{ status: number; code: string | null } | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const run = useEffectEvent(async (forKey: string, isLive: () => boolean) => {
    try {
      const next = await load();
      if (!isLive()) return;
      setData(next);
      setError(null);
      setErrorCode(null);
    } catch (e) {
      if (!isLive()) return;
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setErrorCode(e instanceof ApiError ? { status: e.status, code: e.code } : null);
    } finally {
      if (isLive()) { setSettledKey(forKey); setRefreshing(false); }
    }
  });

  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    // Started after the effect returns, so no state is set while React is still committing.
    void Promise.resolve().then(() => run(key, () => live));
    const timer = options.every ? setInterval(() => void run(key, () => live), options.every) : null;
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [key, tick, options.every]);

  return {
    data, error, errorCode, setData, refreshing,
    loading: settledKey !== key,
    /** Pull to refresh: shows the spinner. */
    refresh: () => { setRefreshing(true); setTick((n) => n + 1); },
    /** Quietly fetch again. */
    reload: () => setTick((n) => n + 1),
  };
}
