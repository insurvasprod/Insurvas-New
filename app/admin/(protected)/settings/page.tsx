import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageSettings } from "@/lib/settings/permissions";
import { getAllSettings } from "@/lib/settings/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SettingsForm } from "@/components/admin/settings-form";

/**
 * SA-4.1's "Advanced" screen: the raw key/value store, for keys with no home of their own.
 *
 * Every other config area gets its own section under the Configuration Center in SA-4.3. This
 * page is deliberately plain — it is the fallback, not the destination.
 */
export default async function SettingsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageSettings(admin.role)) redirect("/admin");

  const settings = await getAllSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="Settings"
        subtitle="Platform-wide values that would otherwise be hardcoded. Each one saves on its own."
      />

      <SettingsForm
        initial={settings.map((s) => ({
          key: s.def.key,
          value: s.value,
          isOverridden: s.isOverridden,
          updatedAt: s.updatedAt,
        }))}
      />
    </div>
  );
}
