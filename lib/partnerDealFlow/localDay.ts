/**
 * The day Daily deal flow is showing, in the partner organisation's own timezone.
 *
 * `deal_flow.local_date` is a local date, not a UTC one — `lib/dealFlow/localDate.ts` spells out
 * why and what it costs to get wrong: "a closer submitting at 22:30 in Honolulu is filing a lead
 * for the 21st, while UTC has already rolled over to the 22nd". A page whose whole subject is one
 * day has to read that boundary the same way the write did, or for part of every day it shows the
 * wrong deals under the right heading.
 *
 * Pure, so the boundary can be tested at a fixed instant instead of only while the test machine's
 * zone happens to disagree with UTC.
 */
import { intakeLocalDate } from "../dealFlow/localDate.ts";

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, written YYYY-MM-DD. Rejects 2026-02-30 as well as nonsense. */
export function isValidDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Today, where this partner is. */
export function todayIn(timeZone: string, at: Date = new Date()): string {
  return intakeLocalDate(timeZone, at);
}

/** Later than today where this partner is. There is no deal flow for tomorrow. */
export function isFutureDay(day: string, timeZone: string, at: Date = new Date()): boolean {
  return day > todayIn(timeZone, at);
}

/**
 * Whole days from one calendar day to another, both YYYY-MM-DD.
 *
 * Both are already local dates in the same zone, so this is calendar arithmetic and never has to
 * think about offsets or daylight saving — which is exactly why the service converts to local
 * days before measuring anything.
 */
export function daysBetweenDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The day as a person reads it: "Mon 2 Nov" on the stepper, "Monday 2 November" in a sentence.
 *
 * A day is already a plain calendar date in the partner's zone, so it is formatted at UTC midnight
 * in UTC — the one place in this module where a `Date` appears without a zone, because here it
 * must not be shifted by one.
 */
export function dayLabel(day: string, long = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: long ? "long" : "short",
    day: "numeric",
    month: long ? "long" : "short",
  });
}

/**
 * The day to show: the one asked for when it is a real day that is not in the future, else today.
 * A bad or future `?day=` is a stale link or a hand-edited one, so it lands on today rather than
 * erroring — the same way the Pipeline treats a stale focus id.
 */
export function resolveDay(requested: unknown, timeZone: string, at: Date = new Date()): string {
  const today = todayIn(timeZone, at);
  if (!isValidDay(requested) || requested > today) return today;
  return requested;
}
