"use client";

import { useCallback, useEffect, useState } from "react";

import { motionMs, reducedMotion } from "./motion-tokens";

/**
 * Run `then` once a stamp that just mounted has played (--t-stamp): a dialog that stamps "Paid" closes, or steps on,
 * after the check has drawn. At once under reduced motion.
 */
export function afterStamp(then: () => void): void {
  if (reducedMotion()) then();
  else window.setTimeout(then, motionMs("--t-stamp", 400));
}

/** `spent`: stamps whose `then` ran, waiting for fresh rows; `settled`: those whose fresh rows landed, let go shortly. */
type StampState = { labels: ReadonlyMap<string, string>; spent: ReadonlySet<string>; settled: ReadonlySet<string>; landed: unknown };

/**
 * A finished thing says so where it was done, then leaves (Tier 2 motion, Wave B 2026-11-18): "Paid", "Matched",
 * "Approved". `stamp(key, label, then)` puts `label` on `key` at once — draw it as a DoneStamp in the row or title line
 * while `labelOf(key)` returns it — and runs `then` (usually the refresh) once the stamp has played (--t-stamp), so the
 * check draws before the row goes. Pair it with `useDepartures` on the list: the refresh takes the row away and the
 * row plays out still wearing its stamp. Under reduced motion `then` runs at once.
 *
 *   const stamps = useDoneStamps(serverRows);
 *   {stamps.labelOf(row.id) ? <DoneStamp label={stamps.labelOf(row.id)!} /> : <StatusChip …/>}
 *   await act(); stamps.stamp(row.id, "Paid", () => router.refresh());
 *
 * `landed` (as useRowExit takes it: the server's rows, whose identity changes only when a refresh lands): a stamp
 * whose `then` ran is let go once fresh rows land and the leaving row has had its --t-exit-row. Never pass a value
 * made fresh on every render.
 */
export function useDoneStamps(landed?: unknown) {
  const [state, setState] = useState<StampState>(() => ({ labels: new Map(), spent: new Set(), settled: new Set(), landed }));
  // Fresh rows landed (React's "adjust state while rendering"): every stamp whose `then` ran has done its work.
  if (!Object.is(state.landed, landed)) setState({ ...state, spent: new Set(), settled: new Set([...state.settled, ...state.spent]), landed });

  const settled = state.settled;
  useEffect(() => {
    if (!settled.size) return;
    // The leaving row keeps its stamp for its exit (and a batch's stagger), then the label goes.
    const timer = window.setTimeout(() => setState((current) => {
      const labels = new Map(current.labels);
      for (const key of settled) labels.delete(key);
      return { ...current, labels, settled: new Set([...current.settled].filter((key) => !settled.has(key))) };
    }), motionMs("--t-exit-row", 200) + 360);
    return () => window.clearTimeout(timer);
  }, [settled]);

  const stamp = useCallback((key: string, label: string, then?: () => unknown): Promise<void> => {
    setState((current) => ({ ...current, labels: new Map(current.labels).set(key, label) }));
    return new Promise<void>((resolve) => {
      const finish = async () => {
        setState((current) => ({ ...current, spent: new Set([...current.spent, key]) }));
        try { await then?.(); } finally { resolve(); }
      };
      if (reducedMotion()) void finish();
      else window.setTimeout(() => void finish(), motionMs("--t-stamp", 400));
    });
  }, []);

  /** Take a stamp back (an Undo, or the action failed after all). */
  const clear = useCallback((key: string) => {
    setState((current) => {
      if (!current.labels.has(key)) return current;
      const labels = new Map(current.labels);
      labels.delete(key);
      return { ...current, labels };
    });
  }, []);

  const labelOf = useCallback((key: string): string | undefined => state.labels.get(key), [state.labels]);

  return { stamp, clear, labelOf };
}
