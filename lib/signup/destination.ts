/**
 * Where a sign-up stands, as a page. The one router for every sign-up state: sign-in, the funnel's
 * "Continue", workspace switching and the onboarding status call all ask it.
 *
 * Payment comes before the business profile (manager review, 2026-10-28; migration
 * 20261028200000): a verified owner goes to the plan, then payment. The profile ("About you") is
 * asked after payment, so no state here routes to it.
 *
 * Kept free of server imports so it can be unit-tested.
 */
export function signupDestination(context: { userStatus: string; onboardingState: string }): string | null {
  if (context.userStatus === "pending_verification") return "/app/verify-email";
  if (context.userStatus !== "active") return null;
  // ready_for_checkout, and the old pre-payment state a row written before 20261028200000 may hold.
  if (context.onboardingState === "ready_for_checkout" || context.onboardingState === "business_profile") return "/app/onboarding/plan";
  // SA-5.2: a customer who opened checkout and abandoned it comes back to the same place rather
  // than being stranded — "recoverable by returning, not a broken half-account".
  if (context.onboardingState === "awaiting_payment") return "/app/checkout";
  return null;
}

/** States in which the business profile may be saved: before payment, during it, and after it (the first-login gate). */
export const PROFILE_EDITABLE_STATES = ["business_profile", "ready_for_checkout", "awaiting_payment", "completed"] as const;

/**
 * States in which the plan can be chosen or changed: verified, not yet paid. 'business_profile' is the
 * old pre-payment state; until 20261028200000 is applied a verified owner still sits in it, and the plan
 * step must take them rather than bounce them back to itself.
 */
export const PLAN_CHOOSABLE_STATES = ["business_profile", "ready_for_checkout", "awaiting_payment"] as const;

/**
 * Where an owner goes once the plan is on, paid or not: "About you", the last sign-up step (manager
 * review, 2026-10-28: payment first, the business questions after). The page forwards to the
 * dashboard when the profile is already saved, so an owner who filled it before paying is not asked twice.
 */
export const AFTER_PAYMENT = "/app/onboarding/business-profile";
