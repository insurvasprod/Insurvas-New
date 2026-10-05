"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { dayMonth, localDay, type QuoteOutcome, type QuoteRow } from "@/lib/applications/listRules";
import { premiumPer1000 } from "@/lib/quotes/math";
import { caseHref, clientLinkClass, useLiveRefresh } from "./applications-list";
import { face, money, SampleDataNotice } from "./parts";

const OUTCOME: Record<QuoteOutcome, { label: string; tone: StatusTone }> = {
  selected: { label: "Selected", tone: "good" },
  superseded: { label: "Superseded", tone: "info" },
  presented: { label: "Presented", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  discarded: { label: "Discarded", tone: "neutral" },
};
const OUTCOMES: QuoteOutcome[] = ["selected", "superseded", "presented", "draft", "discarded"];

const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const per1000 = (row: QuoteRow) => premiumPer1000(row.monthlyPremiumCents, row.faceAmountCents);
const dollars = (value: number | null) => (value === null ? "—" : `$${value.toFixed(2)}`);
const average = (values: number[]) => (values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null);

export function QuotesList({ rows: initialRows, sample = false, timeZone = "UTC" }: { rows: QuoteRow[]; sample?: boolean; timeZone?: string }) {
  const [rows, setRows] = useState(initialRows);
  const [range, setRange] = useState<RangeKey>("30");
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<"all" | QuoteOutcome>("all");
  const [carrier, setCarrier] = useState("all");
  const [product, setProduct] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [now] = useState(() => Date.now());
  const pick = useCallback((body: unknown) => (body as { quotes?: QuoteRow[] } | null)?.quotes ?? null, []);
  const { refresh, refreshing, error } = useLiveRefresh({ sample, url: "/api/app/quotes", pick, apply: setRows });

  const carriers = useMemo(() => [...new Set(rows.map((row) => row.carrierName))].sort(), [rows]);
  const products = useMemo(() => [...new Set(rows.map((row) => row.productLabel))].sort(), [rows]);
  const sorted = useMemo(() => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.clientName.localeCompare(b.clientName)), [rows]);
  const days = RANGES.find((r) => r.key === range)?.days ?? null;
  const since = days === null ? null : localDay(new Date(now - (days - 1) * 86_400_000).toISOString(), timeZone);

  const needle = search.trim().toLowerCase();
  const shown = sorted.filter((row) =>
    (since === null || localDay(row.createdAt, timeZone) >= since)
    && (outcome === "all" || row.outcome === outcome)
    && (carrier === "all" || row.carrierName === carrier)
    && (product === "all" || row.productLabel === product)
    && (!needle || [row.clientName, row.carrierName, row.productLabel].some((value) => value.toLowerCase().includes(needle))));
  const { current, rows: pageRows } = paginate(shown, page);
  const panelCount = (outcome !== "all" ? 1 : 0) + (carrier !== "all" ? 1 : 0) + (product !== "all" ? 1 : 0);
  const clearFilters = () => { setSearch(""); setOutcome("all"); setCarrier("all"); setProduct("all"); setRange("all"); setPage(1); };

  // The strip reads the calendar month, as its labels say.
  const thisMonth = localDay(new Date(now).toISOString(), timeZone).slice(0, 7);
  const month = rows.filter((row) => localDay(row.createdAt, timeZone).startsWith(thisMonth));
  const taken = month.filter((row) => row.outcome === "selected" || row.outcome === "superseded").length;
  const avgPremium = average(month.map((row) => row.monthlyPremiumCents));
  const feFaces = month.filter((row) => row.productCode === "final_expense").map((row) => row.faceAmountCents);
  const avgFace = average(feFaces);

  function exportCsv() {
    downloadCsv("quotes.csv",
      ["Client", "Insured", "Carrier", "Product", "Face", "Monthly premium", "Per $1,000", "State", "Captured", "Outcome"],
      shown.map((row) => [row.clientName, row.insuredRole, row.carrierName, row.productLabel, (row.faceAmountCents / 100).toFixed(2), (row.monthlyPremiumCents / 100).toFixed(2), per1000(row), row.state, row.createdAt, OUTCOME[row.outcome].label]));
  }

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Quotes"
        description="Every quote ever captured, including the ones that were not taken."
        actions={<Button type="button" variant="outline" onClick={exportCsv} disabled={shown.length === 0} title={shown.length === 0 ? "Nothing to export" : undefined}><Download aria-hidden="true" />Export</Button>}
      />
      {sample && <SampleDataNotice />}

      <StatStrip label="Quote totals">
        <StatTile label="Quotes this month" value={month.length} footnote={`across ${new Set(month.map((row) => row.caseId)).size} cases`} />
        <StatTile label="Taken" value={taken} valueTone={taken > 0 ? "good" : undefined} footnote={month.length ? `${((taken / month.length) * 100).toFixed(1)}% of quotes · ${taken}/${month.length}` : "no quotes yet"} />
        <StatTile label="Average premium" value={avgPremium === null ? "—" : money(avgPremium)} footnote="monthly, all carriers" />
        <StatTile label="Average face" value={avgFace === null ? "—" : face(avgFace)} footnote="Final Expense only" />
      </StatStrip>

      <TableCard
        toolbar={<>
          <DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search a client, carrier or product" />
            <select aria-label="Captured" className={toolbarControl} value={range} onChange={(event) => { setRange(event.target.value as RangeKey); setPage(1); }}>
              {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((value) => !value)} count={panelCount} aria-controls="quote-filters" />
          </DataToolbar>
          {filtersOpen && (
            <div id="quote-filters" className="flex w-full flex-wrap items-center gap-2">
              <select aria-label="Outcome" className={toolbarControl} value={outcome} onChange={(event) => { setOutcome(event.target.value as "all" | QuoteOutcome); setPage(1); }}>
                <option value="all">Every outcome</option>
                {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME[o].label}</option>)}
              </select>
              <select aria-label="Carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
                <option value="all">All carriers</option>
                {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <select aria-label="Product" className={toolbarControl} value={product} onChange={(event) => { setProduct(event.target.value); setPage(1); }}>
                <option value="all">All products</option>
                {products.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {panelCount > 0 && <Button type="button" variant="ghost" onClick={() => { setOutcome("all"); setCarrier("all"); setProduct("all"); setPage(1); }}>Clear filters</Button>}
            </div>
          )}
          {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
        </>}
        footer={<Pager page={current} total={shown.length} noun="quotes" onPage={setPage} suffix="most recent first" />}
      >
        {rows.length === 0
          ? <EmptyState title="No quotes yet" hint="A quote is saved from a case's Quote step, while you compare carriers with the client." />
          : shown.length === 0
            ? <NoMatches noun="quotes" onClear={clearFilters} />
            : <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[150px]">Client</th>
                    <th className="w-[138px]">Carrier</th>
                    <th className="w-[118px]">Product</th>
                    <th className="w-[96px]">Face</th>
                    <th className="w-[96px]">Monthly</th>
                    <th className="w-[110px]">Per $1,000</th>
                    <th className="w-[74px]">State</th>
                    <th className="w-[96px]">Captured</th>
                    <th className="w-[130px]">Outcome</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {pageRows.map((row) => {
                    const href = caseHref(row.caseId, { insured: row.insuredRole, step: "quote" });
                    const o = OUTCOME[row.outcome];
                    const rate = per1000(row);
                    return (
                      <tr key={row.id} className="m-row">
                        <td>
                          <Link href={href} className={clientLinkClass}>{row.clientName}</Link>
                          {row.insuredRole === "spouse" && <span className="block text-xs text-muted-foreground">spouse</span>}
                        </td>
                        <td>{row.carrierName}</td>
                        <td>{row.productLabel}</td>
                        <td className="tabular-nums">{face(row.faceAmountCents)}</td>
                        <td className="tabular-nums">{money(row.monthlyPremiumCents)}</td>
                        <td className="tabular-nums">{row.per1000Warning ? <StatusChip tone="warning" dot={false} title={row.per1000Warning}>{dollars(rate)}</StatusChip> : dollars(rate)}</td>
                        <td>{row.state ?? "—"}</td>
                        <td className="tabular-nums">{dayMonth(row.createdAt, timeZone)}</td>
                        <td><StatusChip tone={o.tone} dot>{o.label}</StatusChip></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
      </TableCard>
    </div>
  );
}
