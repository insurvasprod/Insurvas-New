import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * AG-0.8 · the solo → agency upgrade. The plan change (individual → agency band) is SA-3's — it bills; this
 * runs once the plan audience is agency and backfills the solo agent's book onto him as producer #1.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type UpgradePreview = Record<string, unknown> & { audience: string | null; agency_row_exists: boolean };

export async function upgradePreview(tenantId: string): Promise<UpgradePreview | null> {
  const { data, error } = await db().rpc("agency_upgrade_preview", { p_tenant_id: tenantId });
  if (error) return null;
  return data as UpgradePreview;
}

/** Whether this agency still needs its one-time upgrade: an agency plan with no producer rows yet. */
export async function needsUpgrade(tenantId: string): Promise<boolean> {
  const { count, error } = await db().from("producer").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  return !error && (count ?? 0) === 0;
}

export async function runUpgrade(tenantId: string, actorId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db().rpc("agency_upgrade_from_solo", { p_tenant_id: tenantId, p_actor: actorId });
  if (error) {
    const message = error.message ?? "";
    if (/agency_plan_required/.test(message)) throw Object.assign(new Error("Change your plan to an agency band first, in Billing."), { status: 409, code: "agency_plan_required" });
    if (/agency_upgrade_left_nulls/.test(message)) throw Object.assign(new Error("Some of your book could not be attributed. Nothing was changed; contact support."), { status: 500, code: "left_nulls" });
    throw new Error(message);
  }
  return data as Record<string, unknown>;
}
