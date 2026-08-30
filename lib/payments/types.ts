// SA-3.1 · The one interface all billing code talks to.
//
// The ticket's whole point: SA-3.2 (invoices), SA-3.4 (payments), SA-3.5 (dunning) and SA-3.8
// (refunds) call these four methods and nothing else. When real Stripe arrives it is one new class
// implementing this interface — no billing code changes, no `if (provider === "stripe")` anywhere.
//
// Type-only module: safe to import from a client component.

import type { FailureReason, ProviderCode } from "./constants";

export type CreateCustomerInput = {
  tenantId: string;
  name: string;
  email: string | null;
};

export type CreateCustomerResult = {
  /** A token reference held BY the provider. Never a card number — we store no card data at all. */
  providerCustomerId: string;
};

export type CreateChargeInput = {
  amountCents: number;
  providerCustomerId: string;
  /**
   * Required, not optional. Every real provider takes one, SA-3.4 must reject a payment recorded
   * twice, and SA-3.5 retries the same invoice up to five times. Making it optional would mean a
   * caller can forget it, and the day it matters is the day we double-charge a customer.
   */
  idempotencyKey: string;
  description?: string;
};

export type ChargeResult = {
  id: string;
  status: "succeeded" | "failed";
  /** Set only when status is "failed". A decline always carries a reason. */
  failureReason?: FailureReason;
};

export type RefundInput = {
  chargeId: string;
  amountCents: number;
  idempotencyKey: string;
};

export type RefundResult = {
  id: string;
  status: "succeeded" | "failed";
};

export type ChargeLookup = {
  /** "unknown" is a real answer: the provider has no record of it, or we cannot tell. */
  status: "succeeded" | "failed" | "unknown";
};

export interface PaymentProvider {
  readonly code: ProviderCode;
  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult>;
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  getCharge(chargeId: string): Promise<ChargeLookup>;
}

/**
 * The provider never answered.
 *
 * Deliberately an exception rather than a `status: "timeout"` result, because it is categorically
 * different from a decline. A decline means "we asked, they said no, no money moved". A timeout
 * means "we do not know whether money moved" — the charge may well have succeeded on their side.
 * Callers must handle that differently: retry with the SAME idempotency key, never with a new one.
 */
export class ProviderTimeoutError extends Error {
  readonly provider: ProviderCode;
  readonly method: string;
  readonly idempotencyKey?: string;

  constructor(provider: ProviderCode, method: string, idempotencyKey?: string) {
    super(`${provider}.${method} timed out — the outcome is unknown`);
    this.name = "ProviderTimeoutError";
    this.provider = provider;
    this.method = method;
    this.idempotencyKey = idempotencyKey;
  }
}
