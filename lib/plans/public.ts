import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PlanType } from "./constants";

export type PublicPlanOption = {
  id: string;
  code: string;
  version: number;
  name: string;
  planType: PlanType;
  description: string | null;
  prices: {
    monthly: number | null;
    quarterly: number | null;
    yearly: number | null;
    setupFee: number;
    trialDays: number;
    currency: string;
  };
};

/**
 * Public signup only receives customer-facing plan fields. The admin view also contains internal
 * subscriber counts, so this helper deliberately projects a smaller contract for the client.
 */
export async function fetchPublicPlans(): Promise<PublicPlanOption[]> {
  const supabase = getSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("admin_plan_list")
    .select("id, code, version, name, plan_type, description, is_public, is_archived, sort_order")
    .eq("is_public", true)
    .eq("is_archived", false)
    .order("sort_order");

  if (error) throw new Error(`Could not load public plans: ${error.message}`);
  const validRows = (rows ?? []).filter(
    (row): row is typeof row & { id: string; code: string; version: number; name: string } =>
      Boolean(row.id && row.code && row.version !== null && row.name),
  );
  if (!validRows.length) return [];

  const planIds = validRows.map((row) => row.id);
  const { data: prices, error: priceError } = await supabase
    .from("plan_prices")
    .select("plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days, currency")
    .in("plan_id", planIds);

  if (priceError) throw new Error(`Could not load plan prices: ${priceError.message}`);

  const priceByPlan = new Map((prices ?? []).map((price) => [price.plan_id, price]));

  return validRows.flatMap((row) => {
    const price = priceByPlan.get(row.id);
    if (!price) return [];

    return [{
      id: row.id,
      code: row.code,
      version: row.version,
      name: row.name,
      planType: row.plan_type as PlanType,
      description: row.description,
      prices: {
        monthly: price.price_monthly_cents,
        quarterly: price.price_quarterly_cents,
        yearly: price.price_yearly_cents,
        setupFee: price.setup_fee_cents,
        trialDays: price.trial_days,
        currency: price.currency,
      },
    }];
  });
}
