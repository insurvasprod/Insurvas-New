import "server-only";

// SA-3.1 · Mapping one of OUR plan versions onto the Whop plan that sells it.
//
// Created lazily on first checkout, then never rewritten. One Whop plan per (plan version, cycle)
// is what keeps grandfathering intact through the integration: a customer who bought Plan B v3
// stays on the Whop plan that IS Plan B v3, exactly as they stay on our version 3.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "../registry";
import { WhopProvider } from "./provider";
import type { BillingCycle } from "@/lib/money";

const PRICE_COLUMN: Record<BillingCycle, "price_monthly_cents" | "price_quarterly_cents" | "price_yearly_cents"> = {
  monthly: "price_monthly_cents",
  quarterly: "price_quarterly_cents",
  yearly: "price_yearly_cents",
};

export type WhopPlanMapping = {
  whopPlanId: string;
  priceCents: number;
  /** True when the price on our side has moved since the Whop plan was created. */
  priceDrifted: boolean;
};

/**
 * Returns the Whop plan id for one of our plan versions on one billing cycle, creating it if this
 * is the first time anyone has bought it.
 */
export async function ensureWhopPlan(
  planId: string,
  billingCycle: BillingCycle,
): Promise<WhopPlanMapping> {
  const supabase = getSupabaseServiceClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("id, code, version, name, is_archived")
    .eq("id", planId)
    .maybeSingle<{ id: string; code: string; version: number; name: string; is_archived: boolean }>();

  if (!plan) throw new Error(`No plan ${planId}`);

  const { data: prices } = await supabase
    .from("plan_prices")
    .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents")
    .eq("plan_id", planId)
    .maybeSingle<Record<string, number | null>>();

  const priceCents = prices?.[PRICE_COLUMN[billingCycle]] ?? null;
  // Null means this cycle is not offered — distinct from zero, which is a free plan that can still
  // be bought. Selling a cycle the plan does not price would invent a price.
  if (priceCents === null) {
    throw new Error(`Plan ${plan.code} v${plan.version} does not offer ${billingCycle} billing`);
  }

  const { data: existing } = await supabase
    .from("whop_plans")
    .select("whop_plan_id, price_cents")
    .eq("plan_id", planId)
    .eq("billing_cycle", billingCycle)
    .maybeSingle<{ whop_plan_id: string; price_cents: number }>();

  if (existing) {
    return {
      whopPlanId: existing.whop_plan_id,
      priceCents: existing.price_cents,
      // Our versioning is supposed to make this impossible — a price change should create a new
      // version. If it happens anyway, say so rather than quietly selling at the old price.
      priceDrifted: existing.price_cents !== priceCents,
    };
  }

  const productId = process.env.WHOP_PRODUCT_ID;
  if (!productId) {
    throw new Error("WHOP_PRODUCT_ID is not set — create a product in the Whop dashboard first");
  }

  const provider = buildProvider("whop");
  if (!(provider instanceof WhopProvider)) {
    throw new Error("Plan mapping requires the Whop provider");
  }

  const created = await provider.createPlan({
    productId,
    accountId: process.env.WHOP_ACCOUNT_ID,
    priceCents,
    billingCycle,
    ourPlanId: plan.id,
    planCode: plan.code,
    planVersion: plan.version,
  });

  const { error } = await supabase.from("whop_plans").insert({
    plan_id: planId,
    billing_cycle: billingCycle,
    whop_plan_id: created.whopPlanId,
    whop_product_id: created.productId,
    price_cents: priceCents,
  });

  // 23505: another request created the mapping while this one was talking to Whop. The unique
  // constraint is doing its job; re-read rather than fail, and let the orphaned Whop plan be —
  // deleting it here could remove the one the other request is already selling.
  if (error && error.code === "23505") {
    const { data: raced } = await supabase
      .from("whop_plans")
      .select("whop_plan_id, price_cents")
      .eq("plan_id", planId)
      .eq("billing_cycle", billingCycle)
      .single<{ whop_plan_id: string; price_cents: number }>();

    if (!raced) throw new Error("Whop plan mapping conflicted but could not be read back");
    return { whopPlanId: raced.whop_plan_id, priceCents: raced.price_cents, priceDrifted: false };
  }

  if (error) throw new Error(`Could not record the Whop plan mapping: ${error.message}`);

  return { whopPlanId: created.whopPlanId, priceCents, priceDrifted: false };
}
