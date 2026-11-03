import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SettingsForm } from "@/components/admin/settings-form";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getAllSettings } from "@/lib/settings/queries";
import { LOGIN_PROTECTION_ROLES, canManageSettingKey } from "@/lib/settings/restrictions";

export default async function AdvancedPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "advanced")) redirect("/admin");

  const settings = await getAllSettings();
  // Login-protection keys are super admin only, and the settings API refuses them to anyone else —
  // so they are not drawn, sent, or counted for a role that cannot change them.
  const shown = settings.filter((setting) => canManageSettingKey(admin.role, setting.def.key));
  const overridden = shown.filter((setting) => setting.isOverridden).length;
  const groups = new Set(shown.map((setting) => setting.def.group)).size;
  const lastWrite = shown.reduce<string | null>((latest, setting) => (setting.updatedAt && (!latest || setting.updatedAt > latest) ? setting.updatedAt : latest), null);

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {/* "Within 30 seconds", not "immediately": the settings cache on every other instance lives
          that long after a write (lib/settings/queries.ts CACHE_TTL_MS). */}
      <AdminPageHeader
        title="Advanced"
        subtitle="Changes apply within 30 seconds, with no staging step."
      />
      <StatStrip label="Setting totals">
        <StatTile label="Settings" value={shown.length.toLocaleString("en-US")} footnote={`${groups.toLocaleString("en-US")} groups`} />
        <StatTile label="Overridden" value={overridden.toLocaleString("en-US")} valueTone={overridden > 0 ? "info" : undefined} footnote="changed from the default" />
        <StatTile label="At default" value={(shown.length - overridden).toLocaleString("en-US")} reserveFootnote />
        <StatTile label="Last saved" valueSize="text" value={lastWrite ? new Date(lastWrite).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never"} reserveFootnote />
      </StatStrip>
      <SettingsForm
        initial={shown
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
