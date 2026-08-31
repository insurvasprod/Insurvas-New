import "server-only";

// Settling a mid-period plan change (SA-3.4, backlog #41).
//
// The decision the ticket recorded, and what each half means:
//
//   switch our side now          the customer gets what they just paid to get, immediately
//   stop the Whop membership     Whop cannot change a membership's plan, so the old one runs to
//     renewing                   the end of the period it was paid for and stops there
//   charge the difference        the remainder of the current period is priced by us, because no
//     ourselves                  provider is going to do it
//
// Only the arithmetic existed. `prorate()` produced the ticket's worked example to the cent and
// nothing called it, so changing a plan moved our side, left Whop billing the old plan, and
// charged nobody the difference. This is the missing caller.
//
// The difference does NOT become an invoice today. It becomes a pending charge, collected on the
// customer's next invoice at the period rollover — one bill instead of two, and it costs nothing
// to wait because we have already given them the upgrade.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
import { prorate, daysElapsedBetween, periodLengthInDays } from "@/lib/subscriptions/proration";
import { priceForCycle, type BillingCycle, type PlanPrices } from "@/lib/money";

export type ProrationOutcome = {
  /** Null when there was nothing to prorate — see `note`. */
  netCents: number | null;
  creditCents: number;
  chargeCents: number;
  remainingDays: number;
  pendingChargeIds: string[];
  /** Set when the provider membership could not be scheduled to stop renewing. */
  providerWarning: string | null;
  note: string | null;
};

type SubscriptionForProration = {
  id: string;
  tenant_id: string;
  billing_cycle: BillingCycle;
  current_period_start: string | null;
  current_period_end: string | null;
  whop_membership_id: string | null;
};

async function priceOf(planId: string, cycle: BillingCycle): Promise<number | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("plan_prices")
    .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents")
    .eq("plan_id", planId)
    .maybeSingle<PlanPrices>();
  return data ? priceForCycle(data, cycle) : null;
}

async function planName(planId: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("plans").select("name").eq("id", planId).maybeSingle<{ name: string }>();
  return data?.name ?? "plan";
}

/**
 * Prorate an immediate plan change and park the difference.
 *
 * Returns rather than throws on every recoverable condition. The plan change itself has already
 * been committed by the time this runs, and throwing here would leave a customer moved to a new
 * plan with an error on screen and no idea whether it worked.
 */
export async function settleMidPeriodPlanChange(input: {
  subscriptionId: string;
  fromPlanId: string;
  toPlanId: string;
  at?: Date;
  createdBy?: string | null;
}): Promise<ProrationOutcome> {
  const supabase = getSupabaseServiceClient();
  const at = input.at ?? new Date();

  const empty: ProrationOutcome = {
    netCents: null, creditCents: 0, chargeCents: 0, remainingDays: 0,
    pendingChargeIds: [], providerWarning: null, note: null,
  };

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, billing_cycle, current_period_start, current_period_end, whop_membership_id")
    .eq("id", input.subscriptionId)
    .maybeSingle<SubscriptionForProration>();

  if (!subscription) return { ...empty, note: "Subscription not found." };
  if (!subscription.current_period_start || !subscription.current_period_end) {
    return { ...empty, note: "This subscription has no billing period, so there is nothing to prorate." };
  }

  const cycle = subscription.billing_cycle;
  const [oldPriceCents, newPriceCents] = await Promise.all([
    priceOf(input.fromPlanId, cycle),
    priceOf(input.toPlanId, cycle),
  ]);

  if (oldPriceCents === null || newPriceCents === null) {
    return { ...empty, note: "One of the plans is not priced on this billing cycle, so no proration was raised." };
  }

  const periodStart = new Date(subscription.current_period_start);
  const periodEnd = new Date(subscription.current_period_end);
  const proration = prorate({
    oldPriceCents,
    newPriceCents,
    periodDays: periodLengthInDays(periodStart, periodEnd),
    daysElapsed: daysElapsedBetween(periodStart, at),
  });

  if (proration.remainingDays === 0) {
    return { ...empty, note: "The period has no days left, so the new plan simply starts next period." };
  }

  // A downgrade is not refunded. The ticket is explicit: the customer keeps the better plan for
  // the days they paid for, and the cheaper one starts at the period boundary. Raising a negative
  // charge here would be refunding value they are still receiving.
  if (proration.netCents <= 0) {
    return {
      ...proration,
      pendingChargeIds: [],
      providerWarning: null,
      note: "A downgrade is not refunded mid-period; the new price applies from the next period.",
    };
  }

  const [fromName, toName] = await Promise.all([planName(input.fromPlanId), planName(input.toPlanId)]);
  const days = proration.remainingDays;

  // Two rows, not one. A single "plan change: $122.58" line is something a customer can only
  // accept or dispute; two lines showing $152.61 credited and $275.19 charged is something they
  // can check.
  const rows = [
    {
      tenant_id: subscription.tenant_id,
      subscription_id: subscription.id,
      kind: "credit" as const,
      label: `${fromName} — ${days} unused day${days === 1 ? "" : "s"} credited`,
      quantity: days,
      unit_cents: Math.round(proration.creditCents / days),
      amount_cents: proration.creditCents,
      reason: `Mid-period change from ${fromName} to ${toName}`,
      created_by: input.createdBy ?? null,
    },
    {
      tenant_id: subscription.tenant_id,
      subscription_id: subscription.id,
      kind: "plan" as const,
      label: `${toName} — ${days} day${days === 1 ? "" : "s"} for the rest of the period`,
      quantity: days,
      unit_cents: Math.round(proration.chargeCents / days),
      amount_cents: proration.chargeCents,
      reason: `Mid-period change from ${fromName} to ${toName}`,
      created_by: input.createdBy ?? null,
    },
  ];

  const { data: inserted, error } = await supabase.from("pending_charges").insert(rows).select("id");
  if (error) {
    return { ...proration, pendingChargeIds: [], providerWarning: null, note: `The proration could not be recorded: ${error.message}` };
  }

  // Stop the old membership renewing. Best effort and reported, never fatal: the customer is
  // already on the new plan our side, and an unscheduled membership renews at the old price, which
  // is a discrepancy to fix rather than a reason to fail the whole change.
  let providerWarning: string | null = null;
  if (!subscription.whop_membership_id) {
    providerWarning = "No provider membership is known, so the old plan was not stopped from renewing.";
  } else {
    try {
      const provider = buildProvider("whop");
      if (provider instanceof WhopProvider) {
        await provider.setCancelAtPeriodEnd(subscription.whop_membership_id, true);
      }
    } catch (e) {
      providerWarning = `The old membership could not be stopped from renewing: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return {
    ...proration,
    pendingChargeIds: (inserted ?? []).map((r) => r.id as string),
    providerWarning,
    note: null,
  };
}
