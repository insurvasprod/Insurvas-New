import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** One plan version or add-on that grants a feature (catalog.html screen 4, "Granted by"). */
export type FeatureGrant = {
  kind: "plan" | "addon";
  id: string;
  /** "Agency v4", "AI pack". */
  label: string;
  /** An archived plan version or a retired add-on still grants it to whoever has it. */
  retired: boolean;
  /** For a plan: whether this is the code's latest version (the one sold to new sign-ups). */
  latest: boolean;
};

/**
 * Every plan version and add-on behind each feature's reference counts, keyed by feature key: the same two tables
 * the counts are read from (plan_features, addon_features), so "3 plans · 1 add-on" and the list always agree.
 * Throws on a failed read.
 */
export async function fetchFeatureGrants(): Promise<Record<string, FeatureGrant[]>> {
  const db = getSupabaseServiceClient();
  // plan_features grows with every version; read past PostgREST's 1,000-row cap so no grant is silently missing.
  const allPlanGrants = async () => {
    const rows: { plan_id: string; feature_key: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("plan_features").select("plan_id, feature_key").order("plan_id").order("feature_key").range(from, from + 999);
      if (error) return { data: null, error };
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) return { data: rows, error: null };
    }
  };
  const [planGrants, addonGrants, plans, addons] = await Promise.all([
    allPlanGrants(),
    db.from("addon_features").select("addon_id, feature_key"),
    db.from("plans").select("id, code, name, version, is_archived"),
    db.from("addons").select("id, name, is_active"),
  ]);
  for (const read of [planGrants, addonGrants, plans, addons]) if (read.error) throw new Error(`Could not read who grants each feature: ${read.error.message}`);

  const latestVersion = new Map<string, number>();
  for (const plan of plans.data ?? []) latestVersion.set(plan.code, Math.max(latestVersion.get(plan.code) ?? 0, plan.version));
  const planOf = new Map((plans.data ?? []).map((plan) => [plan.id, plan]));
  const addonOf = new Map((addons.data ?? []).map((addon) => [addon.id, addon]));

  const grants: Record<string, FeatureGrant[]> = {};
  const push = (key: string, grant: FeatureGrant) => (grants[key] ??= []).push(grant);
  for (const row of planGrants.data ?? []) {
    const plan = planOf.get(row.plan_id);
    if (plan) push(row.feature_key, { kind: "plan", id: plan.id, label: `${plan.name} v${plan.version}`, retired: plan.is_archived, latest: latestVersion.get(plan.code) === plan.version });
  }
  for (const row of addonGrants.data ?? []) {
    const addon = addonOf.get(row.addon_id);
    if (addon) push(row.feature_key, { kind: "addon", id: addon.id, label: addon.name, retired: !addon.is_active, latest: true });
  }
  for (const list of Object.values(grants)) list.sort((a, b) => (a.kind === b.kind ? Number(b.latest) - Number(a.latest) || a.label.localeCompare(b.label) : a.kind === "plan" ? -1 : 1));
  return grants;
}
