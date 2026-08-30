import "server-only";

// SA-3.4 · Turning a provider event into subscription state.
//
// This is the file that makes the whole Whop integration mean something: until now events were
// verified, stored and invoiced, but nothing a tenant could feel ever changed.
//
// It also absorbs the access half of the cancelled SA-3.5. Whop chases the money; we decide what a
// tenant may still do while it does.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";
import { whopAmountToCents } from "@/lib/payments/whop/client";
import type { SubscriptionStatus } from "./access";
import type { WhopEnvelope } from "@/lib/payments/whop/events";

export type EventOutcome = {
  applied: boolean;
  reason: string;
  previousStatus?: SubscriptionStatus;
  newStatus?: SubscriptionStatus;
};

/**
 * What each event means for a subscription.
 *
 * `payment.failed` maps to `past_due`, which in our access rules is FULL access with a banner —
 * Whop retries for five days, and taking a customer's write access away on the first declined
 * charge punishes a card that will clear tomorrow. Read-only starts only when Whop gives up.
 */
const STATUS_FOR_EVENT: Record<string, SubscriptionStatus> = {
  "payment.succeeded": "active",
  "membership.activated": "active",
  "payment.failed": "past_due",
  "invoice.past_due": "past_due",
  // Whop has stopped trying. Read-only rather than cancelled: the tenant keeps seeing the book of
  // business they built, which is SA-2.8's rule and the whole point of "suspend the doing".
  "membership.deactivated": "suspended",
  "invoice.marked_uncollectible": "suspended",
};

function occurredAt(envelope: WhopEnvelope): Date | null {
  if (!envelope.timestamp) return null;
  const parsed = new Date(envelope.timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function targetStatus(envelope: WhopEnvelope): SubscriptionStatus | null {
  if (envelope.type === "membership.cancel_at_period_end_changed") {
    const data = (envelope.data ?? {}) as Record<string, unknown>;
    // A scheduled cancellation, not an immediate one: they have paid through the term and are
    // still entitled to it, which `cancelling` already encodes as full access.
    return data.cancel_at_period_end === true ? "cancelling" : "active";
  }
  return STATUS_FOR_EVENT[envelope.type] ?? null;
}

/** Records the money. Idempotent on the provider charge id, so a redelivery cannot double-count. */
async function recordPayment(
  envelope: WhopEnvelope,
  tenantId: string,
): Promise<void> {
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  const chargeId = typeof data.id === "string" ? data.id : null;
  if (!chargeId) return;

  const rawTotal = data.total;
  const amountCents =
    typeof rawTotal === "number" || typeof rawTotal === "string" ? whopAmountToCents(rawTotal) : 0;

  const supabase = getSupabaseServiceClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id")
    .eq("provider", "whop")
    .eq("provider_payment_id", chargeId)
    .maybeSingle<{ id: string }>();

  const { error } = await supabase.from("payments").insert({
    invoice_id: invoice?.id ?? null,
    tenant_id: tenantId,
    amount_cents: amountCents,
    method: "provider",
    provider: "whop",
    provider_charge_id: chargeId,
    paid_at: typeof data.paid_at === "string" ? data.paid_at : new Date().toISOString(),
    status: "succeeded",
  });

  // 23505 is the unique index doing its job on a redelivered event, which is expected traffic.
  if (error && error.code !== "23505") {
    throw new Error(`Could not record payment ${chargeId}: ${error.message}`);
  }
}

export async function applyProviderEvent(
  envelope: WhopEnvelope,
  tenantId: string | null,
): Promise<EventOutcome> {
  if (!tenantId) return { applied: false, reason: "no tenant resolved" };

  const supabase = getSupabaseServiceClient();

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, status, last_provider_event_at")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; status: SubscriptionStatus; last_provider_event_at: string | null }>();

  if (!subscription) return { applied: false, reason: "tenant has no subscription" };

  // Ordering guard. Whop does not guarantee delivery order, so an event that happened BEFORE the
  // one we have already applied is discarded rather than applied on top of it. Without this, a
  // late payment.succeeded would resurrect a tenant Whop had already deactivated.
  const eventAt = occurredAt(envelope);
  if (eventAt && subscription.last_provider_event_at) {
    if (eventAt.getTime() <= new Date(subscription.last_provider_event_at).getTime()) {
      return { applied: false, reason: "stale event, older than the last one applied" };
    }
  }

  if (envelope.type === "payment.succeeded") {
    await recordPayment(envelope, tenantId);
  }

  const next = targetStatus(envelope);
  if (!next) {
    return { applied: false, reason: `${envelope.type} carries no status change` };
  }

  if (next === subscription.status) {
    // Still stamp the clock, so a genuinely older event that follows is recognised as stale.
    if (eventAt) {
      await supabase
        .from("subscriptions")
        .update({ last_provider_event_at: eventAt.toISOString() })
        .eq("id", subscription.id);
    }
    return { applied: false, reason: "already in that state", previousStatus: subscription.status };
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: next,
      last_provider_event_at: eventAt ? eventAt.toISOString() : new Date().toISOString(),
    })
    .eq("id", subscription.id);

  if (error) throw new Error(`Could not update subscription ${subscription.id}: ${error.message}`);

  // Immediately, not on a schedule: the acceptance criterion is that a tenant whose payment lands
  // regains access within a minute with no admin action, and the entitlement blob is what the
  // agent app reads.
  await rebuildEntitlement(tenantId, "subscription.plan_changed");

  return {
    applied: true,
    reason: `${envelope.type} -> ${next}`,
    previousStatus: subscription.status,
    newStatus: next,
  };
}
