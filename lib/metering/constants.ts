// Client-safe: no `server-only` import. Query functions live in ./queries.

export type MeterRow = {
  meter_key: string;
  unit: string;
  label: string;
  default_hard_cap: boolean;
  sort_order: number;
};

export type PlanMeterRow = {
  meter_key: string;
  /** Null = unlimited. Zero = explicitly none. The two are NOT the same. */
  included_qty: number | null;
  hard_cap: boolean;
};

export type PlanLimits = {
  max_seats: number | null;
  max_carriers: number | null;
};

export type TenantUsageRow = {
  meter_key: string;
  label: string;
  unit: string;
  used_qty: number;
  included_qty: number | null;
  hard_cap: boolean;
};

/**
 * The coded default. Notify here, block at 100% when hard-capped (SA-2.5).
 *
 * SA-4.1 moved the live value into `usage.warn_percent`. Resolve it server-side with
 * `meterWarnThreshold()` and pass it to `usageState` — this is the fallback, not the rule.
 */
export const DEFAULT_METER_WARN_THRESHOLD = 0.8;

export function usagePercent(used: number, included: number | null): number | null {
  if (included === null || included === 0) return null;
  return Math.round((used / included) * 1000) / 10;
}

export function usageState(
  row: TenantUsageRow,
  warnThreshold: number = DEFAULT_METER_WARN_THRESHOLD,
): "unlimited" | "ok" | "near" | "over" {
  if (row.included_qty === null) return "unlimited";
  if (row.included_qty === 0) return row.used_qty > 0 ? "over" : "ok";
  const ratio = row.used_qty / row.included_qty;
  if (ratio >= 1) return "over";
  if (ratio >= warnThreshold) return "near";
  return "ok";
}

export function formatQuantity(qty: number, unit: string): string {
  const plural = qty === 1 ? unit : `${unit}s`;
  return `${qty.toLocaleString("en-US")} ${plural}`;
}
