import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { CreditLimitsPanel } from "@/components/admin/credit-limits-panel";
import { getCreditsLimitsData } from "@/lib/creditsLimits/service";

export default async function CreditsLimitsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone. It matches the API routes: super_admin and platform_config.
  if (!canAccessConfigurationSection(admin.role, "credits-limits")) redirect("/admin");

  const data = await getCreditsLimitsData();

  // The header lives in the panel because its one action ("Add a credit pack") opens the panel's dialog.
  return <CreditLimitsPanel initial={data} />;
}
