// SA-3.2 · Invoice values shared by the server and the admin UI. Client-safe: no imports that
// touch the database, because SA-3.3's screens will need these labels.

export const INVOICE_STATUSES = ["draft", "issued", "paid", "overdue", "void", "uncollectible"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
  uncollectible: "Uncollectible",
};

export const INVOICE_LINE_KINDS = ["plan", "addon", "overage", "discount", "setup_fee", "credit"] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

export const INVOICE_LINE_KIND_LABELS: Record<InvoiceLineKind, string> = {
  plan: "Plan",
  addon: "Add-on",
  overage: "Overage",
  discount: "Discount",
  setup_fee: "Setup fee",
  credit: "Credit",
};

/**
 * Whether our computed total agrees with what the provider actually charged.
 *
 * `mismatched` is the interesting one. It is not cosmetic: the bug that charged $198 for a $99
 * plan would have surfaced here on the very first invoice.
 */
export const RECONCILIATION_STATES = ["pending", "matched", "mismatched", "not_applicable"] as const;
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

export type InvoiceLineInput = {
  kind: InvoiceLineKind;
  label: string;
  quantity?: number;
  /** Overage lines carry the allowance so the customer can check the arithmetic. */
  included_qty?: number;
  unit_cents?: number;
  amount_cents: number;
};

export type InvoiceRow = {
  id: string;
  number: string;
  tenant_id: string;
  status: InvoiceStatus;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  provider: string | null;
  provider_payment_id: string | null;
  provider_total_cents: number | null;
  reconciliation: ReconciliationState;
  issued_at: string | null;
  paid_at: string | null;
  created_at: string;
};
