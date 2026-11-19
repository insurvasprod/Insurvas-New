// Admin › Billing › Reconciliation (billing-r2 screen 7, Notion §12's provider reconciliation report): what we
// billed against what the provider charged, invoice by invoice, with the likely reason. Plain module: the
// page, the invoice sheet's "see why" and node:test all use it.
//
// "Don't match" is the invoices list's own Mismatched lens (reconciliation = 'mismatched', set when the
// provider's payment arrives), so the two pages cannot disagree. "Provider only" is a charge the provider
// collected that no invoice of ours accounts for: a succeeded provider payment with no invoice.
// A row someone has explained (with a note) is Settled; it leaves Don't match / Provider only.

import { csvCell } from "../csv/cell.ts";
import type { InvoiceLineKind, InvoiceStatus } from "./constants.ts";

export type ReconLine = { kind: InvoiceLineKind; label: string; amount_cents: number };

export type ReconInvoice = {
  id: string;
  number: string;
  tenant_id: string;
  tenant_name: string;
  status: InvoiceStatus;
  total_cents: number;
  discount_cents: number;
  provider_total_cents: number | null;
  provider_payment_id: string | null;
  issued_at: string | null;
  lines: ReconLine[];
};

export type ReconPayment = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  amount_cents: number;
  provider_charge_id: string | null;
  paid_at: string;
};

export type ReconExplanation = { invoice_id: string | null; payment_id: string | null; note: string; explained_by_name: string | null; created_at: string };

export type ReconReason =
  | "no_charge"
  | "addon_here_only"
  | "discount_at_provider"
  | "discount_here_only"
  | "provider_charged_more"
  | "same_amount"
  | "no_invoice";

export const RECON_REASON_LABELS: Record<ReconReason, string> = {
  no_charge: "No charge found",
  addon_here_only: "Add-on or overage billed here, not at the provider",
  discount_at_provider: "Coupon applied at the provider only",
  discount_here_only: "Discount applied here, not at the provider",
  provider_charged_more: "Provider charged more (price or quantity differs)",
  same_amount: "Same amount, different record (check the provider)",
  no_invoice: "Charged, no invoice of ours",
};

/** Lines that are extras on top of the plan: the provider's membership price never includes them. */
const EXTRA_KINDS: ReadonlySet<InvoiceLineKind> = new Set(["addon", "overage", "setup_fee"]);

/** Whether some subset of `amounts` sums to `target` exactly (small lists: an invoice has a handful of lines). */
function subsetSums(amounts: number[], target: number): boolean {
  if (target <= 0) return false;
  let reachable = new Set<number>([0]);
  for (const amount of amounts.slice(0, 16)) {
    const next = new Set(reachable);
    for (const sum of reachable) next.add(sum + amount);
    reachable = next;
    if (reachable.has(target)) return true;
  }
  return reachable.has(target);
}

/**
 * The likely reason an invoice and the provider disagree, from simple rules over its lines and discount.
 * A guess, worded as one ("likely"), never a verdict: the admin settles it.
 *
 *   provider charged nothing (or $0)         → No charge found
 *   we billed more, by exactly some extras   → Add-on or overage billed here, not at the provider
 *   we billed more, otherwise                → Coupon applied at the provider only
 *   we billed less, by exactly our discount  → Discount applied here, not at the provider
 *   we billed less, otherwise                → Provider charged more
 */
export function likelyReason(invoice: Pick<ReconInvoice, "total_cents" | "discount_cents" | "provider_total_cents" | "lines">): ReconReason {
  // Nothing received, or a payment of nothing: the provider has not charged this invoice at all.
  if (invoice.provider_total_cents === null || invoice.provider_total_cents === 0) return "no_charge";
  const difference = invoice.total_cents - invoice.provider_total_cents;
  if (difference > 0) {
    const extras = invoice.lines.filter((line) => EXTRA_KINDS.has(line.kind) && line.amount_cents > 0).map((line) => line.amount_cents);
    if (subsetSums(extras, difference)) return "addon_here_only";
    return "discount_at_provider";
  }
  if (difference < 0) {
    const discountLines = invoice.lines.filter((line) => line.kind === "discount" || line.kind === "credit").reduce((sum, line) => sum + Math.abs(line.amount_cents), 0);
    const discount = Math.max(invoice.discount_cents, discountLines);
    if (discount > 0 && Math.abs(difference) === discount) return "discount_here_only";
    return discount > 0 ? "discount_here_only" : "provider_charged_more";
  }
  return "same_amount";
}

