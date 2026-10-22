import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import {
  comparisonSummary,
  EDITABLE,
  fromTemplate,
  invoiceTotals,
  lineAmount,
  unattributed,
  type ComparisonRow,
  type DraftLine,
  type InvoiceStatus,
  type InvoiceTemplate,
  type LeadType,
  type PaidMethod,
  type TemplateLine,
} from "./invoicesCore";
import { fromRow } from "./settingsCore";

/**
 * LA-7.2 (Notion sprint, Module 7 — Accounting) · vendor invoices, server side.
 *
 * Drafts are edited here directly; approving, paying and voiding go through the database's writers
 * (20261015210000), because those three move money in the cost ledger (LA-7.1). Totals are always
 * recomputed from the lines on the server — a subtotal sent by the browser is never stored.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const INVOICES_PENDING_MESSAGE = "Invoices need a database update (20261015200000–20261015210000).";
export const ACCOUNTING_BUCKET = "accounting-files";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export class InvoiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(error: { code?: string; message: string }): never {
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new InvoiceError(INVOICES_PENDING_MESSAGE, 503);
  if (error.code === "P0002") throw new InvoiceError(error.message.replace(/^\w+: /, ""), 404);
  // A payout run already booking the partner's period is named by the database; anything else unique is the invoice number.
  if (error.code === "23505") throw new InvoiceError(/a payout run already books/.test(error.message) ? error.message.replace(/^\w+: /, "") : "That invoice number is already recorded for this source.", 409);
  if (error.code === "22023" || error.code === "23514" || error.code === "P0001") throw new InvoiceError(error.message.replace(/^\w+: /, ""), 400);
  throw new Error(error.message);
}

export type InvoiceListRow = {
  id: string;
  sourceType: "vendor" | "partner";
  sourceId: string;
  sourceName: string;
  invoiceNumber: string;
  invoiceDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  totalCents: number;
  status: InvoiceStatus;
  paidOn: string | null;
  flagged: boolean;
  differenceCents: number | null;
  hasDocument: boolean;
};

export type InvoiceLine = DraftLine & { id: string; position: number; amountCents: number };

export type InvoiceDetail = InvoiceListRow & {
  subtotalCents: number;
  taxCents: number;
  paidMethod: PaidMethod | null;
  paymentReference: string | null;
  note: string | null;
  documentName: string | null;
  voidReason: string | null;
  approvedAt: string | null;
  lines: InvoiceLine[];
  unattributed: { lines: number; amountCents: number };
  comparison: { rows: ComparisonRow[]; summary: ReturnType<typeof comparisonSummary>; frozen: boolean };
  entries: { id: string; amountCents: number; incurredOn: string; paidOn: string | null; reverses: string | null; description: string }[];
};

async function names(tenantId: string) {
  const [v, p, c] = await Promise.all([
    db().from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId),
    db().from("partners").select("id, name").eq("tenant_id", tenantId),
    db().from("tenant_campaigns").select("id, name, vendor_id").eq("tenant_id", tenantId),
  ]);
  const map = new Map<string, string>();
  for (const r of [...(v.data ?? []), ...(p.data ?? [])] as Loose[]) map.set(r.id, r.name);
  const campaigns = new Map<string, { name: string; vendorId: string | null }>(((c.data ?? []) as Loose[]).map((r) => [r.id, { name: r.name ?? "Campaign", vendorId: r.vendor_id ?? null }]));
  return { map, campaigns };
}

const toListRow = (r: Loose, n: Map<string, string>): InvoiceListRow => ({
  id: r.id,
  sourceType: r.vendor_id ? "vendor" : "partner",
  sourceId: r.vendor_id ?? r.partner_id,
  sourceName: n.get(r.vendor_id ?? r.partner_id) ?? "Unknown source",
  invoiceNumber: r.invoice_number,
  invoiceDate: r.invoice_date,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  dueDate: r.due_date,
  totalCents: Number(r.total_cents),
  status: r.status,
  paidOn: r.paid_on,
  flagged: !!r.flagged,
  differenceCents: r.difference_cents == null ? null : Number(r.difference_cents),
  hasDocument: !!r.document_path,
});

const LIST_COLUMNS = "id, vendor_id, partner_id, invoice_number, invoice_date, period_start, period_end, due_date, total_cents, status, paid_on, flagged, difference_cents, document_path";

export async function listInvoices(tenantId: string, opts: { status?: InvoiceStatus | "open"; sourceId?: string } = {}): Promise<InvoiceListRow[]> {
  let q = db().from("vendor_invoice").select(LIST_COLUMNS).eq("tenant_id", tenantId);
  if (opts.status === "open") q = q.in("status", ["draft", "received", "disputed", "approved"]);
  else if (opts.status) q = q.eq("status", opts.status);
  if (opts.sourceId) q = q.or(`vendor_id.eq.${opts.sourceId},partner_id.eq.${opts.sourceId}`);
  const [{ data, error }, n] = await Promise.all([q.order("invoice_date", { ascending: false }).order("id").limit(500), names(tenantId)]);
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map((r) => toListRow(r, n.map));
}

async function comparison(tenantId: string, id: string): Promise<ComparisonRow[]> {
  const { data, error } = await db().rpc("vendor_invoice_comparison", { p_tenant_id: tenantId, p_invoice_id: id });
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map(toComparison);
}

const toComparison = (r: Loose): ComparisonRow => ({
  lineId: r.line_id, campaignId: r.campaign_id, leadType: r.lead_type, invoicedQuantity: Number(r.invoiced_quantity), invoicedCents: Number(r.invoiced_cents),
  unitPriceCents: Number(r.unit_price_cents), periodFrom: r.period_from, periodTo: r.period_to, countable: !!r.countable, accepted: Number(r.accepted),
  rejected: Number(r.rejected), recorded: Number(r.recorded), creditedCount: Number(r.credited_count), creditedCents: Number(r.credited_cents),
  ourCount: Number(r.our_count), ourCents: Number(r.our_cents), differenceCents: Number(r.difference_cents),
});

export async function tolerance(tenantId: string): Promise<number> {
  const { data } = await db().from("accounting_settings").select("invoice_tolerance_cents").eq("tenant_id", tenantId).maybeSingle();
  return fromRow(data).invoiceToleranceCents;
}

export async function getInvoice(tenantId: string, id: string): Promise<InvoiceDetail> {
  const { data: r, error } = await db().from("vendor_invoice").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) fail(error);
  if (!r) throw new InvoiceError("That invoice isn't in this agency.", 404);
  const [lines, entries, n, tol] = await Promise.all([
    db().from("vendor_invoice_line").select("*").eq("invoice_id", id).order("position").order("created_at"),
    db().from("cost_entry").select("id, amount_cents, incurred_on, paid_on, reverses_entry_id, description").eq("tenant_id", tenantId).eq("invoice_id", id).order("created_at"),
    names(tenantId),
    tolerance(tenantId),
  ]);
  if (lines.error) fail(lines.error);
  const frozen = !EDITABLE.includes(r.status) && Array.isArray(r.comparison_json);
  const rows = frozen ? (r.comparison_json as Loose[]).map(toComparison) : await comparison(tenantId, id);
  const lineRows: InvoiceLine[] = ((lines.data ?? []) as Loose[]).map((l) => ({
    id: l.id, position: l.position, description: l.description, campaignId: l.campaign_id, leadType: l.lead_type as LeadType, quantity: l.quantity,
    unitPriceCents: Number(l.unit_price_cents), amountCents: Number(l.amount_cents), periodStart: l.period_start, periodEnd: l.period_end,
  }));
  return {
    ...toListRow(r, n.map),
    subtotalCents: Number(r.subtotal_cents), taxCents: Number(r.tax_cents), paidMethod: r.paid_method, paymentReference: r.payment_reference,
    note: r.note, documentName: r.document_name, voidReason: r.void_reason, approvedAt: r.approved_at,
    lines: lineRows,
    unattributed: unattributed(lineRows),
    comparison: { rows, summary: comparisonSummary(rows, tol), frozen },
    entries: ((entries.data ?? []) as Loose[]).map((e) => ({ id: e.id, amountCents: Number(e.amount_cents), incurredOn: e.incurred_on, paidOn: e.paid_on, reverses: e.reverses_entry_id, description: e.description })),
  };
}

export type InvoiceInput = {
  vendorId: string | null;
  partnerId: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  taxCents: number;
  note: string | null;
  status: "draft" | "received";
  templateId?: string | null;
  lines: DraftLine[];
};

function checkInput(input: InvoiceInput) {
  if ((input.vendorId ? 1 : 0) + (input.partnerId ? 1 : 0) !== 1) throw new InvoiceError("Pick the vendor or partner that sent the invoice.");
  if (!input.lines.length) throw new InvoiceError("An invoice needs at least one line.");
  for (const l of input.lines) {
    if (!Number.isSafeInteger(l.quantity) || l.quantity < 0 || !Number.isSafeInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new InvoiceError("Quantities and prices are whole, non-negative numbers.");
    if (l.amountCents != null && (!Number.isSafeInteger(l.amountCents) || l.amountCents < 0)) throw new InvoiceError("A line's amount cannot be negative.");
  }
  if (!Number.isSafeInteger(input.taxCents) || input.taxCents < 0) throw new InvoiceError("Tax cannot be negative.");
}

const lineRows = (tenantId: string, invoiceId: string, input: InvoiceInput) =>
  input.lines.map((l, i) => ({
    tenant_id: tenantId, invoice_id: invoiceId, position: i, description: l.description.trim() || "Line", campaign_id: l.campaignId, lead_type: l.leadType,
    quantity: l.quantity, unit_price_cents: l.unitPriceCents, amount_cents: lineAmount(l),
    period_start: l.periodStart ?? input.periodStart, period_end: l.periodEnd ?? input.periodEnd,
  }));

export async function createInvoice(tenantId: string, userId: string, input: InvoiceInput): Promise<string> {
  checkInput(input);
  const t = invoiceTotals(input.lines, input.taxCents);
  const { data, error } = await db().from("vendor_invoice").insert({
    tenant_id: tenantId, vendor_id: input.vendorId, partner_id: input.partnerId, invoice_number: input.invoiceNumber.trim(), invoice_date: input.invoiceDate,
    period_start: input.periodStart, period_end: input.periodEnd, due_date: input.dueDate, subtotal_cents: t.subtotalCents, tax_cents: t.taxCents,
    total_cents: t.totalCents, status: input.status, note: input.note, template_id: input.templateId ?? null, created_by: userId,
  }).select("id").single();
  if (error) fail(error);
  const { error: le } = await db().from("vendor_invoice_line").insert(lineRows(tenantId, data.id, input));
  if (le) {
    // The header without its lines would be an invoice that adds up to nothing: void it so the number is not lost.
    await db().rpc("void_vendor_invoice", { p_tenant_id: tenantId, p_invoice_id: data.id, p_reason: "Lines could not be saved", p_by: userId });
    fail(le);
  }
  if (input.templateId) await db().from("vendor_invoice_template").update({ last_used_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", input.templateId);
  return data.id as string;
}

/** Replace a draft's header and lines. Refused by the database once the invoice is approved. */
export async function updateInvoice(tenantId: string, id: string, input: InvoiceInput): Promise<void> {
  checkInput(input);
  const current = await getInvoice(tenantId, id);
  if (!EDITABLE.includes(current.status)) throw new InvoiceError("An approved invoice is history: void it and enter it again.", 409);
  const t = invoiceTotals(input.lines, input.taxCents);
  // Header first: a refused header (a duplicate number) must leave the old lines in place.
  const { error } = await db().from("vendor_invoice").update({
    vendor_id: input.vendorId, partner_id: input.partnerId, invoice_number: input.invoiceNumber.trim(), invoice_date: input.invoiceDate,
    period_start: input.periodStart, period_end: input.periodEnd, due_date: input.dueDate, subtotal_cents: t.subtotalCents, tax_cents: t.taxCents,
    total_cents: t.totalCents, note: input.note, ...(current.status === "disputed" ? {} : { status: input.status }),
  }).eq("tenant_id", tenantId).eq("id", id);
  if (error) fail(error);
  const { error: de } = await db().from("vendor_invoice_line").delete().eq("invoice_id", id).eq("tenant_id", tenantId);
  if (de) fail(de);
  const { error: le } = await db().from("vendor_invoice_line").insert(lineRows(tenantId, id, input));
  if (le) fail(le);
}

