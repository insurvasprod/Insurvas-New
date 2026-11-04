"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { MoneyBar } from "@/components/app/book/policy/money-bar";
import { ProvisionalBadge } from "@/components/app/provisional-badge";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClearFiltersButton, DataToolbar, FilterButton, FilterPanel, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { control, Field } from "@/components/ui/field";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { CSV_HEADER, csvRows, EMPTY_FILTERS, filterRows, NONE, readQuery, sortRows, toCsv, writeQuery, type BookFilters, type BookRow, type Sort, type SortKey } from "@/lib/ingestion/policyBook";
import { matchesShow, SHOWS, shortDay, showOf, type BookStrip, type ListMoney, type Show } from "@/lib/ingestion/policyMoney";
import { STATUS_LABELS, STATUS_VOCABULARY } from "@/lib/ingestion/statuses";
import { notify } from "@/lib/notify";

const money2 = (value: number | null) => (value === null ? "—" : `$${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const whole = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value < 0 ? "−" : ""}$${Math.abs(Math.round(value / 100)).toLocaleString("en-US")}`);
const MODE_SHORT: Record<string, string> = { monthly: "/mo", quarterly: "/qtr", semiannual: "/6 mo", annual: "/yr" };

export const policyHref = (row: { carrierId: string; policyNumber: string }) => `/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}`;

export type PolicyListRow = BookRow & { money: ListMoney | null };
type Saved = { id: string; name: string; query: string };

/** The columns that sort (board 6's seven; Commission and Next date read across, so they don't). */
const COLUMNS: Array<{ label: string; sort?: SortKey; className?: string; title?: string }> = [
  { label: "Policy", sort: "policy" },
  { label: "Carrier · product", sort: "carrier" },
  { label: "Health", sort: "dpd", title: "Paid to, payments behind, or the policy's status; sorted by days behind" },
  { label: "Premium", sort: "premium", className: "text-right", title: "Premium as the carrier bills it; sorted by its yearly amount" },
  { label: "Commission", title: "First year: earned (green), advance not yet earned (amber), short (red), still to come" },
  { label: "Next date", title: "The one date that matters now: next draft, grace end, first draft or anniversary" },
  { label: "Agent", sort: "agent" },
];

/**
 * Book of business › Policies (round 5, board 6): the book at a glance and where every policy's money stands.
 * A strip whose every figure opens the rows behind it, the owner's questions as chips on the toolbar, and one
 * row per policy that opens it (board 10). The filter lives in the address (LA-4.11), so a filtered list can be
 * bookmarked, sent, or saved as a named filter.
 */
