import type { BillingCycle } from "@/lib/money";

/**
 * One feature a plan grants, with the module it belongs to (Book of business, Acquisition, Sell, …).
 * Marketing-safe: the key, the public label and the module's label and order — nothing internal.
 */
export type PublicFeature = {
  key: string;
  label: string;
  module: string;
  moduleLabel: string;
  /** The module's display order, then the feature's: sort by these to group the way the catalog does. */
  moduleOrder: number;
  order: number;
};

export type PublicPlan = {
  code: string;
  name: string;
  price_monthly: string | null;
  price_quarterly: string | null;
  price_yearly: string | null;
  blurb: string | null;
  feature_bullets: string[];
  /** The same grants as `feature_bullets`, with their modules, in catalog order (2026-10-13). */
  features: PublicFeature[];
  trial_days: number;
  is_default: boolean;
  /**
   * Who the plan is for (2026-10-22): an individual agent, or an agency (plan_type agency_* —
   * AG-0.12's flat seat bands). The pricing page shows one audience at a time.
   */
  audience: "individual" | "agency";
  /** The plan's seat limit (plan_limits.max_seats); null when unlimited or not set. */
  max_seats: number | null;
};

/** A plan's features grouped by module, in the catalog's module order. */
export function featuresByModule(features: PublicFeature[]): { module: string; label: string; features: PublicFeature[] }[] {
  const groups = new Map<string, { module: string; label: string; order: number; features: PublicFeature[] }>();
  for (const feature of features) {
    const group = groups.get(feature.module) ?? { module: feature.module, label: feature.moduleLabel, order: feature.moduleOrder, features: [] };
    group.features.push(feature);
    groups.set(feature.module, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ module, label, features: rows }) => ({ module, label, features: [...rows].sort((a, b) => a.order - b.order) }));
}

export function publicPriceForCycle(plan: PublicPlan, cycle: BillingCycle): string | null {
  if (cycle === "monthly") return plan.price_monthly;
  if (cycle === "quarterly") return plan.price_quarterly;
  return plan.price_yearly;
}
