import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ReconExplanation, ReconInvoice, ReconLine, ReconPayment } from "./reconcile";

/**
 * The reads behind Admin › Billing › Reconciliation (billing-r2 screen 7). Three sources, each checked:
 *
 *   mismatched invoices   platform_invoices.reconciliation = 'mismatched' (the invoices list's own lens), with
 *                         their lines and discount for the likely reason;
 *   provider-only charges succeeded provider payments that no invoice of ours accounts for (invoice_id null);
 *   explanations          billing_reconciliation_explanations (migration 20261117452000). Until it is applied the
 *                         page still lists and settles by credit note or payment, and says "explained" needs a
 *                         database update instead of failing.
 */

// The explanations table and webhook_events are not in the generated types; untyped here only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = () => getSupabaseServiceClient() as any;

type DbError = { code?: string; message?: string } | null | undefined;
export function isMissingRelation(error: DbError): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

export const EXPLANATIONS_TABLE = "billing_reconciliation_explanations";

export type ReconciliationData = {
  invoices: ReconInvoice[];
  payments: ReconPayment[];
  explanations: ReconExplanation[];
  /** False until the explanations migration is applied. */
  explanationsReady: boolean;
  totalInvoices: number;
  /** Payment events from the provider that were never processed (or failed processing). */
  unprocessedPaymentEvents: number | null;
};

type RawInvoice = Omit<ReconInvoice, "tenant_name" | "lines"> & { tenants: { name: string } | null; platform_invoice_lines: ReconLine[] | null };

export async function fetchReconciliation(): Promise<ReconciliationData> {
  const db = getSupabaseServiceClient();
  const [invoiceResult, paymentResult, countResult, explanationResult, eventResult] = await Promise.all([
    db.from("platform_invoices")
      .select("id, number, tenant_id, status, total_cents, discount_cents, provider_total_cents, provider_payment_id, issued_at, tenants(name), platform_invoice_lines(kind, label, amount_cents)")
      .eq("reconciliation", "mismatched")
      .order("number", { ascending: false })
      .returns<RawInvoice[]>(),
    db.from("payments")
      .select("id, tenant_id, amount_cents, provider_charge_id, paid_at, tenants(name)")
      .is("invoice_id", null)
      .eq("method", "provider")
      .eq("status", "succeeded")
      .order("paid_at", { ascending: false })
      .limit(500)
      .returns<Array<Omit<ReconPayment, "tenant_name"> & { tenants: { name: string } | null }>>(),
    db.from("platform_invoices").select("id", { count: "exact", head: true }),
    loose().from(EXPLANATIONS_TABLE).select("invoice_id, payment_id, note, created_at, admin_users(name)").order("created_at", { ascending: false }).limit(2000),
    loose().from("webhook_events").select("id", { count: "exact", head: true }).like("event_type", "payment.%").or("processed_at.is.null,process_error.not.is.null"),
  ]);
  // A reconciliation report that silently drops a source reads as "everything matches" — refuse instead.
  if (invoiceResult.error) throw new Error(`Could not load mismatched invoices: ${invoiceResult.error.message}`);
  if (paymentResult.error) throw new Error(`Could not load provider payments: ${paymentResult.error.message}`);

  const explanationsReady = !isMissingRelation(explanationResult.error);
  if (explanationResult.error && explanationsReady) throw new Error(`Could not load reconciliation notes: ${explanationResult.error.message}`);

  return {
    invoices: (invoiceResult.data ?? []).map(({ tenants, platform_invoice_lines, ...row }) => ({ ...row, tenant_name: tenants?.name ?? "—", lines: platform_invoice_lines ?? [] })),
    payments: (paymentResult.data ?? []).map(({ tenants, ...row }) => ({ ...row, tenant_name: tenants?.name ?? "—" })),
    explanations: explanationsReady
      ? ((explanationResult.data ?? []) as Array<{ invoice_id: string | null; payment_id: string | null; note: string; created_at: string; admin_users: { name: string } | null }>)
          .map((item) => ({ invoice_id: item.invoice_id, payment_id: item.payment_id, note: item.note, created_at: item.created_at, explained_by_name: item.admin_users?.name ?? null }))
      : [],
    explanationsReady,
    totalInvoices: countResult.count ?? 0,
    unprocessedPaymentEvents: eventResult.error ? null : eventResult.count ?? 0,
  };
}

/** The open reconciliation count (the rail badge): mismatched invoices plus provider-only charges, less any explained. */
export async function countOpenReconciliation(): Promise<number> {
  const data = await fetchReconciliation();
  const explained = new Set(data.explanations.flatMap((item) => [item.invoice_id, item.payment_id]).filter(Boolean));
  return data.invoices.filter((row) => !explained.has(row.id)).length + data.payments.filter((row) => !explained.has(row.id)).length;
}

/** The latest explanation of one invoice, for its sheet; null when none or the table is not there yet. */
export async function fetchInvoiceExplanation(invoiceId: string): Promise<ReconExplanation | null> {
  const { data, error } = await loose().from(EXPLANATIONS_TABLE).select("invoice_id, payment_id, note, created_at, admin_users(name)").eq("invoice_id", invoiceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  return { invoice_id: data.invoice_id, payment_id: data.payment_id, note: data.note, created_at: data.created_at, explained_by_name: data.admin_users?.name ?? null };
}
