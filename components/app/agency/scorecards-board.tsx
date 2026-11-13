import type { ReactNode } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { BarList, ChartHeading, ChartLegend, ShareBar, type BarListRow } from "@/components/ui/chart";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { buttonVariants } from "@/components/ui/button";
import { ReportsSlot } from "@/components/app/reports/reports-slot";
import { ViewTabs } from "@/components/ui/view-tabs";
import { LinkRow } from "@/components/app/book/setup/link-row";
import { RecordStepper } from "@/components/app/accounting/record-stepper";
import { dollars } from "@/lib/agency/constants";
import { showHref, type ShowMode } from "@/lib/reports/show";
import {
  SCORE_FILTERS, SCORECARDS_HREF, byIssued, dayMonth, filterRows, monthYear, percent, perPolicyText, persistingText, recordHref, scoreChip, shareOrCount, teamFigures,
  type ScoreFilter, type ScoreRow, type TeamFigures,
} from "@/lib/agency/scorecardView";
import type { ScoreSeries } from "@/lib/agency/scorecardStore";

import { ScorecardsCsv, ScorecardsFilter, ScorecardsPeriod, ScorecardsRefresh } from "./scorecards-controls";

/**
 * AG-1.9 · Reports › Producer scorecards, round 7 (owner pick 2026-11-11: "5 · recommended", docs/la4/mockups-r7/reports.html
 * #s5). Who is profitable, not just busy. Server-drawn from scorecardStore (LA-4.18 placement and persistency, LA-7 cost
 * per issued / persisting, the ledger's advance at risk), scoped by AG-0.4 there: a producer sees his own row, a manager
 * his reports', owner / admin / bookkeeper everyone's.
 *
 *   Chart view (5·A): the four cards, each with its series; "Issued and placed, by producer" (placed solid inside) and
 *     "Charged back and at risk, by producer", in the same order (issued, most first); a third list, lead cost per issued
 *     against per persisting policy, once lead spend is recorded. Each row opens the producer's page; each key row the
 *     table filtered to it.
 *   Table view (5·1): six columns, one line a row, the advance at risk said in the one chip; a row opens the producer.
 *   A producer (5·4, ScorecardRecord): /app/producer-scorecards/[producerUserId], and "My scorecard" for a producer.
 */

type Period = { from: string; to: string };
const LINK = "whitespace-nowrap text-sm text-foreground underline-offset-2 hover:underline";
const count = (n: number) => n.toLocaleString("en-US");
const rangeText = (p: Period) => `${dayMonth(p.from)} – ${dayMonth(p.to)} ${p.to.slice(0, 4)}`;
const baseHref = (p: Period) => `${SCORECARDS_HREF}?from=${p.from}&to=${p.to}`;

function ChartCard({ title, period, link, legend, children }: { title: string; period?: string; link?: { label: string; href: string }; legend?: ReactNode; children: ReactNode }) {
  return (
    <Card className="px-4">
      <ChartHeading title={title} period={period} action={link ? <Link href={link.href} className={LINK}>{link.label} ›</Link> : undefined} />
      {children}
      {legend}
    </Card>
  );
}

/** The period over a chart view: the shared picker, the dates it covers, Refresh. */
function PeriodLine({ period }: { period: Period }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ScorecardsPeriod value={period} />
      <span className="text-xs text-muted-foreground tabular-nums">{rangeText(period)}</span>
      <span className="ml-auto"><ScorecardsRefresh /></span>
    </div>
  );
}

const CSV_HEADER = ["Producer", "Submitted", "Issued", "Placed", "Placement", "Month 4", "Month 13", "Chargebacks", "Advance at risk", "Lead cost per issued", "Lead cost per persisting"];
const csvRows = (rows: readonly ScoreRow[]) => rows.map((r) => [r.name, r.submitted, r.issued, r.placed, r.placement, r.m4.text, r.m13.text, dollars(r.chargebackCents), dollars(r.advanceAtRiskCents), perPolicyText(r.costPerIssued), r.costPerPersisting.kind === "building" ? (r.costPerPersisting.readyOn ? `Ready ${monthYear(r.costPerPersisting.readyOn)}` : "Building") : persistingText(r.costPerPersisting)]);

function NoCarrierFiles({ scoped }: { scoped: boolean }) {
  return (
    <EmptyState
      title="No carrier files yet"
      hint="Scorecards are built from your carriers' policy files. Bring one in under Book of business › Carrier files."
      action={scoped ? undefined : <Link href="/app/carrier-files" className={buttonVariants({ variant: "outline" })}>Open Carrier files</Link>}
    />
  );
}

