"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { BAND_LABELS, CATEGORY_LABELS, SOURCE_LABELS, type WinbackBand } from "@/lib/retention/winback";
import type { ClaimRow, Winback, WinbackRow } from "@/lib/retention/winbackStore";
import { notify } from "@/lib/notify";

const money = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);
const TONE: Record<WinbackBand, StatusTone> = { strong: "good", fair: "info", poor: "warning", never: "danger" };
const VIEWS = { waiting: "Cooling off", released: "On the Win-back list", blocked: "Couldn't be released", never: "Never call", all: "Everything" } as const;
type View = keyof typeof VIEWS;
const alertClass = "rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]";

/**
 * LA-5.7 (Notion sprint) · win-back. Who lapsed past reinstatement, why (and how we know), the band
 * and when they may be called again. At that date they go to the Win-back lead list — which then
 * needs a scrub before anyone dials. Never-call clients stay here, and nowhere else.
 */
export function WinbackBoard({ data, readOnly }: { data: Winback; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<View>("waiting");
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<ClaimRow | null>(null);
  const rows = data.rows;
  const stateOf = (r: WinbackRow): View => (r.band === "never" ? "never" : r.releasedAt ? "released" : r.blockedReason ? "blocked" : "waiting");
  const visible = useMemo(() => rows.filter((r) => view === "all" || stateOf(r) === view), [rows, view]);
  const shown = paginate(visible, page, 10);
  const count = (v: View) => rows.filter((r) => stateOf(r) === v).length;

  return (
    <>
      {data.claims.length > 0 && (
        <p role="alert" className={alertClass}>
          {data.claims.length === 1 ? "1 policy lapsed after a reported death." : `${data.claims.length} policies lapsed after a reported death.`} It may be a claim the family does not know how to make: never a win-back call.
        </p>
      )}
      {data.listScrub && data.listScrub !== "scrubbed" && count("released") > 0 && (
        <p role="status" className="rounded-lg border border-border px-3 py-2 text-sm text-foreground">
          The Win-back lead list needs a scrub before anyone on it is dialled. <Link href="/app/campaigns" className="font-semibold underline">Run it in Vendors &amp; campaigns</Link>
        </p>
      )}
      {rows.length > 0 && (
        <StatStrip label="Win-back">
          <StatTile label="Cooling off" value={count("waiting").toLocaleString("en-US")} footnote="back on a call list when it ends" />
          <StatTile label="On the Win-back list" value={count("released").toLocaleString("en-US")} footnote={data.lastRun?.released ? `${data.lastRun.released} added just now` : "dialled once the list is scrubbed"} />
          <StatTile label="Never call" value={count("never").toLocaleString("en-US")} valueTone={count("never") ? "danger" : undefined} footnote="on your do-not-call list, or deceased" />
          <StatTile label="Couldn't be released" value={count("blocked").toLocaleString("en-US")} valueTone={count("blocked") ? "warning" : undefined} footnote={count("blocked") ? "see the reason on each" : "nothing stuck"} />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <select aria-label="Which clients" className={toolbarControl} value={view} onChange={(e) => { setView(e.target.value as View); setPage(1); }}>
              {(Object.keys(VIEWS) as View[]).map((v) => <option key={v} value={v}>{VIEWS[v]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={visible.length > 10 ? <Pager page={shown.current} pageSize={10} total={visible.length} noun="clients" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No lapsed clients yet" hint="A client appears here once a carrier file shows their policy lapsed and it is past the carrier's reinstatement window." />
        ) : visible.length === 0 ? (
          <NoMatches noun="clients" onClear={() => { setView("all"); setPage(1); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[220px]">Client</th>
                <th className="w-[200px]">What they had</th>
                <th>Why it ended</th>
                <th className="w-[200px]">Chance</th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="block font-semibold text-foreground">{r.clientName ?? "No client linked"}</span>
                    <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="block text-xs text-muted-foreground hover:underline">{r.carrierName} · {r.policyNumber}</Link>
                    <span className="block text-xs text-muted-foreground">lapsed {fileDay(r.lapsedOn)}</span>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    <span className="block text-sm text-foreground">{money(r.premiumCents)} a month</span>
                    {r.faceCents !== null && <span className="block">{`$${Math.round(r.faceCents / 100).toLocaleString("en-US")}`} of cover</span>}
                    {r.monthsPaid !== null && <span className="block">paid for {r.monthsPaid} {r.monthsPaid === 1 ? "month" : "months"}</span>}
                  </td>
                  <td>
                    <span className="block text-foreground">{CATEGORY_LABELS[r.category]}</span>
                    <span className="block text-xs text-muted-foreground">{SOURCE_LABELS[r.source]}{r.detail && r.source !== "none" ? ` · ${r.detail}` : ""}</span>
                  </td>
                  <td>
                    <StatusChip tone={TONE[r.band]}>{BAND_LABELS[r.band]}</StatusChip>
                    {r.band === "never" ? null : r.releasedAt ? (
                      <span className="mt-1 block text-xs text-muted-foreground">On the Win-back list since {fileDay(r.releasedAt.slice(0, 10))}</span>
                    ) : r.blockedReason ? (
                      <span className="mt-1 block text-xs text-[var(--warning-ink)]">{r.blockedReason}</span>
                    ) : (
                      <span className="mt-1 block text-xs text-muted-foreground">Can be called from {r.eligibleFrom ? fileDay(r.eligibleFrom) : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {data.claims.length > 0 && (
        <TableCard title="Possible claims" description="Policies that lapsed after a reported death. Help the family claim, or mark it handled if it was not a death.">
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Client</th><th>What the carrier reported</th><th className="w-[160px] text-right"><span className="sr-only">Handle it</span></th></tr></thead>
            <tbody>
              {data.claims.map((c) => (
                <tr key={c.id}>
                  <td><span className="block font-semibold text-foreground">{c.clientName ?? "No client linked"}</span><span className="block text-xs text-muted-foreground">{c.carrierName} · {c.policyNumber}</span></td>
                  <td className="text-muted-foreground">{c.reason}</td>
                  <td className="text-right">{!readOnly && <Button type="button" variant="outline" onClick={() => setResolving(c)}>Mark handled</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      {resolving && <ResolveDialog claim={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); router.refresh(); }} />}
    </>
  );
}

function ResolveDialog({ claim, onClose, onDone }: { claim: ClaimRow; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/retention/winback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve_claim", id: claim.id, note: note.trim() || null }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
      notify.done("Marked handled.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Mark handled: {claim.clientName ?? claim.policyNumber}</DialogTitle>
          <DialogDescription>{claim.carrierName} · {claim.policyNumber}. This policy is never sent to a win-back list. The phone number is not blocked, because the household may share it.</DialogDescription>
        </DialogHeader>
        <label htmlFor="claim-note" className="grid gap-1.5 text-sm font-medium text-foreground">
          What happened
          <textarea id="claim-note" className={`${toolbarControl} min-h-20 w-full py-2`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p role="alert" className={alertClass}>{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Mark handled"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
