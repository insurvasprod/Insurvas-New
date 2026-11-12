import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { ScorecardRecord, ScorecardsBoard } from "@/components/app/agency/scorecards-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { producerScores } from "@/lib/agency/scorecardStore";
import { scopeFor } from "@/lib/agency/visibility";
import { asShown, dayMonth, defaultPeriod, scoreFilterOf } from "@/lib/agency/scorecardView";
import { showOf } from "@/lib/reports/show";
import { sharedPeriod } from "@/lib/reports/views";

const TEAM_INFO = "Which producers make the agency money once chargebacks are counted: placement, persistency at month 4, chargebacks and the advance at risk. A producer's page adds what they submitted, month 13 and lead cost per issued and per persisting policy, against the team. Small samples show counts, not percentages.";
const MINE_INFO = "Your production, persistency and what your business costs, from the carriers' files.";

/**
 * AG-1.9 · Reports › Producer scorecards (moved from Team, owner 2026-11-03; same address), round 7 (owner pick 5·A,
 * 2026-11-11): the Table · Chart switch, opening on the chart. A producer sees "My scorecard" — his own record page,
 * no ‹ › and no team figures; a manager his reports'; the owner, an admin and the bookkeeper everyone. The Reports
 * period (`?from&to`) carries in from the other views. Read on the server, scoped by AG-0.4 in scorecardStore.
 */
export default async function ProducerScorecardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("producer_scorecards");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer scorecards" description="Who is profitable, not just busy." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Producer scorecards" detail="Producers see their own scorecard; the owner, admins, managers and the bookkeeper see the team's." />;
  const scoped = guard.role === "producer" && guard.context.memberRole !== "manager";
  const query = await searchParams;
  const period = sharedPeriod(query) ?? defaultPeriod();
  const show = showOf(query, "chart");
  const data = await producerScores(guard.context, period, undefined, { scope: scopeFor(guard.context), series: !scoped });

  if (scoped) {
    // "My scorecard" (5·4): only his own row, which is all the scoped read returns.
    const mine = asShown(data.rows).find((r) => r.producerUserId === guard.context.userId);
    return (
      <ReportsPage view="producers" title="My scorecard" info={MINE_INFO} show="chart"
        facts={mine ? `${dayMonth(period.from)} – ${dayMonth(period.to)} · ${mine.submitted} submitted through Insurvas · ${mine.issued} issued in the carriers' files` : undefined}>
        {mine && data.available
          ? <ScorecardRecord row={mine} team={null} period={period} show={show} mine />
          : <TableCard><EmptyState title={data.available ? "No scorecard yet" : "No carrier files yet"} hint={data.available ? "Your scorecard appears once you are an active producer." : "Scorecards are built from your agency's carrier policy files."} /></TableCard>}
      </ReportsPage>
    );
  }

  return (
    <ReportsPage view="producers" info={TEAM_INFO} show="chart">
      <ScorecardsBoard available={data.available} rows={asShown(data.rows)} minSample={data.minSample} series={data.series} period={period} show={show} filter={scoreFilterOf(query.has)} />
    </ReportsPage>
  );
}
