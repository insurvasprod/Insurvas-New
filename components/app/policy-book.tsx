"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { ProvisionalBadge } from "@/components/app/provisional-badge";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClearFiltersButton, DataToolbar, FilterButton, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { control, Field } from "@/components/ui/field";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { activeFilterCount, inForce, CSV_HEADER, csvRows, EMPTY_FILTERS, filterRows, NONE, readQuery, RISK_LABELS, rowStatusLabel, sortRows, toCsv, totals, writeQuery, type BookFilters, type BookRow, type RiskBand, type Sort, type SortKey } from "@/lib/ingestion/policyBook";
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
  { key: "carrier", label: "Carrier", className: "w-[140px]" },
  { key: "product", label: "Product", className: "w-[100px]" },
  { key: "policy", label: "Policy", className: "w-[100px]" },
  { key: "premium", label: "Premium", className: "w-[96px] text-right", title: "Premium as the carrier bills it; sorted by its yearly amount" },
  { key: "face", label: "Face", className: "w-[84px] text-right" },
  { key: "status", label: "Status", className: "w-[96px]", title: "Our status; hover a status for the carrier's own word" },
  { key: "dpd", label: "Late", className: "w-[56px] text-right", title: "Days past the paid-to date" },
  { key: "risk", label: "Risk", className: "w-[84px]" },
  { key: "issued", label: "Issued", className: "w-[96px]" },
  { key: "agent", label: "Agent", className: "w-[120px]" },
];

/**
 * LA-4.11 (Notion sprint) · the policy list: every policy the carriers' files hold, filtered, sorted,
 * totalled for exactly what is shown, exported as shown, and saved as a named filter. The filter
 * lives in the address, so a filtered list can be bookmarked or sent to a colleague.
 */
