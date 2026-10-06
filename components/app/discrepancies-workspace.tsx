"use client";

/**
 * LA-4.5 · the discrepancy list: what each carrier appears to owe, line by line, with the
 * arithmetic, and what a person decided about it.
 *
 * Select the findings for one carrier and "Dispute letter" opens a letter to that carrier's
 * commission department listing them; marking them disputed records that it went. "Resolved" is the
 * carrier paying, "Write off" is choosing not to pursue it, "Reopen" undoes either. A finding the
 * facts no longer support is "cleared" by the refresh and has nothing to decide.
 *
 * 2026-10-06 redesign: the list opens on every finding (no status filter on by default), one fact
 * per column, a pager sized to the window, and the arithmetic opens in a dialog instead of a row
 * pushed under the finding.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/app/book-of-business-views";
import { DISCREPANCY_KINDS, DISCREPANCY_KIND_LABELS, type DiscrepancyKind } from "@/lib/discrepancies/compute";
import { statementDay as historyDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";

export type DiscrepancyRow = {
  id: string;
  kind: DiscrepancyKind;
  status: "open" | "disputed" | "resolved" | "written_off" | "cleared";
  owedCents: number;
  policyNumber: string;
  insuredName: string;
  carrierId: string | null;
  carrierName: string;
  periodStart: string | null;
  periodEnd: string | null;
  expectedCents: number;
  receivedCents: number;
  explanation: string;
  note: string | null;
  statusChangedByName: string | null;
  statusChangedAt: string | null;
  /** Every status change, oldest first; empty before migration 20261006110000. */
  history: Array<{ from: DiscrepancyRow["status"] | null; to: DiscrepancyRow["status"]; at: string; byName: string | null; note: string | null }>;
};

const STATUS: Record<DiscrepancyRow["status"], { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "action" },
  disputed: { label: "Disputed", tone: "info" },
  resolved: { label: "Resolved", tone: "good" },
  written_off: { label: "Written off", tone: "neutral" },
  cleared: { label: "No longer applies", tone: "neutral" },
};
type StatusFilter = "working" | DiscrepancyRow["status"] | "all";

