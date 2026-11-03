/**
 * LA-2.18 · matched periods, in words.
 *
 * tenant_campaign_comparison refuses two periods of different length, or two that start on different
 * weekdays (a Monday-to-Sunday week against a Thursday-to-Wednesday one is a different mix of days).
 * The refusal used to reach the page as its raw code. This module says the same rule in plain
 * English and, instead of only refusing, works out the matched period B could use: the same number
 * of days as A, starting on A's weekday, as close to the start that was picked as possible and never
 * ending after today.
 *
 * Plain module (no server-only): the comparison panel checks as the dates are typed, the service
 * checks again before the database does, and node:test runs it directly.
 */

export type ComparisonPeriod = { from: string; to: string };
export type PeriodProblem = "order" | "length" | "weekday";
export type PeriodCheck =
  | { ok: true; days: number }
  | { ok: false; problem: PeriodProblem; message: string; suggestion: ComparisonPeriod | null };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toTime(iso: string) {
  return DATE.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : Number.NaN;
}
function toIso(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}
function weekday(iso: string) {
  return new Date(toTime(iso)).getUTCDay();
}

/** Days in a period, counting both ends. */
export function periodDays(period: ComparisonPeriod) {
  return Math.round((toTime(period.to) - toTime(period.from)) / DAY_MS) + 1;
}

/** "Mon 7 Sep" */
export function periodDay(iso: string) {
  const at = new Date(toTime(iso));
  return `${WEEKDAYS[at.getUTCDay()].slice(0, 3)} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/** "Mon 7 Sep – Sun 13 Sep" */
export function periodLabel(period: ComparisonPeriod) {
  return `${periodDay(period.from)} – ${periodDay(period.to)}`;
}

const plural = (count: number, word: string) => `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

/**
 * Period B, matched to A: A's length, A's starting weekday, starting on or before the day B was
 * given (so it covers what was asked for as far as it can), moved back a week at a time until it
 * does not end after today. Null when A itself is not a valid period.
 */
export function matchPeriodTo(a: ComparisonPeriod, b: ComparisonPeriod, today: string): ComparisonPeriod | null {
  const days = periodDays(a);
  if (!Number.isFinite(days) || days < 1 || Number.isNaN(toTime(b.from)) || Number.isNaN(toTime(today))) return null;
  const back = (weekday(b.from) - weekday(a.from) + 7) % 7;
  let start = toTime(b.from) - back * DAY_MS;
  while (start + (days - 1) * DAY_MS > toTime(today)) start -= 7 * DAY_MS;
  return { from: toIso(start), to: toIso(start + (days - 1) * DAY_MS) };
}

/** The database's two rules, checked the same way it checks them, with the fix offered. */
export function checkComparisonPeriods(a: ComparisonPeriod, b: ComparisonPeriod, today: string): PeriodCheck {
  if ([a.from, a.to, b.from, b.to].some((value) => Number.isNaN(toTime(value)))) {
    return { ok: false, problem: "order", message: "Enter a start and an end date for both periods.", suggestion: null };
  }
  if (a.from > a.to || b.from > b.to) {
    return { ok: false, problem: "order", message: "Each period needs its start date on or before its end date.", suggestion: null };
  }
  const daysA = periodDays(a);
  const daysB = periodDays(b);
  if (daysA !== daysB) {
    return {
      ok: false,
      problem: "length",
      message: `Period A is ${plural(daysA, "day")} and period B is ${plural(daysB, "day")}. A fair comparison needs the same number of days in each, so a longer period does not look better just by being longer.`,
      suggestion: matchPeriodTo(a, b, today),
    };
  }
  if (weekday(a.from) !== weekday(b.from)) {
    return {
      ok: false,
      problem: "weekday",
      message: `Period A starts on a ${WEEKDAYS[weekday(a.from)]} and period B on a ${WEEKDAYS[weekday(b.from)]}. Start both on the same weekday so each has the same mix of weekdays and weekends.`,
      suggestion: matchPeriodTo(a, b, today),
    };
  }
  return { ok: true, days: daysA };
}

/** The comparison RPC's refusal codes, in words, for anything that reaches the database anyway. */
export const COMPARISON_ERROR_TEXT: Record<string, string> = {
  campaign_comparison_invalid_metric: "Choose what to compare: contact rate, issued conversion or cost per issued policy.",
  campaign_comparison_invalid_date_range: "Each period needs its start date on or before its end date.",
  campaign_comparison_periods_must_match: "The two periods must have the same number of days.",
  campaign_comparison_weekdays_must_align: "The two periods must start on the same weekday.",
  campaign_comparison_campaign_not_found: "One of those campaigns no longer exists. Choose the two campaigns again.",
};

/** Plain English for a comparison failure message, or null when it is not one of the known codes. */
export function comparisonErrorText(message: string): string | null {
  for (const [code, text] of Object.entries(COMPARISON_ERROR_TEXT)) if (message.includes(code)) return text;
  return null;
}