/** Received ↔ disputed: a question for the vendor, before anything is booked. */
export async function setDisputed(tenantId: string, id: string, disputed: boolean, note: string | null): Promise<void> {
  const current = await getInvoice(tenantId, id);
  const from = disputed ? "received" : "disputed";
  if (current.status !== from) throw new InvoiceError(disputed ? "Only a received invoice can be disputed." : "This invoice is not disputed.", 409);
  const { error } = await db().from("vendor_invoice").update({ status: disputed ? "disputed" : "received", ...(note ? { note } : {}) }).eq("tenant_id", tenantId).eq("id", id);
  if (error) fail(error);
}

export async function approveInvoice(tenantId: string, id: string, by: string) {
  const { data, error } = await db().rpc("approve_vendor_invoice", { p_tenant_id: tenantId, p_invoice_id: id, p_by: by });
  if (error) fail(error);
  return { entries: Number(data?.entries ?? 0), differenceCents: Number(data?.difference_cents ?? 0), flagged: !!data?.flagged };
}

export async function markInvoicePaid(tenantId: string, id: string, input: { paidOn: string; method: PaidMethod | null; reference: string | null }, by: string) {
  const { data, error } = await db().rpc("mark_vendor_invoice_paid", { p_tenant_id: tenantId, p_invoice_id: id, p_paid_on: input.paidOn, p_method: input.method, p_reference: input.reference, p_by: by });
  if (error) fail(error);
  return Number(data ?? 0);
}

