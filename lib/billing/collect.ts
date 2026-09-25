// Sending an invoice out for collection (backlog 27).
//
// SA-3.2 built invoicing for what Whop charges, and Whop charges the plan price and nothing else.
// Add-ons, metered overage and mid-period proration are our concepts, attached to our
// subscriptions and invisible to a Whop plan, so the decision was to bill them on a separate
// invoice each period. The period billing run has assembled that invoice since 0017; what it never
// did was send it. The row was written, `pay_online_url` stayed null, and the money was never
// asked for — which is the sense in which #27 said add-ons and overage "are not charged" even
// though an invoice existed.
//
// lib/invoices/custom.ts has done this correctly for hand-raised invoices all along. This is that
// same push, lifted out so both callers share one implementation rather than growing two that
// drift; custom.ts now delegates here.
//
// Best effort, always. If the push fails the invoice still exists and can be settled by bank
// transfer: losing the pay-online link is worth far less than losing the invoice, and a period
// billing run must not abandon the remaining tenants because one provider call timed out.
//
// Like the rest of lib/billing, the Supabase client is an argument rather than something this
// module reaches for, and nothing here imports `server-only` — that is what lets
// scripts/run-period-billing.mjs send invoices through the identical code path the app uses.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
// Relative, with explicit .ts extensions, for the same reason gather.ts gives: these are VALUE
// imports, and scripts/run-period-billing.mjs loads this module under plain Node, which will
// neither guess an extension nor understand the "@/" alias. lib/payments/whop/provider.ts already
// imports its own dependencies this way, so the whole chain resolves.
import { WhopProvider } from "../payments/whop/provider.ts";
import { WhopClient } from "../payments/whop/client.ts";

type Db = SupabaseClient<Database>;

export type CollectionOutcome = {
  /** The hosted page the customer can pay on, when the provider gave us one. */
  payOnlineUrl: string | null;
  /** The provider's own id for the invoice, stored so the two can be reconciled later. */
  providerInvoiceId: string | null;
  /** Set when the invoice exists locally but could not be sent. Never fatal. */
  warning: string | null;
};

/**
 * Push one already-created invoice to the payment provider and record what came back.
 *
 * Returns a warning rather than throwing for every condition a run can survive — no provider
 * customer, no configured account, a failed call — because all three mean "this invoice is
 * collectable by bank transfer" and none of them mean "stop billing".
 */
export async function sendInvoiceForCollection(
  supabase: Db,
  input: { invoiceId: string; tenantId: string; amountCents: number; description: string; dueAt?: string | null },
): Promise<CollectionOutcome> {
  const none = (warning: string): CollectionOutcome => ({ payOnlineUrl: null, providerInvoiceId: null, warning });

  if (input.amountCents <= 0) {
    return none("The invoice totals nothing, so there was nothing to collect.");
  }

  const { data: provider, error: providerError } = await supabase
    .from("payment_providers")
    .select("provider_customer_id")
    .eq("tenant_id", input.tenantId)
    .eq("is_default", true)
    .maybeSingle<{ provider_customer_id: string | null }>();

  // Read explicitly rather than destructuring `data` alone. A discarded error here would be
  // indistinguishable from "this tenant has no provider", and the invoice would be quietly filed
  // as uncollectable when the truth was a broken query.
  if (providerError) {
    return none(`The tenant's payment provider could not be read: ${providerError.message}`);
  }

  const memberId = provider?.provider_customer_id ?? null;
  const companyId = process.env.WHOP_ACCOUNT_ID;
  const apiKey = process.env.WHOP_API_KEY;

  if (!memberId) {
    return none("No provider customer is known for this tenant yet, so there is no pay-online link. It can still be settled by bank transfer.");
  }
  if (!companyId) {
    return none("WHOP_ACCOUNT_ID is not set, so the invoice was not sent for online payment.");
  }
  if (!apiKey) {
    return none("WHOP_API_KEY is not set, so the invoice was not sent for online payment.");
  }

  try {
    // Constructed the same way lib/payments/registry.ts builds its `whop` case. The registry
    // itself is `server-only` and so cannot be imported by the billing job, which is the one
    // caller that most needs to send invoices.
    const whop = new WhopProvider(
      new WhopClient({
        apiKey,
        baseUrl: process.env.WHOP_API_BASE_URL ?? "https://api.whop.com/api/v1",
        tenantId: input.tenantId,
      }),
    );

    const sent = await whop.createInvoice({
      companyId,
      memberId,
      amountCents: input.amountCents,
      description: input.description,
      dueAt: input.dueAt ?? null,
      // send_invoice, not charge_automatically. A period invoice for overage and add-ons is an
      // amount the customer has not seen before; charging a stored card for it is how disputes
      // start, and Whop emails a hosted pay page instead.
      collectionMethod: "send_invoice",
    });

    const { error: storeError } = await supabase
      .from("platform_invoices")
      .update({ provider_invoice_id: sent.invoiceId, pay_online_url: sent.payOnlineUrl })
      .eq("id", input.invoiceId);

    if (storeError) {
      // The customer can pay; we just cannot show the link. Worth saying out loud, because the
      // next reconciliation will find a provider invoice we have no record of sending.
      return {
        payOnlineUrl: sent.payOnlineUrl,
        providerInvoiceId: sent.invoiceId,
        warning: `The invoice was sent as ${sent.invoiceId} but the link could not be stored: ${storeError.message}`,
      };
    }

    return { payOnlineUrl: sent.payOnlineUrl, providerInvoiceId: sent.invoiceId, warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[collect] invoice ${input.invoiceId} created locally but not sent: ${message}`);
    return none(`The invoice was created but could not be sent for online payment: ${message}`);
  }
}
