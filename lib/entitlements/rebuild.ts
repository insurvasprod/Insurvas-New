import "server-only";

import { refreshEntitlement } from "./get";

/**
 * Called by every path that changes what a tenant is entitled to.
 *
 * SA-2.7 wired the call sites while this was still a stub; SA-2.8 filled in the body. The
 * awaited call is deliberate — SA-2.7's criterion is that the entitlement is rebuilt *before*
 * the API returns, so the agent's next page load already reflects the change.
 *
 * Note the one path that does NOT come through here: period rollover runs entirely in SQL and
 * calls refresh_tenant_entitlement() directly, for the same reason.
 */
export type EntitlementRebuildReason =
  | "subscription.assigned"
  | "subscription.plan_changed"
  | "subscription.paused"
  | "subscription.resumed"
  | "subscription.cancelled"
  | "subscription.period_rolled"
  | "plan.features_changed";

export async function rebuildEntitlement(
  tenantId: string,
  reason: EntitlementRebuildReason,
): Promise<void> {
  try {
    await refreshEntitlement(tenantId);
  } catch (error) {
    // A failed rebuild leaves a stale entitlement, which is a real problem — but failing the
    // admin's action would leave the database changed and the response an error, which is worse.
    // Log loudly; `tenant_entitlements.version` makes the staleness detectable.
    console.error(`[entitlement] rebuild FAILED for tenant ${tenantId} after ${reason}`, error);
  }
}

/** Refreshes every tenant affected by a plan change — a plan version can back many tenants. */
export async function rebuildEntitlementsForPlan(planId: string): Promise<number> {
  const { getSupabaseServiceClient } = await import("@/lib/supabase/service");
  const supabase = getSupabaseServiceClient();

  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select("tenant_id")
    .eq("plan_id", planId)
    .neq("status", "cancelled");

  const tenantIds = [...new Set((subscriptions ?? []).map((s) => s.tenant_id))];
  await Promise.all(tenantIds.map((id) => rebuildEntitlement(id, "plan.features_changed")));

  return tenantIds.length;
}
