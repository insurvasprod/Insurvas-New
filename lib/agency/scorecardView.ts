/**
 * Reports round 7 · Producer scorecards (owner pick 5·A + 5·1 + 5·4, docs/la4/mockups-r7/reports.html#s5). The pure
 * half of the view: the order the table and both bar lists share, the row's one chip, the team's weighted figures,
 * the period's buckets for the cards' sparklines, and the addresses. No database, no React, no "use client": the
 * server page, the store and the client controls all read it.
 */
import { dollars } from "./constants.ts";
import { perPolicy, type PerPolicy, type Persisting } from "../accounting/pnlCore.ts";

export const SCORECARDS_HREF = "/app/producer-scorecards";

/** What a row and the record page read (the store's ProducerScore, as the view needs it). */
export type ScoreRow = {
  producerUserId: string;
  name: string;
  submitted: number;
  issued: number;
  placed: number;
  placement: string;
  m4: { alive: number; eligible: number; building: boolean; readyOn?: string | null; text: string };
  m13: { alive: number; eligible: number; building: boolean; readyOn?: string | null; text: string };
  chargebackCents: number;
  advanceAtRiskCents: number;
  leadSpendCents: number;
  costPerIssued: PerPolicy;
  costPerPersisting: Persisting;
  chargebackTaxCents: number | null;
};

/**
 * The rows as the page shows them: chargebacks are negative in the ledger (money going back), and the page says them
 * as an amount ("$2,539.68 charged back"), never as a red minus (one-line rule, owner 2026-11-11).
 */
export function asShown<T extends Pick<ScoreRow, "chargebackCents">>(rows: readonly T[]): T[] {
  return rows.map((r) => ({ ...r, chargebackCents: Math.abs(r.chargebackCents) }));
}

/** The table's order and both bar lists' (5·A: "two bar lists in the same order"): issued, most first, then name. */
export function byIssued<T extends Pick<ScoreRow, "issued" | "name">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.issued - a.issued || a.name.localeCompare(b.name));
}

/** The table's filters, from the legend rows and the cards (`?has=`). */
export const SCORE_FILTERS = { chargebacks: "Charged back", at_risk: "Advance at risk", none: "Nothing issued" } as const;
export type ScoreFilter = keyof typeof SCORE_FILTERS;
export function scoreFilterOf(value: unknown): ScoreFilter | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v in SCORE_FILTERS ? (v as ScoreFilter) : null;
}
export function filterRows<T extends Pick<ScoreRow, "chargebackCents" | "advanceAtRiskCents" | "issued">>(rows: readonly T[], filter: ScoreFilter | null): T[] {
  if (!filter) return [...rows];
  return rows.filter((r) => (filter === "chargebacks" ? r.chargebackCents > 0 : filter === "at_risk" ? r.advanceAtRiskCents > 0 : r.issued === 0));
}

/** The row's one chip (5·1): the at-risk advance said in it; "Nothing issued" for a producer with no policy; else Clear. */
export function scoreChip(row: Pick<ScoreRow, "issued" | "advanceAtRiskCents">): { text: string; tone: "warning" | "good" | "neutral" } {
  if (row.advanceAtRiskCents > 0) return { text: `${dollars(row.advanceAtRiskCents)} at risk`, tone: "warning" };
  if (row.issued === 0) return { text: "Nothing issued", tone: "neutral" };
  return { text: "Clear", tone: "good" };
}

/** A whole percent, rounded half up; "—" with nothing to divide. */
export const percent = (part: number, whole: number) => (whole > 0 ? `${Math.floor((200 * part + whole) / (2 * whole))}%` : "—");

export const perPolicyText = (p: PerPolicy) => (p.kind === "rate" ? dollars(p.cents) : p.kind === "counts" ? `${dollars(p.spendCents)} for ${p.policies}` : "—");
export const persistingText = (p: Persisting) => (p.kind === "building" ? "—" : perPolicyText(p.perPolicy));

