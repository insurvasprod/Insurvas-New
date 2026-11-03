"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { ViewTabs } from "@/components/app/book-of-business-views";
import { InReportsSlot, ReportsSlot } from "@/components/app/reports/reports-slot";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, control } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { QUIET_DAY, type SummaryInput } from "@/lib/ingestion/dailySummary";
import { readableDay, statusLabel, toCsv } from "@/lib/ingestion/policyBook";
import {
  CONTRACT_MONTH, CONTRACT_SHARE_PCT, DIMENSION_LABELS, centsText, chargebackText, costPerSale, drillParam, percentOf, persistencyText, shareText, trueCostPerSale, wholeDollars,
  type Bucket, type Dimension, type Drill, type Slicing, type WeekRow,
} from "@/lib/ingestion/scorecards";
import { fileHref, rowHref } from "@/lib/ingestion/trace";
import { reportDay, reportPeriod } from "@/lib/reports/periodText";
import { notify } from "@/lib/notify";

/**
 * LA-4.18 (Notion sprint) · the book scorecards. Three views (overview, persistency, scorecards), each
 * table with its CSV of exactly what is on screen, and every figure a link to the rows behind it.
 * A share under the agency's sample size prints as a count; a persistency bucket the book's history
 * can't fill yet prints "Building".
 */

export type CellView = { month: Bucket; building: boolean; readyOn: string | null; eligible: number; alive: number; premiumEligibleCents: number; premiumAliveCents: number; premiumUnknown: number; endUnknown: number };
type SliceView = { key: string; name: string; policies: number; inForce: number; annualCents: number; inForceCents: number; annualUnknown: number };
type ChargebackView = { key: string; name: string; advancedCents: number; chargedBackCents: number; advancedPolicies: number; earlierCents: number };
type CardView = { key: string; name: string; policies: number; inForce: number; annualCents: number; issued: number; placed: number; contract: CellView; advancedCents: number; chargedBackCents: number; advancedPolicies: number; netCents: number; netKnown: boolean; spendCents?: number | null; sales?: number };

export type ScorecardsView = {
  view: "book" | "persistency" | "chargebacks" | "weeks" | "scorecards" | "today";
  months: number;
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
  persistencyBy: Record<Dimension, Array<{ key: string; name: string; policies: number; cells: CellView[] }>>;
  cards: Record<Dimension, CardView[]>;
  spendAvailable: boolean;
  buckets: number[];
};

const count = (n: number) => n.toLocaleString("en-US");
const dollars = (cents: number) => (cents / 100).toFixed(2);

