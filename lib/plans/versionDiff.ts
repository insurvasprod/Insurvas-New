// What changed between two stored versions of a plan (admin round 1, docs/design/admin-r1/catalog.html screen 2:
// the plan sheet's Versions tab and Compare plans). Pure: client-safe and tested by versionDiff.test.mjs.

import { formatCentsAsCurrency, type PlanPrices } from "../money.ts";
import type { PlanLimits } from "../metering/constants.ts";

export type PlanMeterGrant = { meter_key: string; included_qty: number | null; hard_cap: boolean };

/** One version as stored: its price row, limits row, granted features and meter allowances. */
export type PlanVersionSnapshot = {
  id: string;
  version: number;
  name: string;
  createdAt: string;
  isArchived: boolean;
  /** Live (not cancelled) subscriptions on this version. */
  subscribers: number;
  prices: PlanPrices | null;
  limits: PlanLimits | null;
  features: string[];
  meters: PlanMeterGrant[];
};

export type DiffLine = { key: string; label: string; from: string | null; to: string | null };

export const PRICE_FIELDS: ReadonlyArray<[keyof PlanPrices, string]> = [
  ["price_monthly_cents", "Monthly price"],
  ["price_quarterly_cents", "Quarterly price"],
  ["price_yearly_cents", "Yearly price"],
  ["setup_fee_cents", "Setup fee"],
  ["trial_days", "Trial"],
];

export const LIMIT_FIELDS: ReadonlyArray<[keyof PlanLimits, string]> = [
  ["max_seats", "Seats"],
  ["max_carriers", "Carriers"],
  ["max_publishers", "Publishers"],
  ["max_marketing_partners", "Marketing partners"],
  ["max_affiliates", "Affiliates"],
  ["max_buffer_seats", "Buffer seats"],
  ["max_partner_users", "Partner users"],
  ["max_setter_seats", "Setter seats"],
  ["max_active_campaigns", "Active campaigns"],
];

/** A price field in words: "$299.00", "Not offered", "14 days". */
export function priceWords(prices: PlanPrices | null, field: keyof PlanPrices): string {
  if (!prices) return "Not set";
  const value = prices[field];
  if (field === "trial_days") return Number(value) > 0 ? `${value} ${value === 1 ? "day" : "days"}` : "No trial";
  if (field === "currency") return String(value);
  if (value === null || value === undefined) return field === "setup_fee_cents" ? "None" : "Not offered";
  return field === "setup_fee_cents" && value === 0 ? "None" : formatCentsAsCurrency(Number(value));
}

export function limitWords(limits: PlanLimits | null, field: keyof PlanLimits): string {
  const value = limits?.[field];
  return value === null || value === undefined ? "Unlimited" : value.toLocaleString("en-US");
}

function meterWords(grant: PlanMeterGrant | undefined): string {
  if (!grant) return "Platform default";
  const qty = grant.included_qty === null ? "Unlimited" : grant.included_qty.toLocaleString("en-US");
  return `${qty}${grant.hard_cap ? ", hard cap" : ""}`;
}

/**
 * Every difference from `before` to `after`, in the order a reader checks: price, limits, features granted or
 * taken away, then usage allowances. Labels for features and meters fall back to their keys.
 */
export function diffPlanVersions(
  before: PlanVersionSnapshot,
  after: PlanVersionSnapshot,
  labels: { features?: Record<string, string>; meters?: Record<string, string> } = {},
): DiffLine[] {
  const lines: DiffLine[] = [];
  if (before.name !== after.name) lines.push({ key: "name", label: "Name", from: before.name, to: after.name });
  for (const [field, label] of PRICE_FIELDS) {
    const from = priceWords(before.prices, field);
    const to = priceWords(after.prices, field);
    if (from !== to) lines.push({ key: `price:${field}`, label, from, to });
  }
  for (const [field, label] of LIMIT_FIELDS) {
    const from = limitWords(before.limits, field);
    const to = limitWords(after.limits, field);
    if (from !== to) lines.push({ key: `limit:${field}`, label, from, to });
  }
  const had = new Set(before.features);
  const has = new Set(after.features);
  const name = (key: string) => labels.features?.[key] ?? key;
  for (const key of [...has].filter((key) => !had.has(key)).sort((a, b) => name(a).localeCompare(name(b)))) lines.push({ key: `feature:${key}`, label: name(key), from: null, to: "Granted" });
  for (const key of [...had].filter((key) => !has.has(key)).sort((a, b) => name(a).localeCompare(name(b)))) lines.push({ key: `feature:${key}`, label: name(key), from: "Granted", to: null });
  const meterKeys = [...new Set([...before.meters, ...after.meters].map((grant) => grant.meter_key))].sort();
  for (const key of meterKeys) {
    const from = meterWords(before.meters.find((grant) => grant.meter_key === key));
    const to = meterWords(after.meters.find((grant) => grant.meter_key === key));
    if (from !== to) lines.push({ key: `meter:${key}`, label: labels.meters?.[key] ?? key, from, to });
  }
  return lines;
}

/** The one-line summary on a version's row: "Monthly price $279.00 → $299.00 · + Lead posting · 2 more". */
export function diffSummary(lines: DiffLine[], max = 3): string {
  if (lines.length === 0) return "No change to price, limits or features";
  const words = lines.slice(0, max).map((line) => (line.from === null ? `+ ${line.label}` : line.to === null ? `− ${line.label}` : `${line.label} ${line.from} → ${line.to}`));
  return lines.length > max ? `${words.join(" · ")} · ${lines.length - max} more` : words.join(" · ");
}

/** Each version with what changed against the one before it (the oldest reads "First version"). Newest first. */
export function versionHistory(
  versions: PlanVersionSnapshot[],
  labels: { features?: Record<string, string>; meters?: Record<string, string> } = {},
): Array<PlanVersionSnapshot & { changes: DiffLine[] | null }> {
  const ascending = [...versions].sort((a, b) => a.version - b.version);
  return ascending
    .map((version, index) => ({ ...version, changes: index === 0 ? null : diffPlanVersions(ascending[index - 1], version, labels) }))
    .reverse();
}
