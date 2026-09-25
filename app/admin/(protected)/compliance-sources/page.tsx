import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { ComplianceVendorsTable } from "@/components/admin/compliance-vendors-table";
import { getComplianceRegistry } from "@/lib/compliance/service";

export default async function ComplianceSourcesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "compliance-sources")) redirect("/admin");

  // The vendors plus the dial gate's own DNC verdict (demo mode included), so the callout says what
  // the gate says rather than a verdict recomputed in the browser.
  const registry = await getComplianceRegistry();

  // The header lives in the client component: its "Register a vendor" button opens the dialog there.
  // Route stays /admin/compliance-sources so existing links keep working.
  return <ComplianceVendorsTable initial={registry} />;
}
