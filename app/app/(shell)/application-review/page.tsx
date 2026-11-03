import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ApplicationsHub } from "@/components/app/applications/applications-hub";
import { applicationsTabs, hasCalculator } from "@/components/app/applications/applications-tabs";
import { canWrite } from "@/lib/entitlements/types";
import { ReviewBoard } from "@/components/app/agency/review-board";

/**
 * AG-1.11 · Sales › Applications › Application review (moved from Team, owner 2026-11-03; same address). It reads
 * submitted applications against LA-3's own checks, so it sits with the applications. Owner and admins set rates;
 * managers review; a producer reads his own. `?show=reviewed|tally` opens the other lists.
 */
export default async function ApplicationReviewPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const guard = await guardPage("team_qa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Application review" description="A sample of each producer's submitted paperwork, reviewed and coached." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Application review" detail="The owner, admins, managers and producers see application review." />;
  const show = (await searchParams).show;
  return (
    <ApplicationsHub view="review" tabs={applicationsTabs(guard.entitlement)} calculator={hasCalculator(guard.entitlement)} readOnly={!canWrite(guard.entitlement)}>
      <ReviewBoard canSetRates={guard.role === "owner" && guard.entitlement.access !== "read_only"} initialShow={show === "reviewed" || show === "tally" ? show : "queue"} />
    </ApplicationsHub>
  );
}
