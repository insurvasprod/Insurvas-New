import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { EXPENSE_CATEGORIES, RECURRENCES } from "@/lib/accounting/expensesCore";
import { acquisitionDefaults, createExpense, ExpenseError, generateRecurring, listExpenses } from "@/lib/accounting/expenseStore";
import { PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.3 (Notion sprint) · expenses: the list (recurring templates brought up to date first, their
 * new instances unconfirmed) and entering one. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  vendor_name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable(),
  amount_cents: z.number().int().min(1).max(1_000_000_000_00),
  incurred_on: isoDate,
  recurrence: z.enum(RECURRENCES),
  recurrence_end_on: isoDate.nullable(),
  is_acquisition_cost: z.boolean().nullable(),
  paid_on: isoDate.nullable().optional(),
  paid_method: z.enum(PAID_METHODS).nullable().optional(),
  payment_reference: z.string().trim().max(200).nullable().optional(),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof ExpenseError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[expenses]", error);
  return NextResponse.json({ error: "The expense could not be saved" }, { status: 500 });
};

export async function GET() {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  try {
    await generateRecurring(tenantId);
    const [expenses, defaults] = await Promise.all([listExpenses(tenantId), acquisitionDefaults(tenantId)]);
    return NextResponse.json({ expenses, defaults }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the expense and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId } = auth.context;
  try {
    const result = await createExpense(tenantId, userId, {
      category: b.category, vendorName: b.vendor_name, description: b.description, amountCents: b.amount_cents, incurredOn: b.incurred_on,
      recurrence: b.recurrence, recurrenceEndOn: b.recurrence_end_on, isAcquisitionCost: b.is_acquisition_cost,
      paidOn: b.paid_on ?? null, paidMethod: b.paid_method ?? null, paymentReference: b.payment_reference ?? null,
    });
    await audit({ actorType: "tenant", actorId: userId, action: b.recurrence === "one_off" ? "accounting.expense_confirmed" : "accounting.expense_saved", targetType: "expense", targetId: result.id, metadata: { tenantId, category: b.category, recurrence: b.recurrence }, request });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
