import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { TemplateSettings } from "@/components/app/template-settings";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TeamSettings } from "@/components/app/team-settings";
import { getTeamSnapshot } from "@/lib/tenantTeam/service";
import { CarrierLibrarySettings } from "@/components/app/carrier-library-settings";
import { AppointmentVaultSettings } from "@/components/app/appointment-vault-settings";
import { PipelineSettings } from "@/components/app/pipeline-settings";
import { DispositionSettings } from "@/components/app/disposition-settings";
import { QueueSlaSettings } from "@/components/app/queue-sla-settings";

export default async function SettingsPage() {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Template settings" description="Choose and customize the lead, pipeline and application template for your agency." />;
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Settings" detail="Settings and team access are managed by the account owner." />;
  }
  const team = await getTeamSnapshot(guard.context.tenantId, guard.entitlement);
  return <div className="mx-auto max-w-6xl space-y-6"><QueueSlaSettings /><CarrierLibrarySettings /><AppointmentVaultSettings /><PipelineSettings /><DispositionSettings /><TemplateSettings /><TeamSettings initial={team} /></div>;
}
