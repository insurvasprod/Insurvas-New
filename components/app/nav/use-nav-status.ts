"use client";

import { useSyncExternalStore } from "react";

/**
 * The sidebar's counts and the top bar's Inbound pill (Navigation A, 2026-10-28), from one poller.
 * Both mount on every page, so the read is shared: one request a minute while the tab is visible,
 * one more when it becomes visible again, none while it is hidden. A failed read keeps the last
 * answer. The counts are gated on the server (/api/app/nav/counts); this only draws what it is given.
 */
export type NavStatus = {
  counts: Record<string, number>;
  presence: "ready" | "on_break" | "on_call" | "off" | null;
};

const EMPTY: NavStatus = { counts: {}, presence: null };
const POLL_MS = 60_000;

let state: NavStatus = EMPTY;
const listeners = new Set<() => void>();
let timer: number | null = null;
let inFlight = false;

async function read() {
  if (inFlight || document.visibilityState !== "visible") return;
  inFlight = true;
  try {
    const response = await fetch("/api/app/nav/counts", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as Partial<NavStatus>;
    state = { counts: body.counts ?? {}, presence: body.presence ?? null };
    listeners.forEach((listener) => listener());
  } catch {
    /* the last answer stands */
  } finally {
    inFlight = false;
  }
}

function onVisible() {
  if (document.visibilityState === "visible") void read();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void read();
    timer = window.setInterval(() => void read(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** Ask for a fresh read now (after a navigation, say); coalesces with one already out. */
export function refreshNavStatus() {
  void read();
}

export function useNavStatus(): NavStatus {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}
