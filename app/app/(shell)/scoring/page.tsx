import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { ScoringWorkspace } from "@/components/app/scoring-workspace";
import { DashboardStage } from "@/components/ui/dashboard-stage";

export default async function ScoringPage() {
  const guard = await guardPage("outbound_dialing");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="Queue scoring" description="Decide the order leads are served in, and measure whether it beats the plain order." />;
  // Owner and producer. The weights decide the order of a setter's own queue, and vendor contact
  // rate is one of the signals.
  if (!("owner" === guard.role || "producer" === guard.role))
    return <RoleGateNotice featureLabel="Queue scoring" detail="Only owners and producers can change how the queue is ordered." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Queue scoring" detail="In an agency, the owner and admins decide how the queue is ordered." />;
  // A read-only plan sees the order and cannot save it (the PUT refuses it too).
  return <DashboardStage ribbon><ScoringWorkspace readOnly={guard.entitlement.access === "read_only"} /></DashboardStage>;
}
