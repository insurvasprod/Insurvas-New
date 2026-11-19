import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { ComplianceVendorsTable } from "@/components/admin/compliance-vendors-table";
import { PlatformPage } from "@/components/admin/platform/platform-page";
import { TitleActionButton } from "@/components/admin/platform/title-action";
import { PLATFORM_ACTION } from "@/lib/adminPlatform/titleActions";
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

  // Inside the Platform frame (admin round 1, 2026-11-18). "Register a vendor" is on the title line and opens the
  // dialog the table holds. Route stays /admin/compliance-sources so existing links keep working.
  return (
    <PlatformPage
      step="compliance"
      info="The DNC and litigator screening vendors every dial is checked against. Dialing is refused when no vendor of a type is enabled and answering."
      actions={<TitleActionButton action={PLATFORM_ACTION.registerVendor}>Register a vendor</TitleActionButton>}
    >
      <ComplianceVendorsTable initial={registry} />
    </PlatformPage>
  );
}
