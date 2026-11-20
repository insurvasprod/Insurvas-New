import type { ReactNode } from "react";
import Link from "next/link";

import { ScorecardsPeriod, ScorecardsRefresh } from "@/components/app/agency/scorecards-controls";
import { ReportsSlot } from "@/components/app/reports/reports-slot";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BarList, ChartHeading, ChartLegend, type BarListRow } from "@/components/ui/chart";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { reportPeriod } from "@/lib/reports/periodText";
import type { ShowMode } from "@/lib/reports/show";
import { trueCpaLeadsHref } from "@/lib/reports/trueCpaLeads";
import type { TrueCpaSeries } from "@/lib/reports/trueCpaView";
import {
  campaignLine, dollars, leadSourcesHref, rateText, sourceLines, speedText, vendorLine,
  type LeadSourcesTab, type SourceLine,
} from "@/lib/reports/leadSourcesView";
import type { VendorScorecardReport } from "@/lib/vendorScorecard/types";

/**
 * Reports › Lead sources (owner 2026-11-19), drawn on the server: Vendors · Campaigns on the title line (`?tab=`), the
 * Table · Chart switch (`?show=`, chart first), the shared period in the toolbar. Every vendor and campaign opens its
 * own page; with True CPA on the plan a figure opens the leads behind it and the money columns show. One line a row,
 * one text colour, the contact rate the row's one chip. No notices: an explainer is the title's (i).
 */

type Period = { from: string; to: string };
const n = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value.toLocaleString("en-US"));
const NUM = "whitespace-nowrap text-right tabular-nums";
const FIRST = "whitespace-nowrap font-medium text-foreground";
const LINK = `${buttonVariants({ variant: "outline", size: "sm" })} no-underline`;
const EMPTY = <EmptyState title="No leads in this period" hint="Leads from your vendors' campaigns show here as they arrive." />;

export function LeadSourcesTabs({ tab, period, show, counts }: { tab: LeadSourcesTab; period: Period; show: ShowMode; counts?: { vendors: number; campaigns: number } }) {
  return (
    <ReportsSlot slot="lead">
      <ViewTabs
        label="Lead sources views"
        value={tab}
        tabs={[
          { key: "vendors" as const, label: "Vendors", count: counts?.vendors ?? null, href: leadSourcesHref("vendors", period, show === "table" ? "table" : undefined) },
          { key: "campaigns" as const, label: "Campaigns", count: counts?.campaigns ?? null, href: leadSourcesHref("campaigns", period, show === "table" ? "table" : undefined) },
        ]}
      />
    </ReportsSlot>
  );
}

const spark = (points: number[] | undefined) => (points && points.length > 1 ? { points, tone: "primary" as const, placement: "under" as const } : undefined);

