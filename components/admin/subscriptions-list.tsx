"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronRight, Download } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { st, pillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { SavedViews, type BuiltInView, type ViewState } from "@/components/ui/saved-views";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { BILLING_CYCLES, BILLING_CYCLE_LABELS, formatCentsAsCurrency } from "@/lib/money";
import { LIST_ORDER, LIST_STATUS, LIST_STATUS_ORDER, type QueuedKind, type SubscriptionListRow } from "@/lib/subscriptionsList/model";
import {
  SUBS_LENSES, filterSubs, lensCounts, readSubsFilters, subscriptionsCsv, subsFilterParams, type SubsFilters,
} from "@/lib/subscriptionsList/filters";
import { cn } from "@/lib/utils";
import { SubsSheetFrame } from "@/components/admin/billing/subs-sheet";

/**
 * The subscriptions list (admin round 1, billing-r2 screen 2): one TableCard, its toolbar inside, the pager at its
 * foot. Every subscription is on the client (hundreds, not thousands), so search, filters and paging are instant
 * and the counts exact.
 *
 * The filters live in the address (`?status=past_due` from the dashboard lands filtered): read with
 * useSearchParams, written in place without a round trip. The lens is the title line's tabs (SubsLensTabs). A row
 * opens its sheet (`?open=<id>`): that one is a server round trip, because the sheet's actions are the tenant
 * record's own and need the server's reads; the panel shows at once and its body arrives with them.
 */
