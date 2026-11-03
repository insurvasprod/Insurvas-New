import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { invoiceFail, invoiceSchema, toInput } from "@/lib/accounting/invoiceSchemas";
import { approveInvoice, getInvoice, markInvoicePaid, setDisputed, updateInvoice, voidInvoice } from "@/lib/accounting/invoiceStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.2 (Notion sprint) · one vendor invoice: read it with its comparison and ledger entries, edit
 * it while it is a draft, and move it — approve (books the cost), paid (records when money moved),
 * void (reverses), dispute. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }).strict(),
  z.object({ action: z.literal("paid"), paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.enum(PAID_METHODS).nullable(), reference: z.string().trim().max(200).nullable() }).strict(),
  z.object({ action: z.literal("void"), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal("dispute"), note: z.string().trim().max(2000).nullable() }).strict(),
  z.object({ action: z.literal("undispute") }).strict(),
]);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ invoice: await getInvoice(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invoiceFail(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = invoiceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the invoice and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    await updateInvoice(tenantId, id, toInput(parsed.data));
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_saved", targetType: "vendor_invoice", targetId: id, metadata: { tenantId }, request });
    return NextResponse.json({ invoice: await getInvoice(tenantId, id) });
  } catch (error) {
    return invoiceFail(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Unknown action." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  const b = parsed.data;
  try {
    let result: unknown = null;
    if (b.action === "approve") {
      result = await approveInvoice(tenantId, id, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_approved", targetType: "vendor_invoice", targetId: id, metadata: { tenantId, ...(result as object) }, request });
    } else if (b.action === "paid") {
      result = await markInvoicePaid(tenantId, id, { paidOn: b.paid_on, method: b.method, reference: b.reference }, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_paid", targetType: "vendor_invoice", targetId: id, metadata: { tenantId, paidOn: b.paid_on, method: b.method }, request });
    } else if (b.action === "void") {
      result = await voidInvoice(tenantId, id, b.reason, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_voided", targetType: "vendor_invoice", targetId: id, metadata: { tenantId, reversed: result }, request });
    } else {
      await setDisputed(tenantId, id, b.action === "dispute", b.action === "dispute" ? b.note : null);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_disputed", targetType: "vendor_invoice", targetId: id, metadata: { tenantId, disputed: b.action === "dispute" }, request });
    }
    return NextResponse.json({ result, invoice: await getInvoice(tenantId, id) });
  } catch (error) {
    return invoiceFail(error);
  }
}
