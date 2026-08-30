// SA-3.1 · The real provider.
//
// Implements the same PaymentProvider interface the dummy providers do, minus createCharge —
// Whop hosts checkout and raises charges itself, so we never originate one. That absence is the
// honest shape of a hosted-checkout provider, not a gap.

import { WhopClient, centsToWhopAmount, extractCheckoutUrl, idempotencyKey, whopAmountToCents } from "./client.ts";
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
    const body = {
      plan_id: input.providerPlanId,
      // Comes back to us on the webhook, which is how the payment is attributed to a tenant.
      metadata: { tenant_id: input.tenantId, ...input.metadata },
      // Whop refuses anything that is not https, so a local http:// return URL is dropped rather
      // than sent — otherwise every checkout in development fails with a 400 that looks like a
      // code bug. The return handler is still reachable directly for local testing.
      ...(input.returnUrl?.startsWith("https://") ? { redirect_url: input.returnUrl } : {}),
    };

    const response = await this.client.request<Record<string, unknown>>(
      "POST",
      "/checkout_configurations",
      body,
      // Same tenant + same plan retried after a timeout must not open two checkouts.
      idempotencyKey(`checkout_${input.tenantId}`, body),
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
    /** Our plan_prices.setup_fee_cents. Charged once, on top of the first period. */
    setupFeeCents?: number;
    /**
     * Free days before the first charge (SA-5.2). Lives on the PLAN, not the checkout: Whop only
     * accepts trial_period_days on a plan, and a checkout configuration takes either `plan_id` OR
     * an inline plan — so putting the trial on the checkout would mean abandoning the
     * (plan version, cycle) mapping that makes grandfathering work.
     *
     * Whop enforces one trial per user per plan, so a returning customer does not get a second.
     */
    trialDays?: number;
    billingCycle: string;
    ourPlanId: string;
    planCode: string;
    planVersion: number;
  }): Promise<{ whopPlanId: string; productId: string | null; purchaseUrl: string | null }> {
    const billingPeriod = BILLING_PERIOD_DAYS[input.billingCycle];
    if (!billingPeriod) throw new Error(`No Whop billing period for cycle "${input.billingCycle}"`);

    const body = {
        product_id: input.productId,
        ...(input.accountId ? { account_id: input.accountId } : {}),
        // renewal_price is the recurring price. initial_price is an amount charged ON TOP of the
        // first period, not the first period itself — setting both to the plan price charged $198
        // for a $99 plan in the sandbox. It maps to our setup fee, which is usually zero.
        //
        // Both fields must be present: omitting renewal_price makes Whop read the recurring price
        // as zero and reject the plan with "must be at least $1.00".
        initial_price: centsToWhopAmount(input.setupFeeCents ?? 0),
        renewal_price: centsToWhopAmount(input.priceCents),
        currency: "usd",
        plan_type: "renewal",
        billing_period: billingPeriod,
        ...(input.trialDays && input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
        metadata: {
          insurvas_plan_id: input.ourPlanId,
          insurvas_plan_code: input.planCode,
          insurvas_plan_version: String(input.planVersion),
          insurvas_billing_cycle: input.billingCycle,
        },
    };

    const response = await this.client.request<WhopPlanResponse>(
      "POST",
      "/plans",
      body,
      // One Whop plan per (our plan version, cycle) — a retry must not create a second.
      idempotencyKey(`plan_${input.ourPlanId}_${input.billingCycle}`, body),
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

  /**
   * Creates the Whop promo code that actually reduces what the card is charged (SA-3.6).
   *
   * `durationMonths` is months, not billing periods — Whop counts in months and our plans do not
   * always bill monthly, so the translation happens in lib/coupons/discount.ts before this call.
   */
  async createPromoCode(input: {
    code: string;
    companyId: string;
    discountType: "percent" | "fixed";
    /** Percent (e.g. 50) for percent, or DOLLARS off for fixed — Whop takes decimal currency. */
    amountOff: number;
    durationMonths: number;
    expiresAt?: string | null;
    maxRedemptions?: number | null;
    planIds?: string[];
  }): Promise<{ promoCodeId: string; code: string }> {
    const body: Record<string, unknown> = {
      code: input.code,
      company_id: input.companyId,
      promo_type: input.discountType === "percent" ? "percentage" : "flat_amount",
      amount_off: input.amountOff,
      base_currency: "usd",
      new_users_only: false,
      promo_duration_months: input.durationMonths,
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
      ...(input.planIds && input.planIds.length > 0 ? { plan_ids: input.planIds } : {}),
    };

    if (input.maxRedemptions && input.maxRedemptions > 0) {
      body.stock = input.maxRedemptions;
      body.unlimited_stock = false;
    } else {
      body.unlimited_stock = true;
    }

    const response = await this.client.request<Record<string, unknown>>(
      "POST",
      "/promo_codes",
      body,
      idempotencyKey(`promo_${input.code}`, body),
    );

    if (typeof response.id !== "string") {
      throw new Error(`Whop promo creation returned no id. Keys: ${Object.keys(response).join(", ")}`);
    }

    return { promoCodeId: response.id, code: input.code };
  }

  /**
   * Raises an invoice at Whop and has them send it (SA-3.7).
   *
   * `send_invoice` rather than `charge_automatically`: a custom invoice is usually a negotiated
   * amount the customer has not authorised, and charging a stored card for it is how disputes
   * start. Whop emails it and hosts the pay page.
   */
  async createInvoice(input: {
    companyId: string;
    memberId: string;
    amountCents: number;
    description: string;
    dueAt?: string | null;
    /**
     * `send_invoice` emails the customer a pay page; `charge_automatically` charges the card
     * already on file. Sending is the default because a custom invoice is usually a negotiated
     * amount the customer has not authorised — but converting a trial early IS authorised, and
     * asking them to re-enter a card they already gave us would be absurd.
     */
    collectionMethod?: "send_invoice" | "charge_automatically";
  }): Promise<{ invoiceId: string; payOnlineUrl: string | null }> {
    const body: Record<string, unknown> = {
      company_id: input.companyId,
      collection_method: input.collectionMethod ?? "send_invoice",
      member_id: input.memberId,
      // A one-off invoice is a plan with no recurrence: a price and nothing to renew.
      plan: {
        initial_price: centsToWhopAmount(input.amountCents),
        currency: "usd",
        description: input.description,
      },
      ...(input.dueAt ? { due_date: input.dueAt } : {}),
    };

    const response = await this.client.request<Record<string, unknown>>(
      "POST",
      "/invoices",
      body,
      idempotencyKey(`invoice_${input.memberId}`, body),
    );

    let payOnlineUrl: string | null = null;
    for (const key of ["pay_online_url", "hosted_invoice_url", "purchase_url"]) {
      const value = response[key];
      if (typeof value === "string" && value) {
        payOnlineUrl = value;
        break;
      }
    }

    if (typeof response.id !== "string") {
      throw new Error(`Whop invoice creation returned no id. Keys: ${Object.keys(response).join(", ")}`);
    }

    return { invoiceId: response.id, payOnlineUrl };
  }

  /**
   * Stops Whop collecting, without ending the membership.
   *
   * Verified against the sandbox: pausing flips `payment_collection_paused` to true and leaves
   * `status` as "active" with the renewal date untouched — the customer keeps access and is not
   * charged, which is exactly what manual billing needs. Note that `status` is NOT the field to
   * check; it does not move, and reading it would suggest the pause had failed.
   */
  async pauseMembership(membershipId: string): Promise<void> {
    await this.client.request("POST", `/memberships/${encodeURIComponent(membershipId)}/pause`, {});
  }

  async resumeMembership(membershipId: string): Promise<void> {
    await this.client.request("POST", `/memberships/${encodeURIComponent(membershipId)}/resume`, {});
  }

  /**
   * What the provider says is still refundable on a payment (SA-3.8).
   *
   * Asked before every refund rather than trusting our own invoice total: Whop knows what was
   * actually collected and what has already been returned, and refunding against our figure would
   * let a second refund through on a payment Whop has already partly refunded.
   */
  async getRefundability(chargeId: string): Promise<{
    refundable: boolean;
    totalCents: number;
    refundedCents: number;
    remainingCents: number;
  }> {
    const payment = await this.client.request<Record<string, unknown>>(
      "GET",
      `/payments/${encodeURIComponent(chargeId)}`,
    );

    const toCents = (value: unknown) =>
      typeof value === "number" || typeof value === "string" ? whopAmountToCents(value) : 0;

    const totalCents = toCents(payment.total);
    const refundedCents = toCents(payment.refunded_amount);

    return {
      refundable: payment.refundable === true,
      totalCents,
      refundedCents,
      remainingCents: Math.max(0, totalCents - refundedCents),
    };
  }

  /**
   * Extends a membership's billing period, which is how a credit reaches a customer whose charge
   * we cannot reduce. Whop bills the plan price regardless; days they are not billed for are worth
   * the same to them.
   */
  async addFreeDays(membershipId: string, days: number): Promise<void> {
    if (!Number.isInteger(days) || days <= 0) throw new Error(`days must be a positive integer, got ${days}`);
    await this.client.request(
      "POST",
      `/memberships/${encodeURIComponent(membershipId)}/add_free_days`,
      { days },
      idempotencyKey(`freedays_${membershipId}`, { days }),
    );
  }
}
