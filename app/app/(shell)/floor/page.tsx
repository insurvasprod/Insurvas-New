import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgentFloor } from "@/components/app/agent-floor";

export default async function AgentFloorPage() {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Agent Floor" description="Run the inbound day from one live view of waiting transfers, active calls, and team availability." />;
  if (!["owner", "producer", "assistant"].includes(guard.role)) return <RoleGateNotice featureLabel="Agent Floor" detail="Only owners, producers, and buffer assistants can use the Agent Floor." />;
  return <AgentFloor currentUserId={guard.context.userId} readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} />;
}