/** The policy beside the list (2026-10-26, Policies A): where it stands, what is late, and the way in. */
function PolicyPreview({ row, onClose }: { row: BookRow; onClose: () => void }) {
  const href = row.href ?? policyHref(row);
  const atRisk = inForce(row.status) && !row.source && (row.riskBand === "at_risk" || row.riskBand === "critical");
  const fact = (label: string, value: React.ReactNode) => <span className="min-w-0"><span className="block text-xs font-semibold text-muted-foreground">{label}</span><span className="mt-0.5 block truncate text-sm text-foreground">{value}</span></span>;
  return (
    <DetailPanel
      mode="split"
      title={row.clientName ?? "No client linked"}
      subtitle={[row.carrierName, row.product, row.policyNumber].filter(Boolean).join(" · ")}
      status={<span className="flex flex-wrap gap-1.5"><StatusChip tone={row.source === "issued" ? "info" : STATUS_TONE[row.status ?? ""] ?? "neutral"}>{rowStatusLabel(row)}</StatusChip>{inForce(row.status) && !row.source && <StatusChip tone={RISK_TONE[row.riskBand]}>{RISK_LABELS[row.riskBand]}</StatusChip>}</span>}
      onClose={onClose}
      className="m-glass lg:sticky lg:top-[calc(var(--top-bar-h)+16px)] lg:self-start"
      footer={<div className="flex justify-end"><Button asChild><Link href={href}>Open the policy</Link></Button></div>}
    >
      <div className="grid grid-cols-2 gap-3">
        {fact("Premium", row.premiumCents === null ? "—" : `${money2(row.premiumCents)}${row.premiumMode ? MODE_SHORT[row.premiumMode] ?? "" : ""}`)}
        {fact("Face", money(row.faceCents))}
        {fact("Late", row.daysPastDue ? `${row.daysPastDue} days past the paid-to date` : "Not late")}
        {fact("Carrier closes it", row.daysLeft !== null && inForce(row.status) && !row.source ? `in ${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"}` : "—")}
        {fact("Agent", row.agentName ?? (row.source === "hand" ? "—" : "Not mapped"))}
        {fact("Lead source", row.leadSource ?? "Not known")}
        {fact("Issued", fileDay(row.issueDate))}
        {fact("Source", row.source === "hand" ? "Entered by hand" : row.source === "issued" ? "Recorded sale, awaiting the file" : "Carrier file")}
      </div>
      {row.statusRaw && <p className="m-0 text-xs text-muted-foreground">The carrier&rsquo;s word: {row.statusRaw}</p>}
      {atRisk && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--warning-surface)] px-3 py-2.5 text-sm text-[var(--warning-ink)]">
          <span>Behind on payment — {row.daysLeft !== null ? `the save window is open for ${row.daysLeft} more day${row.daysLeft === 1 ? "" : "s"}` : "the save window is open"}.</span>
          <Button asChild size="sm" variant="outline"><Link href="/app/save-queue">Open in Save queue</Link></Button>
        </div>
      )}
      {!row.clientName && !row.source && <p className="m-0 text-sm text-[var(--body)]">No client is linked to this policy. <Link href="/app/policy-matching" className="font-semibold underline">Link it in Policy matching</Link></p>}
    </DetailPanel>
  );
}

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
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const rowKey = (row: BookRow) => `${row.source ?? "carrier"}|${row.carrierId}|${row.policyNumber}`;

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
    return { carriers, agents, products: sortText(rows.map((row) => row.product)), leads: sortText(rows.map((row) => row.leadSource)), agencies: sortText(rows.map((row) => row.agency)), statuses: STATUS_VOCABULARY.filter((status) => rows.some((row) => row.status === status)), anyUnassigned: rows.some((row) => !row.agentUserId), anyHand: rows.some((row) => Boolean(row.source)) };
  }, [rows]);

  const visible = useMemo(() => sortRows(filterRows(rows, filters), sort), [rows, filters, sort]);
  const sum = useMemo(() => totals(visible), [visible]);
  const pageSize = useFittingPageSize(420, 45);
  const { current, rows: pageRows } = paginate(visible, page, pageSize);
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

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
      <TableCard
        className="min-w-0 flex-1"
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
            {(options.anyHand || filters.source) && (
              <select aria-label="Filter by source" className={toolbarControl} value={filters.source} onChange={(event) => set("source", event.target.value)}>
                <option value="">Every source</option>
                <option value="carrier">From carrier files</option>
                <option value="hand">Entered by hand</option>
                <option value="issued">Recorded sales, awaiting file</option>
              </select>
            )}
            <FilterButton open={more} count={[filters.product, filters.agent, filters.agency, filters.lead, filters.issuedFrom, filters.issuedTo].filter(Boolean).length} controls="policy-filters" onClick={() => setMore(!more)}>More filters</FilterButton>
            {saved.length > 0 && (
              <select aria-label="Saved filters" className={toolbarControl} value={savedNow?.id ?? ""} onChange={(event) => { const pick = saved.find((item) => item.id === event.target.value); if (pick) { const next = readQuery(pick.query); setFilters(next.filters); setSort(next.sort); setPage(1); } }}>
                <option value="">Saved filters…</option>
                {saved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            )}
            {savedNow && !readOnly && <Button type="button" variant="ghost" disabled={busy} onClick={() => void post({ action: "delete_filter", id: savedNow.id }, `"${savedNow.name}" removed.`)}>Remove &ldquo;{savedNow.name}&rdquo;</Button>}
          </DataToolbar>
        }
        filters={
          // Inline under the toolbar (UI-CONSISTENCY §6a): labelled fields that push the table down.
          <FilterPanel id="policy-filters" open={more}>
            <Field label="Product" htmlFor="policy-filter-product"><select aria-label="Filter by product" id="policy-filter-product" className={control} value={filters.product} onChange={(event) => set("product", event.target.value)}>
              <option value="">All products</option>
              {options.products.map((product) => <option key={product} value={product}>{product}</option>)}
            </select></Field>
            <Field label="Agent" htmlFor="policy-filter-agent"><select aria-label="Filter by agent" id="policy-filter-agent" className={control} value={filters.agent} onChange={(event) => set("agent", event.target.value)}>
              <option value="">All agents</option>
              {options.anyUnassigned && <option value={NONE}>No agent mapped</option>}
              {options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select></Field>
            <Field label="Lead source" htmlFor="policy-filter-lead"><select aria-label="Filter by lead source" id="policy-filter-lead" className={control} value={filters.lead} onChange={(event) => set("lead", event.target.value)}>
              <option value="">Any lead source</option>
              <option value={NONE}>No lead source</option>
              {options.leads.map((lead) => <option key={lead} value={lead}>{lead}</option>)}
            </select></Field>
            {options.agencies.length > 1 && <Field label="Agency" htmlFor="policy-filter-agency"><select aria-label="Filter by agency" id="policy-filter-agency" className={control} value={filters.agency} onChange={(event) => set("agency", event.target.value)}>
                <option value="">All agencies</option>
                {options.agencies.map((agency) => <option key={agency} value={agency}>{agency}</option>)}
              </select></Field>}
            <Field label="Issued from" htmlFor="policy-filter-from"><input id="policy-filter-from" type="date" aria-label="Issued from" className={control} value={filters.issuedFrom} max={filters.issuedTo || undefined} onChange={(event) => set("issuedFrom", event.target.value)} /></Field>
            <Field label="Issued to" htmlFor="policy-filter-to"><input id="policy-filter-to" type="date" aria-label="Issued to" className={control} value={filters.issuedTo} min={filters.issuedFrom || undefined} onChange={(event) => set("issuedTo", event.target.value)} /></Field>
          </FilterPanel>
        }
        footer={rows.length ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "policy" : "policies"} /> : undefined}
      >
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
                <tr key={rowKey(row)} className={previewKey === rowKey(row) ? "cursor-pointer bg-[var(--primary-soft)] shadow-[inset_3px_0_0_var(--primary)]" : "cursor-pointer"} onClick={(event) => { if ((event.target as HTMLElement).closest("a, button")) return; setPreviewKey(previewKey === rowKey(row) ? null : rowKey(row)); }}>
                  <td className="max-w-[180px]">
                    <Link href={row.href ?? policyHref(row)} className="font-semibold text-foreground hover:underline">{row.clientName ?? <span className="font-normal text-muted-foreground">No client linked</span>}</Link>
                    {row.provisional && <span className="mt-0.5 block"><ProvisionalBadge /></span>}
                  </td>
                  <td><span className="block whitespace-normal break-words leading-snug">{row.carrierName}</span></td>
                  <td>{row.product ? <span className="block whitespace-normal break-words leading-snug">{row.product}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="tabular-nums"><Link href={row.href ?? policyHref(row)} className="hover:underline">{row.policyNumber}</Link>{row.source && <span className="block text-xs text-muted-foreground">{row.source === "hand" ? "Entered by hand" : "Recorded sale"}</span>}</td>
                  <td className="text-right tabular-nums">{row.premiumCents === null ? "—" : <>{money2(row.premiumCents)}<span className="text-xs text-muted-foreground">{row.premiumMode ? MODE_SHORT[row.premiumMode] ?? "" : ""}</span></>}</td>
                  <td className="text-right tabular-nums">{money(row.faceCents)}</td>
                  <td><span title={row.statusRaw ? `The carrier's word: ${row.statusRaw}` : undefined}><StatusChip tone={row.source === "issued" ? "info" : STATUS_TONE[row.status ?? ""] ?? "neutral"}>{rowStatusLabel(row)}</StatusChip></span></td>
                  <td className={`text-right tabular-nums ${row.daysPastDue ? "text-[var(--warning-ink)]" : "text-muted-foreground"}`}>{row.daysPastDue ?? "—"}</td>
                  <td>{inForce(row.status) && !row.source ? <span title={row.daysLeft !== null ? `${row.daysLeft} day${row.daysLeft === 1 ? "" : "s"} until the carrier closes it` : undefined}><StatusChip tone={RISK_TONE[row.riskBand]}>{RISK_LABELS[row.riskBand]}</StatusChip></span> : <span className="text-muted-foreground" title={row.source === "hand" ? "Entered by hand: no carrier file to read a payment from" : row.source === "issued" ? "No carrier file yet to read a payment from" : "Not in force, so no save window"}>—</span>}</td>
                  <td className="tabular-nums">{fileDay(row.issueDate)}</td>
                  <td title={row.agentName ? undefined : row.source === "hand" ? "Entered by hand: no writing agent on file" : "No agent code mapped"}><span className="block whitespace-normal break-words leading-snug">{row.agentName ?? <span className="text-muted-foreground">{row.source === "hand" ? "—" : "Not mapped"}</span>}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {(() => { const open = previewKey ? visible.find((row) => rowKey(row) === previewKey) : null; return open ? <PolicyPreview key={previewKey} row={open} onClose={() => setPreviewKey(null)} /> : null; })()}
      </div>

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
