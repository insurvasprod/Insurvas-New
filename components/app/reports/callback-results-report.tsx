import type { ReactNode } from "react";
import Link from "next/link";

import { ScorecardsPeriod, ScorecardsRefresh } from "@/components/app/agency/scorecards-controls";
import { ReportsSlot } from "@/components/app/reports/reports-slot";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BarList, BarSeries, ChartHeading, ChartLegend, type BarListRow } from "@/components/ui/chart";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { MIN_DECIDED, hasCallbacks, keepRateText, type CallbackLine, type CallbackResults } from "@/lib/reports/callbackResultsCore";
import { reportPeriod } from "@/lib/reports/periodText";
import type { ShowMode } from "@/lib/reports/show";

/**
 * Reports › Callbacks kept (owner 2026-11-19), drawn on the server: By week, and By person for a team (never for a
 * solo agent, who has no one to compare with), on the title line (`?tab=`); the Table · Chart switch (`?show=`, chart
 * first); the shared period in the toolbar. Every figure opens the Callbacks calendar, the page the callbacks are
 * worked on. One line a row, one text colour, the keep rate the row's one chip.
 */

type Period = { from: string; to: string };
export const CALLBACK_RESULTS_PATH = "/app/callback-results";
export const CALLBACKS_PATH = "/app/callbacks";
export type CallbackTab = "weeks" | "people";

const n = (value: number) => value.toLocaleString("en-US");
const NUM = "whitespace-nowrap text-right tabular-nums";
const FIRST = "whitespace-nowrap font-medium text-foreground";
const LINK = `${buttonVariants({ variant: "outline", size: "sm" })} no-underline`;
const EMPTY = <EmptyState title="No callbacks booked in this period" hint="Callbacks booked from a call or a lead show here by the day they were due." />;

export function callbackResultsHref(tab: CallbackTab, period: Period | null, show?: ShowMode): string {
  const params = new URLSearchParams();
  if (tab !== "weeks") params.set("tab", tab);
  if (period) { params.set("from", period.from); params.set("to", period.to); }
  if (show === "table") params.set("show", "table");
  const query = params.toString();
  return query ? `${CALLBACK_RESULTS_PATH}?${query}` : CALLBACK_RESULTS_PATH;
}

/** The tabs: By person only for a team. */
export function CallbackTabs({ tab, period, show, team }: { tab: CallbackTab; period: Period; show: ShowMode; team: boolean }) {
  if (!team) return null;
  return (
    <ReportsSlot slot="lead">
      <ViewTabs
        label="Callbacks kept views"
        value={tab}
        tabs={[
          { key: "weeks" as const, label: "By Week", href: callbackResultsHref("weeks", period, show) },
          { key: "people" as const, label: "By Person", href: callbackResultsHref("people", period, show) },
        ]}
      />
    </ReportsSlot>
  );
}

const spark = (points: number[]) => (points.length > 1 ? { points, tone: "primary" as const, placement: "under" as const } : undefined);

export function CallbackStrip({ results }: { results: CallbackResults }) {
  const t = results.total;
  const weeks = results.weeks;
  return (
    <StatStrip label="Callbacks in this period">
      <StatTile label="Booked" href={CALLBACKS_PATH} value={n(t.booked)} footnote={`${n(t.cancelled)} cancelled`} trend={spark(weeks.map((w) => w.booked))} />
      <StatTile label="Kept" href={CALLBACKS_PATH} value={n(t.kept)} footnote={`${keepRateText(t)} · ${n(t.keptOnCall)} on a call`} trend={spark(weeks.map((w) => w.kept))} />
      <StatTile label="Missed" href={CALLBACKS_PATH} value={n(t.missed)} footnote={`${n(t.keptLate)} kept after a miss`} trend={spark(weeks.map((w) => w.missed))} />
      <StatTile label="Still open" href={CALLBACKS_PATH} value={n(t.open)} footnote="Booked, not yet kept or missed" />
    </StatStrip>
  );
}

function Toolbar({ period }: { period: Period }) {
  return (
    <DataToolbar actions={<ScorecardsRefresh />}>
      <ScorecardsPeriod value={period} />
      <span className="text-xs text-muted-foreground tabular-nums">{reportPeriod(period.from, period.to)}</span>
    </DataToolbar>
  );
}

export function CallbackBody({ results, tab, show, period, tableHref }: { results: CallbackResults; tab: CallbackTab; show: ShowMode; period: Period; tableHref: string }) {
  if (show === "table") return <CallbackTable lines={tab === "people" ? results.people : results.weeks.filter(hasCallbacks)} total={results.total} tab={tab} period={period} />;
  return tab === "people" ? <PeopleChart results={results} period={period} tableHref={tableHref} /> : <WeeksChart results={results} period={period} tableHref={tableHref} />;
}

