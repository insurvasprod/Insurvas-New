import type { BillingCycle, PlanType } from "./constants";

export type OfferRuleSet = {
  startsAt: string | null;
  endsAt: string | null;
  eligiblePlanTypes: readonly PlanType[];
  eligiblePlanIds: readonly string[];
  newCustomersOnly: boolean;
  existingCustomersOnly: boolean;
  eligibleCycles: readonly BillingCycle[];
};

export type OfferCustomerContext = {
  planType: PlanType;
  planId: string;
  billingCycle: BillingCycle;
  isNewCustomer: boolean;
};

function contains<T>(values: readonly T[], value: T): boolean {
  return values.length === 0 || values.includes(value);
}

/** Returns every failed rule so the manual path can explain the warning before confirmation. */
export function offerEligibilityFailures(
  rules: OfferRuleSet,
  context: OfferCustomerContext,
  now: Date = new Date(),
  includeWindow = true,
): string[] {
  const failures: string[] = [];
  if (includeWindow && rules.startsAt && new Date(rules.startsAt).getTime() > now.getTime()) {
    failures.push("This offer has not started yet.");
  }
  if (includeWindow && rules.endsAt && new Date(rules.endsAt).getTime() <= now.getTime()) {
    failures.push("This offer has ended.");
  }
  if (!contains(rules.eligiblePlanTypes, context.planType)) {
    failures.push(`This offer is limited to ${rules.eligiblePlanTypes.join(", ")} plan types.`);
  }
  if (!contains(rules.eligiblePlanIds, context.planId)) {
    failures.push("This offer is limited to specific plans.");
  }
  if (rules.newCustomersOnly && !context.isNewCustomer) {
    failures.push("This offer is for new customers only.");
  }
  if (rules.existingCustomersOnly && context.isNewCustomer) {
    failures.push("This offer is for existing customers only.");
  }
  if (!contains(rules.eligibleCycles, context.billingCycle)) {
    failures.push(`This offer is limited to ${rules.eligibleCycles.join(", ")} billing.`);
  }
  return failures;
}

export function autoOfferIsEligible(
  isActive: boolean,
  rules: OfferRuleSet,
  context: OfferCustomerContext,
  now: Date = new Date(),
): boolean {
  return isActive && offerEligibilityFailures(rules, context, now).length === 0;
}

/** Manual application ignores campaign rules, but plan-type conflicts must be confirmed. */
export function manualOfferWarning(rules: OfferRuleSet, context: OfferCustomerContext): string | null {
  if (rules.eligiblePlanTypes.length === 0 || rules.eligiblePlanTypes.includes(context.planType)) return null;
  return `This offer targets ${rules.eligiblePlanTypes.join(", ")} plans, but this customer is on a ${context.planType} plan. Confirm to apply it anyway.`;
}

/**
 * The offer's own gate for a MANUAL apply (audit, 2026-10-15). The auto-apply SQL always checked the
 * offer's active flag and cap; the manual path checked only the linked coupon's, so an admin could
 * apply a paused offer, or one past its own (lower) campaign cap. Mirrors admin_apply_offer
 * (20261015610100), which decides under a row lock; this copy explains the refusal and covers a
 * deployment where that function is not live yet.
 */
export function offerApplyRefusal(offer: { is_active: boolean; max_redemptions: number | null; redeemed_count: number }):
  | { result: "inactive" | "exhausted"; message: string }
  | null {
  if (!offer.is_active) return { result: "inactive", message: "That offer is paused. Turn it back on before applying it." };
  if (offer.max_redemptions !== null && offer.redeemed_count >= offer.max_redemptions) {
    return { result: "exhausted", message: "That offer has reached its redemption limit." };
  }
  return null;
}

/**
 * What the linked coupon's cap must become when the offer's cap changes. Lowering the offer's cap
 * lowers the coupon's with it (the coupon is the offer's own, created with the same cap), so the cap
 * holds on every path that reads the coupon. Undefined = leave the coupon alone: raising or removing
 * a cap is refused earlier, and a null offer cap never loosens the coupon.
 */
export function couponCapForOfferCap(offerCap: number | null, couponCap: number | null): number | undefined {
  if (offerCap === null) return undefined;
  if (couponCap === null || offerCap < couponCap) return offerCap;
  return undefined;
}
