import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SystemSettingsPanel } from "@/components/admin/system-settings-panel";
import { canChangeMaintenance } from "@/lib/system/adminFormat";
import { loadSystemAdminView } from "@/lib/system/adminView";

export default async function SystemPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone. Changing maintenance is narrower (super_admin only).
  if (!canAccessConfigurationSection(admin.role, "system")) redirect("/admin");

  const view = await loadSystemAdminView();

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {/* "Maintenance" to match the sidebar — it is what the screen is for, where "System" said
          nothing. The route stays /admin/system so existing links keep working. */}
      <AdminPageHeader title="Maintenance" subtitle="Maintenance mode and platform announcements." />
      <SystemSettingsPanel view={view} canChangeMaintenance={canChangeMaintenance(admin.role)} />
    </div>
  );
}
