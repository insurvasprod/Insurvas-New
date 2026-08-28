import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { changePlanSchema, cancelSubscriptionSchema, pauseSubscriptionSchema } from "@/lib/subscriptions/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";

const actionSchema = z.object({ action: z.enum(["change_plan", "cancel", "pause", "resume"]) });

/** One endpoint per subscription, dispatching on `action`, so every path shares the audit and
 *  entitlement-rebuild wiring rather than four routes each remembering to do it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const actionParsed = actionSchema.safeParse(body);
  if (!actionParsed.success) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, plan_id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; tenant_id: string; plan_id: string; status: string }>();

  if (!existing) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  switch (actionParsed.data.action) {
    case "change_plan": {
      const parsed = changePlanSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
      }

      const { data, error } = await supabase.rpc("admin_change_subscription_plan", {
        p_subscription_id: id,
        p_new_plan_id: parsed.data.plan_id,
        p_apply_now: parsed.data.apply_now,
      });

      if (error) {
        if (error.message?.includes("cycle_not_offered")) {
          return NextResponse.json(
            { error: "That plan isn't sold on this subscription's billing cycle" },
            { status: 400 },
          );
        }
        return NextResponse.json({ error: "Could not change the plan" }, { status: 500 });
      }

      const result = Array.isArray(data) ? data[0] : data;

      // Only rebuild when something actually changed now; a queued downgrade changes nothing
      // until the period rolls, and rebuilding early would revoke access they still paid for.
      if (result.applied_now) {
        await rebuildEntitlement(existing.tenant_id, "subscription.plan_changed");
      }

      await audit({
        actorId: auth.session.sub,
        action: "subscription.plan_changed",
        targetType: "subscription",
        targetId: id,
        metadata: {
          tenantId: existing.tenant_id,
          plan: { from: existing.plan_id, to: parsed.data.plan_id },
          appliedNow: result.applied_now,
          effectiveAt: result.effective_at,
        },
        request,
      });

      return NextResponse.json({ appliedNow: result.applied_now, effectiveAt: result.effective_at });
    }

    case "cancel": {
      const parsed = cancelSubscriptionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "A reason is required" }, { status: 400 });
      }

      const { data, error } = await supabase.rpc("admin_cancel_subscription", {
        p_subscription_id: id,
        p_reason: parsed.data.reason,
        p_immediate: parsed.data.immediate,
      });

      if (error) return NextResponse.json({ error: "Could not cancel the subscription" }, { status: 500 });

      const result = Array.isArray(data) ? data[0] : data;
      if (result.cancelled_now) {
        await rebuildEntitlement(existing.tenant_id, "subscription.cancelled");
      }

      await audit({
        actorId: auth.session.sub,
        action: "subscription.cancelled",
        targetType: "subscription",
        targetId: id,
        reason: parsed.data.reason,
        metadata: {
          tenantId: existing.tenant_id,
          immediate: parsed.data.immediate,
          effectiveAt: result.effective_at,
        },
        request,
      });

      return NextResponse.json({ cancelledNow: result.cancelled_now, effectiveAt: result.effective_at });
    }

    case "pause":
    case "resume": {
      const pausing = actionParsed.data.action === "pause";
      let reason: string | undefined;

      if (pausing) {
        const parsed = pauseSubscriptionSchema.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "A reason is required" }, { status: 400 });
        }
        reason = parsed.data.reason;
      }

      const { error } = await supabase
        .from("subscriptions")
        .update({ status: pausing ? "paused" : "active" })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: `Could not ${pausing ? "pause" : "resume"} the subscription` }, { status: 500 });
      }

      // Pausing drops the tenant to read-only, so the entitlement must change immediately.
      await rebuildEntitlement(existing.tenant_id, pausing ? "subscription.paused" : "subscription.resumed");

      await audit({
        actorId: auth.session.sub,
        action: pausing ? "subscription.paused" : "subscription.resumed",
        targetType: "subscription",
        targetId: id,
        reason,
        metadata: { tenantId: existing.tenant_id, status: { from: existing.status, to: pausing ? "paused" : "active" } },
        request,
      });

      return NextResponse.json({ ok: true });
    }
  }
}