/** The team view: owner, admin, bookkeeper, a manager over his reports. */
export function ScorecardsBoard({ available, rows, minSample, series, period, show, filter }: {
  available: boolean;
  rows: ScoreRow[];
  minSample: number;
  series?: ScoreSeries;
  period: Period;
  show: ShowMode;
  filter: ScoreFilter | null;
}) {
  const ordered = byIssued(rows);
  const base = baseHref(period);
  const corner = (
    <ReportsSlot slot="corner">
      <ScorecardsCsv name={`producer-scorecards-${period.from}-${period.to}.csv`} header={CSV_HEADER} rows={csvRows(filterRows(ordered, show === "table" ? filter : null))} />
    </ReportsSlot>
  );

  if (!available || ordered.length === 0) {
    const empty = !available ? <NoCarrierFiles scoped={false} /> : <EmptyState title="No producers yet" hint="Each producer's row appears once they are active." />;
    return show === "chart"
      ? <div className="flex flex-col gap-4"><PeriodLine period={period} /><Card className="px-4">{empty}</Card></div>
      : <TableCard toolbar={<DataToolbar actions={<ScorecardsRefresh />}><ScorecardsPeriod value={period} /></DataToolbar>}>{empty}</TableCard>;
  }

  const team = teamFigures(ordered, minSample);
  return (
    <>
      {corner}
      {show === "chart"
        ? <ScorecardsCharts rows={ordered} team={team} series={series} period={period} base={base} />
        : <ScorecardsTable rows={ordered} filter={filter} period={period} />}
    </>
  );
}

