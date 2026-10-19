import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { SplitsBoard } from "@/components/app/agency/splits-board";

/** AG-1.6 · Team › Commission splits. Owner and admin edit; the bookkeeper reads. */
export default async function CommissionSplitsPage() {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Commission splits" description="Policies two producers share." />;
  if (!["owner", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Commission splits" detail="The owner, admins and the bookkeeper see commission splits." />;
  return <SplitsBoard canEdit={guard.role === "owner"} />;
}
