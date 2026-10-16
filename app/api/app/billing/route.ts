import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/actions";
import { getEntitlement } from "@/lib/entitlements/get";
import {
  BillingActionError,
  currentSubscription,
  loadBillingView,
  planChangeImpact,
  selfCancel,
  selfChangePlan,
  selfPause,
  selfResume,
} from "@/lib/billing/selfService";
import type { Json } from "@/lib/supabase/database.types";
import {
  claimSubscriptionMutation,
  completeSubscriptionMutation,
  normalizeIdempotencyKey,
  type SubscriptionMutationOperation,
} from "@/lib/subscriptions/idempotency";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { recordSettingsChanges, type SettingsChange } from "@/lib/settingsAudit/record";

/**
 * Settings › Plan & billing (LA-8.5, Notion sprint). The agency owner's own subscription: the plan,
 * every limit with its usage, invoices, the dunning state, and the changes they can make — through
 * the same SA-2 functions the admin console uses, never a pricing or entitlement rule of its own.
 *
 * Owners only. Deliberately NOT a write-access route: a paused agency must be able to resume, and a
 * read-only one to read its invoices.
 *
 *   GET                 the view
 *   GET ?plan=<id>      what moving to that plan costs now and takes away (features, with the
 *                       agency's own record counts, and limits it would be over)
 *   POST                { action: change_plan | pause | resume | cancel }, with an Idempotency-Key
 */
export async function GET(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  try {
    const entitlement = await getEntitlement(tenantId);
    const plan = request.nextUrl.searchParams.get("plan");
    if (plan !== null) {
      if (!z.string().uuid().safeParse(plan).success) return NextResponse.json({ error: "Choose a plan" }, { status: 400 });
      const impact = await planChangeImpact(tenantId, entitlement, plan);
      if ("error" in impact) return NextResponse.json({ error: impact.error }, { status: 409 });
      return NextResponse.json(impact, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await loadBillingView(tenantId, entitlement), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[billing] failed to load", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Your billing could not be loaded" }, { status: 500 });
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change_plan"), plan_id: z.string().uuid() }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("cancel"),
    reason: z.string().trim().min(5, "Tell us why in a few words").max(500),
    pause_declined: z.boolean().default(false),
  }),
]);

const OPERATION: Record<z.infer<typeof actionSchema>["action"], SubscriptionMutationOperation> = {
  change_plan: "subscription.change_plan",
  pause: "subscription.pause",
  resume: "subscription.resume",
  cancel: "subscription.cancel",
};

export async function POST(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId } = auth.context;

  const idempotency = normalizeIdempotencyKey(request.headers.get("Idempotency-Key"));
  if (idempotency.error) return NextResponse.json({ error: idempotency.error }, { status: 400 });
  if (!idempotency.key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Unknown action" }, { status: 400 });
  const input = parsed.data;

  const { schemaReady } = await currentSubscription(tenantId);
  if (!schemaReady) return NextResponse.json({ error: "Changing your plan here needs a database update first." }, { status: 503 });

  // The same replay guard as the admin route: a double click, or a retry after a timeout, changes
  // the subscription once. Keyed per person, scoped to this agency.
  const claim = await claimSubscriptionMutation({ actorId: userId, idempotencyKey: idempotency.key, operation: OPERATION[input.action], resourceId: tenantId, requestBody: body });
  if (claim.kind === "replay") return NextResponse.json(claim.body, { status: claim.status, headers: { "Idempotency-Key": idempotency.key, "Idempotency-Replayed": "true" } });
  if (claim.kind === "conflict") return NextResponse.json({ error: claim.message }, { status: 409 });
  const finish = async (responseBody: Json, status: number, outcome: "succeeded" | "failed") => {
    await completeSubscriptionMutation(claim.id, outcome, status, responseBody);
    return NextResponse.json(responseBody, { status, headers: { "Idempotency-Key": idempotency.key! } });
  };
  const record = (action: AuditAction, targetId: string, metadata: Record<string, unknown>, reason?: string) =>
    audit({ actorType: "tenant", actorId: userId, action, targetType: "subscription", targetId, reason, metadata: { tenantId, selfService: true, ...metadata }, request });
  // LA-8.8: the owner's own changes also go in Settings › Settings history.
  const history = (change: SettingsChange, reason?: string) => recordSettingsChanges({ tenantId, actorId: userId, section: "billing", changes: [change], reason });

  try {
    switch (input.action) {
      case "change_plan": {
        const r = await selfChangePlan(tenantId, userId, input.plan_id);
        await record("subscription.plan_changed", r.subscriptionId, {
          plan: { from: r.fromPlanId, to: r.toPlanId },
          appliedNow: r.appliedNow,
          effectiveAt: r.effectiveAt,
          proration: r.proration ? { netCents: r.proration.netCents, creditCents: r.proration.creditCents, chargeCents: r.proration.chargeCents, remainingDays: r.proration.remainingDays, pendingChargeIds: r.proration.pendingChargeIds, note: r.proration.note, providerWarning: r.proration.providerWarning } : null,
        });
        await history({ key: "plan", label: r.appliedNow ? "Plan" : `Plan (from ${r.effectiveAt.slice(0, 10)})`, from: r.fromPlanName, to: r.toPlanName });
        return finish({ appliedNow: r.appliedNow, effectiveAt: r.effectiveAt, chargedNextInvoiceCents: r.proration?.netCents ?? null }, 200, "succeeded");
      }
      case "pause":
      case "resume": {
        const r = input.action === "pause" ? await selfPause(tenantId) : await selfResume(tenantId);
        await record(input.action === "pause" ? "subscription.paused" : "subscription.resumed", r.subscriptionId, { status: { from: r.from, to: input.action === "pause" ? "paused" : "active" }, providerWarning: r.providerWarning });
        await history({ key: "status", label: "Subscription", from: r.from, to: input.action === "pause" ? "paused" : "active" });
        return finish({ ok: true }, 200, "succeeded");
      }
      case "cancel": {
        const r = await selfCancel(tenantId, input.reason, input.pause_declined);
        await record("subscription.cancelled", r.subscriptionId, { immediate: false, effectiveAt: r.effectiveAt, retentionEndsAt: r.retentionEndsAt, pauseDeclined: input.pause_declined, providerWarning: r.providerWarning }, input.reason);
        await history({ key: "status", label: `Subscription (ends ${r.effectiveAt.slice(0, 10)})`, from: r.from, to: "cancelling" }, input.reason);
        return finish({ effectiveAt: r.effectiveAt, retentionEndsAt: r.retentionEndsAt }, 200, "succeeded");
      }
    }
  } catch (error) {
    if (error instanceof BillingActionError) return finish({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status, "failed");
    console.error("[billing] action failed", input.action, error instanceof Error ? error.message : error);
    return finish({ error: "That change could not be completed. Reload to see where your subscription stands." }, 500, "failed");
  }
}
