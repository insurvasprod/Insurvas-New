import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ReconciliationBoard } from "@/components/app/agency/reconciliation-board";

/** AG-1.12 · Commissions › Producer reconciliation. The owner, an admin or the bookkeeper. */
export default async function ProducerReconciliationPage() {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer reconciliation" description="Expected, reported and received, per producer." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Producer reconciliation" detail="The owner, admins and the bookkeeper reconcile producer pay." />;
  return <ReconciliationBoard canReview={guard.entitlement.access !== "read_only"} />;
}
