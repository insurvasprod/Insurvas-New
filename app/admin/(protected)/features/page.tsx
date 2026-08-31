import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { FeaturesSection } from "@/components/admin/features-section";
import { fetchFeatureCatalog, fetchFeatureModules } from "@/lib/features/queries";
import { fetchAllSwitches } from "@/lib/features/killSwitch";

/**
 * The feature catalog and the kill switches, on one route with tabs.
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

  const [groups, modules, switches] = await Promise.all([
    fetchFeatureCatalog(),
    fetchFeatureModules(),
    fetchAllSwitches(),
  ]);

  // Archived features are excluded from the switch list: they are already unavailable to any new
  // plan, so a kill switch on one would be a control that changes nothing.
  const moduleLabels = new Map(modules.map((m) => [m.key, m.label]));
  const switchable = groups.flatMap((g) =>
    g.features
      .filter((f) => !f.is_archived)
      .map((f) => ({
        featureKey: f.feature_key,
        label: f.label,
        module: f.module,
        moduleLabel: moduleLabels.get(f.module) ?? f.module,
      })),
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Features"
        subtitle="Everything a subscription can switch on, and the switches that turn one off for everyone."
      />
      <FeaturesSection
        groups={groups}
        modules={modules}
        switchable={switchable}
        switches={[...switches.values()]}
        // Naming a feature and taking it away from every paying customer are not the same act and
        // do not share a permission.
        canToggle={admin.role === "super_admin"}
      />
    </div>
  );
}
