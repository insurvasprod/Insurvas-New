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
    .select("id, number, tenant_id, total_cents")
    .eq("id", id)
    .maybeSingle<{ id: string; number: string; tenant_id: string; total_cents: number }>();

  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  // bugs_sa.md M3-4. This was five separate statements — payment insert, invoice update,
  // subscription update, entitlement rebuild — with the update errors ignored. A partial failure
  // left a recorded payment against an unpaid invoice, and the retry was then refused by the
  // unique index on the bank reference: money recorded, invoice never settled, no way to fix it
  // from the UI. It also activated EVERY subscription belonging to the tenant and accepted more
  // than the outstanding balance.
  const { data: result, error: settleError } = await supabase.rpc("admin_settle_invoice_manually", {
    p_invoice_id: invoice.id,
    p_amount_cents: amountCents,
    p_reference: parsed.data.reference,
    p_paid_at: parsed.data.paid_at ?? null,
    p_recorded_by: auth.session.sub,
  });

  if (settleError) {
    // The unique index on (tenant_id, manual_reference) is what makes "recording the same payment
    // twice is rejected" true, rather than relying on the admin noticing.
    if (settleError.code === "23505") {
      return NextResponse.json(
        { error: `A payment with reference "${parsed.data.reference}" is already recorded for this tenant` },
        { status: 409 },
      );
    }
    // Refusals the function raises deliberately — already paid, void, over the outstanding
    // balance — are the caller's problem to fix, not a server fault.
    if (settleError.code === "23514" || /already paid|void invoice|more than the|more than zero/.test(settleError.message)) {
      return NextResponse.json({ error: settleError.message }, { status: 409 });
    }
    console.error("[invoices] manual settlement failed", invoice.id, settleError);
    return NextResponse.json({ error: "Could not record the payment" }, { status: 500 });
  }

  const row = Array.isArray(result) ? result[0] : result;
  if (!row) return NextResponse.json({ error: "Could not record the payment" }, { status: 500 });

  const settled = row.settled;
  const paidCents = row.paid_cents;

  // Outside the transaction on purpose: the entitlement is a cache, and failing the settlement
  // because the cache could not be rebuilt would undo money that has genuinely been received.
  // rebuildEntitlement logs loudly and tenant_entitlements.version makes staleness detectable.
  if (row.subscription_activated) {
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
      subscriptionId: row.subscription_id,
      subscriptionActivated: row.subscription_activated,
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