export async function voidInvoice(tenantId: string, id: string, reason: string, by: string) {
  const { data, error } = await db().rpc("void_vendor_invoice", { p_tenant_id: tenantId, p_invoice_id: id, p_reason: reason, p_by: by });
  if (error) fail(error);
  return Number(data ?? 0);
}

/** The invoice PDF (or a photo of it), in tenant-scoped storage. */
export async function attachDocument(tenantId: string, id: string, file: File): Promise<void> {
  if (!file.size) throw new InvoiceError("That file is empty.");
  if (file.size > MAX_BYTES) throw new InvoiceError("Files up to 10 MB.");
  if (!ALLOWED_TYPES.includes(file.type)) throw new InvoiceError("PDF, PNG or JPEG only.");
  await getInvoice(tenantId, id);
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "invoice";
  const path = `${tenantId}/invoices/${id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await db().storage.from(ACCOUNTING_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw new InvoiceError(/bucket/i.test(error.message) ? INVOICES_PENDING_MESSAGE : `Could not store the file: ${error.message}`, /bucket/i.test(error.message) ? 503 : 500);
  const { error: ue } = await db().from("vendor_invoice").update({ document_path: path, document_name: file.name.slice(0, 200) }).eq("tenant_id", tenantId).eq("id", id);
  if (ue) fail(ue);
}

/** A 60-second link to the invoice's document. */
export async function documentUrl(tenantId: string, id: string): Promise<string> {
  const { data: r, error } = await db().from("vendor_invoice").select("document_path").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) fail(error);
  const path = r?.document_path as string | undefined;
  if (!path || !path.startsWith(`${tenantId}/invoices/${id}/`)) throw new InvoiceError("No document is attached to this invoice.", 404);
  const { data, error: se } = await db().storage.from(ACCOUNTING_BUCKET).createSignedUrl(path, 60);
  if (se || !data?.signedUrl) throw new InvoiceError("The document could not be opened.", 500);
  return data.signedUrl;
}

// ─── templates ─────────────────────────────────────────────────────────────────────────────────
const toTemplate = (r: Loose): InvoiceTemplate => ({
  id: r.id, name: r.name, vendorId: r.vendor_id, partnerId: r.partner_id, taxCents: Number(r.tax_cents ?? 0),
  lines: ((r.lines_json ?? []) as Loose[]).map((l) => ({ description: String(l.description ?? ""), campaignId: l.campaign_id ?? null, leadType: l.lead_type, unitPriceCents: Number(l.unit_price_cents ?? 0), amountCents: l.amount_cents == null ? null : Number(l.amount_cents) })),
});

export async function listTemplates(tenantId: string): Promise<(InvoiceTemplate & { sourceName: string; lastUsedAt: string | null })[]> {
  const [{ data, error }, n] = await Promise.all([db().from("vendor_invoice_template").select("*").eq("tenant_id", tenantId).eq("active", true).order("name"), names(tenantId)]);
  if (error) fail(error);
  return ((data ?? []) as Loose[]).map((r) => ({ ...toTemplate(r), sourceName: n.map.get(r.vendor_id ?? r.partner_id) ?? "Unknown source", lastUsedAt: r.last_used_at }));
}

export async function saveTemplate(tenantId: string, userId: string, input: { id?: string; name: string; vendorId: string | null; partnerId: string | null; taxCents: number; lines: TemplateLine[] }): Promise<string> {
  if ((input.vendorId ? 1 : 0) + (input.partnerId ? 1 : 0) !== 1) throw new InvoiceError("Pick the vendor or partner the template is for.");
  if (!input.lines.length) throw new InvoiceError("A template needs at least one line.");
  const row = {
    tenant_id: tenantId, name: input.name.trim(), vendor_id: input.vendorId, partner_id: input.partnerId, tax_cents: input.taxCents,
    lines_json: input.lines.map((l) => ({ description: l.description.trim(), campaign_id: l.campaignId, lead_type: l.leadType, unit_price_cents: l.unitPriceCents, amount_cents: l.amountCents ?? null })),
    updated_at: new Date().toISOString(),
  };
  const res = input.id
    ? await db().from("vendor_invoice_template").update(row).eq("tenant_id", tenantId).eq("id", input.id).select("id").single()
    : await db().from("vendor_invoice_template").insert({ ...row, created_by: userId }).select("id").single();
  if (res.error) fail(res.error);
  return res.data.id as string;
}

export async function removeTemplate(tenantId: string, id: string): Promise<void> {
  const { error } = await db().from("vendor_invoice_template").update({ active: false }).eq("tenant_id", tenantId).eq("id", id);
  if (error) fail(error);
}

/** This month's invoice from a template: number, date and quantities — the rest is filled in. */
export async function invoiceFromTemplate(tenantId: string, userId: string, templateId: string, input: { invoiceNumber: string; invoiceDate: string; quantities: number[] }): Promise<string> {
  const { data, error } = await db().from("vendor_invoice_template").select("*").eq("tenant_id", tenantId).eq("id", templateId).maybeSingle();
  if (error) fail(error);
  if (!data) throw new InvoiceError("That template isn't in this agency.", 404);
  const draft = fromTemplate(toTemplate(data), input);
  return createInvoice(tenantId, userId, { ...draft, dueDate: null, note: null, status: "received" });
}

/** What the pickers offer: lead vendors, partners and campaigns of this agency. */
export async function invoiceSources(tenantId: string) {
  const [v, p, c] = await Promise.all([
    db().from("tenant_lead_vendors").select("id, name, status").eq("tenant_id", tenantId).order("name"),
    db().from("partners").select("id, name, status").eq("tenant_id", tenantId).order("name"),
    db().from("tenant_campaigns").select("id, name, vendor_id, status").eq("tenant_id", tenantId).order("name"),
  ]);
  return {
    vendors: ((v.data ?? []) as Loose[]).map((r) => ({ id: r.id, name: r.name as string })),
    partners: ((p.data ?? []) as Loose[]).map((r) => ({ id: r.id, name: r.name as string })),
    campaigns: ((c.data ?? []) as Loose[]).map((r) => ({ id: r.id, name: (r.name as string) ?? "Campaign", vendorId: r.vendor_id as string | null })),
  };
}
