import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { getTeamSnapshot } from "@/lib/tenantTeam/service";
import { outboundLimitSnapshot } from "@/lib/metering/outbound";
import { Badge } from "@/components/ui/badge";
import { AgentSettingsTabs } from "@/components/app/agent-settings-tabs";
import { sectionForPath } from "@/lib/menu/definition";

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
  const team = { ...(await getTeamSnapshot(guard.context.tenantId, guard.entitlement)), outboundLimits: await outboundLimitSnapshot(guard.context.tenantId) };
  return (
    <div className="portal-settings-page mx-auto max-w-7xl space-y-6">
      <header className="portal-settings-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="portal-page-eyebrow">{sectionForPath("/app/settings")}</p>
          <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">Settings</h1>
          <p className="mt-2 text-lg tracking-[-0.02em] text-muted-foreground">Manage agency products, credentials, and team access.</p>
        </div>
        <div className="portal-settings-owner-note">
          <Badge variant="outline">Owner only</Badge>
          <span>Changes are effective-dated and audited.</span>
        </div>
      </header>

      <AgentSettingsTabs team={team} tabs={[
        { id: "agency-profile", label: "Agency profile", description: "Review your agency settings, account health, and owner-only controls." },
        { id: "carrier-library", label: "Carrier library", description: "Configure carrier contracts, products, commission schedules, and advance rules." },
        { id: "states-licences", label: "States & licences", description: "Keep appointments, licences, E&O coverage, and continuing education in one place." },
        { id: "team-access", label: "Team & access", description: "Manage owners, licensed agents, setters, assistants, and their access boundaries." },
        { id: "queue-sla", label: "Queue & SLA", description: "Set the response windows and ownership rules that keep inbound work moving." },
        { id: "pipelines", label: "Pipelines", description: "Organize stages for inbound, outbound, and partner lead workflows." },
        { id: "dispositions", label: "Dispositions", description: "Control call outcomes, follow-up rules, and the next action after every conversation." },
        { id: "form-templates", label: "Form templates", description: "Maintain the partner and agent forms used to capture complete lead information." },
        { id: "alerts", label: "Alerts", description: "Alert preferences are managed from the alert center.", disabled: "Managed from the alert center" },
        { id: "billing", label: "Billing", description: "Billing is managed by your account administrator.", disabled: "Managed by your account administrator" },
      ]} />
    </div>
  );
}