export function SubscriptionsList({
  rows,
  plans,
  listError,
  sheet,
  sheetFor,
}: {
  rows: SubscriptionListRow[];
  plans: { id: string; label: string }[];
  listError: boolean;
  /** The server-rendered body of the open sheet, when the address names one. */
  sheet: ReactNode;
  /** Which subscription `sheet` was rendered for. */
  sheetFor: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [page, setPage] = useState(1);
  const filters = useMemo(() => readSubsFilters(params), [params]);
  // The sheet opens (and closes) at once; the address follows. A local choice holds only while the address is
  // still the one it was made against, so Back and Forward always win.
  const urlOpen = params.get("open");
  const [asked, setAsked] = useState<{ id: string | null; against: string | null } | null>(null);
  const openId = asked && asked.against === urlOpen ? asked.id : urlOpen;

  const queuedCounts = useMemo(() => {
    const counts: Record<QueuedKind, number> = { plan: 0, ends: 0, trial: 0, ended: 0, none: 0 };
    for (const row of rows) counts[row.queuedKind] += 1;
    return counts;
  }, [rows]);
  const filtered = useMemo(() => filterSubs(rows, filters), [rows, filters]);

  const pageSize = useFittingPageSize(480, 45);
  const { current, rows: shown } = paginate(filtered, page, pageSize);
  const anyFilter = filters.status !== "all" || filters.cycle !== "any" || filters.queued !== "any" || filters.plan !== "all" || filters.q !== "";

  function setFilters(patch: Partial<SubsFilters>) {
    setParamsInPlace(subsFilterParams({ ...filters, ...patch }));
    setPage(1);
  }
  function clearAll() {
    setFilters({ q: "", plan: "all", status: "all", cycle: "any", queued: "any" });
  }

  const open = (id: string) => {
    setAsked({ id, against: urlOpen });
    const next = new URLSearchParams(window.location.search);
    next.set("open", id);
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const close = () => {
    setAsked({ id: null, against: urlOpen });
    setParamsInPlace({ open: null });
  };

  // A row that stays selected while its sheet is open.
  const openRow = openId ? rows.find((row) => row.id === openId) ?? null : null;

  const viewState: ViewState = { lens: filters.lens, q: filters.q, plan: filters.plan, status: filters.status, cycle: filters.cycle, queued: filters.queued };
  const counts = useMemo(() => lensCounts(rows), [rows]);
  const builtIns: BuiltInView[] = SUBS_LENSES.map((lens) => ({ id: lens.key, name: lens.label, state: { lens: lens.key }, count: counts[lens.key] }));

  function exportCsv() {
    const csv = subscriptionsCsv(filtered, (status) => LIST_STATUS[status].label);
    const url = URL.createObjectURL(new Blob([`﻿${csv}\r\n`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={<Pager page={current} pageSize={pageSize} total={filtered.length} noun="subscriptions" suffix={LIST_ORDER} onPage={setPage} />}
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" variant="outline" onClick={exportCsv} disabled={filtered.length === 0} title="The rows the filters show, as a CSV">
                  <Download aria-hidden="true" />
                  Export
                </Button>
                <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
              </>
            }
          >
            <SearchBox value={filters.q} onChange={(q) => setFilters({ q })} />
            <select aria-label="Plan" value={filters.plan} onChange={(event) => setFilters({ plan: event.target.value })} className={cn(toolbarControl, "max-w-48")}>
              <option value="all">All plans</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select aria-label="Status" value={filters.status} onChange={(event) => setFilters({ status: event.target.value as SubsFilters["status"] })} className={toolbarControl}>
              <option value="all">All statuses</option>
              <option value="current">Everything but expired</option>
              {LIST_STATUS_ORDER.map((s) => <option key={s} value={s}>{LIST_STATUS[s].label}</option>)}
            </select>
            <select aria-label="Cycle" value={filters.cycle} onChange={(event) => setFilters({ cycle: event.target.value as SubsFilters["cycle"] })} className={toolbarControl}>
              <option value="any">Any cycle</option>
              {BILLING_CYCLES.map((c) => <option key={c} value={c}>{BILLING_CYCLE_LABELS[c]}</option>)}
            </select>
            <select aria-label="Queued change" value={filters.queued} onChange={(event) => setFilters({ queued: event.target.value as SubsFilters["queued"] })} className={toolbarControl}>
              <option value="any">Any queued change</option>
              <option value="plan">Plan change at renewal ({queuedCounts.plan})</option>
              <option value="ends">Ends at period end ({queuedCounts.ends})</option>
              <option value="trial">Trial ending ({queuedCounts.trial})</option>
              <option value="none">Nothing queued</option>
            </select>
            <SavedViews
              storageKey="admin.subscriptions"
              current={viewState}
              builtIns={builtIns}
              onApply={(state) => {
                const next = readSubsFilters(Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value == null ? undefined : String(value)])));
                setParamsInPlace(subsFilterParams(next));
                setPage(1);
              }}
            />
            {anyFilter && <Button type="button" variant="ghost" onClick={clearAll}>Clear</Button>}
          </DataToolbar>
        }
      >
        <table className={cn(st.table, "min-w-[1160px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Customer</th>
              <th scope="col" className={cn(st.th, "w-[180px]")}>Plan</th>
              <th scope="col" className={cn(st.th, "w-[100px]")}>Cycle</th>
              <th scope="col" className={cn(st.th, "w-[170px]")}>Current period</th>
              <th scope="col" className={cn(st.th, "w-[200px]")}>Queued change</th>
              <th scope="col" className={cn(st.th, st.num, "w-[110px]")}>Monthly</th>
              <th scope="col" className={cn(st.th, "w-[130px]")}>Status</th>
              <th scope="col" className={cn(st.th, "w-10")}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {listError && (
              <tr><td colSpan={8} className="border-t border-[var(--border)] p-0">
                <ErrorState title="The subscriptions could not be read" detail="The list did not load, so nothing below is a count of zero. Reload the page; if it keeps failing, the error is in the server log." />
              </td></tr>
            )}
            {!listError && rows.length === 0 && (
              <tr><td colSpan={8} className="border-t border-[var(--border)] p-0"><EmptyState title="No subscriptions yet" hint="Assign one from a customer's page." /></td></tr>
            )}
            {rows.length > 0 && filtered.length === 0 && (
              <tr><td colSpan={8} className="border-t border-[var(--border)] p-0"><NoMatches noun="subscriptions" onClear={anyFilter ? clearAll : undefined} /></td></tr>
            )}
            {shown.map((row) => {
              const state = LIST_STATUS[row.status];
              const selected = openId === row.id;
              return (
                <tr key={row.id} className={cn("m-row cursor-pointer hover:bg-[var(--hover-wash)]", selected && "bg-[var(--hover-wash)]")} onClick={() => open(row.id)}>
                  <td className={cn(st.td, "max-w-0")}>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); open(row.id); }}
                      aria-haspopup="dialog"
                      className="block w-full cursor-pointer truncate rounded-sm border-0 bg-transparent p-0 text-left font-semibold text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                    >
                      {row.tenantName}
                    </button>
                  </td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{row.planName}{row.planVersion !== null && <span className="text-[var(--muted)]"> v{row.planVersion}</span>}</td>
                  <td className={st.td}>{BILLING_CYCLE_LABELS[row.cycle]}</td>
                  <td className={cn(st.td, "whitespace-nowrap tabular-nums")}><UtcHover full={row.periodFull} isos={[row.periodStart, row.periodEnd]}>{row.periodText}</UtcHover></td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{row.queuedText}</td>
                  <td className={cn(st.td, st.num)} title={row.countsTowardMrr ? "Counted in MRR" : `Not counted in MRR (${state.label.toLowerCase()})`}>
                    {row.monthlyCents === null ? "—" : formatCentsAsCurrency(row.countsTowardMrr ? row.monthlyCents : 0)}
                  </td>
                  <td className={st.td}><StatusChip tone={pillTone(state.tone)} dot>{state.label}</StatusChip></td>
                  <td className={st.td}><ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>

      {openId && (
        <SubsSheetFrame row={openRow} loading={sheetFor !== openId} onClose={close}>
          {sheetFor === openId ? sheet : null}
        </SubsSheetFrame>
      )}
    </>
  );
}

/** The search box, typed into freely and written to the address a beat after typing stops. */
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef(value);
  useEffect(() => {
    // The address changed from elsewhere (Clear, a saved view): show it.
    if (value !== last.current) { last.current = value; setText(value); }
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ToolbarSearch
      value={text}
      onChange={(next) => {
        setText(next);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { last.current = next.trim(); onChange(next.trim()); }, 200);
      }}
      placeholder="Search customer"
    />
  );
}

/**
 * Text printed by the server in UTC, with the same instants in the reader's local time added to the hover after
 * mount — so the server and first client render are identical.
 */
export function UtcHover({ full, isos, children }: { full: string; isos: (string | null)[]; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = isos.join("|");
  useEffect(() => {
    const local = key
      .split("|")
      .filter(Boolean)
      .map((iso) => new Date(iso))
      .filter((date) => !Number.isNaN(date.getTime()))
      .map((date) => date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }));
    if (ref.current && local.length > 0) ref.current.title = `${full} · ${local.join(" to ")} your time`;
  }, [key, full]);
  return <span ref={ref} title={full}>{children}</span>;
}
