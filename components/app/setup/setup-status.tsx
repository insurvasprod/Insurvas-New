"use client";

import { useEffect, useState } from "react";

import type { SetupChecklist } from "@/lib/dashboard/checklist";

export type SetupStatus = { closed: boolean; audience: "owner" | "member"; checklist: SetupChecklist };

/**
 * The reader's setup, shared by the small things that follow it on every page — the sidebar's count beside
 * Get set up, "Guide me" beside a page's (i), the first-visit offer and the once-a-day reminder. One read of
 * /api/app/setup a minute at most, kept for the visit, and read again when a step changes ("setup:changed").
 */
const KEY = "setup-status";
const FRESH_MS = 60_000;
let memory: { at: number; value: SetupStatus | null } | null = null;
let inflight: Promise<SetupStatus | null> | null = null;
const listeners = new Set<(value: SetupStatus | null) => void>();

function fromStorage(): { at: number; value: SetupStatus | null } | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { at: number; value: SetupStatus | null }) : null;
  } catch {
    return null;
  }
}

async function read(force = false): Promise<SetupStatus | null> {
  memory ??= fromStorage();
  if (!force && memory && Date.now() - memory.at < FRESH_MS) return memory.value;
  inflight ??= fetch("/api/app/setup", { cache: "no-store" })
    .then(async (response) => (response.ok ? ((await response.json()) as SetupStatus) : null))
    .catch(() => null)
    .then((value) => {
      memory = { at: Date.now(), value };
      try { window.sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* storage blocked */ }
      listeners.forEach((listener) => listener(value));
      return value;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useSetupStatus(): SetupStatus | null {
  const [value, setValue] = useState<SetupStatus | null>(null);
  useEffect(() => {
    let live = true;
    listeners.add(setValue);
    void read().then((next) => { if (live) setValue(next); });
    const changed = () => void read(true);
    window.addEventListener("setup:changed", changed);
    return () => {
      live = false;
      listeners.delete(setValue);
      window.removeEventListener("setup:changed", changed);
    };
  }, []);
  return value;
}

/** Required steps still to do: Ready to sell (or Ready to work) only, never the optional settings. */
export function requiredLeft(status: SetupStatus | null): number {
  if (!status || status.closed) return 0;
  return status.checklist.steps.filter((step) => !step.optional && !step.complete).length;
}

/** The sidebar's count beside Get set up while Ready to sell has steps left. */
export function SetupCount() {
  const left = requiredLeft(useSetupStatus());
  if (left === 0) return null;
  return (
    <span aria-label={`${left} setup ${left === 1 ? "step" : "steps"} left`} className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--warning-surface)] px-1.5 text-xs font-semibold tabular-nums text-[var(--warning-ink)]">
      {left}
    </span>
  );
}
