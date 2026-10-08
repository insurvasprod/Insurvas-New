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
import { DISCREPANCY_KINDS, DISCREPANCY_KIND_LABELS, type DiscrepancyKind } from "@/lib/discrepancies/compute";
import { fileDay } from "@/lib/ingestion/constants";
import { DISCREPANCY_LABELS, DISCREPANCY_TYPES, moneySummary, type DiscrepancyType } from "@/lib/ingestion/discrepancyEngine";
import { DISPUTABLE } from "@/lib/ingestion/disputeLetter";
import type { DiscrepancyRow, DisputeRow } from "@/lib/ingestion/discrepancyStore";
import { rowHref } from "@/lib/ingestion/trace";
import { statementDay, statementPeriod } from "@/lib/ledger/statementConstants";
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

/** A finding from a statement imported by hand (LA-4.5, lib/discrepancies/service.ts). */
export type HandDiscrepancyRow = {
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
  history: Array<{ from: HandDiscrepancyRow["status"] | null; to: HandDiscrepancyRow["status"]; at: string; byName: string | null; note: string | null }>;
};
const HAND_STATUS: Record<HandDiscrepancyRow["status"], { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "action" },
  disputed: { label: "Disputed", tone: "info" },
  resolved: { label: "Resolved", tone: "good" },
  written_off: { label: "Written off", tone: "neutral" },
  cleared: { label: "No longer applies", tone: "neutral" },
};

type Item = { source: "carrier"; row: DiscrepancyRow } | { source: "hand"; row: HandDiscrepancyRow };
const carrierKey = (item: Item) => item.row.carrierId ?? `hand:${item.row.carrierName}`;
/** The status filter, read the same way for both sources. */
function statusMatches(item: Item, status: string) {
  if (!status) return true;
  const s = item.row.status;
  if (status === "open") return s === "open" || s === "disputed";
  if (status === "resolved") return s === "resolved";
  return item.source === "carrier" ? s === "dismissed" || s === "expired" : s === "written_off" || s === "cleared";
}

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/commission-discrepancies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That did not work.");
  return data;
}

/**
 * LA-4.15 (Notion sprint) · discrepancies: what the agent is owed, what will be taken back, what is
 * held, and why — each with the figures behind it and the tolerance applied. Choose items of one
 * carrier to draft a letter; the agent sends it himself.
 *
 * One list since the 2026-10-08 overlap merge: the carrier-file findings, and (`handItems`) the
 * LA-4.5 findings from statements imported by hand, each keeping its own decisions — a carrier
 * finding is dismissed or opened again and goes in a saved letter; a hand finding is resolved,
 * written off or reopened, marked disputed, and goes in its own letter page. A letter holds one source.
 */
