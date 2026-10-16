import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { EXPENSE_CATEGORIES } from "@/lib/accounting/expensesCore";
import { attachReceipt, classifyExpense, confirmExpense, ExpenseError, markExpensePaid, receiptUrl, updateExpense, voidExpense } from "@/lib/accounting/expenseStore";
import { PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.3 (Notion sprint) · one expense: edit a template (future months only) or an unconfirmed
 * instance; confirm (books it), mark paid, void (reverses), set acquisition or overhead; the receipt.
 * Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const edit = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  vendor_name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  amount_cents: z.number().int().min(1).max(1_000_000_000_00).optional(),
  incurred_on: isoDate.optional(),
  recurrence_end_on: isoDate.nullable().optional(),
}).strict();

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }).strict(),
  z.object({ action: z.literal("void"), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal("paid"), paid_on: isoDate, method: z.enum(PAID_METHODS).nullable(), reference: z.string().trim().max(200).nullable() }).strict(),
  z.object({ action: z.literal("classify"), is_acquisition_cost: z.boolean() }).strict(),
]);

const fail = (error: unknown) => {
  if (error instanceof ExpenseError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[expenses]", error);
  return NextResponse.json({ error: "The expense could not be saved" }, { status: 500 });
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.redirect(await receiptUrl(auth.context.tenantId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { tenantId, userId } = auth.context;
  try {
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const file = (await request.formData().catch(() => null))?.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
      await attachReceipt(tenantId, id, file);
    } else {
      const parsed = edit.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the expense and try again." }, { status: 400 });
      const b = parsed.data;
      await updateExpense(tenantId, id, { category: b.category, vendorName: b.vendor_name, description: b.description, amountCents: b.amount_cents, incurredOn: b.incurred_on, recurrenceEndOn: b.recurrence_end_on });
    }
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.expense_saved", targetType: "expense", targetId: id, metadata: { tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
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
    if (b.action === "confirm") {
      await confirmExpense(tenantId, id, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.expense_confirmed", targetType: "expense", targetId: id, metadata: { tenantId }, request });
    } else if (b.action === "void") {
      const reversed = await voidExpense(tenantId, id, b.reason, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.expense_voided", targetType: "expense", targetId: id, metadata: { tenantId, reversed }, request });
    } else if (b.action === "paid") {
      await markExpensePaid(tenantId, id, { paidOn: b.paid_on, method: b.method, reference: b.reference });
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.expense_saved", targetType: "expense", targetId: id, metadata: { tenantId, paidOn: b.paid_on }, request });
    } else {
      await classifyExpense(tenantId, id, b.is_acquisition_cost);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.expense_saved", targetType: "expense", targetId: id, metadata: { tenantId, isAcquisitionCost: b.is_acquisition_cost }, request });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
