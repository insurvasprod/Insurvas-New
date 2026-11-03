import { MONTHS } from "../format/dates.ts";

/**
 * Submissions over time: a flat list of moments becomes the bars a chart draws.
 *
 * Team review worked this out inside a `useMemo`; the Overview needs the same numbers, and two
 * copies would drift until the two pages disagreed about a week the partner can see on both. It is
 * pure, so the awkward parts — a range shorter than a bar, a month boundary, nothing submitted at
 * all, the day the bars become weeks — are tested rather than squinted at on screen.
 *
 * Days are the **viewer's own calendar days**, as "YYYY-MM-DD", because a partner asking "how many
 * did I send on Tuesday" means their Tuesday.
 */

const DAY_MS = 86_400_000;

/** Past this many days in a range, a bar is a week: a day's bar is too thin to read or to hover. */
export const WEEK_STEP_AFTER_DAYS = 62;

export type TrendStep = 1 | 7;

export type TrendBucket = {
  /** The bucket's first day, which is also its React key. */
  key: string;
  /** "28 Oct", or "22 Oct – 28 Oct" for a week; the year is added when it is not this one. */
  label: string;
  /** Inclusive local-day bounds. */
  from: string;
  to: string;
  count: number;
};

export type Trend = {
  step: TrendStep;
  buckets: TrendBucket[];
  /** The tallest bucket, 0 when nothing landed in the range. */
  max: number;
  /** Everything counted — never the length of the input, which may hold dates outside the range. */
  total: number;
};

/** "2026-10-30" for a moment, in the viewer's own calendar. Null when it cannot be read. */
export function localDay(value: string | number | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A "YYYY-MM-DD" day as a local Date at midnight. Invalid days come back as an invalid Date. */
export function parseDay(value: string): Date {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return new Date(Number.NaN);
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/** Whole days in an inclusive range; 0 when either end is unreadable or the range runs backwards. */
export function spanDays(from: string, to: string): number {
  const start = parseDay(from);
  const end = parseDay(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  // Round, not floor: a daylight-saving change makes a "day" 23 or 25 hours long.
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

/** The day `days` after `value`, over month and year ends. */
export function shiftDay(value: string, days: number): string {
  const date = parseDay(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + days);
  return localDay(date)!;
}

function dayLabel(day: string, thisYear: number): string {
  const date = parseDay(day);
  if (Number.isNaN(date.getTime())) return day;
  const label = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === thisYear ? label : `${label} ${date.getFullYear()}`;
}

/**
 * The bars for an inclusive range of local days. Every bucket in the range exists, including the
 * empty ones: a quiet Tuesday is a fact about the week, not a gap in the chart.
 *
 * A moment outside the range, or one that cannot be read, is left out rather than folded into the
 * nearest bar.
 */
export function trendSeries(
  moments: readonly string[],
  { from, to, now = Date.now(), weekStepAfterDays = WEEK_STEP_AFTER_DAYS }: { from: string; to: string; now?: number; weekStepAfterDays?: number },
): Trend {
  const days = spanDays(from, to);
  if (days === 0) return { step: 1, buckets: [], max: 0, total: 0 };

  const step: TrendStep = days > weekStepAfterDays ? 7 : 1;
  const thisYear = new Date(now).getFullYear();
  const buckets: TrendBucket[] = [];
  for (let offset = 0; offset < days; offset += step) {
    const start = shiftDay(from, offset);
    const end = shiftDay(from, Math.min(days - 1, offset + step - 1));
    buckets.push({
      key: start,
      label: start === end ? dayLabel(start, thisYear) : `${dayLabel(start, thisYear)} – ${dayLabel(end, thisYear)}`,
      from: start,
      to: end,
      count: 0,
    });
  }

  let total = 0;
  for (const moment of moments) {
    const day = localDay(moment);
    if (!day) continue;
    const index = spanDays(from, day) - 1;
    // spanDays clamps at 0, so a day before the range reads as -1 here and is skipped with the rest.
    if (index < 0 || index >= days || day < from) continue;
    const bucket = buckets[Math.floor(index / step)];
    if (!bucket) continue;
    bucket.count += 1;
    total += 1;
  }

  return { step, buckets, max: buckets.reduce((high, bucket) => Math.max(high, bucket.count), 0), total };
}

/**
 * The last `days` of a series against the `days` before them, as the §14 comparison a figure needs
 * ("↑ 11.7% vs. the previous 7 days"). Null when there is nothing to compare against, because a
 * rise from nothing is not a percentage.
 */
export function compareTail(buckets: readonly TrendBucket[], days: number): { recent: number; previous: number; change: number | null } {
  const sum = (slice: readonly TrendBucket[]) => slice.reduce((count, bucket) => count + bucket.count, 0);
  const recent = sum(buckets.slice(-days));
  const previous = sum(buckets.slice(-days * 2, -days));
  return { recent, previous, change: previous > 0 ? ((recent - previous) / previous) * 100 : null };
}

/** The busiest bucket, for the one supporting fact a trend chart earns. Null when nothing landed. */
export function bestBucket(buckets: readonly TrendBucket[]): TrendBucket | null {
  let best: TrendBucket | null = null;
  for (const bucket of buckets) if (bucket.count > 0 && (!best || bucket.count > best.count)) best = bucket;
  return best;
}
