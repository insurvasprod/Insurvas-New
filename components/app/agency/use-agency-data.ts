"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Agency screens · one way to load a route: initial load, a refresh that keeps the old data on screen while it
 * runs, and the server's own error sentence (never "Something went wrong" when the server said what).
 */
export function useAgencyData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(url));
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (!url) return;
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error ?? "That did not load. Try again.");
      else setData(body as T);
    } catch {
      setError("That did not load. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [url]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and when the URL changes
  useEffect(() => { void load("load"); }, [load]);

  return { data, error, loading, refreshing, reload: () => load("refresh") };
}

/** POST / PUT a JSON body; resolves to the server's error sentence, or null on success. */
export async function sendJson(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown): Promise<{ error: string | null; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return res.ok ? { error: null, data } : { error: data?.error ?? "That did not save. Try again.", data };
  } catch {
    return { error: "That did not save. Check your connection and try again.", data: null };
  }
}
