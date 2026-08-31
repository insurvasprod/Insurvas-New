import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { CreditLimitsPanel } from "@/components/admin/credit-limits-panel";
import { getCreditsLimitsData } from "@/lib/creditsLimits/service";

export default async function CreditsLimitsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "credits-limits")) redirect("/admin");

  const data = await getCreditsLimitsData();

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Credits &amp; limits" subtitle="Credit packs, defaults, meters, and usage limits." />
      <CreditLimitsPanel
        initialPacks={data.packs}
        initialPricing={data.pricing}
        initialMonitor={data.monitor}
        initialTenants={data.tenants}
      />
    </div>
  );
}
