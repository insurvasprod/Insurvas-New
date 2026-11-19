// The admin dashboard's graphs, as arithmetic (admin round 1, docs/design/admin-r1/dashboard-combined.html:
// Overview, Money and Customers). Plain module: no database, no `server-only`, so the periods, the buckets
// and the honest gaps are testable on their own, and the tabs and their tests read the same code.
//
// Two kinds of series, and the difference matters:
//   · Snapshot series come from metrics_daily, which a nightly job writes. A bucket with no snapshot day is
//     UNKNOWN, not zero, so it is left out of the line rather than drawn as a cliff (production stopped
//     writing on 2026-09-21; a 30-day graph of zeros would announce a collapse that did not happen).
//   · Event series (sign-ins, payments) are counted from the rows themselves, so an empty bucket really is
//     zero and every bucket is drawn.

import type { AdminRole } from "../adminAuth/roles.ts";
import { formatCentsAsCurrency } from "../money.ts";
import { canOpenAdminHref } from "./compose.ts";
import { type DashPeriod } from "./periods.ts";
import { dashboardTabHref, dashboardTabsFor, type AdminDashboardTab } from "./tabs.ts";

export { DASH_PERIODS, DASH_PERIOD_LABELS, pickDashPeriod, type DashPeriod } from "./periods.ts";

/* ── Periods ───────────────────────────────────────────────────────────────────────────────── */

/** One slot on a graph's axis: a day, a week or a month. `start` is inclusive and `end` exclusive (YYYY-MM-DD, UTC). */
export type Bucket = { key: string; label: string; start: string; end: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcDay = (ms: number) => {
  const day = new Date(ms);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
};

/** "17 Nov" from "2026-11-17". Spelled out rather than Intl, so the server and the browser print the same. */
export function dayLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
}

/**
 * The buckets a period is drawn in, oldest first, the last one holding today: 30 days a day each, 90 days a
 * week each (13 weeks from Monday, as Postgres `date_trunc('week')`), 12 months a calendar month each.
 */
export function periodBuckets(period: DashPeriod, nowMs: number): Bucket[] {
  const today = utcDay(nowMs);
  if (period === "30d") {
    return Array.from({ length: 30 }, (_, index) => {
      const start = today - (29 - index) * DAY_MS;
      return { key: iso(start), label: dayLabel(iso(start)), start: iso(start), end: iso(start + DAY_MS) };
    });
  }
  if (period === "90d") {
    const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
    return Array.from({ length: 13 }, (_, index) => {
      const start = monday - (12 - index) * 7 * DAY_MS;
      return { key: iso(start), label: dayLabel(iso(start)), start: iso(start), end: iso(start + 7 * DAY_MS) };
    });
  }
  const now = new Date(today);
  return Array.from({ length: 12 }, (_, index) => {
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index), 1);
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index) + 1, 1);
    return { key: iso(start).slice(0, 7), label: MONTHS[new Date(start).getUTCMonth()], start: iso(start), end: iso(end) };
  });
}

