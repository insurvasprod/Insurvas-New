import { redirect } from "next/navigation";

import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { FeatureNewButton, FeatureTabs, FeaturesSection } from "@/components/admin/features-section";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { readCatalogAudit } from "@/lib/adminCatalog/audit";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { fetchFeatureGrants } from "@/lib/features/grants";
import { fetchFeatureCatalog, fetchFeatureModules, fetchOverrideCounts } from "@/lib/features/queries";
import { fetchAllSwitches, fetchSwitchReasons } from "@/lib/features/killSwitch";
import { switchCounts } from "@/lib/features/killSwitchRules";

const KEY = /^[a-z][a-z0-9_]*$/;
const n = (value: number) => value.toLocaleString("en-US");

/**
 * Admin › Catalog › Features (admin round 1, docs/design/admin-r1/catalog.html screen 4): the feature catalog and
 * the kill switches, Catalog | Switches on the title line, inside the Catalog frame. What used to be the warning card
 * is the status line. A feature opens a sheet (`?feature=<key>`) with its switch, the plans and add-ons that grant it,
 * and its history.
 *
 * Archived features are listed too. Archiving only takes a feature out of the plan picker — tenants who already have
 * it keep it (SA-2.1, plan_and_addon_feature_keys) — so a kill switch on one still takes something away.
 */
export default async function FeaturesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "features")) redirect("/admin");

  const params = await searchParams;
  const featureParam = typeof params.feature === "string" && KEY.test(params.feature) ? params.feature : null;

  const [groups, modules, switches, overrideCounts, grants] = await Promise.all([
    fetchFeatureCatalog(),
    fetchFeatureModules(),
    fetchAllSwitches(),
    fetchOverrideCounts(),
    // "Granted by" degrades on its own: the sheet says it could not be read.
    fetchFeatureGrants().catch((error: unknown) => {
      console.error("[admin/features] grants read failed:", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  const moduleLabels = new Map(modules.map((m) => [m.key, m.label]));
  const all = groups.flatMap((g) => g.features);
  const switchable = all.map((f) => ({
    featureKey: f.feature_key,
    label: f.label,
    module: f.module,
    moduleLabel: moduleLabels.get(f.module) ?? f.module,
    isArchived: f.is_archived,
    overrideCount: overrideCounts.get(f.feature_key) ?? 0,
  }));

  const allSwitches = [...switches.values()];
  const counts = switchCounts(allSwitches);
  const open = featureParam ? all.find((feature) => feature.feature_key === featureParam) ?? null : null;
  // Only switches that are not plain "on" show an internal reason, so only those (and the open one) are looked up.
  const [reasons, history] = await Promise.all([
    fetchSwitchReasons([...new Set([...allSwitches.filter((s) => s.state !== "on").map((s) => s.feature_key), ...(open ? [open.feature_key] : [])])]),
    open
      ? readCatalogAudit({ id: admin.id, role: admin.role }, { target: { type: "feature", ids: [open.id, open.feature_key] } }, 60).then(
          (items) => ({ key: open.feature_key, items }),
          (error: unknown) => {
            console.error("[admin/features] history read failed:", error instanceof Error ? error.message : error);
            return { key: open.feature_key, items: null };
          },
        )
      : Promise.resolve(null),
  ]);

  const live = all.filter((feature) => !feature.is_archived);
  const unsold = live.filter((feature) => feature.plan_reference_count + feature.addon_reference_count === 0).length;
  const betaAgencies = allSwitches.filter((s) => s.state === "beta").reduce((sum, s) => sum + s.beta_tenant_ids.length, 0);
  const defaultTab = counts.off + counts.beta > 0 ? "switches" : "catalog";

  return (
    <CatalogPage
      step="features"
      info="What a plan or add-on can grant, and the switches that take a feature away from everyone at once."
      tabs={<FeatureTabs defaultTab={defaultTab} catalogCount={live.length} notOn={counts.off + counts.beta} />}
      actions={<FeatureNewButton modules={modules} />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Features">
          <StatTile label="Features" value={n(live.length)} footnote={`${n(all.length - live.length)} archived`} href="/admin/features?tab=catalog" />
          <StatTile label="Modules" value={n(modules.length)} footnote="groups in the catalog" />
          <StatTile label="In no plan or add-on" value={n(unsold)} footnote="nobody can buy them" href="/admin/features?tab=catalog&sold=none" />
          <StatTile label="Switched off" value={n(counts.off)} footnote="for every customer" href="/admin/features?tab=switches&state=off" />
          <StatTile label="In beta" value={n(counts.beta)} footnote={counts.beta > 0 ? `${n(betaAgencies)} ${betaAgencies === 1 ? "agency" : "agencies"}` : `of ${n(switchable.length)} switchable`} href="/admin/features?tab=switches&state=beta" />
        </StatStrip>

        <FeaturesSection
          groups={groups}
          modules={modules}
          switchable={switchable}
          switches={allSwitches}
          reasons={Object.fromEntries(reasons)}
          grants={grants}
          history={history}
          // Naming a feature and taking it away from every paying customer are not the same act and do not share
          // a permission. platform_config sees the switches read-only.
          canToggle={admin.role === "super_admin"}
          canOpenPlans={canOpenAdminHref(admin.role, "/admin/plans")}
          defaultTab={defaultTab}
        />
      </div>
    </CatalogPage>
  );
}
