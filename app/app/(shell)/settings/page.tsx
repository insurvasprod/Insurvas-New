import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { getTeamSnapshot } from "@/lib/tenantTeam/service";
import { outboundLimitSnapshot } from "@/lib/metering/outbound";
import { PageHeader } from "@/components/ui/page-header";
import { getWorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";
import { AgentSettingsTabs } from "@/components/app/agent-settings-tabs";
import { sectionForPath } from "@/lib/menu/definition";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";

export default async function SettingsPage() {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled)
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Template settings"
        description="Choose and customize the lead, pipeline and application template for your agency."
      />
    );
  if (guard.role !== "owner") {
    return (
      <RoleGateNotice
        featureLabel="Settings"
        detail="Settings and team access are managed by the account owner."
      />
    );
  }
  // Independent reads, fetched together rather than one after the other.
  const [teamSnapshot, outboundLimits, workspace] = await Promise.all([
    getTeamSnapshot(guard.context.tenantId, guard.entitlement),
    outboundLimitSnapshot(guard.context.tenantId),
    getWorkspaceSnapshot(guard.context.tenantId, guard.entitlement.plan_code ?? null),
  ]);
  // viewerId: Team & access shows no row action on your own row (the board's owner row).
  const team = { ...teamSnapshot, outboundLimits, viewerId: guard.context.userId };
  return (
    <div className="m-stagger portal-settings-page flex flex-col gap-6">
      <PageHeader
        eyebrow={sectionForPath("/app/settings") ?? "Settings"}
        title="Settings"
        description="Agency products, credentials, calling rules and team access. Owner only, effective-dated, audited."
      />

      <AgentSettingsTabs team={team} workspace={workspace} tabs={SETTINGS_SECTIONS} />
    </div>
  );
}
