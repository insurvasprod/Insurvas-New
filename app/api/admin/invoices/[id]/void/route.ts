import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { voidInvoiceWith, type VoidableInvoice } from "@/lib/invoices/voidFlow";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
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
    .from("platform_invoices")
    .select("id, number, status, tenant_id, total_cents, provider_invoice_id, pay_online_url")
    .eq("id", id)
    .maybeSingle<VoidableInvoice>();

  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  // Voiding changes the status only. The number, the lines and the amounts are untouched — the
  // record of what was billed survives, and the number is never reissued. The provider's copy is
  // voided first so its pay link dies with ours; see lib/invoices/voidFlow.ts.
  const outcome = await voidInvoiceWith(invoice, parsed.data.reason, {
    async paidCents(invoiceId) {
      const { data, error } = await supabase
        .from("payments")
        .select("amount_cents")
        .eq("invoice_id", invoiceId)
        .eq("status", "succeeded");
      if (error) throw new Error(`Could not read the payments on this invoice: ${error.message}`);
      return (data ?? []).reduce((sum, payment) => sum + payment.amount_cents, 0);
    },
    voidProviderInvoice: process.env.WHOP_API_KEY
      ? async (providerInvoiceId, tenantId) => {
          const provider = buildProvider("whop", { tenantId });
          if (!(provider instanceof WhopProvider)) throw new Error("Voiding a pay-online invoice requires the Whop provider");
          await provider.voidInvoice(providerInvoiceId);
        }
      : undefined,
    async markVoid({ id: invoiceId, expectedStatus, reason, voidedAt }) {
      // Conditional on the status the refusal check read: an invoice paid in between is not
      // voided over its payment. The pay link goes with it.
      const { data, error } = await supabase
        .from("platform_invoices")
        .update({ status: "void", voided_at: voidedAt, void_reason: reason, pay_online_url: null })
        .eq("id", invoiceId)
        .eq("status", expectedStatus as never)
        .select("id");
      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    },
  }).catch((error: unknown) => {
    console.error("[invoices] void failed", id, error);
    return { ok: false as const, status: 500 as const, error: "Could not void the invoice" };
  });

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  await audit({
    actorId: auth.session.sub,
    action: "invoice.voided",
    targetType: "invoice",
    targetId: id,
    reason: parsed.data.reason,
    metadata: {
      number: invoice.number,
      tenantId: invoice.tenant_id,
      totalCents: invoice.total_cents,
      providerInvoiceId: invoice.provider_invoice_id,
      providerVoided: outcome.providerVoided,
    },
    request,
  });

  return NextResponse.json({ ok: true });
}
