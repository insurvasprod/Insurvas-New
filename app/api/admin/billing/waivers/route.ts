import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_INVOICES } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

/**
 * Granting and revoking an overage waiver (backlog 44).
 *
 * A waiver forgives some or all of one meter's overage for one billing period, before the invoice
 * is raised. The alternative — letting the invoice go out and issuing a credit note against it —
 * is a different act with a different paper trail, and leaves the customer holding a bill for
 * something we had already agreed not to charge.
 *
 * Restricted to the same roles as invoices. A waiver moves money that has been earned back to the
 * customer; if somebody may not look at an invoice they may not forgive one.
 *
 * A waiver can only be revoked while it is unspent. Once the billing run has applied it the
 * invoice exists and is immutable, and the instrument for changing an issued invoice is a credit
 * note, not a retroactive edit to the thing that produced it.
 */
const grantSchema = z.object({
  subscription_id: z.string().uuid(),
  meter_key: z.string().min(1).max(120),
  period_start: z.string().datetime(),
  // Omitted or null forgives the whole overage line. A number caps it.
  max_cents: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(5).max(500),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const parsed = grantSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", detail: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = getSupabaseServiceClient();

  // The tenant comes from the subscription rather than from the request. A waiver naming one
  // tenant and a subscription belonging to another is not a case worth supporting, and taking it
  // from the caller is how it would happen.
  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, current_period_start")
    .eq("id", input.subscription_id)
    .maybeSingle();

  if (subscriptionError) {
    return NextResponse.json({ error: "Could not read the subscription" }, { status: 500 });
  }
  if (!subscription) {
    return NextResponse.json({ error: "That subscription does not exist" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("billing_waivers")
    .insert({
      tenant_id: subscription.tenant_id,
      subscription_id: subscription.id,
      meter_key: input.meter_key,
      period_start: input.period_start,
      max_cents: input.max_cents ?? null,
      reason: input.reason,
      created_by: auth.session.sub,
    })
    .select("id, meter_key, period_start, max_cents, reason")
    .single();

  if (error) {
    // 23505 is billing_waivers_one_per_meter_per_period. Two waivers for the same overage is an
    // argument rather than a policy, so the answer is to edit the one that exists.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This meter already has a waiver for that period. Revoke it first, or change its amount." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: `Could not grant the waiver: ${error.message}` }, { status: 500 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "billing.waiver_granted",
    targetType: "billing_waiver",
    targetId: data.id,
    reason: input.reason,
    metadata: {
      tenantId: subscription.tenant_id,
      subscriptionId: subscription.id,
      meterKey: input.meter_key,
      periodStart: input.period_start,
      maxCents: input.max_cents ?? null,
    },
    request,
  });

  return NextResponse.json({ waiver: data }, { status: 201 });
}

const revokeSchema = z.object({ id: z.string().uuid() });

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  // Delete filtered on consumed_at, rather than read-then-delete: two admins revoking while the
  // billing run is spending it must not both find it unspent.
  const { data, error } = await supabase
    .from("billing_waivers")
    .delete()
    .eq("id", parsed.data.id)
    .is("consumed_at", null)
    .select("id, meter_key, period_start, subscription_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Could not revoke the waiver: ${error.message}` }, { status: 500 });
  }
  if (!data) {
    // Either it never existed or the billing run already spent it. Both mean "there is nothing
    // here to revoke", and the second is the one worth explaining.
    return NextResponse.json(
      { error: "That waiver does not exist, or it has already been applied to an invoice. An issued invoice is changed with a credit note." },
      { status: 409 },
    );
  }

  await audit({
    actorId: auth.session.sub,
    action: "billing.waiver_revoked",
    targetType: "billing_waiver",
    targetId: data.id,
    metadata: { subscriptionId: data.subscription_id, meterKey: data.meter_key, periodStart: data.period_start },
    request,
  });

  return NextResponse.json({ revoked: data.id });
}
