import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchAddons } from "@/lib/addons/queries";
import { fetchMeters } from "@/lib/metering/queries";
import { fetchFeatureCatalog } from "@/lib/features/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AddonsTable } from "@/components/admin/addons-table";

export default async function AddonsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // Add-ons are priced product, so they follow the same rule as plans (doc §2.5).
  if (!canManagePlans(admin.role)) redirect("/admin");

  const [addons, meters, groups] = await Promise.all([fetchAddons(), fetchMeters(), fetchFeatureCatalog()]);

  const featureLabels = Object.fromEntries(
    groups.flatMap((g) => g.features.map((f) => [f.feature_key, f.label])),
  );
  const meterLabels = Object.fromEntries(meters.map((m) => [m.meter_key, `${m.label} (${m.unit}s)`]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Add-ons"
        subtitle="Extras sold on top of a plan. They grant features and credits through the same entitlement path a plan does."
      />
      <AddonsTable initialAddons={addons} featureLabels={featureLabels} meterLabels={meterLabels} />
    </div>
  );
}
