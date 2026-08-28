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

  const [modules, { data: features }] = await Promise.all([fetchModules(), request]);

  const byModule = new Map<string, FeatureRow[]>();
  for (const feature of (features ?? []) as FeatureRow[]) {
    const list = byModule.get(feature.module) ?? [];
    list.push(feature);
    byModule.set(feature.module, list);
  }

  return modules.map((module) => ({ module, features: byModule.get(module.key) ?? [] }));
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
