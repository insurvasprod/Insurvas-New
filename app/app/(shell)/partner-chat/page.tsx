import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgentPartnerChatWorkspace } from "@/components/app/partner-chat-workspace";

export default async function AgentPartnerChatPage() {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner chat" description="Keep partner conversations and automated lead updates together." />;
  if (!["owner", "producer"].includes(guard.role)) return <RoleGateNotice featureLabel="Partner chat" detail="Only owners and producers can manage agent-side partner conversations." />;
  // The support email and phone partners see in Messages › Details are set in Settings › Agency profile.
  return <AgentPartnerChatWorkspace />;
}
