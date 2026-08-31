import "server-only";

import { formatCents } from "@/lib/money";
import { fetchPlans } from "@/lib/plans/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PublicPlan } from "./types";

type PriceRow = {
  plan_id: string;
  price_monthly_cents: number | null;
  price_quarterly_cents: number | null;
  price_yearly_cents: number | null;
  trial_days: number;
};

type GrantRow = { plan_id: string; feature_key: string };
type FeatureRow = { feature_key: string; label: string; sort_order: number };

/**
 * The only public plan projection. The frontend receives marketing-safe fields, never internal
 * subscriber counts, plan ids, provider ids, or archived versions.
 */
export async function fetchPublicPlans(): Promise<PublicPlan[]> {
  const latest = (await fetchPlans({ includeArchived: false })).filter((plan) => plan.is_public);
  if (latest.length === 0) return [];

  const supabase = getSupabaseServiceClient();
  const planIds = latest.map((plan) => plan.id);

  const [{ data: prices, error: priceError }, { data: grants, error: grantError }] = await Promise.all([
    supabase
      .from("plan_prices")
      .select("plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents, trial_days")
      .in("plan_id", planIds),
    supabase.from("plan_features").select("plan_id, feature_key").in("plan_id", planIds),
  ]);

  if (priceError) throw new Error(`Could not load public plan prices: ${priceError.message}`);
  if (grantError) throw new Error(`Could not load public plan features: ${grantError.message}`);

  const featureKeys = [...new Set((grants ?? []).map((grant) => grant.feature_key))];
  const featureResult = featureKeys.length
    ? await supabase
        .from("features")
        .select("feature_key, label, sort_order")
        .in("feature_key", featureKeys)
        .order("sort_order")
    : { data: [] as FeatureRow[], error: null };

  if (featureResult.error) {
    throw new Error(`Could not load public feature bullets: ${featureResult.error.message}`);
  }

  const priceByPlan = new Map((prices as PriceRow[] | null)?.map((row) => [row.plan_id, row]) ?? []);
  const featureByKey = new Map(
    ((featureResult.data ?? []) as FeatureRow[]).map((feature) => [feature.feature_key, feature]),
  );
  const grantsByPlan = new Map<string, string[]>();

  for (const grant of (grants ?? []) as GrantRow[]) {
    const feature = featureByKey.get(grant.feature_key);
    if (!feature) continue;
    const labels = grantsByPlan.get(grant.plan_id) ?? [];
    labels.push(feature.label);
    grantsByPlan.set(grant.plan_id, labels);
  }

  return latest.map((plan) => {
    const price = priceByPlan.get(plan.id);
    return {
      code: plan.code,
      name: plan.name,
      price_monthly: price?.price_monthly_cents == null ? null : formatCents(price.price_monthly_cents),
      price_quarterly:
        price?.price_quarterly_cents == null ? null : formatCents(price.price_quarterly_cents),
      price_yearly: price?.price_yearly_cents == null ? null : formatCents(price.price_yearly_cents),
      blurb: plan.description,
      feature_bullets: grantsByPlan.get(plan.id) ?? [],
      trial_days: price?.trial_days ?? 0,
      // Read, not inferred. This was `index === 0`, which silently meant "the cheapest published
      // plan" — and the plan a business wants to lead with is rarely the cheapest one.
      is_default: plan.is_default,
    };
  });
}
