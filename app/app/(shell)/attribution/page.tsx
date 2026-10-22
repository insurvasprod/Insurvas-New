import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AttributionBoard } from "@/components/app/agency/attribution-board";

/** AG-1.4 · Commissions › Attribution queue. The owner, an admin or the bookkeeper decides. */
export default async function AttributionPage() {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Attribution queue" description="Statement rows we could not safely give to one producer." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Attribution queue" detail="The owner, admins and the bookkeeper resolve attribution." />;
  return <AttributionBoard canResolve={guard.entitlement.access !== "read_only"} />;
}
