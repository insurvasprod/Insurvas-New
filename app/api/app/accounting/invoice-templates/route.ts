import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { LEAD_TYPES } from "@/lib/accounting/invoicesCore";
import { invoiceFail } from "@/lib/accounting/invoiceSchemas";
import { removeTemplate, saveTemplate } from "@/lib/accounting/invoiceStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.2 (Notion sprint) · recurring invoice templates: most lead invoices are the same shape every
 * month, so a template makes this month's one three fields. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(1_000_000_000_00);
const body = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  vendor_id: uuid.nullable(),
  partner_id: uuid.nullable(),
  tax_cents: cents,
  lines: z.array(z.object({
    description: z.string().trim().min(1).max(300),
    campaign_id: uuid.nullable(),
    lead_type: z.enum(LEAD_TYPES),
    unit_price_cents: cents,
    amount_cents: cents.nullable().optional(),
  }).strict()).min(1).max(20),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the template and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  const b = parsed.data;
  try {
    const id = await saveTemplate(tenantId, userId, {
      id: b.id, name: b.name, vendorId: b.vendor_id, partnerId: b.partner_id, taxCents: b.tax_cents,
      lines: b.lines.map((l) => ({ description: l.description, campaignId: l.campaign_id, leadType: l.lead_type, unitPriceCents: l.unit_price_cents, amountCents: l.amount_cents ?? null })),
    });
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_template_saved", targetType: "vendor_invoice_template", targetId: id, metadata: { tenantId }, request });
    return NextResponse.json({ id }, { status: b.id ? 200 : 201 });
  } catch (error) {
    return invoiceFail(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { tenantId, userId } = auth.context;
  try {
    await removeTemplate(tenantId, id);
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_template_saved", targetType: "vendor_invoice_template", targetId: id, metadata: { tenantId, removed: true }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return invoiceFail(error);
  }
}
