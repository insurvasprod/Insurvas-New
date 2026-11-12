import { StatStrip, StatTile } from "@/components/ui/stat";
import { MIN_DECIDED, rateText, type ScoreLine } from "@/lib/retention/cases/scorecard";
import type { CaseTrend } from "@/lib/retention/cases/trend";
import { SCORECARD_PERIOD_LABELS, type ScorecardPeriod } from "@/lib/retention/scorecard";
import { showHref, type ShowMode } from "@/lib/reports/show";

import { ScorecardPeopleChart, ScorecardStepChart } from "./retention-charts";
import { spark } from "./results-tables";

import { ScorecardPeopleTable, ScorecardStepTable, casesHref, money } from "./scorecard-tables";

export const SCORECARD_PATH = "/app/retention-scorecard";
export type ScorecardView = "people" | "steps";

/** The scorecard's address: the period (180 days left out), the view, a person, the table (the chart left out). */
export function scorecardHref({ period, view, rep, show }: { period: ScorecardPeriod; view?: ScorecardView | null; rep?: string | null; show?: ShowMode }): string {
  const q = new URLSearchParams();
  if (period !== "180") q.set("period", period);
  if (view && view !== "people") q.set("view", view);
  if (rep) q.set("rep", rep);
  if (show === "table") q.set("show", "table");
  return q.size ? `${SCORECARD_PATH}?${q}` : SCORECARD_PATH;
}

/**
 * Retention › Scorecard on the ladder (round 7, owner pick 5·A, 2026-11-10; Reports round 7 9·2, 2026-11-11). The
 * page's title line carries By person · By step, the Table · Chart switch (`?show=`, the chart by default) and the
 * period; here the four cards, each said once, opening Cases filtered and carrying a small chart of the same figure a
 * week at a time, then the chart or the six-column table. A person's row or bar opens their page (board 5·1).
 */
export function CaseScorecardBoard({ people, steps, total, names, view, period, viewerId, show, trend }: { people: ScoreLine[]; steps: ScoreLine[]; total: ScoreLine; names: Record<string, string>; view: ScorecardView; period: ScorecardPeriod; viewerId: string; show: ShowMode; trend: CaseTrend }) {
  const personHref = (rep: string) => scorecardHref({ period, rep, show });
  const tableHref = showHref(scorecardHref({ period, view }), "table");
  const periodLabel = SCORECARD_PERIOD_LABELS[period];
  return (
    <>
      <StatStrip label="Retention, on the ladder">
        <StatTile label="Open" href={casesHref({})} value={total.open.toLocaleString("en-US")} footnote={`${total.unreachable.toLocaleString("en-US")} unreachable`} trend={spark(trend.open)} />
        <StatTile label="Saved" href={casesHref({ step: "closed" })} value={total.saved.toLocaleString("en-US")} footnote={`${money(total.keptCents)}/mo kept`} trend={spark(trend.saved)} />
        <StatTile label="Lost" href={casesHref({ step: "closed" })} value={total.lost.toLocaleString("en-US")} footnote={`${total.closedNoSave.toLocaleString("en-US")} closed without a save`} trend={spark(trend.lost)} />
        <StatTile label="Retention rate" href={casesHref({ step: "closed" })} value={rateText(total)} labelTitle={`Saved of saved and lost. Under ${MIN_DECIDED} decided cases the counts are shown. The small chart is the rate so far, week by week.`} footnote="saved ÷ (saved + lost)" trend={spark(trend.rate)} />
      </StatStrip>
      {show === "chart"
        ? view === "steps"
          ? <ScorecardStepChart steps={steps} total={total} owner={null} title="Where the open cases sit" periodLabel={periodLabel} tableHref={tableHref} />
          : <ScorecardPeopleChart people={people} total={total} names={names} viewerId={viewerId} personHref={personHref} periodLabel={periodLabel} tableHref={tableHref} />
        : view === "steps"
          ? <ScorecardStepTable steps={steps} total={total} owner={null} unreachable />
          : <ScorecardPeopleTable people={people} total={total} names={names} viewerId={viewerId} personHref={personHref} />}
    </>
  );
}

/**
 * Board 5·1 / 9·4, a person: their cases by the step they are on, as bars (the chart) or the six-column table. The
 * title (their name), By step · Open · Saved · Lost, the switch and ‹ › naming the people either side are the page's.
 */
export function CasePersonBoard({ steps, total, owner, name, period, rep, show }: { steps: ScoreLine[]; total: ScoreLine; owner: string | null; name: string; period: ScorecardPeriod; rep: string | null; show: ShowMode }) {
  if (show === "chart") {
    const title = name === "You" ? "Your open cases by step" : `${name}'s open cases by step`;
    return <ScorecardStepChart steps={steps} total={total} owner={owner} title={title} periodLabel={SCORECARD_PERIOD_LABELS[period]} tableHref={showHref(scorecardHref({ period, rep }), "table")} />;
  }
  return <ScorecardStepTable steps={steps} total={total} owner={owner} unreachable />;
}
