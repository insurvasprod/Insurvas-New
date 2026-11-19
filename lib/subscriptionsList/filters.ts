// The admin Subscriptions list's filters, read from and written to the address (billing-r2 screen 2: "filters
// read from the address, so ?status=past_due works"). Pure, so the page (server), the list (client) and the test
// all agree on what each parameter means.

import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import { csvCellMinimal } from "../csv/cell.ts";
import type { BillingCycle } from "@/lib/money";
import type { SubscriptionListRow } from "./model";

export type SubsLens = "all" | "past_due" | "cancelling" | "queued" | "renews";
export type SubsStatusFilter = "all" | "current" | SubscriptionStatus;
export type SubsQueuedFilter = "any" | "plan" | "ends" | "trial" | "none";

export type SubsFilters = {
  lens: SubsLens;
  q: string;
  plan: string;
  status: SubsStatusFilter;
  cycle: "any" | BillingCycle;
  queued: SubsQueuedFilter;
};

export const SUBS_LENSES: readonly { key: SubsLens; label: string }[] = [
  { key: "all", label: "All" },
  { key: "past_due", label: "Past due" },
  { key: "cancelling", label: "Cancelling" },
  { key: "queued", label: "Queued changes" },
  { key: "renews", label: "Renews in 7 days" },
];

const STATUSES: readonly string[] = ["active", "trialing", "past_due", "suspended", "paused", "cancelling", "cancelled", "current"];
const CYCLES: readonly string[] = ["monthly", "quarterly", "yearly"];
const QUEUED: readonly string[] = ["plan", "ends", "trial", "none"];
const LENSES: readonly string[] = SUBS_LENSES.map((lens) => lens.key);

type Params = Record<string, string | string[] | undefined> | URLSearchParams;
function one(params: Params, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

/** The filters in an address; anything unknown falls back to "not filtered". */
export function readSubsFilters(params: Params): SubsFilters {
  const lens = one(params, "lens");
  const status = one(params, "status");
  const cycle = one(params, "cycle");
  const queued = one(params, "queued");
  return {
    lens: LENSES.includes(lens) ? (lens as SubsLens) : "all",
    q: one(params, "q").slice(0, 120),
    plan: one(params, "plan") || "all",
    status: STATUSES.includes(status) ? (status as SubsStatusFilter) : "all",
    cycle: CYCLES.includes(cycle) ? (cycle as BillingCycle) : "any",
    queued: QUEUED.includes(queued) ? (queued as SubsQueuedFilter) : "any",
  };
}

/** The address parameters for a set of filters; defaults are left out. */
export function subsFilterParams(filters: SubsFilters): Record<string, string | null> {
  return {
    lens: filters.lens === "all" ? null : filters.lens,
    q: filters.q || null,
    plan: filters.plan === "all" ? null : filters.plan,
    status: filters.status === "all" ? null : filters.status,
    cycle: filters.cycle === "any" ? null : filters.cycle,
    queued: filters.queued === "any" ? null : filters.queued,
  };
}

export function inLens(row: SubscriptionListRow, lens: SubsLens): boolean {
  switch (lens) {
    case "all":
      return true;
    case "past_due":
      return row.status === "past_due";
    case "cancelling":
      return row.status !== "cancelled" && (row.status === "cancelling" || row.cancelAtPeriodEnd);
    case "queued":
      return row.queuedKind === "plan";
    case "renews":
      return row.renewsWithinWeek;
  }
}

export function lensCounts(rows: readonly SubscriptionListRow[]): Record<SubsLens, number> {
  const counts = { all: 0, past_due: 0, cancelling: 0, queued: 0, renews: 0 } as Record<SubsLens, number>;
  for (const row of rows) for (const lens of LENSES as SubsLens[]) if (inLens(row, lens)) counts[lens] += 1;
  return counts;
}

/** The rows the filters keep, in the list's order. */
export function filterSubs(rows: readonly SubscriptionListRow[], filters: SubsFilters): SubscriptionListRow[] {
  const needle = filters.q.toLowerCase();
  return rows.filter((row) => {
    if (!inLens(row, filters.lens)) return false;
    if (filters.plan !== "all" && row.planId !== filters.plan) return false;
    if (filters.status === "current" && row.status === "cancelled") return false;
    if (filters.status !== "all" && filters.status !== "current" && row.status !== filters.status) return false;
    if (filters.cycle !== "any" && row.cycle !== filters.cycle) return false;
    if (filters.queued === "none" && row.queuedKind !== "none" && row.queuedKind !== "ended") return false;
    if (filters.queued !== "any" && filters.queued !== "none" && row.queuedKind !== filters.queued) return false;
    if (!needle) return true;
    return row.tenantName.toLowerCase().includes(needle) || row.tenantId.toLowerCase() === needle;
  });
}

/** One CSV cell: the product's one escaper (lib/csv/cell.ts), quoting only when needed. */
export const csvCell = csvCellMinimal;

export function csvOf(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** The Subscriptions export: what the table shows, plus the facts the row's sheet adds. */
export function subscriptionsCsv(rows: readonly SubscriptionListRow[], statusLabel: (status: SubscriptionStatus) => string): string {
  const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
  return csvOf(
    ["Customer", "Customer id", "Plan", "Plan version", "Cycle", "Status", "Period start", "Period end", "Queued change", "Monthly (USD)", "Cycle price (USD)", "Started", "Trial ends", "Access ended", "Cancellation reason"],
    rows.map((row) => [
      row.tenantName, row.tenantId, row.planName, row.planVersion, row.cycle, statusLabel(row.status), row.periodStart, row.periodEnd,
      row.queuedText === "—" ? "" : row.queuedText, dollars(row.monthlyCents), dollars(row.cycleCents), row.startedAt, row.trialEndsAt, row.cancelledAt, row.cancelReason,
    ]),
  );
}
