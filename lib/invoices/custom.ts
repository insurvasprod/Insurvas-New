import "server-only";

// SA-3.7 · Invoices raised by hand.
//
// The number comes from the same sequence as an automatic invoice, so the run stays gap-free when
// the two kinds interleave. Unlike an invoice generated from a collected payment, a custom one is
// born ISSUED — nobody has paid it yet, which makes this the only path that produces an unpaid
// invoice and therefore the first thing to exercise overdue, void and manual settlement.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { sendInvoiceForCollection } from "@/lib/billing/collect";
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

  // Pushing it to Whop is best effort, and is the same push the period billing run uses — one
  // implementation, in lib/billing/collect.ts, so a fix to either caller reaches both. It used to
  // live here alone, which is why hand-raised invoices were collectable and period invoices were
  // not — the same code, missing from the one path that runs unattended.
  const sent = await sendInvoiceForCollection(supabase, {
    invoiceId: row.invoice_id,
    tenantId: input.tenantId,
    amountCents: row.total_cents,
    description: input.reason,
    dueAt: input.dueAt,
  });

  return {
    invoiceId: row.invoice_id,
    number: row.number,
    totalCents: row.total_cents,
    payOnlineUrl: sent.payOnlineUrl,
    sendWarning: sent.warning,
  };
}
