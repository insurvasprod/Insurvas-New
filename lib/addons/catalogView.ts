// Client-safe, pure: what the Add-ons catalog shows, derived from rows the server already read.
//
// Kept out of the components so the money arithmetic (monthly equivalents, the share of MRR) and
// the plan-version logic can be tested without rendering anything.

import type { BillingCycle } from "../money.ts";

/** Statuses that are revenue today — the same three compute_metrics_for_date counts as MRR. */
export const REVENUE_STATUSES = ["active", "past_due", "cancelling"] as const;

/** Months per cycle, as lib/money.ts CYCLE_MONTHS; repeated so this file stays import-light. */
const MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** "/ mo", "/ qtr", "/ yr" — the board's price suffix. */
export const CYCLE_SUFFIX: Record<BillingCycle, string> = { monthly: "/ mo", quarterly: "/ qtr", yearly: "/ yr" };

/** Round to whole cents per item, the way public.monthly_equivalent_cents does. */
export function monthlyEquivalent(cents: number, cycle: BillingCycle): number {
  return Math.round(cents / MONTHS[cycle]);
}

export type PlanRef = { id: string; code: string; name: string; version: number; is_archived: boolean };

/** The id of the newest version of every plan code — what admin_plan_list shows. */
export function latestPlanIds(plans: PlanRef[]): Set<string> {
  const newest = new Map<string, PlanRef>();
  for (const plan of plans) {
    const seen = newest.get(plan.code);
    if (!seen || plan.version > seen.version) newest.set(plan.code, plan);
  }
  return new Set([...newest.values()].map((plan) => plan.id));
}

/**
 * The plan ids a save should send so that older plan versions keep their availability.
 *
 * The editor lists one row per plan code (its latest version). An existing row for an OLDER version
 * is something the admin never saw and so cannot have meant to remove; it is carried over. Rows for
 * latest versions follow the admin's ticks exactly.
 */
export function mergePlanAvailability(chosen: string[], existing: string[], plans: PlanRef[]): string[] {
  const latest = latestPlanIds(plans);
  const known = new Set(plans.map((plan) => plan.id));
  const kept = existing.filter((id) => known.has(id) && !latest.has(id));
  return [...new Set([...chosen, ...kept])];
}

export type AttachableEntry = { code: string; label: string; olderOnly: boolean };

/**
 * "Attachable to", one entry per plan code in plan sort order. A code offered only on versions that
 * are no longer its latest says so, rather than reading as if new subscribers could get it.
 */
export function attachableTo(planIds: string[], plans: PlanRef[]): AttachableEntry[] {
  const latest = latestPlanIds(plans);
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const byCode = new Map<string, { name: string; onLatest: boolean }>();
  for (const id of planIds) {
    const plan = byId.get(id);
    if (!plan) continue;
    const entry = byCode.get(plan.code) ?? { name: plan.name, onLatest: false };
    if (latest.has(plan.id)) {
      entry.onLatest = true;
      entry.name = plan.name;
    }
    byCode.set(plan.code, entry);
  }
  return [...byCode.entries()].map(([code, entry]) => ({ code, label: entry.name, olderOnly: !entry.onLatest }));
}

export type LiveAttachment = {
  addon_id: string;
  tenant_id: string;
  status: string;
  billing_cycle: BillingCycle;
};

export type RevenueSubscription = { plan_id: string; billing_cycle: BillingCycle };

export type PlanPriceRow = {
  plan_id: string;
  price_monthly_cents: number | null;
  price_quarterly_cents: number | null;
  price_yearly_cents: number | null;
};

export type AddonPrice = { id: string; price_cents: number; billing_cycle: BillingCycle };

export type AddonCatalogStats = {
  /** Live attachments on revenue-bearing subscriptions. */
  attached: number;
  tenants: number;
  addonMrrCents: number;
  planMrrCents: number;
  /** addon / (plan + addon), 0..1; null when there is no MRR at all. */
  shareOfTotal: number | null;
  /** Per add-on: live attachments the billing run still invoices (any status but cancelled). */
  billedByAddon: Record<string, number>;
};

/**
 * The catalog figures.
 *
 * `attachments` are live (detached_at is null) on subscriptions that are not cancelled — the rows the
 * billing run invoices. The Attached tile and add-on MRR narrow that to REVENUE_STATUSES, so a trial
 * or a paused subscription counts towards the price lock but not towards revenue. An add-on whose
 * cycle no longer matches its subscription is skipped by the invoice (lib/billing/lines.ts), so it
 * is not revenue either.
 */
export function computeCatalogStats(input: {
  attachments: LiveAttachment[];
  subscriptions: RevenueSubscription[];
  planPrices: PlanPriceRow[];
  addons: AddonPrice[];
}): AddonCatalogStats {
  const revenue = new Set<string>(REVENUE_STATUSES);
  const addonById = new Map(input.addons.map((addon) => [addon.id, addon]));
  const billedByAddon: Record<string, number> = {};
  const tenants = new Set<string>();
  let attached = 0;
  let addonMrrCents = 0;

  for (const row of input.attachments) {
    if (row.status === "cancelled") continue;
    billedByAddon[row.addon_id] = (billedByAddon[row.addon_id] ?? 0) + 1;
    if (!revenue.has(row.status)) continue;
    attached += 1;
    tenants.add(row.tenant_id);
    const addon = addonById.get(row.addon_id);
    if (addon && addon.billing_cycle === row.billing_cycle) {
      addonMrrCents += monthlyEquivalent(addon.price_cents, addon.billing_cycle);
    }
  }

  const prices = new Map(input.planPrices.map((row) => [row.plan_id, row]));
  let planMrrCents = 0;
  for (const sub of input.subscriptions) {
    const row = prices.get(sub.plan_id);
    if (!row) continue;
    const cents =
      sub.billing_cycle === "monthly"
        ? row.price_monthly_cents
        : sub.billing_cycle === "quarterly"
          ? row.price_quarterly_cents
          : row.price_yearly_cents;
    planMrrCents += monthlyEquivalent(cents ?? 0, sub.billing_cycle);
  }

  const total = planMrrCents + addonMrrCents;
  return {
    attached,
    tenants: tenants.size,
    addonMrrCents,
    planMrrCents,
    shareOfTotal: total > 0 ? addonMrrCents / total : null,
    billedByAddon,
  };
}

/** "7.6%" — one decimal, and "<0.1%" rather than a misleading "0.0%" for a real, tiny share. */
export function formatShare(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}
