import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ReviewBoard } from "@/components/app/agency/review-board";

/** AG-1.11 · Team › Application review. Owner and admins set rates; managers review; a producer reads his own. */
export default async function ApplicationReviewPage() {
  const guard = await guardPage("team_qa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Application review" description="A sample of each producer's submitted paperwork, reviewed and coached." />;
  if (!["owner", "producer"].includes(guard.role)) return <RoleGateNotice featureLabel="Application review" detail="The owner, admins, managers and producers see application review." />;
  return <ReviewBoard canSetRates={guard.role === "owner" && guard.entitlement.access !== "read_only"} />;
}
