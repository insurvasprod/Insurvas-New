import "server-only";

// Settings round 8 · Plan & billing A2 "Compare plans". The plans the agency can move to, side by side
// with its own: each plan's limit for every limit the agency is measured against, and the features
// that differ between them. Read straight from the plan catalogue (plans, plan_meters, plan_limits,
// plan_features); no price, proration or entitlement rule of its own — prices come from the options
// the view already priced through previewPlanChange.

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** The plan_limits columns the screen measures (LimitRow keys of the counted kind). */
const COUNTED_KEYS = ["max_seats", "max_publishers", "max_marketing_partners", "max_affiliates", "max_partner_users"] as const;

export type ComparePlan = {
  id: string;
  name: string;
  description: string | null;
  /** Each limit key the screen shows → the plan's own limit. null: unlimited. Missing key: not included. */
  limits: Record<string, number | null>;
  features: string[];
};

export type PlanComparison = {
  plans: ComparePlan[];
  /** Labels for every feature named by any plan. */
  featureLabels: Record<string, string>;
};

export async function planComparison(planIds: string[], limitKeys: string[]): Promise<PlanComparison> {
  if (!planIds.length) return { plans: [], featureLabels: {} };
  const db = getSupabaseServiceClient();
  const meterKeys = limitKeys.filter((k) => !(COUNTED_KEYS as readonly string[]).includes(k));
  const [plans, meters, limits, features] = await Promise.all([
    db.from("plans").select("id, name, description").in("id", planIds),
    meterKeys.length ? db.from("plan_meters").select("plan_id, meter_key, included_qty").in("plan_id", planIds).in("meter_key", meterKeys) : Promise.resolve({ data: [], error: null }),
    db.from("plan_limits").select("*").in("plan_id", planIds),
    db.from("plan_features").select("plan_id, feature_key").in("plan_id", planIds),
  ]);
  if (plans.error) throw new Error(`Could not read the plans: ${plans.error.message}`);

  const keys = [...new Set(((features.data ?? []) as { feature_key: string }[]).map((f) => f.feature_key))];
  const labels = keys.length ? await db.from("features").select("feature_key, label").in("feature_key", keys) : { data: [] };
  const featureLabels: Record<string, string> = {};
  for (const f of (labels.data ?? []) as { feature_key: string; label: string }[]) featureLabels[f.feature_key] = f.label;

  const byId = new Map(((plans.data ?? []) as { id: string; name: string; description: string | null }[]).map((p) => [p.id, p]));
  return {
    featureLabels,
    plans: planIds.flatMap((id) => {
      const plan = byId.get(id);
      if (!plan) return [];
      const own: Record<string, number | null> = {};
      for (const m of (meters.data ?? []) as { plan_id: string; meter_key: string; included_qty: number | null }[]) {
        if (m.plan_id === id) own[m.meter_key] = m.included_qty;
      }
      const row = ((limits.data ?? []) as Record<string, unknown>[]).find((l) => l.plan_id === id);
      for (const key of COUNTED_KEYS) {
        if (!limitKeys.includes(key)) continue;
        const value = row ? row[key] : null;
        own[key] = typeof value === "number" ? value : null;
      }
      return [{
        id,
        name: plan.name,
        description: plan.description,
        limits: own,
        features: ((features.data ?? []) as { plan_id: string; feature_key: string }[]).filter((f) => f.plan_id === id).map((f) => f.feature_key),
      }];
    }),
  };
}
