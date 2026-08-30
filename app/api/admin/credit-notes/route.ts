import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { CreditNoteError, requestCreditNote } from "@/lib/credits/service";
import { CREDIT_NOTE_TYPES, CREDIT_REASONS } from "@/lib/credits/rules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { parseDollarsToCents } from "@/lib/money";
import { audit } from "@/lib/audit/log";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("credit_notes")
    .select("*, tenants(name), invoices(number)")
    .order("created_at", { ascending: false });

  if (request.nextUrl.searchParams.get("pending") === "true") {
    query = query.eq("status", "pending_approval");
  }

  const { data } = await query;
  return NextResponse.json({ creditNotes: data ?? [] });
}

const schema = z.object({
  tenant_id: z.string().uuid(),
  invoice_id: z.string().uuid().nullable().optional(),
  type: z.enum(CREDIT_NOTE_TYPES),
  amount: z.string().trim().min(1),
  reason_code: z.enum(CREDIT_REASONS),
  reason_text: z.string().trim().max(500).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const amountCents = parseDollarsToCents(parsed.data.amount);
  if (amountCents === null) {
    return NextResponse.json({ error: "Enter an amount like 124.50" }, { status: 400 });
  }

  try {
    const outcome = await requestCreditNote({
      tenantId: parsed.data.tenant_id,
      invoiceId: parsed.data.invoice_id ?? null,
      type: parsed.data.type,
      amountCents,
      reasonCode: parsed.data.reason_code,
      reasonText: parsed.data.reason_text ?? null,
      requestedBy: auth.session.sub,
      requesterRole: auth.session.role,
    });

    await audit({
      actorId: auth.session.sub,
      action: "credit_note.requested",
      targetType: "credit_note",
      targetId: outcome.id,
      reason: parsed.data.reason_text ?? parsed.data.reason_code,
      metadata: {
        number: outcome.number,
        tenantId: parsed.data.tenant_id,
        invoiceId: parsed.data.invoice_id ?? null,
        type: parsed.data.type,
        amountCents,
        reasonCode: parsed.data.reason_code,
        awaitingApproval: outcome.awaitingApproval,
        status: outcome.status,
      },
      request,
    });

    return NextResponse.json(outcome, { status: 201 });
  } catch (error) {
    if (error instanceof CreditNoteError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[credit-notes] request failed:", error);
    return NextResponse.json({ error: "Could not raise the credit note" }, { status: 500 });
  }
}
