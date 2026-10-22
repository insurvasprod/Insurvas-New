import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { fetchSubscriptions } from "@/lib/subscriptions/queries";
import { assignSubscriptionSchema } from "@/lib/subscriptions/schemas";
import { assignErrorResponse } from "@/lib/subscriptions/mutationErrors";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
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

  const { tenant_id, plan_id, billing_cycle, start_at, reason } = parsed.data;
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

  // The assignment and its entitlement rebuild are one transaction inside the function, so once this
  // returns the tenant's next page load already reflects it (SA-2.7) — or nothing happened at all.
  const { data: subscriptionId, error } = await supabase.rpc("admin_assign_subscription", {
    p_tenant_id: tenant_id,
    p_plan_id: plan_id,
    p_billing_cycle: billing_cycle,
    p_start: start_at ?? new Date().toISOString(),
  });

  if (error) {
    const mapped = assignErrorResponse(error);
    if (mapped.status === 500) console.error("[subscriptions] assign failed", error);
    return finish({ error: mapped.error }, mapped.status, "failed");
  }
  const id = subscriptionId as unknown as string;

  // Everything below runs after the commit. Each step is recorded or reported, never allowed to throw
  // past finish(): an exception here used to leave the idempotency claim at "pending" forever and a
  // retry answered "already subscribed" with no audit row.
  const warnings: string[] = [];

  // A self-signup that staff plan by hand (a comp, a manual invoice) never passes checkout, which is
  // what normally sets the tenant active and its onboarding completed. Without this the owner, profile
  // already done, was sent back to checkout for the plan they chose at signup (QA 2026-10-22). Only
  // the post-profile states move: a tenant still on its business profile finishes that first.
  const { error: activateError } = await supabase
    .from("tenants")
    .update({ status: "active", onboarding_state: "completed" })
    .eq("id", tenant_id)
    .in("onboarding_state", ["ready_for_checkout", "awaiting_payment"]);
  if (activateError) {
    console.error("[subscriptions] could not complete onboarding after assign", activateError);
    warnings.push("The plan is assigned, but the tenant's signup could not be marked complete; they may still see checkout.");
  }

  let autoOfferId: string | null = null;
  try {
    autoOfferId = await applyAutoOffer(id);
  } catch (offerError) {
    console.error("[subscriptions] auto offer failed after assign", offerError);
    warnings.push("The automatic offer could not be applied; apply it from Offers if it should have been.");
  }

  try {
    if (autoOfferId) {
      await audit({
        actorId: auth.session.sub,
        action: "offer.applied",
        targetType: "subscription",
        targetId: id,
        metadata: { offerId: autoOfferId, application: "auto" },
        request,
      });
    }
    await audit({
      actorId: auth.session.sub,
      action: "subscription.assigned",
      targetType: "subscription",
      targetId: id,
      reason,
      metadata: { tenantId: tenant_id, planId: plan_id, billingCycle: billing_cycle, ...(warnings.length ? { warnings } : {}) },
      request,
    });
  } catch (auditError) {
    console.error("[subscriptions] audit failed after assign", auditError);
    warnings.push("The change was saved but its audit entry could not be written.");
  }

  return finish({ subscriptionId: id, ...(warnings.length ? { warning: warnings.join(" ") } : {}) }, 201, "succeeded");
}
