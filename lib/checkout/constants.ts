// SA-5.2 · Checkout constants. Client-safe.

/**
 * Card required at signup, not charged for 14 days.
 *
 * The ticket's stated decision: fewer signups than a no-card trial, dramatically better
 * conversion, and no dead fourteenth day where somebody has to chase everyone.
 */
export const TRIAL_DAYS = 14;

/** Where Whop sends the customer back to. Must be https — Whop rejects anything else. */
export function checkoutReturnUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/app/checkout/return`;
}

export const CHECKOUT_CANCEL_PATH = "/pricing";
