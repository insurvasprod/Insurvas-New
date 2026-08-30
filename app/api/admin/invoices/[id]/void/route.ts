import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES, voidRefusalReason } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

const schema = z.object({
  // Mandatory, and long enough to be a reason rather than a keystroke. A void with no explanation
  // is the thing an auditor asks about first.
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, number, status, tenant_id, total_cents")
    .eq("id", id)
    .maybeSingle<{ id: string; number: string; status: string; tenant_id: string; total_cents: number }>();

  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const refusal = voidRefusalReason(invoice.status);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  // Voiding changes the status only. The number, the lines and the amounts are untouched — the
  // record of what was billed survives, and the number is never reissued.
  const { error } = await supabase
    .from("invoices")
    .update({ status: "void", voided_at: new Date().toISOString(), void_reason: parsed.data.reason })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Could not void the invoice" }, { status: 500 });

  await audit({
    actorId: auth.session.sub,
    action: "invoice.voided",
    targetType: "invoice",
    targetId: id,
    reason: parsed.data.reason,
    metadata: { number: invoice.number, tenantId: invoice.tenant_id, totalCents: invoice.total_cents },
    request,
  });

  return NextResponse.json({ ok: true });
}
