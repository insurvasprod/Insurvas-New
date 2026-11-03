/**
 * LA-7.2 (Notion sprint, Module 7 — Accounting) · vendor invoices, with no database: line maths,
 * the recurring template that turns a monthly invoice into three fields, and what the comparison
 * with our own count says. Integer cents throughout.
 */

export const LEAD_TYPES = ["live_transfer", "data_list", "aged_lead", "direct_mail", "other"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];
export const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  live_transfer: "Live transfers",
  data_list: "Data list",
  aged_lead: "Aged leads",
  direct_mail: "Direct mail",
  other: "Other",
};
/** Lines we can count against our own records; the rest are compared by nobody. */
export const COUNTABLE: readonly LeadType[] = ["live_transfer", "data_list", "aged_lead"];

export const INVOICE_STATUSES = ["draft", "received", "approved", "paid", "disputed", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  received: "Received",
  approved: "Approved",
  paid: "Paid",
  disputed: "Disputed",
  void: "Void",
};
/** Statuses whose lines can still change. Once approved, an invoice is history. */
export const EDITABLE: readonly InvoiceStatus[] = ["draft", "received", "disputed"];

export const PAID_METHODS = ["ach", "card", "cheque", "wire", "other"] as const;
export type PaidMethod = (typeof PAID_METHODS)[number];
export const PAID_METHOD_LABELS: Record<PaidMethod, string> = { ach: "ACH", card: "Card", cheque: "Cheque", wire: "Wire", other: "Other" };

export type DraftLine = {
  description: string;
  campaignId: string | null;
  leadType: LeadType;
  quantity: number;
  unitPriceCents: number;
  /** Set when the line is not simply quantity × price (a flat fee, a rounded invoice). */
  amountCents?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};

/** A line's amount: what the invoice says, else quantity × unit price. Integer multiplication only. */
export function lineAmount(line: Pick<DraftLine, "quantity" | "unitPriceCents" | "amountCents">): number {
  if (line.amountCents != null) return line.amountCents;
  return line.quantity * line.unitPriceCents;
}

export function invoiceTotals(lines: Pick<DraftLine, "quantity" | "unitPriceCents" | "amountCents">[], taxCents: number) {
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  return { subtotalCents: subtotal, taxCents, totalCents: subtotal + taxCents };
}

/** The calendar month before a date: a monthly invoice dated 2 September bills August. */
export function previousMonth(isoDate: string): { start: string; end: string } {
  const [y, m] = isoDate.slice(0, 7).split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { start: `${py}-${mm}-01`, end: `${py}-${mm}-${String(last).padStart(2, "0")}` };
}

export type TemplateLine = { description: string; campaignId: string | null; leadType: LeadType; unitPriceCents: number; amountCents?: number | null };
export type InvoiceTemplate = { id: string; name: string; vendorId: string | null; partnerId: string | null; lines: TemplateLine[]; taxCents: number };

/**
 * What a person types to enter this month's invoice from a template: its number, its date, and how
 * many of each per-unit line. A one-line monthly invoice is three fields.
 */
export function templateInputs(t: Pick<InvoiceTemplate, "lines">): string[] {
  return ["invoiceNumber", "invoiceDate", ...t.lines.map((l, i) => (l.amountCents != null ? null : `quantity${i}`)).filter((x): x is string => x !== null)];
}

export function fromTemplate(t: InvoiceTemplate, input: { invoiceNumber: string; invoiceDate: string; quantities: number[] }) {
  const period = previousMonth(input.invoiceDate);
  let q = 0;
  const lines: DraftLine[] = t.lines.map((l) => {
    const quantity = l.amountCents != null ? 1 : input.quantities[q++] ?? 0;
    return { description: l.description, campaignId: l.campaignId, leadType: l.leadType, quantity, unitPriceCents: l.unitPriceCents, amountCents: l.amountCents ?? null, periodStart: period.start, periodEnd: period.end };
  });
  return { vendorId: t.vendorId, partnerId: t.partnerId, invoiceNumber: input.invoiceNumber.trim(), invoiceDate: input.invoiceDate, periodStart: period.start, periodEnd: period.end, templateId: t.id, lines, ...invoiceTotals(lines, t.taxCents) };
}

export type ComparisonRow = {
  lineId: string;
  campaignId: string | null;
  leadType: LeadType;
  invoicedQuantity: number;
  invoicedCents: number;
  unitPriceCents: number;
  periodFrom: string;
  periodTo: string;
  countable: boolean;
  accepted: number;
  rejected: number;
  recorded: number;
  creditedCount: number;
  creditedCents: number;
  ourCount: number;
  ourCents: number;
  differenceCents: number;
};

/** The comparison as the screen shows it: one difference across the countable lines, flagged past tolerance. */
export function comparisonSummary(rows: ComparisonRow[], toleranceCents: number) {
  const countable = rows.filter((r) => r.countable);
  const differenceCents = countable.reduce((s, r) => s + r.differenceCents, 0);
  return {
    invoicedCents: rows.reduce((s, r) => s + r.invoicedCents, 0),
    ourCents: rows.reduce((s, r) => s + r.ourCents, 0),
    differenceCents,
    flagged: Math.abs(differenceCents) > toleranceCents,
    toleranceCents,
    uncountedLines: rows.length - countable.length,
  };
}

/** Lines with no campaign: allowed, counted and shown — never silently absorbed into a campaign's cost. */
export function unattributed(lines: { campaignId: string | null; amountCents: number }[]) {
  const un = lines.filter((l) => !l.campaignId);
  return { lines: un.length, amountCents: un.reduce((s, l) => s + l.amountCents, 0) };
}