export function DiscrepanciesWorkspace({ items, canWrite, writeBlockedReason }: { items: DiscrepancyRow[]; canWrite: boolean; writeBlockedReason: string | null }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"" | DiscrepancyKind>("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageSize = useFittingPageSize(440, 49);

  const carriers = useMemo(() => [...new Set(items.map((item) => item.carrierName))].sort((a, b) => a.localeCompare(b)), [items]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) =>
      (!needle || `${item.policyNumber} ${item.insuredName}`.toLowerCase().includes(needle)) &&
      (!kind || item.kind === kind) &&
      (!carrier || item.carrierName === carrier) &&
      (status === "all" || (status === "working" ? item.status === "open" || item.status === "disputed" : item.status === status)),
    );
  }, [items, query, kind, carrier, status]);
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || kind || carrier || status !== "all");
  const clear = () => { setQuery(""); setKind(""); setCarrier(""); setStatus("all"); setPage(1); };
  const opened = open ? items.find((item) => item.id === open) ?? null : null;

  const chosen = items.filter((item) => selected.has(item.id));
  const chosenCarriers = [...new Set(chosen.map((item) => item.carrierId))];
  const letterProblem = !chosen.length ? "Select the discrepancies to put in the letter." : chosenCarriers.length > 1 ? "A letter goes to one carrier: select one carrier's discrepancies." : !chosenCarriers[0] ? "This policy's carrier is not in the carrier library, so there is no one to address." : null;

  function toggle(id: string) {
    setSelected((currentSet) => { const next = new Set(currentSet); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function decide(ids: string[], next: "open" | "disputed" | "resolved" | "written_off", done: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      // One request for one finding or many (LA-4.5): each is still its own decision and audit row,
      // and a finding that stopped applying meanwhile is skipped and said, not a failure for the rest.
      const response = await fetch("/api/app/discrepancies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, status: next }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string; skipped?: Array<{ id: string; reason: string }> };
      if (!response.ok) throw new Error(data.error ?? "The decision was not recorded.");
      const skipped = data.skipped?.length ?? 0;
      setNotice(skipped ? `${done} ${skipped.toLocaleString("en-US")} no longer ${skipped === 1 ? "applies" : "apply"} and ${skipped === 1 ? "was" : "were"} left as ${skipped === 1 ? "it was" : "they were"}.` : done);
      setSelected(new Set()); setOpen(null);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The decision was not recorded.");
    } finally {
      setBusy(false);
    }
  }

  const letterHref = !letterProblem ? `/app/discrepancies/letter?carrier=${chosenCarriers[0]}&ids=${chosen.map((item) => item.id).join(",")}` : null;

  /** The decision buttons a finding offers in its current state; the same in the row and the dialog. */
  const decisions = (item: DiscrepancyRow) => <>
    {canWrite && (item.status === "open" || item.status === "disputed") && <>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide([item.id], "resolved", `${item.policyNumber} marked resolved: the carrier paid.`)}>Resolved</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void decide([item.id], "written_off", `${item.policyNumber} written off.`)}>Write off</Button>
    </>}
    {canWrite && (item.status === "resolved" || item.status === "written_off") && (
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void decide([item.id], "open", `${item.policyNumber} reopened.`)}>Reopen</Button>
    )}
  </>;

  return (
    <div className="flex flex-col gap-3">
      {!canWrite && writeBlockedReason && <p role="status" className="rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{writeBlockedReason}</p>}
      {notice && <p role="status" className="rounded-md bg-[var(--success-surface)] px-3 py-2 text-sm text-[var(--success-ink)]">{notice}</p>}
      {error && !opened && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
      <TableCard
        className="flex min-h-[calc(100dvh-var(--top-bar-h)-290px)] flex-col [&>.overflow-x-auto]:flex-1"
        toolbar={
          <DataToolbar
            actions={<>
              {letterHref ? (
                <Button asChild type="button"><a href={letterHref} target="_blank" rel="noreferrer">Dispute letter ({chosen.length})</a></Button>
              ) : (
                <Button type="button" disabled title={letterProblem ?? undefined}>Dispute letter</Button>
              )}
              {canWrite && chosen.some((item) => item.status === "open") && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => { const ids = chosen.filter((item) => item.status === "open").map((item) => item.id); void decide(ids, "disputed", `${ids.length.toLocaleString("en-US")} marked disputed.`); }}>
                  Mark disputed
                </Button>
              )}
              {filtered && <ClearFiltersButton onClick={clear} />}
              <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
            </>}
          >
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search policy or insured" />
            <select aria-label="Filter by kind" className={toolbarControl} value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPage(1); }}>
              <option value="">All kinds</option>
              {DISCREPANCY_KINDS.map((key) => <option key={key} value={key}>{DISCREPANCY_KIND_LABELS[key].label}</option>)}
            </select>
            <select aria-label="Filter by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
              <option value="">All carriers</option>
              {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label="Filter by status" className={toolbarControl} value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }}>
              <option value="all">All statuses</option>
              <option value="working">Open and disputed</option>
              {(Object.keys(STATUS) as DiscrepancyRow["status"][]).map((key) => <option key={key} value={key}>{STATUS[key].label}</option>)}
            </select>
          </DataToolbar>
        }
        footer={visible.length > 0 ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun="discrepancies" suffix={chosen.length ? `${chosen.length.toLocaleString("en-US")} selected` : undefined} /> : undefined}
      >
        {items.length === 0 ? (
          <EmptyState title="Nothing looks owed" hint="Every accepted statement line agrees with your contract. Import and review carrier statements to check more of your book." />
        ) : visible.length === 0 ? (
          <NoMatches noun="discrepancies" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[1260px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[44px]"><span className="sr-only">Select</span></th>
                <th className="w-[150px]">Policy</th>
                <th>Insured</th>
                <th className="w-[170px]">Kind</th>
                <th>Carrier</th>
                <th className="w-[160px]">Period</th>
                <th className="w-[110px] text-right">Expected</th>
                <th className="w-[110px] text-right">Received</th>
                <th className="w-[110px] text-right">Owed</th>
                <th className="w-[150px]">Status</th>
                <th className="w-[140px]">Changed by</th>
                <th className="w-[250px] text-right"><span className="sr-only">Decision</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className={selected.has(item.id) ? "bg-[var(--primary-soft)]" : undefined}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${item.policyNumber}`} className="size-4 accent-[var(--primary)]" checked={selected.has(item.id)} disabled={item.status === "cleared"} onChange={() => toggle(item.id)} />
                  </td>
                  <td className="font-semibold text-foreground">{item.policyNumber}</td>
                  <td className="max-w-[200px] truncate" title={item.insuredName}>{item.insuredName}</td>
                  <td>{DISCREPANCY_KIND_LABELS[item.kind].label}</td>
                  <td className="max-w-[180px] truncate" title={item.carrierName}>{item.carrierName}</td>
                  <td className="tabular-nums">{item.periodStart && item.periodEnd ? statementPeriod(item.periodStart, item.periodEnd) : "—"}</td>
                  <td className="text-right tabular-nums">{statementMoney(item.expectedCents)}</td>
                  <td className="text-right tabular-nums">{statementMoney(item.receivedCents)}</td>
                  <td className="text-right font-semibold tabular-nums text-foreground">{statementMoney(item.owedCents)}</td>
                  <td><StatusChip tone={STATUS[item.status].tone}>{STATUS[item.status].label}</StatusChip></td>
                  <td className="max-w-[140px] truncate text-muted-foreground" title={item.statusChangedByName ? `by ${item.statusChangedByName}` : undefined}>{item.statusChangedByName ?? "—"}</td>
                  <td className="text-right">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {decisions(item)}
                      <Button type="button" size="sm" variant="ghost" aria-haspopup="dialog" onClick={() => { setError(null); setOpen(item.id); }}>The arithmetic</Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <Dialog open={Boolean(opened)} onOpenChange={(next) => { if (!next && !busy) setOpen(null); }}>
        <DialogContent className="sm:max-w-xl">
          {opened && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{opened.policyNumber} · {DISCREPANCY_KIND_LABELS[opened.kind].label}</DialogTitle>
                <DialogDescription>
                  {opened.insuredName} · {opened.carrierName}{opened.periodStart && opened.periodEnd ? ` · ${statementPeriod(opened.periodStart, opened.periodEnd)}` : ""}
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Expected</dt><dd className="m-0 font-semibold tabular-nums text-foreground">{statementMoney(opened.expectedCents)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Received</dt><dd className="m-0 font-semibold tabular-nums text-foreground">{statementMoney(opened.receivedCents)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Owed</dt><dd className="m-0 font-semibold tabular-nums text-foreground">{statementMoney(opened.owedCents)}</dd></div>
              </dl>
              <div className="rounded-md bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--body)]">
                <p className="m-0">{opened.explanation}</p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">{DISCREPANCY_KIND_LABELS[opened.kind].meaning}</p>
                {opened.note && <p className="m-0 mt-1 text-xs text-muted-foreground">Note: {opened.note}</p>}
              </div>
              <p className="m-0 flex items-center gap-2 text-sm">
                <StatusChip tone={STATUS[opened.status].tone}>{STATUS[opened.status].label}</StatusChip>
                {opened.statusChangedByName && <span className="text-xs text-muted-foreground">by {opened.statusChangedByName}</span>}
              </p>
              {opened.history.length > 0 && (
                <section aria-label="History" className="grid gap-1">
                  <h3 className="m-0 text-xs font-semibold text-muted-foreground">History</h3>
                  <ol className="m-0 grid list-none gap-1 p-0 text-xs text-[var(--body)]">
                    {[...opened.history].reverse().map((change, index) => (
                      <li key={`${change.at}-${index}`} className="flex flex-wrap gap-x-2">
                        <span className="tabular-nums text-muted-foreground">{historyDay(change.at)}</span>
                        <span>
                          {change.from ? `${STATUS[change.from].label} → ${STATUS[change.to].label}` : `Found · ${STATUS[change.to].label}`}
                          {change.byName ? ` · ${change.byName}` : change.from ? " · when a statement changed" : ""}
                        </span>
                        {change.note && <span className="text-muted-foreground">“{change.note}”</span>}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
              <DialogFooter>
                {decisions(opened)}
                <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
