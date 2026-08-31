import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { fetchSubscriptions } from "@/lib/subscriptions/queries";
import { assignSubscriptionSchema } from "@/lib/subscriptions/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";
import { applyAutoOffer } from "@/lib/offers/service";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const status = params.get("status") as SubscriptionStatus | null;
  const planId = params.get("planId");

  try {
    const subscriptions = await fetchSubscriptions({
      status: status ?? undefined,
      planId: planId ?? undefined,
    });
    return NextResponse.json({ subscriptions });
  } catch {
    return NextResponse.json({ error: "Could not load subscriptions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = assignSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { tenant_id, plan_id, billing_cycle, start_at } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data: subscriptionId, error } = await supabase.rpc("admin_assign_subscription", {
    p_tenant_id: tenant_id,
    p_plan_id: plan_id,
    p_billing_cycle: billing_cycle,
    p_start: start_at ?? new Date().toISOString(),
  });

  if (error) {
    if (error.message?.includes("already_subscribed")) {
      return NextResponse.json(
        { error: "This tenant already has a live subscription — change their plan instead" },
        { status: 409 },
      );
    }
    if (error.message?.includes("cycle_not_offered")) {
      return NextResponse.json({ error: "That plan isn't sold on that billing cycle" }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not assign the subscription" }, { status: 500 });
  }

  // Awaited before responding, so the agent's next page load already reflects it (SA-2.7).
  await rebuildEntitlement(tenant_id, "subscription.assigned");

  const autoOfferId = await applyAutoOffer(subscriptionId as unknown as string);
  if (autoOfferId) {
    await audit({
      actorId: auth.session.sub,
      action: "offer.applied",
      targetType: "subscription",
      targetId: subscriptionId as unknown as string,
      metadata: { offerId: autoOfferId, application: "auto" },
      request,
    });
  }

  await audit({
    actorId: auth.session.sub,
    action: "subscription.assigned",
    targetType: "subscription",
    targetId: subscriptionId as unknown as string,
    metadata: { tenantId: tenant_id, planId: plan_id, billingCycle: billing_cycle },
    request,
  });

  return NextResponse.json({ subscriptionId }, { status: 201 });
}
