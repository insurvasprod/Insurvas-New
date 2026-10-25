import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { AgentPartnerChatWorkspace } from "@/components/app/partner-chat-workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AgentPartnerChatPage({ searchParams }: { searchParams: Promise<{ partner?: string | string[] }> }) {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner chat" description="Partner messages and lead updates together." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Partner chat" detail="Only owners and producers can manage agent-side partner conversations." />;
  // The support email and phone partners see in Messages › Details are set in Settings › Agency profile.
  // A partner thread links to that partner's record for an owner with Partners on the plan.
  const records = await guardPage("publisher_records");
  // ?partner= (the partner record's Message button) opens on that partner's latest conversation.
  const partner = (await searchParams).partner;
  const openPartnerId = typeof partner === "string" && UUID.test(partner) ? partner : undefined;
  // Partners A (2026-10-25): on the dashboard's moving ribbon.
  return <DashboardStage ribbon><AgentPartnerChatWorkspace recordLinks={records.entitled && actAsPage(records, ["owner", "bookkeeper"])} openPartnerId={openPartnerId} /></DashboardStage>;
}
