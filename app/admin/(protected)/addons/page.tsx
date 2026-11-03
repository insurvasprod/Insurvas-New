import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchAddonCatalogStats, fetchAddons, fetchPlanRefs } from "@/lib/addons/queries";
import { formatShare, type PlanRef } from "@/lib/addons/catalogView";
import { fetchMeters } from "@/lib/metering/queries";
import { fetchFeatureCatalog } from "@/lib/features/queries";
import { fetchPlans } from "@/lib/plans/queries";
import { formatCentsAsCurrency } from "@/lib/money";
import { AddonsCatalog } from "@/components/admin/addons-table";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";

/** "$3,180" — whole dollars on the tile, as the board draws it; the cents are in the hover text. */
function wholeDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export default async function AddonsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // Add-ons are priced product, so they follow the same rule as plans (doc §2.5).
  if (!canManagePlans(admin.role)) redirect("/admin");

  const [addons, meters, groups, plans, planRefs] = await Promise.all([
    fetchAddons(),
    fetchMeters(),
    fetchFeatureCatalog(),
    fetchPlans(),
    // Plan names for "Attachable to". A failed read degrades to the latest versions the editor
    // already has, rather than taking the whole catalog down.
    fetchPlanRefs().catch(() => null),
  ]);
  const stats = await fetchAddonCatalogStats(addons);

  const featureLabels = Object.fromEntries(
    groups.flatMap((g) => g.features.map((f) => [f.feature_key, f.label])),
  );
  const meterLabels = Object.fromEntries(meters.map((m) => [m.meter_key, m.label]));
  const featureOptions = groups.flatMap((group) => group.features.filter((feature) => !feature.is_archived).map((feature) => ({ key: feature.feature_key, label: feature.label, module: feature.module })));
  const meterOptions = meters.map((meter) => ({ key: meter.meter_key, label: meter.label, unit: meter.unit }));
  const refs: PlanRef[] =
    planRefs ?? plans.map((p) => ({ id: p.id, code: p.code, name: p.name, version: p.version, is_archived: p.is_archived }));

  const attachable = addons.filter((addon) => addon.is_active).length;
  // An archived feature never appears in the picker, so a non-zero count here is a catalog that
  // drifted after the add-on was written — worth showing rather than hiding.
  const archivedFeatureKeys = groups.flatMap((g) => g.features.filter((f) => f.is_archived).map((f) => f.feature_key));
  const archivedSet = new Set(archivedFeatureKeys);
  const archivedOffered = new Set(addons.flatMap((addon) => addon.feature_keys.filter((key) => archivedSet.has(key)))).size;

  const shareTitle =
    "Add-on MRR ÷ (plan MRR + add-on MRR), live. Plan MRR is each active, past-due or cancelling subscription's plan price as a monthly equivalent; add-on MRR is every live attachment on those subscriptions whose cycle matches, as a monthly equivalent.";

  const tiles = (
    <BoardStatGrid>
      <BoardStatTile
        label="Add-ons"
        value={addons.length.toLocaleString("en-US")}
        footnote={attachable === addons.length ? "all attachable" : `${attachable.toLocaleString("en-US")} attachable`}
        title="Attachable means active: a retired add-on stays on existing subscriptions but cannot be attached again."
      />
      <BoardStatTile
        label="Attached"
        value={stats ? stats.attached.toLocaleString("en-US") : "—"}
        footnote={
          stats
            ? `across ${stats.tenants.toLocaleString("en-US")} tenant${stats.tenants === 1 ? "" : "s"}`
            : "could not be loaded"
        }
        title="Live attachments on active, past-due and cancelling subscriptions."
      />
      <BoardStatTile
        label="MRR from add-ons"
        value={stats ? wholeDollars(stats.addonMrrCents) : "—"}
        tone={stats && stats.addonMrrCents > 0 ? "success" : "default"}
        footnote={
          stats
            ? stats.shareOfTotal === null
              ? "no revenue-bearing subscriptions"
              : `${formatShare(stats.shareOfTotal)} of total`
            : "could not be loaded"
        }
        title={stats ? `${formatCentsAsCurrency(stats.addonMrrCents)} a month. ${shareTitle}` : shareTitle}
      />
      <BoardStatTile
        label="Archived features offered"
        value={archivedOffered.toLocaleString("en-US")}
        tone={archivedOffered > 0 ? "warning" : "default"}
        footnote={archivedOffered > 0 ? "granted before they were archived" : "excluded by design"}
      />
    </BoardStatGrid>
  );

  return (
    <AddonsCatalog
      addons={addons}
      tiles={tiles}
      featureLabels={featureLabels}
      archivedFeatureKeys={archivedFeatureKeys}
      meterLabels={meterLabels}
      features={featureOptions}
      meters={meterOptions}
      plans={plans}
      planRefs={refs}
      billedByAddon={stats ? stats.billedByAddon : null}
    />
  );
}
