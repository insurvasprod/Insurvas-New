"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";

/**
 * The lead-list index: what each bought list is worth, whether it can be dialled at all, how much
 * of it sits outside the agency's licences, and how far through it the team is. One strip of
 * figures, then the table with its toolbar inside (docs/design/UI-CONSISTENCY.md).
 *
 * Everything here is counted from rows (lib/leadLists/service.ts), never stored: a stored "usable"
 * is wrong the moment somebody dials one.
 */

export type LeadListIndexRow = {
  campaignId: string; campaignName: string; vendorName: string; status: string; createdAt: string;
  recordsPurchased: number; totalSpendCents: number; creditsReceivedCents: number;
  leadsReceived: number; untouched: number; assigned: number; byState: Record<string, number>;
  scrubStatus: string; offTerritory: number | null; offTerritoryStates: number; lastTouchedAt: string | null; claimable: number;
};

type ListState = "working" | "stalling" | "exhausted" | "blocked" | "empty";
type StateFilter = "all" | "not_exhausted" | ListState;

const PAGE_SIZE = 10;
const STALL_MS = 7 * 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATE_UI: Record<ListState, { label: string; chip: string; dot: string }> = {
  working: { label: "Working", chip: "bg-[var(--success-surface)] text-[var(--success-ink)]", dot: "bg-[var(--success)]" },
  stalling: { label: "Stalling", chip: "bg-[var(--warning-surface)] text-[var(--warning-ink)]", dot: "bg-[var(--warning)]" },
  exhausted: { label: "Exhausted", chip: "bg-[var(--surface-alt)] text-[var(--body)]", dot: "bg-[var(--muted)]" },
  blocked: { label: "Cannot be dialed", chip: "bg-[var(--error-surface)] text-[var(--error-ink)]", dot: "bg-[var(--error)]" },
  empty: { label: "Nothing imported", chip: "bg-[var(--surface-alt)] text-[var(--body)]", dot: "bg-[var(--muted)]" },
};

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const wholeMoney = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const shortDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

function live(list: LeadListIndexRow) {
  return (list.byState.fresh ?? 0) + (list.byState.working ?? 0) + (list.byState.retry ?? 0);
}
function costPerUsable(list: LeadListIndexRow) {
  return list.leadsReceived > 0 ? list.totalSpendCents / list.leadsReceived : null;
}

/** One reading per list, decided in order: the scrub gate first, because nothing else matters if it is shut. */
function stateOf(list: LeadListIndexRow, now: number): ListState {
  if (list.leadsReceived === 0) return "empty";
  if (list.scrubStatus !== "scrubbed") return "blocked";
  if (live(list) === 0) return "exhausted";
  const lastTouched = list.lastTouchedAt ? Date.parse(list.lastTouchedAt) : Date.parse(list.createdAt);
  if ((list.byState.fresh ?? 0) > 0 && Number.isFinite(lastTouched) && now - lastTouched > STALL_MS) return "stalling";
  return "working";
}

