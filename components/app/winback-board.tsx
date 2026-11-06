"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Callout } from "@/components/app/settings/primitives";
import { RiskCards, type RiskCard } from "@/components/app/retention/risk-cards";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { BAND_LABELS, CATEGORY_LABELS, SOURCE_LABELS, type WinbackBand } from "@/lib/retention/winback";
import type { ClaimRow, Winback, WinbackRow } from "@/lib/retention/winbackStore";
import { notify } from "@/lib/notify";

const money = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);
const TONE: Record<WinbackBand, StatusTone> = { strong: "good", fair: "info", poor: "warning", never: "danger" };
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
/** Where a lapsed client stands (round 3, owner 2026-11-06): heavier = needs you sooner. */
type Stage = "blocked" | "released" | "soon" | "resting" | "never";
const STAGES: Array<{ key: Stage; label: string; ink: string }> = [
  { key: "blocked", label: "Stuck: couldn't go on the list", ink: "var(--error-ink)" },
  { key: "released", label: "On the Win-back list: call them", ink: "var(--success-ink)" },
  { key: "soon", label: "Callable within 30 days", ink: "var(--info-ink)" },
  { key: "resting", label: "Cooling off", ink: "var(--muted-foreground)" },
  { key: "never", label: "Never call", ink: "var(--error-ink)" },
];
type View = "open" | Stage | "claims";
const isView = (v: string | null): v is View => v === "open" || v === "claims" || STAGES.some((s) => s.key === v);
/** A view's address, so a card can link to it. */
const winbackViewHref = (view: View) => (view === "open" ? "/app/reinstatement" : `/app/reinstatement?show=${view}`);

/**
 * Retention › Win-back (LA-5.7; round 3, owner 2026-11-06: header A + table B). Who lapsed past reinstatement,
 * why (and how we know), and when they may be called again; at that date they go to the Win-back lead list,
 * which is scrubbed before anyone dials. On top the same cards as Cases, heavier when it needs you sooner:
 * Cooling off › Soon › On the list › Stuck; Never call and Possible claims beside them. The table groups the
 * open ones the same way. A client's name opens their page; nothing opens inside the table.
 */