/** "Mar 2027" from a day. */
export function monthYear(day: string | null | undefined): string {
  if (!day || !/^\d{4}-\d{2}/.test(day)) return "";
  const [y, m] = day.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

/** "13 Aug" from a day. */
export function dayMonth(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
}

/** The team's figures for the rows shown (the visible producers): sums, and rates WEIGHTED by eligible policies. */
export type TeamFigures = {
  submitted: number; issued: number; placed: number; chargebackCents: number; advanceAtRiskCents: number; leadSpendCents: number;
  m4: { alive: number; eligible: number; building: boolean; readyOn: string | null };
  m13: { alive: number; eligible: number; building: boolean; readyOn: string | null };
  costPerIssued: PerPolicy;
  /** Cost per persisting policy, or building (any producer's cohort still inside its horizon). */
  costPerPersisting: { kind: "building"; readyOn: string | null } | { kind: "figure"; perPolicy: PerPolicy };
};

export function teamFigures(rows: readonly ScoreRow[], minSample: number): TeamFigures {
  const sum = (pick: (r: ScoreRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const cell = (key: "m4" | "m13") => {
    const building = rows.length === 0 || rows.every((r) => r[key].building);
    const ready = rows.map((r) => r[key].readyOn).filter((d): d is string => !!d).sort();
    return { alive: sum((r) => (r[key].building ? 0 : r[key].alive)), eligible: sum((r) => (r[key].building ? 0 : r[key].eligible)), building, readyOn: ready[0] ?? null };
  };
  const spend = sum((r) => r.leadSpendCents);
  const issued = sum((r) => r.issued);
  const persisting = rows.map((r) => r.costPerPersisting);
  const buildingOne = persisting.find((p) => p.kind === "building");
  const alive = persisting.reduce((s, p) => s + (p.kind === "figure" ? p.alive : 0), 0);
  return {
    submitted: sum((r) => r.submitted), issued, placed: sum((r) => r.placed),
    chargebackCents: sum((r) => r.chargebackCents), advanceAtRiskCents: sum((r) => r.advanceAtRiskCents), leadSpendCents: spend,
    m4: cell("m4"), m13: cell("m13"),
    costPerIssued: perPolicy(-spend, issued, minSample),
    costPerPersisting: buildingOne && buildingOne.kind === "building" ? { kind: "building", readyOn: buildingOne.readyOn } : { kind: "figure", perPolicy: perPolicy(-spend, alive, minSample) },
  };
}

/** A share as the table prints it: a percent from the sample up, "3 of 5" under it, "—" with nothing. */
export function shareOrCount(part: number, whole: number, minSample: number): string {
  if (whole === 0) return "—";
  return whole >= minSample ? percent(part, whole) : `${part} of ${whole}`;
}

// ─── the cards' sparklines ─────────────────────────────────────────────────────────────────────

export type Bucket = { key: string; label: string; from: string; to: string };

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/**
 * The period cut into weeks from its first day (the last week may be short); past 26 weeks, into calendar months.
 * Every bucket lies inside the period, so the buckets' counts add up to the period's.
 */
export function periodBuckets(period: { from: string; to: string }): Bucket[] {
  const start = dayMs(period.from);
  const end = dayMs(period.to);
  if (!(end >= start)) return [];
  const days = Math.round((end - start) / DAY_MS) + 1;
  const out: Bucket[] = [];
  if (days <= 26 * 7) {
    for (let at = start; at <= end; at += 7 * DAY_MS) {
      const from = iso(at);
      out.push({ key: from, label: `Week of ${dayMonth(from)}`, from, to: iso(Math.min(end, at + 6 * DAY_MS)) });
    }
    return out;
  }
  let y = Number(period.from.slice(0, 4));
  let m = Number(period.from.slice(5, 7));
  for (;;) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    if (first > period.to) break;
    const last = iso(Date.UTC(y, m, 0));
    const from = first < period.from ? period.from : first;
    out.push({ key: first.slice(0, 7), label: monthYear(first), from, to: last > period.to ? period.to : last });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** The twelve calendar months ending with the period's last day's month (the money cards: by issue month). */
export function issueMonths(to: string): Bucket[] {
  const y = Number(to.slice(0, 4));
  const m = Number(to.slice(5, 7));
  const out: Bucket[] = [];
  for (let back = 11; back >= 0; back--) {
    const d = new Date(Date.UTC(y, m - 1 - back, 1));
    const first = iso(d.getTime());
    out.push({ key: first.slice(0, 7), label: monthYear(first), from: first, to: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)) });
  }
  return out;
}

/** Which bucket a day falls in, or -1. */
export function bucketOf(buckets: readonly Bucket[], day: string | null | undefined): number {
  if (!day) return -1;
  const d = day.slice(0, 10);
  return buckets.findIndex((b) => d >= b.from && d <= b.to);
}

/** The default window: the last 90 days, today counted (the shared PeriodPicker's "Last 90 days"). */
export function defaultPeriod(now = new Date()): { from: string; to: string } {
  const to = iso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return { from: iso(dayMs(to) - 89 * DAY_MS), to };
}

/** A producer's record page, keeping the shared period. */
export function recordHref(producerUserId: string, period: { from: string; to: string }, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ from: period.from, to: period.to, ...(extra ?? {}) });
  return `${SCORECARDS_HREF}/${encodeURIComponent(producerUserId)}?${q.toString()}`;
}
