"use client";

/**
 * The tenant's draft buffer (LA-3.17 · days after the latest deposit to aim the draft, 2–4). Read
 * from the Sales settings; a tenant that has not set it, a settings route that is not there yet, or
 * a role that cannot read settings all mean the documented default of 3.
 *
 * The server recomputes the recommendation with the real setting on every save, so a wrong buffer
 * here can never store a wrong day — at worst the screen asks for a reason the server did not need.
 * `inferFrom` narrows that: when the settings cannot be read, the buffer that reproduces the
 * recommendation the server last stored is the one it used.
 */

import { useEffect, useState } from "react";

import { recommendDraftDay, type DraftDateInput } from "@/lib/draftDates/optimiser";

export const DEFAULT_DRAFT_BUFFER = 3;

const valid = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 2 && v <= 4;

function pick(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  for (const candidate of [d.draftBufferDays, (d.settings as Record<string, unknown> | undefined)?.draftBufferDays, (d.values as Record<string, unknown> | undefined)?.draftBufferDays]) {
    if (valid(candidate)) return candidate;
  }
  return null;
}

/** The buffer whose recommendation matches the one stored, or null when none (or several) do. */
export function inferBuffer(input: DraftDateInput | null, storedRecommended: number | null): number | null {
  if (!input || storedRecommended === null) return null;
  const matches = [2, 3, 4].filter((buffer) => {
    const r = recommendDraftDay({ ...input, buffer });
    return r.kind === "recommended" && r.recommended.day === storedRecommended;
  });
  return matches.includes(DEFAULT_DRAFT_BUFFER) ? DEFAULT_DRAFT_BUFFER : matches.length === 1 ? matches[0] : null;
}

export function useDraftBuffer({ enabled = true, inferFrom }: { enabled?: boolean; inferFrom?: { input: DraftDateInput | null; recommended: number | null } } = {}) {
  const [fetched, setFetched] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void fetch("/api/app/settings/sales/settings", { cache: "no-store" })
      .then(async (res) => (res.ok ? pick(await res.json().catch(() => null)) : null))
      .catch(() => null)
      .then((value) => {
        if (!live) return;
        if (value === null) setFailed(true);
        else setFetched(value);
      });
    return () => { live = false; };
  }, [enabled]);

  if (fetched !== null) return fetched;
  if (failed && inferFrom) return inferBuffer(inferFrom.input, inferFrom.recommended) ?? DEFAULT_DRAFT_BUFFER;
  return DEFAULT_DRAFT_BUFFER;
}