export function WinbackBoard({ data, readOnly }: { data: Winback; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const params = useSearchParams();
  const asked = params.get("show");
  const view: View = isView(asked) ? asked : "open";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<ClaimRow | null>(null);
  const rows = data.rows;
  const soonLimit = new Date(Date.parse(`${data.today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const stageOf = (r: WinbackRow): Stage => (r.band === "never" ? "never" : r.releasedAt ? "released" : r.blockedReason ? "blocked" : r.eligibleFrom && r.eligibleFrom <= soonLimit ? "soon" : "resting");
  const needle = search.trim().toLowerCase();
  const matching = useMemo(() => rows.filter((r) => !needle || [r.clientName, r.policyNumber, r.carrierName, r.phone].some((v) => v?.toLowerCase().includes(needle))), [rows, needle]);
  const order: Stage[] = ["blocked", "released", "soon", "resting"];
  const visible = useMemo(() => (view === "claims" ? [] : view === "open"
    ? matching.filter((r) => order.includes(stageOf(r))).sort((a, b) => order.indexOf(stageOf(a)) - order.indexOf(stageOf(b)) || (a.eligibleFrom ?? "").localeCompare(b.eligibleFrom ?? ""))
    : matching.filter((r) => stageOf(r) === view)), [matching, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const claims = useMemo(() => (view === "claims" ? data.claims.filter((c) => !needle || [c.clientName, c.policyNumber, c.carrierName].some((v) => v?.toLowerCase().includes(needle))) : []), [data.claims, view, needle]);
  const pageSize = useFittingPageSize(470, 57);
  const shown = paginate(visible, page, pageSize);
  const shownClaims = paginate(claims, page, pageSize);
  const total = view === "claims" ? claims.length : visible.length;
  const count = (s: Stage) => matching.filter((r) => stageOf(r) === s).length;
  const toggle = (v: View) => winbackViewHref(view === v ? "open" : v);
  const nextSoon = matching.filter((r) => stageOf(r) === "soon").map((r) => r.eligibleFrom).sort()[0];
  const cards: RiskCard[] = [
    { key: "resting", level: 1, tag: "Resting", name: "Cooling off", count: count("resting"), line: "too soon to call", foot: "back on the list when it ends", ink: "var(--muted-foreground)", href: toggle("resting"), on: view === "resting" },
    { key: "soon", level: 2, tag: "Soon", name: "Callable within 30 days", count: count("soon"), line: "line them up", foot: nextSoon ? `next one ${fileDay(nextSoon)}` : "none this month", ink: "var(--info-ink)", href: toggle("soon"), on: view === "soon" },
    { key: "released", level: 3, tag: "Call now", name: "On the Win-back list", count: count("released"), line: "dialled once scrubbed", foot: data.lastRun?.released ? `${data.lastRun.released} added just now` : data.listScrub && data.listScrub !== "scrubbed" ? "the list needs a scrub" : "work them from the list", warn: Boolean(data.listScrub && data.listScrub !== "scrubbed" && count("released")), ink: "var(--success-ink)", href: toggle("released"), on: view === "released" },
    { key: "blocked", level: 4, tag: "Needs you", name: "Couldn't go on the list", count: count("blocked"), line: "see the reason on each", foot: count("blocked") ? "fix the reason, it goes next run" : "nothing stuck", warn: count("blocked") > 0, ink: "var(--error-ink)", href: toggle("blocked"), on: view === "blocked" },
  ];

  return (
    <>
      {data.claims.length > 0 && <Callout tone="error" title={`${data.claims.length === 1 ? "1 policy lapsed after a reported death" : `${data.claims.length} policies lapsed after a reported death`}: a possible claim, never a win-back call.`} />}
      {data.listScrub && data.listScrub !== "scrubbed" && count("released") > 0 && <Callout tone="warning" title={<>The Win-back list needs a scrub before anyone is dialled. <Link href="/app/campaigns" className="font-semibold underline">Run it</Link></>} />}
      <RiskCards label="Where the lapsed clients stand" cards={cards} side={[
        { key: "never", label: "Never call", count: count("never"), line: "do-not-call, or deceased", ink: "var(--error-ink)", href: toggle("never"), on: view === "never" },
        { key: "claims", label: "Possible claims", count: data.claims.length, line: "help the family claim", ink: "var(--warning-ink)", href: toggle("claims"), on: view === "claims" },
      ]} />

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {needle && <ClearFiltersButton onClick={() => { setSearch(""); setPage(1); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
          </DataToolbar>
        }
        footer={total ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{view === "claims" ? "A policy that lapsed after a reported death: help the family claim" : "Stuck and callable first · a client is called again only after the cooling-off for why they left"}</span>
            <Pager page={view === "claims" ? shownClaims.current : shown.current} pageSize={pageSize} total={total} noun={view === "claims" ? "claims" : "clients"} onPage={setPage} />
          </div>
        ) : undefined}
      >
        {view === "claims" ? (
          claims.length === 0 ? (
            needle ? <NoMatches noun="claims" onClear={() => { setSearch(""); setPage(1); }} /> : <EmptyState title="No possible claims" hint="A policy that lapsed after a reported death shows here: help the family claim, or mark it handled." />
          ) : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Client</th><th>What the carrier reported</th><th className="w-[160px] text-right"><span className="sr-only">Handle it</span></th></tr></thead>
              <tbody className="m-seq">
                {shownClaims.rows.map((c) => (
                  <tr key={c.id} className="m-row">
                    <td><span className="block truncate font-semibold text-foreground">{c.clientName ? personName(c.clientName) : "No client linked"}</span><span className="block truncate text-xs text-muted-foreground">{c.carrierName} · {c.policyNumber}</span></td>
                    <td className="text-muted-foreground"><span className="block truncate" title={c.reason}>{c.reason}</span></td>
                    <td className="text-right">{!readOnly && <Button type="button" variant="outline" size="sm" onClick={() => setResolving(c)}>Mark handled</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : rows.length === 0 ? (
          <EmptyState title="No lapsed clients yet" hint="A client shows here once their policy is past the carrier's reinstatement window." />
        ) : visible.length === 0 ? (
          <NoMatches noun="clients" onClear={() => { setSearch(""); setPage(1); router.replace(winbackViewHref("open")); }} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th>What they had</th>
                <th>Why it ended</th>
                <th className="w-[190px]">When to call</th>
                <th className="w-[110px]">Chance</th>
                <th className="w-[150px] text-right"><span className="sr-only">Next</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((r, i) => {
                const s = stageOf(r);
                const head = view === "open" && (i === 0 || stageOf(shown.rows[i - 1]) !== s);
                const meta = STAGES.find((x) => x.key === s)!;
                const name = r.clientName ? personName(r.clientName) : "No client linked";
                return (
                  <Fragment key={r.id}>
                    {head && (
                      <tr aria-label={`${meta.label}: ${count(s)} clients`}>
                        <td colSpan={6} className="bg-[var(--surface-alt)] py-1.5">
                          <span className="inline-flex items-center gap-2 text-xs font-bold" style={{ color: meta.ink }}>
                            <i aria-hidden="true" className="block size-2 rounded-full" style={{ background: meta.ink }} />{meta.label}
                            <span className="rounded-full bg-[var(--surface)] px-1.5 text-foreground tabular-nums">{count(s)}</span>
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr className="m-row">
                      <td>
                        <Link href={`/app/reinstatement/winback/${r.id}`} className="block max-w-[220px] truncate font-semibold text-foreground underline-offset-2 hover:underline">{name}</Link>
                        <span className="block max-w-[220px] truncate text-xs text-muted-foreground">
                          {r.phone ? <span className="select-all tabular-nums">{phoneText(r.phone)}</span> : <span className="text-[var(--warning-ink)]">No phone on file</span>}
                          {[r.age !== null ? ` · ${r.age}` : null, r.state ? ` · ${r.state}` : null].filter(Boolean).join("")}
                        </span>
                      </td>
                      <td>
                        <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="block max-w-[230px] truncate text-xs font-semibold text-foreground hover:underline">{r.carrierName} {r.policyNumber}</Link>
                        <span className="block max-w-[230px] truncate text-xs text-muted-foreground">{[`${money(r.premiumCents)}/mo`, r.faceCents !== null ? `$${Math.round(r.faceCents / 100).toLocaleString("en-US")} cover` : null, r.monthsPaid !== null ? `paid ${r.monthsPaid} ${r.monthsPaid === 1 ? "month" : "months"}` : null].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td>
                        <span className="block max-w-[220px] truncate text-xs font-semibold text-foreground">{CATEGORY_LABELS[r.category]}</span>
                        <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={r.detail && r.source !== "none" ? `${SOURCE_LABELS[r.source]} · ${r.detail}` : undefined}>{SOURCE_LABELS[r.source].charAt(0).toUpperCase() + SOURCE_LABELS[r.source].slice(1)} · lapsed {fileDay(r.lapsedOn)}</span>
                      </td>
                      <td>
                        {s === "never" ? <span className="text-xs text-muted-foreground">Never</span>
                          : r.releasedAt ? <><span className="block text-xs font-semibold text-[var(--success-ink)]">On the list</span><span className="block text-xs text-muted-foreground">since {fileDay(r.releasedAt.slice(0, 10))}</span></>
                            : r.blockedReason ? <span className="block max-w-[190px] truncate text-xs font-semibold text-[var(--error-ink)]" title={r.blockedReason}>{r.blockedReason}</span>
                              : <><span className="block text-xs font-semibold text-foreground">From {r.eligibleFrom ? fileDay(r.eligibleFrom) : "—"}</span><span className="block text-xs text-muted-foreground">{r.eligibleFrom ? `in ${Math.max(0, Math.ceil((Date.parse(r.eligibleFrom) - Date.parse(data.today)) / 86_400_000))} days` : ""}</span></>}
                      </td>
                      <td><StatusChip tone={TONE[r.band]}>{BAND_LABELS[r.band]}</StatusChip></td>
                      <td className="text-right">
                        {s === "released" && r.leadId
                          ? <Button asChild size="sm"><Link href={`/app/leads/${r.leadId}`}>Open the lead</Link></Button>
                          : <Button asChild size="sm" variant="outline"><Link href={`/app/reinstatement/winback/${r.id}`}>{s === "blocked" ? "See why" : "Open"}</Link></Button>}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

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
          <DialogTitle>Mark handled: {claim.clientName ? personName(claim.clientName) : claim.policyNumber}</DialogTitle>
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
