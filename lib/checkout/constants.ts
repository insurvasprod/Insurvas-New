// SA-5.2 · Checkout constants. Client-safe.

/**
 * The last-resort trial length (see resolveTrialDays): card required at signup, not charged for 14 days.
 *
 * The ticket's stated decision: fewer signups than a no-card trial, dramatically better
 * conversion, and no dead fourteenth day where somebody has to chase everyone.
 */
export const TRIAL_DAYS = 14;

/**
 * The trial a checkout actually grants (audit, 2026-10-15). TRIAL_DAYS used to be applied to every
 * plan while plan_prices.trial_days was ignored. Order: the plan version's own trial_days, then the
 * platform setting billing.default_trial_days, then TRIAL_DAYS. Zero is a real answer (no trial),
 * not a missing one; anything that is not a whole number in 0–365 is treated as missing.
 */
export function resolveTrialDays(planTrialDays: unknown, settingTrialDays?: unknown): number {
  const usable = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 365;
  if (usable(planTrialDays)) return planTrialDays;
  if (usable(settingTrialDays)) return settingTrialDays;
  return TRIAL_DAYS;
}

/** Where Whop sends the customer back to. Must be https — Whop rejects anything else. */
export function checkoutReturnUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/app/checkout/return`;
}

export const CHECKOUT_CANCEL_PATH = "/pricing";
