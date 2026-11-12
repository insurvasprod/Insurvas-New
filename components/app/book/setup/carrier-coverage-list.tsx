"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { RULE_TYPES, type SettingField } from "@/lib/ingestion/carrierRules";
import { carrierRulesHref, type CoverageFilter } from "@/lib/pipelineRules/carrierCoverageModel";
import { cn } from "@/lib/utils";

import { FIELD_MAPS, FactDialog, MONEY_FIELDS, SETTINGS_CARRIERS, layoutWords, settingText, type FactsSettings, type FilesFacts } from "./carrier-facts";
import { WindowDialog, days, sourceWord, whose, windowLabel, type WindowItem, type WindowRow } from "./carrier-terms-window-dialog";

export type TermsTab = "windows" | "money" | "files";

export type CoverageListRow = {
  carrierId: string;
  carrierName: string;
  inForce: number;
  missing: number;
  unverified: number;
  /** The five windows in RULE_TYPES order, each what its cell opens. */
  windows: WindowRow[];
  settings: FactsSettings;
  files: FilesFacts;
};

const CHIPS: Array<[CoverageFilter, string]> = [["all", "All"], ["missing", "Missing a rule"], ["unverified", "Unverified"]];
const FILTER_WORDS: Record<CoverageFilter, string> = { all: "All", missing: "Missing a rule", unverified: "Unverified" };
const link = "whitespace-nowrap hover:underline";
/** A cell's button: one plain line, the same weight in every cell (no outline, no colour). */
const cellButton = "whitespace-nowrap tabular-nums hover:underline";

/** Policies with this carrier, in force: what the In force figure opens. */
const policiesHref = (carrierId: string) => `/app/policies?carrier=${carrierId}&show=inforce`;
const carrierHref = (carrierId: string, tab: TermsTab) => `${carrierRulesHref(carrierId)}${tab === "windows" ? "" : `?tab=${tab}`}`;

/** A window's cell: its days (source and verified on hover), or "Set ›". One click opens that window's dialog. */
function WindowCell({ row, onOpen }: { row: WindowRow; onOpen: () => void }) {
  const set = row.state !== "missing" && row.rule;
  const title = set && row.rule ? `${windowLabel(row.type)}: ${days(row.rule.windowDays)} from paid-to · ${sourceWord(row.rule.source)} · ${row.state === "verified" ? "verified" : "unverified"} · ${whose(row.rule)}` : `${windowLabel(row.type)}: not set · ${row.cost}`;
  return (
    <button type="button" title={title} aria-label={title} onClick={onOpen} className={cellButton}>
      {set && row.rule ? days(row.rule.windowDays) : "Set ›"}
    </button>
  );
}

/** A money or file fact's cell: its value, or "+ Set"; it opens the fact's dialog. Read-only: the value as text. */
function FactCell({ field, settings, readOnly, onOpen }: { field: SettingField; settings: FactsSettings; readOnly: boolean; onOpen: () => void }) {
  const text = settingText(field, settings[field].value);
  if (readOnly) return text ? <span className="whitespace-nowrap">{text}</span> : <span className="text-muted-foreground" title="Not set">—</span>;
  return (
    <button type="button" onClick={onOpen} className={cellButton}>
      {text ?? "Set ›"}
    </button>
  );
}

type Column = { key: string; label: string; cell: (row: CoverageListRow) => ReactNode };

/**
 * Setup › Carrier terms, the terms grid (board 1·B, the owner's pick 2026-11-10): one row a carrier, one cell a window
 * with its days or "+ Set". A cell opens that window's dialog (board 1·4); the carrier's name or › opens its page; the
 * In force figure opens Policies filtered to the carrier. The Money and Files tabs are the same grid for the carrier's
 * other facts, each cell opening its fact dialog (or, for the portal and the layout, the page that keeps them). Sorted
 * by policies left without a countdown (the server's order). On a phone each carrier is a card.
 */
