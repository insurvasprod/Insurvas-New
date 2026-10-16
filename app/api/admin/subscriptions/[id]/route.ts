import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { changePlanSchema, cancelSubscriptionSchema, pauseSubscriptionSchema, resumeSubscriptionSchema } from "@/lib/subscriptions/schemas";
import { changePlanErrorResponse, queuedAsDowngrade } from "@/lib/subscriptions/mutationErrors";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { settleMidPeriodPlanChange } from "@/lib/billing/planChange";
import type { Json } from "@/lib/supabase/database.types";
import {
  claimSubscriptionMutation,
  completeSubscriptionMutation,
  normalizeIdempotencyKey,
  type SubscriptionMutationOperation,
} from "@/lib/subscriptions/idempotency";

const actionSchema = z.object({ action: z.enum(["change_plan", "cancel", "pause", "resume"]) });

/** One endpoint per subscription, dispatching on `action`, so every path shares the audit wiring
 *  rather than four routes each remembering to do it.
 *
 *  The entitlement rebuild is no longer a step here: every function below rebuilds it in its own
 *  transaction when access changes now (20261015600000), so a failed rebuild undoes the change
 *  instead of committing it and failing afterwards. What runs after the commit (proration, the audit
 *  row) is caught and reported, so the idempotency claim always resolves. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const idempotency = normalizeIdempotencyKey(request.headers.get("Idempotency-Key"));
  if (idempotency.error) return NextResponse.json({ error: idempotency.error }, { status: 400 });
  if (!idempotency.key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });

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

  const operationByAction: Record<string, SubscriptionMutationOperation> = {
    change_plan: "subscription.change_plan",
    cancel: "subscription.cancel",
    pause: "subscription.pause",
    resume: "subscription.resume",
  };
  const claim = await claimSubscriptionMutation({
    actorId: auth.session.sub,
    idempotencyKey: idempotency.key,
    operation: operationByAction[actionParsed.data.action],
    resourceId: id,
    requestBody: body,
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

  // After the commit: record, never throw past finish().
  const warnings: string[] = [];
  const recordAudit = async (params: Parameters<typeof audit>[0]) => {
    try {
      await audit(params);
    } catch (auditError) {
      console.error(`[subscriptions] audit failed after ${params.action}`, auditError);
      warnings.push("The change was saved but its audit entry could not be written.");
    }
  };
  const withWarnings = (responseBody: Record<string, Json>): Json =>
    warnings.length ? { ...responseBody, warning: warnings.join(" ") } : responseBody;

  switch (actionParsed.data.action) {
    case "change_plan": {
      const parsed = changePlanSchema.safeParse(body);
      if (!parsed.success) {
        return finish({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400, "failed");
      }

      const { data, error } = await supabase.rpc("admin_change_subscription_plan", {
        p_subscription_id: id,
        p_new_plan_id: parsed.data.plan_id,
        p_apply_now: parsed.data.apply_now,
      });

      if (error) {
        const mapped = changePlanErrorResponse(error);
        if (mapped.status === 500) console.error("[subscriptions] change plan failed", error);
        return finish({ error: mapped.error }, mapped.status, "failed");
      }

      const result = Array.isArray(data) ? data[0] : data;
      // The database decided the timing from the prices; a downgrade asked for "now" was queued.
      const downgradeQueued = queuedAsDowngrade(parsed.data.apply_now, result.applied_now);

      // Backlog #41: an immediate change mid-period has a price, and until now nobody paid it.
      // The difference is parked as a pending charge and collected on the next invoice, and the
      // old membership is stopped from renewing at the old price. A queued change needs none of
      // this — it takes effect exactly at the boundary, where there is nothing to prorate.
      let proration: Awaited<ReturnType<typeof settleMidPeriodPlanChange>> | null = null;
      if (result.applied_now) {
        try {
          proration = await settleMidPeriodPlanChange({
            subscriptionId: id,
            fromPlanId: existing.plan_id,
            toPlanId: parsed.data.plan_id,
            createdBy: auth.session.sub,
          });
        } catch (settleError) {
          // The plan has moved; the difference was not parked. Said, and recorded, so it is billed by hand.
          console.error("[subscriptions] proration failed after plan change", settleError);
          warnings.push("The plan changed, but the mid-period difference could not be calculated — raise it as a manual charge.");
        }
      }

      await recordAudit({
        actorId: auth.session.sub,
        action: "subscription.plan_changed",
        targetType: "subscription",
        targetId: id,
        reason: parsed.data.reason,
        metadata: {
          tenantId: existing.tenant_id,
          plan: { from: existing.plan_id, to: parsed.data.plan_id },
          appliedNow: result.applied_now,
          requestedNow: parsed.data.apply_now,
          downgradeQueued,
          effectiveAt: result.effective_at,
          ...(warnings.length ? { warnings: [...warnings] } : {}),
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

      return finish(
        withWarnings({
          appliedNow: result.applied_now,
          downgradeQueued,
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
        }),
        200,
        "succeeded",
      );
    }

    case "cancel": {
      const parsed = cancelSubscriptionSchema.safeParse(body);
      if (!parsed.success) {
        return finish({ error: parsed.error.issues[0]?.message ?? "A reason is required" }, 400, "failed");
      }

      const { data, error } = await supabase.rpc("admin_cancel_subscription", {
        p_subscription_id: id,
        p_reason: parsed.data.reason,
        p_immediate: parsed.data.immediate,
      });

      if (error) {
        if (/subscription_state_not_cancellable|plan_archived|plan_not_found/.test(error.message ?? "")) {
          return finish({ error: "That subscription cannot be cancelled in its current state" }, 409, "failed");
        }
        console.error("[subscriptions] cancel failed", error);
        return finish({ error: "Could not cancel the subscription" }, 500, "failed");
      }

      const result = Array.isArray(data) ? data[0] : data;

      await recordAudit({
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

      return finish(withWarnings({ cancelledNow: result.cancelled_now, effectiveAt: result.effective_at }), 200, "succeeded");
    }

    case "pause":
    case "resume": {
      const pausing = actionParsed.data.action === "pause";
      const parsed = (pausing ? pauseSubscriptionSchema : resumeSubscriptionSchema).safeParse(body);
      if (!parsed.success) {
        return finish({ error: parsed.error.issues[0]?.message ?? "A reason is required" }, 400, "failed");
      }
      const reason = parsed.data.reason;

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
          return finish({ error: error.message }, 409, "failed");
        }
        console.error(`[subscriptions] ${pausing ? "pause" : "resume"} failed`, error);
        return finish({ error: `Could not ${pausing ? "pause" : "resume"} the subscription` }, 500, "failed");
      }

      // Pausing drops the tenant to read-only; the function rebuilt the entitlement in its own
      // transaction, so it has already changed.
      await recordAudit({
        actorId: auth.session.sub,
        action: pausing ? "subscription.paused" : "subscription.resumed",
        targetType: "subscription",
        targetId: id,
        reason,
        metadata: { tenantId: existing.tenant_id, status: { from: existing.status, to: pausing ? "paused" : "active" } },
        request,
      });

      return finish(withWarnings({ ok: true }), 200, "succeeded");
    }
  }
}
