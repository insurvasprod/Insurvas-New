import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TransferInbox } from "@/components/app/transfer-inbox";

export default async function InboundTransfersPage() {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound transfers" description="See incoming transfers, check screening signals, and claim a call without races." />;
  if (!["owner", "producer", "assistant"].includes(guard.role)) return <RoleGateNotice featureLabel="Inbound transfers" detail="Only owners, producers, and buffer assistants can work inbound transfers." />;
  return <TransferInbox readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} role={guard.role} />;
}
