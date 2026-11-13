"use client";

import { useCallback, useEffect, useState } from "react";

import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

/**
 * Agency screens · one way to load a route: initial load, a refresh that keeps the old data on screen while it
 * runs, and the server's own error sentence (never "Something went wrong" when the server said what).
 */
export function useAgencyData<T>(url: string | null) {
  // Through the app's cache (lib/client/resource-cache.ts), keyed by the URL: a repeat visit draws the last
  // answer at once and this replaces it when the fresh one lands (speed pass 2026-11-09).
  const [data, setData] = useState<T | null>(() => (url ? seed<T>(url)?.data ?? null : null));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => Boolean(url) && !(url && seed(url)?.data));
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (!url) return;
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      // A refresh follows a change (or the person asked): always ask again.
      const body = await (mode === "refresh" ? loadResource<T>(url) : readResource<T>(url));
      setData(body);
    } catch (cause) {
      // An answer from the route (it has a status) keeps the server's sentence; no answer at all is the connection.
      const answered = cause && typeof cause === "object" && "status" in cause;
      setError(answered ? ((cause as { body?: { error?: string } | null }).body?.error ?? "That did not load. Try again.") : "That did not load. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [url]);

  useEffect(() => {
    if (url) {
      const kept = peek<T>(url);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
      if (kept?.data) setData((current) => current ?? kept.data ?? null);
    }
    void load("load");
  }, [url, load]);

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
