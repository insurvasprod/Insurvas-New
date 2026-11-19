// Client-safe presentation rules for the Credits & limits usage monitor. Pure, and tested in
// present.test.mjs, because the colour of a row is a claim about a customer's allowance.

import { isCreditMeterKey, type CreditMeterKey, type SeatMonitorRow, type UsageMonitorRow } from "./constants.ts";

export type LimitState = "over" | "near" | "ok";

/**
 * The board's row-state rule (user decision, 2026-09-24).
 *
 * Over is strictly past the limit. At the limit is NEAR, not over: a hard-capped meter at 12 / 12 has
 * stopped, but nothing has been exceeded. Near starts at the warn threshold (usage.warn_percent). A
 * zero allowance with any usage is over; zero with none is not a row at all (see `isWatchable`).
 */
export function limitState(used: number, limit: number, warnFraction: number): LimitState {
  if (used > limit) return "over";
  if (limit > 0 && used >= limit * warnFraction) return "near";
  return "ok";
}

/** How close to the limit, for sorting: past 1 is over. A zero allowance with usage sorts first. */
export function proximity(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? Number.POSITIVE_INFINITY : 0;
  return used / limit;
}

/** A finite limit with something to say. Unlimited rows and 0-of-0 rows are left out (user decision). */
export function isWatchable(used: number, limit: number | null): limit is number {
  return limit !== null && !(limit === 0 && used === 0);
}

export type MonitorEntry = {
  key: string;
  kind: "meter" | "seats";
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  /** The grantable meter, or null for seats and for a meter credits cannot be granted on. */
  grantMeter: CreditMeterKey | null;
  label: string;
  used: number;
  limit: number;
  grantQty: number;
  addonQty: number;
  state: LimitState;
  proximity: number;
  /** The meter period's first day (the forecast's pace starts here); null for seats, which do not burn. */
  periodStart: string | null;
};

export function buildMonitorEntries(
  meters: readonly UsageMonitorRow[],
  seats: readonly SeatMonitorRow[],
  warnFraction: number,
): MonitorEntry[] {
  const entries: MonitorEntry[] = [];
  for (const row of meters) {
    if (!isWatchable(row.used_qty, row.included_qty)) continue;
    entries.push({
      key: `${row.tenant_id}:${row.meter_key}`,
      kind: "meter",
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
      grantMeter: isCreditMeterKey(row.meter_key) ? row.meter_key : null,
      label: row.meter_label,
      used: row.used_qty,
      limit: row.included_qty,
      grantQty: row.grant_qty ?? 0,
      addonQty: row.addon_qty ?? 0,
      state: limitState(row.used_qty, row.included_qty, warnFraction),
      proximity: proximity(row.used_qty, row.included_qty),
      periodStart: row.period_start,
    });
  }
  for (const row of seats) {
    if (!isWatchable(row.used_qty, row.included_qty)) continue;
    entries.push({
      key: `${row.tenant_id}:seats`,
      kind: "seats",
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      tenantStatus: row.tenant_status,
      grantMeter: null,
      label: "Seats",
      used: row.used_qty,
      limit: row.included_qty,
      grantQty: 0,
      addonQty: 0,
      state: limitState(row.used_qty, row.included_qty, warnFraction),
      proximity: proximity(row.used_qty, row.included_qty),
      periodStart: null,
    });
  }
  return entries.sort(
    (a, b) => b.proximity - a.proximity || a.tenantName.localeCompare(b.tenantName) || a.label.localeCompare(b.label),
  );
}

/** Distinct tenants with at least one row strictly over its limit. */
export function tenantsOverCount(entries: readonly MonitorEntry[]): number {
  return new Set(entries.filter((entry) => entry.state === "over").map((entry) => entry.tenantId)).size;
}

/** "Lead imports" → "lead imports", but "TCPA checks" and "DNC lookups" keep their capitals. */
export function inSentence(label: string): string {
  if (label.length > 1 && /[A-Z]/.test(label[0]) && /[a-z]/.test(label[1])) return label[0].toLowerCase() + label.slice(1);
  return label;
}

/** The row the monitor's footer names: the one furthest over, by proximity. Null when none is over. */
export function furthestOver(entries: readonly MonitorEntry[]): { tenantName: string; over: number; label: string } | null {
  const top = entries.find((entry) => entry.state === "over");
  if (!top) return null;
  return { tenantName: top.tenantName, over: top.used - top.limit, label: inSentence(top.label) };
}

export function tenantsOverLabel(count: number): string {
  if (count === 0) return "No tenant over a limit";
  return count === 1 ? "1 tenant over its limit" : `${count.toLocaleString("en-US")} tenants over their limit`;
}

export type LimitForecast =
  | { kind: "over" }
  | { kind: "at_limit" }
  | { kind: "days"; days: number }
  | { kind: "not_this_period" }
  | { kind: "none" };

const DAY_MS = 86_400_000;

/** A meter period is one calendar month from its first day (lib/metering: monthly periods). */
function periodEnd(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()));
}

/**
 * "Hits the limit" (admin round 1, billing-r2 screen 10): when this month's pace reaches the limit. The pace is what
 * was used since the period began, per day (at least one day, so a first-morning burst does not read as infinite).
 * Seats, rows with no period and rows with no use have no forecast; a pace that reaches the limit only after the
 * period resets says so instead of naming a day.
 */
export function forecastHit(entry: Pick<MonitorEntry, "used" | "limit" | "periodStart" | "kind">, now: Date): LimitForecast {
  if (entry.used > entry.limit) return { kind: "over" };
  if (entry.used === entry.limit && entry.limit > 0) return { kind: "at_limit" };
  if (entry.kind !== "meter" || !entry.periodStart || entry.used <= 0) return { kind: "none" };
  const start = new Date(entry.periodStart);
  if (Number.isNaN(start.getTime())) return { kind: "none" };
  const elapsedDays = Math.max(1, (now.getTime() - start.getTime()) / DAY_MS);
  const pace = entry.used / elapsedDays;
  const days = (entry.limit - entry.used) / pace;
  if (now.getTime() + days * DAY_MS >= periodEnd(start).getTime()) return { kind: "not_this_period" };
  return { kind: "days", days: Math.max(0, Math.ceil(days)) };
}

export function forecastLabel(forecast: LimitForecast): string {
  switch (forecast.kind) {
    case "over": return "Already over";
    case "at_limit": return "At the limit";
    case "days": return forecast.days <= 1 ? "within a day" : `in ~${forecast.days} days`;
    case "not_this_period": return "Not this period";
    default: return "—";
  }
}
