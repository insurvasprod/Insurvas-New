import "server-only";

// Settling one of OUR pay-online invoices from Whop's payment.succeeded (billing audit, 2026-10-15).
// The matching rules live in ./providerMatch.ts (pure, tested); the money rules in the
// settle_invoice_from_provider function (20261015560000), which locks the invoice, records the
// payment idempotently on the provider charge id, and reactivates only the invoice's own
// subscription — the same path a manual bank-transfer settlement takes.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { whopAmountToCents } from "@/lib/payments/whop/client";
import type { WhopEnvelope } from "@/lib/payments/whop/events";
import { providerInvoiceRef } from "./providerMatch";

export type ProviderSettlement = {
  invoiceId: string;
  invoiceNumber: string;
  tenantId: string;
  status: string;
  paidCents: number;
  settled: boolean;
  paymentRecorded: boolean;
  subscriptionId: string | null;
  subscriptionActivated: boolean;
  /** paid_after_void | paid_twice | overpaid — money that moved and needs a human. */
  anomaly: string | null;
};

type Row = {
  invoice_id: string;
  invoice_number: string;
  tenant_id: string;
  invoice_status: string;
  paid_cents: number;
  settled: boolean;
  payment_recorded: boolean;
  subscription_id: string | null;
  subscription_activated: boolean;
  anomaly: string | null;
};

/**
 * Null when the payment names no invoice of ours (the caller treats it as a subscription payment),
 * or names one we do not have. Throws on a database failure, so the webhook asks for a retry.
 */
export async function settleInvoiceFromProviderPayment(
  envelope: WhopEnvelope,
  tenantId: string | null,
): Promise<{ matched: false; referenced: boolean } | { matched: true; settlement: ProviderSettlement }> {
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const ref = providerInvoiceRef(data);
  if (!ref) return { matched: false, referenced: false };

  const paymentId = typeof data.id === "string" ? data.id : null;
  if (!paymentId) throw new Error("payment.succeeded for an invoice carried no payment id");

  const rawTotal = data.total;
  const amountCents = typeof rawTotal === "number" || typeof rawTotal === "string" ? whopAmountToCents(rawTotal) : 0;

  const supabase = getSupabaseServiceClient();
  const { data: result, error } = await supabase.rpc("settle_invoice_from_provider" as never, {
    p_tenant_id: tenantId,
    p_local_invoice_id: ref.localInvoiceId,
    p_provider_invoice_id: ref.providerInvoiceId,
    p_provider_payment_id: paymentId,
    p_amount_cents: amountCents,
    p_paid_at: typeof data.paid_at === "string" ? data.paid_at : null,
  } as never);
  if (error) throw new Error(`Could not settle invoice for payment ${paymentId}: ${error.message}`);

  const row = (Array.isArray(result) ? result[0] : result) as Row | null | undefined;
  if (!row) return { matched: false, referenced: true };

  return {
    matched: true,
    settlement: {
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      tenantId: row.tenant_id,
      status: row.invoice_status,
      paidCents: row.paid_cents,
      settled: row.settled,
      paymentRecorded: row.payment_recorded,
      subscriptionId: row.subscription_id,
      subscriptionActivated: row.subscription_activated,
      anomaly: row.anomaly,
    },
  };
}

/**
 * Pay-online invoices sent BEFORE the marker existed carry nothing that names them. One is matched
 * only when it is unambiguous: exactly one open pay-online invoice of this tenant for exactly this
 * amount. Anything else stays unmatched rather than settling the wrong invoice.
 */
export async function settleUnmarkedInvoiceByAmount(
  envelope: WhopEnvelope,
  tenantId: string,
): Promise<ProviderSettlement | null> {
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const paymentId = typeof data.id === "string" ? data.id : null;
  const rawTotal = data.total;
  if (!paymentId || !(typeof rawTotal === "number" || typeof rawTotal === "string")) return null;
  const amountCents = whopAmountToCents(rawTotal);
  if (amountCents <= 0) return null;

  const supabase = getSupabaseServiceClient();
  const { data: candidates, error: readError } = await supabase
    .from("platform_invoices")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("status", ["issued", "overdue", "uncollectible"])
    .not("provider_invoice_id", "is", null)
    .eq("total_cents", amountCents)
    .limit(2);
  if (readError) throw new Error(`Could not look for the invoice payment ${paymentId} settles: ${readError.message}`);
  if (!candidates || candidates.length !== 1) return null;

  const { data: result, error } = await supabase.rpc("settle_invoice_from_provider" as never, {
    p_tenant_id: tenantId,
    p_local_invoice_id: candidates[0].id,
    p_provider_invoice_id: null,
    p_provider_payment_id: paymentId,
    p_amount_cents: amountCents,
    p_paid_at: typeof data.paid_at === "string" ? data.paid_at : null,
  } as never);
  if (error) throw new Error(`Could not settle invoice for payment ${paymentId}: ${error.message}`);
  const row = (Array.isArray(result) ? result[0] : result) as Row | null | undefined;
  if (!row) return null;
  return {
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    tenantId: row.tenant_id,
    status: row.invoice_status,
    paidCents: row.paid_cents,
    settled: row.settled,
    paymentRecorded: row.payment_recorded,
    subscriptionId: row.subscription_id,
    subscriptionActivated: row.subscription_activated,
    anomaly: row.anomaly,
  };
}

/**
 * A payment we can attribute to a tenant but to nothing we sell — another product on the same
 * Whop account, say. Acknowledged rather than retried for days, and still written down: the money
 * goes into `payments` with no invoice, idempotent on the charge id, so it is visible and nothing
 * about the tenant's access changes because of it.
 */
export async function recordUnmatchedPayment(envelope: WhopEnvelope, tenantId: string): Promise<void> {
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const paymentId = typeof data.id === "string" ? data.id : null;
  if (!paymentId) return;
  const rawTotal = data.total;
  const amountCents = typeof rawTotal === "number" || typeof rawTotal === "string" ? whopAmountToCents(rawTotal) : 0;

  const { error } = await getSupabaseServiceClient().from("payments").insert({
    invoice_id: null,
    tenant_id: tenantId,
    amount_cents: amountCents,
    method: "provider",
    provider: "whop",
    provider_charge_id: paymentId,
    paid_at: typeof data.paid_at === "string" ? data.paid_at : new Date().toISOString(),
    status: "succeeded",
  });
  if (error && error.code !== "23505") throw new Error(`Could not record payment ${paymentId}: ${error.message}`);
}
