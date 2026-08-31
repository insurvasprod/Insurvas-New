import "server-only";

// SA-3.2 · Building an invoice from a payment that has already been collected.
//
// Whop owns billing, so an invoice is a RECONCILIATION record, not the instruction to charge. It
// is created from payment.succeeded and is born already paid: by the time we hear anything, the
// money has moved. That is why draft/issued/overdue do not appear on a renewal.
//
// The lines are computed from OUR records — the plan version, its price, its setup fee — and the
// provider's total is stored alongside rather than copied in. When the two disagree the invoice
// says `mismatched`, which is the signal that something is wrong with the integration rather than
// with the customer.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { whopAmountToCents } from "@/lib/payments/whop/client";
import { buildInvoiceLines } from "./lines";
import { fetchActiveCoupon } from "@/lib/coupons/queries";
import { discountCentsFor } from "@/lib/coupons/discount";
import { RECONCILIATION_STATES } from "./constants";
import type { InvoiceLineInput, ReconciliationState } from "./constants";
import type { WhopEnvelope } from "@/lib/payments/whop/events";

export type InvoiceCreation = {
  invoiceId: string;
  number: string;
  created: boolean;
  reconciliation: ReconciliationState;
};

const PRICE_COLUMN: Record<string, string> = {
  monthly: "price_monthly_cents",
  quarterly: "price_quarterly_cents",
  yearly: "price_yearly_cents",
};

