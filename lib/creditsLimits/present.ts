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
