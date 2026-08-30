import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";
import { parseDollarsToCents } from "@/lib/money";
import { audit } from "@/lib/audit/log";

const schema = z.object({
  /** Dollars as typed. Parsed as a string so no float ever touches the amount. */
  amount: z.string().trim().min(1),
  /** The bank reference. Doubles as the idempotency key, so it is mandatory. */
  reference: z.string().trim().min(3, "Give the bank reference").max(120),
  paid_at: z.string().datetime().optional(),
});

/**
 * SA-3.4 · Record money that arrived outside the provider — a wire, a cheque, a negotiated deal.
 *
 * The one admin action that asserts money exists without any external system agreeing, so it is
 * restricted, audit-logged with who did it and the reference, and idempotent on that reference.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  // Returns null rather than throwing on anything it cannot read as money.
  const amountCents = parseDollarsToCents(parsed.data.amount);
  if (amountCents === null) {
    return NextResponse.json({ error: "Enter an amount like 249.00" }, { status: 400 });
  }
  if (amountCents <= 0) {
    return NextResponse.json({ error: "The amount must be more than zero" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, number, status, tenant_id, total_cents")
    .eq("id", id)
    .maybeSingle<{ id: string; number: string; status: string; tenant_id: string; total_cents: number }>();

  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "paid") {
    return NextResponse.json({ error: "This invoice is already paid" }, { status: 409 });
  }
  if (invoice.status === "void") {
    return NextResponse.json({ error: "A void invoice cannot be paid" }, { status: 409 });
  }

  const { error: insertError } = await supabase.from("payments").insert({
    invoice_id: invoice.id,
    tenant_id: invoice.tenant_id,
    amount_cents: amountCents,
    method: "manual_bank_transfer",
    manual_reference: parsed.data.reference,
    recorded_by: auth.session.sub,
    paid_at: parsed.data.paid_at ?? new Date().toISOString(),
    status: "succeeded",
  });

  // The unique index on (tenant_id, manual_reference) is what makes "recording the same payment
  // twice is rejected" true, rather than relying on the admin noticing.
  if (insertError?.code === "23505") {
    return NextResponse.json(
      { error: `A payment with reference "${parsed.data.reference}" is already recorded for this tenant` },
      { status: 409 },
    );
  }
  if (insertError) {
    return NextResponse.json({ error: "Could not record the payment" }, { status: 500 });
  }

  // Everything received against this invoice, not just this payment — a second partial payment
  // must be able to complete an invoice the first one left short.
  const { data: payments } = await supabase
    .from("payments")
    .select("amount_cents")
    .eq("invoice_id", invoice.id)
    .eq("status", "succeeded");

  const paidCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0);
  const settled = paidCents >= invoice.total_cents;

  if (settled) {
    await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", invoice.id);

    // The subscription follows the money, and the entitlement follows the subscription — the
    // whole point of the ticket is that nobody has to remember to do this.
    await supabase
      .from("subscriptions")
      .update({ status: "active" })
      .eq("tenant_id", invoice.tenant_id);

    await rebuildEntitlement(invoice.tenant_id, "subscription.plan_changed");
  }

  await audit({
    actorId: auth.session.sub,
    action: "payment.recorded_manually",
    targetType: "invoice",
    targetId: invoice.id,
    reason: parsed.data.reference,
    metadata: {
      number: invoice.number,
      tenantId: invoice.tenant_id,
      amountCents,
      reference: parsed.data.reference,
      settled,
      paidToDateCents: paidCents,
    },
    request,
  });

  return NextResponse.json({
    ok: true,
    settled,
    paidCents,
    remainingCents: Math.max(0, invoice.total_cents - paidCents),
  });
}
