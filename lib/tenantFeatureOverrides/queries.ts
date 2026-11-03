import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getEntitlement } from "@/lib/entitlements/get";
import type { TenantFeatureRow, TenantFeatureState } from "./constants";

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** The migration (20260924344000) is not applied yet: a missing function, table or column. */
export function isOverrideSchemaMissing(error: DbError): boolean {
  if (!error) return false;
  if (["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  return /admin_tenant_feature_overrides|admin_set_tenant_feature_override|admin_remove_tenant_feature_override|tenant_feature_overrides/.test(error.message ?? "")
    && /does not exist|schema cache|could not find/i.test(error.message ?? "");
}

// The database types predate these functions; this is the one untyped seam.
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
export function overrideRpc(): Rpc {
  const supabase = getSupabaseServiceClient() as unknown as { rpc: Rpc };
  return (name, args) => supabase.rpc(name, args);
}

type RpcPayload = {
  source: "subscription" | "default";
  status: string | null;
  plan: { id: string; code: string; name: string; version: number } | null;
  tenants_on_plan: number | null;
  features: TenantFeatureRow[];
};

/**
 * Everything the Feature overrides tab shows: every catalog feature, what the plan (plus add-ons)
 * says, and this tenant's override if it has one. Null when the tenant does not exist.
 *
 * One RPC once the migration is applied. Before that, the same shape is assembled from the tables
 * that already exist, with no overrides (there is nowhere for one to be stored yet) and
 * `schemaReady: false`, so the tab can say why the form is closed instead of looking empty.
 */
export async function fetchTenantFeatureState(tenantId: string): Promise<TenantFeatureState | null> {
  const { data, error } = await overrideRpc()("admin_tenant_feature_overrides", { p_tenant_id: tenantId });
  if (!error) {
    if (!data) return null;
    const payload = data as RpcPayload;
    return {
      schemaReady: true,
      source: payload.source,
      status: payload.status,
      plan: payload.plan,
      tenantsOnPlan: payload.tenants_on_plan,
      features: payload.features.map((row) => ({ ...row, addon_names: row.addon_names ?? [] })),
    };
  }
  if (!isOverrideSchemaMissing(error)) throw new Error(`Could not load feature overrides: ${error.message}`);
  return fallbackState(tenantId);
}

async function fallbackState(tenantId: string): Promise<TenantFeatureState | null> {
  const supabase = getSupabaseServiceClient();

  const [tenantRes, subsRes, featuresRes, modulesRes] = await Promise.all([
    supabase.from("tenants").select("id").eq("id", tenantId).maybeSingle(),
    supabase.from("subscriptions").select("id, plan_id, status, started_at").eq("tenant_id", tenantId),
    supabase.from("features").select("feature_key, label, module, sort_order, is_archived"),
    supabase.from("feature_modules").select("key, label, sort_order"),
  ]);
  for (const [what, res] of [["tenant", tenantRes], ["subscriptions", subsRes], ["features", featuresRes], ["feature modules", modulesRes]] as const) {
    if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
  }
  if (!tenantRes.data) return null;

  // The engine's pick: a live subscription first, then the most recently started.
  const sub = [...(subsRes.data ?? [])].sort((a, b) => {
    const live = Number(b.status !== "cancelled") - Number(a.status !== "cancelled");
    return live !== 0 ? live : String(b.started_at).localeCompare(String(a.started_at));
  })[0];

  let source: TenantFeatureState["source"] = "default";
  let status: string | null = null;
  let plan: TenantFeatureState["plan"] = null;
  let tenantsOnPlan: number | null = null;
  const inPlan = new Set<string>();
  const addonNames = new Map<string, Set<string>>();
  let granted = new Set<string>();

  if (sub) {
    source = "subscription";
    status = sub.status;
    const [planRes, pfRes, attachedRes, onPlanRes] = await Promise.all([
      supabase.from("plans").select("id, code, name, version").eq("id", sub.plan_id).maybeSingle(),
      supabase.from("plan_features").select("feature_key").eq("plan_id", sub.plan_id),
      supabase.from("subscription_addons").select("addon_id").eq("subscription_id", sub.id).is("detached_at", null),
      supabase.from("subscriptions").select("tenant_id").eq("plan_id", sub.plan_id).neq("status", "cancelled"),
    ]);
    for (const [what, res] of [["plan", planRes], ["plan features", pfRes], ["add-ons", attachedRes], ["plan tenants", onPlanRes]] as const) {
      if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
    }
    plan = planRes.data ?? null;
    tenantsOnPlan = new Set((onPlanRes.data ?? []).map((row) => row.tenant_id)).size;
    for (const row of pfRes.data ?? []) inPlan.add(row.feature_key);

    const addonIds = (attachedRes.data ?? []).map((row) => row.addon_id);
    if (addonIds.length) {
      const [afRes, addonsRes] = await Promise.all([
        supabase.from("addon_features").select("addon_id, feature_key").in("addon_id", addonIds),
        supabase.from("addons").select("id, name").in("id", addonIds),
      ]);
      if (afRes.error) throw new Error(`Could not load add-on features: ${afRes.error.message}`);
      if (addonsRes.error) throw new Error(`Could not load add-ons: ${addonsRes.error.message}`);
      const nameById = new Map((addonsRes.data ?? []).map((row) => [row.id, row.name]));
      for (const row of afRes.data ?? []) {
        if (!addonNames.has(row.feature_key)) addonNames.set(row.feature_key, new Set());
        addonNames.get(row.feature_key)!.add(nameById.get(row.addon_id) ?? "an add-on");
      }
    }
    granted = sub.status === "cancelled" ? new Set() : new Set([...inPlan, ...addonNames.keys()]);
  } else {
    // No subscription: the LA-0 default list decides, and it is what the cached entitlement holds.
    const entitlement = await getEntitlement(tenantId);
    status = entitlement.status;
    granted = status === "cancelled" ? new Set() : new Set(entitlement.features);
  }

  const modules = new Map((modulesRes.data ?? []).map((row) => [row.key, row]));
  const features: TenantFeatureRow[] = [...(featuresRes.data ?? [])]
    .sort((a, b) =>
      (modules.get(a.module)?.sort_order ?? 999) - (modules.get(b.module)?.sort_order ?? 999) ||
      a.sort_order - b.sort_order ||
      a.label.localeCompare(b.label),
    )
    .map((row) => ({
      feature_key: row.feature_key,
      label: row.label,
      module: row.module,
      module_label: modules.get(row.module)?.label ?? row.module,
      is_archived: row.is_archived,
      plan_grants: granted.has(row.feature_key),
      in_plan: inPlan.has(row.feature_key),
      addon_names: [...(addonNames.get(row.feature_key) ?? [])],
      override: null,
    }));

  return { schemaReady: false, source, status, plan, tenantsOnPlan, features };
}