function ScorecardsCharts({ rows, team, series, period, base }: { rows: ScoreRow[]; team: TeamFigures; series?: ScoreSeries; period: Period; base: string }) {
  const table = (extra?: Record<string, string>) => showHref(base, "table", extra);
  const backOrRisk = rows.filter((r) => r.chargebackCents > 0 || r.advanceAtRiskCents > 0).length;
  const charged = rows.filter((r) => r.chargebackCents > 0).length;
  const atRisk = rows.filter((r) => r.advanceAtRiskCents > 0).length;

  const issuedRows: BarListRow[] = rows.map((r) => ({
    key: r.producerUserId,
    label: r.name,
    value: r.issued,
    inner: r.placed,
    figure: `${count(r.issued)} issued`,
    caption: r.issued ? `${count(r.placed)} placed · ${r.placement}` : undefined,
    href: recordHref(r.producerUserId, period),
  }));
  const backRows: BarListRow[] = rows.map((r) => ({
    key: r.producerUserId,
    label: r.name,
    value: r.chargebackCents + r.advanceAtRiskCents,
    segments: [
      { key: "back", label: "Charged back", value: r.chargebackCents, tone: "cat3" },
      { key: "risk", label: "Advance at risk", value: r.advanceAtRiskCents, tone: "warning" },
    ],
    figure: dollars(r.chargebackCents + r.advanceAtRiskCents),
    caption: r.chargebackCents && r.advanceAtRiskCents ? `${dollars(r.chargebackCents)} back · ${dollars(r.advanceAtRiskCents)} at risk` : r.chargebackCents ? "charged back" : r.advanceAtRiskCents ? "at risk" : undefined,
    href: recordHref(r.producerUserId, period),
  }));
  // 5·A note: "when lead spend is recorded a third chart joins them" — cost per persisting policy, cost per issued solid inside.
  const costRows: BarListRow[] = team.leadSpendCents > 0
    ? rows.filter((r) => r.costPerIssued.kind === "rate").map((r) => {
      const issued = r.costPerIssued.kind === "rate" ? r.costPerIssued.cents : 0;
      const lasting = r.costPerPersisting.kind === "figure" && r.costPerPersisting.perPolicy.kind === "rate" ? r.costPerPersisting.perPolicy.cents : null;
      return {
        key: r.producerUserId,
        label: r.name,
        value: lasting ?? issued,
        inner: issued,
        figure: lasting === null ? `${dollars(issued)} per issued` : `${dollars(lasting)} per persisting`,
        caption: lasting === null ? (r.costPerPersisting.kind === "building" ? `persisting ready ${monthYear(r.costPerPersisting.readyOn)}` : undefined) : `${dollars(issued)} per issued`,
        href: recordHref(r.producerUserId, period),
      };
    })
    : [];

  return (
    <div className="flex flex-col gap-4">
      <PeriodLine period={period} />
      <StatStrip label="Producer scorecards">
        <StatTile label="Submitted" value={count(team.submitted)} href={table()} labelTitle="Applications submitted through Insurvas in the period, by the producer who opened the case. Weekly under the figure."
          trend={series ? { points: series.submitted, tone: "primary", placement: "under" } : undefined} />
        <StatTile label="Issued" value={count(team.issued)} href={table()} labelTitle="Policies issued in the period, from the carriers' files. Weekly under the figure."
          trend={series ? { points: series.issued, tone: "primary", placement: "under" } : undefined} />
        <StatTile label="Chargebacks" value={dollars(team.chargebackCents)} href={table({ has: "chargebacks" })} labelTitle="Charged back on these producers' policies, from the commission ledger. Under the figure: by the policy's issue month, the last twelve months."
          trend={series ? { points: series.chargebackCents, tone: "primary", placement: "under" } : undefined}
          footnote={charged ? <StatusChip tone="warning">{charged} of {rows.length} producers</StatusChip> : undefined} />
        <StatTile label="Advance at risk" value={dollars(team.advanceAtRiskCents)} href={table({ has: "at_risk" })} labelTitle="Advances still inside the carrier's clawback window and not yet earned. Under the figure: by the policy's issue month, the last twelve months."
          trend={series ? { points: series.atRiskCents, tone: "primary", placement: "under" } : undefined}
          footnote={atRisk ? <StatusChip tone="warning">{atRisk} of {rows.length} producers</StatusChip> : undefined} />
      </StatStrip>

      <ChartCard
        title="Issued and placed, by producer"
        period={`${count(team.issued)} issued · solid is placed (paid at least once)`}
        link={{ label: "Open as a table", href: table() }}
        legend={<ChartLegend items={[
          { key: "issued", label: "Issued", tone: "faint", figure: count(team.issued), href: table() },
          { key: "placed", label: "Placed", tone: "strong", figure: count(team.placed), detail: percent(team.placed, team.issued), href: table() },
        ]} />}
      >
        <BarList rows={issuedRows} summary="Policies issued and placed, by producer, most issued first" unit="policies" total={{ label: "Team", figure: `${count(team.issued)} issued`, caption: `${count(team.placed)} placed`, href: table() }} />
      </ChartCard>

      <ChartCard
        title="Charged back and at risk, by producer"
        period={`${dollars(team.chargebackCents)} back · ${dollars(team.advanceAtRiskCents)} more at risk${backOrRisk ? "" : " · nothing has come back"}`}
        link={{ label: "Open as a table", href: table() }}
        legend={<ChartLegend items={[
          { key: "back", label: "Charged back", tone: "cat3", figure: dollars(team.chargebackCents), href: table({ has: "chargebacks" }) },
          { key: "risk", label: "Advance at risk", tone: "warning", figure: dollars(team.advanceAtRiskCents), href: table({ has: "at_risk" }) },
        ]} />}
      >
        <BarList rows={backRows} summary="Charged back and advance at risk, by producer, in the issued order" format={dollars} />
      </ChartCard>

      {costRows.length > 0 && (
        <ChartCard
          title="Lead cost per persisting policy, by producer"
          period={`solid is the cost per issued policy · the gap is the chargeback tax · team ${perPolicyText(team.costPerIssued)} per issued`}
          link={{ label: "Open as a table", href: table() }}
          legend={<ChartLegend items={[
            { key: "persisting", label: "Per persisting policy (month 4)", tone: "faint", href: table() },
            { key: "issued", label: "Per issued policy", tone: "strong", figure: perPolicyText(team.costPerIssued), href: table() },
          ]} />}
        >
          <BarList rows={costRows} summary="Lead cost per persisting and per issued policy, by producer" format={dollars} />
        </ChartCard>
      )}
    </div>
  );
}

