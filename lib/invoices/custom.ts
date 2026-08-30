import "server-only";

// SA-3.7 · Invoices raised by hand.
//
// The number comes from the same sequence as an automatic invoice, so the run stays gap-free when
// the two kinds interleave. Unlike an invoice generated from a collected payment, a custom one is
// born ISSUED — nobody has paid it yet, which makes this the only path that produces an unpaid
// invoice and therefore the first thing to exercise overdue, void and manual settlement.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
import type { InvoiceLineInput } from "./constants";

export type CustomInvoiceInput = {
  tenantId: string;
  subscriptionId: string | null;
  reason: string;
  dueAt: string | null;
  lines: InvoiceLineInput[];
  createdBy: string;
};

export type CustomInvoiceResult = {
  invoiceId: string;
  number: string;
  totalCents: number;
  payOnlineUrl: string | null;
  /** Set when the invoice exists locally but could not be sent for online payment. */
  sendWarning: string | null;
};

export async function createCustomInvoice(input: CustomInvoiceInput): Promise<CustomInvoiceResult> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase.rpc("create_custom_invoice", {
    p_tenant_id: input.tenantId,
    p_subscription_id: input.subscriptionId,
    p_reason: input.reason,
    p_due_at: input.dueAt,
    p_created_by: input.createdBy,
    p_lines: input.lines,
  });

  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The invoice was not created");

  // Pushing it to Whop is best effort. If it fails the invoice still exists and can be settled by
  // bank transfer — losing the pay-online link is worth far less than losing the invoice.
  let payOnlineUrl: string | null = null;
  let sendWarning: string | null = null;

  const { data: provider } = await supabase
    .from("payment_providers")
    .select("provider_customer_id")
    .eq("tenant_id", input.tenantId)
    .eq("is_default", true)
    .maybeSingle<{ provider_customer_id: string | null }>();

  const memberId = provider?.provider_customer_id ?? null;
  const companyId = process.env.WHOP_ACCOUNT_ID;

  if (!memberId) {
    sendWarning =
      "No provider customer is known for this tenant yet, so there is no pay-online link. It can still be settled by bank transfer.";
  } else if (!companyId) {
    sendWarning = "WHOP_ACCOUNT_ID is not set, so the invoice was not sent for online payment.";
  } else {
    try {
      const whop = buildProvider("whop");
      if (whop instanceof WhopProvider) {
        const sent = await whop.createInvoice({
          companyId,
          memberId,
          amountCents: row.total_cents,
          description: input.reason,
          dueAt: input.dueAt,
        });
        payOnlineUrl = sent.payOnlineUrl;
        await supabase
          .from("invoices")
          .update({ provider_invoice_id: sent.invoiceId, pay_online_url: sent.payOnlineUrl })
          .eq("id", row.invoice_id);
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      console.error(`[custom-invoice] ${row.number} created locally but not sent: ${message}`);
      sendWarning = `The invoice was created but could not be sent for online payment: ${message}`;
    }
  }

  return {
    invoiceId: row.invoice_id,
    number: row.number,
    totalCents: row.total_cents,
    payOnlineUrl,
    sendWarning,
  };
}
