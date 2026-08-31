import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ComplianceVendorsTable } from "@/components/admin/compliance-vendors-table";
import { listComplianceVendors } from "@/lib/compliance/service";

export default async function ComplianceSourcesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "compliance-sources")) redirect("/admin");

  const vendors = await listComplianceVendors();

  return (
    <div className="space-y-6">
      {/* "Compliance" to match the sidebar; the subtitle already says which vendors. Route stays
          /admin/compliance-sources so existing links keep working. */}
      <AdminPageHeader title="Compliance" subtitle="TCPA and Do Not Call vendors and their availability." />
      <ComplianceVendorsTable initialVendors={vendors} />
    </div>
  );
}
