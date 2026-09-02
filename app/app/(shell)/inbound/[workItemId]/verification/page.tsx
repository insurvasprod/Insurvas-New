import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { VerificationPanel } from "@/components/app/verification-panel";

export default async function VerificationPage({ params }: { params: Promise<{ workItemId: string }> }) {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound transfers" description="Verify every required application field before you submit it." />;
  if (!["owner", "producer", "assistant"].includes(guard.role)) return <RoleGateNotice featureLabel="Inbound transfers" detail="Only owners, producers, and buffer assistants can verify an inbound transfer." />;
  const { workItemId } = await params;
  return <VerificationPanel workItemId={workItemId} readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} canHandoff={guard.role === "assistant"} />;
}
