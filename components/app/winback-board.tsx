"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout } from "@/components/app/settings/primitives";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { BAND_LABELS, CATEGORY_LABELS, SOURCE_LABELS, type WinbackBand } from "@/lib/retention/winback";
import type { ClaimRow, Winback, WinbackRow } from "@/lib/retention/winbackStore";
import { notify } from "@/lib/notify";

const money = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);
const TONE: Record<WinbackBand, StatusTone> = { strong: "good", fair: "info", poor: "warning", never: "danger" };
const VIEWS = { waiting: "Cooling off", released: "On the list", blocked: "Stuck", never: "Never call", all: "All" } as const;
type View = keyof typeof VIEWS;

/**
 * LA-5.7 (Notion sprint) · win-back. Who lapsed past reinstatement, why (and how we know), the band
 * and when they may be called again. At that date they go to the Win-back lead list — which then
 * needs a scrub before anyone dials. Never-call clients stay here, and nowhere else.
 *
 * 2026-11-02 tidy (owner): the views are chips with their counts, a search finds a client, each fact is one
 * line and the table fits its card; a possible claim and an unscrubbed list go to the bell, not the page.
 */
export function WinbackBoard({ data, readOnly }: { data: Winback; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<View>("waiting");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<ClaimRow | null>(null);
  const rows = data.rows;
  const stateOf = (r: WinbackRow): View => (r.band === "never" ? "never" : r.releasedAt ? "released" : r.blockedReason ? "blocked" : "waiting");
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => (view === "all" || stateOf(r) === view) && (!needle || [r.clientName, r.policyNumber, r.carrierName].some((v) => v?.toLowerCase().includes(needle)))), [rows, view, needle]);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(visible, page, pageSize);
  const count = (v: View) => rows.filter((r) => stateOf(r) === v).length;

  return (
    <>
      {data.claims.length > 0 && <Callout tone="error" title={`${data.claims.length === 1 ? "1 policy lapsed after a reported death" : `${data.claims.length} policies lapsed after a reported death`}: a possible claim, never a win-back call.`} />}
      {data.listScrub && data.listScrub !== "scrubbed" && count("released") > 0 && <Callout tone="warning" title={<>The Win-back list needs a scrub before anyone is dialled. <Link href="/app/campaigns" className="font-semibold underline">Run it</Link></>} />}
      {rows.length > 0 && (
        <StatStrip label="Win-back">
          <StatTile label="Cooling off" value={count("waiting").toLocaleString("en-US")} footnote="back on a list when it ends" />
          <StatTile label="On the Win-back list" value={count("released").toLocaleString("en-US")} footnote={data.lastRun?.released ? `${data.lastRun.released} added just now` : "dialled once scrubbed"} />
          <StatTile label="Never call" value={count("never").toLocaleString("en-US")} valueTone={count("never") ? "danger" : undefined} footnote="do-not-call, or deceased" />
          <StatTile label="Couldn't be released" value={count("blocked").toLocaleString("en-US")} valueTone={count("blocked") ? "warning" : undefined} footnote={count("blocked") ? "see the reason on each" : "nothing stuck"} />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(needle || view !== "waiting") && <ClearFiltersButton onClick={() => { setView("waiting"); setSearch(""); setPage(1); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client or policy" />
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <ToggleChip key={v} role="radio" selected={view === v} count={v === "all" ? rows.length : count(v)} countTone={v === "blocked" && count("blocked") ? "warning" : undefined} onClick={() => { setView(v); setPage(1); }}>{VIEWS[v]}</ToggleChip>
            ))}
          </DataToolbar>
        }
        footer={visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="clients" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No lapsed clients yet" hint="A client shows here once their policy is past the carrier's reinstatement window." />
        ) : visible.length === 0 ? (
          <NoMatches noun="clients" onClear={() => { setView("all"); setSearch(""); setPage(1); }} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th>What they had</th>
                <th>Why it ended</th>
                <th>Chance</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((r) => (
                <tr key={r.id} className="m-row">
                  <td>
                    <span className="block truncate font-semibold text-foreground">{r.clientName ? personName(r.clientName) : "No client linked"}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="hover:underline">{r.carrierName} {r.policyNumber}</Link>
                      {` · lapsed ${fileDay(r.lapsedOn)}`}
                    </span>
                  </td>
                  <td>
                    <span className="block whitespace-nowrap tabular-nums text-foreground">{money(r.premiumCents)}<span className="text-muted-foreground">/mo</span></span>
                    <span className="block truncate text-xs text-muted-foreground">{[r.faceCents !== null ? `$${Math.round(r.faceCents / 100).toLocaleString("en-US")} cover` : null, r.monthsPaid !== null ? `paid ${r.monthsPaid} ${r.monthsPaid === 1 ? "month" : "months"}` : null].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td>
                    <span className="block truncate text-foreground">{CATEGORY_LABELS[r.category]}</span>
                    {/* How we know, in two words; the carrier's own words only when they add to the reason (owner 2026-11-02). */}
                    <span className="block truncate text-xs text-muted-foreground" title={r.detail && r.source !== "none" ? `${SOURCE_LABELS[r.source]} · ${r.detail}` : undefined}>{SOURCE_LABELS[r.source].charAt(0).toUpperCase() + SOURCE_LABELS[r.source].slice(1)}</span>
                  </td>
                  <td>
                    <StatusChip tone={TONE[r.band]}>{BAND_LABELS[r.band]}</StatusChip>
                    {r.band === "never" ? null : r.releasedAt ? (
                      <span className="mt-1 block truncate text-xs text-muted-foreground">On the list since {fileDay(r.releasedAt.slice(0, 10))}</span>
                    ) : r.blockedReason ? (
                      <span className="mt-1 block truncate text-xs text-[var(--warning-ink)]" title={r.blockedReason}>{r.blockedReason}</span>
                    ) : (
                      <span className="mt-1 block whitespace-nowrap text-xs text-muted-foreground">Callable from {r.eligibleFrom ? fileDay(r.eligibleFrom) : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {data.claims.length > 0 && (
        <TableCard title="Possible claims" description="Lapsed after a reported death: help the family claim, or mark it handled.">
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Client</th><th>What the carrier reported</th><th className="w-[160px] text-right"><span className="sr-only">Handle it</span></th></tr></thead>
            <tbody>
              {data.claims.map((c) => (
                <tr key={c.id}>
                  <td><span className="block font-semibold text-foreground">{c.clientName ? personName(c.clientName) : "No client linked"}</span><span className="block text-xs text-muted-foreground">{c.carrierName} · {c.policyNumber}</span></td>
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
        {error && <Callout tone="error" title={error} />}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Mark handled"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
