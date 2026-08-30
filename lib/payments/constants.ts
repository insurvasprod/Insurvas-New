// SA-3.1 · Values and labels shared by the server and the admin UI.
//
// Client-safe on purpose: this file must never import `server-only`, because the provider panel is
// a client component and needs these labels. Anything that touches the database lives in
// queries.ts / registry.ts / providerCalls.ts instead.

// "whop" is the only provider in provider_settings. The dummy codes remain valid values so the
// offline test doubles still type-check, but no tenant can be assigned one.
export const PROVIDER_CODES = ["whop", "dummy_stripe", "dummy_paypal"] as const;
export type ProviderCode = (typeof PROVIDER_CODES)[number];

export function isProviderCode(value: string): value is ProviderCode {
  return (PROVIDER_CODES as readonly string[]).includes(value);
}

/**
 * Only dummy providers can be told to fail. Guarding on this now means that the day SA-4.2 adds a
 * live Stripe, nobody can point the failure simulator at a real customer's real card.
 */
export function isDummyProvider(code: string): boolean {
  return code.startsWith("dummy_");
}

/**
 * What the dummy providers can be told to do. Sticky: a tenant armed with `expired_card` fails
 * every charge until it is set back to `success`, which is what lets a tenant walk SA-3.5's
 * retry ladder (days 1, 3, 7, 10) all the way to suspended.
 */
export const SIMULATED_OUTCOMES = ["success", "insufficient_funds", "expired_card", "timeout"] as const;
export type SimulatedOutcome = (typeof SIMULATED_OUTCOMES)[number];

export const SIMULATED_OUTCOME_LABELS: Record<SimulatedOutcome, string> = {
  success: "Succeed",
  insufficient_funds: "Decline — insufficient funds",
  expired_card: "Decline — expired card",
  timeout: "Time out (no answer)",
};

export const SIMULATED_OUTCOME_HINTS: Record<SimulatedOutcome, string> = {
  success: "Normal behaviour. Charges are accepted.",
  insufficient_funds: "The provider answers, and the answer is no. Drives the dunning ladder.",
  expired_card: "The provider answers, and the answer is no. Drives the dunning ladder.",
  timeout: "The provider never answers, so we cannot know whether money moved. Tests the retry path.",
};

/** Reasons a charge can be declined. A decline is an answer; a timeout is the absence of one. */
export const FAILURE_REASONS = ["insufficient_funds", "expired_card"] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  insufficient_funds: "Insufficient funds",
  expired_card: "Expired card",
};

/** How a logged provider call ended. */
export const CALL_STATUSES = ["ok", "declined", "timeout", "error"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export type ProviderSettingRow = {
  provider: string;
  display_label: string;
  is_enabled: boolean;
  is_default: boolean;
  sort_order: number;
};

export type TenantPaymentProvider = {
  id: string;
  provider: string;
  provider_customer_id: string | null;
  payment_method_label: string | null;
  is_default: boolean;
  simulate_outcome: SimulatedOutcome;
};

export type ProviderCallRow = {
  id: string;
  ts: string;
  provider: string;
  method: string;
  status: CallStatus;
  duration_ms: number | null;
  idempotency_key: string | null;
};

/** How many recent calls the tenant panel shows. */
export const PROVIDER_CALL_PREVIEW_LIMIT = 8;