function WeeksChart({ results, period, tableHref }: { results: CallbackResults; period: Period; tableHref: string }) {
  const t = results.total;
  return (
    <Card className="px-4">
      <Toolbar period={period} />
      <ChartHeading title="Callbacks by week" period={`${reportPeriod(period.from, period.to)} · ${n(t.booked)} booked · ${keepRateText(t)}`} action={<Link href={tableHref} className={LINK}>Open the rows</Link>} />
      {hasCallbacks(t) ? (
        <BarSeries
          bars={results.weeks.map((w) => ({ key: w.key, label: w.label, value: w.booked, accent: w.kept }))}
          summary="Callbacks booked each week, with the kept ones solid inside each bar"
          unit="callbacks"
          hrefFor={() => tableHref}
          names={{ value: "Booked", accent: "Kept" }}
          legend={[{ key: "booked", label: "Booked", tone: "faint", figure: n(t.booked) }, { key: "kept", label: "Kept", tone: "strong", figure: n(t.kept) }]}
        />
      ) : EMPTY}
    </Card>
  );
}

function PeopleChart({ results, period, tableHref }: { results: CallbackResults; period: Period; tableHref: string }) {
  const rows: BarListRow[] = results.people.map((line) => ({
    key: line.key,
    label: line.label,
    value: line.booked,
    inner: line.kept,
    figure: `${n(line.booked)} booked`,
    caption: `${n(line.missed)} missed · ${keepRateText(line)}`,
    href: tableHref,
  }));
  return (
    <Card className="px-4">
      <Toolbar period={period} />
      <ChartHeading title="Callbacks by person" period={reportPeriod(period.from, period.to)} action={<Link href={tableHref} className={LINK}>Open the rows</Link>} />
      {rows.length ? (
        <>
          <BarList rows={rows} summary="Callbacks booked by person, with the kept ones inside each bar" unit="callbacks" />
          <ChartLegend items={[{ key: "booked", label: "Booked", tone: "faint" }, { key: "kept", label: "Kept", tone: "strong" }]} />
        </>
      ) : EMPTY}
    </Card>
  );
}

function CallbackTable({ lines, total, tab, period }: { lines: CallbackLine[]; total: CallbackLine; tab: CallbackTab; period: Period }) {
  const row = (line: CallbackLine, first: ReactNode, strong = false) => (
    <tr key={line.key} data-total={strong || undefined}>
      <td className={FIRST}>{first}</td>
      <td className={NUM}>{n(line.booked)}</td>
      <td className={NUM}>{n(line.kept)}</td>
      <td className={NUM}>{n(line.keptOnCall)}</td>
      <td className={NUM}>{n(line.missed)}</td>
      <td className={NUM}>{n(line.cancelled)}</td>
      <td className={NUM}>{n(line.open)}</td>
      <td className="whitespace-nowrap">{line.kept + line.missed ? <StatusChip>{keepRateText(line)}</StatusChip> : <span className="text-muted-foreground">—</span>}</td>
    </tr>
  );
  const label = (line: CallbackLine) => (tab === "weeks" && line.from && line.to ? `${reportPeriod(line.from, line.to)}` : line.label);
  return (
    <TableCard toolbar={<Toolbar period={period} />} footer={<span>By the day each callback was due, in your workspace&apos;s time zone · kept of kept and missed; under {MIN_DECIDED} decided the counts show</span>}>
      {lines.length ? (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>{tab === "weeks" ? "Week" : "Person"}</th>
              <th className="text-right">Booked</th>
              <th className="text-right">Kept</th>
              <th className="text-right">On a call</th>
              <th className="text-right">Missed</th>
              <th className="text-right">Cancelled</th>
              <th className="text-right">Still open</th>
              <th>Keep rate</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => row(line, <Link href={CALLBACKS_PATH} className="underline-offset-2 hover:underline">{label(line)}</Link>))}
            {lines.length > 1 && row(total, tab === "weeks" ? "All weeks" : "Everyone", true)}
          </tbody>
        </table>
      ) : EMPTY}
    </TableCard>
  );
}

export function CallbacksUnavailable({ period, title, hint }: { period: Period; title: string; hint: string }) {
  return <TableCard toolbar={<Toolbar period={period} />}><EmptyState title={title} hint={hint} /></TableCard>;
}
