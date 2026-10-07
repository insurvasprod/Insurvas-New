"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { ProvisionalBadge } from "@/components/app/provisional-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClearFiltersButton, DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { activeFilterCount, inForce, CSV_HEADER, csvRows, EMPTY_FILTERS, filterRows, NONE, readQuery, RISK_LABELS, sortRows, statusLabel, toCsv, totals, writeQuery, type BookFilters, type BookRow, type RiskBand, type Sort, type SortKey } from "@/lib/ingestion/policyBook";
import { STATUS_LABELS, STATUS_VOCABULARY } from "@/lib/ingestion/statuses";
import { notify } from "@/lib/notify";

const RISK_TONE: Record<RiskBand, StatusTone> = { none: "neutral", watch: "info", at_risk: "warning", critical: "danger" };
const STATUS_TONE: Record<string, StatusTone> = { active: "good", at_risk: "warning", lapsed: "danger", not_taken: "danger", declined: "neutral", withdrawn: "neutral", submitted: "info", approved_unpaid: "info", paid_up: "good" };
const money = (cents: number | null) => (cents === null ? "—" : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const money2 = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const MODE_SHORT: Record<string, string> = { monthly: "/mo", quarterly: "/qtr", semiannual: "/6 mo", annual: "/yr" };

export const policyHref = (row: { carrierId: string; policyNumber: string }) => `/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}`;

type Saved = { id: string; name: string; query: string };

const COLUMNS: Array<{ key: SortKey; label: string; className?: string; title?: string }> = [
  { key: "client", label: "Client" },
  { key: "carrier", label: "Carrier", className: "w-[120px]" },
  { key: "product", label: "Product", className: "w-[100px]" },
  { key: "policy", label: "Policy", className: "w-[110px]" },
  { key: "premium", label: "Premium", className: "w-[96px] text-right", title: "Premium as the carrier bills it; sorted by its yearly amount" },
  { key: "face", label: "Face", className: "w-[84px] text-right" },
  { key: "status", label: "Status", className: "w-[106px]", title: "Our status; hover a status for the carrier's own word" },
  { key: "dpd", label: "Late", className: "w-[64px] text-right", title: "Days past the paid-to date" },
  { key: "risk", label: "Risk", className: "w-[90px]" },
  { key: "issued", label: "Issued", className: "w-[104px]" },
  { key: "agent", label: "Agent", className: "w-[104px]" },
];

/**
 * LA-4.11 (Notion sprint) · the policy list: every policy the carriers' files hold, filtered, sorted,
 * totalled for exactly what is shown, exported as shown, and saved as a named filter. The filter
 * lives in the address, so a filtered list can be bookmarked or sent to a colleague.
 */
export function PolicyBook({ rows, initialQuery, saved, savedAvailable, scoped, readOnly }: { rows: BookRow[]; initialQuery: string; saved: Saved[]; savedAvailable: boolean; scoped: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const initial = useMemo(() => readQuery(initialQuery), [initialQuery]);
  const [filters, setFilters] = useState<BookFilters>(initial.filters);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(() => Boolean(initial.filters.product || initial.filters.agent || initial.filters.agency || initial.filters.lead || initial.filters.issuedFrom || initial.filters.issuedTo));
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

  // The address follows the filter (replaceState: no reload, no history entry per keystroke).
  const query = writeQuery(filters, sort);
  useEffect(() => {
    const url = new URL(window.location.href);
    const view = url.searchParams.get("view");
    const next = new URLSearchParams(query);
    if (view) next.set("view", view);
    const search = next.toString();
    if (url.search.replace(/^\?/, "") !== search) window.history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}`);
  }, [query]);

  const options = useMemo(() => {
    const unique = <T,>(values: T[]) => [...new Set(values)];
    const carriers = unique(rows.map((row) => `${row.carrierId}|${row.carrierName}`)).map((pair) => { const [id, name] = pair.split("|"); return { id, name }; }).sort((a, b) => a.name.localeCompare(b.name));
    const agents = unique(rows.filter((row) => row.agentUserId).map((row) => `${row.agentUserId}|${row.agentName ?? "An agent"}`)).map((pair) => { const [id, name] = pair.split("|"); return { id, name }; }).sort((a, b) => a.name.localeCompare(b.name));
    const sortText = (values: Array<string | null>) => unique(values.filter((value): value is string => Boolean(value))).sort((a, b) => a.localeCompare(b));
    return { carriers, agents, products: sortText(rows.map((row) => row.product)), leads: sortText(rows.map((row) => row.leadSource)), agencies: sortText(rows.map((row) => row.agency)), statuses: STATUS_VOCABULARY.filter((status) => rows.some((row) => row.status === status)), anyUnassigned: rows.some((row) => !row.agentUserId) };
  }, [rows]);

  const visible = useMemo(() => sortRows(filterRows(rows, filters), sort), [rows, filters, sort]);
  const sum = useMemo(() => totals(visible), [visible]);
  const { current, rows: pageRows } = paginate(visible, page, 25);
  const set = (key: keyof BookFilters, value: string) => { setFilters((now) => ({ ...now, [key]: value })); setPage(1); };
  const clear = () => { setFilters(EMPTY_FILTERS); setPage(1); };
  const filtered = activeFilterCount(filters) > 0 || Boolean(filters.q.trim());
  const savedNow = saved.find((item) => item.query === query && query);

  function toggleSort(key: SortKey) {
    setSort((now) => (now.key === key ? { key, dir: now.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "client" || key === "carrier" || key === "product" || key === "policy" || key === "agent" ? "asc" : "desc" }));
    setPage(1);
  }

  function exportCsv() {
    const blob = new Blob([`﻿${toCsv(CSV_HEADER, csvRows(visible))}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `policies-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/app/policy-book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(done);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  function saveCurrent() {
    const name = (naming ?? "").trim();
    if (!name) return;
    setNaming(null);
    void post({ action: "save_filter", name, query }, `Saved as "${name}".`);
  }

  return (
    <>
      <StatStrip label="The policies shown">
        <StatTile label="Policies" value={sum.count.toLocaleString("en-US")} footnote={filtered ? `of ${rows.length.toLocaleString("en-US")}${scoped ? " credited to you" : ""}` : scoped ? "credited to you" : "in your book"} />
        <StatTile label="Annual premium" value={money(sum.annualCents)} footnote={sum.withoutPremium ? `${money(sum.monthlyCents)} a month · ${sum.withoutPremium.toLocaleString("en-US")} without a premium` : `${money(sum.monthlyCents)} a month`} />
        <StatTile label="At risk" value={sum.atRisk.toLocaleString("en-US")} valueTone={sum.atRisk ? "warning" : undefined} footnote="behind on payment, save window open" />
      </StatStrip>

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {filtered && <ClearFiltersButton onClick={clear} />}
            {savedAvailable && !readOnly && filtered && !savedNow && <Button type="button" variant="outline" disabled={busy} onClick={() => setNaming("")}>Save filter</Button>}
            <Button type="button" variant="outline" disabled={!visible.length} onClick={exportCsv} title="The policies shown, in the order shown"><Download aria-hidden="true" />Export CSV</Button>
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={filters.q} onChange={(value) => set("q", value)} placeholder="Search client, policy or agent" />
            <select aria-label="Filter by carrier" className={toolbarControl} value={filters.carrier} onChange={(event) => set("carrier", event.target.value)}>
              <option value="">All carriers</option>
              {options.carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
            </select>
            <select aria-label="Filter by status" className={toolbarControl} value={filters.status} onChange={(event) => set("status", event.target.value)}>
              <option value="">All statuses</option>
              {options.statuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status].label}</option>)}
            </select>
            <select aria-label="Filter by risk" className={toolbarControl} value={filters.risk} onChange={(event) => set("risk", event.target.value)}>
              <option value="">Any risk</option>
              {(Object.keys(RISK_LABELS) as RiskBand[]).map((band) => <option key={band} value={band}>{RISK_LABELS[band]}</option>)}
            </select>
            <FilterButton open={more} count={[filters.product, filters.agent, filters.agency, filters.lead, filters.issuedFrom, filters.issuedTo].filter(Boolean).length} onClick={() => setMore(!more)}>More filters</FilterButton>
            {saved.length > 0 && (
              <select aria-label="Saved filters" className={toolbarControl} value={savedNow?.id ?? ""} onChange={(event) => { const pick = saved.find((item) => item.id === event.target.value); if (pick) { const next = readQuery(pick.query); setFilters(next.filters); setSort(next.sort); setPage(1); } }}>
                <option value="">Saved filters…</option>
                {saved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            )}
            {savedNow && !readOnly && <Button type="button" variant="ghost" disabled={busy} onClick={() => void post({ action: "delete_filter", id: savedNow.id }, `"${savedNow.name}" removed.`)}>Remove &ldquo;{savedNow.name}&rdquo;</Button>}
          </DataToolbar>
        }
        footer={rows.length ? <Pager page={current} pageSize={25} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "policy" : "policies"} /> : undefined}
      >
        {more && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <select aria-label="Filter by product" className={toolbarControl} value={filters.product} onChange={(event) => set("product", event.target.value)}>
              <option value="">All products</option>
              {options.products.map((product) => <option key={product} value={product}>{product}</option>)}
            </select>
            <select aria-label="Filter by agent" className={toolbarControl} value={filters.agent} onChange={(event) => set("agent", event.target.value)}>
              <option value="">All agents</option>
              {options.anyUnassigned && <option value={NONE}>No agent mapped</option>}
              {options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <select aria-label="Filter by lead source" className={toolbarControl} value={filters.lead} onChange={(event) => set("lead", event.target.value)}>
              <option value="">Any lead source</option>
              <option value={NONE}>No lead source</option>
              {options.leads.map((lead) => <option key={lead} value={lead}>{lead}</option>)}
            </select>
            {options.agencies.length > 1 && (
              <select aria-label="Filter by agency" className={toolbarControl} value={filters.agency} onChange={(event) => set("agency", event.target.value)}>
                <option value="">All agencies</option>
                {options.agencies.map((agency) => <option key={agency} value={agency}>{agency}</option>)}
              </select>
            )}
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              Issued
              <input type="date" aria-label="Issued from" className={toolbarControl} value={filters.issuedFrom} max={filters.issuedTo || undefined} onChange={(event) => set("issuedFrom", event.target.value)} />
              <span aria-hidden="true">–</span>
              <input type="date" aria-label="Issued to" className={toolbarControl} value={filters.issuedTo} min={filters.issuedFrom || undefined} onChange={(event) => set("issuedTo", event.target.value)} />
            </span>
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState title={scoped ? "No policies are credited to you yet" : "No policies from carrier files yet"} hint={scoped ? "Policies appear once a carrier's file names you as the writing agent and the code is mapped to you." : "Import each carrier's latest policy file in Import your book, and they appear here."} />
        ) : visible.length === 0 ? (
          <NoMatches noun="policies" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column.key} className={column.className} title={column.title} aria-sort={sort.key === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="inline-flex items-center gap-1 font-semibold [letter-spacing:inherit] [text-transform:inherit] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" onClick={() => toggleSort(column.key)}>
                      {column.label}<span aria-hidden="true" className={sort.key === column.key ? "" : "opacity-30"}>{sort.key === column.key && sort.dir === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={`${row.carrierId}|${row.policyNumber}`}>
                  <td className="max-w-[180px]">
                    <Link href={policyHref(row)} className="font-semibold text-foreground hover:underline">{row.clientName ?? <span className="font-normal text-muted-foreground">No client linked</span>}</Link>
                    {row.provisional && <span className="mt-0.5 block"><ProvisionalBadge /></span>}
                  </td>
                  <td className="max-w-[120px] truncate" title={row.carrierName}>{row.carrierName}</td>
                  <td className="max-w-[100px] truncate" title={row.product ?? undefined}>{row.product ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="font-mono text-xs"><Link href={policyHref(row)} className="hover:underline">{row.policyNumber}</Link></td>
                  <td className="text-right tabular-nums">{row.premiumCents === null ? "—" : <>{money2(row.premiumCents)}<span className="text-xs text-muted-foreground">{row.premiumMode ? MODE_SHORT[row.premiumMode] ?? "" : ""}</span></>}</td>
                  <td className="text-right tabular-nums">{money(row.faceCents)}</td>
                  <td><span title={row.statusRaw ? `The carrier's word: ${row.statusRaw}` : undefined}><StatusChip tone={STATUS_TONE[row.status ?? ""] ?? "neutral"}>{statusLabel(row.status)}</StatusChip></span></td>
                  <td className={`text-right tabular-nums ${row.daysPastDue ? "text-[var(--warning-ink)]" : "text-muted-foreground"}`}>{row.daysPastDue ?? "—"}</td>
                  <td>{inForce(row.status) ? <span title={row.daysLeft !== null ? `${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"} until the carrier closes it` : undefined}><StatusChip tone={RISK_TONE[row.riskBand]}>{RISK_LABELS[row.riskBand]}</StatusChip></span> : <span className="text-muted-foreground" title="Not in force, so no save window">—</span>}</td>
                  <td className="tabular-nums">{fileDay(row.issueDate)}</td>
                  <td className="max-w-[104px] truncate" title={row.agentName ?? "No agent code mapped"}>{row.agentName ?? <span className="text-muted-foreground">Not mapped</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <Dialog open={naming !== null} onOpenChange={(open) => { if (!open) setNaming(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Save this filter</DialogTitle>
            <DialogDescription>Only you see your saved filters.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-1.5" onSubmit={(event) => { event.preventDefault(); saveCurrent(); }}>
            <Label htmlFor="saved-filter-name">Name</Label>
            <Input id="saved-filter-name" className="h-9" maxLength={60} autoFocus placeholder="e.g. Americo at risk" value={naming ?? ""} onChange={(event) => setNaming(event.target.value)} />
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNaming(null)}>Cancel</Button>
            <Button type="button" disabled={!naming?.trim() || busy} onClick={saveCurrent}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
