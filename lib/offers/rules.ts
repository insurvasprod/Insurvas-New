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