function Chip({ className, dot, children }: { className: string; dot: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold leading-normal tracking-[-0.01em] ${className}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Worked through: closed, still in cadence, exhausted, and what nobody has dialled yet — as one bar. */
function WorkedThrough({ list }: { list: LeadListIndexRow }) {
  const total = Math.max(1, list.leadsReceived);
  const closed = list.byState.closed ?? 0;
  const cadence = (list.byState.working ?? 0) + (list.byState.retry ?? 0) + (list.byState.nurture ?? 0);
  const done = list.byState.exhausted ?? 0;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const dialled = Math.round(((list.leadsReceived - (list.byState.fresh ?? 0)) / total) * 100);
  return (
    <span className="block" title={`${dialled}% dialled · ${closed} closed · ${cadence} in cadence · ${done} exhausted · ${list.byState.fresh ?? 0} never dialed`}>
      <span className="m-meter flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-alt)]" role="img" aria-label={`${dialled}% dialled`}>
        <span className="block h-1.5 bg-[var(--success)]" style={{ width: pct(closed) }} />
        <span className="block h-1.5 bg-[var(--info)]" style={{ width: pct(cadence) }} />
        <span className="block h-1.5 bg-[var(--primary)]" style={{ width: pct(done) }} />
      </span>
    </span>
  );
}

export function LeadListIndex({ lists, licensedStates, onOpen, nowAt, onRefresh }: {
  lists: LeadListIndexRow[];
  licensedStates: string[];
  onOpen: (list: LeadListIndexRow) => void;
  nowAt: number;
  /** Reloads the lists. The toolbar's Refresh button is drawn only when the parent passes it. */
  onRefresh?: () => Promise<unknown> | void;
}) {
  const [vendor, setVendor] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("not_exhausted");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const vendors = useMemo(() => [...new Set(lists.map((list) => list.vendorName))].sort(), [lists]);
  const rows = useMemo(() => lists.map((list) => ({ list, state: stateOf(list, nowAt) })), [lists, nowAt]);

  const needle = search.trim().toLowerCase();
  const shown = rows.filter(({ list, state }) =>
    (!vendor || list.vendorName === vendor) &&
    (stateFilter === "all" || (stateFilter === "not_exhausted" ? state !== "exhausted" : state === stateFilter)) &&
    (!needle || `${list.campaignName} ${list.vendorName}`.toLowerCase().includes(needle)));
  const { current, rows: pageRows } = paginate(shown, page, PAGE_SIZE);

  // Figures across every list, not just the filtered page: the strip is the whole inventory.
  const usableLeft = lists.reduce((n, list) => n + live(list), 0);
  const openLists = lists.filter((list) => list.status === "active");
  const openSpend = openLists.reduce((n, list) => n + list.totalSpendCents, 0);
  const openVendors = new Set(openLists.map((list) => list.vendorName)).size;
  const territoryKnown = licensedStates.length > 0;
  const offTotal = lists.reduce((n, list) => n + (list.offTerritory ?? 0), 0);
  const claimableCents = lists.reduce((n, list) => n + list.claimable * (costPerUsable(list) ?? 0), 0);

  // The scrub gate is the one thing on this screen somebody must act on: an unscrubbed list is never served.
  const blocked = rows.filter(({ state }) => state === "blocked").map(({ list }) => list);

  const filtered = Boolean(vendor) || stateFilter !== "all" || Boolean(needle);
  const clearFilters = () => { setVendor(""); setStateFilter("all"); setSearch(""); setPage(1); };
  async function refresh() {
    if (!onRefresh) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <StatStrip label="Lead list totals">
        <StatTile label="Usable leads left" value={usableLeft.toLocaleString()} valueTone={usableLeft > 0 ? "warning" : undefined} footnote="never dialed or mid-cadence" />
        <StatTile label="Spend on open lists" value={wholeMoney(openSpend)} footnote={`${openVendors} ${openVendors === 1 ? "vendor" : "vendors"}`} />
        <StatTile label="Off-territory leads" value={territoryKnown ? offTotal.toLocaleString() : "—"} valueTone={offTotal > 0 ? "danger" : undefined} footnote={territoryKnown ? "states you are not licensed in" : "no licensed states recorded"} />
        <StatTile label="Claimable back" value={money(claimableCents)} valueTone={claimableCents > 0 ? "good" : undefined} footnote="return windows still open" />
      </StatStrip>

      {blocked.length > 0 && (
        <p role="alert" className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">
          <strong>{blocked.length === 1 ? blocked[0].campaignName : `${blocked.length} lists`}</strong> {blocked.length === 1 ? "is" : "are"} not scrubbed, so {blocked.length === 1 ? "its" : "their"} leads cannot be dialed.
        </p>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={onRefresh ? <RefreshButton onClick={() => void refresh()} refreshing={refreshing} /> : undefined}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search file, vendor, campaign" />
            <select aria-label="Vendor" value={vendor} onChange={(event) => { setVendor(event.target.value); setPage(1); }} className={toolbarControl}>
              <option value="">All vendors</option>
              {vendors.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label="List state" value={stateFilter} onChange={(event) => { setStateFilter(event.target.value as StateFilter); setPage(1); }} className={toolbarControl}>
              <option value="all">Every list</option>
              <option value="not_exhausted">Not exhausted</option>
              <option value="working">Working</option>
              <option value="stalling">Stalling</option>
              <option value="exhausted">Exhausted</option>
              <option value="blocked">Cannot be dialed</option>
              <option value="empty">Nothing imported</option>
            </select>
            {filtered && <Button type="button" variant="ghost" onClick={clearFilters}>Clear</Button>}
          </DataToolbar>
        }
        footer={<Pager page={current} total={shown.length} noun="lists" pageSize={PAGE_SIZE} onPage={setPage} suffix={shown.length < lists.length ? `${lists.length} in all · newest upload first` : "newest upload first"} />}
      >
        {lists.length === 0 ? (
          <EmptyState title="No lead lists yet" hint="A list is a campaign. Create one under Vendors & campaigns, then import a CSV against it." />
        ) : shown.length === 0 ? (
          <NoMatches noun="lists" onClear={clearFilters} />
        ) : (
          <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
            <thead>
              <tr>
                <th>List</th>
                <th className="w-[78px] text-right">Usable</th>
                <th className="w-[104px] text-right">Cost / usable</th>
                <th className="w-[150px]">Territory</th>
                <th className="w-[170px]">Health</th>
                <th className="w-[158px]">State</th>
                <th className="w-[140px]">Worked through</th>
                <th className="w-[84px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {pageRows.map(({ list, state }) => {
                const cost = costPerUsable(list);
                const ui = STATE_UI[state];
                const fresh = list.byState.fresh ?? 0;
                return (
                  <tr key={list.campaignId} className="m-row cursor-pointer" onClick={() => onOpen(list)}>
                    <td className="max-w-[340px]">
                      <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(list); }} className="block max-w-full truncate text-left text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground hover:underline">
                        {list.campaignName}
                      </button>
                      <span className="block truncate text-xs leading-normal text-muted-foreground">
                        {[list.vendorName, `${list.recordsPurchased.toLocaleString()} bought`, shortDate(list.createdAt)].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{state === "blocked" || state === "empty" ? "—" : list.leadsReceived.toLocaleString()}</td>
                    <td className="text-right tabular-nums">{cost == null || state === "blocked" ? "—" : `$${(cost / 100).toFixed(3)}`}</td>
                    <td>
                      {list.offTerritory == null || state === "empty" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : list.offTerritory === 0 ? (
                        <Chip className="bg-[var(--success-surface)] text-[var(--success-ink)]" dot="bg-[var(--success)]">All in licence</Chip>
                      ) : (
                        <Chip className="bg-[var(--error-surface)] text-[var(--error-ink)]" dot="bg-[var(--error)]">{list.offTerritory.toLocaleString()} off-territory</Chip>
                      )}
                    </td>
                    <td>{list.scrubStatus !== "scrubbed" && state !== "empty" ? (list.scrubStatus === "failed" ? "scrub failed" : "not scrubbed") : fresh > 0 ? `${fresh.toLocaleString()} never dialed` : "—"}</td>
                    <td><Chip className={ui.chip} dot={ui.dot}>{ui.label}</Chip></td>
                    <td>{state === "blocked" ? <span className="text-xs text-[var(--error-ink)]">Leads are not servable</span> : state === "empty" ? <span className="text-xs text-muted-foreground">Import a file against it</span> : <WorkedThrough list={list} />}</td>
                    <td className="text-right">
                      <Button type="button" variant="outline" size="sm" aria-label={`Open ${list.campaignName}`} onClick={(event) => { event.stopPropagation(); onOpen(list); }}>Open</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