/** The same buckets a year earlier (the "last year" line), keyed as this year's so the two lines align. */
export function yearEarlier(buckets: readonly Bucket[]): Bucket[] {
  const back = (date: string) => `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  return buckets.map((bucket) => ({ ...bucket, start: back(bucket.start), end: back(bucket.end) }));
}

/** Where a period starts, as an ISO timestamp: the first bucket's first moment. */
export function periodStartIso(period: DashPeriod, nowMs: number): string {
  return `${periodBuckets(period, nowMs)[0].start}T00:00:00.000Z`;
}

/* ── Series ────────────────────────────────────────────────────────────────────────────────── */

export type SeriesPoint = { key: string; label: string; value: number };

/** A snapshot day as the series read it: its date and any numeric columns. */
export type DatedRow = { date: string };

const inBucket = (date: string, bucket: Bucket) => date >= bucket.start && date < bucket.end;

/**
 * A level (MRR, customers, trials): the value on the newest snapshot day inside each bucket. A bucket with no
 * snapshot day is left out, never drawn as zero.
 */
export function levelSeries<T extends DatedRow>(days: readonly T[], buckets: readonly Bucket[], pick: (day: T) => number): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const bucket of buckets) {
    let last: T | null = null;
    for (const day of days) if (inBucket(day.date, bucket) && (!last || day.date > last.date)) last = day;
    if (last) points.push({ key: bucket.key, label: bucket.label, value: pick(last) });
  }
  return points;
}

/**
 * A flow (new customers, MRR moved): the sum over the snapshot days inside each bucket. A bucket with no
 * snapshot day is left out, never drawn as zero.
 */
export function flowSeries<T extends DatedRow>(days: readonly T[], buckets: readonly Bucket[], pick: (day: T) => number): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const bucket of buckets) {
    const inside = days.filter((day) => inBucket(day.date, bucket));
    if (inside.length) points.push({ key: bucket.key, label: bucket.label, value: inside.reduce((sum, day) => sum + pick(day), 0) });
  }
  return points;
}

/** Events counted from their own rows (sign-ins, payments): every bucket is drawn, an empty one is a real zero. */
export function eventSeries(events: readonly { at: string; value?: number }[], buckets: readonly Bucket[]): SeriesPoint[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    value: events.filter((event) => inBucket(event.at.slice(0, 10), bucket)).reduce((sum, event) => sum + (event.value ?? 1), 0),
  }));
}

/**
 * The "last year" line for a level series: drawn only when last year has a figure for every point this year
 * has, so the two lines share their axis point for point. Otherwise null, and the graph says why.
 */
export function lastYearLine<T extends DatedRow>(days: readonly T[], buckets: readonly Bucket[], points: readonly SeriesPoint[], pick: (day: T) => number): SeriesPoint[] | null {
  if (points.length < 2) return null;
  const earlier = new Map(levelSeries(days, yearEarlier(buckets), pick).map((point) => [point.key, point]));
  const aligned = points.map((point) => earlier.get(point.key));
  if (aligned.some((point) => !point)) return null;
  return aligned.map((point, index) => ({ key: points[index].key, label: points[index].label, value: point!.value }));
}

/* ── Words ─────────────────────────────────────────────────────────────────────────────────── */

/** "today", "1 day old", "57 days old". */
export function ageWords(ageDays: number | null): string | null {
  if (ageDays === null) return null;
  if (ageDays <= 0) return "today";
  return `${ageDays.toLocaleString("en-US")} ${ageDays === 1 ? "day" : "days"} old`;
}

/** Whole dollars for a headline or an axis: "$3,480". Money is always dollars on screen, never cents. */
export function wholeDollars(cents: number): string {
  return formatCentsAsCurrency(Math.round(cents / 100) * 100).replace(/\.00$/, "");
}

/** "+$420", "−$80", "$0". */
export function signedDollars(cents: number): string {
  const whole = wholeDollars(Math.abs(cents));
  return cents > 0 ? `+${whole}` : cents < 0 ? `−${whole}` : whole;
}

/** "1 thing" / "3 things". */
export function countWords(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** Whole percent of a whole, or null without one. */
export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/**
 * Why a snapshot graph has fewer points than its period: no history at all, history that starts late, or a
 * nightly job that stopped. Null when the line covers the period.
 */
export function coverageNote(points: readonly SeriesPoint[], buckets: readonly Bucket[], snapshotDate: string | null): string | null {
  if (!snapshotDate) return "No daily figures have been computed yet.";
  if (!points.length) return `No daily figures in this period: the nightly figures stopped on ${dayLabel(snapshotDate)}.`;
  if (points.length === buckets.length) return null;
  const last = buckets.at(-1)!;
  if (snapshotDate < last.start) return `Ends ${dayLabel(snapshotDate)}, when the nightly figures stopped.`;
  return `Only ${points.length} of ${buckets.length} ${buckets.length === 12 ? "months" : buckets.length === 13 ? "weeks" : "days"} have figures yet.`;
}

/* ── Money ─────────────────────────────────────────────────────────────────────────────────── */

export type MovementDay = DatedRow & { new_mrr_cents: number; expansion_mrr_cents: number; contraction_mrr_cents: number; churned_mrr_cents: number };

/** MRR gained less MRR lost on one snapshot day. */
export function netMovementCents(day: MovementDay): number {
  return day.new_mrr_cents + day.expansion_mrr_cents - day.contraction_mrr_cents - day.churned_mrr_cents;
}

/** Whole days an invoice is past its due date (0 when not yet due or with no date). */
export function daysLate(dueAt: string | null, nowMs: number): number {
  if (!dueAt) return 0;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return 0;
  return Math.max(0, Math.floor((nowMs - due) / DAY_MS));
}

/** Trials whose end fell in a window, and how many of them became paying subscriptions. */
export function trialConversion(rows: readonly { status: string }[]): { converted: number; ended: number } {
  const ended = rows.filter((row) => row.status !== "trialing");
  return { converted: ended.filter((row) => row.status === "active" || row.status === "past_due" || row.status === "cancelling").length, ended: ended.length };
}

/* ── The funnel ────────────────────────────────────────────────────────────────────────────── */

export type FunnelInput = { label: string; count: number | null; measured: boolean; note?: string };
export type FunnelRow = FunnelInput & { share: number | null; drop: boolean };

/**
 * The funnel as drawn: each measured step's share of sign-ups, and the step with the largest share lost from
 * the measured step before it marked as the drop. Unmeasured steps are kept (they say why) but never named as
 * the drop — a gap is not a cliff.
 */
export function funnelView(steps: readonly FunnelInput[]): { rows: FunnelRow[]; dropWords: string | null } {
  const first = steps.find((step) => step.measured && step.count !== null)?.count ?? 0;
  let worst: { index: number; from: string; rate: number } | null = null;
  let previous: { label: string; count: number } | null = null;
  steps.forEach((step, index) => {
    if (!step.measured || step.count === null) return;
    if (previous && previous.count > 0 && step.count < previous.count) {
      const rate = (previous.count - step.count) / previous.count;
      if (!worst || rate > worst.rate) worst = { index, from: previous.label, rate };
    }
    previous = { label: step.label, count: step.count };
  });
  const drop = worst as { index: number; from: string; rate: number } | null;
  return {
    rows: steps.map((step, index) => ({ ...step, share: step.measured && step.count !== null ? percentOf(step.count, first) : null, drop: drop?.index === index })),
    dropWords: drop ? `Biggest drop: ${drop.from.toLowerCase()} → ${steps[drop.index].label.toLowerCase()} (${Math.round(drop.rate * 100)}% stop here)` : null,
  };
}

/* ── Links ─────────────────────────────────────────────────────────────────────────────────── */

/** A dashboard tab's address when the role has that tab, else null (the link is then plain text). */
export function tabLink(role: AdminRole, tab: AdminDashboardTab, query?: string): string | null {
  if (!dashboardTabsFor(role).includes(tab)) return null;
  const base = dashboardTabHref(tab);
  return query ? `${base}${base.includes("?") ? "&" : "?"}${query}` : base;
}

/** `href` when the role can open it, else null. */
export function pageLink(role: AdminRole, href: string): string | null {
  return canOpenAdminHref(role, href) ? href : null;
}
