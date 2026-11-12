"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { ViewTabs } from "@/components/app/book-of-business-views";
import { InReportsSlot, ReportsSlot } from "@/components/app/reports/reports-slot";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BarList, BarSeries, ChartHeading, DonutChart, LineSeries, type BarListRow, type ChartTone } from "@/components/ui/chart";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, control } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { ActiveFilters, FilterButton, FilterField, FilterPanel, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { QUIET_DAY, type SummaryInput } from "@/lib/ingestion/dailySummary";
import { readableDay, statusLabel, toCsv } from "@/lib/ingestion/policyBook";
import {
  CONTRACT_MONTH, CONTRACT_SHARE_PCT, DIMENSION_LABELS, FILTER_KEYS, centsText, chargebackText, costPerSale, drillParam, issuePeriods, percentOf, persistencyText, scorecardsHref, shareText, trueCostPerSale, wholeDollars,
  type Bucket, type Dimension, type Drill, type FilterKey, type ScoreFilter, type ScorecardsQuery, type Slicing, type WeekRow,
} from "@/lib/ingestion/scorecards";
import { fileHref, rowHref } from "@/lib/ingestion/trace";
import { reportDay, reportPeriod } from "@/lib/reports/periodText";
import { showHref } from "@/lib/reports/show";
import { notify } from "@/lib/notify";

/**
 * LA-4.18 (Notion sprint) · the book scorecards: six tabs, each a chart view and a table view (Reports round 7,
 * owner pick 4·A "leave it", 2026-11-11), and every figure a link to the rows behind it. A share under the
 * agency's sample size prints as a count; a persistency bucket the book's history can't fill yet prints
 * "Building".
 *
 *   · Book: in-force premium by the Group by choice as bars (solid in force inside the premium written), and
 *     the Placed donut (the one donut Reports keeps).
 *   · Persistency: still paying by month since issue, one line for the whole book and up to three groups.
 *   · Chargebacks: advanced and charged back as bars. Net by week: advances up, chargebacks down.
 *   · Scorecards: spend by lead source, or net commission by the other groupings, as bars.
 *   · Today: its list first (it is work); its chart is today's events by kind, and issued and lapsed a day
 *     over the last 14 days (owner 2026-11-12: the switch on every sub-page).
 * A drill opens on its rows, with a chart of its own: a policy drill by carrier and by issue period, the week's
 * lines by day (chargebacks under the line) and by kind. Each bar narrows the drill's table.
 * Tables are one line a row: one text colour, one chip, five or six columns (mockups-r7/reports.html 4·1, 4·2).
 */

export type CellView = { month: Bucket; building: boolean; readyOn: string | null; eligible: number; alive: number; premiumEligibleCents: number; premiumAliveCents: number; premiumUnknown: number; endUnknown: number };
type SliceView = { key: string; name: string; policies: number; inForce: number; annualCents: number; inForceCents: number; annualUnknown: number };
type ChargebackView = { key: string; name: string; advancedCents: number; chargedBackCents: number; advancedPolicies: number; earlierCents: number };
type CardView = { key: string; name: string; policies: number; inForce: number; annualCents: number; issued: number; placed: number; contract: CellView; advancedCents: number; chargedBackCents: number; advancedPolicies: number; netCents: number; netKnown: boolean; spendCents?: number | null; sales?: number };
type GroupRow = { key: string; name: string; policies: number; cells: CellView[] };

export type ScorecardsView = {
  view: "book" | "persistency" | "chargebacks" | "weeks" | "scorecards" | "today";
  months: number;
  /** The address as the server read it (tab, period, group by, measure, show, filters). */
  query: ScorecardsQuery;
  /** This tab's Group by choices, its default first. */
  groupBy: Array<{ key: string; label: string }>;
  /** The Filters panel's choices: [key, name] per field, from the whole book. */
  filterOptions: Record<FilterKey, Array<[string, string]>>;
  periods: number[];
  today: string;
  period: { from: string; to: string };
  /** How persistency is counted: how many carriers from issue dates, and which from their first file. */
  history: { fromIssue: number; fromFirstFile: Array<{ name: string; since: string }> };
  minSample: number;
  canEditSettings: boolean;
  scoped: boolean;
  summary: SummaryInput;
  policies: number;
  overall: CellView[];
  whole: SliceView | null;
  book: Record<"carrier" | "product" | "status" | "agent" | "agency", SliceView[]>;
  placement: { issued: number; placed: number; notPlaced: number; submitted: number | null; submittedIssued: number | null };
  chargebacks: Record<Dimension | "all", ChargebackView[]>;
  weeks: WeekRow[] | null;
  persistencyBy: Record<Dimension, GroupRow[]>;
  cards: Record<Dimension, CardView[]>;
  spendAvailable: boolean;
  buckets: number[];
  /** The cards' small lines (0·C), one point a month, oldest first: whole dollars, and whole percents. */
  series: { inForce: number[]; placed: number[]; buckets: Record<Bucket, number[]> };
  /** Today's line: policies issued and lapsed a day over the last 14 days (null off Today). */
  daily: { days: string[]; issued: number[]; lapsed: number[] } | null;
};

const count = (n: number) => n.toLocaleString("en-US");
const dollars = (cents: number) => (cents / 100).toFixed(2);
/** An axis figure: whole dollars, with the sign (the weeks chart goes below zero). */
const axisDollars = (cents: number) => `${cents < 0 ? "−" : ""}${wholeDollars(Math.abs(cents))}`;
const FILTER_LABELS: Record<FilterKey, string> = { carrier: "Carrier", product: "Product", status: "Status", agent: "Agent", agency: "Agency", source: "Lead source" };

type Csv = { name: string; header: string[]; rows: Array<Array<string | number | null>> };

function downloadCsv({ name, header, rows }: Csv) {
  const blob = new Blob([`﻿${toCsv(header, rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const cellTitle = (c: CellView, minSample: number) =>
  c.building ? `Needs ${c.month} months of issue history${c.readyOn ? ` (from ${reportDay(c.readyOn)})` : ""}` : c.eligible === 0 ? "No policy is old enough for this month yet" : `${c.eligible < minSample ? `${c.alive} of ${c.eligible} in force; a percentage needs ${minSample} policies` : `${c.alive} of ${c.eligible} in force at month ${c.month}`}${c.endUnknown ? ` · ${c.endUnknown} lapsed with no end date on file, left out` : ""}`;

/** How persistency was counted, in one sentence under the table (lib/ingestion/scorecards.ts historyStart). */
function historyNote(history: ScorecardsView["history"]): string {
  const late = history.fromFirstFile;
  const issued = history.fromIssue ? `${history.fromIssue === 1 ? "One carrier is" : `${history.fromIssue} carriers are`} counted from issue dates: ${history.fromIssue === 1 ? "its files list" : "their files list"} lapsed policies with the date each ended.` : "";
  if (!late.length) return issued;
  const names = late.map((c) => `${c.name} (since ${readableDay(c.since)})`).join(", ");
  return `${issued}${issued ? " " : ""}${names}: counted on policies issued since ${late.length === 1 ? "its" : "their"} first file, because ${late.length === 1 ? "its file lists" : "their files list"} only live policies, or lapses without the date they ended, so older policies can't be judged fairly.`;
}

const ready = (c: CellView, measure: Measure) => !c.building && c.eligible > 0 && (measure === "count" || c.premiumEligibleCents > 0);
const pctOf = (c: CellView, measure: Measure) => (measure === "count" ? percentOf(c.alive, c.eligible) : percentOf(c.premiumAliveCents, c.premiumEligibleCents));
const underContract = (c: CellView | undefined, minSample: number) => Boolean(c && !c.building && c.eligible >= minSample && percentOf(c.alive, c.eligible) < CONTRACT_SHARE_PCT);

type Measure = "count" | "premium";
type Ctx = {
  model: ScorecardsView;
  by: string;
  measure: Measure;
  chart: boolean;
  drillHref: (d: Drill) => string;
  /** The table view, optionally narrowed by a filter (a legend row, a chart's "Open as a table"). */
  tableHref: (filter?: ScoreFilter) => string;
  open: (href: string) => void;
};

/** A dimension this tab can group by: the address's choice when it is one of them, else the tab's default. */
const dimOf = <K extends string>(by: string, allowed: readonly K[]): K => ((allowed as readonly string[]).includes(by) ? (by as K) : allowed[0]);
const BOOK_DIMS = ["carrier", "product", "status", "agent", "agency"] as const;
const PERSIST_DIMS = ["carrier", "product", "agent", "agency", "source"] as const;
const CB_DIMS = ["carrier", "product", "agent", "source"] as const;
const SCORE_DIMS = ["source", "carrier", "product", "agent", "agency"] as const;

/**
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx): the tabs go to its title line,
 * Group by, Measured by, the period, Filters, Export and ⋯ to its corner; the Table · Chart switch is the page's.
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): each list is its own tab, one at a time, and
 * the strip's tiles are the links. Placement is the Placed tile and donut, whose rows open as Placed · Issued ·
 * Never paid. The sample size is a confirm pop-up under ⋯ (4·6), not a form in a toolbar.
 */
export function BookScorecards({ model, framed = false }: { model: ScorecardsView; framed?: boolean }) {
  const router = useRouter();
  const [sampleOpen, setSampleOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Group by and Measured by change what is drawn, not what is read: every grouping is already here, so the
  // choice goes into the address in place (the switch and a shared link keep it) without a new server read.
  const [by, setBy] = useState(model.query.by ?? "");
  const [measure, setMeasure] = useState<Measure>(model.query.measure === "premium" ? "premium" : "count");
  const q: ScorecardsQuery = { ...model.query, by, measure };
  const base = scorecardsHref({ ...q, show: null });
  const drillHref = (d: Drill) => `${base}&drill=${encodeURIComponent(drillParam(d))}`;
  const tableHref = (filter?: ScoreFilter) => showHref(scorecardsHref({ ...q, filter: { ...q.filter, ...filter } }), "table");
  // The tabs carry the period, the filters and the view (the rail's rule); each tab has its own Group by.
  // Today opens on its table whichever view it is reached from, and a report tab opens on its chart from Today.
  const viewHref = (view: ScorecardsView["view"]) => scorecardsHref({ ...q, view, by: null, show: view === "today" || model.view === "today" ? null : model.query.show });
  const keep = (patch: Partial<ScorecardsQuery>) => {
    try { window.history.replaceState(null, "", scorecardsHref({ ...q, ...patch })); } catch { /* the view still follows the choice */ }
  };
  const chart = model.query.show !== "table";
  const ctx: Ctx = { model, by, measure, chart, drillHref, tableHref, open: (href) => router.push(href) };
  const csv = csvFor(ctx);

  const top = (
    <>
      <InReportsSlot framed={framed} slot="lead">
        <ViewTabs label="Scorecard views" active={model.view} tabs={BOOK_TABS.map((t) => ({ key: t.key, label: t.label, href: viewHref(t.key) }))} />
      </InReportsSlot>
      <InReportsSlot framed={framed} slot="corner">
        {model.groupBy.length > 0 && (
          <select aria-label="Group by" className={toolbarControl} value={dimOf(by, model.groupBy.map((g) => g.key))} onChange={(e) => { setBy(e.target.value); keep({ by: e.target.value }); }}>
            {model.groupBy.map((g) => <option key={g.key} value={g.key}>Group by {g.label.toLowerCase()}</option>)}
          </select>
        )}
        {model.view === "persistency" && (
          <select aria-label="Measured by" className={toolbarControl} value={measure} onChange={(e) => { const next = e.target.value === "premium" ? "premium" : "count"; setMeasure(next); keep({ measure: next }); }}>
            <option value="count">By policies</option>
            <option value="premium">By premium</option>
          </select>
        )}
        <select aria-label="Period" className={toolbarControl} value={model.months} onChange={(e) => router.push(scorecardsHref({ ...q, months: Number(e.target.value) }))}>
          {model.periods.map((m) => <option key={m} value={m}>Last {m} months</option>)}
        </select>
        {model.view !== "weeks" && model.view !== "today" && <FilterButton open={filtersOpen} controls="scorecards-filters" onClick={() => setFiltersOpen((o) => !o)} count={FILTER_KEYS.filter((k) => q.filter[k]).length} />}
        {csv && <Button type="button" variant="outline" disabled={!csv.rows.length} onClick={() => downloadCsv(csv)} title="The table's rows, as the table shows them"><Download aria-hidden="true" />Export CSV</Button>}
        {model.canEditSettings && <MoreMenu items={[{ label: "Sample size", onSelect: () => setSampleOpen(true) }]} />}
      </InReportsSlot>
      {model.canEditSettings && <SampleSize model={model} open={sampleOpen} onOpenChange={setSampleOpen} />}
      <Filters model={model} query={q} open={filtersOpen && model.view !== "weeks" && model.view !== "today"} onApply={(filter) => { setFiltersOpen(false); router.push(scorecardsHref({ ...q, filter })); }} />
    </>
  );

  if (model.policies === 0) {
    return <>{top}<TableCard><EmptyState title={FILTER_KEYS.some((k) => q.filter[k]) ? "No policies match these filters" : "No policies in your carrier files yet"} hint={FILTER_KEYS.some((k) => q.filter[k]) ? "Clear a filter to see more of the book." : "Figures appear once a carrier's policy file has been read."} /></TableCard></>;
  }

  return (
    <>
      {top}
      {model.view === "persistency" ? <PersistencyStrip ctx={ctx} /> : <BookStrip model={model} drillHref={drillHref} viewHref={viewHref} />}
      {model.view === "book" && <Book ctx={ctx} />}
      {model.view === "chargebacks" && <Chargebacks ctx={ctx} />}
      {model.view === "weeks" && <Weeks ctx={ctx} />}
      {model.view === "today" && <Today ctx={ctx} />}
      {model.view === "persistency" && <Persistency ctx={ctx} />}
      {model.view === "scorecards" && <Cards ctx={ctx} />}
    </>
  );
}

/** The tabs, in the order the spec lists them (LA-4.18). `overview` (old links) opens Book. */
export const BOOK_TABS: Array<{ key: ScorecardsView["view"]; label: string }> = [
  { key: "book", label: "Book" },
  { key: "persistency", label: "Persistency" },
  { key: "chargebacks", label: "Chargebacks" },
  { key: "weeks", label: "Net by week" },
  { key: "scorecards", label: "Scorecards" },
  { key: "today", label: "Today" },
];

// ─── filters (4·6) ────────────────────────────────────────────────────────────────────────────

function Filters({ model, query, open, onApply }: { model: ScorecardsView; query: ScorecardsQuery; open: boolean; onApply: (filter: ScoreFilter) => void }) {
  const [draft, setDraft] = useState<ScoreFilter>(query.filter);
  const nameOf = (key: FilterKey, value: string) => model.filterOptions[key].find(([k]) => k === value)?.[1] ?? value;
  const chips: ActiveFilter[] = FILTER_KEYS.filter((key) => query.filter[key]).map((key) => ({
    key, label: FILTER_LABELS[key], value: nameOf(key, query.filter[key] as string), onRemove: () => onApply({ ...query.filter, [key]: undefined }),
  }));
  if (!open && !chips.length) return null;
  return (
    <Card className="gap-0 py-0">
      <FilterPanel id="scorecards-filters" open={open}>
        {FILTER_KEYS.map((key) => (
          <FilterField key={key} label={FILTER_LABELS[key]} htmlFor={`scorecards-${key}`}>
            <select id={`scorecards-${key}`} className={toolbarControl} value={draft[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value || undefined }))}>
              <option value="">{key === "agent" ? "Anyone" : `Any ${FILTER_LABELS[key].toLowerCase()}`}</option>
              {model.filterOptions[key].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </FilterField>
        ))}
        <div className="flex items-end justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setDraft({})}>Clear all</Button>
          <Button type="button" onClick={() => onApply(draft)}>Show results</Button>
        </div>
      </FilterPanel>
      <ActiveFilters filters={chips} onClear={() => onApply({})} className="border-b-0" />
    </Card>
  );
}

// ─── the cards (0·C: each with a small line of its own figure) ─────────────────────────────────

/** The book's four headline figures, each the link to its rows or its tab (owner 2026-11-02). */
function BookStrip({ model, drillHref, viewHref }: { model: ScorecardsView; drillHref: (d: Drill) => string; viewHref: (v: ScorecardsView["view"]) => string }) {
  const m9 = model.overall.find((c) => c.month === CONTRACT_MONTH) as CellView;
  const cbAll = model.chargebacks.all[0];
  const pl = model.placement;
  const line = (points: number[]) => (points.length > 1 ? { points, tone: "primary" as const, placement: "under" as const } : undefined);
  return (
    <StatStrip label="Book">
      {/* The live book: in-force premium, opening the policies in force; its line is the in-force premium month by month. */}
      <StatTile label="In-force premium" value={model.whole ? centsText(model.whole.inForceCents) : "—"} trend={line(model.series.inForce)} href={model.whole ? drillHref({ kind: "book", dim: "all", key: "all", live: true }) : undefined} footnote={model.whole ? `${count(model.whole.inForce)} of ${count(model.whole.policies)} policies in force${model.whole.annualUnknown ? ` · ${model.whole.annualUnknown} with no premium on file` : ""}` : undefined} />
      <StatTile label={`Month-${CONTRACT_MONTH} persistency`} value={persistencyText(m9, "count", model.minSample)} trend={line(model.series.buckets[CONTRACT_MONTH])} href={viewHref("persistency")} footnote={m9.building ? cellTitle(m9, model.minSample) : underContract(m9, model.minSample) ? <><StatusChip tone="danger">Under {CONTRACT_SHARE_PCT}%</StatusChip> carriers look for {CONTRACT_SHARE_PCT}%</> : `carriers look for ${CONTRACT_SHARE_PCT}%`} />
      {/* Placement (issued and paid at least once) and its gap: the tile opens Placed · Issued · Never paid. */}
      <StatTile label="Placed" value={pl.issued ? shareText(pl.placed, pl.issued, model.minSample) : "—"} trend={line(model.series.placed)} href={pl.issued ? drillHref({ kind: "placement", set: "placed" }) : undefined} footnote={pl.issued ? `${count(pl.placed)} of ${count(pl.issued)} issued paid at least once` : "nothing issued in the period"} />
      {/* No line: the ratio counts chargebacks against their own advances, and the ledger dates neither per policy. */}
      <StatTile label="Chargeback ratio" value={cbAll ? chargebackText(cbAll, model.minSample) ?? "Building" : "—"} href={viewHref("chargebacks")} footnote={cbAll ? `${centsText(cbAll.chargedBackCents)} back of ${centsText(cbAll.advancedCents)} advanced${chargebackText(cbAll, model.minSample) ? "" : ` · a ratio needs ${model.minSample} policies`}` : "no advance on file yet"} />
    </StatStrip>
  );
}

/** Persistency's own four: one tile a bucket, its line the bucket as it read month by month. */
function PersistencyStrip({ ctx: { model, drillHref } }: { ctx: Ctx }) {
  return (
    <StatStrip label="Persistency">
      {model.overall.map((c) => {
        const points = model.series.buckets[c.month];
        const shown = !c.building && c.eligible > 0;
        return (
          <StatTile key={c.month} label={`Month ${c.month}`} value={shown ? persistencyText(c, "count", model.minSample) : c.building ? "Building" : "—"}
            href={shown ? drillHref({ kind: "persistency", month: c.month, dim: "all", key: "" }) : undefined}
            trend={points.length > 1 ? { points, tone: "primary", placement: "under" } : undefined}
            footnote={c.building ? cellTitle(c, model.minSample) : !c.eligible ? "none old enough yet" : underContract(c, model.minSample) && c.month === CONTRACT_MONTH ? <><StatusChip tone="danger">Under {CONTRACT_SHARE_PCT}%</StatusChip> {persistencyText(c, "premium", model.minSample)} by premium</> : `${persistencyText(c, "premium", model.minSample)} by premium${c.premiumUnknown ? ` · ${c.premiumUnknown} with no premium` : ""}`} />
        );
      })}
    </StatStrip>
  );
}

// ─── shared pieces ────────────────────────────────────────────────────────────────────────────

/** A chart's card: its heading carries the figure the tile used to show, and the way to the table. */
function ChartCard({ title, period, tableHref, children, className }: { title: string; period?: string; tableHref?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`gap-4 px-4 py-4 sm:px-5 ${className ?? ""}`}>
      <ChartHeading title={title} period={period} action={tableHref ? <Link href={tableHref} className="shrink-0 text-sm text-[var(--accent-ink)] hover:underline">Open as a table ›</Link> : undefined} />
      {children}
    </Card>
  );
}

/** A table row the whole of which opens its rows; its name is the link, for the keyboard. */
function Row({ href, open, name, title, children }: { href: string | null; open: (href: string) => void; name: ReactNode; title?: string; children: ReactNode }) {
  return (
    <tr className={href ? "cursor-pointer" : undefined} title={title} onClick={href ? () => open(href) : undefined}>
      <td className="whitespace-nowrap font-semibold text-foreground">{href ? <Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>{name}</Link> : name}</td>
      {children}
    </tr>
  );
}

const Dash = () => <span className="text-muted-foreground">—</span>;
const Chip = ({ s }: { s: { tone: StatusTone; text: string } | null }) => (s ? <StatusChip tone={s.tone}>{s.text}</StatusChip> : <Dash />);
const LIMIT = 12;

// ─── book ─────────────────────────────────────────────────────────────────────────────────────

function Book({ ctx }: { ctx: Ctx }) {
  const { model, drillHref, tableHref, open } = ctx;
  const dim = dimOf(ctx.by, BOOK_DIMS);
  const rows = model.book[dim];
  const name = (s: SliceView) => (dim === "status" ? statusLabel(s.key) : s.name);
  const w = model.whole;
  const label = DIMENSION_LABELS[dim].toLowerCase();
  if (ctx.chart) {
    const pl = model.placement;
    const shown = [...rows].sort((a, b) => b.inForceCents - a.inForceCents || b.annualCents - a.annualCents).slice(0, LIMIT);
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ChartCard title={`In-force premium, by ${label}${w ? ` · ${centsText(w.inForceCents)}` : ""}`} period={`Solid is in force, pale is the rest of the premium written${rows.length > LIMIT ? ` · the ${LIMIT} largest of ${rows.length}` : ""}`} tableHref={tableHref()}>
          <BarList
            summary={`In-force premium by ${label}, inside the premium written on every policy`}
            format={centsText}
            labelWidth="14rem"
            rows={shown.map((s): BarListRow => ({ key: s.key, label: name(s), value: s.annualCents, inner: s.inForceCents, figure: centsText(s.inForceCents), caption: `of ${centsText(s.annualCents)}`, href: s.inForce ? drillHref({ kind: "book", dim, key: s.key, live: true }) : drillHref({ kind: "book", dim, key: s.key }) }))}
            total={w ? { label: `Whole book · ${count(w.inForce)} of ${count(w.policies)} in force`, figure: centsText(w.inForceCents), caption: `of ${centsText(w.annualCents)}`, href: drillHref({ kind: "book", dim: "all", key: "all", live: true }) } : undefined}
          />
        </ChartCard>
        <ChartCard title="Placed" period={`Issued in the last ${model.months} months`}>
          {pl.issued ? (
            <DonutChart
              summary={`Of ${count(pl.issued)} policies issued in the period, ${count(pl.placed)} were paid at least once`}
              centerValue={shareText(pl.placed, pl.issued, model.minSample)}
              centerLabel={`${count(pl.placed)} of ${count(pl.issued)}`}
              segments={[
                { key: "placed", label: "Placed (paid at least once)", value: pl.placed, tone: "strong", href: drillHref({ kind: "placement", set: "placed" }) },
                { key: "not_placed", label: "Issued, never paid", value: pl.notPlaced, tone: "faint", href: drillHref({ kind: "placement", set: "not_placed" }) },
              ]}
            />
          ) : <EmptyState title="Nothing issued in the period" hint="Placement appears once a carrier file lists a policy issued in these months." />}
        </ChartCard>
      </div>
    );
  }
  return (
    <PagedTableCard key={`book-${dim}`} total={rows.length} noun="rows" footer={w ? <span>{count(w.policies)} policies · {count(w.inForce)} in force · a row opens its policies</span> : undefined}>
      <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
        <thead><tr><th>{DIMENSION_LABELS[dim]}</th><th className="w-[110px] text-right">Policies</th><th className="w-[110px] text-right">In force</th><th className="w-[170px] text-right">In-force premium</th><th className="w-[190px] text-right">Premium, all policies</th></tr></thead>
        <PagedBody>
          {rows.map((s) => (
            <Row key={s.key} href={drillHref({ kind: "book", dim, key: s.key })} open={open} name={name(s)}>
              <td className="text-right tabular-nums">{count(s.policies)}</td>
              <td className="text-right tabular-nums">{count(s.inForce)}</td>
              <td className="text-right tabular-nums">{s.inForce ? centsText(s.inForceCents) : <Dash />}</td>
              <td className="text-right tabular-nums" title={s.annualUnknown ? `${s.annualUnknown} with no premium on file` : undefined}>{centsText(s.annualCents)}</td>
            </Row>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );
}

// ─── persistency ──────────────────────────────────────────────────────────────────────────────

/** The row's one chip: under the contract line, then what is still building, then a small sample, then undated lapses. */
function persistStatus(cells: CellView[], minSample: number): { tone: StatusTone; text: string } | null {
  if (underContract(cells.find((c) => c.month === CONTRACT_MONTH), minSample)) return { tone: "danger", text: `Under ${CONTRACT_SHARE_PCT}% at month ${CONTRACT_MONTH}` };
  const next = cells.find((c) => c.building);
  if (next) return { tone: "neutral", text: next.readyOn ? `Month ${next.month} from ${reportDay(next.readyOn)}` : "Building" };
  if (cells.some((c) => !c.building && c.eligible > 0 && c.eligible < minSample)) return { tone: "neutral", text: `Under ${minSample} policies` };
  const undated = cells.reduce((most, c) => Math.max(most, c.endUnknown), 0);
  return undated ? { tone: "warning", text: `${count(undated)} lapses with no end date` } : null;
}

const LINE_TONES: ChartTone[] = ["cat2", "cat3", "cat4"];

function Persistency({ ctx }: { ctx: Ctx }) {
  const { model, measure, drillHref, tableHref } = ctx;
  const dim = dimOf(ctx.by, PERSIST_DIMS);
  const groups = model.persistencyBy[dim];
  const footer = <span>{historyNote(model.history)}</span>;
  if (ctx.chart) {
    const points = model.overall.filter((c) => ready(c, measure));
    const building = model.overall.filter((c) => c.building);
    // A group is drawn when every month the whole book draws has a percentage on the sample size (4·A: the
    // largest three; a group under the sample size is not drawn).
    const drawn = groups.filter((g) => points.every((p) => { const c = g.cells.find((x) => x.month === p.month); return c && ready(c, measure) && c.eligible >= model.minSample; })).slice(0, 3);
    const at = (c: CellView) => ({ key: String(c.month), label: `Month ${c.month}`, value: pctOf(c, measure) });
    return (
      <ChartCard
        title="Still paying, by month since issue"
        period={`${measure === "count" ? "By policies" : "By premium"}${building.length ? ` · ${building.map((c) => `month ${c.month}${c.readyOn ? ` from ${reportDay(c.readyOn)}` : ""}`).join(", ")} building` : ""} · groups under ${model.minSample} policies are not drawn`}
        tableHref={tableHref()}
      >
        {points.length ? (
          <LineSeries
            summary={`Persistency ${measure === "count" ? "by policies" : "by premium"} at months ${points.map((c) => c.month).join(", ")}`}
            labels="all"
            minHeight={220}
            format={(v) => `${v}%`}
            points={points.map(at)}
            legend={{ label: "Whole book", figure: `${count(model.policies)} policies`, href: tableHref() }}
            hrefFor={(p) => drillHref({ kind: "persistency", month: Number(p.key) as Bucket, dim: "all", key: "" })}
            lines={drawn.map((g, i) => ({ key: g.key, label: g.name, tone: LINE_TONES[i], figure: `${count(g.policies)} policies`, href: tableHref({ [dim]: g.key }), points: points.map((p) => at(g.cells.find((x) => x.month === p.month) as CellView)) }))}
          />
        ) : <EmptyState title="Building" hint={building[0]?.readyOn ? `The first figure is month ${building[0].month}, from ${reportDay(building[0].readyOn)}.` : "Persistency appears once policies are old enough to judge."} />}
        <p className="m-0 text-xs text-muted-foreground">{historyNote(model.history)}</p>
      </ChartCard>
    );
  }
  // At most three month columns (six in all): the months the book has, and the next one coming; with all
  // four ready, month 6 waits in the chart and the CSV.
  const readyMonths = model.overall.filter((c) => !c.building).map((c) => c.month);
  const nextMonth = model.overall.find((c) => c.building)?.month;
  const months: Bucket[] = readyMonths.length === 4 ? [3, 9, 13] : [...readyMonths, ...(nextMonth ? [nextMonth] : [])].slice(0, 3);
  const rows = [{ key: "", name: "Whole book", policies: model.policies, cells: model.overall, all: true }, ...groups.map((r) => ({ ...r, all: false }))];
  const cell = (c: CellView, key: string, all: boolean) => {
    if (c.building || !c.eligible) return <span className="text-muted-foreground" title={cellTitle(c, model.minSample)}>—</span>;
    return <Link href={drillHref({ kind: "persistency", month: c.month, dim: all ? "all" : dim, key })} title={cellTitle(c, model.minSample)} className="tabular-nums hover:underline">{persistencyText(c, measure, model.minSample)}</Link>;
  };
  return (
    <PagedTableCard key={dim} total={rows.length} noun="rows" suffix={model.history.fromFirstFile.length ? `${model.history.fromFirstFile.length} ${model.history.fromFirstFile.length === 1 ? "carrier" : "carriers"} counted from their first file` : undefined} footer={footer}>
      <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
        <thead><tr><th>{DIMENSION_LABELS[dim]}</th><th className="w-[96px] text-right">Policies</th>{months.map((b) => <th key={b} className="w-[110px] text-right">Month {b}</th>)}<th className="w-[200px]">Status</th></tr></thead>
        <PagedBody>
          {rows.map((r) => (
            <tr key={`${r.all}-${r.key}`}>
              <td className="whitespace-nowrap font-semibold text-foreground">{r.name}</td>
              <td className="text-right tabular-nums">{count(r.policies)}</td>
              {months.map((m) => <td key={m} className="text-right">{cell(r.cells.find((c) => c.month === m) as CellView, r.key, r.all)}</td>)}
              <td><Chip s={persistStatus(r.cells, model.minSample)} /></td>
            </tr>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );
}

// ─── chargebacks ──────────────────────────────────────────────────────────────────────────────

function Chargebacks({ ctx }: { ctx: Ctx }) {
  const { model, drillHref, tableHref, open } = ctx;
  const dim = dimOf(ctx.by, CB_DIMS);
  const rows = model.chargebacks[dim];
  const all = model.chargebacks.all[0];
  const bookLine = all ? `${chargebackText(all, model.minSample) ?? "No ratio yet"} across the book: ${centsText(all.chargedBackCents)} back of ${centsText(all.advancedCents)} advanced${all.earlierCents ? ` · ${centsText(all.earlierCents)} more on advances paid before your first statement` : ""}` : "";
  if (!rows.length) return <TableCard><EmptyState title="No advances on file yet" hint="The ratio appears once a commission file with advances has been read." /></TableCard>;
  if (ctx.chart) {
    const shown = rows.filter((r) => r.advancedCents > 0).sort((a, b) => b.advancedCents - a.advancedCents).slice(0, LIMIT);
    return (
      <ChartCard title={`Advanced and charged back, by ${DIMENSION_LABELS[dim].toLowerCase()}${all ? ` · ${chargebackText(all, model.minSample) ?? centsText(all.chargedBackCents)}` : ""}`} period="Solid is charged back, pale is the rest of the advance · chargebacks on earlier advances are the table's" tableHref={tableHref()}>
        <BarList
          summary="Chargebacks inside the advances they claw back"
          format={centsText}
          labelWidth="14rem"
          rows={shown.map((r): BarListRow => ({ key: r.key, label: r.name, value: r.advancedCents, inner: r.chargedBackCents, figure: `${centsText(r.chargedBackCents)} of ${centsText(r.advancedCents)}`, caption: chargebackText(r, model.minSample) ?? undefined, href: drillHref({ kind: "chargeback", dim, key: r.key }) }))}
          total={all ? { label: `Book · ${chargebackText(all, model.minSample) ?? `needs ${model.minSample} policies`}`, figure: `${centsText(all.chargedBackCents)} of ${centsText(all.advancedCents)}`, href: drillHref({ kind: "chargeback", dim: "all", key: "all" }) } : undefined}
        />
      </ChartCard>
    );
  }
  const status = (r: ChargebackView): { tone: StatusTone; text: string } | null =>
    r.earlierCents ? { tone: "warning", text: `${centsText(r.earlierCents)} on earlier advances` } : !chargebackText(r, model.minSample) ? { tone: "neutral", text: `Needs ${model.minSample} policies` } : null;
  return (
    <PagedTableCard key={`chargebacks-${dim}`} total={rows.length} noun="rows" footer={<span>{bookLine}</span>}>
      <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
        <thead><tr><th>{DIMENSION_LABELS[dim]}</th><th className="w-[150px] text-right">Policies advanced</th><th className="w-[140px] text-right">Advanced</th><th className="w-[140px] text-right">Charged back</th><th className="w-[90px] text-right">Ratio</th><th className="w-[230px]">Status</th></tr></thead>
        <PagedBody>
          {rows.map((r) => (
            <Row key={r.key} href={drillHref({ kind: "chargeback", dim, key: r.key })} open={open} name={r.name}>
              <td className="text-right tabular-nums">{count(r.advancedPolicies)}</td>
              <td className="text-right tabular-nums">{centsText(r.advancedCents)}</td>
              <td className="text-right tabular-nums">{centsText(r.chargedBackCents)}</td>
              <td className="text-right tabular-nums">{chargebackText(r, model.minSample) ?? <Dash />}</td>
              <td><Chip s={status(r)} /></td>
            </Row>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );
}

// ─── net by week ──────────────────────────────────────────────────────────────────────────────

/** Money in (advances, earned, overrides) and money out (chargebacks, fees, advance interest); "other" goes by its sign. */
const inOf = (w: WeekRow) => w.parts.advance + w.parts.earned + w.parts.override + Math.max(0, w.parts.other);
const outOf = (w: WeekRow) => Math.abs(w.parts.chargeback + w.parts.fee + w.parts.advance_interest + Math.min(0, w.parts.other));

function Weeks({ ctx }: { ctx: Ctx }) {
  const { model, drillHref, tableHref, open } = ctx;
  const weeks = model.weeks ?? [];
  if (model.weeks === null) return <TableCard><EmptyState title="Not available yet" hint="This needs a database update (20261008270000)." /></TableCard>;
  if (!weeks.some((w) => w.entries > 0)) return <TableCard><EmptyState title="No commission lines in the last 13 weeks" hint="Weeks appear once a commission file has been read." /></TableCard>;
  const net = weeks.reduce((sum, w) => sum + w.netCents, 0);
  if (ctx.chart) {
    const oldestFirst = [...weeks].reverse();
    const thisWeek = weeks[0]?.week;
    return (
      <ChartCard title={`Advances in, chargebacks out, by week · ${centsText(net)} net`} period={`This week and the ${weeks.length - 1} before it · a week opens its commission lines`} tableHref={tableHref()}>
        <BarSeries
          summary="Money in above the line and money out below it, week by week"
          format={axisDollars}
          minHeight={220}
          bars={oldestFirst.map((w) => ({ key: w.week, label: reportDay(w.week), value: inOf(w), below: outOf(w), partial: w.week === thisWeek }))}
          names={{ value: "Advances and earned", below: "Chargebacks and fees" }}
          legend={[
            { key: "in", label: "Advances and earned", tone: "strong", figure: centsText(weeks.reduce((s, w) => s + inOf(w), 0)), href: tableHref() },
            { key: "out", label: "Chargebacks and fees", tone: "warning", figure: centsText(-weeks.reduce((s, w) => s + outOf(w), 0)), href: tableHref() },
          ]}
          hrefFor={(bar) => (weeks.find((w) => w.week === bar.key)?.entries ? drillHref({ kind: "week", week: bar.key }) : null)}
        />
      </ChartCard>
    );
  }
  const status = (w: WeekRow): { tone: StatusTone; text: string } | null =>
    w.entries === 0 ? { tone: "neutral", text: "No lines" } : w.netCents < 0 ? { tone: "warning", text: "Net out" } : w.heldCents ? { tone: "info", text: `${centsText(w.heldCents)} held` } : null;
  return (
    <PagedTableCard total={weeks.length} noun="weeks" footer={<span>This week and the {weeks.length - 1} before it · {centsText(net)} net · earned, fees and held are the row&rsquo;s tooltip · a row opens the week&rsquo;s lines</span>}>
      <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
        <thead><tr><th>Week of</th><th className="text-right">Advances</th><th className="text-right">Chargebacks</th><th className="text-right">Net</th><th className="w-[180px]">Status</th></tr></thead>
        <PagedBody>
          {weeks.map((w) => (
            <Row key={w.week} href={w.entries ? drillHref({ kind: "week", week: w.week }) : null} open={open} name={readableDay(w.week)}
              title={w.entries ? `Earned and overrides ${centsText(w.parts.earned + w.parts.override)} · fees and interest ${centsText(w.parts.fee + w.parts.advance_interest)} · other ${centsText(w.parts.other)} · held ${centsText(w.heldCents)}` : undefined}>
              <td className="text-right tabular-nums">{w.entries ? centsText(w.parts.advance) : <Dash />}</td>
              <td className="text-right tabular-nums">{w.entries ? centsText(w.parts.chargeback) : <Dash />}</td>
              <td className="text-right tabular-nums">{w.entries ? centsText(w.netCents) : <Dash />}</td>
              <td><Chip s={status(w)} /></td>
            </Row>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );
}

// ─── scorecards ───────────────────────────────────────────────────────────────────────────────

function Cards({ ctx }: { ctx: Ctx }) {
  const { model, drillHref, tableHref, open } = ctx;
  const dim = dimOf(ctx.by, SCORE_DIMS);
  const rows = model.cards[dim];
  const source = dim === "source";
  const m9 = (c: CardView) => persistencyText(c.contract, "count", model.minSample);
  const spendNote = model.scoped ? "Spend is the agency's and isn't shown on a producer's own scorecard" : !model.spendAvailable ? "Lead spend isn't available right now; refresh to try again" : `Spend and sales: ${reportPeriod(model.period.from, model.period.to)} · true cost per sale = spend ÷ (sales × month-${CONTRACT_MONTH} persistency)`;
  if (!rows.length) return <TableCard><EmptyState title="Nothing to score yet" hint="Rows appear once policies are in your carrier files." /></TableCard>;
  const rowHrefOf = (c: CardView) => (source && c.sales ? drillHref({ kind: "sales", key: c.key }) : drillHref({ kind: "book", dim, key: c.key }));

  if (ctx.chart) {
    const bySpend = source && model.spendAvailable && !model.scoped;
    if (bySpend) {
      const shown = [...rows].sort((a, b) => (b.spendCents ?? -1) - (a.spendCents ?? -1) || (b.sales ?? 0) - (a.sales ?? 0)).slice(0, LIMIT);
      const total = rows.reduce((s, c) => s + (c.spendCents ?? 0), 0);
      return (
        <ChartCard title={`Spend and sales, by lead source · ${wholeDollars(total)}`} period={spendNote} tableHref={tableHref()}>
          <BarList
            summary="Lead spend by source, with the sales it bought"
            format={wholeDollars}
            labelWidth="14rem"
            rows={shown.map((c): BarListRow => {
              const cps = costPerSale(c.spendCents, c.sales);
              return { key: c.key, label: c.name, value: c.spendCents ?? 0, figure: c.spendCents == null ? "No spend" : wholeDollars(c.spendCents), caption: `${count(c.sales ?? 0)} ${c.sales === 1 ? "sale" : "sales"}${cps === null ? "" : ` · ${wholeDollars(cps)} each`}`, href: rowHrefOf(c) };
            })}
          />
        </ChartCard>
      );
    }
    const shown = [...rows].filter((c) => c.netKnown).sort((a, b) => b.netCents - a.netCents).slice(0, LIMIT);
    const total = rows.reduce((s, c) => s + c.netCents, 0);
    return (
      <ChartCard title={`Net commission, by ${DIMENSION_LABELS[dim].toLowerCase()} · ${centsText(total)}`} period={`Advances and earned, less chargebacks and fees, on each ${DIMENSION_LABELS[dim].toLowerCase()}'s policies${source ? ` · ${spendNote.toLowerCase()}` : ""}`} tableHref={tableHref()}>
        {shown.length ? (
          <BarList
            summary={`Net commission by ${DIMENSION_LABELS[dim].toLowerCase()}`}
            format={centsText}
            labelWidth="14rem"
            rows={shown.map((c): BarListRow => ({ key: c.key, label: c.name, value: c.netCents, caption: `${count(c.policies)} ${c.policies === 1 ? "policy" : "policies"} · month ${CONTRACT_MONTH} ${m9(c)}`, href: rowHrefOf(c) }))}
          />
        ) : <EmptyState title="No commission lines yet" hint="Net commission appears once a commission file has been read." />}
      </ChartCard>
    );
  }

  const status = (c: CardView): { tone: StatusTone; text: string } | null => {
    if (source && (c.key === "none" || c.key === "unattributed" || c.name === "Unattributed")) return { tone: "neutral", text: "No source" };
    if (underContract(c.contract, model.minSample)) return { tone: "danger", text: `Under ${CONTRACT_SHARE_PCT}% at month ${CONTRACT_MONTH}` };
    if (c.contract.building) return { tone: "neutral", text: c.contract.readyOn ? `Month ${CONTRACT_MONTH} from ${reportDay(c.contract.readyOn)}` : `Month ${CONTRACT_MONTH} building` };
    return null;
  };
  const net = (c: CardView) => (c.netKnown ? centsText(c.netCents) : <span className="text-muted-foreground" title="No commission line for these policies is on file yet">—</span>);
  const netTitle = (c: CardView) => `Chargeback ratio ${chargebackText(c, model.minSample) ?? `needs ${model.minSample} advanced policies`} · ${centsText(c.chargedBackCents)} back of ${centsText(c.advancedCents)} advanced`;

  if (source) {
    // True cost per sale takes Cost per sale's column once any source has it (4·2: "its column returns when month 9 is ready").
    const trueCost = rows.some((c) => trueCostPerSale(c.spendCents, c.sales, c.contract, model.minSample) !== null);
    return (
      <PagedTableCard key={dim} total={rows.length} noun="rows" footer={<span>{spendNote}</span>}>
        <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead><tr><th>Lead source</th><th className="w-[120px] text-right">Spend</th><th className="w-[90px] text-right">Sales</th><th className="w-[150px] text-right">{trueCost ? "True cost per sale" : "Cost per sale"}</th><th className="w-[150px] text-right">Net commission</th><th className="w-[200px]">Status</th></tr></thead>
          <PagedBody>
            {rows.map((c) => {
              const cps = costPerSale(c.spendCents, c.sales);
              const tcs = trueCostPerSale(c.spendCents, c.sales, c.contract, model.minSample);
              const cost = trueCost ? tcs : cps;
              return (
                <Row key={c.key} href={rowHrefOf(c)} open={open} name={c.name}>
                  <td className="text-right tabular-nums">{c.spendCents == null ? <Dash /> : wholeDollars(c.spendCents)}</td>
                  <td className="text-right tabular-nums">{count(c.sales ?? 0)}</td>
                  <td className="text-right tabular-nums" title={trueCost ? `Cost per sale ${cps === null ? "—" : wholeDollars(cps)} · month ${CONTRACT_MONTH} ${m9(c)}` : undefined}>{cost === null ? <Dash /> : wholeDollars(cost)}</td>
                  <td className="text-right tabular-nums" title={netTitle(c)}>{net(c)}</td>
                  <td><Chip s={status(c)} /></td>
                </Row>
              );
            })}
          </PagedBody>
        </table>
      </PagedTableCard>
    );
  }
  return (
    <PagedTableCard key={dim} total={rows.length} noun="rows" footer={<span>A row opens its policies · the chargeback ratio is the net figure&rsquo;s tooltip</span>}>
      <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
        <thead><tr><th>{DIMENSION_LABELS[dim]}</th><th className="w-[100px] text-right">Policies</th><th className="w-[110px] text-right">Placed</th><th className="w-[110px] text-right">Month {CONTRACT_MONTH}</th><th className="w-[150px] text-right">Net commission</th><th className="w-[200px]">Status</th></tr></thead>
        <PagedBody>
          {rows.map((c) => (
            <Row key={c.key} href={rowHrefOf(c)} open={open} name={c.name}>
              <td className="text-right tabular-nums">{count(c.policies)}</td>
              <td className="text-right tabular-nums" title={`${count(c.placed)} of ${count(c.issued)} issued paid at least once`}>{c.issued ? shareText(c.placed, c.issued, model.minSample) : <Dash />}</td>
              <td className="text-right tabular-nums" title={cellTitle(c.contract, model.minSample)}>{c.contract.building || !c.contract.eligible ? <Dash /> : m9(c)}</td>
              <td className="text-right tabular-nums" title={netTitle(c)}>{net(c)}</td>
              <td><Chip s={status(c)} /></td>
            </Row>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );
}

// ─── today ────────────────────────────────────────────────────────────────────────────────────

const FACT_STATUS: Record<string, { tone: StatusTone; text: string }> = {
  closing: { tone: "warning", text: "Due" },
  lapsed: { tone: "danger", text: "Lapsed" },
  at_risk: { tone: "warning", text: "At risk" },
  chargebacks: { tone: "danger", text: "Charged back" },
  contract: { tone: "danger", text: `Under ${CONTRACT_SHARE_PCT}%` },
  issued: { tone: "good", text: "Issued" },
};

const FACT_LABEL: Record<string, string> = { closing: "Closing soon", lapsed: "Lapsed", at_risk: "Moved to at risk", chargebacks: "Chargebacks", issued: "Newly issued" };
const FACT_TONE: Record<string, ChartTone> = { lapsed: "warning", chargebacks: "warning", closing: "warning", at_risk: "warning" };

/**
 * Today's summary (LA-4.18): only facts from its own input, each linked through; says so when the day was quiet.
 * Its table first (it is work); the chart is the same facts by kind, each bar its fact's page, and the book's
 * issued and lapsed a day over the last 14 days. Month-9 persistency is a share, not a count of events: the table's.
 */
function Today({ ctx: { model, open, chart, tableHref } }: { ctx: Ctx }) {
  if (chart) {
    const counted = model.summary.facts.map((f) => ({ f, n: Number(f.figures.count) })).filter((x) => Number.isFinite(x.n) && x.n > 0);
    const share = model.summary.facts.some((f) => f.id === "contract");
    const daily = model.daily;
    const total = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0);
    const at = (values: number[]) => (daily as NonNullable<typeof daily>).days.map((day, i) => ({ key: day, label: reportDay(day), value: values[i] }));
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Today, by kind" period={`${readableDay(model.summary.date)}${share ? ` · month-${CONTRACT_MONTH} persistency is a share and stays in the table` : ""}`} tableHref={tableHref()}>
          {counted.length ? (
            <BarList
              summary="Today's events by kind"
              labelWidth="12rem"
              rows={counted.map(({ f, n }): BarListRow => ({ key: f.id, label: FACT_LABEL[f.id] ?? f.id, value: n, caption: f.id === "chargebacks" ? `${f.figures.amount} in all` : undefined, tone: FACT_TONE[f.id], href: f.href }))}
            />
          ) : <EmptyState title="Nothing notable today" hint={QUIET_DAY} />}
        </ChartCard>
        {daily && (
          <ChartCard title="Issued and lapsed, the last 14 days" period="Issued by the carrier's issue date · lapsed by the file that showed it">
            <LineSeries
              summary="Policies issued and lapsed a day over the last 14 days"
              minHeight={200}
              points={at(daily.issued)}
              legend={{ label: "Issued", figure: count(total(daily.issued)), href: "/app/policies?status=active" }}
              lines={[{ key: "lapsed", label: "Lapsed", tone: "warning", dashed: true, figure: count(total(daily.lapsed)), href: "/app/policies?status=lapsed", points: at(daily.lapsed) }]}
            />
          </ChartCard>
        )}
      </div>
    );
  }
  return (
    <PagedTableCard total={model.summary.facts.length} noun="items" footer={<span>{readableDay(model.summary.date)}</span>}>
      {model.summary.facts.length === 0 ? <EmptyState title="Nothing notable today" hint={QUIET_DAY} /> : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>What happened</th><th className="w-[160px]">Status</th><th className="w-[120px]">Next step</th></tr></thead>
          <PagedBody>
            {model.summary.facts.map((f) => (
              <tr key={f.id} className="cursor-pointer" onClick={() => open(f.href)}>
                <td className="text-foreground"><Link href={f.href} className="hover:underline" onClick={(e) => e.stopPropagation()}>{f.text}</Link></td>
                <td><Chip s={FACT_STATUS[f.id] ?? null} /></td>
                <td className="whitespace-nowrap">Open ›</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

// ─── export: the table's rows, in either view ──────────────────────────────────────────────────

function csvFor({ model, by, measure }: Ctx): Csv | null {
  if (model.policies === 0) return null;
  if (model.view === "book") {
    const dim = dimOf(by, BOOK_DIMS);
    return { name: `book-by-${dim}`, header: [DIMENSION_LABELS[dim], "Policies", "In force", "In-force premium", "Premium, all policies", "No premium on file"], rows: model.book[dim].map((s) => [dim === "status" ? statusLabel(s.key) : s.name, s.policies, s.inForce, dollars(s.inForceCents), dollars(s.annualCents), s.annualUnknown]) };
  }
  if (model.view === "persistency") {
    const dim = dimOf(by, PERSIST_DIMS);
    const rows = [{ name: "Whole book", policies: model.policies, cells: model.overall }, ...model.persistencyBy[dim]];
    return { name: `persistency-by-${dim}-${measure}`, header: [DIMENSION_LABELS[dim], "Policies", ...model.buckets.map((b) => `Month ${b} (${measure === "count" ? "by policies" : "by premium"})`)], rows: rows.map((r) => [r.name, r.policies, ...r.cells.map((c) => persistencyText(c, measure, model.minSample))]) };
  }
  if (model.view === "chargebacks") {
    const dim = dimOf(by, CB_DIMS);
    return { name: `chargebacks-by-${dim}`, header: [DIMENSION_LABELS[dim], "Advanced", "Charged back", "Policies advanced", "Ratio", "Charged back on earlier advances"], rows: model.chargebacks[dim].map((r) => [r.name, dollars(r.advancedCents), dollars(r.chargedBackCents), r.advancedPolicies, chargebackText(r, model.minSample), dollars(r.earlierCents)]) };
  }
  if (model.view === "weeks") {
    const weeks = model.weeks ?? [];
    return { name: "net-commission-by-week", header: ["Week of", "Advances", "Earned and overrides", "Chargebacks", "Fees and interest", "Other", "Net", "Held"], rows: weeks.map((w) => [w.week, dollars(w.parts.advance), dollars(w.parts.earned + w.parts.override), dollars(w.parts.chargeback), dollars(w.parts.fee + w.parts.advance_interest), dollars(w.parts.other), dollars(w.netCents), dollars(w.heldCents)]) };
  }
  if (model.view === "scorecards") {
    const dim = dimOf(by, SCORE_DIMS);
    const source = dim === "source";
    const m9 = (c: CardView) => persistencyText(c.contract, "count", model.minSample);
    const header = source
      ? ["Lead source", "Spend", "Sales", "Cost per sale", `Month-${CONTRACT_MONTH} persistency`, "True cost per sale", "Policies", "Chargeback ratio", "Net commission"]
      : [DIMENSION_LABELS[dim as Slicing], "Policies", "In force", "Annualised premium", "Placed", `Month-${CONTRACT_MONTH} persistency`, "Chargeback ratio", "Net commission"];
    return {
      name: `scorecard-by-${dim}`,
      header,
      rows: model.cards[dim].map((c) => {
        const cb = chargebackText(c, model.minSample);
        if (source) {
          const cps = costPerSale(c.spendCents, c.sales);
          const tcs = trueCostPerSale(c.spendCents, c.sales, c.contract, model.minSample);
          return [c.name, c.spendCents == null ? null : dollars(c.spendCents), c.sales ?? 0, cps === null ? null : dollars(cps), m9(c), tcs === null ? null : dollars(tcs), c.policies, cb, c.netKnown ? dollars(c.netCents) : null];
        }
        return [c.name, c.policies, c.inForce, dollars(c.annualCents), c.issued ? shareText(c.placed, c.issued, model.minSample) : null, m9(c), cb, c.netKnown ? dollars(c.netCents) : null];
      }),
    };
  }
  return null;
}

// ─── the sample size (4·6, under ⋯) ───────────────────────────────────────────────────────────

/** The agency's sample size (LA-4.18: configurable, default 10): a confirm pop-up with its one field. */
function SampleSize({ model, open, onOpenChange }: { model: ScorecardsView; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [value, setValue] = useState(String(model.minSample));
  const [busy, setBusy] = useState(false);
  const number = Number(value);
  const valid = Number.isInteger(number) && number >= 2 && number <= 100;
  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/app/book-scorecards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_settings", min_sample: number }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The setting could not be saved.");
      notify.done("Saved. Shares under this many policies show as counts.");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The setting could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => { if (!next) setValue(String(model.minSample)); onOpenChange(next); }}
      onConfirm={() => void save()}
      busy={busy}
      destructive={false}
      title="Sample size"
      description="Below this many policies a figure shows its count, not a percentage. It applies to every figure on Book scorecards."
      confirmLabel="Save"
      confirmDisabled={!valid || value === String(model.minSample)}
      fields={<Field label="Policies before a percentage" htmlFor="scorecards-sample" hint="2 to 100"><input id="scorecards-sample" type="number" min={2} max={100} step={1} value={value} onChange={(e) => setValue(e.target.value)} className={control} /></Field>}
    />
  );
}

// ─── drill-through (4·5): the figure's rows, and a chart of them (owner 2026-11-12) ─────────────

/** What narrows a drill beyond its figure: the filters it was opened with, and its chart's bars (an issue period, a day, a kind). */
export type DrillNarrow = { key: string; label: string; value: string; kind?: "period" | "day" };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mar 2025" for a month key, the year itself for a year key. */
const periodLabel = (key: string) => (key.length === 7 ? `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : key);
const plusDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type DrillPolicy = { key: string; note: string; tone: "good" | "danger" | "plain"; clientName: string | null; carrierId: string; carrierName: string; policyNumber: string; status: string | null; issueDate: string | null; annualCents: number | null; agentName: string; sourceName: string };
type DrillEntry = { id: string; carrierName: string; policyNumber: string; type: string; countedOn: string; cents: number; fileId: string; rowNumber: number | null };

export function ScoreDrill({ policies, entries, tabs, show = "table", here, week, narrowed = [] }: {
  policies?: DrillPolicy[];
  entries?: DrillEntry[];
  tabs?: { active: string; items: Array<{ key: string; label: string; href: string; count?: number }> };
  /** The page's Table · Chart choice (a drill opens on its table). */
  show?: "table" | "chart";
  /** This drill's address without `show`: the filters, the drill and its narrowing, for the chart's links. */
  here?: string;
  /** The week drill's first day, for its chart's seven days. */
  week?: string;
  narrowed?: DrillNarrow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shownPolicies = useMemo(() => (policies ?? []).filter((p) => !needle || `${p.clientName ?? ""} ${p.policyNumber} ${p.carrierName}`.toLowerCase().includes(needle)), [policies, needle]);
  const shownEntries = useMemo(() => (entries ?? []).filter((e) => !needle || `${e.policyNumber} ${e.carrierName} ${e.type}`.toLowerCase().includes(needle)), [entries, needle]);
  const policyHeader = ["Client", "Carrier", "Policy number", "Status", "Issued", "Annualised premium", "Agent", "Lead source", "Why it counts"];
  const entryHeader = ["Counted on", "Carrier", "Policy number", "Type", "Amount"];
  const csvRows = policies
    ? shownPolicies.map((p) => [p.clientName, p.carrierName, p.policyNumber, statusLabel(p.status), p.issueDate, p.annualCents === null ? null : dollars(p.annualCents), p.agentName, p.sourceName, p.note])
    : shownEntries.map((e) => [e.countedOn, e.carrierName, e.policyNumber, e.type, dollars(e.cents)]);
  const total = policies ? shownPolicies.length : shownEntries.length;
  const all = policies ? policies.length : (entries ?? []).length;
  const policyHref = (p: DrillPolicy) => `/app/policies/carrier/${p.carrierId}/${encodeURIComponent(p.policyNumber)}`;
  const chipTone = (p: DrillPolicy): StatusTone => (p.tone === "good" ? "good" : p.tone === "danger" ? "danger" : "neutral");
  // The narrowing as chips; removing one opens the drill without it, in the view it is in.
  const narrowHref = (patch: Record<string, string | null>) => (here ? showHref(here, show, patch) : null);
  const chips: ActiveFilter[] = narrowed.map((n) => ({
    key: n.key, label: n.label, value: n.kind === "period" ? periodLabel(n.value) : n.kind === "day" ? readableDay(n.value) : n.value,
    onRemove: () => { const href = narrowHref({ [n.key]: null }); if (href) router.push(href); },
  }));
  const clearChips = () => { const href = narrowHref(Object.fromEntries(narrowed.map((n) => [n.key, null]))); if (href) router.push(href); };
  const corner = (
    <>
      {tabs && <ReportsSlot slot="lead"><ViewTabs label="Rows" active={tabs.active} tabs={tabs.items} /></ReportsSlot>}
      <ReportsSlot slot="corner">
        <Button type="button" variant="outline" disabled={!csvRows.length} onClick={() => downloadCsv({ name: "scorecard-rows", header: policies ? policyHeader : entryHeader, rows: csvRows })} title="The rows shown, as shown"><Download aria-hidden="true" />Export CSV</Button>
      </ReportsSlot>
    </>
  );
  if (show === "chart") {
    return (
      <>
        {corner}
        {chips.length > 0 && <Card className="gap-0 py-0"><ActiveFilters filters={chips} onClear={clearChips} className="border-b-0" /></Card>}
        {all === 0 ? <TableCard><EmptyState title="No rows behind this figure" hint="It may have changed since the page was opened; go back and open it again." /></TableCard>
          : policies ? <DrillPolicyCharts policies={policies} here={here ?? ""} />
          : <DrillWeekCharts entries={entries ?? []} here={here ?? ""} week={week} />}
      </>
    );
  }
  return (
    <>
    {corner}
    <PagedTableCard
      key={needle}
      total={total}
      noun="rows"
      toolbar={all || chips.length ? <>{all ? <div className="flex flex-wrap items-center gap-3 px-4 py-3"><ToolbarSearch value={search} onChange={setSearch} placeholder={policies ? "Search clients or policies" : "Search policies"} /></div> : null}<ActiveFilters filters={chips} onClear={clearChips} /></> : undefined}
      footer={<span>{count(total)} {total === 1 ? "row" : "rows"}{entries ? ` · ${centsText(shownEntries.reduce((sum, e) => sum + e.cents, 0))} in all · a row's source opens the carrier file row` : " · a row opens the policy · why it counts, the agent and the lead source are the row's tooltip"}</span>}
    >
      {all === 0 ? <EmptyState title="No rows behind this figure" hint="It may have changed since the page was opened; go back and open it again." /> : total === 0 ? <NoMatches noun="rows" by="search" /> : policies ? (
        <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead><tr><th>Client</th><th>Carrier</th><th className="w-[150px]">Policy</th><th className="w-[150px] text-right">Annual premium</th><th className="w-[120px]">Issued</th><th className="w-[160px]">Status</th></tr></thead>
          <PagedBody>
            {shownPolicies.map((p) => (
              <tr key={p.key} className="cursor-pointer" title={`${p.note} · ${p.agentName} · ${p.sourceName}`} onClick={() => router.push(policyHref(p))}>
                <td className="whitespace-nowrap font-semibold text-foreground"><Link href={policyHref(p)} className="hover:underline" onClick={(e) => e.stopPropagation()}>{p.clientName ?? "No client linked"}</Link></td>
                <td className="whitespace-nowrap">{p.carrierName}</td>
                <td className="whitespace-nowrap tabular-nums">{p.policyNumber}</td>
                <td className="text-right tabular-nums">{p.annualCents === null ? <Dash /> : centsText(p.annualCents)}</td>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{p.issueDate ? readableDay(p.issueDate) : "—"}</td>
                <td><StatusChip tone={chipTone(p)}>{statusLabel(p.status)}</StatusChip></td>
              </tr>
            ))}
          </PagedBody>
        </table>
      ) : (
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th className="w-[140px]">Counted on</th><th>Carrier</th><th className="w-[150px]">Policy</th><th className="w-[150px]">Kind</th><th className="w-[140px] text-right">Amount</th><th className="w-[110px]">Source</th></tr></thead>
          <PagedBody>
            {shownEntries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{readableDay(e.countedOn)}</td>
                <td className="whitespace-nowrap font-semibold text-foreground">{e.carrierName}</td>
                <td className="whitespace-nowrap tabular-nums">{e.policyNumber}</td>
                <td className="whitespace-nowrap">{e.type.replaceAll("_", " ")}</td>
                <td className="text-right tabular-nums">{centsText(e.cents)}</td>
                <td className="whitespace-nowrap">{e.rowNumber ? <Link href={rowHref(e.fileId, e.rowNumber)} className="hover:underline">Row {e.rowNumber} ›</Link> : <Link href={fileHref(e.fileId)} className="hover:underline">The file ›</Link>}</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
    </>
  );
}

/**
 * A policy drill's chart: its rows by carrier (each bar the drill narrowed to that carrier) and by issue period
 * (each bar the drill narrowed to it). A persistency drill draws the policies still in force inside each bar.
 */
function DrillPolicyCharts({ policies, here }: { policies: DrillPolicy[]; here: string }) {
  const toned = policies.some((p) => p.tone !== "plain");
  const good = (rows: DrillPolicy[]) => rows.filter((p) => p.tone === "good").length;
  const byCarrier = new Map<string, { name: string; rows: DrillPolicy[] }>();
  for (const p of policies) {
    const group = byCarrier.get(p.carrierId) ?? { name: p.carrierName, rows: [] };
    group.rows.push(p);
    byCarrier.set(p.carrierId, group);
  }
  const carriers = [...byCarrier.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length || a[1].name.localeCompare(b[1].name));
  const shown = carriers.slice(0, LIMIT);
  const issue = issuePeriods(policies);
  const unitWord = issue.unit === "month" ? "month" : "year";
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title={`By carrier · ${count(policies.length)} ${policies.length === 1 ? "policy" : "policies"}`} period={`${toned ? "Solid is still in force, pale lapsed" : "A bar opens its carrier's rows"}${carriers.length > LIMIT ? ` · the ${LIMIT} largest of ${carriers.length}` : ""}`} tableHref={showHref(here, "table")}>
        <BarList
          summary="The drill's policies by carrier"
          labelWidth="12rem"
          rows={shown.map(([id, g]): BarListRow => ({ key: id, label: g.name, value: g.rows.length, inner: toned ? good(g.rows) : undefined, caption: toned ? `${count(good(g.rows))} in force` : undefined, href: showHref(here, "table", { carrier: id }) }))}
        />
      </ChartCard>
      <ChartCard title={`By issue ${unitWord}`} period={`${toned ? "Solid is still in force · " : ""}a bar opens the policies issued in it${issue.undated ? ` · ${count(issue.undated)} with no issue date not drawn` : ""}`} tableHref={showHref(here, "table")}>
        {issue.periods.length ? (
          <BarSeries
            summary={`The drill's policies by issue ${unitWord}`}
            unit="policies"
            minHeight={200}
            bars={issue.periods.map((p) => ({ key: p.key, label: periodLabel(p.key), value: p.rows.length, accent: toned ? good(p.rows) : undefined }))}
            names={toned ? { value: "Policies", accent: "Still in force" } : { value: "Policies" }}
            hrefFor={(bar) => (bar.value ? showHref(here, "table", { issued: bar.key }) : null)}
          />
        ) : <EmptyState title="No issue dates on file" hint="The carrier file lists no issue date for these policies." />}
      </ChartCard>
    </div>
  );
}

/**
 * The week drill's chart: the week's lines by day, money in above the line and money out (chargebacks, fees,
 * reversals) under it, and the same lines by kind. Each bar narrows the table to its day or its kind.
 */
function DrillWeekCharts({ entries, here, week }: { entries: DrillEntry[]; here: string; week?: string }) {
  const dayOf = (e: DrillEntry) => e.countedOn.slice(0, 10);
  const days = [...new Set([...(week ? Array.from({ length: 7 }, (_, i) => plusDays(week, i)) : []), ...entries.map(dayOf)])].sort();
  const inOn = (rows: DrillEntry[]) => rows.reduce((sum, e) => sum + Math.max(0, e.cents), 0);
  const outOn = (rows: DrillEntry[]) => rows.reduce((sum, e) => sum + Math.max(0, -e.cents), 0);
  const kinds = new Map<string, DrillEntry[]>();
  for (const e of entries) kinds.set(e.type, [...(kinds.get(e.type) ?? []), e]);
  const kindRows = [...kinds.entries()].map(([type, rows]) => ({ type, rows, cents: rows.reduce((sum, e) => sum + e.cents, 0) })).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const net = entries.reduce((sum, e) => sum + e.cents, 0);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title={`By day · ${centsText(net)} net`} period="Money in above the line, chargebacks and fees under it · a day opens its lines" tableHref={showHref(here, "table")}>
        <BarSeries
          summary="The week's commission lines by day: money in above the line, money out under it"
          format={axisDollars}
          minHeight={200}
          labels="all"
          bars={days.map((day) => { const rows = entries.filter((e) => dayOf(e) === day); return { key: day, label: reportDay(day), value: inOn(rows), below: outOn(rows) }; })}
          names={{ value: "Money in", below: "Chargebacks and fees" }}
          legend={[
            { key: "in", label: "Money in", tone: "strong", figure: centsText(inOn(entries)) },
            { key: "out", label: "Chargebacks and fees", tone: "warning", figure: centsText(-outOn(entries)), href: kinds.has("chargeback") ? showHref(here, "table", { kind: "chargeback" }) : undefined },
          ]}
          hrefFor={(bar) => (entries.some((e) => dayOf(e) === bar.key) ? showHref(here, "table", { day: bar.key }) : null)}
        />
      </ChartCard>
      <ChartCard title="By kind" period="Net of each kind of line · a bar opens its lines" tableHref={showHref(here, "table")}>
        <BarList
          summary="The week's commission lines by kind"
          format={centsText}
          labelWidth="12rem"
          rows={kindRows.map((k): BarListRow => ({ key: k.type, label: k.type.replaceAll("_", " "), value: k.cents, caption: `${count(k.rows.length)} ${k.rows.length === 1 ? "line" : "lines"}`, href: showHref(here, "table", { kind: k.type }) }))}
          total={{ label: "The week", figure: centsText(net), caption: `${count(entries.length)} ${entries.length === 1 ? "line" : "lines"}` }}
        />
      </ChartCard>
    </div>
  );
}
