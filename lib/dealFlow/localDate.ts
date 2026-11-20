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

function knownZone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return value.trim();
  } catch {
    return null;
  }
}

/**
 * The zone whose midnight starts the Daily deal flow's "today" (and the day funnel's range): the same zone the
 * deals were filed in. A partner submission files its deal on the agency's day, else the partner's own
 * (lib/agentTemplates/intake.ts), so without an agency timezone the partners' zone is the agency's day, when
 * every partner shares one. Null when nothing settles it (no agency zone, partners in different zones or none):
 * the page then falls back to the browser's day as before.
 *
 * Never the viewer's own display timezone (LA-8.2): that is for showing times, and a viewer in Europe looking
 * at a New York agency at 00:30 would otherwise open on a day with no deals in it (2026-11-20, demo.basic: a
 * deal filed 2026-11-19 in America/New_York, the page opened on the browser's 2026-11-20 and counted 0).
 */
export function dealDayZone(workspaceZone: string | null | undefined, partnerZones: ReadonlyArray<string | null | undefined>): string | null {
  const agency = knownZone(workspaceZone);
  if (agency) return agency;
  const zones = new Set(partnerZones.map(knownZone).filter((zone): zone is string => zone !== null));
  return zones.size === 1 ? [...zones][0] : null;
}

export function intakeLocalDate(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
