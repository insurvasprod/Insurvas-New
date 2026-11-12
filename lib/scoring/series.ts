/**
 * Queue scoring's chart view (Reports round 7, owner picks 3·B + 3·C + 3·3, 2026-11-11): the two arms' contact
 * rates by day, and the one colour each signal wears in every picture (the weights' ShareBar, a lead's score
 * split by signal, the score dialog).
 *
 * Pure and free of `server-only` and React, so the service (which reads the decisions), the client workspace and
 * the tests share it.
 *
 * The rate a day carries is the arm's contact rate TO DATE (every dial served in the comparison up to the end of
 * that day): a day with no dials in an arm has no rate of its own, and at a hundred dials a day the day's own rate
 * is noise (the board's warning under 3·B). To date, the line is defined on every day, shows whether the gap holds,
 * and its last point is exactly the figure on the arm's card.
 */

import type { ChartTone } from "@/components/ui/chart";

/** One serve, as the series reads it from tenant_scoring_decisions. */
export type DecisionRow = { servedAt: string; cohort: "scored" | "control"; contacted: boolean };

/** One day of the comparison. Counts are that day's own; rates are to date (null before the arm's first dial). */
export type CohortDay = {
  /** YYYY-MM-DD in the agency's zone. */
  day: string;
  scoredServed: number;
  scoredContacted: number;
  controlServed: number;
  controlContacted: number;
  scoredRatePct: number | null;
  controlRatePct: number | null;
};

/** The arms' counts before the first day drawn (all-time totals minus the days read), so a to-date rate is the comparison's. */
export type CohortCarry = { scoredServed: number; scoredContacted: number; controlServed: number; controlContacted: number };

/** The calendar day an instant falls on in a zone, YYYY-MM-DD ("" for a bad instant). */
export function dayInZone(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).formatToParts(at);
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Every day from `from` to `to` inclusive (YYYY-MM-DD), at most `cap` of them (the latest kept). */
export function daysBetween(from: string, to: string, cap = 120): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const out: string[] = [];
  for (let at = start; at <= end; at += 86_400_000) out.push(new Date(at).toISOString().slice(0, 10));
  return out.slice(-cap);
}

const rate = (contacted: number, served: number) => (served > 0 ? Math.round((1000 * contacted) / served) / 10 : null);

/**
 * The comparison by day: each day's own dials and contacts per arm, and each arm's rate to date. `carry` is what
 * came before the first day (zero for a 14-day window, the older history for all time). Rows outside the days are
 * ignored; the days are given (every day of the window, dials or not), so a quiet day still has its point.
 */
export function cohortDays(rows: readonly DecisionRow[], days: readonly string[], timeZone: string, carry: CohortCarry = { scoredServed: 0, scoredContacted: 0, controlServed: 0, controlContacted: 0 }): CohortDay[] {
  const byDay = new Map<string, CohortCarry>(days.map((day) => [day, { scoredServed: 0, scoredContacted: 0, controlServed: 0, controlContacted: 0 }]));
  for (const row of rows) {
    const bucket = byDay.get(dayInZone(row.servedAt, timeZone));
    if (!bucket) continue;
    if (row.cohort === "scored") { bucket.scoredServed += 1; if (row.contacted) bucket.scoredContacted += 1; }
    else { bucket.controlServed += 1; if (row.contacted) bucket.controlContacted += 1; }
  }
  const total = { ...carry };
  return days.map((day) => {
    const own = byDay.get(day)!;
    total.scoredServed += own.scoredServed; total.scoredContacted += own.scoredContacted;
    total.controlServed += own.controlServed; total.controlContacted += own.controlContacted;
    return {
      day,
      ...own,
      scoredRatePct: rate(total.scoredContacted, total.scoredServed),
      controlRatePct: rate(total.controlContacted, total.controlServed),
    };
  });
}

/** The days' own counts summed (to take from all-time totals for the carry). */
export function sumDays(rows: readonly DecisionRow[]): CohortCarry {
  const out = { scoredServed: 0, scoredContacted: 0, controlServed: 0, controlContacted: 0 };
  for (const row of rows) {
    if (row.cohort === "scored") { out.scoredServed += 1; if (row.contacted) out.scoredContacted += 1; }
    else { out.controlServed += 1; if (row.contacted) out.controlContacted += 1; }
  }
  return out;
}

/**
 * Each signal's colour, by signal key (the scorer's own seven, lib/scoring/service.ts SCORING_SIGNALS): the kit's
 * categorical palette for six, `quiet` for the seventh. One map, so the weights' bar, a lead's split bar and the
 * score dialog agree on which colour is which signal.
 */
export const SIGNAL_TONES: Record<string, ChartTone> = {
  recency: "cat1",
  attempt_position: "cat2",
  time_of_day_fit: "cat3",
  slot_freshness: "cat4",
  vendor_contact_rate: "cat5",
  completeness: "cat6",
  consent_artefact: "quiet",
};

/** The order the board lists the signals in (largest default weight first): every legend and bar uses it. */
export const SIGNAL_ORDER = ["recency", "attempt_position", "time_of_day_fit", "slot_freshness", "vendor_contact_rate", "completeness", "consent_artefact"] as const;

export const signalTone = (signal: string): ChartTone => SIGNAL_TONES[signal] ?? "quiet";

/** Sort anything with a `signal` into the board's order (unknown signals last, as they came). */
export function bySignalOrder<T extends { signal: string }>(items: readonly T[]): T[] {
  const at = (signal: string) => { const index = (SIGNAL_ORDER as readonly string[]).indexOf(signal); return index < 0 ? SIGNAL_ORDER.length : index; };
  return [...items].sort((a, b) => at(a.signal) - at(b.signal));
}

/** "58.75": a raw score as the board prints it, two places. */
export function scoreFigure(score: number | null | undefined): string {
  return score === null || score === undefined || !Number.isFinite(score) ? "—" : score.toFixed(2);
}

/** "7.5" / "15": points without trailing zeros, at most two places. */
export function pointsFigure(value: number): string {
  return String(Math.round(value * 100) / 100);
}
