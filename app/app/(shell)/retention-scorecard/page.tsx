import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadScorecard, SCORECARD_PERIODS, type ScorecardPeriod } from "@/lib/retention/scorecardStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionScorecardBoard } from "@/components/app/retention/retention-scorecard-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ReportsPage } from "@/components/app/reports/reports-page";

/**
 * Reports › Retention scorecard (LA-5.8, Notion sprint). What each person working retention achieved:
 * policies worked, contact rate, save rate by reason (never blended alone), verified conversions,
 * reinstatements, and the premium and advance still in force 90 days after being worked. Holdout
 * cases count against nobody. An owner sees everyone; anyone else their own card only.
 */
export default async function RetentionScorecardPage({ searchParams }: { searchParams: Promise<{ period?: string; rep?: string }> }) {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Retention scorecard" description="What each person working retention achieved, save rate by reason." />;
  }
  if (!actAsPage(guard, ["owner", "producer", "retention"])) {
    return <RoleGateNotice featureLabel="Retention scorecard" detail="Only owners, producers and retention reps have a retention scorecard." />;
  }
  const { period: periodParam, rep } = await searchParams;
  const period: ScorecardPeriod = periodParam && periodParam in SCORECARD_PERIODS ? (periodParam as ScorecardPeriod) : "180";
  const data = await loadScorecard({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role }, period);

  return (
    <ReportsPage view="retention" info="What each person working retention achieved. The save rate is shown per reason, never blended on its own; under 10 decided cases a reason shows the counts. Unreachable cases have their own column, and held-out policies count against nobody.">
    <>
      {data.available ? (
        <RetentionScorecardBoard data={data} period={period} selected={rep ?? null} isOwner={guard.role === "owner"} viewerId={guard.context.userId} />
      ) : (
        <TableCard>
          <EmptyState title="Not switched on yet" hint="The retention scorecard needs a database update (20261016200000)." />
        </TableCard>
      )}
    </>
    </ReportsPage>
  );
}
