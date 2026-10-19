import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PayoutsBoard } from "@/components/app/agency/payouts-board";

/** AG-1.7 · Team › Payout runs. The owner, an admin or the bookkeeper runs them. */
export default async function ProducerPayoutsPage() {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Payout runs" description="Close a period and pay your producers." />;
  if (!["owner", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Payout runs" detail="The owner, admins and the bookkeeper run producer payouts. Your own pay is under My pay." />;
  return <PayoutsBoard canCommit={guard.entitlement.access !== "read_only"} />;
}