export function CarrierDiscrepancies({ items, readOnly, handItems = [], handCanWrite = false, handBlockedReason = null, initialSource = "" }: { items: DiscrepancyRow[]; readOnly: boolean; handItems?: HandDiscrepancyRow[]; handCanWrite?: boolean; handBlockedReason?: string | null; initialSource?: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [type, setType] = useState("");
  const [carrier, setCarrier] = useState("");
  const [status, setStatus] = useState("open");
  const [source, setSource] = useState(initialSource === "hand" || initialSource === "carrier" ? initialSource : "");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [handPicked, setHandPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [letter, setLetter] = useState<{ body: string; totalCents: number; recipient: string | null } | null>(null);
  const [recipient, setRecipient] = useState("");
  const [dismissing, setDismissing] = useState<{ id: string; note: string } | null>(null);

  const all: Item[] = useMemo(() => [...items.map((row) => ({ source: "carrier" as const, row })), ...handItems.map((row) => ({ source: "hand" as const, row }))], [items, handItems]);
  // The tiles follow the source filter, as the list does (Policies and the ledger do the same).
  const sum = useMemo(() => moneySummary((source === "hand" ? [] : items).map((i) => ({ discrepancy_type: i.type, difference_cents: i.differenceCents, expected_amount_cents: i.expectedCents, reported_amount_cents: i.reportedCents, status: i.status }))), [items, source]);
  const handWorking = source === "carrier" ? [] : handItems.filter((i) => i.status === "open" || i.status === "disputed");
  const handOwedCents = handWorking.reduce((total, i) => total + Math.max(0, i.owedCents), 0);
  const carriers = useMemo(() => [...new Map(all.map((i) => [carrierKey(i), i.row.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all]);
  const visible = useMemo(() => all.filter((i) =>
    (!source || i.source === source) &&
    (!type || (type.startsWith("hand:") ? i.source === "hand" && i.row.kind === type.slice(5) : i.source === "carrier" && i.row.type === type)) &&
    (!carrier || carrierKey(i) === carrier) &&
    statusMatches(i, status)), [all, source, type, carrier, status]);
  const { current, rows } = paginate(visible, page, 25);
  const pickedRows = items.filter((i) => picked.includes(i.id));
  const pickedCarrier = pickedRows[0]?.carrierId ?? null;
  const canPick = (row: DiscrepancyRow) => !readOnly && handPicked.length === 0 && row.status === "open" && DISPUTABLE.has(row.type) && (!pickedCarrier || pickedCarrier === row.carrierId);
  const handChosen = handItems.filter((i) => handPicked.includes(i.id));
  const handCarrier = handChosen[0]?.carrierId ?? null;
  const canPickHand = (row: HandDiscrepancyRow) => picked.length === 0 && row.status !== "cleared" && Boolean(row.carrierId) && (!handCarrier || handCarrier === row.carrierId);
  const handLetterHref = handChosen.length && handCarrier ? `/app/discrepancies/letter?carrier=${handCarrier}&ids=${handChosen.map((i) => i.id).join(",")}` : null;
  const filtered = Boolean(type || carrier || source || status !== "open");
  const clear = () => { setType(""); setCarrier(""); setSource(""); setStatus("open"); setPage(1); };

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

  /** A hand finding's decision (LA-4.5): one request for one finding or many; one that stopped applying is skipped and said. */
  async function decide(ids: string[], next: "open" | "disputed" | "resolved" | "written_off", done: string) {
    await run(async () => {
      const response = await fetch("/api/app/discrepancies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, status: next }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string; skipped?: Array<{ id: string; reason: string }> };
      if (!response.ok) throw new Error(data.error ?? "The decision was not recorded.");
      const skipped = data.skipped?.length ?? 0;
      if (skipped) notify.block(`${skipped.toLocaleString("en-US")} no longer ${skipped === 1 ? "applies" : "apply"} and ${skipped === 1 ? "was" : "were"} left as ${skipped === 1 ? "it was" : "they were"}.`);
      setHandPicked([]);
      setOpen(null);
    }, done);
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

  const handDecisions = (row: HandDiscrepancyRow) => handCanWrite && <>
    {(row.status === "open" || row.status === "disputed") && <>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide([row.id], "resolved", `${row.policyNumber} marked resolved: the carrier paid.`)}>Resolved</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide([row.id], "written_off", `${row.policyNumber} written off.`)}>Write off</Button>
    </>}
    {(row.status === "resolved" || row.status === "written_off") && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide([row.id], "open", `${row.policyNumber} reopened.`)}>Reopen</Button>}
  </>;

  function carrierRows(row: DiscrepancyRow) {
    const expanded = open === row.id;
    // A chargeback still to come has nothing paid to compare: its amount is what will be taken back.
    const coming = row.type === "missing_chargeback" && row.differenceCents === null;
    const main = (
      <tr key={row.id}>
        <td>{canPick(row) && <input type="checkbox" aria-label={`Put ${row.policyNumber ?? row.carrierName} on a letter`} className="size-4 accent-[var(--primary)]" checked={picked.includes(row.id)} onChange={(e) => setPicked((now) => (e.target.checked ? [...now, row.id] : now.filter((id) => id !== row.id)))} />}</td>
        <td>
          <span className="inline-flex items-center gap-2"><StatusChip tone={SEVERITY_TONE[row.severity]}>{DISCREPANCY_LABELS[row.type as DiscrepancyType]?.label ?? row.type}</StatusChip></span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{row.carrierName}</span>
        </td>
        <td className="tabular-nums">{row.policyNumber ? <Link href={policyHref(row)} className="hover:underline">{row.policyNumber}</Link> : <span className="text-muted-foreground">Whole account</span>}</td>
        <td className="text-right tabular-nums" title={row.expectedSource?.schedule_id ? `From your rate card: ${Number(row.expectedSource.rate_bp) / 100}% (rate effective ${row.expectedSource.schedule_version})` : undefined}>{coming ? <span className="text-muted-foreground">—</span> : money(row.expectedCents)}</td>
        <td className="text-right tabular-nums" title={row.reportedEntryIds.length ? `${row.reportedEntryIds.length} ledger ${row.reportedEntryIds.length === 1 ? "line" : "lines"}` : undefined}>{coming ? <span className="text-muted-foreground">—</span> : money(row.reportedCents)}</td>
        <td className={`text-right font-semibold tabular-nums ${row.differenceCents !== null && row.differenceCents > 0 ? "text-[var(--warning-ink)]" : ""}`}>
          {coming ? money(row.expectedCents) : money(row.differenceCents)}
          {coming && <span className="block text-xs font-normal text-muted-foreground">not taken back yet</span>}
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
          {row.reportedLines.length > 0 && (
            <ul className="m-0 mt-2 grid list-none gap-0.5 p-0 text-xs">
              {row.reportedLines.map((line) => (
                <li key={line.id}>
                  <span className="text-muted-foreground">{line.type.replaceAll("_", " ")} {money(line.amountCents)} · </span>
                  {line.rowNumber ? <Link href={rowHref(line.fileId, line.rowNumber)} className="text-[var(--accent-ink)] hover:underline">{line.fileName ?? "the file"}, row {line.rowNumber}</Link> : <span>{line.fileName ?? "the file"}</span>}
                </li>
              ))}
            </ul>
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
  }

  function handRows(row: HandDiscrepancyRow) {
    const key = `hand:${row.id}`;
    const expanded = open === key;
    const main = (
      <tr key={key}>
        <td>{canPickHand(row) && <input type="checkbox" aria-label={`Put ${row.policyNumber} on a letter`} className="size-4 accent-[var(--primary)]" checked={handPicked.includes(row.id)} onChange={(e) => setHandPicked((now) => (e.target.checked ? [...now, row.id] : now.filter((id) => id !== row.id)))} />}</td>
        <td>
          <span className="inline-flex items-center gap-2"><StatusChip tone={row.owedCents > 0 ? "warning" : "info"}>{DISCREPANCY_KIND_LABELS[row.kind].label}</StatusChip></span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{row.carrierName} · statement imported by hand</span>
        </td>
        <td className="tabular-nums">{row.policyNumber}<span className="block text-xs text-muted-foreground">{row.insuredName}</span></td>
        <td className="text-right tabular-nums">{money(row.expectedCents)}</td>
        <td className="text-right tabular-nums">{money(row.receivedCents)}</td>
        <td className={`text-right font-semibold tabular-nums ${row.owedCents > 0 ? "text-[var(--warning-ink)]" : ""}`}>
          {money(row.owedCents)}
          {row.periodStart && row.periodEnd && <span className="block text-xs font-normal text-muted-foreground">{statementPeriod(row.periodStart, row.periodEnd)}</span>}
        </td>
        <td><StatusChip tone={HAND_STATUS[row.status].tone}>{HAND_STATUS[row.status].label}</StatusChip>{row.statusChangedByName && <span className="block text-xs text-muted-foreground">by {row.statusChangedByName}</span>}</td>
        <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => setOpen(expanded ? null : key)}>{expanded ? "Close" : "Why"}</Button></td>
      </tr>
    );
    if (!expanded) return [main];
    return [main, (
      <tr key={`${key}-why`}>
        <td />
        <td colSpan={7} className="bg-[var(--surface-muted,transparent)]">
          <p className="m-0 max-w-[820px] text-sm text-foreground">{row.explanation}</p>
          <p className="m-0 mt-1 text-xs text-muted-foreground">{DISCREPANCY_KIND_LABELS[row.kind].meaning}</p>
          {row.note && <p className="m-0 mt-1 text-xs text-muted-foreground">Note: {row.note}</p>}
          {row.history.length > 0 && (
            <ol className="m-0 mt-2 grid list-none gap-0.5 p-0 text-xs text-muted-foreground">
              {[...row.history].reverse().map((change, index) => (
                <li key={`${change.at}-${index}`}>
                  {statementDay(change.at)} · {change.from ? `${HAND_STATUS[change.from].label} → ${HAND_STATUS[change.to].label}` : `Found · ${HAND_STATUS[change.to].label}`}
                  {change.byName ? ` · ${change.byName}` : change.from ? " · when a statement changed" : ""}
                  {change.note ? ` · “${change.note}”` : ""}
                </li>
              ))}
            </ol>
          )}
          <span className="mt-2 inline-flex gap-2">{handDecisions(row)}</span>
        </td>
      </tr>
    )];
  }

  return (
    <>
      {/* Nothing found yet is not "$0 owed": the totals appear with the first finding. */}
      {all.length > 0 && <StatStrip label="Discrepancies">
        <StatTile label="You appear to be owed" value={money(sum.owedCents + handOwedCents)} valueTone={sum.owedCents + handOwedCents ? "warning" : undefined} footnote={sum.unpricedMissing ? `plus ${sum.unpricedMissing} missing without a rate to price them` : handOwedCents ? `incl. ${money(handOwedCents)} from statements imported by hand` : "missing, short-paid and wrong chargebacks"} />
        <StatTile label="Coming back" value={money(sum.comingBackCents)} footnote="chargebacks not taken yet; don't spend it" />
        <StatTile label="Held by carriers" value={money(sum.heldCents)} footnote="withheld, not missing" />
        <StatTile label="Open" value={(sum.open + handWorking.length).toLocaleString("en-US")} footnote="including items in a letter" />
      </StatStrip>}
      {handItems.length > 0 && !handCanWrite && handBlockedReason && <p role="status" className="m-0 rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{handBlockedReason}</p>}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {filtered && <ClearFiltersButton onClick={clear} />}
            {!readOnly && picked.length > 0 && <Button type="button" disabled={busy} onClick={() => void openLetter()}>Draft letter ({picked.length})</Button>}
            {handLetterHref && <Button asChild type="button"><a href={handLetterHref} target="_blank" rel="noreferrer">Dispute letter ({handChosen.length})</a></Button>}
            {handCanWrite && handChosen.some((i) => i.status === "open") && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => { const ids = handChosen.filter((i) => i.status === "open").map((i) => i.id); void decide(ids, "disputed", `${ids.length.toLocaleString("en-US")} marked disputed.`); }}>Mark disputed</Button>
            )}
            {!readOnly && <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => post({ action: "run" }), "Checked against the latest files.")}>Check now</Button>}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <select aria-label="Filter by status" className={toolbarControl} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="open">Open and in a letter</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed or written off</option>
              <option value="">Everything</option>
            </select>
            <select aria-label="Filter by type" className={toolbarControl} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">Every kind</option>
              {handItems.length > 0 ? (
                <>
                  <optgroup label="From carrier files">{DISCREPANCY_TYPES.map((t) => <option key={t} value={t}>{DISCREPANCY_LABELS[t].label}</option>)}</optgroup>
                  <optgroup label="Statements imported by hand">{DISCREPANCY_KINDS.map((k) => <option key={k} value={`hand:${k}`}>{DISCREPANCY_KIND_LABELS[k].label}</option>)}</optgroup>
                </>
              ) : DISCREPANCY_TYPES.map((t) => <option key={t} value={t}>{DISCREPANCY_LABELS[t].label}</option>)}
            </select>
            {carriers.length > 1 && (
              <select aria-label="Filter by carrier" className={toolbarControl} value={carrier} onChange={(e) => { setCarrier(e.target.value); setPage(1); }}>
                <option value="">All carriers</option>
                {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            {(handItems.length > 0 || source) && (
              <select aria-label="Filter by source" className={toolbarControl} value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
                <option value="">Every source</option>
                <option value="carrier">From carrier files</option>
                <option value="hand">Statements imported by hand</option>
              </select>
            )}
          </DataToolbar>
        }
        footer={all.length ? <Pager page={current} pageSize={25} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "item" : "items"} /> : undefined}
      >
        {all.length === 0 ? (
          <EmptyState title="Nothing found yet" hint="Discrepancies appear once commission files are read: commission that never came, was paid short or at the wrong rate, chargebacks that look wrong or are coming, held money and debit balances." />
        ) : visible.length === 0 ? (
          <NoMatches noun="items" onClear={clear} />
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
              {rows.flatMap((item) => (item.source === "carrier" ? carrierRows(item.row) : handRows(item.row)))}
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
