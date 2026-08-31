import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SystemSettingsPanel } from "@/components/admin/system-settings-panel";
import { getStoredMaintenance, listAnnouncements } from "@/lib/system/service";

export default async function SystemPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "system")) redirect("/admin");

  const [maintenance, announcements] = await Promise.all([getStoredMaintenance(), listAnnouncements()]);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="System" subtitle="Maintenance mode and platform announcements." />
      <SystemSettingsPanel initialMaintenance={maintenance} initialAnnouncements={announcements} />
    </div>
  );
}
