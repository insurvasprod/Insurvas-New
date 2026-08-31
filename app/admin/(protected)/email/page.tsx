import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ConfigurationPlaceholder } from "@/components/admin/configuration-placeholder";
import { getConfigurationSection } from "@/lib/configuration/sections";

export default async function EmailPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "email")) redirect("/admin");

  // SA-4.11 is On Hold: no provider or transport has been chosen, so this screen says so
  // rather than showing a form that saves settings nothing reads.
  const section = getConfigurationSection("email")!;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* "Mail Setup" to match the sidebar. Route stays /admin/email. */}
      <AdminPageHeader title="Mail Setup" subtitle="Mail server, sender identity, and templates." />
      <ConfigurationPlaceholder section={section} />
    </div>
  );
}
