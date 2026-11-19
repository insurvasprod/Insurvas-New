// Who qualifies for an offer right now, and which other offers they also qualify for (admin round 1, billing-r2
// screen 9). Pure and client-safe: the offer sheet computes it from the subscriptions the page already reads, with
// the same rule the auto-apply path uses (rules.ts autoOfferIsEligible), so "qualifies" here means what the platform
// would decide.

import { autoOfferIsEligible, type OfferCustomerContext, type OfferRuleSet } from "./rules.ts";
import type { BillingCycle, PlanType } from "./constants.ts";

export type OfferCustomer = OfferCustomerContext & {
  subscriptionId: string;
  tenantId: string;
  tenantName: string | null;
  planName: string | null;
};

export type QualifyingOffer = {
  id: string;
  name: string;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redeemed_count: number;
  eligible_plan_types: readonly PlanType[];
  eligible_plan_ids: readonly string[];
  new_customers_only: boolean;
  existing_customers_only: boolean;
  eligible_cycles: readonly BillingCycle[];
};

export function rulesOf(offer: QualifyingOffer): OfferRuleSet {
  return {
    startsAt: offer.starts_at,
    endsAt: offer.ends_at,
    eligiblePlanTypes: offer.eligible_plan_types,
    eligiblePlanIds: offer.eligible_plan_ids,
    newCustomersOnly: offer.new_customers_only,
    existingCustomersOnly: offer.existing_customers_only,
    eligibleCycles: offer.eligible_cycles,
  };
}

/** Qualifies now: switched on, inside its window, under its cap, and every rule met. */
export function qualifiesNow(offer: QualifyingOffer, customer: OfferCustomerContext, now: Date): boolean {
  if (offer.max_redemptions !== null && offer.redeemed_count >= offer.max_redemptions) return false;
  return autoOfferIsEligible(offer.is_active, rulesOf(offer), customer, now);
}

/**
 * The customers who qualify for `offer` now, each with the names of the other offers they also qualify for, the
 * customers with an overlap first.
 */
export function whoQualifies<O extends QualifyingOffer>(
  offer: O,
  others: readonly O[],
  customers: readonly OfferCustomer[],
  now: Date,
): Array<{ customer: OfferCustomer; alsoQualifiesFor: string[] }> {
  const rest = others.filter((other) => other.id !== offer.id);
  return customers
    .filter((customer) => qualifiesNow(offer, customer, now))
    .map((customer) => ({ customer, alsoQualifiesFor: rest.filter((other) => qualifiesNow(other, customer, now)).map((other) => other.name) }))
    .sort((a, b) => b.alsoQualifiesFor.length - a.alsoQualifiesFor.length || (a.customer.tenantName ?? "").localeCompare(b.customer.tenantName ?? ""));
}

/**
 * Each subscription's offer context. A customer is new when its tenant has no subscription that started before this
 * one (the manual-apply path asks the same of created_at; started_at is what the list carries).
 */
export function customerContexts(
  subscriptions: ReadonlyArray<{ id: string; tenant_id: string; tenant_name: string | null; plan_id: string; plan_name: string | null; billing_cycle: BillingCycle; status: string; started_at: string }>,
  planTypeOf: (planId: string) => PlanType | undefined,
): OfferCustomer[] {
  const earliest = new Map<string, string>();
  for (const s of subscriptions) {
    const seen = earliest.get(s.tenant_id);
    if (!seen || s.started_at < seen) earliest.set(s.tenant_id, s.started_at);
  }
  const out: OfferCustomer[] = [];
  for (const s of subscriptions) {
    if (s.status === "cancelled") continue;
    const planType = planTypeOf(s.plan_id);
    if (!planType) continue;
    out.push({
      subscriptionId: s.id,
      tenantId: s.tenant_id,
      tenantName: s.tenant_name,
      planName: s.plan_name,
      planType,
      planId: s.plan_id,
      billingCycle: s.billing_cycle,
      isNewCustomer: (earliest.get(s.tenant_id) ?? s.started_at) >= s.started_at,
    });
  }
  return out;
}
