import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { VerificationPanel } from "@/components/app/verification-panel";
import { DashboardStage } from "@/components/ui/dashboard-stage";

export default async function VerificationPage({ params }: { params: Promise<{ workItemId: string }> }) {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound transfers" description="Verify every required application field before you submit it." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Inbound transfers" detail="Only owners, producers, and buffer assistants can verify an inbound transfer." />;
  const { workItemId } = await params;
  // The inbound call screen (Inbound A, 2026-10-25), on the moving ribbon like the dialer.
  return <DashboardStage ribbon><VerificationPanel workItemId={workItemId} readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} canHandoff={guard.role === "assistant"} /></DashboardStage>;
}
