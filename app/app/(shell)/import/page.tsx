import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { LeadImportWorkspace } from "@/components/app/lead-import-workspace";

export default async function LeadImportPage() {
  const guard = await guardPage("lead_import");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="List import" description="Import a lead list into your versioned product pipeline." />;
  if (!("owner" === guard.role || "producer" === guard.role || "assistant" === guard.role)) return <RoleGateNotice featureLabel="List import" detail="Only owners, producers and assistants can import leads." />;
  return <LeadImportWorkspace />;
}
