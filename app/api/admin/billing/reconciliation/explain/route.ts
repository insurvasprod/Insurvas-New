import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { EXPLANATIONS_TABLE, isMissingRelation } from "@/lib/invoices/reconcileQueries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

const schema = z.object({
  invoice_id: z.string().uuid().nullable().optional(),
  payment_id: z.string().uuid().nullable().optional(),
  note: z.string().trim().min(3, "Say why in at least 3 characters").max(1000),
}).refine((value) => Boolean(value.invoice_id) !== Boolean(value.payment_id), { message: "Explain one invoice or one payment" });

/**
 * POST /api/admin/billing/reconciliation/explain — settle a reconciliation row by explaining it (billing-r2
 * screen 7, "mark explained with a note"). The same people who may settle by credit note or payment
 * (CAN_VOID_INVOICES). Append-only: a second explanation supersedes the first on screen; both stay.
 *
 * Needs migration 20261117452000_billing_reconciliation_explanations. Until it is applied this answers 503
 * "needs a database update" and nothing is written, so the page can say so instead of pretending.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { invoice_id: invoiceId = null, payment_id: paymentId = null, note } = parsed.data;

  const db = getSupabaseServiceClient();
  // The target must exist and be one the page lists: a mismatched invoice, or a provider payment with no invoice.
  if (invoiceId) {
    const { data } = await db.from("platform_invoices").select("id, number, reconciliation, tenant_id").eq("id", invoiceId).maybeSingle();
    if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (data.reconciliation !== "mismatched") return NextResponse.json({ error: `${data.number} matches the provider, so there is nothing to explain` }, { status: 409 });
  } else {
    const { data } = await db.from("payments").select("id, invoice_id, method").eq("id", paymentId!).maybeSingle();
    if (!data) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    if (data.invoice_id || data.method !== "provider") return NextResponse.json({ error: "That payment belongs to an invoice, so there is nothing to explain" }, { status: 409 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the table is not in the generated types yet
  const { data: row, error } = await (db as any).from(EXPLANATIONS_TABLE)
    .insert({ invoice_id: invoiceId, payment_id: paymentId, note, explained_by: auth.session.sub })
    .select("id")
    .single();
  if (error) {
    if (isMissingRelation(error)) return NextResponse.json({ error: "Marking a row explained needs a database update that has not been applied yet." }, { status: 503 });
    console.error("[reconciliation] explain failed:", error);
    return NextResponse.json({ error: "Could not save the explanation" }, { status: 500 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "invoice.reconciliation_explained",
    targetType: invoiceId ? "invoice" : "payment",
    targetId: (invoiceId ?? paymentId)!,
    reason: note,
    metadata: { explanationId: row.id, invoiceId, paymentId },
    request,
  });

  return NextResponse.json({ ok: true, message: "Marked explained" }, { status: 201 });
}
