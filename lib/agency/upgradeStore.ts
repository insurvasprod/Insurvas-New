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

/**
 * Whether this agency still needs its one-time upgrade: an agency plan with no producer rows yet, or a member whose
 * base role is producer (a manager included) with no producer row of his own.
 */
export async function needsUpgrade(tenantId: string): Promise<boolean> {
  const { count, error } = await db().from("producer").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (error) return false;
  if ((count ?? 0) === 0) return true;
  return (await membersWithoutProducer(tenantId)).length > 0;
}

type MemberRow = { user_id: string; accepted_at: string | null; invited_at: string | null };

/** Producer members (managers are producers with a title) who have no producer row. */
async function membersWithoutProducer(tenantId: string): Promise<MemberRow[]> {
  const [members, producers] = await Promise.all([
    db().from("tenant_users").select("user_id, accepted_at, invited_at").eq("tenant_id", tenantId).eq("role", "producer"),
    db().from("producer").select("user_id").eq("tenant_id", tenantId),
  ]);
  if (members.error || producers.error) return [];
  const have = new Set(((producers.data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id));
  return ((members.data ?? []) as MemberRow[]).filter((row) => !have.has(row.user_id));
}

/**
 * Owner 2026-11-20 (manager walk): members who joined as producers before the agency record existed had no producer
 * row, so the roster said "No producers yet", a manager had no reports, and nobody could submit (AG-1.10) — while
 * Invite refused them as "already on your team". Finish agency setup now gives each one his row through
 * agency_add_member_producers (20261120200000: the 2026-10-18 backfill for one tenant; status and can_submit are the
 * database's to set). Before that migration the function is missing and nothing changes.
 */
async function addMemberProducers(tenantId: string): Promise<number> {
  const { data, error } = await db().rpc("agency_add_member_producers", { p_tenant_id: tenantId });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") console.error("[agency upgrade] member producers", error.message);
    return 0;
  }
  return Number(data ?? 0);
}

export async function runUpgrade(tenantId: string, actorId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db().rpc("agency_upgrade_from_solo", { p_tenant_id: tenantId, p_actor: actorId });
  if (error) {
    const message = error.message ?? "";
    if (/agency_plan_required/.test(message)) throw Object.assign(new Error("Change your plan to an agency band first, in Billing."), { status: 409, code: "agency_plan_required" });
    if (/agency_upgrade_left_nulls/.test(message)) throw Object.assign(new Error("Some of your book could not be attributed. Nothing was changed; contact support."), { status: 500, code: "left_nulls" });
    throw new Error(message);
  }
  const members = await addMemberProducers(tenantId);
  return { ...(data as Record<string, unknown>), member_producers: members };
}
