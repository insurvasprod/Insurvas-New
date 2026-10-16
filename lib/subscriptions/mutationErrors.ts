// What the admin subscription routes answer when the database refuses a change. Plain module (no
// server-only, no @/ imports) so the tests run it under `node --experimental-strip-types`.
//
// A refusal the database makes on purpose is the caller's problem (4xx) with words an admin can act
// on; only an error nobody anticipated is a 500.

export type RpcError = { message?: string | null; code?: string | null };
export type MappedError = { status: number; error: string };

const LIVE_SUBSCRIPTION = "This tenant already has a live subscription — change their plan instead";

/** admin_assign_subscription. 23505 is the one-live-subscription index catching a concurrent assign. */
export function assignErrorResponse(error: RpcError): MappedError {
  const message = error.message ?? "";
  if (message.includes("already_subscribed") || error.code === "23505") return { status: 409, error: LIVE_SUBSCRIPTION };
  if (message.includes("tenant_not_found")) return { status: 404, error: "Tenant not found" };
  if (message.includes("plan_archived")) return { status: 409, error: "That plan is archived and can't be sold to anyone new" };
  if (message.includes("plan_not_found")) return { status: 404, error: "Plan not found" };
  if (message.includes("cycle_not_offered")) return { status: 400, error: "That plan isn't sold on that billing cycle" };
  return { status: 500, error: "Could not assign the subscription" };
}

/** admin_change_subscription_plan. */
export function changePlanErrorResponse(error: RpcError): MappedError {
  const message = error.message ?? "";
  if (/plan_archived|plan_not_found/.test(message)) return { status: 409, error: "That plan is not available for new subscriptions" };
  if (message.includes("cycle_not_offered")) return { status: 400, error: "That plan isn't sold on this subscription's billing cycle" };
  if (message.includes("subscription_state_not_cancellable")) {
    return { status: 409, error: "A cancelled subscription can't change plan — assign a new one instead" };
  }
  if (message.includes("subscription_not_found")) return { status: 404, error: "Subscription not found" };
  return { status: 500, error: "Could not change the plan" };
}

/**
 * The database decides when a change applies (20261015600000): a downgrade asked for "now" is queued
 * to the period end. Said back to the admin rather than left for them to notice.
 */
export function queuedAsDowngrade(requestedNow: boolean, appliedNow: boolean): boolean {
  return requestedNow && !appliedNow;
}
