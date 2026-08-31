import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { changePlanSchema, cancelSubscriptionSchema, pauseSubscriptionSchema } from "@/lib/subscriptions/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";
import { settleMidPeriodPlanChange } from "@/lib/billing/planChange";

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

      // Backlog #41: an immediate change mid-period has a price, and until now nobody paid it.
      // The difference is parked as a pending charge and collected on the next invoice, and the
      // old membership is stopped from renewing at the old price. A queued change needs none of
      // this — it takes effect exactly at the boundary, where there is nothing to prorate.
      const proration = result.applied_now
        ? await settleMidPeriodPlanChange({
            subscriptionId: id,
            fromPlanId: existing.plan_id,
            toPlanId: parsed.data.plan_id,
            createdBy: auth.session.sub,
          })
        : null;

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
          // The money is part of the record. An upgrade that charged the customer $122.58 and an
          // upgrade that charged nothing must be distinguishable afterwards without re-deriving it.
          proration: proration
            ? {
                netCents: proration.netCents,
                creditCents: proration.creditCents,
                chargeCents: proration.chargeCents,
                remainingDays: proration.remainingDays,
                pendingChargeIds: proration.pendingChargeIds,
                note: proration.note,
                providerWarning: proration.providerWarning,
              }
            : null,
        },
        request,
      });

      return NextResponse.json({
        appliedNow: result.applied_now,
        effectiveAt: result.effective_at,
        proration: proration
          ? {
              netCents: proration.netCents,
              creditCents: proration.creditCents,
              chargeCents: proration.chargeCents,
              remainingDays: proration.remainingDays,
              note: proration.note,
              warning: proration.providerWarning,
            }
          : null,
      });
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

      // bugs_sa.md M2-5. This was a bare status write, so `resume` acted as a universal
      // "make it active" and one crafted request restored full access to a cancelled
      // subscription. The transition graph now lives in the database, locked, and refuses
      // anything the UI would not have offered.
      const { error } = await supabase.rpc("admin_set_subscription_pause_state", {
        p_subscription_id: id,
        p_pause: pausing,
      });

      if (error) {
        // check_violation is the guard refusing an invalid transition — a 409 with the reason,
        // not a 500, because nothing went wrong on our side.
        if (error.code === "23514" || /cannot be paused|can be resumed/.test(error.message)) {
          return NextResponse.json({ error: error.message }, { status: 409 });
        }
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
