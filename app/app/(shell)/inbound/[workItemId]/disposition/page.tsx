import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DispositionWizard } from "@/components/app/disposition-wizard";

export default async function DispositionPage({ params }: { params: Promise<{ workItemId: string }> }) {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound transfers" description="Record a single structured outcome for every call." />;
  if (!["owner", "producer"].includes(guard.role)) return <RoleGateNotice featureLabel="Inbound transfers" detail="Only owners and producers can record a call outcome." />;
  const { workItemId } = await params;
  return <DispositionWizard workItemId={workItemId} readOnly={guard.entitlement.status === "suspended" || guard.entitlement.status === "paused"} />;
}
