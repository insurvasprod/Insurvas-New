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
import type { Json } from "@/lib/supabase/database.types";
import {
  claimSubscriptionMutation,
  completeSubscriptionMutation,
  normalizeIdempotencyKey,
} from "@/lib/subscriptions/idempotency";

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

  const idempotency = normalizeIdempotencyKey(request.headers.get("Idempotency-Key"));
  if (idempotency.error) return NextResponse.json({ error: idempotency.error }, { status: 400 });
  if (!idempotency.key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = assignSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { tenant_id, plan_id, billing_cycle, start_at } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const claim = await claimSubscriptionMutation({
    actorId: auth.session.sub,
    idempotencyKey: idempotency.key,
    operation: "subscription.assign",
    requestBody: parsed.data,
  });
  if (claim.kind === "replay") {
    return NextResponse.json(claim.body, {
      status: claim.status,
      headers: { "Idempotency-Key": idempotency.key, "Idempotency-Replayed": "true" },
    });
  }
  if (claim.kind === "conflict") return NextResponse.json({ error: claim.message }, { status: 409 });

  const finish = async (responseBody: Json, status: number, outcome: "succeeded" | "failed") => {
    await completeSubscriptionMutation(claim.id, outcome, status, responseBody);
    return NextResponse.json(responseBody, { status, headers: { "Idempotency-Key": idempotency.key! } });
  };

  const { data: subscriptionId, error } = await supabase.rpc("admin_assign_subscription", {
    p_tenant_id: tenant_id,
    p_plan_id: plan_id,
    p_billing_cycle: billing_cycle,
    p_start: start_at ?? new Date().toISOString(),
  });

  if (error) {
    if (error.message?.includes("already_subscribed")) {
      return finish(
        { error: "This tenant already has a live subscription — change their plan instead" },
        409,
        "failed",
      );
    }
    if (error.message?.includes("cycle_not_offered")) {
      return finish({ error: "That plan isn't sold on that billing cycle" }, 400, "failed");
    }
    return finish({ error: "Could not assign the subscription" }, 500, "failed");
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

  return finish({ subscriptionId }, 201, "succeeded");
}
