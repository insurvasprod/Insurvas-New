"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";

/**
 * The lead-list index, as the board draws it: what each bought list is worth, whether it can be
 * dialled at all, how much of it sits outside the agency's licences, and how far through it the
 * team is — with the two things that cost money said out loud underneath.
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
const FILTER_LABEL: Record<StateFilter, string> = {
  all: "all", not_exhausted: "not exhausted", working: "working", stalling: "stalling", exhausted: "exhausted", blocked: "cannot be dialed", empty: "nothing imported",
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

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-3 pr-2 text-xs font-semibold leading-normal tracking-[-0.01em] text-[var(--body)]">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--body)]">
        <X className="size-2.5" aria-hidden="true" />
      </button>
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

export function LeadListIndex({ lists, licensedStates, onOpen, nowAt }: {
  lists: LeadListIndexRow[];
  licensedStates: string[];
  onOpen: (list: LeadListIndexRow) => void;
  nowAt: number;
}) {
  const [vendor, setVendor] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("not_exhausted");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const vendors = useMemo(() => [...new Set(lists.map((list) => list.vendorName))].sort(), [lists]);
  const rows = useMemo(() => lists.map((list) => ({ list, state: stateOf(list, nowAt) })), [lists, nowAt]);

  const needle = search.trim().toLowerCase();
  const shown = rows.filter(({ list, state }) =>
    (!vendor || list.vendorName === vendor) &&
    (stateFilter === "all" || (stateFilter === "not_exhausted" ? state !== "exhausted" : state === stateFilter)) &&
    (!needle || `${list.campaignName} ${list.vendorName}`.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // Figures across every list, not just the filtered page: the strip is the whole inventory.
  const usableLeft = lists.reduce((n, list) => n + live(list), 0);
  const openLists = lists.filter((list) => list.status === "active");
  const openSpend = openLists.reduce((n, list) => n + list.totalSpendCents, 0);
  const openVendors = new Set(openLists.map((list) => list.vendorName)).size;
  const territoryKnown = licensedStates.length > 0;
  const offTotal = lists.reduce((n, list) => n + (list.offTerritory ?? 0), 0);
  const claimableCents = lists.reduce((n, list) => n + list.claimable * (costPerUsable(list) ?? 0), 0);

  const blocked = rows.filter(({ state }) => state === "blocked").map(({ list }) => list);
  const worstOff = [...lists].filter((list) => (list.offTerritory ?? 0) > 0).sort((a, b) => (b.offTerritory ?? 0) - (a.offTerritory ?? 0))[0] ?? null;
  const offCostCents = lists.reduce((n, list) => n + (list.offTerritory ?? 0) * (costPerUsable(list) ?? 0), 0);

  const filters = [
    vendor && { key: "vendor", label: `Vendor: ${vendor}`, clear: () => setVendor("") },
    stateFilter !== "all" && { key: "state", label: `State: ${FILTER_LABEL[stateFilter]}`, clear: () => setStateFilter("all") },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const field = "mt-1.5 block h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground";
  const labelClass = "text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Usable leads left" value={usableLeft.toLocaleString()} valueTone={usableLeft > 0 ? "warning" : undefined} footnote="never dialed or mid-cadence" />
        <StatTile label="Spend on open lists" value={wholeMoney(openSpend)} footnote={`${openVendors} ${openVendors === 1 ? "vendor" : "vendors"}`} />
        <StatTile label="Off-territory leads" value={territoryKnown ? offTotal.toLocaleString() : "—"} valueTone={offTotal > 0 ? "danger" : undefined} footnote={territoryKnown ? "states you are not licensed in" : "no licensed states recorded"} />
        <StatTile label="Claimable back" value={money(claimableCents)} valueTone={claimableCents > 0 ? "good" : undefined} footnote="return windows still open" />
      </div>

      <div className="portal-lead-lists-filters flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
        <span className="relative inline-flex items-center">
          <select aria-label="Vendor" value={vendor} onChange={(event) => { setVendor(event.target.value); setPage(1); }} className="h-[2.125rem] appearance-none rounded-lg border border-[var(--border-strong)] bg-card pl-3.5 pr-9 text-sm font-semibold text-foreground">
            <option value="">All vendors</option>
            {vendors.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <span className="relative flex w-full items-center sm:w-[248px]">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <input type="search" aria-label="Search file, vendor, campaign" placeholder="Search file, vendor, campaign" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="h-[2.125rem] w-full rounded-lg border border-[var(--border-strong)] bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground" />
        </span>
        <Button type="button" variant="outline" aria-expanded={showFilters} onClick={() => setShowFilters((open) => !open)} className="h-[2.125rem] border-[var(--border-strong)] px-3.5">
          <SlidersHorizontal aria-hidden="true" />Filters
          {filters.length > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-xs font-semibold">{filters.length}</span>}
        </Button>
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            State
            <select value={stateFilter} onChange={(event) => { setStateFilter(event.target.value as StateFilter); setPage(1); }} className={field}>
              <option value="all">Every list</option>
              <option value="not_exhausted">Not exhausted</option>
              <option value="working">Working</option>
              <option value="stalling">Stalling</option>
              <option value="exhausted">Exhausted</option>
              <option value="blocked">Cannot be dialed</option>
              <option value="empty">Nothing imported</option>
            </select>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => <FilterChip key={filter.key} label={filter.label} onRemove={() => { filter.clear(); setPage(1); }} />)}
        {(filters.length > 0 || needle) && (
          <button type="button" onClick={() => { setVendor(""); setStateFilter("all"); setSearch(""); setPage(1); }} className="bg-transparent p-1 text-xs font-semibold text-foreground">Clear all</button>
        )}
        <span className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">{shown.length} of {lists.length} lists</span>
      </div>

      <TableCard
        footer={
          <>
            <span>{shown.length === 0 ? "No lists" : `Showing ${(current - 1) * PAGE_SIZE + 1}–${Math.min(current * PAGE_SIZE, shown.length)} of ${shown.length} lists · newest upload first`}</span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)] px-4" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</Button>
              <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)] px-4" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</Button>
            </span>
          </>
        }
      >
        <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr>
              <th>List</th>
              <th className="w-[78px] text-right">Usable</th>
              <th className="w-[104px] text-right">Cost / usable</th>
              <th className="w-[150px]">Territory</th>
              <th className="w-[170px]">Health</th>
              <th className="w-[158px]">State</th>
              <th className="w-[140px]">Worked through</th>
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
                </tr>
              );
            })}
          </tbody>
        </table>
        {lists.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No lead lists yet. A list is a campaign — create one under Vendors &amp; campaigns, then import a CSV against it.</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No list matches these filters.</p>
        ) : null}
      </TableCard>

      {(blocked.length > 0 || (worstOff && offTotal > 0)) && (
        <div className="grid gap-5 md:grid-cols-2">
          {blocked.length > 0 && (
            <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
              <p className="font-semibold text-[var(--error-ink)]">The scrub is a gate, not a badge</p>
              <p className="mt-1.5 text-[var(--body)]">
                {blocked.length === 1 ? <strong>{blocked[0].campaignName}</strong> : <><strong>{blocked.length} lists</strong> ({blocked.slice(0, 3).map((list) => list.campaignName).join(", ")}{blocked.length > 3 ? ", …" : ""})</>}{" "}
                {blocked.length === 1 ? "has" : "have"} not been scrubbed, so {blocked.length === 1 ? "its" : "their"} leads are <strong>not servable</strong> — the queue will not hand one out. Federal DNC carries $500–$1,500 per call and a purchased list is exactly where those numbers hide. If the scrub vendor is down, dialing waits.
              </p>
            </div>
          )}
          {worstOff && offTotal > 0 && (
            <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
              <p className="font-semibold text-[var(--warning-ink)]">{offTotal.toLocaleString()} leads you cannot legally sell to</p>
              <p className="mt-1.5 text-[var(--body)]">
                {worstOff.vendorName}’s {worstOff.campaignName} holds {(worstOff.offTerritory ?? 0).toLocaleString()} leads in {worstOff.offTerritoryStates} {worstOff.offTerritoryStates === 1 ? "state" : "states"} outside your {licensedStates.length} licensed {licensedStates.length === 1 ? "state" : "states"}. Across every list they cost <strong>{money(offCostCents)}</strong>, they can never convert, and they are worth raising with the vendor.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
