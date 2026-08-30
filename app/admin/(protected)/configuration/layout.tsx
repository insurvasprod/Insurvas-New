import { forbidden, redirect } from "next/navigation";

import { ConfigurationNav } from "@/components/admin/configuration/configuration-nav";
import { RecentChangesStrip } from "@/components/admin/configuration/recent-changes-strip";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { accessibleConfigurationSections, canAccessConfigurationCenter } from "@/lib/configuration/sections";
import { getRecentConfigurationChanges } from "@/lib/configuration/queries";

/**
 * Shared shell for the hub and every section route. A future section is a registry entry and a
 * route implementation; the global admin sidebar does not need to know its name.
 */
export default async function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationCenter(admin.role)) forbidden();

  const sections = accessibleConfigurationSections(admin.role);
  const recent = await getRecentConfigurationChanges(sections.map((section) => section.slug));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <RecentChangesStrip changes={recent} />
      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start">
        <ConfigurationNav sections={sections} />
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
