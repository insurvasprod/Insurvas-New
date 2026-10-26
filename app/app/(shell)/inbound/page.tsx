import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TransferInbox } from "@/components/app/transfer-inbox";
import { DashboardStage } from "@/components/ui/dashboard-stage";

export default async function InboundTransfersPage() {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound" description="See, screen and claim incoming transfers." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Inbound" detail="Only owners, producers, and buffer assistants can work inbound transfers." />;
  // Inbound A · Stream (2026-10-25): on the dashboard's moving ribbon.
  return (
    <DashboardStage ribbon>
      <TransferInbox readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} role={guard.role} />
    </DashboardStage>
  );
}
