import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { InvoiceLineKind, InvoiceStatus, ReconciliationState } from "./constants";

export type InvoiceListRow = {
  id: string;
  number: string;
  tenant_id: string;
  tenant_name: string;
  status: InvoiceStatus;
  total_cents: number;
  provider_total_cents: number | null;
  reconciliation: ReconciliationState;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export type InvoiceFilters = {
  status?: InvoiceStatus | "all";
  tenantId?: string;
  overdueOnly?: boolean;
  mismatchedOnly?: boolean;
  from?: string;
  to?: string;
};

type Raw = Omit<InvoiceListRow, "tenant_name"> & { tenants: { name: string } | null };

const SELECT = `id, number, tenant_id, status, total_cents, provider_total_cents, reconciliation,
                issued_at, due_at, paid_at, created_at, tenants(name)`;

export async function fetchInvoices(filters: InvoiceFilters = {}): Promise<InvoiceListRow[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase.from("invoices").select(SELECT).order("number", { ascending: false });

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.tenantId) query = query.eq("tenant_id", filters.tenantId);
  if (filters.overdueOnly) query = query.eq("status", "overdue");
  if (filters.mismatchedOnly) query = query.eq("reconciliation", "mismatched");
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const { data } = await query.returns<Raw[]>();

  return (data ?? []).map((row) => ({
    ...row,
    tenant_name: row.tenants?.name ?? "—",
  }));
}

export type InvoiceTotals = {
  invoicedThisMonthCents: number;
  collectedThisMonthCents: number;
  mismatchedCount: number;
  overdueCount: number;
};

/**
 * The totals strip.
 *
 * Deliberately derived from the SAME rows the list filters read, rather than from separate
 * aggregate queries. The ticket's criterion is that the "overdue only" filter matches the number
 * in the strip; computing them from one source makes that true by construction instead of by two
 * pieces of arithmetic happening to agree.
 */
export async function fetchInvoiceTotals(): Promise<InvoiceTotals> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const all = await fetchInvoices();
  const thisMonth = all.filter((i) => new Date(i.created_at) >= startOfMonth);

  return {
    // A void invoice is not money we invoiced, so it is excluded from both figures.
    invoicedThisMonthCents: thisMonth
      .filter((i) => i.status !== "void")
      .reduce((sum, i) => sum + i.total_cents, 0),
    collectedThisMonthCents: thisMonth
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + i.total_cents, 0),
    // What we billed disagrees with what the customer was charged. The number that matters here.
    mismatchedCount: all.filter((i) => i.reconciliation === "mismatched").length,
    overdueCount: all.filter((i) => i.status === "overdue").length,
  };
}

export type InvoiceLineRow = {
  id: string;
  position: number;
  kind: InvoiceLineKind;
  label: string;
  quantity: number;
  included_qty: number | null;
  unit_cents: number;
  amount_cents: number;
};

export type InvoiceDetail = {
  invoice: InvoiceListRow & {
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    currency: string;
    period_start: string | null;
    period_end: string | null;
    provider: string | null;
    provider_payment_id: string | null;
    voided_at: string | null;
    void_reason: string | null;
  };
  lines: InvoiceLineRow[];
  events: { id: string; event_type: string; occurred_at: string | null; received_at: string }[];
  /** SA-3.4: money actually received against this invoice. */
  payments: {
    id: string;
    amount_cents: number;
    method: string;
    manual_reference: string | null;
    provider_charge_id: string | null;
    paid_at: string;
  }[];
  paidCents: number;
  remainingCents: number;
};

export async function fetchInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const supabase = getSupabaseServiceClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select(`${SELECT}, subtotal_cents, discount_cents, tax_cents, currency, period_start, period_end,
             provider, provider_payment_id, voided_at, void_reason`)
    .eq("id", id)
    .maybeSingle<Raw & Record<string, unknown>>();

  if (!invoice) return null;

  const { data: lines } = await supabase
    .from("invoice_lines")
    .select("id, position, kind, label, quantity, included_qty, unit_cents, amount_cents")
    .eq("invoice_id", id)
    .order("position");

  // Matched on the provider payment id inside the stored envelope, so the detail screen can show
  // what actually arrived rather than only what we derived from it.
  const { data: events } = invoice.provider_payment_id
    ? await supabase
        .from("webhook_events")
        .select("id, event_type, occurred_at, received_at")
        .eq("payload->data->>id", invoice.provider_payment_id as string)
        .order("received_at")
    : { data: [] };

  const { data: payments } = await supabase
    .from("payments")
    .select("id, amount_cents, method, manual_reference, provider_charge_id, paid_at")
    .eq("invoice_id", id)
    .eq("status", "succeeded")
    .order("paid_at");

  const { tenants, ...rest } = invoice;
  const typed = rest as InvoiceDetail["invoice"];
  const paidCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0);

  return {
    invoice: { ...typed, tenant_name: tenants?.name ?? "—" },
    lines: (lines as InvoiceLineRow[] | null) ?? [],
    events: events ?? [],
    payments: payments ?? [],
    paidCents,
    // A partial payment leaves the invoice issued with this showing, per the ticket.
    remainingCents: Math.max(0, typed.total_cents - paidCents),
  };
}