export type ReconRow = {
  /** `inv:<id>` or `pay:<id>`, unique across both kinds. */
  key: string;
  kind: "invoice" | "payment";
  invoiceId: string | null;
  paymentId: string | null;
  number: string | null;
  tenantId: string;
  tenantName: string;
  billedCents: number;
  chargedCents: number | null;
  /** billed − charged: positive when we billed more. */
  differenceCents: number;
  reason: ReconReason;
  invoiceStatus: InvoiceStatus | null;
  hasProviderPayment: boolean;
  at: string | null;
  explanation: ReconExplanation | null;
};

export const RECON_LENSES = ["mismatched", "provider", "settled"] as const;
export type ReconLens = (typeof RECON_LENSES)[number];
export const RECON_LENS_LABELS: Record<ReconLens, string> = { mismatched: "Don't match", provider: "Provider only", settled: "Settled" };

/** One row per mismatched invoice and per provider-only charge, each with its latest explanation. */
export function reconciliationRows(invoices: ReconInvoice[], payments: ReconPayment[], explanations: ReconExplanation[]): ReconRow[] {
  const latest = new Map<string, ReconExplanation>();
  for (const item of [...explanations].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (item.invoice_id) latest.set(`inv:${item.invoice_id}`, item);
    if (item.payment_id) latest.set(`pay:${item.payment_id}`, item);
  }
  const fromInvoices: ReconRow[] = invoices.map((invoice) => ({
    key: `inv:${invoice.id}`,
    kind: "invoice",
    invoiceId: invoice.id,
    paymentId: null,
    number: invoice.number,
    tenantId: invoice.tenant_id,
    tenantName: invoice.tenant_name,
    billedCents: invoice.total_cents,
    chargedCents: invoice.provider_total_cents,
    differenceCents: invoice.total_cents - (invoice.provider_total_cents ?? 0),
    reason: likelyReason(invoice),
    invoiceStatus: invoice.status,
    hasProviderPayment: Boolean(invoice.provider_payment_id),
    at: invoice.issued_at,
    explanation: latest.get(`inv:${invoice.id}`) ?? null,
  }));
  const fromPayments: ReconRow[] = payments.map((payment) => ({
    key: `pay:${payment.id}`,
    kind: "payment",
    invoiceId: null,
    paymentId: payment.id,
    number: null,
    tenantId: payment.tenant_id,
    tenantName: payment.tenant_name,
    billedCents: 0,
    chargedCents: payment.amount_cents,
    differenceCents: -payment.amount_cents,
    reason: "no_invoice",
    invoiceStatus: null,
    hasProviderPayment: true,
    at: payment.paid_at,
    explanation: latest.get(`pay:${payment.id}`) ?? null,
  }));
  return [...fromInvoices, ...fromPayments];
}

export function reconLensOf(row: ReconRow): ReconLens {
  if (row.explanation) return "settled";
  return row.kind === "payment" ? "provider" : "mismatched";
}

export type ReconFacts = {
  mismatched: number;
  differenceCents: number;
  billedMoreOn: number;
  providerOnly: number;
  settled: number;
};

/** The page's figures, over open rows only (a settled row no longer counts as a difference). */
export function reconciliationFacts(rows: ReconRow[]): ReconFacts {
  const open = rows.filter((row) => !row.explanation);
  const mismatched = open.filter((row) => row.kind === "invoice");
  return {
    mismatched: mismatched.length,
    differenceCents: mismatched.reduce((sum, row) => sum + Math.abs(row.differenceCents), 0),
    billedMoreOn: mismatched.filter((row) => row.differenceCents > 0).length,
    providerOnly: open.filter((row) => row.kind === "payment").length,
    settled: rows.length - open.length,
  };
}

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export function reconciliationCsv(rows: ReconRow[]): string {
  const head = ["Invoice", "Customer", "We billed", "Provider charged", "Difference", "Likely reason", "Settled", "Note"];
  const body = rows.map((row) => [
    row.number ?? "",
    row.tenantName,
    dollars(row.billedCents),
    dollars(row.chargedCents),
    dollars(row.differenceCents),
    RECON_REASON_LABELS[row.reason],
    row.explanation ? row.explanation.created_at.slice(0, 10) : "",
    row.explanation?.note ?? "",
  ]);
  return [head, ...body].map((cells) => cells.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
