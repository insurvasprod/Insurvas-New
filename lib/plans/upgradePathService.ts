import "server-only";

import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { upgradePathFor, type CataloguePlan, type UpgradePath } from "./upgradePath";

/**
 * The public plan catalogue, as the upgrade prompt needs it: order, features, seats, and the
 * features' own labels. Public plans only — the same ones /pricing shows — so the prompt never
 * names a private or archived plan. Memoised per request.
 */
const publicCatalogue = cache(async (): Promise<{ plans: CataloguePlan[]; labels: Map<string, string> }> => {
  const db = getSupabaseServiceClient();
  const { data: rows, error } = await db
    .from("admin_plan_list")
    .select("id, code, name, sort_order")
    .eq("is_public", true)
    .eq("is_archived", false)
    .order("sort_order");
  if (error) throw new Error(`Could not load public plans: ${error.message}`);
  const plans = (rows ?? []).filter((row): row is { id: string; code: string; name: string; sort_order: number | null } => Boolean(row.id && row.code && row.name));
  const ids = plans.map((row) => row.id);
  const [features, limits, labels] = await Promise.all([
    ids.length ? db.from("plan_features").select("plan_id, feature_key").in("plan_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? db.from("plan_limits").select("plan_id, max_seats").in("plan_id", ids) : Promise.resolve({ data: [], error: null }),
    db.from("features").select("feature_key, label").eq("is_archived", false),
  ]);
  if (features.error) throw new Error(`Could not load plan features: ${features.error.message}`);
  if (limits.error) throw new Error(`Could not load plan limits: ${limits.error.message}`);
  if (labels.error) throw new Error(`Could not load feature labels: ${labels.error.message}`);

  const featuresByPlan = new Map<string, Set<string>>();
  for (const row of (features.data ?? []) as Array<{ plan_id: string; feature_key: string }>) {
    const set = featuresByPlan.get(row.plan_id) ?? new Set<string>();
    set.add(row.feature_key);
    featuresByPlan.set(row.plan_id, set);
  }
  const seatsByPlan = new Map(((limits.data ?? []) as Array<{ plan_id: string; max_seats: number | null }>).map((row) => [row.plan_id, row.max_seats]));
  return {
    plans: plans.map((row, index) => ({
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order ?? index,
      features: featuresByPlan.get(row.id) ?? new Set<string>(),
      maxSeats: seatsByPlan.get(row.id) ?? null,
    })),
    labels: new Map(((labels.data ?? []) as Array<{ feature_key: string; label: string }>).map((row) => [row.feature_key, row.label])),
  };
});

export type UpgradeOffer = UpgradePath & { addsLabels: string[]; label: (key: string) => string };

/** Null when no public plan above the current one grants the feature, or the catalogue cannot be read. */
export async function featureUpgradeOffer(featureKey: string, currentPlanCode: string | null): Promise<UpgradeOffer | null> {
  try {
    const { plans, labels } = await publicCatalogue();
    const path = upgradePathFor(plans, featureKey, currentPlanCode);
    if (!path) return null;
    const label = (key: string) => labels.get(key) ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    return { ...path, addsLabels: path.adds.map(label), label };
  } catch {
    // The prompt still stands without the offer: it names the plan the account is on.
    return null;
  }
}

export async function featureLabel(featureKey: string): Promise<string | null> {
  try {
    return (await publicCatalogue()).labels.get(featureKey) ?? null;
  } catch {
    return null;
  }
}
