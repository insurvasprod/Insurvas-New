"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, PenLine, ShieldAlert, Wallet } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/view-tabs";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { BarSeries, ShareBar } from "@/components/ui/chart";
import { HomePanel } from "@/components/app/home/home-panel";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { dollars } from "@/lib/agency/constants";
import { BasisChip, Money } from "./money";
import { useAgencyData } from "./use-agency-data";
import { moneySplit, periodChange, standing, type AgencyDashboardView, type AgencyProducerRow } from "@/lib/agency/dashboardCore";

/**
 * The shape lives in `lib/agency/dashboardCore.ts` so the sample data behind `/design/agency` has
 * something to be typed against. The store's richer `AgencyDashboard` is assignable to it.
 */
type Row = AgencyProducerRow;
type Dashboard = AgencyDashboardView;

/** Sample data in place of the API, for `/design/agency` (development only). */
export type AgencyPreview = { data: Dashboard | null; error?: string; previous?: Dashboard | null };

function monthRange(offset: number) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

/**
 * AG-0.11 · the agency owner's home: which of my producers is actually making me money? One strip (seats, payable
 * out, the owner's override, licence alerts), one producer table carrying panels 1–3, and the health table (panel 4).
 * Under the sample a count ("6/9"), never a percentage. Every money figure says its basis.
 */
