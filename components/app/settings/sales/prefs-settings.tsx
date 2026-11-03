"use client";

/**
 * The Sales settings document, client side: one load of GET /api/app/settings/sales/settings and a
 * save that PUTs the whole document back with the `updatedAt` it loaded (a newer save by someone
 * else refuses it instead of being overwritten). The Quote & QA rules panel and the welcome-pack
 * editor both edit their slice of this one document.
 *
 * `?preview=sample` (outside production) reads the defaults and saves nothing.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { DEFAULT_SALES_SETTINGS, type SalesSettings } from "@/lib/salesSettings/schema";
import type { SalesSettingsView } from "@/lib/salesSettings/settings";
import { WELCOME_PACK_AGENT } from "@/lib/applications/settingsFixtures";

import { SalesLoadError, SalesLoading, SalesSetupPending, useSalesSample } from "./shared";

export const useSamplePreview = useSalesSample;
const SAMPLE_VIEW: SalesSettingsView = {
  settings: DEFAULT_SALES_SETTINGS, stored: false, updatedAt: null, updatedBy: null,
  me: { name: WELCOME_PACK_AGENT.name, phone: WELCOME_PACK_AGENT.phone, email: WELCOME_PACK_AGENT.email }, canEdit: true,
};

export type LoadState = { loading: boolean; error: string | null; pending: boolean };

export function useSalesSettings() {
  const sample = useSamplePreview();
  const [view, setView] = useState<SalesSettingsView | null>(sample ? SAMPLE_VIEW : null);
  const [state, setState] = useState<LoadState>({ loading: !sample, error: null, pending: false });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/app/settings/sales/settings", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) setState({ loading: false, error: data?.error ?? "Sales settings could not be loaded.", pending: Boolean(data?.schemaPending) });
      else {
        setView(data as SalesSettingsView);
        setState({ loading: false, error: null, pending: false });
      }
    } catch {
      setState({ loading: false, error: "Couldn't reach Insurvas. Check your connection and try again.", pending: false });
    }
  }, []);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load, sample]);

  /** Resolves to the saved view, or throws the server's own sentence (the caller keeps the draft). */
  const save = useCallback(async (next: SalesSettings): Promise<SalesSettingsView> => {
    if (sample) {
      const saved = { ...(view ?? SAMPLE_VIEW), settings: next };
      setView(saved);
      return saved;
    }
    const res = await fetch("/api/app/settings/sales/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: next, expected_updated_at: view?.updatedAt ?? null }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "That didn't save. Try again.");
    setView(data as SalesSettingsView);
    return data as SalesSettingsView;
  }, [sample, view]);

  return { sample, view, state, load, save };
}

/** Loading / not-set-up / failed, in the place the panel will be. Null when there is a view to draw. */
export function PanelState({ state, onRetry, what }: { state: LoadState; onRetry: () => void; what: string }): ReactNode {
  if (state.loading) return <SalesLoading label={`Loading ${what.toLowerCase()}`} columns={2} />;
  if (state.pending) return <SalesSetupPending what={what} />;
  if (state.error) return <SalesLoadError message={state.error} onRetry={onRetry} />;
  return null;
}
