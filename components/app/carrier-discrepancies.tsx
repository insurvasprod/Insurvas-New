"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { DISCREPANCY_LABELS, DISCREPANCY_TYPES, moneySummary, type DiscrepancyType } from "@/lib/ingestion/discrepancyEngine";
import { DISPUTABLE } from "@/lib/ingestion/disputeLetter";
import type { DiscrepancyRow, DisputeRow } from "@/lib/ingestion/discrepancyStore";
import { notify } from "@/lib/notify";

const money = (cents: number | null) => {
  if (cents === null) return "—";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "−" : ""}$${Number(digits.slice(0, -2)).toLocaleString("en-US")}.${digits.slice(-2)}`;
};
const toCents = (text: string): number | null => {
  const m = /^\s*\$?\s*([\d,]+)(?:\.(\d{1,2}))?\s*$/.exec(text);
  return m ? Number(m[1].replaceAll(",", "")) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
};
const SEVERITY_TONE: Record<string, StatusTone> = { action: "danger", warning: "warning", info: "info" };
const STATUS_TONE: Record<string, StatusTone> = { open: "action", disputed: "info", resolved: "good", dismissed: "neutral", expired: "neutral" };
const STATUS_WORD: Record<string, string> = { open: "Open", disputed: "In a letter", resolved: "Resolved", dismissed: "Dismissed", expired: "Expired" };
const policyHref = (row: DiscrepancyRow) => `/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber ?? "")}`;

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/commission-discrepancies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That did not work.");
  return data;
}

/**
 * LA-4.15 (Notion sprint) · the carrier-file discrepancies: what the agent is owed, what will be
 * taken back, what is held, and why — each with the figures behind it and the tolerance applied.
 * Choose items of one carrier to draft a letter; the agent sends it himself.
 */
export function CarrierDiscrepancies({ items, readOnly }: { items: DiscrepancyRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [type, setType] = useState("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [letter, setLetter] = useState<{ body: string; totalCents: number; recipient: string | null } | null>(null);
  const [recipient, setRecipient] = useState("");
  const [dismissing, setDismissing] = useState<{ id: string; note: string } | null>(null);

  const sum = useMemo(() => moneySummary(items.map((i) => ({ discrepancy_type: i.type, difference_cents: i.differenceCents, expected_amount_cents: i.expectedCents, reported_amount_cents: i.reportedCents, status: i.status }))), [items]);
  const carriers = useMemo(() => [...new Map(items.map((i) => [i.carrierId, i.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [items]);
  const visible = useMemo(() => items.filter((i) => (!type || i.type === type) && (!carrier || i.carrierId === carrier) && (!status || (status === "open" ? i.status === "open" || i.status === "disputed" : i.status === status))), [items, type, carrier, status]);
  const { current, rows } = paginate(visible, page, 25);
  const pickedRows = items.filter((i) => picked.includes(i.id));
  const pickedCarrier = pickedRows[0]?.carrierId ?? null;
  const canPick = (row: DiscrepancyRow) => !readOnly && row.status === "open" && DISPUTABLE.has(row.type) && (!pickedCarrier || pickedCarrier === row.carrierId);

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await work();
      notify.done(done);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function openLetter() {
    setBusy(true);
    try {
      const data = await post({ action: "preview_letter", ids: picked, recipient: null });
      setLetter({ body: String(data.body), totalCents: Number(data.totalCents), recipient: (data.recipient as string | null) ?? null });
      setRecipient((data.recipient as string | null) ?? "");
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The letter could not be drafted.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshPreview() {
    const data = await post({ action: "preview_letter", ids: picked, recipient: recipient.trim() || null });
    setLetter({ body: String(data.body), totalCents: Number(data.totalCents), recipient: (data.recipient as string | null) ?? null });
  }

  return (
    <>
      {/* Nothing found yet is not "$0 owed": the totals appear with the first finding. */}
      {items.length > 0 && <StatStrip label="Discrepancies from carrier files">
        <StatTile label="You appear to be owed" value={money(sum.owedCents)} valueTone={sum.owedCents ? "warning" : undefined} footnote={sum.unpricedMissing ? `plus ${sum.unpricedMissing} missing without a rate to price them` : "missing, short-paid and wrong chargebacks"} />
        <StatTile label="Coming back" value={money(sum.comingBackCents)} footnote="chargebacks not taken yet; don't spend it" />
        <StatTile label="Held by carriers" value={money(sum.heldCents)} footnote="withheld, not missing" />
        <StatTile label="Open" value={sum.open.toLocaleString("en-US")} footnote="including items in a letter" />
      </StatStrip>}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(type || carrier || status !== "open") && <ClearFiltersButton onClick={() => { setType(""); setCarrier(""); setStatus("open"); setPage(1); }} />}
            {!readOnly && picked.length > 0 && <Button type="button" disabled={busy} onClick={() => void openLetter()}>Draft letter ({picked.length})</Button>}
            {!readOnly && <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => post({ action: "run" }), "Checked against the latest files.")}>Check now</Button>}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <select aria-label="Filter by status" className={toolbarControl} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="open">Open and in a letter</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
              <option value="">Everything</option>
            </select>
            <select aria-label="Filter by type" className={toolbarControl} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">Every kind</option>
              {DISCREPANCY_TYPES.map((t) => <option key={t} value={t}>{DISCREPANCY_LABELS[t].label}</option>)}
            </select>
            {carriers.length > 1 && (
              <select aria-label="Filter by carrier" className={toolbarControl} value={carrier} onChange={(e) => { setCarrier(e.target.value); setPage(1); }}>
                <option value="">All carriers</option>
                {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
          </DataToolbar>
        }
        footer={items.length ? <Pager page={current} pageSize={25} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "item" : "items"} /> : undefined}
      >
        {items.length === 0 ? (
          <EmptyState title="Nothing found yet" hint="Discrepancies appear once commission files are read: commission that never came, was paid short or at the wrong rate, chargebacks that look wrong or are coming, held money and debit balances." />
        ) : visible.length === 0 ? (
          <NoMatches noun="items" onClear={() => { setType(""); setCarrier(""); setStatus("open"); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[36px]"><span className="sr-only">Choose for a letter</span></th>
                <th>What</th>
                <th className="w-[150px]">Policy</th>
                <th className="w-[110px] text-right">Expected</th>
                <th className="w-[110px] text-right">Paid</th>
                <th className="w-[120px] text-right" title="Positive: owed to you. Negative: owed to the carrier.">Difference</th>
                <th className="w-[110px]">Status</th>
                <th className="w-[96px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((row) => {
                const expanded = open === row.id;
                const main = (
                  <tr key={row.id}>
                    <td>{canPick(row) && <input type="checkbox" aria-label={`Put ${row.policyNumber ?? row.carrierName} on a letter`} className="size-4 accent-[var(--primary)]" checked={picked.includes(row.id)} onChange={(e) => setPicked((now) => (e.target.checked ? [...now, row.id] : now.filter((id) => id !== row.id)))} />}</td>
                    <td>
                      <span className="inline-flex items-center gap-2"><StatusChip tone={SEVERITY_TONE[row.severity]}>{DISCREPANCY_LABELS[row.type as DiscrepancyType]?.label ?? row.type}</StatusChip></span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{row.carrierName}</span>
                    </td>
                    <td className="font-mono text-xs">{row.policyNumber ? <Link href={policyHref(row)} className="hover:underline">{row.policyNumber}</Link> : <span className="font-sans text-muted-foreground">Whole account</span>}</td>
                    <td className="text-right tabular-nums" title={row.expectedSource?.schedule_id ? `From your rate card: ${Number(row.expectedSource.rate_bp) / 100}% (rate effective ${row.expectedSource.schedule_version})` : undefined}>{money(row.expectedCents)}</td>
                    <td className="text-right tabular-nums" title={row.reportedEntryIds.length ? `${row.reportedEntryIds.length} ledger ${row.reportedEntryIds.length === 1 ? "line" : "lines"}` : undefined}>{money(row.reportedCents)}</td>
                    <td className={`text-right font-semibold tabular-nums ${row.differenceCents !== null && row.differenceCents > 0 ? "text-[var(--warning-ink)]" : ""}`}>
                      {money(row.differenceCents)}
                      {row.toleranceCents !== null && <span className="block text-xs font-normal text-muted-foreground">tolerance {money(row.toleranceCents)}</span>}
                    </td>
                    <td><StatusChip tone={STATUS_TONE[row.status] ?? "neutral"}>{STATUS_WORD[row.status] ?? row.status}</StatusChip></td>
                    <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => setOpen(expanded ? null : row.id)}>{expanded ? "Close" : "Why"}</Button></td>
                  </tr>
                );
                if (!expanded) return [main];
                return [main, (
                  <tr key={`${row.id}-why`}>
                    <td />
                    <td colSpan={7} className="bg-[var(--surface-muted,transparent)]">
                      <p className="m-0 max-w-[820px] text-sm text-foreground">{row.explanation}</p>
                      {Array.isArray(row.evidence.causes) && (
                        <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted-foreground">{(row.evidence.causes as string[]).map((c) => <li key={c}>{c}</li>)}</ul>
                      )}
                      <p className="m-0 mt-1 text-xs text-muted-foreground">
                        First found {fileDay(row.detectedAt.slice(0, 10))} · last checked {fileDay(row.lastSeenAt.slice(0, 10))}
                        {row.resolutionNote ? ` · ${row.resolutionNote}` : ""}
                      </p>
                      {!readOnly && (
                        <span className="mt-2 inline-flex gap-2">
                          {row.status === "open" && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDismissing({ id: row.id, note: "" })}>Dismiss</Button>}
                          {(row.status === "dismissed" || row.status === "resolved") && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => post({ action: "set_status", id: row.id, status: "open", note: null }), "Opened again.")}>Open again</Button>}
                        </span>
                      )}
                    </td>
                  </tr>
                )];
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <Dialog open={Boolean(letter)} onOpenChange={(next) => { if (!next && !busy) setLetter(null); }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-3xl">
          {letter && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Dispute letter: {money(letter.totalCents)}</DialogTitle>
                <DialogDescription>Drafted from the records, figure for figure. Insurvas never sends it: save it, download the PDF and send it yourself, then record what happened.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5 text-sm">
                <Label htmlFor="letter-to">To (the carrier&apos;s commissions department)</Label>
                <textarea id="letter-to" rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={recipient} onChange={(e) => setRecipient(e.target.value)} onBlur={() => void refreshPreview().catch(() => undefined)} placeholder="Commissions Department&#10;Street, City, State ZIP" />
              </div>
              <pre className="m-0 max-h-[420px] overflow-auto whitespace-pre rounded-md border border-border bg-[var(--surface-muted,transparent)] p-3 font-mono text-xs leading-relaxed text-foreground">{letter.body}</pre>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setLetter(null)}>Cancel</Button>
                <Button type="button" disabled={busy} onClick={() => void run(async () => { await post({ action: "draft_dispute", ids: picked, recipient: recipient.trim() || null }); setLetter(null); setPicked([]); }, "Letter saved. Download it under Letters, send it, then mark it sent.")}>Save letter</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(dismissing)} onOpenChange={(next) => { if (!next && !busy) setDismissing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Dismiss this item</DialogTitle>
            <DialogDescription>It stays dismissed even if the files keep showing it. Say why, for whoever looks next.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 text-sm"><Label htmlFor="dismiss-note">Why</Label><Input id="dismiss-note" className="h-9" maxLength={2000} value={dismissing?.note ?? ""} onChange={(e) => setDismissing((d) => (d ? { ...d, note: e.target.value } : d))} /></div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDismissing(null)}>Cancel</Button>
            <Button type="button" disabled={busy || !dismissing?.note.trim()} onClick={() => dismissing && void run(async () => { await post({ action: "set_status", id: dismissing.id, status: "dismissed", note: dismissing.note }); setDismissing(null); }, "Dismissed.")}>Dismiss</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const DISPUTE_WORD: Record<string, string> = { draft: "Saved, not sent", sent: "Sent", acknowledged: "Acknowledged", accepted: "Accepted", rejected: "Rejected", partial: "Partly credited" };
const DISPUTE_TONE: Record<string, StatusTone> = { draft: "action", sent: "info", acknowledged: "info", accepted: "good", rejected: "danger", partial: "warning" };

/**
 * LA-4.15 · the letters: each one as drafted, how it was sent (recorded by the agent), and how it
 * ended, with the amount credited. The per-carrier record shows which carriers are worth arguing with.
 */
export function DisputeLetters({ disputes, readOnly }: { disputes: DisputeRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<DisputeRow | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; outcome: string; amount: string; notes: string } | null>(null);

  const record = useMemo(() => {
    const byCarrier = new Map<string, { name: string; settled: number; won: number; claimed: number; credited: number }>();
    for (const d of disputes) {
      if (!["accepted", "rejected", "partial"].includes(d.status)) continue;
      const r = byCarrier.get(d.carrierId) ?? { name: d.carrierName, settled: 0, won: 0, claimed: 0, credited: 0 };
      r.settled++;
      if (d.status !== "rejected") r.won++;
      r.claimed += d.totalCents;
      r.credited += d.outcomeCents ?? 0;
      byCarrier.set(d.carrierId, r);
    }
    return [...byCarrier.values()];
  }, [disputes]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await post(body);
      notify.done(done);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {record.length > 0 && (
        <StatStrip label="Dispute record">
          {record.slice(0, 5).map((r) => <StatTile key={r.name} label={r.name} value={`${r.won} of ${r.settled}`} footnote={`credited ${money(r.credited)} of ${money(r.claimed)} claimed`} />)}
        </StatStrip>
      )}
      <TableCard toolbar={<DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}><span className="text-sm text-muted-foreground">Newest first</span></DataToolbar>}>
        {disputes.length === 0 ? (
          <EmptyState title="No letters yet" hint="Choose open items of one carrier on the Discrepancies tab and draft a letter. You send it; record here what happened." />
        ) : (
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead><tr><th className="w-[120px]">Drafted</th><th>Carrier</th><th className="w-[80px] text-right">Items</th><th className="w-[120px] text-right">Claimed</th><th className="w-[150px]">Status</th><th className="w-[130px] text-right">Credited</th><th className="w-[300px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td className="tabular-nums">{fileDay(d.createdAt.slice(0, 10))}</td>
                  <td className="font-semibold text-foreground">{d.carrierName}</td>
                  <td className="text-right tabular-nums">{d.discrepancyIds.length}</td>
                  <td className="text-right tabular-nums">{money(d.totalCents)}</td>
                  <td><StatusChip tone={DISPUTE_TONE[d.status] ?? "neutral"}>{DISPUTE_WORD[d.status] ?? d.status}</StatusChip>{d.sentVia && <span className="block text-xs text-muted-foreground">by {d.sentVia}{d.sentAt ? ` on ${fileDay(d.sentAt.slice(0, 10))}` : ""}</span>}</td>
                  <td className="text-right tabular-nums">{d.outcomeCents !== null ? money(d.outcomeCents) : "—"}</td>
                  <td className="text-right">
                    <span className="inline-flex flex-wrap justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setViewing(d)}>Read</Button>
                      <Button asChild type="button" size="sm" variant="outline"><a href={`/api/app/commission-discrepancies/disputes/${d.id}/pdf`}><Download aria-hidden="true" />PDF</a></Button>
                      {!readOnly && d.status === "draft" && (
                        <select aria-label="Mark sent" className={`${toolbarControl} h-8`} value="" disabled={busy} onChange={(e) => { if (e.target.value) void run({ action: "mark_sent", dispute_id: d.id, via: e.target.value }, "Marked sent."); }}>
                          <option value="">I sent it by…</option><option value="email">Email</option><option value="portal">The carrier&apos;s portal</option><option value="post">Post</option>
                        </select>
                      )}
                      {!readOnly && d.status === "sent" && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run({ action: "mark_acknowledged", dispute_id: d.id }, "Marked acknowledged.")}>Acknowledged</Button>}
                      {!readOnly && (d.status === "sent" || d.status === "acknowledged") && <Button type="button" size="sm" disabled={busy} onClick={() => setOutcome({ id: d.id, outcome: "accepted", amount: "", notes: "" })}>Record outcome</Button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <Dialog open={Boolean(viewing)} onOpenChange={(next) => { if (!next) setViewing(null); }}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-3xl">
          {viewing && (
            <>
              <DialogHeader><DialogTitle className="text-base">Letter to {viewing.carrierName}</DialogTitle><DialogDescription>Exactly as drafted on {fileDay(viewing.createdAt.slice(0, 10))}. A sent letter never changes.</DialogDescription></DialogHeader>
              <pre className="m-0 max-h-[480px] overflow-auto whitespace-pre rounded-md border border-border p-3 font-mono text-xs leading-relaxed text-foreground">{viewing.letterBody}</pre>
              {viewing.notes && <p className="m-0 text-sm text-muted-foreground">Notes: {viewing.notes}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(outcome)} onOpenChange={(next) => { if (!next && !busy) setOutcome(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-base">How did it end?</DialogTitle><DialogDescription>Recorded for this carrier&apos;s dispute record.</DialogDescription></DialogHeader>
          {outcome && (
            <div className="grid gap-3 text-sm">
              <div className="grid gap-1"><Label htmlFor="out-what">Outcome</Label><select id="out-what" className={`${toolbarControl} w-full`} value={outcome.outcome} onChange={(e) => setOutcome({ ...outcome, outcome: e.target.value })}><option value="accepted">Accepted in full</option><option value="partial">Partly credited</option><option value="rejected">Rejected</option></select></div>
              {outcome.outcome !== "rejected" && <div className="grid gap-1"><Label htmlFor="out-amount">{outcome.outcome === "partial" ? "Amount credited" : "Amount credited (blank: the full claim)"}</Label><Input id="out-amount" className="h-9" inputMode="decimal" value={outcome.amount} onChange={(e) => setOutcome({ ...outcome, amount: e.target.value })} /></div>}
              <div className="grid gap-1"><Label htmlFor="out-notes">Notes (optional)</Label><Input id="out-notes" className="h-9" maxLength={4000} value={outcome.notes} onChange={(e) => setOutcome({ ...outcome, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOutcome(null)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => {
              if (!outcome) return;
              const amount = outcome.outcome === "rejected" || !outcome.amount.trim() ? null : toCents(outcome.amount);
              if (outcome.amount.trim() && outcome.outcome !== "rejected" && amount === null) return notify.block("Enter the amount, like 412.50.");
              void run({ action: "record_outcome", dispute_id: outcome.id, outcome: outcome.outcome, amount_cents: amount, notes: outcome.notes.trim() || null }, "Outcome recorded.").then(() => setOutcome(null));
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