function readString(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * The reason a payment produced no invoice.
 *
 * bugs_sa.md M3-2: this used to be a bare `null`, and the webhook treated every one of them as a
 * normal outcome — acknowledged the event, marked it processed, returned 200. That is right for a
 * dashboard test event and wrong for a real one, and the two were indistinguishable. Money could
 * be collected and never appear in the local ledger, with nothing recorded to say so.
 *
 * `unattributed` means we could not tell WHOSE payment it is, which is exactly the shape of Whop's
 * own test event: placeholder ids, no metadata. Everything else means we know a real tenant paid
 * and could not write down what for — which must never be quietly acknowledged.
 */
export type NoInvoiceReason =
  | "unattributed"
  | "missing_payment_id"
  | "plan_not_ours"
  | "plan_not_found"
  | "no_price_for_cycle";

export type InvoiceOutcome =
  | { ok: true; invoice: InvoiceCreation }
  | { ok: false; reason: NoInvoiceReason; detail: string };

/** True when the reason means "not our payment", rather than "our payment we could not record". */
export function isBenignNoInvoice(reason: NoInvoiceReason): boolean {
  return reason === "unattributed";
}

export async function createInvoiceFromPayment(
  envelope: WhopEnvelope,
  tenantId: string | null,
): Promise<InvoiceOutcome> {
  if (!tenantId) return { ok: false, reason: "unattributed", detail: "no tenant resolved from the event" };

  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const paymentId = readString(data, "id");
  if (!paymentId) return { ok: false, reason: "missing_payment_id", detail: "the event carried no payment id" };

  const planNode = data.plan as Record<string, unknown> | undefined;
  const planMetadata = planNode?.metadata as Record<string, unknown> | undefined;
  const ourPlanId = readString(planMetadata, "insurvas_plan_id");
  const billingCycle = readString(planMetadata, "insurvas_billing_cycle");

  if (!ourPlanId || !billingCycle || !PRICE_COLUMN[billingCycle]) {
    return {
      ok: false,
      reason: "plan_not_ours",
      detail: `plan metadata missing or unrecognised (plan=${ourPlanId ?? "-"}, cycle=${billingCycle ?? "-"})`,
    };
  }

  const supabase = getSupabaseServiceClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("id, name, version")
    .eq("id", ourPlanId)
    .maybeSingle<{ id: string; name: string; version: number }>();

  if (!plan) return { ok: false, reason: "plan_not_found", detail: `plan ${ourPlanId} is not in our catalog` };

  const { data: prices } = await supabase
    .from("plan_prices")
    .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents")
    .eq("plan_id", ourPlanId)
    .maybeSingle<Record<string, number | null>>();

  const priceCents = prices?.[PRICE_COLUMN[billingCycle]] ?? null;
  if (priceCents === null) {
    return { ok: false, reason: "no_price_for_cycle", detail: `plan ${ourPlanId} has no ${billingCycle} price` };
  }

  // The subscription supplies the period. Deriving one from paid_at plus a cycle length would
  // invent a period that disagrees with the subscription's own, which is worse than having none.
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, current_period_start, current_period_end")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; current_period_start: string | null; current_period_end: string | null }>();

  // subscription_create is the first payment; a setup fee belongs only there.
  const isFirstPeriod = readString(data, "billing_reason") === "subscription_create";

  const lines: InvoiceLineInput[] = buildInvoiceLines(
    {
      name: plan.name,
      version: plan.version,
      billingCycle,
      priceCents,
      setupFeeCents: prices?.setup_fee_cents ?? 0,
    },
    { isFirstPeriod },
  );

  // SA-3.6. The discount is computed from OUR coupon record rather than inferred from the gap
  // between our total and Whop's. Inferring it would make reconciliation vacuous — it would always
  // match, and a genuinely wrong discount would look correct.
  const coupon = subscription ? await fetchActiveCoupon(subscription.id) : null;
  if (coupon) {
    const discount = discountCentsFor(priceCents, {
      discountType: coupon.discount_type,
      percentOff: coupon.percent_off,
      amountOffCents: coupon.amount_off_cents,
    });
    if (discount > 0) {
      lines.push({
        kind: "discount",
        label: `Coupon ${coupon.code}`,
        quantity: 1,
        unit_cents: discount,
        amount_cents: discount,
      });
    }
  }

  const rawTotal = data.total;
  const providerTotalCents =
    typeof rawTotal === "number" || typeof rawTotal === "string" ? whopAmountToCents(rawTotal) : null;

  const { data: result, error } = await supabase.rpc("create_invoice_for_payment", {
    p_tenant_id: tenantId,
    p_subscription_id: subscription?.id ?? null,
    p_provider: "whop",
    p_provider_payment_id: paymentId,
    p_provider_total_cents: providerTotalCents,
    p_period_start: subscription?.current_period_start ?? null,
    p_period_end: subscription?.current_period_end ?? null,
    p_paid_at: readString(data, "paid_at"),
    p_lines: lines,
  });

  if (error) throw new Error(`Could not create invoice for ${paymentId}: ${error.message}`);

  const row = Array.isArray(result) ? result[0] : result;
  // The RPC returned nothing for a payment we HAVE attributed to a tenant. Never benign.
  if (!row) {
    return { ok: false, reason: "plan_not_found", detail: `create_invoice_for_payment returned no row for ${paymentId}` };
  }

  if (row.reconciliation === "mismatched") {
    // Loud on purpose. This means we billed a different amount to the one the customer was
    // actually charged, which is never acceptable to discover later from a support ticket.
    console.error(
      `[invoice] ${row.number} MISMATCH for tenant ${tenantId}: provider charged ${providerTotalCents} cents, ` +
        `our lines total ${lines.reduce((s, l) => s + l.amount_cents, 0)} cents (payment ${paymentId})`,
    );
  }

  // Consume a period only when an invoice was actually created. Doing it per delivery would burn
  // a 3-period coupon on the first invoice's three webhook retries.
  if (row.created && coupon && subscription) {
    const { error: consumeError } = await supabase.rpc("consume_coupon_period", {
      p_subscription_id: subscription.id,
    });
    if (consumeError) {
      console.error(`[invoice] could not consume a coupon period for ${subscription.id}: ${consumeError.message}`);
    }
  }

  return {
    ok: true,
    invoice: {
      invoiceId: row.invoice_id,
      number: row.number,
      created: row.created,
      // The RPC returns plain text; narrow it rather than asserting, so an unexpected value from a
      // future migration surfaces here instead of flowing on as a lie.
      reconciliation: (RECONCILIATION_STATES as readonly string[]).includes(row.reconciliation)
        ? (row.reconciliation as ReconciliationState)
        : "pending",
    },
  };
}
