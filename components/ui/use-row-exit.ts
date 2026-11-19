"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import { motionMs, reducedMotion } from "./motion-tokens";

/** Rows that leave together go 30ms apart, capped at the twelfth (the kit's per-row stagger, as charts use --m-i). */
const STAGGER_MS = 30;
const STAGGER_CAP = 12;
const delayOf = (index: number) => Math.min(Math.max(index, 0), STAGGER_CAP) * STAGGER_MS;
/** How long rows leaving together take: the row-exit token, plus the last row's stagger. */
const exitWait = (count: number) => motionMs("--t-exit-row", 200) + delayOf(count - 1);

/** What a leaving row wears: it plays `m-row-out` (after its stagger) and is hidden from assistive tech. */
export type RowExitProps = { "data-row-exit"?: ""; "aria-hidden"?: true; style?: CSSProperties };
/** The props of a row leaving `index`th in its batch, for a row whose leaving a list works out itself. */
export const leavingProps = (index: number): RowExitProps => ({
  "data-row-exit": "",
  "aria-hidden": true,
  ...(index > 0 ? { style: { animationDelay: `${delayOf(index)}ms` } } : {}),
});

type ExitState = { leaving: ReadonlyMap<string, number>; played: ReadonlySet<string>; landed: unknown };

/**
 * A finished row leaves its list (Tier 1 motion, 2026-11-17, docs/design/UI-CONSISTENCY.md § Motion).
 *
 * `exit(key, then)` marks the row as leaving, so it plays `m-row-out` (fade, 8px slide, its height closes) for
 * `--t-exit-row`, and only then runs `then` — usually `router.refresh()`, which takes the row away for good. Under
 * reduced motion `then` runs at once. If `then` throws or rejects, the row comes back and `exit` resolves false.
 * `exit([k1, k2, …], then)` sends several rows out together, each 30ms after the one before (capped at the twelfth),
 * and runs `then` once the last has gone.
 *
 *   const rows = useRowExit(serverRows);
 *   <div key={item.id} {...rows.rowProps(item.id)}>…</div>
 *   await rows.exit(item.id, () => router.refresh());
 *
 * A key stays marked until `restore(key)`, or until `landed` changes after its exit played: pass the server's rows
 * (a prop, whose identity changes only when a refresh lands) and a row the refresh took away is forgotten, while one
 * the refresh kept (a decision that left it on the list) comes back. Never pass a value made fresh on every render.
 */
export function useRowExit(landed?: unknown) {
  const [state, setState] = useState<ExitState>(() => ({ leaving: new Map(), played: new Set(), landed }));
  // Fresh rows landed (React's "adjust state while rendering"): every row whose exit already played is let go.
  if (!Object.is(state.landed, landed)) {
    const leaving = new Map(state.leaving);
    for (const key of state.played) leaving.delete(key);
    setState({ leaving, played: new Set(), landed });
  }

  const restore = useCallback((key: string) => {
    setState((current) => {
      if (!current.leaving.has(key)) return current;
      const leaving = new Map(current.leaving);
      leaving.delete(key);
      const played = new Set(current.played);
      played.delete(key);
      return { ...current, leaving, played };
    });
  }, []);

  const exit = useCallback((keys: string | readonly string[], then?: () => unknown): Promise<boolean> => {
    const list = typeof keys === "string" ? [keys] : [...new Set(keys)];
    setState((current) => {
      if (list.every((key) => current.leaving.has(key))) return current;
      const leaving = new Map(current.leaving);
      list.forEach((key, index) => { if (!leaving.has(key)) leaving.set(key, index); });
      return { ...current, leaving };
    });
    return new Promise<boolean>((resolve) => {
      const finish = async () => {
        setState((current) => ({ ...current, played: new Set([...current.played, ...list]) }));
        try {
          await then?.();
          resolve(true);
        } catch {
          list.forEach(restore);
          resolve(false);
        }
      };
      if (reducedMotion()) void finish();
      else window.setTimeout(() => void finish(), list.length ? exitWait(list.length) : 0);
    });
  }, [restore]);

  const isLeaving = useCallback((key: string) => state.leaving.has(key), [state.leaving]);

  /** Spread on the row: it plays its exit while leaving, and is hidden from assistive tech on the way out. */
  const rowProps = useCallback((key: string): RowExitProps => {
    const index = state.leaving.get(key);
    return index === undefined ? {} : leavingProps(index);
  }, [state.leaving]);

  return { exit, restore, isLeaving, rowProps };
}

type Gone<T> = { row: T; key: string; at: number; index: number; batch: number };
type DepartureState<T> = { key: string; quiet: unknown; prev: readonly T[]; gone: ReadonlyArray<Gone<T>>; batch: number };

/**
 * Rows that were finished somewhere else leave too (Tier 1 motion, 2026-11-17): a decision made on another page, in
 * a sheet over this one, or by someone else, reaches this list as a refresh without the row. Give the hook the rows
 * as the server sent them; a row that is gone since the last render is put back where it stood for `--t-exit-row`,
 * plays `m-row-out` (several together 30ms apart, capped as `exit` is), and is then dropped.
 *
 *   const left = useDepartures(items, (item) => item.id);
 *   left.rows.map((item) => <tr key={item.id} {...left.rowProps(item.id)}>…</tr>)
 *
 * Use it on the unfiltered rows: a row a search or a chip hides has not left. `quiet` (as useArrivals takes it): a
 * value that changes when the rows are a different list (another tab), so nothing plays out. Under reduced motion it
 * is a no-op.
 */
export function useDepartures<T>(rows: readonly T[], keyOf: (row: T) => string, quiet?: unknown) {
  const ids = rows.map(keyOf);
  const key = ids.join("\u0000");
  const [state, setState] = useState<DepartureState<T>>(() => ({ key, quiet, prev: rows, gone: [], batch: 0 }));
  if (state.key !== key || !Object.is(state.quiet, quiet)) {
    const here = new Set(ids);
    const other = !Object.is(state.quiet, quiet);
    const still = other ? [] : state.gone.filter((gone) => !here.has(gone.key));
    const batch = state.batch + 1;
    const fresh = other || reducedMotion() ? [] : state.prev
      .map((row, at) => ({ row, at, key: keyOf(row) }))
      .filter((row) => !here.has(row.key))
      .map((row, index) => ({ ...row, index, batch }));
    setState({ key, quiet, prev: rows, gone: [...still, ...fresh], batch });
  }

  const latest = state.gone.filter((gone) => gone.batch === state.batch).length;
  useEffect(() => {
    if (!latest) return;
    const batch = state.batch;
    const timer = window.setTimeout(() => setState((current) => ({ ...current, gone: current.gone.filter((gone) => gone.batch > batch) })), exitWait(latest));
    return () => window.clearTimeout(timer);
  }, [state.batch, latest]);

  const gones = state.gone;
  const merged = useMemo(() => {
    const out: T[] = [...rows];
    for (const gone of [...gones].sort((a, b) => a.at - b.at)) out.splice(Math.min(gone.at, out.length), 0, gone.row);
    return out;
  }, [rows, gones]);
  const leaving = useMemo(() => new Map(gones.map((gone) => [gone.key, gone.index])), [gones]);

  return {
    /** The rows to draw: the server's, with the ones leaving still in their places. */
    rows: merged,
    isLeaving: (rowKey: string) => leaving.has(rowKey),
    rowProps: (rowKey: string): RowExitProps => {
      const index = leaving.get(rowKey);
      return index === undefined ? {} : leavingProps(index);
    },
  };
}
