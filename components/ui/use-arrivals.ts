"use client";

import { useState } from "react";

/**
 * Rows that are new since the last load (Tier 1 motion, 2026-11-17): give it the ids the list holds now, and
 * `isNew(id)` is true for each id that was not there the time before — a background refresh, a poll, a save that
 * brought a row in. Nothing is new on the first render, so a page never lights up as it opens.
 *
 *   const isNew = useArrivals(rows.map((row) => row.id));
 *   <tr key={row.id} data-row-new={isNew(row.id) ? "" : undefined}>
 *
 * `quiet`: a value that changes when the list is a different list rather than a newer one (another search, another
 * tab, the first answer of a late read). When it changes, what the list holds becomes the new baseline and nothing
 * lights up.
 *
 * `data-row-new` plays `m-row-new` (a soft brand tint fading over --t-highlight) once.
 */
export function useArrivals(ids: readonly string[], quiet?: unknown): (id: string) => boolean {
  const key = ids.join("\u0000");
  const [state, setState] = useState(() => ({ key, quiet, seen: new Set(ids), fresh: new Set<string>() }));
  // The list changed since the last render: what was not seen before is new (React's "adjust state while rendering").
  if (state.key !== key || !Object.is(state.quiet, quiet)) {
    const baseline = !Object.is(state.quiet, quiet);
    setState({ key, quiet, seen: new Set(ids), fresh: baseline ? new Set<string>() : new Set(ids.filter((id) => !state.seen.has(id))) });
  }
  return (id: string) => state.fresh.has(id);
}
