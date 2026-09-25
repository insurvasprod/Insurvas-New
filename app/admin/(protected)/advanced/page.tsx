import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SettingsForm } from "@/components/admin/settings-form";
import { getAllSettings } from "@/lib/settings/queries";
import { LOGIN_PROTECTION_ROLES, canManageSettingKey } from "@/lib/settings/restrictions";

export default async function AdvancedPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "advanced")) redirect("/admin");

  const settings = await getAllSettings();

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {/* "Within 30 seconds", not "immediately": the settings cache on every other instance lives
          that long after a write (lib/settings/queries.ts CACHE_TTL_MS). */}
      <AdminPageHeader
        title="Advanced"
        subtitle="Raw platform settings. Changes apply within 30 seconds. There is no staging step."
      />
      <SettingsForm
        initial={settings
          // Login-protection keys are super admin only, and the settings API refuses them to
          // anyone else — so they are not drawn, or sent, to a role that cannot change them.
          .filter((setting) => canManageSettingKey(admin.role, setting.def.key))
          .map((setting) => ({
            key: setting.def.key,
            value: setting.value,
            isOverridden: setting.isOverridden,
            updatedAt: setting.updatedAt,
          }))}
        canManageLoginProtection={LOGIN_PROTECTION_ROLES.includes(admin.role)}
      />
    </div>
  );
}