export function AgencyDashboard({ agencyName, scoped, preview }: { agencyName: string; scoped: boolean; preview?: AgencyPreview }) {
  const [which, setWhich] = useState<"this" | "last">("this");
  const range = useMemo(() => monthRange(which === "this" ? 0 : -1), [which]);
  const live = useAgencyData<Dashboard>(preview ? null : `/api/app/agency/dashboard?from=${range.from}&to=${range.to}`);
  const { data, error, loading, refreshing, reload } = preview
    ? { data: preview.data, error: preview.error ?? "", loading: false, refreshing: false, reload: () => {} }
    : live;
  // The comparison is a second read of the same endpoint for the month before. It starts as null
  // — `useAgencyData` skips a null url — and is given its url once the current period has
  // painted, so the strip is never waiting on it. A failed comparison is silent: no pills, no
  // banner, the page still works.
  const previousRange = useMemo(() => monthRange(which === "this" ? -1 : -2), [which]);
  const [wantPrevious, setWantPrevious] = useState(false);
  useEffect(() => {
    if (preview) return;
    const after = window.setTimeout(() => setWantPrevious(true), 0);
    return () => { window.clearTimeout(after); setWantPrevious(false); };
  }, [preview, previousRange.from]);
  const previous = useAgencyData<Dashboard>(
    preview || !wantPrevious ? null : `/api/app/agency/dashboard?from=${previousRange.from}&to=${previousRange.to}`,
  );
  const before = preview ? preview.previous ?? null : previous.data;

  const [producerPage, setProducerPage] = useState(1);
  const [alertPage, setAlertPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  // The page's question, answered by the first column: ranked by what was issued, which is the
  // production the agency is paid on. Ties share a rank and the order is stable (dashboardCore).
  const ranked = standing(data?.producers ?? [], (row) => row.issued);
  const rankOf = new Map(ranked.map((row) => [row.id, row.rank]));
  const ordered = ranked
    .map((row) => (data?.producers ?? []).find((p) => p.producerUserId === row.id))
    .filter((row): row is Row => Boolean(row));
  const producers = paginate(ordered, producerPage, pageSize);
  const alerts = paginate(data?.alerts ?? [], alertPage, pageSize);
  const mostAtRisk = data?.producers.reduce<Row | null>((top, r) => (r.advanceAtRiskCents > (top?.advanceAtRiskCents ?? 0) ? r : top), null) ?? null;

  /** The period's totals, from the rows the page already has — no second query for any of these. */
  const totals = (rows: Row[] | undefined) => ({
    issued: (rows ?? []).reduce((sum, r) => sum + r.issued, 0),
    submitted: (rows ?? []).reduce((sum, r) => sum + r.submitted, 0),
    advance: (rows ?? []).reduce((sum, r) => sum + r.advanceAtRiskCents, 0),
    chargeback: (rows ?? []).reduce((sum, r) => sum + r.chargebackCents, 0),
    spend: (rows ?? []).reduce((sum, r) => sum + r.leadSpendCents, 0),
  });
  const written = totals(data?.producers);
  const wasWritten = before ? totals(before.producers) : null;
  const atRisk = { total: written.advance + written.chargeback, chargeback: written.chargeback };
  const writtenChange = periodChange(written.issued, wasWritten?.issued);
  const overrideChange = periodChange(data?.overrideCents ?? null, before?.overrideCents);
  const standingBars = ranked
    .filter((row) => row.value > 0)
    .slice(0, 12)
    .map((row) => ({ key: row.id, label: row.name.split(" ")[0], value: row.value }));
  const split = moneySplit({ overrideCents: data?.overrideCents ?? null, payableOutCents: data?.payableOutCents ?? null, leadSpendCents: written.spend })
    ?.map((part, index) => ({ key: part.label, label: part.label, value: part.value, tone: (["strong", "mid", "faint"] as const)[index] }));
  const atRiskChange = periodChange(atRisk.total, wasWritten ? wasWritten.advance + wasWritten.chargeback : undefined);
  /**
   * A brand-new agency, not a quiet month. The difference matters: an agency with producers who
   * wrote nothing in November wants its charts, because "nobody wrote anything" is the finding.
   * An agency with no producers at all wants to be told what this page will become.
   */
  const isNew = (data?.producers.length ?? 0) === 0;

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      {/* The title names the page, as every other page's does (§2). The agency's own name is said
          once, on the quiet line under it, where it is context rather than the heading — the trail
          and the top bar were already naming it twice over. */}
      <PageHeader
        title="Agency dashboard"
        description={scoped ? "Your reports: what they wrote, what it is worth, and what is at risk." : "Which of your producers is actually making the agency money."}
        meta={<p className="mt-1 text-sm leading-normal text-muted-foreground">{agencyName} · {range.label}</p>}
        actions={<>
          <Segmented label="Period" value={which} onChange={setWhich} options={[{ key: "this", label: "This month" }, { key: "last", label: "Last month" }]} />
          {!scoped && <Button asChild><Link href="/app/producers?invite=1">Invite producer</Link></Button>}
        </>}
      />
      {data && isNew && (
        // One line, not a card (§3): a new agency's page should read as new rather than broken,
        // and the strip's honest zeros underneath are the rest of the answer.
        <p role="status" className="m-0 text-sm leading-normal text-muted-foreground">
          {scoped
            ? "Nothing here yet. As the producers who report to you submit, their production, persistency and advance risk appear on this page."
            : "Nothing here yet. Invite a producer and this page fills in from their first application — what they wrote, what it is worth, and what is at risk."}
        </p>
      )}
      {error ? <ErrorState detail={error} action={<Button variant="outline" onClick={reload}>Try again</Button>} /> : loading || !data ? <SectionLoading rows={4} columns={6} label="Loading the dashboard" /> : (
        <>
          {/* Four figures that answer the page's question — am I making money, and from whom —
              each a door into the page that owns its depth. Seats came off on 2 Nov: it is an
              administrative fact that changes twice a year and it was taking a quarter of the
              headline space; it is on the quiet line under the title now.

              Every figure is the same ink (owner, 2 Nov). Two amber figures in one row was both
              against §4a ("one per row at most") and a scale with no zero: once two of four are
              coloured, the colour stops meaning "look here". What the figure is doing is carried
              by its change pill, its minus sign and the fact beneath it. */}
          <StatRow label="Agency at a glance">
            <StatCard
              icon={PenLine}
              label="Written"
              period={range.label}
              value={written.issued}
              delta={writtenChange === null ? undefined : { value: writtenChange, goodWhen: "up" }}
              fact={{ label: "Submitted", value: written.submitted.toLocaleString("en-US") }}
            />
            {!scoped && <StatCard
              icon={Wallet}
              label="Your override"
              labelTitle="What carriers paid the agency on producers' business this period, less the producers' reported share."
              period={range.label}
              value={data.overrideCents === null ? "—" : dollars(data.overrideCents)}
              delta={overrideChange === null ? undefined : { value: overrideChange, goodWhen: "up" }}
              fact={{ label: "Reported basis" }}
              action={<Link href="/app/hierarchy" className="hover:underline">Overrides</Link>}
            />}
            <StatCard
              icon={ShieldAlert}
              label="At risk"
              labelTitle="Unearned advance that could come back, plus what has already been clawed back this period."
              period={range.label}
              value={dollars(atRisk.total)}
              delta={atRiskChange === null ? undefined : { value: atRiskChange, goodWhen: "down" }}
              fact={{ label: "Clawed back", value: dollars(atRisk.chargeback) }}
              action={<Link href="/app/lapse-risk" className="hover:underline">Lapse risk</Link>}
            />
            <StatCard
              icon={AlertTriangle}
              label="Needs you"
              period="next 60 days"
              value={data.alerts.length}
              fact={{ label: data.alerts.length ? "Licences and appointments expiring" : "Nothing expiring" }}
            />
          </StatRow>

          {/* One 12-column row: the standing beside where the money went. Container queries, not
              viewport breakpoints — the sidebar takes its share of the width (§4b). */}
          {!isNew && <div className="@container">
            <div className="grid gap-4 @4xl:grid-cols-12">
              <HomePanel title="Who wrote it" period={range.label} className="@4xl:col-span-8" link={{ label: "Scorecards", href: "/app/producer-scorecards" }}>
                {standingBars.length ? (
                  <BarSeries
                    bars={standingBars}
                    summary={`Policies issued per producer in ${range.label}: ${standingBars.map((bar) => `${bar.label} ${bar.value}`).join(", ")}`}
                    unit="issued"
                    barMaxWidth={56}
                    labels="all"
                    minHeight={148}
                  />
                ) : (
                  <p className="m-0 py-6 text-center text-sm text-muted-foreground">Nothing issued in {range.label}.</p>
                )}
              </HomePanel>
              <HomePanel title="Where the money went" period={range.label} className="@4xl:col-span-4" link={{ label: "Ledger", href: "/app/ledger" }}>
                {split ? (
                  <ShareBar
                    segments={split}
                    summary={`${range.label}: ${split.map((part) => `${part.label} ${dollars(part.value)}`).join(", ")}`}
                    format={dollars}
                  />
                ) : (
                  <p className="m-0 py-6 text-center text-sm text-muted-foreground">No money moved in {range.label}.</p>
                )}
                {/* The old Payable out card said this; the figure now lives in the bar, so the
                    sentence has to move with it rather than be dropped. */}
                {!data.ledgerReady && (
                  <p className="m-0 mt-2 text-xs text-muted-foreground">What you owe producers appears here once the payable ledger is live.</p>
                )}
              </HomePanel>
            </div>
          </div>}

          {/* Refresh sits on the card's own action slot. It had a whole `DataToolbar` to itself,
              which drew a 56px band of nothing across the card with one button floating in it —
              a toolbar with no search and no filters is not a toolbar. */}
          <TableCard
            title="Producers"
            info="Every producer who can submit, and what they wrote this period. Placement and month-4 survival show a count until there are enough policies for a percentage."
            action={<RefreshButton onClick={reload} refreshing={refreshing} />}
            footer={data.producers.length ? <Pager page={producers.current} total={data.producers.length} noun="producers" pageSize={pageSize} onPage={setProducerPage} /> : undefined}
          >
            {/* The empty state carries no action: the header already has Invite producer, and
                the same green button twice on one short page reads as two different offers. */}
            {data.producers.length === 0 ? (
              <EmptyState
                title={scoped ? "No reports yet" : "No producers yet"}
                hint={scoped ? "Producers assigned to you appear here, with what they wrote." : "Their production shows here from their first submission."}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-right">#</TableHead>
                    <TableHead>Producer</TableHead>
                    <TableHead className="text-right">Submitted</TableHead>
                    <TableHead className="text-right">Issued</TableHead>
                    <TableHead className="text-right">Placement <InfoTip label="About placement and month-4 survival">Placement and month-4 survival show counts until there are enough policies for a percentage.</InfoTip></TableHead>
                    <TableHead className="text-right">Month-4 alive</TableHead>
                    <TableHead className="text-right">Month-13 alive</TableHead>
                    <TableHead className="text-right">Advance at risk</TableHead>
                    <TableHead className="text-right">Balance <BasisChip basis="reported" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {producers.rows.map((r) => (
                    <TableRow key={r.producerUserId}>
                      {/* Quiet and tabular, not a medal: the rank orders the eye, it does not
                          decorate the row. */}
                      <TableCell className="text-right tabular-nums text-muted-foreground">{rankOf.get(r.producerUserId)}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.submitted}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.issued}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.placement}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.m4.text}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.m13.text}</TableCell>
                      {/* The worst advance risk is marked on the figure, not by washing the whole
                          row in --warning-surface: a filled row reads as an error state, and this
                          is a thing to watch, not a thing that is wrong. */}
                      <TableCell className="text-right">
                        <Money
                          cents={r.advanceAtRiskCents}
                          className={mostAtRisk?.producerUserId === r.producerUserId && r.advanceAtRiskCents > 0 ? "font-semibold text-[var(--warning-ink)]" : undefined}
                        />
                      </TableCell>
                      <TableCell className="text-right">{data.ledgerReady ? <Money cents={r.balanceCents} /> : <span className="text-[var(--muted)]">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCard>

          <TableCard title="Expiring inside 60 days" info="Licences and appointments. An expiry stops that producer from submitting." footer={data.alerts.length ? <Pager page={alerts.current} total={data.alerts.length} noun="expiries" pageSize={pageSize} onPage={setAlertPage} /> : undefined}>
            {data.alerts.length === 0 ? (
              <EmptyState title="Nothing expires in the next 60 days" hint="Licences and appointments appear here two months before they lapse." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Producer</TableHead><TableHead>Item</TableHead><TableHead>Detail</TableHead><TableHead className="text-right">Expires</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.rows.map((a, i) => (
                    <TableRow key={`${a.producerUserId}-${a.item}-${i}`}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{a.item}</TableCell>
                      <TableCell>{a.detail}</TableCell>
                      <TableCell className="text-right"><StatusChip tone={a.daysLeft <= 14 ? "danger" : "warning"}>in {a.daysLeft} day{a.daysLeft === 1 ? "" : "s"}</StatusChip></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCard>
        </>
      )}
    </div>
  );
}
