"use client";

import { useCallback, useEffect, useState } from "react";

import { Building2, CheckCircle2, Clock3, FileText, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { StatusChip } from "@/components/ui/status-chip";
import { Pager, paginate } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { PartnerStatement } from "@/lib/accounting/payoutsCore";
import { dayMonth, dayMonthYear } from "@/lib/format/dates";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.4 · the partner's own statements, in the portal it already logs into: it arrives at the
 * month's conversation already knowing the number, and disputes the one line it disagrees with.
 * Only what partnerStatement() whitelists reaches this screen.
 */
type RunRow = { id: string; periodStart: string; periodEnd: string; status: "published" | "paid"; netCents: number; paidOn: string | null };
const money = (c: number) => formatCentsAsCurrency(c);

/**
 * "1 Sep – 30 Sep 2026". The period came through as the two raw day strings the database stores;
 * a partner's statement is a month, and should read like one (lib/format/dates, §14).
 */
const period = (start: string, end: string) => `${dayMonth(start)} – ${dayMonthYear(end)}`;

function StatementMeta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0 self-end"><p className="m-0 text-xs font-medium text-muted-foreground">{label}</p><p className={`m-0 mt-1 truncate text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`} title={value}>{value}</p></div>;
}

function Statement({ id, onClose, partnerName }: { id: string; onClose: () => void; partnerName?: string }) {
  const [s, setS] = useState<PartnerStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispute, setDispute] = useState<{ itemId: string | null; reason: string; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/partner/payouts/${id}`).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Could not open the statement");
      else setS(body.statement);
    }).catch(() => { if (live) setError("Check your connection and try opening this statement again."); });
    return () => { live = false; };
  }, [id]);
  const raise = async () => {
    if (!dispute) return;
    const cents = dispute.amount.trim() ? parseDollarsToCents(dispute.amount) : 0;
    if (cents === null || cents < 0) { setError("Enter the amount in dollars and cents."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner/payouts/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id: dispute.itemId, reason: dispute.reason, claim_cents: cents }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't send");
      setS(body.statement);
      setDispute(null);
      notify.done("Dispute sent to the agency");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't send");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size="2xl" className="flex max-h-[min(90dvh,900px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-5 pr-14">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle>{s ? `Commission statement · ${period(s.periodStart, s.periodEnd)}` : "Commission statement"}</DialogTitle>
              <DialogDescription className="mt-1">Payout summary and itemized transfers for this statement period.</DialogDescription>
            </div>
            {s ? <StatusChip tone={s.status === "paid" ? "good" : "info"}>{s.status === "paid" ? `Paid${s.paidOn ? ` · ${dayMonthYear(s.paidOn)}` : ""}` : "Published"}</StatusChip> : null}
          </div>
          {s ? <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg border border-border bg-[var(--surface-alt)] px-4 py-3 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-1"><p className="m-0 text-xs font-medium text-muted-foreground">Net payable</p><p className="m-0 mt-1 text-2xl font-semibold tabular-nums text-foreground">{money(s.totals.netCents)}</p></div>
            <StatementMeta label="Transfers" value={`${s.items.length} ${s.items.length === 1 ? "item" : "items"}`} />
            <StatementMeta label="Statement period" value={period(s.periodStart, s.periodEnd)} />
            <StatementMeta label="Published" value={s.publishedAt ? dayMonthYear(s.publishedAt) : "—"} />
            <StatementMeta label="Statement ref" value={s.id.slice(0, 8).toUpperCase()} mono />
          </div> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error ? <p role="alert" className="mb-4 rounded-md border border-[var(--error)]/30 bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p> : null}
          {!s ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground" aria-live="polite">{error ? "Statement details could not be loaded." : "Loading statement details…"}</div> : (
            <div className="flex min-w-0 flex-col gap-5">
              <section className="grid min-w-0 gap-4 rounded-lg border border-border bg-[var(--surface-alt)]/55 p-4 sm:grid-cols-2" aria-label="Statement parties">
                <div className="min-w-0">
                  <p className="m-0 text-xs font-medium text-muted-foreground">Issued by</p>
                  <div className="mt-2 flex items-start gap-2.5"><Building2 size={17} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true"/><div className="min-w-0"><p className="m-0 font-semibold text-foreground">{s.from?.name || "Agency"}</p>{s.from?.addressLines.length ? <address className="mt-1 text-sm not-italic leading-5 text-muted-foreground">{s.from.addressLines.map((line, index) => <span key={`${index}-${line}`} className="block">{line}</span>)}</address> : null}</div></div>
                </div>
                <div className="min-w-0 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                  <p className="m-0 text-xs font-medium text-muted-foreground">Prepared for</p>
                  <p className="m-0 mt-2 font-semibold text-foreground">{partnerName || "Partner"}</p>
                  <p className="m-0 mt-1 text-sm text-muted-foreground">Commission statement recipient</p>
                </div>
              </section>
              <div className="flex min-w-0 flex-col gap-6">
                <section aria-labelledby="statement-summary-heading">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h3 id="statement-summary-heading" className="m-0 text-base font-semibold">Payout breakdown</h3><span className="text-sm text-muted-foreground">{s.items.length} {s.items.length === 1 ? "transfer" : "transfers"}</span></div>
                  <TableCard>
                    <Table>
                      <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-20 text-right">Count</TableHead><TableHead className="w-28 text-right">Rate</TableHead><TableHead className="w-32 text-right">Amount</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {s.lines.map((l) => <TableRow key={`${l.label}-${l.rateCents}`}><TableCell className="font-medium">{l.label}</TableCell><TableCell className="text-right tabular-nums">{l.count}</TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{l.rateCents != null ? money(l.rateCents) : "—"}</TableCell><TableCell className="text-right tabular-nums">{money(l.amountCents)}</TableCell></TableRow>)}
                        {s.revenueShare ? <TableRow><TableCell className="font-medium">Revenue share</TableCell><TableCell /><TableCell /><TableCell className="text-right tabular-nums">{money(s.revenueShare.amountCents)}</TableCell></TableRow> : null}
                        {s.rejectedCount ? <TableRow><TableCell className="font-medium">Rejected · compliance</TableCell><TableCell className="text-right tabular-nums">{s.rejectedCount}</TableCell><TableCell /><TableCell className="text-right text-muted-foreground">Not billable</TableCell></TableRow> : null}
                        {s.credits.count ? <TableRow><TableCell className="font-medium">Credits accepted</TableCell><TableCell className="text-right tabular-nums">{s.credits.count}</TableCell><TableCell /><TableCell className="text-right tabular-nums">{money(s.credits.amountCents)}</TableCell></TableRow> : null}
                        {s.totals.disputedCents ? <TableRow><TableCell className="font-medium">Disputed · withheld</TableCell><TableCell /><TableCell /><TableCell className="text-right tabular-nums">{money(-s.totals.disputedCents)}</TableCell></TableRow> : null}
                        <TableRow><TableCell colSpan={3} className="font-semibold">Net payable</TableCell><TableCell className="text-right font-semibold tabular-nums">{money(s.totals.netCents)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </TableCard>
                  {s.rejectedCount ? <p className="mt-2 text-xs text-muted-foreground">Transfers rejected at the agency&apos;s compliance check are not billable. The count identifies records you may want to review.</p> : null}
                </section>
                {s.disputes.length ? <section aria-labelledby="statement-disputes-heading" className="border-t border-border pt-4"><h3 id="statement-disputes-heading" className="mb-3 text-sm font-semibold">Disputes</h3><div className="flex flex-col gap-2">{s.disputes.map((d) => <div key={d.id} className="rounded-md border border-border px-3 py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{d.reason}</span><StatusChip tone={d.status === "open" ? "warning" : "neutral"}>{d.status === "open" ? "Under review" : d.status}</StatusChip></div><p className="mb-0 mt-1 text-xs text-muted-foreground">Raised by {d.raisedBy} · {money(d.amountCents)}{d.resolutionNote ? ` · ${d.resolutionNote}` : ""}</p></div>)}</div></section> : null}
                {s.footer ? <p className="m-0 border-t border-border pt-4 text-xs text-muted-foreground">{s.footer}</p> : null}
              </div>
              <section aria-labelledby="statement-transfers-heading">
                <div className="mb-3 flex items-baseline justify-between gap-3"><h3 id="statement-transfers-heading" className="m-0 text-sm font-semibold">Transfers in this statement</h3><span className="text-xs text-muted-foreground">{s.items.length} {s.items.length === 1 ? "item" : "items"}</span></div>
                <TableCard>
                  <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Transfer</TableHead><TableHead className="w-32 text-right">Amount</TableHead><TableHead className="w-24 text-right"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
                    <TableBody>{s.items.length ? s.items.map((i) => <TableRow key={i.id}><TableCell className="whitespace-nowrap text-muted-foreground">{dayMonth(i.occurredOn)}</TableCell><TableCell className="font-medium">{i.label}{i.reference ? <span className="block text-xs font-normal text-muted-foreground">Reference {i.reference}</span> : null}{i.disputed ? <span className="block text-xs font-medium text-[var(--warning-ink)]">Dispute submitted</span> : null}</TableCell><TableCell className="text-right tabular-nums">{money(i.amountCents)}</TableCell><TableCell className="text-right">{!i.disputed && !dispute ? <Button size="sm" variant="ghost" onClick={() => setDispute({ itemId: i.id, reason: "", amount: "" })}>Dispute</Button> : null}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">No transfers in this statement.</TableCell></TableRow>}</TableBody>
                  </Table>
                </TableCard>
              </section>
              {dispute ? <section className="rounded-lg border border-border p-4" aria-labelledby="statement-dispute-form-heading"><h3 id="statement-dispute-form-heading" className="mb-1 text-sm font-semibold">Tell the agency what needs review</h3><p className="mb-3 text-xs text-muted-foreground">{dispute.itemId ? "This dispute is linked to the selected transfer." : "Your message will be attached to this statement."}</p><label className="flex flex-col gap-1 text-sm">What is wrong?<input className={toolbarControl} value={dispute.reason} onChange={(e) => setDispute({ ...dispute, reason: e.target.value })} autoFocus /></label><label className="mt-3 flex flex-col gap-1 text-sm">Amount you believe is owed<input className={toolbarControl} inputMode="decimal" placeholder="0.00" value={dispute.amount} onChange={(e) => setDispute({ ...dispute, amount: e.target.value })} /><span className="text-xs text-muted-foreground">Enter dollars and cents. Leave blank if you are not disputing an amount.</span></label></section> : null}
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-border bg-card px-6 py-4 sm:justify-between">
          <div className="min-h-9" aria-live="polite">{busy ? <span className="text-sm text-muted-foreground">Sending dispute…</span> : null}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {dispute ? <><Button variant="outline" disabled={busy} onClick={() => setDispute(null)}>Cancel dispute</Button><Button disabled={busy || !dispute.reason.trim()} onClick={() => void raise()}>Send dispute</Button></> : <><Button variant="outline" onClick={onClose}>Close statement</Button>{s ? <Button variant="secondary" onClick={() => setDispute({ itemId: null, reason: "", amount: "" })}>Dispute statement</Button> : null}</>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sample statements for `/design/organization`; a partner's own page never passes them. */
export function PartnerPayouts({ sample, partnerName }: { sample?: RunRow[]; partnerName?: string }) {
  const [runs, setRuns] = useState<RunRow[] | null>(sample ?? null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(!sample);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | RunRow["status"]>("all");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  // main's rule (30 Oct): the pager takes as many rows as the window has room for.
  const pageSize = useFittingPageSize(380, 57);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/partner/payouts", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Statements could not be loaded");
      setRuns(body.runs as RunRow[]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Statements could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  // Deferred by a tick: the read sets "loading" synchronously, and an effect body should not.
  useEffect(() => { if (sample) return; const kickoff = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(kickoff); }, [load, sample]);

  const total = (rows: RunRow[]) => rows.reduce((sum, run) => sum + run.netCents, 0);
  const paid = runs?.filter((run) => run.status === "paid") ?? [];
  const awaiting = runs?.filter((run) => run.status !== "paid") ?? [];
  const latest = runs?.[0] ?? null;
  const count = (rows: RunRow[]) => `${rows.length} statement${rows.length === 1 ? "" : "s"}`;
  // The small line in each tile: the last twelve statements, oldest first, one point per statement.
  const history = [...(runs ?? [])].reverse().slice(-12);
  let paidSoFar = 0;
  const paidSeries = history.map((run) => (paidSoFar += run.status === "paid" ? run.netCents : 0));
  const latestChange = latest && runs?.[1] && runs[1].netCents > 0
    ? { value: Math.round(((latest.netCents - runs[1].netCents) / runs[1].netCents) * 100), good: "up" as const }
    : undefined;
  const searchTerm = search.trim().toLowerCase();
  const filteredRuns = (runs ?? []).filter((run) => {
    const matchesStatus = statusFilter === "all" || run.status === statusFilter;
    // Date filters use overlap: a statement stays visible when any part of its period falls in range.
    const matchesFrom = !periodFrom || run.periodEnd >= periodFrom;
    const matchesTo = !periodTo || run.periodStart <= periodTo;
    const matchesSearch = !searchTerm || [
      period(run.periodStart, run.periodEnd),
      run.periodStart,
      run.periodEnd,
      run.status,
      run.status === "paid" ? "paid" : "awaiting payment",
      money(run.netCents),
      run.paidOn ? dayMonthYear(run.paidOn) : "",
    ].some((value) => value.toLowerCase().includes(searchTerm));
    return matchesStatus && matchesFrom && matchesTo && matchesSearch;
  });
  const paged = paginate(filteredRuns, page, pageSize);
  const activeFilters: ActiveFilter[] = [
    statusFilter !== "all" && { key: "status", label: "Status", value: statusFilter === "paid" ? "Paid" : "Published", onRemove: () => { setStatusFilter("all"); setPage(1); } },
    (periodFrom || periodTo) && { key: "period", label: "Period", value: `${periodFrom ? dayMonthYear(periodFrom) : "Any date"} – ${periodTo ? dayMonthYear(periodTo) : "Any date"}`, onRemove: () => { setPeriodFrom(""); setPeriodTo(""); setPage(1); } },
  ].filter(Boolean) as ActiveFilter[];
  const clearAll = () => { setSearch(""); setStatusFilter("all"); setPeriodFrom(""); setPeriodTo(""); setPage(1); };
  const setStatus = (value: "all" | RunRow["status"]) => { setStatusFilter(value); setPage(1); };
  const setFrom = (value: string) => { setPeriodFrom(value); setPage(1); };
  const setTo = (value: string) => { setPeriodTo(value); setPage(1); };

  return (
    <>
      <div className="m-stagger flex min-h-0 w-full flex-1 flex-col gap-6">
      <KpiRow label="Statement totals" className="lg:grid-cols-3">
        <KpiTile
          icon={WalletCards}
          label="Latest statement"
          value={runs === null ? "—" : latest ? money(latest.netCents) : "—"}
          series={runs === null ? undefined : history.map((run) => run.netCents)}
          change={latestChange}
          note={runs === null ? undefined : latest ? period(latest.periodStart, latest.periodEnd) : "None published yet"}
        />
        <KpiTile
          icon={CheckCircle2}
          label="Paid to date"
          value={runs === null ? "—" : money(total(paid))}
          series={runs === null ? undefined : paidSeries}
          note={runs === null ? undefined : count(paid)}
        />
        <KpiTile
          icon={Clock3}
          label="Awaiting payment"
          value={runs === null ? "—" : money(total(awaiting))}
          tone={awaiting.length ? "warn" : "default"}
          series={runs === null ? undefined : history.map((run) => (run.status === "paid" ? 0 : run.netCents))}
          note={runs === null ? undefined : count(awaiting)}
        />
      </KpiRow>

      <TableCard
        className="flex min-h-[24rem] flex-1 flex-col md:min-h-0"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        toolbar={<DataToolbar actions={<>
          <FilterButton iconOnly open={filtersOpen} controls="partner-payout-filters" onClick={() => setFiltersOpen((value) => !value)} count={activeFilters.length} />
          <RefreshButton onClick={() => void load()} refreshing={loading} labelClassName="sr-only" className="px-2.5" />
        </>}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search statements" />
        </DataToolbar>}
        filters={<>
          {/* One row: the status pick, then the two dates, each a quiet caption over a 36px control. A
              statement matches when any part of its period falls between the dates. */}
          <FilterPanel id="partner-payout-filters" open={filtersOpen} className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <FilterField label="Status" htmlFor="partner-payout-status">
              <div id="partner-payout-status">
                <Segmented label="Statement status" value={statusFilter} onChange={setStatus} options={[
                  { key: "all", label: "All", count: runs?.length ?? 0 },
                  { key: "published", label: "Published", count: runs?.filter((run) => run.status === "published").length ?? 0 },
                  { key: "paid", label: "Paid", count: paid.length },
                ]} />
              </div>
            </FilterField>
            <FilterField label="Period from" htmlFor="partner-payout-period-from">
              <input id="partner-payout-period-from" type="date" className={`${toolbarControl} w-44`} value={periodFrom} onChange={(event) => setFrom(event.target.value)} />
            </FilterField>
            <FilterField label="Period through" htmlFor="partner-payout-period-to">
              <input id="partner-payout-period-to" type="date" className={`${toolbarControl} w-44`} value={periodTo} onChange={(event) => setTo(event.target.value)} />
            </FilterField>
          </FilterPanel>
          <ActiveFilters filters={activeFilters} onClear={clearAll} />
        </>}
        footer={filteredRuns.length > pageSize ? <Pager page={paged.current} total={filteredRuns.length} noun={filteredRuns.length === 1 ? "statement" : "statements"} pageSize={pageSize} onPage={setPage} /> : undefined}
      >
        {error ? <div className="flex min-h-64 flex-1 items-center justify-center"><EmptyState title="Statements are not available" hint={error} /></div> : runs === null ? <SectionLoading rows={4} columns={4} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Statement</TableHead>
                <TableHead className="text-right">Net payable</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Paid on</TableHead>
                <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? <TableRow><TableCell colSpan={5} className="h-64 text-center align-middle"><div className="mx-auto max-w-md"><p className="m-0 font-semibold text-foreground">No statements yet</p><p className="mb-0 mt-1 text-sm text-muted-foreground">When the agency publishes a payout statement for you, it appears here.</p></div></TableCell></TableRow> : filteredRuns.length === 0 ? <TableRow><TableCell colSpan={5} className="h-64 text-center align-middle"><div className="mx-auto max-w-md"><p className="m-0 font-semibold text-foreground">No statements match these filters</p><p className="mb-0 mt-1 text-sm text-muted-foreground">Try a different search or clear your filters.</p><Button type="button" variant="link" className="mt-1" onClick={clearAll}>Clear filters</Button></div></TableCell></TableRow> : paged.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[320px]">
                    <strong className="block truncate font-semibold text-foreground">{period(r.periodStart, r.periodEnd)}</strong>
                    <span className="block truncate font-mono text-xs text-muted-foreground">Ref {r.id.slice(0, 8).toUpperCase()}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.netCents)}</TableCell>
                  <TableCell><StatusChip tone={r.status === "paid" ? "good" : "info"}>{r.status === "paid" ? "Paid" : "Published"}</StatusChip></TableCell>
                  <TableCell className={r.paidOn ? "tabular-nums" : "text-muted-foreground"}>{r.paidOn ? dayMonthYear(r.paidOn) : "Awaiting payment"}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(r.id)} title="Open the statement" aria-label={`Open the statement for ${period(r.periodStart, r.periodEnd)}`}><FileText aria-hidden="true" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {open ? <Statement key={open} id={open} onClose={() => setOpen(null)} partnerName={partnerName} /> : null}
      </div>
    </>
  );
}