function ScorecardsTable({ rows, filter, period }: { rows: ScoreRow[]; filter: ScoreFilter | null; period: Period }) {
  const shown = filterRows(rows, filter);
  return (
    <PagedTableCard
      total={shown.length}
      noun="producers"
      toolbar={<DataToolbar actions={<ScorecardsRefresh />}><ScorecardsPeriod value={period} /><span className="text-xs text-muted-foreground tabular-nums">{rangeText(period)}</span></DataToolbar>}
      filters={<ScorecardsFilter value={filter ? SCORE_FILTERS[filter] : null} />}
      footer={<span className="text-xs text-muted-foreground">{shown.length} {shown.length === 1 ? "producer" : "producers"} · sorted by issued · submitted, month 13 and lead cost per issued and per persisting policy are on the producer&rsquo;s page · a row opens it</span>}
    >
      {shown.length === 0 ? (
        <EmptyState title="No producer matches" hint="Nobody in this period has what the filter asks for. Clear it to see every producer." />
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr>
              <th>Producer</th>
              <th className="text-right">Issued</th>
              <th className="text-right" title="Issued policies paid at least once; a count under the sample size">Placement</th>
              <th className="text-right" title="Still paying at month 4">Month 4</th>
              <th className="text-right">Chargebacks</th>
              <th>Status</th>
            </tr>
          </thead>
          <PagedBody>
            {shown.map((r) => {
              const href = recordHref(r.producerUserId, period);
              const chip = scoreChip(r);
              return (
                <LinkRow key={r.producerUserId} href={href}>
                  <td className="whitespace-nowrap font-medium text-foreground"><Link href={href} className="hover:underline">{r.name}</Link></td>
                  <td className="whitespace-nowrap text-right tabular-nums">{count(r.issued)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{r.issued ? r.placement : <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap text-right tabular-nums" title={r.m4.building && r.m4.readyOn ? `Ready ${monthYear(r.m4.readyOn)}` : undefined}>{r.m4.building || r.m4.text === "—" ? <span className="text-muted-foreground">—</span> : r.m4.text}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{dollars(r.chargebackCents)}</td>
                  <td><StatusChip tone={chip.tone}>{chip.text}</StatusChip></td>
                </LinkRow>
              );
            })}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

// ─── a producer (5·4) ─────────────────────────────────────────────────────────────────────────

type Neighbour = { href: string; label: string } | null;

/**
 * One producer's scorecard: /app/producer-scorecards/[producerUserId], and "My scorecard" (the same page for a
 * producer who is not a manager: no ‹ ›, no team column). The columns that left the table (submitted, month 13, the
 * two lead costs) are explained here, set against the team (the producers this viewer sees, rates weighted by
 * eligible policies). Scorecard · Policies on the title line; Policies opens Book of business at his policies.
 */
export function ScorecardRecord({ row, team, period, show, previous, next, mine }: {
  row: ScoreRow;
  /** The team's figures, or null on "My scorecard" (a producer sees nobody else's figures, summed or not). */
  team: TeamFigures | null;
  period: Period;
  show: ShowMode;
  previous?: Neighbour;
  next?: Neighbour;
  mine: boolean;
}) {
  const self = mine ? SCORECARDS_HREF + `?from=${period.from}&to=${period.to}` : recordHref(row.producerUserId, period);
  const policies = `/app/policies?agent=${encodeURIComponent(row.producerUserId)}`;
  const figures = recordFigures(row, team);
  const neverPaid = Math.max(0, row.issued - row.placed);

  return (
    <>
      <ReportsSlot slot="lead">
        <ViewTabs label={`${row.name}'s scorecard`} value="scorecard" tabs={[
          { key: "scorecard", label: "Scorecard", href: self },
          { key: "policies", label: "Policies", count: row.issued, href: policies },
        ]} />
      </ReportsSlot>
      <ReportsSlot slot="corner">
        {!mine && <RecordStepper previous={previous} next={next} noun="producer" />}
        <ScorecardsCsv
          name={`scorecard-${row.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${period.from}-${period.to}.csv`}
          header={team ? ["Figure", row.name, "Team", "Status"] : ["Figure", row.name, "Status"]}
          rows={figures.map((f) => (team ? [f.label, f.mine, f.team, f.status?.text ?? ""] : [f.label, f.mine, f.status?.text ?? ""]))}
        />
      </ReportsSlot>
      <div className="flex flex-col gap-4">
        <PeriodLine period={period} />
        {show === "chart" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Issued, placed and never paid" period={row.issued ? `${row.placement} placed · ${count(row.placed)} of ${count(row.issued)}` : "Nothing issued in this period"} link={{ label: "Open the policies", href: policies }}>
              {row.issued > 0
                ? <ShareBar summary={`${row.name}: issued policies, placed and never paid`} unit="policies" segments={[
                  { key: "placed", label: "Placed", value: row.placed, tone: "strong", href: policies },
                  { key: "never", label: "Issued, never paid", value: neverPaid, tone: "warning", href: policies },
                ]} />
                : <p className="m-0 text-sm text-muted-foreground">No policy in the carriers&rsquo; files was issued to {mine ? "you" : row.name} between {dayMonth(period.from)} and {dayMonth(period.to)}.</p>}
            </ChartCard>
            <ChartCard title="What comes back" period={`${dollars(row.chargebackCents + row.advanceAtRiskCents)} back or at risk`} link={{ label: "Open as a table", href: showHref(self, "table") }}>
              <BarList format={dollars} summary={`${row.name}: charged back and advance at risk`} max={Math.max(1, row.chargebackCents, row.advanceAtRiskCents)} rows={[
                { key: "back", label: "Charged back", value: row.chargebackCents, tone: "cat3", href: showHref(self, "table") },
                { key: "risk", label: "Advance at risk", value: row.advanceAtRiskCents, tone: "warning", href: showHref(self, "table") },
              ]} />
            </ChartCard>
          </div>
        )}
        <TableCard footer={<span className="text-xs text-muted-foreground">{team ? "Team is the producers you see; its rates are weighted by eligible policies, not a mean of producers" : "Your figures for the period; persistency counts every policy of yours old enough to be measured"}</span>}>
          <table className="portal-lead-table w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr>
                <th>Figure</th>
                <th className="text-right">{mine ? "You" : row.name}</th>
                {team && <th className="text-right">Team</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {figures.map((f) => (
                <tr key={f.key} title={f.title}>
                  <td className="whitespace-nowrap font-medium text-foreground">{f.label}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{f.mine === "—" ? <span className="text-muted-foreground">—</span> : f.mine}</td>
                  {team && <td className="whitespace-nowrap text-right tabular-nums">{f.team === "—" ? <span className="text-muted-foreground">—</span> : f.team}</td>}
                  <td>{f.status ? <StatusChip tone={f.status.tone}>{f.status.text}</StatusChip> : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </div>
    </>
  );
}

type Figure = { key: string; label: string; mine: string; team: string; status: { text: string; tone: "warning" | "neutral" | "good" } | null; title?: string };

/** The record's rows: what left the team table, beside the team's figure. */
function recordFigures(row: ScoreRow, team: TeamFigures | null): Figure[] {
  // The team's rates read as percents (shareOrCount with a sample of 1): the small-sample rule is per producer, on the row's text.
  const ready = (day: string | null | undefined) => ({ text: day ? `Ready ${monthYear(day)}` : "No policy to measure yet", tone: "neutral" as const });
  const noSpend = row.leadSpendCents === 0;
  const teamPersisting = !team ? "—" : team.costPerPersisting.kind === "building" ? "—" : perPolicyText(team.costPerPersisting.perPolicy);
  return [
    {
      key: "submitted", label: "Submitted through Insurvas", mine: count(row.submitted), team: team ? count(team.submitted) : "—", status: null,
      title: "Applications submitted in the period on cases this producer opened; issued policies come from the carriers' files",
    },
    {
      key: "m4", label: "Month 4 persistency", mine: row.m4.building ? "—" : row.m4.text,
      team: !team || team.m4.building ? "—" : shareOrCount(team.m4.alive, team.m4.eligible, 1),
      status: row.m4.building ? ready(row.m4.readyOn) : null,
      title: row.m4.building ? undefined : `${row.m4.alive} of ${row.m4.eligible} still paying at month 4`,
    },
    {
      key: "m13", label: "Month 13 persistency", mine: row.m13.building ? "—" : row.m13.text,
      team: !team || team.m13.building ? "—" : shareOrCount(team.m13.alive, team.m13.eligible, 1),
      status: row.m13.building ? ready(row.m13.readyOn) : null,
      title: row.m13.building ? undefined : `${row.m13.alive} of ${row.m13.eligible} still paying at month 13`,
    },
    {
      key: "cpi", label: "Lead cost per issued policy", mine: noSpend ? "—" : perPolicyText(row.costPerIssued), team: team && team.leadSpendCents ? perPolicyText(team.costPerIssued) : "—",
      status: noSpend ? { text: "No lead spend recorded", tone: "neutral" } : null,
      title: noSpend ? undefined : `${dollars(row.leadSpendCents)} of lead spend on the leads assigned to this producer`,
    },
    {
      key: "cpp", label: "Lead cost per persisting policy", mine: row.costPerPersisting.kind === "building" || noSpend ? "—" : persistingText(row.costPerPersisting),
      team: team && team.leadSpendCents ? teamPersisting : "—",
      status: row.costPerPersisting.kind === "building" ? ready(row.costPerPersisting.readyOn)
        : noSpend ? { text: "No lead spend recorded", tone: "neutral" }
          : row.chargebackTaxCents !== null && row.chargebackTaxCents > 0 ? { text: `${dollars(row.chargebackTaxCents)} chargeback tax`, tone: "warning" } : null,
      title: "Lead spend over the period's policies still paying at month 4; the gap to cost per issued is the chargeback tax",
    },
  ];
}
