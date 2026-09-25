import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { FeaturesSection } from "@/components/admin/features-section";
import { fetchFeatureCatalog, fetchFeatureModules, fetchOverrideCounts } from "@/lib/features/queries";
import { fetchAllSwitches, fetchSwitchReasons } from "@/lib/features/killSwitch";
import { switchCounts } from "@/lib/features/killSwitchRules";

/**
 * The feature catalog and the kill switches, on one route with tabs (board p-adm-features).
 *
 * This replaces the catalog-only screen that used to live here. There were two Features screens —
 * this path showed the catalog, and the Configuration Center showed the catalog *plus* the
 * switches — so the same catalog rendered in two places and was free to drift. One screen, at the
 * URL people already had bookmarked.
 */
export default async function FeaturesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "features")) redirect("/admin");

  const [groups, modules, switches, overrideCounts] = await Promise.all([
    fetchFeatureCatalog(),
    fetchFeatureModules(),
    fetchAllSwitches(),
    fetchOverrideCounts(),
  ]);

  // Archived features are listed too. Archiving only takes a feature out of the plan picker —
  // tenants who already have it keep it (SA-2.1, plan_and_addon_feature_keys) — so a kill switch
  // on one still takes something away. Leaving them out also hid a switch that was off when its
  // feature was archived, while the headline still counted it.
  const moduleLabels = new Map(modules.map((m) => [m.key, m.label]));
  const switchable = groups.flatMap((g) =>
    g.features.map((f) => ({
      featureKey: f.feature_key,
      label: f.label,
      module: f.module,
      moduleLabel: moduleLabels.get(f.module) ?? f.module,
      isArchived: f.is_archived,
      overrideCount: overrideCounts.get(f.feature_key) ?? 0,
    })),
  );

  const allSwitches = [...switches.values()];
  const counts = switchCounts(allSwitches);
  // Only switches that are not plain "on" show an internal reason, so only those are looked up.
  const reasons = await fetchSwitchReasons(allSwitches.filter((s) => s.state !== "on").map((s) => s.feature_key));

  return (
    <FeaturesSection
      groups={groups}
      modules={modules}
      switchable={switchable}
      switches={allSwitches}
      reasons={Object.fromEntries(reasons)}
      counts={counts}
      // Naming a feature and taking it away from every paying customer are not the same act and
      // do not share a permission. platform_config sees the switches read-only.
      canToggle={admin.role === "super_admin"}
    />
  );
}
