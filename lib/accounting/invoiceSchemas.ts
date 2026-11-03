import { NextResponse } from "next/server";
import { z } from "zod";

import { LEAD_TYPES } from "./invoicesCore";
import { InvoiceError } from "./invoiceStore";

/** LA-7.2 · what the invoice routes accept (route files may export only their handlers). */
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(0).max(1_000_000_000_00);

export const lineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  campaign_id: uuid.nullable(),
  lead_type: z.enum(LEAD_TYPES),
  quantity: z.number().int().min(0).max(10_000_000),
  unit_price_cents: cents,
  amount_cents: cents.nullable().optional(),
  period_start: isoDate.nullable().optional(),
  period_end: isoDate.nullable().optional(),
}).strict();

export const invoiceSchema = z.object({
  vendor_id: uuid.nullable(),
  partner_id: uuid.nullable(),
  invoice_number: z.string().trim().min(1).max(80),
  invoice_date: isoDate,
  period_start: isoDate.nullable(),
  period_end: isoDate.nullable(),
  due_date: isoDate.nullable(),
  tax_cents: z.number().int().min(0, "Tax can't be negative.").max(1_000_000_000_00),
  note: z.string().trim().max(2000).nullable(),
  status: z.enum(["draft", "received"]),
  lines: z.array(lineSchema).min(1).max(50),
}).strict().refine((b) => !b.period_start || !b.period_end || b.period_end >= b.period_start, { message: "“Period to” is before “Period from”.", path: ["period_end"] });

export const fromTemplateSchema = z.object({
  template_id: uuid,
  invoice_number: z.string().trim().min(1).max(80),
  invoice_date: isoDate,
  quantities: z.array(z.number().int().min(0).max(10_000_000)).max(20),
}).strict();

export function toInput(b: z.infer<typeof invoiceSchema>) {
  return {
    vendorId: b.vendor_id, partnerId: b.partner_id, invoiceNumber: b.invoice_number, invoiceDate: b.invoice_date, periodStart: b.period_start,
    periodEnd: b.period_end, dueDate: b.due_date, taxCents: b.tax_cents, note: b.note || null, status: b.status,
    lines: b.lines.map((l) => ({ description: l.description, campaignId: l.campaign_id, leadType: l.lead_type, quantity: l.quantity, unitPriceCents: l.unit_price_cents, amountCents: l.amount_cents ?? null, periodStart: l.period_start ?? null, periodEnd: l.period_end ?? null })),
  };
}

export const invoiceFail = (error: unknown) => {
  if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[invoices]", error);
  return NextResponse.json({ error: "The invoice could not be saved" }, { status: 500 });
};

