/**
 * Reports › Callbacks kept (owner 2026-11-19: Basic has the callback calendar but no report on it). Pure: no
 * React, no database, so the server page, the store and node:test read the same rules.
 *
 * A callback's outcome, from tenant_callbacks as the calendar keeps it:
 *   kept       status "completed" (on a call, or Mark done); kept late when it had been missed first and rebooked
 *   missed     status "missed", or a missed stamp on one not since kept or cancelled
 *   cancelled  status "cancelled"
 *   open       booked and not decided yet (scheduled or due)
 * The keep rate is kept of kept and missed. Under MIN_DECIDED decided callbacks a line shows the two counts, never a
 * percentage (the Reports rule for small samples).
 */

import { seriesBuckets } from "./trueCpaView.ts";

export const MIN_DECIDED = 5;

export type CallbackOutcome = "kept" | "missed" | "cancelled" | "open";

/** One booked callback, as the report reads it: its day in the workspace's zone and its outcome's facts. */
export type CallbackFact = {
  assignedTo: string | null;
  status: string;
  /** YYYY-MM-DD, the scheduled time's day in the workspace's zone. */
  day: string;
  completedVia: "call" | "manual" | null;
  missedAt: string | null;
};

export type CallbackLine = {
  key: string;
  label: string;
  /** Week lines: the days the week covers inside the period. */
  from?: string;
  to?: string;
  booked: number;
  kept: number;
  keptOnCall: number;
  keptLate: number;
  missed: number;
  cancelled: number;
  open: number;
};

export type CallbackResults = { total: CallbackLine; weeks: CallbackLine[]; people: CallbackLine[] };

export function callbackOutcome(fact: Pick<CallbackFact, "status" | "missedAt">): CallbackOutcome {
  if (fact.status === "completed") return "kept";
  if (fact.status === "cancelled") return "cancelled";
  if (fact.status === "missed" || fact.missedAt) return "missed";
  return "open";
}

function emptyLine(key: string, label: string, extra: Partial<CallbackLine> = {}): CallbackLine {
  return { key, label, booked: 0, kept: 0, keptOnCall: 0, keptLate: 0, missed: 0, cancelled: 0, open: 0, ...extra };
}

function add(line: CallbackLine, fact: CallbackFact) {
  line.booked += 1;
  const outcome = callbackOutcome(fact);
  if (outcome === "kept") {
    line.kept += 1;
    if (fact.completedVia === "call") line.keptOnCall += 1;
    if (fact.missedAt) line.keptLate += 1;
  } else if (outcome === "missed") line.missed += 1;
  else if (outcome === "cancelled") line.cancelled += 1;
  else line.open += 1;
}

/** Kept of kept and missed, a whole percent; null under MIN_DECIDED decided callbacks. */
export function keepRate(line: Pick<CallbackLine, "kept" | "missed">): number | null {
  const decided = line.kept + line.missed;
  return decided >= MIN_DECIDED ? Math.round((line.kept / decided) * 100) : null;
}

/** "84% kept", "3 of 4 kept" under the floor, "—" with none decided. */
export function keepRateText(line: Pick<CallbackLine, "kept" | "missed">): string {
  const decided = line.kept + line.missed;
  if (!decided) return "—";
  const rate = keepRate(line);
  return rate === null ? `${line.kept} of ${decided} kept` : `${rate}% kept`;
}

/**
 * The period's callbacks, a line a week (the Reports series' buckets, at most 13) and a line a person (by booked,
 * most first; "Nobody" for one with no assignee). Facts outside the period are left out.
 */
export function callbackResults(facts: readonly CallbackFact[], period: { from: string; to: string }, names: Record<string, string> = {}): CallbackResults {
  const total = emptyLine("all", "All callbacks");
  const weeks = seriesBuckets(period.from, period.to, "week").map((bucket) => emptyLine(bucket.key, bucket.label, { from: bucket.from, to: bucket.to }));
  const people = new Map<string, CallbackLine>();
  for (const fact of facts) {
    if (fact.day < period.from || fact.day > period.to) continue;
    add(total, fact);
    const week = weeks.find((line) => fact.day >= (line.from ?? "") && fact.day <= (line.to ?? ""));
    if (week) add(week, fact);
    const who = fact.assignedTo ?? "nobody";
    if (!people.has(who)) people.set(who, emptyLine(who, who === "nobody" ? "Nobody" : names[who] ?? "Someone no longer here"));
    add(people.get(who)!, fact);
  }
  return { total, weeks, people: [...people.values()].sort((a, b) => b.booked - a.booked || a.label.localeCompare(b.label)) };
}

/** Whether a line has anything to show. */
export const hasCallbacks = (line: CallbackLine) => line.booked > 0;
