// SA-3.1 · The real provider.
//
// Implements the same PaymentProvider interface the dummy providers do, minus createCharge —
// Whop hosts checkout and raises charges itself, so we never originate one. That absence is the
// honest shape of a hosted-checkout provider, not a gap.

import { WhopClient, centsToWhopAmount, extractCheckoutUrl } from "./client.ts";
import { ProviderUnsupportedError } from "../types.ts";
import type {
  CheckoutSession,
  ChargeLookup,
  CreateCheckoutSessionInput,
  PaymentProvider,
  RefundInput,
  RefundResult,
} from "../types";

/** Whop bills on an interval in days. Ours is a named cycle. */
export const BILLING_PERIOD_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

type WhopPlanResponse = Record<string, unknown> & { id?: string; product_id?: string };
type WhopPaymentResponse = { status?: string };

export class WhopProvider implements PaymentProvider {
  readonly code = "whop" as const;

  private readonly client: WhopClient;

  // Written out rather than as a constructor parameter property: Node's strip-only type removal
  // cannot compile those, and this module is loaded directly by provider.test.mjs.
  constructor(client: WhopClient) {
    this.client = client;
  }

  /**
   * Not supported, and deliberately so: Whop creates the customer when they check out, and we
   * learn their identifier from the resulting webhook. Inventing one here would create a record
   * Whop has never heard of.
   */
  async createCustomer(): Promise<never> {
    throw new ProviderUnsupportedError("whop", "createCustomer");
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const response = await this.client.request<Record<string, unknown>>(
      "POST",
      "/checkout_configurations",
      {
        plan_id: input.providerPlanId,
        // Comes back to us on the webhook, which is how the payment is attributed to a tenant.
        metadata: { tenant_id: input.tenantId, ...input.metadata },
        ...(input.returnUrl ? { redirect_url: input.returnUrl } : {}),
      },
      // Same tenant + same plan retried after a timeout must not open two checkouts.
      `checkout_${input.tenantId}_${input.providerPlanId}`,
    );

    return {
      id: typeof response.id === "string" ? response.id : "",
      url: extractCheckoutUrl(response),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const response = await this.client.request<Record<string, unknown>>(
      "POST",
      `/payments/${encodeURIComponent(input.chargeId)}/refund`,
      { partial_amount: centsToWhopAmount(input.amountCents) },
      input.idempotencyKey,
    );

    return {
      id: typeof response.id === "string" ? response.id : input.chargeId,
      status: "succeeded",
    };
  }

  async getCharge(chargeId: string): Promise<ChargeLookup> {
    const payment = await this.client.request<WhopPaymentResponse>(
      "GET",
      `/payments/${encodeURIComponent(chargeId)}`,
    );

    // Whop's own vocabulary, mapped onto ours. Anything unrecognised is "unknown" rather than
    // being guessed into "succeeded" — a wrong answer here marks an unpaid invoice paid.
    switch (payment.status) {
      case "succeeded":
      case "paid":
      case "completed":
        return { status: "succeeded" };
      case "failed":
      case "canceled":
      case "cancelled":
        return { status: "failed" };
      default:
        return { status: "unknown" };
    }
  }

  /**
   * Creates the Whop plan that sells one of our plan versions. Called lazily by the mapping layer,
   * never on a hot path.
   *
   * The metadata here is the durable half of tenant attribution: Whop includes plan metadata in
   * payment and membership webhooks, so a RENEWAL — which carries no checkout session — still
   * tells us which of our plans it belongs to.
   */
  async createPlan(input: {
    productId: string;
    accountId?: string;
    priceCents: number;
    billingCycle: string;
    ourPlanId: string;
    planCode: string;
    planVersion: number;
  }): Promise<{ whopPlanId: string; productId: string | null; purchaseUrl: string | null }> {
    const billingPeriod = BILLING_PERIOD_DAYS[input.billingCycle];
    if (!billingPeriod) throw new Error(`No Whop billing period for cycle "${input.billingCycle}"`);

    const response = await this.client.request<WhopPlanResponse>(
      "POST",
      "/plans",
      {
        product_id: input.productId,
        ...(input.accountId ? { account_id: input.accountId } : {}),
        initial_price: centsToWhopAmount(input.priceCents),
        currency: "usd",
        plan_type: "renewal",
        billing_period: billingPeriod,
        metadata: {
          insurvas_plan_id: input.ourPlanId,
          insurvas_plan_code: input.planCode,
          insurvas_plan_version: String(input.planVersion),
          insurvas_billing_cycle: input.billingCycle,
        },
      },
      // One Whop plan per (our plan version, cycle) — a retry must not create a second.
      `plan_${input.ourPlanId}_${input.billingCycle}`,
    );

    if (typeof response.id !== "string") {
      throw new Error(`Whop plan creation returned no id. Keys: ${Object.keys(response).join(", ")}`);
    }

    let purchaseUrl: string | null = null;
    try {
      purchaseUrl = extractCheckoutUrl(response);
    } catch {
      // Not every version returns one on create; the checkout session provides it either way.
    }

    return {
      whopPlanId: response.id,
      productId: typeof response.product_id === "string" ? response.product_id : null,
      purchaseUrl,
    };
  }
}
