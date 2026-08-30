import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { createCustomInvoice } from "@/lib/invoices/custom";
import { parseDollarsToCents } from "@/lib/money";
import { audit } from "@/lib/audit/log";

const schema = z.object({
  tenant_id: z.string().uuid(),
  subscription_id: z.string().uuid().nullable().optional(),
  // Mandatory: billing someone an arbitrary amount without recording why is the first thing an
  // auditor asks about.
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
  due_at: z.string().datetime().nullable().optional(),
  lines: z
    .array(z.object({ label: z.string().trim().min(1).max(200), amount: z.string().trim().min(1) }))
    .min(1, "Add at least one line"),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const lines = [];
  for (const line of parsed.data.lines) {
    const cents = parseDollarsToCents(line.amount);
    if (cents === null || cents <= 0) {
      return NextResponse.json({ error: `"${line.label}" needs an amount like 500.00` }, { status: 400 });
    }
    lines.push({ kind: "plan" as const, label: line.label, quantity: 1, unit_cents: cents, amount_cents: cents });
  }

  try {
    const result = await createCustomInvoice({
      tenantId: parsed.data.tenant_id,
      subscriptionId: parsed.data.subscription_id ?? null,
      reason: parsed.data.reason,
      dueAt: parsed.data.due_at ?? null,
      lines,
      createdBy: auth.session.sub,
    });

    await audit({
      actorId: auth.session.sub,
      action: "invoice.custom_created",
      targetType: "invoice",
      targetId: result.invoiceId,
      reason: parsed.data.reason,
      metadata: {
        number: result.number,
        tenantId: parsed.data.tenant_id,
        totalCents: result.totalCents,
        lineCount: lines.length,
        sentForOnlinePayment: result.payOnlineUrl !== null,
      },
      request,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the invoice";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
