import { zonedInstant } from "../appointments/calendarMath.ts";

/**
 * The deal-flow date, in the partner's own timezone.
 *
 * LA-1.7 is explicit that this is not a UTC date: *"`date` is the agent's local date, not UTC"*, and
 * its fifth criterion is *"the deal-flow date is correct for an agent working late in their own
 * timezone"* — a closer submitting at 22:30 in Honolulu is filing a lead for the 21st, while UTC has
 * already rolled over to the 22nd. Get it wrong and every daily deal-flow count is off by one for
 * part of each day, in a way nobody notices until a payout is reconciled.
 *
 * Extracted from `writePartnerIntakeArtifacts` so it can be tested at a fixed instant. It lived
 * inline there, and the only assertion covering it compared the stored value against a date the test
 * computed for `Pacific/Honolulu` **at the moment it ran** — a good test, but one that can only
 * discriminate while Honolulu and UTC are on different dates. That is 00:00–10:00 UTC; for the other
 * fourteen hours a UTC implementation would have passed it unnoticed.
 *
 * `en-CA` is used because it formats as `YYYY-MM-DD`, which is what the `date` column wants.
 */
/** [start, end) of local dates `from`..`to` (YYYY-MM-DD) in `zone`, as UTC ISO strings. */
export function localRangeToUtc(from: string, to: string, zone: string): { gte: string; lt: string } {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const end = new Date(Date.UTC(ty, tm - 1, td + 1));
  return {
    gte: new Date(zonedInstant(fy, fm, fd, 0, zone)).toISOString(),
    lt: new Date(zonedInstant(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), 0, zone)).toISOString(),
  };
}

export function intakeLocalDate(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
