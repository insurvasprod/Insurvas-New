import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ScorecardsBoard } from "@/components/app/agency/scorecards-board";

/** AG-1.9 · Team › Producer scorecards. A producer sees his own row; a manager his reports'; the owner everyone. */
export default async function ProducerScorecardsPage() {
  const guard = await guardPage("producer_scorecards");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer scorecards" description="Who is profitable, not just busy." />;
  if (!["owner", "bookkeeper", "producer"].includes(guard.role)) return <RoleGateNotice featureLabel="Producer scorecards" detail="Producers see their own scorecard; the owner, admins, managers and the bookkeeper see the team's." />;
  return <ScorecardsBoard scoped={guard.role === "producer" && guard.context.memberRole !== "manager"} />;
}
