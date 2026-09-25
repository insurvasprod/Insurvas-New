import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ScoringWorkspace } from "@/components/app/scoring-workspace";

export default async function ScoringPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Queue scoring" description="Decide the order leads are served in, and measure whether it beats the plain order." />;
  // Owner and producer. The weights decide the order of a setter's own queue, and vendor contact
  // rate is one of the signals.
  if (!("owner" === guard.role || "producer" === guard.role))
    return <RoleGateNotice featureLabel="Queue scoring" detail="Only owners and producers can change how the queue is ordered." />;
  return <ScoringWorkspace />;
}