function downloadCsv(name: string, header: string[], rows: Array<Array<string | number | null>>) {
  const blob = new Blob([`﻿${toCsv(header, rows)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function CsvButton({ name, header, rows }: { name: string; header: string[]; rows: Array<Array<string | number | null>> }) {
  return <Button type="button" variant="outline" disabled={!rows.length} onClick={() => downloadCsv(name, header, rows)} title="The rows shown, as shown"><Download aria-hidden="true" />Export CSV</Button>;
}

function SliceTabs<K extends string>({ label, value, options, onChange }: { label: string; value: K; options: readonly K[]; onChange: (k: K) => void }) {
  return <ViewTabs label={label} active={value} onChange={onChange} tabs={options.map((key) => ({ key, label: DIMENSION_LABELS[key as unknown as Slicing] ?? key }))} />;
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

/**
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx): the views go to its top row,
 * the period and the sample size to its corner.
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): Overview stacked five cards (today, the
 * book, placement, chargebacks, net by week); each list is its own tab now, one at a time, and the strip's
 * tiles are the links. Placement's one-row table is the Placed tile, whose rows open as Placed · Issued ·
 * Never paid. The sample size is a confirm pop-up under More, not a form in a toolbar.
 */
export function BookScorecards({ model, framed = false }: { model: ScorecardsView; framed?: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [sampleOpen, setSampleOpen] = useState(false);
  const base = `/app/book-scorecards?view=${model.view}&months=${model.months}`;
  const drillHref = (d: Drill) => `${base}&drill=${encodeURIComponent(drillParam(d))}`;
  const Fig = ({ d, children }: { d: Drill; children: ReactNode }) => <Link href={drillHref(d)} className="tabular-nums underline-offset-2 hover:underline">{children}</Link>;
  const refresh = <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />;
  const viewHref = (view: ScorecardsView["view"]) => `/app/book-scorecards?view=${view}&months=${model.months}`;

  const top = (
    <>
      <InReportsSlot framed={framed} slot="lead">
        <ViewTabs label="Scorecard views" active={model.view} tabs={BOOK_TABS.map((t) => ({ key: t.key, label: t.label, href: viewHref(t.key) }))} />
      </InReportsSlot>
      <InReportsSlot framed={framed} slot="corner">
        <select aria-label="Period" className={toolbarControl} value={model.months} onChange={(e) => router.push(`/app/book-scorecards?view=${model.view}&months=${e.target.value}`)}>
          {model.periods.map((m) => <option key={m} value={m}>Last {m} months</option>)}
        </select>
        {model.canEditSettings && <MoreMenu items={[{ label: "Sample size", onSelect: () => setSampleOpen(true) }]} />}
      </InReportsSlot>
      {model.canEditSettings && <SampleSize model={model} open={sampleOpen} onOpenChange={setSampleOpen} />}
    </>
  );

  if (model.policies === 0) {
    return <>{top}<TableCard><EmptyState title="No policies in your carrier files yet" hint="Figures appear once a carrier's policy file has been read." /></TableCard></>;
  }

  const parts = { model, Fig, refresh };
  return (
    <>
      {top}
      {model.view === "persistency" ? null : <BookStrip model={model} drillHref={drillHref} viewHref={viewHref} />}
      {model.view === "book" && <Book {...parts} />}
      {model.view === "chargebacks" && <Chargebacks {...parts} />}
      {model.view === "weeks" && <Weeks {...parts} />}
      {model.view === "today" && <Today model={model} />}
      {model.view === "persistency" && <Persistency {...parts} />}
      {model.view === "scorecards" && <Cards {...parts} />}
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

type Parts = { model: ScorecardsView; Fig: (props: { d: Drill; children: ReactNode }) => ReactNode; refresh: ReactNode };

// ─── the strip ────────────────────────────────────────────────────────────────────────────────

/** The book's four headline figures, each the link to its rows or its tab (owner 2026-11-02). */
function BookStrip({ model, drillHref, viewHref }: { model: ScorecardsView; drillHref: (d: Drill) => string; viewHref: (v: ScorecardsView["view"]) => string }) {
  const m9 = model.overall.find((c) => c.month === CONTRACT_MONTH) as CellView;
  const cbAll = model.chargebacks.all[0];
  const pl = model.placement;
  return (
    <StatStrip label="Book">
      {/* The live book: in-force premium, opening the policies in force. */}
      <StatTile label="In-force premium" value={model.whole ? centsText(model.whole.inForceCents) : "—"} href={model.whole ? drillHref({ kind: "book", dim: "all", key: "all", live: true }) : undefined} footnote={model.whole ? `${count(model.whole.inForce)} of ${count(model.whole.policies)} policies in force · ${centsText(model.whole.annualCents)} across all${model.whole.annualUnknown ? ` · ${model.whole.annualUnknown} with no premium on file` : ""}` : undefined} />
      <StatTile label={`Month-${CONTRACT_MONTH} persistency`} value={persistencyText(m9, "count", model.minSample)} href={viewHref("persistency")} valueTone={!m9.building && m9.eligible >= model.minSample ? (percentOf(m9.alive, m9.eligible) < CONTRACT_SHARE_PCT ? "danger" : "good") : undefined} footnote={m9.building ? cellTitle(m9, model.minSample) : `carriers look for ${CONTRACT_SHARE_PCT}%`} />
      {/* Placement (issued and paid at least once) and its gap: the tile opens Placed · Issued · Never paid. */}
      <StatTile label="Placed" value={pl.issued ? shareText(pl.placed, pl.issued, model.minSample) : "—"} href={pl.issued ? drillHref({ kind: "placement", set: "placed" }) : undefined} footnote={pl.issued ? `${count(pl.placed)} of ${count(pl.issued)} issued paid at least once · ${count(pl.notPlaced)} never paid` : "nothing issued in the period"} />
      <StatTile label="Chargeback ratio" value={cbAll ? chargebackText(cbAll, model.minSample) ?? "Building" : "—"} href={viewHref("chargebacks")} footnote={cbAll ? `${centsText(cbAll.chargedBackCents)} back of ${centsText(cbAll.advancedCents)} advanced${chargebackText(cbAll, model.minSample) ? "" : ` · a ratio needs ${model.minSample} policies`}${cbAll.earlierCents ? ` · ${centsText(cbAll.earlierCents)} more on advances paid before your first statement` : ""}` : "no advance on file yet"} />
    </StatStrip>
  );
}

// ─── book ─────────────────────────────────────────────────────────────────────────────────────

function Book({ model, Fig, refresh }: Parts) {
  const [bookDim, setBookDim] = useState<keyof ScorecardsView["book"]>("carrier");
  const book = model.book[bookDim];
  return (
    <PagedTableCard key={`book-${bookDim}`} total={book.length} noun="rows" toolbar={<DataToolbar actions={<><CsvButton name={`book-by-${bookDim}`} header={[DIMENSION_LABELS[bookDim], "Policies", "In force", "In-force premium", "Premium, all policies", "No premium on file"]} rows={book.map((s) => [bookDim === "status" ? statusLabel(s.key) : s.name, s.policies, s.inForce, dollars(s.inForceCents), dollars(s.annualCents), s.annualUnknown])} />{refresh}</>}><SliceTabs label="Book by" value={bookDim} options={["carrier", "product", "status", "agent", "agency"] as const} onChange={setBookDim} /></DataToolbar>}>
      <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
        <thead><tr><th>{DIMENSION_LABELS[bookDim]}</th><th className="w-[110px] text-right">Policies</th><th className="w-[110px] text-right">In force</th><th className="w-[170px] text-right">In-force premium</th><th className="w-[170px] text-right">Premium, all policies</th></tr></thead>
        <PagedBody>
          {book.map((s) => (
            <tr key={s.key}>
              <td className="font-semibold text-foreground">{bookDim === "status" ? statusLabel(s.key) : s.name}</td>
              <td className="text-right"><Fig d={{ kind: "book", dim: bookDim, key: s.key }}>{count(s.policies)}</Fig></td>
              <td className="text-right tabular-nums">{count(s.inForce)}</td>
              <td className="text-right font-semibold">{s.inForce ? <Fig d={{ kind: "book", dim: bookDim, key: s.key, live: true }}>{centsText(s.inForceCents)}</Fig> : <span className="text-muted-foreground">—</span>}</td>
              <td className="text-right tabular-nums text-muted-foreground">{centsText(s.annualCents)}{s.annualUnknown ? <span className="block text-xs">{s.annualUnknown} with no premium on file</span> : null}</td>
            </tr>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );
}

// ─── chargebacks ──────────────────────────────────────────────────────────────────────────────

function Chargebacks({ model, Fig, refresh }: Parts) {
  const [cbDim, setCbDim] = useState<Dimension>("carrier");
  const cbRows = model.chargebacks[cbDim];
  return (
    <PagedTableCard key={`chargebacks-${cbDim}`} total={cbRows.length} noun="rows" toolbar={<DataToolbar actions={<><CsvButton name={`chargebacks-by-${cbDim}`} header={[DIMENSION_LABELS[cbDim], "Advanced", "Charged back", "Policies advanced", "Ratio", "Charged back on earlier advances"]} rows={cbRows.map((r) => [r.name, dollars(r.advancedCents), dollars(r.chargedBackCents), r.advancedPolicies, chargebackText(r, model.minSample), dollars(r.earlierCents)])} />{refresh}</>}><SliceTabs label="Chargebacks by" value={cbDim} options={["carrier", "product", "agent", "source"] as const} onChange={setCbDim} /></DataToolbar>} footer={<span>Counts only chargebacks on advances on file; the rest is shown apart, as earlier advances</span>}>
      {cbRows.length === 0 ? <EmptyState title="No advances on file yet" hint="The ratio appears once a commission file with advances has been read." /> : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th>{DIMENSION_LABELS[cbDim]}</th><th className="w-[150px] text-right">Advanced</th><th className="w-[150px] text-right">Charged back</th><th className="w-[120px] text-right">Ratio</th></tr></thead>
          <PagedBody>
            {cbRows.map((r) => (
              <tr key={r.key}>
                <td className="font-semibold text-foreground">{r.name}</td>
                <td className="text-right tabular-nums">{centsText(r.advancedCents)}<span className="block text-xs text-muted-foreground">{count(r.advancedPolicies)} {r.advancedPolicies === 1 ? "policy" : "policies"}</span></td>
                <td className="text-right tabular-nums">{centsText(r.chargedBackCents)}{r.earlierCents ? <span className="block text-xs text-muted-foreground" title="Chargebacks on advances paid before your first statement: real money, but outside the ratio">+{centsText(r.earlierCents)} on earlier advances</span> : null}</td>
                <td className="text-right"><Fig d={{ kind: "chargeback", dim: cbDim, key: r.key }}>{chargebackText(r, model.minSample) ?? <span className="text-muted-foreground" title={`A ratio needs ${model.minSample} advanced policies; ${r.advancedPolicies} so far`}>—<span className="block text-xs">needs {model.minSample} policies</span></span>}</Fig></td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

// ─── net by week ──────────────────────────────────────────────────────────────────────────────

function Weeks({ model, Fig, refresh }: Parts) {
  const weeks = model.weeks ?? [];
  return (
    <PagedTableCard total={weeks.length} noun="weeks" toolbar={<DataToolbar actions={<><CsvButton name="net-commission-by-week" header={["Week of", "Advances", "Earned and overrides", "Chargebacks", "Fees and interest", "Other", "Net", "Held"]} rows={weeks.map((w) => [w.week, dollars(w.parts.advance), dollars(w.parts.earned + w.parts.override), dollars(w.parts.chargeback), dollars(w.parts.fee + w.parts.advance_interest), dollars(w.parts.other), dollars(w.netCents), dollars(w.heldCents)])} />{refresh}</>}><span className="text-sm text-muted-foreground">This week and the 13 before it</span></DataToolbar>} footer={<span>Advances and earned, less chargebacks, fees and advance interest · held money is shown apart: it hasn&rsquo;t been paid</span>}>
      {model.weeks === null ? <EmptyState title="Not available yet" hint="This needs a database update (20261008270000)." /> : !weeks.some((w) => w.entries > 0) ? <EmptyState title="No commission lines in the last 13 weeks" hint="Weeks appear once a commission file has been read." /> : (
        <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
          <thead><tr><th>Week of</th><th className="text-right">Advances</th><th className="text-right">Earned</th><th className="text-right">Chargebacks</th><th className="text-right">Fees and interest</th><th className="text-right">Net</th><th className="text-right">Held</th></tr></thead>
          <PagedBody>
            {weeks.map((w) => w.entries === 0 ? (
              // A week with no ledger line: listed so the run of weeks has no gaps, with nothing to open.
              <tr key={w.week} className="text-muted-foreground">
                <td>{readableDay(w.week)}</td>
                <td colSpan={6} className="text-right text-xs">No commission lines this week</td>
              </tr>
            ) : (
              <tr key={w.week}>
                <td className="font-semibold text-foreground">{readableDay(w.week)}</td>
                <td className="text-right tabular-nums">{centsText(w.parts.advance)}</td>
                <td className="text-right tabular-nums">{centsText(w.parts.earned + w.parts.override)}</td>
                <td className="text-right tabular-nums">{centsText(w.parts.chargeback)}</td>
                <td className="text-right tabular-nums">{centsText(w.parts.fee + w.parts.advance_interest)}</td>
                <td className="text-right font-semibold"><Fig d={{ kind: "week", week: w.week }}>{centsText(w.netCents)}</Fig></td>
                <td className="text-right tabular-nums text-muted-foreground">{w.heldCents ? centsText(w.heldCents) : "—"}</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

// ─── today ────────────────────────────────────────────────────────────────────────────────────

/** Today's summary (LA-4.18): only facts from its own input, each linked through; says so when the day was quiet. */
function Today({ model }: { model: ScorecardsView }) {
  return (
    <PagedTableCard total={model.summary.facts.length} noun="items" footer={<span>{readableDay(model.summary.date)}</span>}>
      {model.summary.facts.length === 0 ? <EmptyState title="Nothing notable today" hint={QUIET_DAY} /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>What happened</th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
          <PagedBody>
            {model.summary.facts.map((f) => <tr key={f.id}><td className="text-foreground">{f.text}</td><td className="text-right"><Button asChild size="sm" variant="outline"><Link href={f.href}>Open</Link></Button></td></tr>)}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

// ─── persistency ──────────────────────────────────────────────────────────────────────────────

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
      description="Under this many policies, a share shows as a count, never a percentage. It applies to every figure on Book scorecards."
      confirmLabel="Save"
      confirmDisabled={!valid || value === String(model.minSample)}
      fields={<Field label="Policies a percentage needs" htmlFor="scorecards-sample" hint="2 to 100"><input id="scorecards-sample" type="number" min={2} max={100} step={1} value={value} onChange={(e) => setValue(e.target.value)} className={control} /></Field>}
    />
  );
}

function Persistency({ model, Fig, refresh }: Parts) {
  const [dim, setDim] = useState<Dimension>("carrier");
  const [by, setBy] = useState<"count" | "premium">("count");
  const rows = [{ key: "", name: "Whole book", policies: model.policies, cells: model.overall, all: true }, ...model.persistencyBy[dim].map((r) => ({ ...r, all: false }))];
  const cell = (c: CellView, key: string, all: boolean) => {
    const text = persistencyText(c, by, model.minSample);
    const tone = !c.building && c.eligible >= model.minSample && c.month === CONTRACT_MONTH && percentOf(c.alive, c.eligible) < CONTRACT_SHARE_PCT ? "font-semibold text-[var(--error-ink)]" : "";
    if (c.building || !c.eligible) return <span className="text-muted-foreground" title={cellTitle(c, model.minSample)}>{c.building ? "Building" : "—"}</span>;
    return <span title={cellTitle(c, model.minSample)} className={tone}><Fig d={{ kind: "persistency", month: c.month, dim: all ? "all" : dim, key }}>{text}</Fig></span>;
  };
  return (
    <>
      <StatStrip label="Persistency">
        {model.overall.map((c) => (
          <StatTile key={c.month} label={`Month ${c.month}`} value={c.building || !c.eligible ? <span className="text-muted-foreground">{c.building ? "Building" : "—"}</span> : <Fig d={{ kind: "persistency", month: c.month, dim: "all", key: "" }}>{persistencyText(c, "count", model.minSample)}</Fig>}
            footnote={c.building ? cellTitle(c, model.minSample) : c.eligible ? `${persistencyText(c, "premium", model.minSample)} by premium${c.premiumUnknown ? ` · ${c.premiumUnknown} with no premium` : ""}` : "none old enough yet"} />
        ))}
      </StatStrip>
      <PagedTableCard
        key={dim}
        total={rows.length}
        noun="rows"
        suffix={model.history.fromFirstFile.length ? `${model.history.fromFirstFile.length} ${model.history.fromFirstFile.length === 1 ? "carrier" : "carriers"} counted from their first file` : undefined}
        toolbar={
          <DataToolbar actions={<><CsvButton name={`persistency-by-${dim}-${by}`} header={[DIMENSION_LABELS[dim], "Policies", ...model.buckets.map((b) => `Month ${b} (${by})`)]} rows={rows.map((r) => [r.name, r.policies, ...r.cells.map((c) => persistencyText(c, by, model.minSample))])} />{refresh}</>}>
            <SliceTabs label="Persistency by" value={dim} options={["carrier", "product", "agent", "agency", "source"] as const} onChange={setDim} />
            <ViewTabs label="Measured by" active={by} onChange={setBy} tabs={[{ key: "count", label: "By policies" }, { key: "premium", label: "By premium" }]} />
            <span className="text-sm text-muted-foreground">A percentage needs {model.minSample} policies</span>
          </DataToolbar>
        }
        footer={<span>{historyNote(model.history)}</span>}
      >
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th>{DIMENSION_LABELS[dim]}</th><th className="w-[96px] text-right">Policies</th>{model.buckets.map((b) => <th key={b} className="w-[120px] text-right">Month {b}</th>)}</tr></thead>
          <PagedBody>
            {rows.map((r) => (
              <tr key={`${r.all}-${r.key}`}>
                <td className={r.all ? "font-semibold text-foreground" : "text-foreground"}>{r.name}</td>
                <td className="text-right tabular-nums">{count(r.policies)}</td>
                {r.cells.map((c) => <td key={c.month} className="text-right">{cell(c, r.key, r.all)}</td>)}
              </tr>
            ))}
          </PagedBody>
        </table>
      </PagedTableCard>
    </>
  );
}

// ─── scorecards ───────────────────────────────────────────────────────────────────────────────

function Cards({ model, Fig, refresh }: Parts) {
  const [dim, setDim] = useState<Dimension>("source");
  const rows = model.cards[dim];
  const source = dim === "source";
  const m9 = (c: CardView) => persistencyText(c.contract, "count", model.minSample);
  const header = source
    ? ["Lead source", "Spend", "Sales", "Cost per sale", `Month-${CONTRACT_MONTH} persistency`, "True cost per sale", "Policies", "Chargeback ratio", "Net commission"]
    : [DIMENSION_LABELS[dim], "Policies", "In force", "Annualised premium", "Placed", `Month-${CONTRACT_MONTH} persistency`, "Chargeback ratio", "Net commission"];
  const csv = rows.map((c) => {
    const cb = chargebackText(c, model.minSample);
    if (source) {
      const cps = costPerSale(c.spendCents, c.sales);
      const tcs = trueCostPerSale(c.spendCents, c.sales, c.contract, model.minSample);
      return [c.name, c.spendCents == null ? null : dollars(c.spendCents), c.sales ?? 0, cps === null ? null : dollars(cps), m9(c), tcs === null ? null : dollars(tcs), c.policies, cb, c.netKnown ? dollars(c.netCents) : null];
    }
    return [c.name, c.policies, c.inForce, dollars(c.annualCents), c.issued ? shareText(c.placed, c.issued, model.minSample) : null, m9(c), cb, c.netKnown ? dollars(c.netCents) : null];
  });
  const persist = (c: CardView) => (c.contract.building || !c.contract.eligible
    ? <span className="text-muted-foreground" title={cellTitle(c.contract, model.minSample)}>{c.contract.building ? "Building" : "—"}</span>
    : <Fig d={{ kind: "persistency", month: CONTRACT_MONTH, dim, key: c.key }}>{m9(c)}</Fig>);
  const cbCell = (c: CardView) => (c.advancedCents || c.chargedBackCents ? <Fig d={{ kind: "chargeback", dim, key: c.key }}>{chargebackText(c, model.minSample) ?? `${centsText(c.chargedBackCents)} back`}</Fig> : <span className="text-muted-foreground">—</span>);

  return (
    <PagedTableCard
      key={dim}
      total={rows.length}
      noun="rows"
      suffix={source ? (model.scoped ? "spend is the agency's and isn't shown on a producer's own scorecard" : !model.spendAvailable ? "lead spend isn't available right now" : `spend and sales: ${reportPeriod(model.period.from, model.period.to)} · true cost per sale = spend ÷ (sales × month-${CONTRACT_MONTH} persistency)`) : undefined}
      toolbar={<DataToolbar actions={<><CsvButton name={`scorecard-by-${dim}`} header={header} rows={csv} />{refresh}</>}><SliceTabs label="Scorecard by" value={dim} options={["source", "carrier", "product", "agent", "agency"] as const} onChange={setDim} /></DataToolbar>}
      footer={source ? <span>{model.scoped ? "Spend is the agency's and isn't shown on a producer's own scorecard." : !model.spendAvailable ? "Lead spend isn't available right now; refresh to try again." : `Spend and sales: ${reportPeriod(model.period.from, model.period.to)} · true cost per sale = spend ÷ (sales × month-${CONTRACT_MONTH} persistency).`}</span> : undefined}
    >
      {rows.length === 0 ? <EmptyState title="Nothing to score yet" hint="Rows appear once policies are in your carrier files." /> : (
        <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead><tr>{header.map((h, i) => <th key={h} className={i === 0 ? "" : "text-right"}>{h}</th>)}</tr></thead>
          <PagedBody>
            {rows.map((c) => {
              if (source) {
                const cps = costPerSale(c.spendCents, c.sales);
                const tcs = trueCostPerSale(c.spendCents, c.sales, c.contract, model.minSample);
                return (
                  <tr key={c.key}>
                    <td className="font-semibold text-foreground">{c.name}</td>
                    <td className="text-right tabular-nums">{c.spendCents == null ? <span className="text-muted-foreground">—</span> : wholeDollars(c.spendCents)}</td>
                    <td className="text-right">{c.sales ? <Fig d={{ kind: "sales", key: c.key }}>{count(c.sales)}</Fig> : <span className="tabular-nums">0</span>}</td>
                    <td className="text-right tabular-nums">{cps === null ? <span className="text-muted-foreground">—</span> : wholeDollars(cps)}</td>
                    <td className="text-right">{persist(c)}</td>
                    <td className="text-right font-semibold tabular-nums">{tcs === null ? <span className="font-normal text-muted-foreground" title={c.contract.building ? cellTitle(c.contract, model.minSample) : `Needs spend, sales, and month-${CONTRACT_MONTH} persistency on ${model.minSample} policies`}>—</span> : wholeDollars(tcs)}</td>
                    <td className="text-right"><Fig d={{ kind: "book", dim, key: c.key }}>{count(c.policies)}</Fig></td>
                    <td className="text-right">{cbCell(c)}</td>
                    <td className="text-right tabular-nums">{c.netKnown ? centsText(c.netCents) : <span className="text-muted-foreground" title="No commission line for these policies is on file yet">—</span>}</td>
                  </tr>
                );
              }
              return (
                <tr key={c.key}>
                  <td className="font-semibold text-foreground">{c.name}</td>
                  <td className="text-right"><Fig d={{ kind: "book", dim, key: c.key }}>{count(c.policies)}</Fig></td>
                  <td className="text-right tabular-nums">{count(c.inForce)}</td>
                  <td className="text-right tabular-nums">{centsText(c.annualCents)}</td>
                  <td className="text-right tabular-nums">{c.issued ? shareText(c.placed, c.issued, model.minSample) : "—"}</td>
                  <td className="text-right">{persist(c)}</td>
                  <td className="text-right">{cbCell(c)}</td>
                  <td className="text-right tabular-nums">{c.netKnown ? centsText(c.netCents) : <span className="text-muted-foreground" title="No commission line for these policies is on file yet">—</span>}</td>
                </tr>
              );
            })}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

// ─── drill-through ────────────────────────────────────────────────────────────────────────────

type DrillPolicy = { key: string; note: string; tone: "good" | "danger" | "plain"; clientName: string | null; carrierId: string; carrierName: string; policyNumber: string; status: string | null; issueDate: string | null; annualCents: number | null; agentName: string; sourceName: string };
type DrillEntry = { id: string; carrierName: string; policyNumber: string; type: string; countedOn: string; cents: number; fileId: string; rowNumber: number | null };

export function ScoreDrill({ policies, entries, tabs }: { policies?: DrillPolicy[]; entries?: DrillEntry[]; tabs?: { active: string; items: Array<{ key: string; label: string; href: string }> } }) {
  const policyHeader = ["Client", "Carrier", "Policy number", "Status", "Issued", "Annualised premium", "Agent", "Lead source", "Why it counts"];
  const entryHeader = ["Counted on", "Carrier", "Policy number", "Type", "Amount"];
  const rows = policies
    ? policies.map((p) => [p.clientName, p.carrierName, p.policyNumber, statusLabel(p.status), p.issueDate, p.annualCents === null ? null : dollars(p.annualCents), p.agentName, p.sourceName, p.note])
    : (entries ?? []).map((e) => [e.countedOn, e.carrierName, e.policyNumber, e.type, dollars(e.cents)]);
  const total = (entries ?? []).reduce((sum, e) => sum + e.cents, 0);
  return (
    <>
    {tabs && <ReportsSlot slot="lead"><ViewTabs label="Rows" active={tabs.active} tabs={tabs.items} /></ReportsSlot>}
    <PagedTableCard
      total={rows.length}
      noun="rows"
      toolbar={<DataToolbar actions={<CsvButton name="scorecard-rows" header={policies ? policyHeader : entryHeader} rows={rows} />}><span className="text-sm text-muted-foreground">{count(rows.length)} {rows.length === 1 ? "row" : "rows"}{entries ? ` · ${centsText(total)} in all` : ""}</span></DataToolbar>}
    >
      {rows.length === 0 ? <EmptyState title="No rows behind this figure" hint="It may have changed since the page was opened; go back and open it again." /> : policies ? (
        <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead><tr><th>Client</th><th>Carrier · policy</th><th className="w-[120px]">Status</th><th className="w-[120px]">Issued</th><th className="w-[140px] text-right">Annualised premium</th><th>Why it counts</th></tr></thead>
          <PagedBody>
            {policies.map((p) => (
              <tr key={p.key}>
                <td className="font-semibold text-foreground">{p.clientName ?? <span className="font-normal text-muted-foreground">No client linked</span>}<span className="block text-xs font-normal text-muted-foreground">{p.agentName} · {p.sourceName}</span></td>
                <td><Link href={`/app/policies/carrier/${p.carrierId}/${encodeURIComponent(p.policyNumber)}`} className="hover:underline">{p.carrierName} · {p.policyNumber}</Link></td>
                <td>{statusLabel(p.status)}</td>
                <td className="tabular-nums">{p.issueDate ? readableDay(p.issueDate) : "—"}</td>
                <td className="text-right tabular-nums">{p.annualCents === null ? "—" : centsText(p.annualCents)}</td>
                <td>{p.tone === "plain" ? p.note : <StatusChip tone={p.tone === "good" ? "good" : "danger"}>{p.note}</StatusChip>}</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead><tr><th className="w-[140px]">Counted on</th><th>Carrier · policy</th><th>Type</th><th className="w-[140px] text-right">Amount</th><th className="w-[110px]">Source</th></tr></thead>
          <PagedBody>
            {(entries ?? []).map((e) => (
              <tr key={e.id}>
                <td className="tabular-nums">{readableDay(e.countedOn)}</td>
                <td>{e.carrierName} · {e.policyNumber}</td>
                <td>{e.type.replaceAll("_", " ")}</td>
                <td className="text-right tabular-nums">{centsText(e.cents)}</td>
                <td className="text-xs">{e.rowNumber ? <Link href={rowHref(e.fileId, e.rowNumber)} className="text-[var(--accent-ink)] hover:underline">Row {e.rowNumber}</Link> : <Link href={fileHref(e.fileId)} className="text-[var(--accent-ink)] hover:underline">The file</Link>}</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
    </>
  );
}
