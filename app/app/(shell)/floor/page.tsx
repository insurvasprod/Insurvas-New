import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgentFloor } from "@/components/app/agent-floor";
import { DashboardStage } from "@/components/ui/dashboard-stage";

export default async function AgentFloorPage() {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound floor" description="Waiting transfers, live calls and team status in one view." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Inbound floor" detail="Only owners, producers, and buffer assistants can use the Agent Floor." />;
  // Inbound A · Stream (2026-10-25): on the dashboard's static stage backdrop.
  return (
    <DashboardStage>
      <AgentFloor currentUserId={guard.context.userId} role={guard.role} readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} />
    </DashboardStage>
  );
}
