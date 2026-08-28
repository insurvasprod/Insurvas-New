import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchPricesForPlans } from "@/lib/plans/versionEditor";
import { AdminPageHeader } from "@/components/admin/page-header";
import { PlansTable } from "@/components/admin/plans-table";

export default async function PlansPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManagePlans(admin.role)) redirect("/admin");

  const plans = await fetchPlans();
  const priceMap = await fetchPricesForPlans(plans.map((p) => p.id));
  // Serialise the Map for the client component.
  const prices = Object.fromEntries(priceMap);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Plans"
        subtitle="What the business sells. Pricing lands in SA-2.4 and the feature picker in SA-2.3."
      />
      <PlansTable initialPlans={plans} prices={prices} />
    </div>
  );
}