export function CarrierCoverageList({ rows, tab, asOf, readOnly }: { rows: CoverageListRow[]; tab: TermsTab; asOf: string; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<CoverageFilter>("all");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<WindowItem[] | null>(null);
  const [fact, setFact] = useState<{ row: CoverageListRow; field: SettingField } | null>(null);
  const counts = { all: rows.length, missing: rows.filter((r) => r.missing > 0).length, unverified: rows.filter((r) => r.unverified > 0).length };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => (filter === "all" || (filter === "missing" ? row.missing > 0 : row.unverified > 0)) && (!q || row.carrierName.toLowerCase().includes(q)));
  }, [rows, filter, query]);
  const clear = () => { setQuery(""); setFilter("all"); };
  const openWindow = (row: CoverageListRow, windowRow: WindowRow) => setOpened([{ carrierId: row.carrierId, carrierName: row.carrierName, row: windowRow }]);
  const openFact = (row: CoverageListRow, field: SettingField) => setFact({ row, field });

  const columns: Column[] = tab === "windows"
    ? RULE_TYPES.map((type, i) => ({ key: type, label: windowLabel(type), cell: (row) => <WindowCell row={row.windows[i]} onOpen={() => openWindow(row, row.windows[i])} /> }))
    : tab === "money"
      ? MONEY_FIELDS.map((field) => ({ key: field, label: ({ commissionTrigger: "Pays commission", expectedLagDays: "Payment lag", minimumPayoutCents: "Minimum payout", toleranceCents: "Tolerance" } as const)[field], cell: (row) => <FactCell field={field} settings={row.settings} readOnly={readOnly} onOpen={() => openFact(row, field)} /> }))
      : [
        { key: "statementFormat", label: "Statement format", cell: (row) => <FactCell field="statementFormat" settings={row.settings} readOnly={readOnly} onOpen={() => openFact(row, "statementFormat")} /> },
        { key: "expectedCadence", label: "Files arrive", cell: (row) => <FactCell field="expectedCadence" settings={row.settings} readOnly={readOnly} onOpen={() => openFact(row, "expectedCadence")} /> },
        { key: "portal", label: "Portal", cell: (row) => row.files.portal.value ? <Link href={SETTINGS_CARRIERS} className={cn(link, "block truncate")} title={`${row.files.portal.value} · kept in Settings › Carriers`}>{row.files.portal.value}</Link> : <Link href={SETTINGS_CARRIERS} className="text-muted-foreground hover:underline" title="Not set · kept in Settings › Carriers">—</Link> },
        { key: "layout", label: "Layout", cell: (row) => {
          const layout = row.files.layouts.find((l) => l.fileType === "commissions") ?? row.files.layouts[0];
          return layout ? <Link href={FIELD_MAPS} className={cn(link, "block truncate")} title={layoutWords(layout)}>{layoutWords(layout)}</Link> : <span className="text-muted-foreground" title="No layout yet">—</span>;
        } },
      ];

  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
      <ToolbarSearch value={query} onChange={setQuery} placeholder="Search carriers" />
      <span role="radiogroup" aria-label="Show" className="inline-flex flex-wrap gap-2">
        {CHIPS.map(([key, label]) => <ToggleChip key={key} role="radio" selected={filter === key} count={counts[key]} countTone={key === "missing" && counts.missing ? "danger" : undefined} onClick={() => setFilter(key)}>{label}</ToggleChip>)}
      </span>
    </DataToolbar>
  );
  const legend = tab === "windows" ? <span>Days from paid-to · a cell names its source and whether it is verified</span> : null;
  const footer = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {legend}
      <span className="flex-1" />
      <span>{shown.length.toLocaleString("en-US")} {shown.length === 1 ? "carrier" : "carriers"} · sorted by policies left without a countdown</span>
    </div>
  );

  const dialogs = (
    <>
      {opened && <WindowDialog queue={opened} stepping={false} asOf={asOf} readOnly={readOnly} onClose={() => setOpened(null)} />}
      {fact && <FactDialog carrierId={fact.row.carrierId} carrierName={fact.row.carrierName} field={fact.field} settings={fact.row.settings} onClose={() => setFact(null)} />}
    </>
  );

  if (!rows.length) {
    return (
      <PagedTableCard total={0} noun="carriers" toolbar={toolbar}>
        <EmptyState title="No carriers yet" hint="Switch on the carriers you work with in Settings › Carriers; each one then has its rules here." action={<Link href={SETTINGS_CARRIERS} className={buttonVariants()}>Open Settings › Carriers</Link>} />
      </PagedTableCard>
    );
  }

  return (
    <>
      <PagedTableCard total={shown.length} noun="carriers" toolbar={toolbar} footer={footer} suffix={legend}>
        {shown.length === 0 ? (
          <EmptyState
            title="No carriers match"
            hint={query.trim() ? `Nothing matches "${query.trim()}"${filter === "all" ? "" : ` in ${FILTER_WORDS[filter]}`}.` : `No carrier is in ${FILTER_WORDS[filter]}.`}
            action={<Button type="button" variant="outline" onClick={clear}>Clear the filters</Button>}
          />
        ) : (
          <>
            {/* Owner 2026-11-06: the columns share the width evenly (table-fixed). */}
            <div className="hidden md:block">
              <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="min-w-[200px]">Carrier</th>
                    <th className="w-[90px] text-right">In force</th>
                    {columns.map((column) => <th key={column.key} className="w-[130px]">{column.label}</th>)}
                  </tr>
                </thead>
                <PagedBody>
                  {/* The name opens the carrier's page (no ›-only column); each cell keeps its own click (its dialog or link). */}
                  {shown.map((row) => (
                    <tr key={row.carrierId} className="hover:bg-[var(--surface-alt)]">
                      <td className="whitespace-nowrap"><Link href={carrierHref(row.carrierId, tab)} className="font-medium text-foreground hover:underline">{row.carrierName}</Link></td>
                      <td className="text-right tabular-nums"><Link href={policiesHref(row.carrierId)} className={link} title={`${row.carrierName} policies in force`}>{row.inForce.toLocaleString("en-US")}</Link></td>
                      {columns.map((column) => <td key={column.key} className="whitespace-nowrap">{column.cell(row)}</td>)}
                    </tr>
                  ))}
                </PagedBody>
              </table>
            </div>
            {/* Board 1·7: on a phone the grid is one card a carrier, its columns as rows. */}
            <PagedBody as="ul" className="grid gap-3 p-4 md:hidden" label="Carriers">
              {shown.map((row) => (
                <li key={row.carrierId} className="grid gap-2 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={carrierHref(row.carrierId, tab)} className="font-medium text-foreground hover:underline">{row.carrierName}</Link>
                    <Link href={policiesHref(row.carrierId)} className={cn(link, "text-sm")}>{row.inForce.toLocaleString("en-US")} in force ›</Link>
                  </div>
                  {columns.map((column) => (
                    <div key={column.key} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{column.label}</span>
                      <span className="min-w-0">{column.cell(row)}</span>
                    </div>
                  ))}
                </li>
              ))}
            </PagedBody>
          </>
        )}
      </PagedTableCard>
      {dialogs}
    </>
  );
}