/** The period's figures, each a link: the leads behind it with True CPA, the rows otherwise. */
export function LeadSourcesStrip({ report, series, money, trueCpa, period, tableHref }: { report: VendorScorecardReport; series: TrueCpaSeries | null; money: boolean; trueCpa: boolean; period: Period; tableHref: string }) {
  const t = report.totals;
  const applied = t.applied_leads ?? t.applications;
  const points = series?.points ?? [];
  const drill = (stage: string, title: string) => (trueCpa ? trueCpaLeadsHref({ key: stage, title, params: { stage } }, { from: period.from, to: period.to }) : tableHref);
  return (
    <StatStrip label="Lead sources in this period">
      <StatTile label="Leads received" href={drill("received", "leads received")} value={n(t.leads_received)} footnote={`${n(t.dialed_leads)} dialed`} trend={spark(points.map((p) => p.leads_received))} />
      <StatTile label="Contacted" href={drill("contacted", "leads contacted")} value={n(t.contacted_leads)} footnote={rateText(t.contacted_leads, t.leads_received, "of leads")} trend={spark(points.map((p) => p.contacted_leads))} />
      <StatTile label="Applied" href={drill("applied", "leads that applied")} value={n(applied)} footnote={rateText(applied, t.contacted_leads, "of contacted")} trend={spark(points.map((p) => p.applied_leads ?? p.applications))} />
      <StatTile label="Issued" href={drill("issued", "issued policies")} value={n(t.issued_policies)} footnote={rateText(t.issued_policies, t.leads_received, "of leads")} trend={spark(points.map((p) => p.issued_policies))} />
      {money && <StatTile label="Net spend" href={`/app/true-cpa?from=${period.from}&to=${period.to}`} value={dollars(t.net_spend_cents)} footnote={`${dollars(t.effective_cost_per_lead_cents)} a lead`} trend={spark(points.map((p) => p.net_spend_cents / 100))} />}
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

function linesOf(report: VendorScorecardReport, tab: LeadSourcesTab): SourceLine[] {
  return tab === "vendors" ? sourceLines(report.vendor_rows, vendorLine) : sourceLines(report.rows, campaignLine);
}

/** The table or the chart for the open tab. */
export function LeadSourcesBody({ report, tab, show, money, period, tableHref }: { report: VendorScorecardReport; tab: LeadSourcesTab; show: ShowMode; money: boolean; period: Period; tableHref: string }) {
  const lines = linesOf(report, tab);
  return show === "chart"
    ? <LeadSourcesChart lines={lines} tab={tab} period={period} tableHref={tableHref} />
    : <LeadSourcesTable lines={lines} tab={tab} money={money} period={period} total={report.totals} />;
}

function LeadSourcesChart({ lines, tab, period, tableHref }: { lines: SourceLine[]; tab: LeadSourcesTab; period: Period; tableHref: string }) {
  const shown = lines.slice(0, 20);
  const rows: BarListRow[] = shown.map((line) => ({
    key: line.key,
    label: line.test ? `${line.label} (test)` : line.label,
    value: line.received,
    inner: line.contacted,
    figure: `${n(line.received)} leads`,
    caption: `${n(line.issued)} issued · ${rateText(line.contacted, line.received, "contacted")}`,
    href: line.href,
  }));
  const more = lines.length - shown.length;
  return (
    <Card className="px-4">
      <Toolbar period={period} />
      <ChartHeading
        title={tab === "vendors" ? "Leads by vendor" : "Leads by campaign"}
        period={`${reportPeriod(period.from, period.to)}${more > 0 ? ` · the first ${shown.length}; ${more} more in the table` : ""}`}
        action={<Link href={tableHref} className={LINK}>Open the rows</Link>}
      />
      {rows.length ? (
        <>
          <BarList rows={rows} summary={`Leads received by ${tab === "vendors" ? "vendor" : "campaign"}, with the contacted leads inside each bar`} unit="leads" />
          <ChartLegend items={[{ key: "received", label: "Leads received", tone: "faint" }, { key: "contacted", label: "Contacted", tone: "strong" }]} />
        </>
      ) : EMPTY}
    </Card>
  );
}

function LeadSourcesTable({ lines, tab, money, period, total }: { lines: SourceLine[]; tab: LeadSourcesTab; money: boolean; period: Period; total: VendorScorecardReport["totals"] }) {
  const vendors = tab === "vendors";
  const row = (line: SourceLine, first: ReactNode, strong = false) => (
    <tr key={line.key} data-total={strong || undefined}>
      <td className={FIRST}>{first}</td>
      {!vendors && <td className="whitespace-nowrap">{line.vendor ?? "—"}</td>}
      <td className={NUM}>{n(line.received)}</td>
      <td className={NUM}>{n(line.dialed)}</td>
      <td className={NUM}>{n(line.contacted)}</td>
      <td className={NUM}>{n(line.applied)}</td>
      <td className={NUM}>{n(line.issued)}</td>
      <td className="whitespace-nowrap">{line.received ? <StatusChip>{rateText(line.contacted, line.received, "contacted")}</StatusChip> : <span className="text-muted-foreground">—</span>}</td>
      {vendors && <td className={NUM}>{speedText(line.speedSeconds)}</td>}
      {vendors && <td className={NUM}>{line.consentPct === null ? "—" : `${Math.round(line.consentPct)}%`}</td>}
      {money && <td className={NUM}>{dollars(line.spendCents)}</td>}
      {money && <td className={NUM}>{dollars(line.costPerLeadCents)}</td>}
    </tr>
  );
  const totalLine: SourceLine = {
    key: "all", label: vendors ? "All vendors" : "All campaigns", vendor: null, href: "", test: false,
    received: total.leads_received, dialed: total.dialed_leads, contacted: total.contacted_leads, applied: total.applied_leads,
    issued: total.issued_policies, spendCents: total.net_spend_cents, costPerLeadCents: total.effective_cost_per_lead_cents, speedSeconds: null, consentPct: null,
  };
  return (
    <TableCard
      toolbar={<Toolbar period={period} />}
      footer={<span>Leads received in the period, followed to the first dial, a contact, an application and an issued policy · a rate waits for 20 leads{vendors ? " · speed and consent are each vendor's over all time" : ""}{money ? " · cost per issued policy is on True CPA" : ""}</span>}
    >
      {lines.length ? (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>{vendors ? "Vendor" : "Campaign"}</th>
              {!vendors && <th>Vendor</th>}
              <th className="text-right">Leads</th>
              <th className="text-right">Dialed</th>
              <th className="text-right">Contacted</th>
              <th className="text-right">Applied</th>
              <th className="text-right">Issued</th>
              <th>Contact rate</th>
              {vendors && <th className="text-right" title="Median time from a posted lead to its first dial">First dial</th>}
              {vendors && <th className="text-right" title="Leads with a consent certificate stored">Consent stored</th>}
              {money && <th className="text-right">Net spend</th>}
              {money && <th className="text-right">Cost a lead</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => row(line, <Link href={line.href} className="underline-offset-2 hover:underline">{line.test ? `${line.label} (test)` : line.label}</Link>))}
            {lines.length > 1 && row(totalLine, totalLine.label, true)}
          </tbody>
        </table>
      ) : EMPTY}
    </TableCard>
  );
}

/** The report could not be read: said in the step, never as zeros. */
export function LeadSourcesUnavailable({ period }: { period: Period }) {
  return <TableCard toolbar={<Toolbar period={period} />}><EmptyState title="Lead sources could not be read" hint="Try again in a moment." /></TableCard>;
}
