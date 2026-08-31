import "server-only";

// SA-5.3 · The three things an admin can do to a trial.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";
import { priceForCycle, formatCentsAsCurrency, type PlanPrices } from "@/lib/money";

export class TrialError extends Error {}

type TrialSubscription = {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  billing_cycle: "monthly" | "quarterly" | "yearly";
  trial_ends_at: string | null;
  whop_membership_id: string | null;
};

async function loadTrial(subscriptionId: string): Promise<TrialSubscription> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, plan_id, status, billing_cycle, trial_ends_at, whop_membership_id")
    .eq("id", subscriptionId)
    .maybeSingle<TrialSubscription>();

  if (!data) throw new TrialError("That subscription does not exist.");
  if (data.status !== "trialing") {
    throw new TrialError(`This subscription is ${data.status}, not on trial.`);
  }
  return data;
}

/**
 * Extends a trial by whole days, at the provider as well as here.
 *
 * Both sides matter and for different reasons: ours decides what the customer can do and when we
 * think they will be charged, the provider's decides when the card is ACTUALLY charged. Moving
 * only ours would tell the customer they had longer while the card was charged on the old date.
 */
export async function extendTrial(subscriptionId: string, days: number): Promise<{ trialEndsAt: string }> {
  if (!Number.isInteger(days) || days <= 0 || days > 90) {
    throw new TrialError("Extend by between 1 and 90 whole days.");
  }

  const trial = await loadTrial(subscriptionId);
  const supabase = getSupabaseServiceClient();

  if (trial.whop_membership_id) {
    try {
      const provider = buildProvider("whop");
      if (provider instanceof WhopProvider) {
        await provider.addFreeDays(trial.whop_membership_id, days);
      }
    } catch (error) {
      // Refused rather than half-applied: extending our side while the provider still charges on
      // the old date is worse than the extension failing, because the customer is told one thing
      // and billed another.
      throw new TrialError(
        `The provider refused the extension, so nothing was changed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const { data, error } = await supabase.rpc("extend_trial", {
    p_subscription_id: subscriptionId,
    p_days: days,
  });

  if (error) throw new TrialError(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new TrialError("The trial was not extended.");

  return { trialEndsAt: row.trial_ends_at };
}

/**
 * Ends a trial now and charges the card already on file.
 *
 * The provider has no end-trial-and-charge endpoint, so this raises an invoice collected
 * automatically against the stored card. The resulting payment flows through the normal webhook
 * handler, which is what converts the subscription and starts the period from today — so there is
 * one path that turns money into state, not two.
 */
export async function convertTrialNow(subscriptionId: string): Promise<{ chargedCents: number }> {
  const trial = await loadTrial(subscriptionId);
  const supabase = getSupabaseServiceClient();

  const { data: prices } = await supabase
    .from("plan_prices")
    .select("*")
    .eq("plan_id", trial.plan_id)
    .maybeSingle<PlanPrices>();

  const amountCents = priceForCycle(prices, trial.billing_cycle);
  if (amountCents === null) {
    throw new TrialError("That plan has no price for this billing cycle.");
  }

  const { data: provider } = await supabase
    .from("payment_providers")
    .select("provider_customer_id")
    .eq("tenant_id", trial.tenant_id)
    .eq("is_default", true)
    .maybeSingle<{ provider_customer_id: string | null }>();

  if (!provider?.provider_customer_id) {
    throw new TrialError("No provider customer is known for this tenant, so no card can be charged.");
  }

  const companyId = process.env.WHOP_ACCOUNT_ID;
  if (!companyId) throw new TrialError("WHOP_ACCOUNT_ID is not set.");

  const whop = buildProvider("whop");
  if (!(whop instanceof WhopProvider)) throw new TrialError("Converting requires the Whop provider.");

  await whop.createInvoice({
    companyId,
    memberId: provider.provider_customer_id,
    amountCents,
    description: "Trial converted early",
    // The customer authorised this card for this subscription; asking them to enter it again to
    // pay sooner would be absurd.
    collectionMethod: "charge_automatically",
  });

  // Deliberately NOT flipping the subscription to active here. The payment webhook does that, and
  // having one path from money to state means the two can never disagree about whether it happened.
  return { chargedCents: amountCents };
}

/** Cancels a trial. Access is preserved to the end of the term the customer was promised. */
export async function cancelTrial(subscriptionId: string, reason: string): Promise<void> {
  const trial = await loadTrial(subscriptionId);
  const supabase = getSupabaseServiceClient();

  if (trial.whop_membership_id) {
    try {
      const provider = buildProvider("whop");
      if (provider instanceof WhopProvider) {
        await provider.pauseMembership(trial.whop_membership_id);
      }
    } catch (error) {
      console.error(`[trial] could not stop provider collection for ${subscriptionId}:`, error);
      throw new TrialError("The provider refused to stop collection, so the trial was not cancelled.");
    }
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq("id", subscriptionId);

  if (error) throw new TrialError(`Could not cancel the trial: ${error.message}`);

  await rebuildEntitlement(trial.tenant_id, "subscription.cancelled");
}

export function priceLabelFor(prices: PlanPrices | null, cycle: "monthly" | "quarterly" | "yearly"): string {
  const cents = priceForCycle(prices, cycle);
  return cents === null ? "—" : `${formatCentsAsCurrency(cents)} / ${cycle.replace("ly", "")}`;
}
