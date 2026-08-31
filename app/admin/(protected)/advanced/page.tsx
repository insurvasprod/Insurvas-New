import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SettingsForm } from "@/components/admin/settings-form";
import { getAllSettings } from "@/lib/settings/queries";

export default async function AdvancedPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "advanced")) redirect("/admin");

  const settings = await getAllSettings();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader title="Advanced" subtitle="Raw platform settings for values without a more specific home." />
      <SettingsForm
        initial={settings.map((setting) => ({
          key: setting.def.key,
          value: setting.value,
          isOverridden: setting.isOverridden,
          updatedAt: setting.updatedAt,
        }))}
      />
    </div>
  );
}
