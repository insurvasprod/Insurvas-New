import { Suspense } from "react";

import { guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { loadEffectiveness, readEffectiveness } from "@/lib/retention/effectivenessStore";
import { loadRadarConfig } from "@/lib/retention/radarStore";
import { loadScoreCases, monthly } from "@/lib/retention/cases/store";
import { RESULTS_PERIODS, RESULTS_PERIOD_LABELS, caseResults, hasFigures, resultsPeriodOf, resultsSince, type ResultsPeriod } from "@/lib/retention/cases/results";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage } from "@/components/app/retention/retention-page";
import { RetentionResultsBoard } from "@/components/app/retention/retention-results-board";
import { RetentionPeriodSelect } from "@/components/app/retention/scorecard-period-select";
import { ResultsByCarrier, ResultsByStep, ResultsStrip, ResultsTimeToSave } from "@/components/app/retention/results-tables";
import { ResultsCarrierChart, ResultsStepChart, ResultsTimeChart } from "@/components/app/retention/retention-charts";
import { caseTrend } from "@/lib/retention/cases/trend";
import { showHref, showOf } from "@/lib/reports/show";
import { ViewSwitch } from "@/components/ui/view-switch";
import { LADDER_PENDING_MESSAGE } from "@/lib/retention/cases/sync";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

const VIEWS = ["saves", "carriers", "time", "radar"] as const;
type ResultsView = (typeof VIEWS)[number];
const TRAIL = [{ label: "Retention" }, { label: "Results" }];

/**
 * Retention › Results (LA-5.9, Notion sprint; round 7, owner pick 0·A/6·A, 2026-11-10;
 * docs/la4/mockups-r7/retention.html): what the ladder saved. On the Retention rail, owner only: it is the whole
 * agency's numbers, and the answer to "is Retention worth it?". The title alone with its (i); Saves · By carrier ·
 * Time to save · Radar check on its line (`?view=`), and the period as the line's one control (`?period=`). Saves, By
 * carrier and Time to save come from the ladder's cases (lib/retention/cases/results.ts); Radar check is LA-5.9's
 * board as it was: did the radar's bands come true on the policies nobody worked, and did working beat the holdout.
 */
export default async function RetentionResultsPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string; show?: string }> }) {
  const guard = await guardPage("chargeback_radar");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Retention results" description="What the ladder saved, by step and by carrier, and whether the risk bands came true." />;
  }
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Retention results" detail="Only the owner sees whether the retention module is earning its price." />;
  }
  const query = await searchParams;
  const { period: periodParam, view: viewParam } = query;
  // Reports round 7 (owner pick 0·A, 2026-11-11): Table · Chart on the title line, the chart by default; the tabs
  // and the period keep the choice.
  const show = showOf(query, "chart");
  const period: ResultsPeriod = resultsPeriodOf(periodParam);
  const view: ResultsView = (VIEWS as readonly string[]).includes(viewParam ?? "") ? (viewParam as ResultsView) : "saves";
  const href = (key: ResultsView) => {
    const q = new URLSearchParams();
    if (key !== "saves") q.set("view", key);
    if (period !== "quarter") q.set("period", period);
    if (show === "table") q.set("show", "table");
    return q.size ? `/app/retention-results?${q}` : "/app/retention-results";
  };
  const periodSelect = <RetentionPeriodSelect value={period} fallback="quarter" options={(Object.keys(RESULTS_PERIODS) as ResultsPeriod[]).map((p) => ({ value: p, label: RESULTS_PERIOD_LABELS[p] }))} />;
  const actions = <span className="inline-flex flex-wrap items-center gap-2"><Suspense fallback={null}><ViewSwitch fallback="chart" /></Suspense>{periodSelect}</span>;
  const info = view === "radar"
    ? "From your own book: did the radar's bands come true on the policies nobody worked, and did working the queue beat the holdout? Under 20 policies a cell shows the count, never a percentage, and a difference that is not yet meaningful says so."
    : "What the ladder saved, from your own cases: how many were opened, saved (a later carrier file proved it), lost and closed without a save, by the step the case was on and by carrier, and how long a save took. Under 20 decided cases a cell shows the count, never a percentage.";

  // The ladder's cases for the first three tabs (the owner sees every case); the radar's figures only on its tab.
  const today = new Date().toISOString().slice(0, 10);
  const since = resultsSince(period, today);
  const ladder = view === "radar" ? null : await loadScoreCases({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) }, RESULTS_PERIODS[period] ?? 36_500);
  const results = ladder ? caseResults(ladder.cases.map((c) => ({ step: c.step, status: c.status, carrierId: c.carrierId, carrierName: c.carrierName, openedAt: c.openedAt, resolvedAt: c.resolvedAt, monthlyCents: monthly(c.premiumCents, c.premiumMode) })), since) : null;

  const tabs = (
    <ViewTabs
      label="Results views"
      value={view}
      tabs={[
        { key: "saves" as const, label: "Saves", href: href("saves") },
        { key: "carriers" as const, label: "By carrier", count: results ? results.byCarrier.filter(hasFigures).length : null, href: href("carriers") },
        { key: "time" as const, label: "Time to save", href: href("time") },
        { key: "radar" as const, label: "Radar check", href: href("radar") },
      ]}
    />
  );

  const periodLabel = RESULTS_PERIOD_LABELS[period];
  const tableHref = showHref(href(view), "table");
  let body;
  if (view === "radar") {
    // The figures need no settings to be read, so they are read beside the config (one round trip, not two);
    // the no-op catch only stops a failure counting as unhandled when there is no config to use them.
    const reads = readEffectiveness(guard.context.tenantId);
    reads.catch(() => undefined);
    const config = await loadRadarConfig(guard.context.tenantId);
    const data = config ? await loadEffectiveness(guard.context.tenantId, period, config.settings, reads) : null;
    body = data ? <RetentionResultsBoard data={data} periodLabel={periodLabel} /> : <TableCard><EmptyState title="Not switched on yet" hint="Measuring the radar needs a database update (20261016210000)." /></TableCard>;
  } else if (!results) {
    body = <TableCard><EmptyState title="Not switched on yet" hint={LADDER_PENDING_MESSAGE} /></TableCard>;
  } else if (view === "carriers") {
    body = show === "chart" ? <ResultsCarrierChart results={results} periodLabel={periodLabel} tableHref={tableHref} /> : <ResultsByCarrier results={results} />;
  } else if (view === "time") {
    body = show === "chart" ? <ResultsTimeChart results={results} periodLabel={periodLabel} tableHref={tableHref} /> : <ResultsTimeToSave results={results} />;
  } else {
    // The cards' small charts: the same figures a week at a time (a month past half a year), from the same cases.
    const trend = ladder ? caseTrend(ladder.cases.map((c) => ({ status: c.status, openedAt: c.openedAt, resolvedAt: c.resolvedAt })), since, today) : undefined;
    body = <><ResultsStrip total={results.total} trend={trend} />{show === "chart" ? <ResultsStepChart results={results} periodLabel={periodLabel} tableHref={tableHref} /> : <ResultsByStep results={results} />}</>;
  }

  return (
    <RetentionPage step="results" title="Results" info={info} tabs={tabs} actions={actions} breadcrumbs={TRAIL}>
      {body}
    </RetentionPage>
  );
}
