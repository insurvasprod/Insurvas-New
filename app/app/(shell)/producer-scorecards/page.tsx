import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { ScorecardsBoard } from "@/components/app/agency/scorecards-board";
import { sharedPeriod } from "@/lib/reports/views";

/**
 * AG-1.9 · Reports › Producer scorecards (moved from Team, owner 2026-11-03; same address). A producer sees his own
 * row; a manager his reports'; the owner, an admin and the bookkeeper everyone. The Reports period (`?from&to`)
 * carries in from the other views.
 */
export default async function ProducerScorecardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("producer_scorecards");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer scorecards" description="Who is profitable, not just busy." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Producer scorecards" detail="Producers see their own scorecard; the owner, admins, managers and the bookkeeper see the team's." />;
  const scoped = guard.role === "producer" && guard.context.memberRole !== "manager";
  return (
    <ReportsPage
      view="producers"
      title={scoped ? "My scorecard" : undefined}
      info={scoped ? "Your production, persistency and what your business costs, from the carriers' files." : "Which producers make the agency money once chargebacks are counted: placement, persistency at month 4 and 13, chargebacks, advance at risk and lead cost per issued and per persisting policy. Small samples show counts, not percentages. The gap between cost per issued and cost per persisting policy is the chargeback tax."}
    >
      <ScorecardsBoard scoped={scoped} initialPeriod={sharedPeriod(await searchParams)} />
    </ReportsPage>
  );
}
