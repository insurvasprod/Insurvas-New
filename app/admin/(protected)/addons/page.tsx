import { redirect } from "next/navigation";

import { AddonNewButton } from "@/components/admin/catalog/addon-new-button";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { AddonsCatalog } from "@/components/admin/addons-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchAddonCatalogStats, fetchAddons, fetchPlanRefs } from "@/lib/addons/queries";
import { fetchAddonSheet, type AddonSheetData } from "@/lib/addons/sheet";
import { formatShare, type PlanRef } from "@/lib/addons/catalogView";
import { fetchMeters } from "@/lib/metering/queries";
import { fetchFeatureCatalog } from "@/lib/features/queries";
import { fetchPlans } from "@/lib/plans/queries";
import { formatCentsAsCurrency } from "@/lib/money";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (value: number) => value.toLocaleString("en-US");

/** "$3,180" — whole dollars on the tile, as the board draws it; the cents are in the hover text. */
function wholeDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * Admin › Catalog › Add-ons (admin round 1, docs/design/admin-r1/catalog.html screen 3): the same tiles, columns,
 * filters and actions inside the Catalog frame, plus how many each is attached to. An add-on opens as a sheet
 * (`?addon=`) with its editor, who has it and its history; New add-on opens the same sheet empty (`?new=1`).
 * Add-ons are priced product, so they follow the plans rule (doc §2.5): super admin only.
 */
export default async function AddonsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManagePlans(admin.role)) redirect("/admin");

  const params = await searchParams;
  const addonParam = typeof params.addon === "string" && UUID.test(params.addon) ? params.addon : null;

  const [addons, meters, groups, plans, planRefs, sheet] = await Promise.all([
    fetchAddons(),
    fetchMeters(),
    fetchFeatureCatalog(),
    fetchPlans(),
    // Plan names for "Attachable to". A failed read degrades to the latest versions the editor
    // already has, rather than taking the whole catalog down.
    fetchPlanRefs().catch(() => null),
    addonParam ? fetchAddonSheet(addonParam, { id: admin.id, role: admin.role }) : Promise.resolve<AddonSheetData | null>(null),
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
  const offering = addons.filter((addon) => addon.feature_keys.some((key) => archivedSet.has(key)));

  const shareTitle =
    "Add-on MRR ÷ (plan MRR + add-on MRR), live. Plan MRR is each active, past-due or cancelling subscription's plan price as a monthly equivalent; add-on MRR is every live attachment on those subscriptions whose cycle matches, as a monthly equivalent.";

  return (
    <CatalogPage
      step="addons"
      info="Extras sold on top of a plan. They feed the same entitlement engine as plans; price and cycle lock while anyone is billed for one."
      actions={<AddonNewButton />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Add-ons at a glance">
          <StatTile
            label="Add-ons"
            value={n(addons.length)}
            footnote={attachable === addons.length ? "all attachable" : `${n(attachable)} attachable`}
            labelTitle="Attachable means active: a retired add-on stays on existing subscriptions but cannot be attached again."
          />
          <StatTile
            label="Attached"
            value={stats ? n(stats.attached) : "—"}
            footnote={stats ? `across ${n(stats.tenants)} tenant${stats.tenants === 1 ? "" : "s"}` : "could not be loaded"}
            labelTitle="Live attachments on active, past-due and cancelling subscriptions."
          />
          <StatTile
            label="MRR from add-ons"
            value={stats ? wholeDollars(stats.addonMrrCents) : "—"}
            footnote={stats ? (stats.shareOfTotal === null ? "no revenue-bearing subscriptions" : `${formatShare(stats.shareOfTotal)} of total`) : "could not be loaded"}
            labelTitle={stats ? `${formatCentsAsCurrency(stats.addonMrrCents)} a month. ${shareTitle}` : shareTitle}
          />
          <StatTile
            label="Archived features offered"
            value={n(archivedOffered)}
            footnote={archivedOffered > 0 ? (offering.length === 1 ? `in ${offering[0].name}` : "granted before they were archived") : "excluded by design"}
          />
        </StatStrip>

        <AddonsCatalog
          addons={addons}
          featureLabels={featureLabels}
          archivedFeatureKeys={archivedFeatureKeys}
          meterLabels={meterLabels}
          features={featureOptions}
          meters={meterOptions}
          plans={plans}
          planRefs={refs}
          billedByAddon={stats ? stats.billedByAddon : null}
          sheet={sheet}
        />
      </div>
    </CatalogPage>
  );
}
