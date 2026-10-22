// Whether checkout takes a payment (2026-10-22).
//
// "provider" (the default) is the real flow: checkout opens the payment provider's hosted page and
// the plan starts when the provider confirms. "none" is for the period before payments are wired:
// the same checkout screen, but its button starts the chosen plan at once — no provider, no card, no
// staff step — and the owner lands in their new workspace. Set CHECKOUT_PAYMENT_MODE=none in the
// environment to switch it on; remove it to go back.
//
// Plain module (no `server-only`): only server code reads the environment, and the checkout page
// passes the answer to the client as a prop.

export type CheckoutPaymentMode = "provider" | "none";

export function checkoutPaymentMode(): CheckoutPaymentMode {
  return process.env.CHECKOUT_PAYMENT_MODE?.trim().toLowerCase() === "none" ? "none" : "provider";
}