export function PolicyBook({ rows, strip, initialQuery, saved, savedAvailable, scoped, readOnly, canAddRate }: {
  rows: PolicyListRow[];
  strip: BookStrip | null;
  initialQuery: string;
  saved: Saved[];
  savedAvailable: boolean;
  scoped: boolean;
  readOnly: boolean;
  /** Owner and bookkeeper: "Add the rate" on a row no rate can price (as the Rate card). */
  canAddRate: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const initial = useMemo(() => readQuery(initialQuery), [initialQuery]);
  const [filters, setFilters] = useState<BookFilters>(initial.filters);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const [show, setShow] = useState<Show>(() => showOf(new URLSearchParams(initialQuery).get("show")));
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(() => Boolean(initial.filters.status || initial.filters.risk || initial.filters.source || initial.filters.product || initial.filters.agency || initial.filters.lead || initial.filters.issuedFrom || initial.filters.issuedTo));
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

  // The address follows the filter (replaceState: no reload, no history entry per keystroke).
  const query = writeQuery(filters, sort);
  useEffect(() => {
    const url = new URL(window.location.href);
    const next = new URLSearchParams(query);
    const view = url.searchParams.get("view");
    if (view) next.set("view", view);
    if (show) next.set("show", show);
    const search = next.toString();
    if (url.search.replace(/^\?/, "") !== search) window.history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}`);
  }, [query, show]);

  const options = useMemo(() => {
    const unique = <T,>(values: T[]) => [...new Set(values)];
    const carriers = unique(rows.map((row) => `${row.carrierId}|${row.carrierName}`)).map((pair) => { const [id, name] = pair.split("|"); return { id, name }; }).sort((a, b) => a.name.localeCompare(b.name));
    const agents = unique(rows.filter((row) => row.agentUserId).map((row) => `${row.agentUserId}|${row.agentName ?? "An agent"}`)).map((pair) => { const [id, name] = pair.split("|"); return { id, name }; }).sort((a, b) => a.name.localeCompare(b.name));
    const sortText = (values: Array<string | null>) => unique(values.filter((value): value is string => Boolean(value))).sort((a, b) => a.localeCompare(b));
    return { carriers, agents, products: sortText(rows.map((row) => row.product)), leads: sortText(rows.map((row) => row.leadSource)), agencies: sortText(rows.map((row) => row.agency)), statuses: STATUS_VOCABULARY.filter((status) => rows.some((row) => row.status === status)), anyUnassigned: rows.some((row) => !row.agentUserId), anyHand: rows.some((row) => Boolean(row.source)) };
  }, [rows]);

  // The chips count what the other filters leave, so each number is what pressing it shows.
  const filtered = useMemo(() => filterRows(rows, filters) as PolicyListRow[], [rows, filters]);
  const counts = useMemo(() => Object.fromEntries(SHOWS.map((s) => [s.key, filtered.filter((row) => matchesShow(row.money?.flags ?? null, s.key)).length])) as Record<Show, number>, [filtered]);
  const visible = useMemo(() => sortRows(filtered.filter((row) => matchesShow(row.money?.flags ?? null, show)), sort) as PolicyListRow[], [filtered, show, sort]);
  const pageSize = useFittingPageSize(400, 57);
  const { current, rows: pageRows } = paginate(visible, page, pageSize);
  const set = (key: keyof BookFilters, value: string) => { setFilters((now) => ({ ...now, [key]: value })); setPage(1); };
  const pick = (next: Show) => { setShow(next); setPage(1); };
  const clear = () => { setFilters(EMPTY_FILTERS); setShow(""); setPage(1); };
  const moreCount = [filters.carrier, filters.agent, filters.status, filters.risk, filters.source, filters.product, filters.agency, filters.lead, filters.issuedFrom, filters.issuedTo].filter(Boolean).length;
  const anyFilter = Boolean(show || filters.q.trim() || filters.carrier || filters.agent || moreCount);
  const savedNow = saved.find((item) => item.query === query && query);
  const chips = SHOWS.filter((s) => !("fromStrip" in s) || s.key === show);

  function toggleSort(key: SortKey) {
    setSort((now) => (now.key === key ? { key, dir: now.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "carrier" || key === "policy" || key === "agent" ? "asc" : "desc" }));
    setPage(1);
  }

  function exportCsv() {
    const blob = new Blob([`﻿${toCsv([...CSV_HEADER, "Health", "Commission", "Next date"], csvRows(visible).map((line, index) => [...line, visible[index].money?.health.label ?? null, visible[index].money?.sentence ?? null, visible[index].money?.next ? `${visible[index].money?.next?.label} ${visible[index].money?.next?.date}` : null]))}`], { type: "text/csv;charset=utf-8" });
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

  const atRisk = strip?.atRisk ?? null;
  return (
    <>
      {/* Every figure opens the rows behind it (board 6, §16). */}
      <StatStrip label="Your book">
        <StatTile label="In force" value={strip ? strip.inForce.count.toLocaleString("en-US") : "—"} footnote={strip ? `${whole(strip.inForce.monthlyCents)} / month premium` : undefined} href="/app/policies?show=inforce" />
        <StatTile label="Commission this year" value={strip?.expectedThisYear ? whole(strip.expectedThisYear.cents) : "—"} footnote={!strip?.expectedThisYear ? "expected commission can't be read" : strip.expectedThisYear.unpriced ? `expected from the rate card · ${strip.expectedThisYear.unpriced.toLocaleString("en-US")} with no rate` : "expected from the rate card"} href="/app/policies?show=expected" />
        <StatTile label="Received so far" value={strip?.receivedThisYear !== null && strip?.receivedThisYear !== undefined ? whole(strip.receivedThisYear) : "—"} footnote={strip ? `on the statements, ${strip.year}` : undefined} href="/app/policies?show=received" />
        <StatTile label="Advance at risk" value={atRisk && atRisk.cents !== null ? whole(atRisk.cents) : "—"} valueTone={atRisk?.cents ? "warning" : undefined} footnote={!atRisk ? "the ledger can't be read" : atRisk.cents === null ? (atRisk.unknown ? `${atRisk.unknown.toLocaleString("en-US")} advances with no months to spread them` : "no advance on file") : `on ${atRisk.policies.toLocaleString("en-US")} ${atRisk.policies === 1 ? "policy" : "policies"}${atRisk.unknown ? ` · ${atRisk.unknown.toLocaleString("en-US")} unknown` : ""}`} href="/app/policies?show=risk" />
        <StatTile label="Short or late" value={strip?.short ? whole(strip.short.cents) : "—"} valueTone={strip?.short?.cents ? "danger" : undefined} footnote={!strip?.short ? "pay issues can't be read" : `${strip.short.policies.toLocaleString("en-US")} ${strip.short.policies === 1 ? "policy" : "policies"} · in Pay issues`} href="/app/policies?show=short" />
      </StatStrip>

      <TableCard
        toolbar={
          // Board 6: search and the chips on one row; Carrier, Agent and the rarer filters behind one button, Refresh
          // last as its icon, and Export on the footer line beside the pager.
          <DataToolbar actions={<>
            <FilterButton open={more} count={moreCount} controls="policy-filters" onClick={() => setMore(!more)} title="More filters"><span className="sr-only">More filters</span></FilterButton>
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} labelClassName="sr-only" />
          </>}>
            <ToolbarSearch value={filters.q} onChange={(value) => set("q", value)} placeholder="Policy, client or agent" className="sm:w-52" />
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-2">
              {chips.map((s) => (
                <ToggleChip key={s.key || "all"} role="radio" selected={show === s.key} onClick={() => pick(s.key)} count={counts[s.key].toLocaleString("en-US")} countTone={s.key && s.key !== "inforce" && s.key !== "expected" && s.key !== "received" && counts[s.key] ? (s.key === "lapsed" || s.key === "short" ? "danger" : "warning") : undefined}>{s.label}</ToggleChip>
              ))}
            </div>
            {anyFilter && <ClearFiltersButton onClick={clear} />}
          </DataToolbar>
        }
        filters={
          // Inline under the toolbar (UI-CONSISTENCY §6a): the rarer filters, and saved filters.
          <FilterPanel id="policy-filters" open={more}>
            {/* Carrier and Agent sit here so the toolbar stays one row at 1440 with the rail open (owner rule). */}
            <Field label="Carrier" htmlFor="policy-filter-carrier"><select id="policy-filter-carrier" aria-label="Carrier" className={control} value={filters.carrier} onChange={(event) => set("carrier", event.target.value)}>
              <option value="">Every carrier</option>
              {options.carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
            </select></Field>
            <Field label="Agent" htmlFor="policy-filter-agent"><select id="policy-filter-agent" aria-label="Agent" className={control} value={filters.agent} onChange={(event) => set("agent", event.target.value)}>
              <option value="">Every agent</option>
              {options.anyUnassigned && <option value={NONE}>No agent mapped</option>}
              {options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select></Field>
            <Field label="Status" htmlFor="policy-filter-status"><select id="policy-filter-status" aria-label="Filter by status" className={control} value={filters.status} onChange={(event) => set("status", event.target.value)}>
              <option value="">All statuses</option>
              {options.statuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status].label}</option>)}
            </select></Field>
            {(options.anyHand || filters.source) && <Field label="Source" htmlFor="policy-filter-source"><select id="policy-filter-source" aria-label="Filter by source" className={control} value={filters.source} onChange={(event) => set("source", event.target.value)}>
              <option value="">Every source</option>
              <option value="carrier">From carrier files</option>
              <option value="hand">Entered by hand</option>
              <option value="issued">Recorded sales, awaiting file</option>
            </select></Field>}
            <Field label="Product" htmlFor="policy-filter-product"><select id="policy-filter-product" aria-label="Filter by product" className={control} value={filters.product} onChange={(event) => set("product", event.target.value)}>
              <option value="">All products</option>
              {options.products.map((product) => <option key={product} value={product}>{product}</option>)}
            </select></Field>
            <Field label="Lead source" htmlFor="policy-filter-lead"><select id="policy-filter-lead" aria-label="Filter by lead source" className={control} value={filters.lead} onChange={(event) => set("lead", event.target.value)}>
              <option value="">Any lead source</option>
              <option value={NONE}>No lead source</option>
              {options.leads.map((lead) => <option key={lead} value={lead}>{lead}</option>)}
            </select></Field>
            {options.agencies.length > 1 && <Field label="Agency" htmlFor="policy-filter-agency"><select id="policy-filter-agency" aria-label="Filter by agency" className={control} value={filters.agency} onChange={(event) => set("agency", event.target.value)}>
              <option value="">All agencies</option>
              {options.agencies.map((agency) => <option key={agency} value={agency}>{agency}</option>)}
            </select></Field>}
            <Field label="Issued from" htmlFor="policy-filter-from"><input id="policy-filter-from" type="date" aria-label="Issued from" className={control} value={filters.issuedFrom} max={filters.issuedTo || undefined} onChange={(event) => set("issuedFrom", event.target.value)} /></Field>
            <Field label="Issued to" htmlFor="policy-filter-to"><input id="policy-filter-to" type="date" aria-label="Issued to" className={control} value={filters.issuedTo} min={filters.issuedFrom || undefined} onChange={(event) => set("issuedTo", event.target.value)} /></Field>
            {saved.length > 0 && <Field label="Saved filters" htmlFor="policy-saved"><select id="policy-saved" aria-label="Saved filters" className={control} value={savedNow?.id ?? ""} onChange={(event) => { const choice = saved.find((item) => item.id === event.target.value); if (choice) { const next = readQuery(choice.query); setFilters(next.filters); setSort(next.sort); setPage(1); } }}>
              <option value="">Saved filters…</option>
              {saved.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></Field>}
            {savedAvailable && !readOnly && (
              <div className="flex items-end gap-2">
                {query && !savedNow && <Button type="button" variant="outline" disabled={busy} onClick={() => setNaming("")}>Save filter</Button>}
                {savedNow && <Button type="button" variant="ghost" disabled={busy} onClick={() => void (async () => {
                  // A loss asks first (UI-CONSISTENCY §11).
                  const ok = await confirmAction({ title: `Remove "${savedNow.name}"?`, description: "Your saved filter goes. The policies it shows are not touched.", confirmLabel: "Remove", cancelLabel: "Keep it" });
                  if (ok) await post({ action: "delete_filter", id: savedNow.id }, `"${savedNow.name}" removed.`);
                })()}>Remove &ldquo;{savedNow.name}&rdquo;</Button>}
              </div>
            )}
          </FilterPanel>
        }
        footer={rows.length ? (
          <>
            <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "policy" : "policies"} />
            <Button type="button" variant="outline" disabled={!visible.length} onClick={exportCsv} title="The policies shown, in the order shown"><Download aria-hidden="true" />Export</Button>
          </>
        ) : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title={scoped ? "No policies are credited to you yet" : "No policies from carrier files yet"} hint={scoped ? "Policies appear once a carrier's file names you as the writing agent and the code is mapped to you." : "Upload each carrier's latest policy file in Files, and they appear here."} />
        ) : visible.length === 0 ? (
          <NoMatches noun="policies" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column.label} className={column.className} title={column.title} aria-sort={column.sort && sort.key === column.sort ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    {column.sort ? (
                      <button type="button" className="inline-flex items-center gap-1 font-semibold [letter-spacing:inherit] [text-transform:inherit] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" onClick={() => toggleSort(column.sort as SortKey)}>
                        {column.label}<span aria-hidden="true" className={sort.key === column.sort ? "" : "opacity-30"}>{sort.key === column.sort && sort.dir === "asc" ? "↑" : "↓"}</span>
                      </button>
                    ) : column.label}
                  </th>
                ))}
                <th className="w-8"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const href = row.href ?? policyHref(row);
                const m = row.money;
                return (
                  <tr key={`${row.source ?? "carrier"}|${row.carrierId}|${row.policyNumber}`} className="group cursor-pointer" onClick={(event) => { if ((event.target as HTMLElement).closest("a, button")) return; router.push(href); }}>
                    <td className="max-w-[180px]">
                      <span className="block truncate font-mono text-sm font-semibold text-foreground">{row.policyNumber}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate">{row.clientName ?? "No client linked"}</span>
                        {row.provisional && <ProvisionalBadge />}
                      </span>
                    </td>
                    <td className="max-w-[170px]">
                      <span className="block truncate text-foreground" title={row.carrierName}>{row.carrierName}</span>
                      <span className="block truncate text-xs text-muted-foreground" title={row.product ?? undefined}>{row.product ?? (row.source === "hand" ? "Entered by hand" : "—")}</span>
                    </td>
                    <td>{m ? <span title={row.statusRaw ? `The carrier's word: ${row.statusRaw}` : undefined}><StatusChip tone={m.health.tone}>{m.health.label}</StatusChip></span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-right tabular-nums">{row.premiumCents === null ? "—" : <>{money2(row.premiumCents)}<span className="text-xs text-muted-foreground">{row.premiumMode ? MODE_SHORT[row.premiumMode] ?? "" : ""}</span></>}</td>
                    <td className="min-w-[200px] max-w-[300px]">
                      {m?.bar && <MoneyBar parts={m.bar} label={m.sentence} />}
                      <span className={`mt-1 block truncate text-xs ${m?.bar ? "text-[var(--body)]" : "text-muted-foreground"}`} title={m?.sentence}>
                        {m?.sentence ?? "—"}
                        {m?.addRate && (canAddRate ? <> · <Link href="/app/rate-card" className="font-semibold text-[var(--accent-ink)] hover:underline">Add the rate</Link></> : " · no rate on the Rate card")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{m?.next ? <><span className="text-muted-foreground">{m.next.label} </span><span className="text-foreground">{shortDay(m.next.date)}</span></> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-[150px]" title={row.agentName ?? (row.source === "hand" ? "Entered by hand: no writing agent on file" : "No agent code mapped")}><span className="block truncate">{row.agentName ?? <span className="text-muted-foreground">{row.source === "hand" ? "—" : "Not mapped"}</span>}</span></td>
                    <td className="w-8 text-right"><Link href={row.href ?? policyHref(row)} aria-label={`Open policy ${row.policyNumber}`} className="text-muted-foreground group-hover:text-foreground">›</Link></td>
                  </tr>
                );
              })}
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
            <Input id="saved-filter-name" className="h-9" maxLength={60} autoFocus placeholder="e.g. Americo behind on payment" value={naming ?? ""} onChange={(event) => setNaming(event.target.value)} />
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

