"use client";

/**
 * LA-4.5 · the discrepancy list: what each carrier appears to owe, line by line, with the
 * arithmetic, and what a person decided about it.
 *
 * Select the findings for one carrier and "Dispute letter" opens a letter to that carrier's
 * commission department listing them; marking them disputed records that it went. "Resolved" is the
 * carrier paying, "Write off" is choosing not to pursue it, "Reopen" undoes either. A finding the
 * facts no longer support is "cleared" by the refresh and has nothing to decide.
 */

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { DISCREPANCY_KINDS, DISCREPANCY_KIND_LABELS, type DiscrepancyKind } from "@/lib/discrepancies/compute";
import { statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";

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
};

const STATUS: Record<DiscrepancyRow["status"], { label: string; chip: string }> = {
  open: { label: "Open", chip: "bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]" },
  disputed: { label: "Disputed", chip: "bg-[var(--info-surface)] text-[var(--info-ink)]" },
  resolved: { label: "Resolved", chip: "bg-[var(--success-surface)] text-[var(--success-ink)]" },
  written_off: { label: "Written off", chip: "bg-[var(--surface-alt)] text-[var(--body)]" },
  cleared: { label: "No longer applies", chip: "bg-[var(--surface-alt)] text-[var(--muted)]" },
};
type StatusFilter = "working" | DiscrepancyRow["status"] | "all";
const PAGE = 25;

export function DiscrepanciesWorkspace({ items, canWrite, writeBlockedReason }: { items: DiscrepancyRow[]; canWrite: boolean; writeBlockedReason: string | null }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"" | DiscrepancyKind>("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState<StatusFilter>("working");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const { current, rows } = paginate(visible, page, PAGE);

  const chosen = items.filter((item) => selected.has(item.id));
  const chosenCarriers = [...new Set(chosen.map((item) => item.carrierId))];
  const letterProblem = !chosen.length ? "Select the discrepancies to put in the letter." : chosenCarriers.length > 1 ? "A letter goes to one carrier: select one carrier's discrepancies." : !chosenCarriers[0] ? "This policy's carrier is not in the carrier library, so there is no one to address." : null;

  function toggle(id: string) {
    setSelected((currentSet) => { const next = new Set(currentSet); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function decide(ids: string[], next: "open" | "disputed" | "resolved" | "written_off", done: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      for (const id of ids) {
        const response = await fetch(`/api/app/discrepancies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "The decision was not recorded.");
      }
      setNotice(done); setSelected(new Set());
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The decision was not recorded.");
    } finally {
      setBusy(false);
    }
  }

  const letterHref = !letterProblem ? `/app/discrepancies/letter?carrier=${chosenCarriers[0]}&ids=${chosen.map((item) => item.id).join(",")}` : null;

  return (
    <div className="flex flex-col gap-3">
      {!canWrite && writeBlockedReason && <p role="status" className="rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{writeBlockedReason}</p>}
      {notice && <p role="status" className="rounded-md bg-[var(--success-surface)] px-3 py-2 text-sm text-[var(--success-ink)]">{notice}</p>}
      {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
      <TableCard
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
              <option value="working">Open and disputed</option>
              {(Object.keys(STATUS) as DiscrepancyRow["status"][]).map((key) => <option key={key} value={key}>{STATUS[key].label}</option>)}
              <option value="all">All</option>
            </select>
          </DataToolbar>
        }
        footer={visible.length > 0 ? <Pager page={current} pageSize={PAGE} total={visible.length} onPage={setPage} noun="discrepancies" /> : undefined}
      >
        {items.length === 0 ? (
          <EmptyState title="Nothing looks owed" hint="Every accepted statement line agrees with your contract. Import and review carrier statements to check more of your book." />
        ) : visible.length === 0 ? (
          <NoMatches noun="discrepancies" onClear={() => { setQuery(""); setKind(""); setCarrier(""); setStatus("all"); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[44px]"><span className="sr-only">Select</span></th>
                <th>Policy</th>
                <th className="w-[170px]">Kind</th>
                <th className="w-[150px]">Carrier · period</th>
                <th className="w-[120px] text-right">Expected</th>
                <th className="w-[120px] text-right">Received</th>
                <th className="w-[120px] text-right">Owed</th>
                <th className="w-[130px]">Status</th>
                <th className="w-[210px] text-right"><span className="sr-only">Decision</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <Fragment key={item.id}>
                  <tr className="align-top">
                    <td className="pt-3">
                      <input type="checkbox" aria-label={`Select ${item.policyNumber}`} className="size-4 accent-[var(--primary)]" checked={selected.has(item.id)} disabled={item.status === "cleared"} onChange={() => toggle(item.id)} />
                    </td>
                    <td>
                      <span className="block font-semibold text-foreground">{item.policyNumber}</span>
                      <span className="block text-xs text-muted-foreground">{item.insuredName}</span>
                      <button type="button" className="mt-0.5 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline" aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? null : item.id)}>
                        {open === item.id ? "Hide the arithmetic" : "The arithmetic"}
                      </button>
                    </td>
                    <td>{DISCREPANCY_KIND_LABELS[item.kind].label}</td>
                    <td>
                      <span className="block text-foreground">{item.carrierName}</span>
                      {item.periodStart && item.periodEnd && <span className="block text-xs text-muted-foreground">{statementPeriod(item.periodStart, item.periodEnd)}</span>}
                    </td>
                    <td className="text-right tabular-nums">{statementMoney(item.expectedCents)}</td>
                    <td className="text-right tabular-nums">{statementMoney(item.receivedCents)}</td>
                    <td className="text-right font-semibold tabular-nums text-foreground">{statementMoney(item.owedCents)}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${STATUS[item.status].chip}`}>{STATUS[item.status].label}</span>
                      {item.statusChangedByName && <span className="mt-0.5 block text-xs text-muted-foreground">by {item.statusChangedByName}</span>}
                    </td>
                    <td className="text-right">
                      {canWrite && (item.status === "open" || item.status === "disputed") && (
                        <span className="inline-flex flex-wrap justify-end gap-1.5">
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide([item.id], "resolved", `${item.policyNumber} marked resolved: the carrier paid.`)}>Resolved</Button>
                          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void decide([item.id], "written_off", `${item.policyNumber} written off.`)}>Write off</Button>
                        </span>
                      )}
                      {canWrite && (item.status === "resolved" || item.status === "written_off") && (
                        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void decide([item.id], "open", `${item.policyNumber} reopened.`)}>Reopen</Button>
                      )}
                    </td>
                  </tr>
                  {open === item.id && (
                    <tr>
                      <td />
                      <td colSpan={8}>
                        <div className="rounded-md bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--body)]">
                          <p className="m-0">{item.explanation}</p>
                          <p className="m-0 mt-1 text-xs text-muted-foreground">{DISCREPANCY_KIND_LABELS[item.kind].meaning}</p>
                          {item.note && <p className="m-0 mt-1 text-xs text-muted-foreground">Note: {item.note}</p>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
