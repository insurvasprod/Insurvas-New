import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { FeatureModuleGroup, FeatureModuleRow, FeatureRow } from "./constants";

export type { FeatureModuleGroup, FeatureModuleRow, FeatureRow };

async function fetchModules(): Promise<FeatureModuleRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("feature_modules").select("key, label, sort_order").order("sort_order");
  return (data ?? []) as FeatureModuleRow[];
}

/**
 * Everything, grouped by module in the fixed display order — including empty modules, so the
 * seeded-but-featureless 'agency' module is still visible to an admin.
 *
 * `includeArchived` is the difference between the admin screen (shows everything, so archived
 * features can be found and restored) and the plan picker (must not offer them).
 */
export async function fetchFeatureCatalog(
  options: { includeArchived: boolean } = { includeArchived: true },
): Promise<FeatureModuleGroup[]> {
  const supabase = getSupabaseServiceClient();

  let request = supabase
    .from("features")
    .select("id, feature_key, label, module, description, sort_order, is_archived")
    .order("sort_order");

  if (!options.includeArchived) request = request.eq("is_archived", false);

  const [{ data: modules }, { data: features }, { data: planReferences }, { data: addonReferences }] = await Promise.all([
    supabase.from("feature_modules").select("key, label, sort_order").order("sort_order"),
    request,
    supabase.from("plan_features").select("feature_key"),
    supabase.from("addon_features").select("feature_key"),
  ]);

  const planCounts = new Map<string, number>();
  for (const row of planReferences ?? []) planCounts.set(row.feature_key, (planCounts.get(row.feature_key) ?? 0) + 1);
  const addonCounts = new Map<string, number>();
  for (const row of addonReferences ?? []) addonCounts.set(row.feature_key, (addonCounts.get(row.feature_key) ?? 0) + 1);

  const byModule = new Map<string, FeatureRow[]>();
  for (const feature of (features ?? []) as Omit<FeatureRow, "plan_reference_count" | "addon_reference_count">[]) {
    const list = byModule.get(feature.module) ?? [];
    list.push({
      ...feature,
      plan_reference_count: planCounts.get(feature.feature_key) ?? 0,
      addon_reference_count: addonCounts.get(feature.feature_key) ?? 0,
    });
    byModule.set(feature.module, list);
  }

  return (modules ?? []).map((module) => ({ module, features: byModule.get(module.key) ?? [] }));
}

/**
 * What the plan editor ticks against (SA-2.2 onward): archived features are excluded, because
 * they must disappear from the picker while staying enforced for existing subscribers.
 */
export function fetchFeaturesForPicker(): Promise<FeatureModuleGroup[]> {
  return fetchFeatureCatalog({ includeArchived: false });
}

export async function fetchFeatureModules(): Promise<FeatureModuleRow[]> {
  return fetchModules();
}

const OVERRIDE_PAGE = 1000;

/**
 * How many tenants have a per-tenant override on each feature (tenant_feature_overrides,
 * 20260924344000) — either direction, since both are a deviation from the plan and a kill switch
 * beats both. Features with none are absent from the map.
 *
 * Paged, because PostgREST caps a response at its max-rows setting and a silently truncated count
 * would be a wrong number on screen. If the table is not there (or cannot be read) the map is empty
 * and the page simply shows no counts — this is information, never a control.
 */
export async function fetchOverrideCounts(): Promise<Map<string, number>> {
  const supabase = getSupabaseServiceClient();
  // The table is newer than the generated database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as unknown as { from: (table: string) => any };
  const counts = new Map<string, number>();

  for (let from = 0; ; from += OVERRIDE_PAGE) {
    const { data, error } = (await client
      .from("tenant_feature_overrides")
      .select("feature_key, tenant_id")
      .order("feature_key")
      .order("tenant_id")
      .range(from, from + OVERRIDE_PAGE - 1)) as { data: { feature_key: string }[] | null; error: { message?: string } | null };

    if (error) {
      console.error("[features] could not count tenant overrides", error);
      return new Map();
    }
    for (const row of data ?? []) counts.set(row.feature_key, (counts.get(row.feature_key) ?? 0) + 1);
    if (!data || data.length < OVERRIDE_PAGE) return counts;
  }
}
