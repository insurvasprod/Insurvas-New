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
import { CONVERSION_OUTCOME_LABELS, LOGGABLE_OUTCOMES, STATE_LABELS, type CampaignState } from "@/lib/retention/campaign";
import type { Campaign, CampaignRow } from "@/lib/retention/campaignStore";
import { ServicingRequestDialog } from "@/components/app/servicing-request-dialog";
import { notify } from "@/lib/notify";

const money = (cents: number | null) => (cents === null ? "—" : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const TONE: Record<CampaignState, StatusTone> = { remaining: "action", in_progress: "info", converted: "good", declined: "neutral", no_bank_account: "neutral" };
const VIEWS = { remaining: "To call", in_progress: "Asked", converted: "Converted", resting: "Said no", all: "All" } as const;
type View = keyof typeof VIEWS;
const field = `${toolbarControl} w-full`;
const labelClass = "grid gap-1.5 text-sm font-medium text-foreground";

/**
 * LA-5.5 (Notion sprint) · paper bill → bank payment. A standing list worked on a quiet afternoon,
 * biggest premium first. "12 converted, 26 to go" makes it a task with an end; a conversion counts
 * only when the carrier file shows it.
 *
 * 2026-11-02 tidy (owner): the views are chips with their counts, each row is one line of facts with its two
 * actions side by side, and "Worth the hours?" opens from the toolbar so the list fills the page.
 */
export function PaperBillCampaign({ campaign, isOwner, readOnly }: { campaign: Campaign; isOwner: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<View>("remaining");
  const [search, setSearch] = useState("");
  // Only the policies that can be called today (owner 2026-11-02 critique: most rows had no phone).
  const [withPhone, setWithPhone] = useState(false);
  const [page, setPage] = useState(1);
  const [converting, setConverting] = useState<CampaignRow | null>(null);
  const [logging, setLogging] = useState<CampaignRow | null>(null);
  const [talk, setTalk] = useState(false);
  const [results, setResults] = useState(false);
  const { totals, rows } = campaign;
  const inView = (r: CampaignRow, v: View) => v === "all" || (v === "resting" ? r.state === "declined" || r.state === "no_bank_account" : r.state === v);
  const counts = useMemo(() => Object.fromEntries((Object.keys(VIEWS) as View[]).map((v) => [v, rows.filter((r) => inView(r, v)).length])) as Record<View, number>, [rows]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => inView(r, view) && (!withPhone || Boolean(r.phone)) && (!needle || [r.clientName, r.policyNumber, r.phone, r.carrierName].some((v) => v?.toLowerCase().includes(needle)))), [rows, view, needle, withPhone]);
  const phoned = useMemo(() => rows.filter((r) => inView(r, view) && r.phone).length, [rows, view]);
  // Inside one state the chip already says it, so "Where it stands" is drawn only where states mix or a line adds to it.
  const showState = view === "all" || view === "resting" || visible.some((r) => r.lastAttempt);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(visible, page, pageSize);

  return (
    <>
      {rows.length > 0 && (
        <StatStrip label="Paper-bill campaign">
          <StatTile label="On paper bills" value={totals.policies.toLocaleString("en-US")} footnote={`${money(totals.monthlyCents)}/mo in premium`} />
          <StatTile label="Converted" value={totals.converted.toLocaleString("en-US")} valueTone={totals.converted ? "good" : undefined} footnote={totals.converted ? `${money(totals.monthlyMovedCents)}/mo moved off paper` : "shown by a carrier file"} />
          <StatTile label="Switch asked for" value={totals.inProgress.toLocaleString("en-US")} footnote="waiting for the file" />
          <StatTile label="To go" value={totals.remaining.toLocaleString("en-US")} footnote={`${totals.declined} said no · ${totals.noBankAccount} no bank account`} />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(needle || withPhone || view !== "remaining") && <ClearFiltersButton onClick={() => { setView("remaining"); setSearch(""); setWithPhone(false); setPage(1); }} />}
            {rows.length > 0 && <Button type="button" variant="outline" onClick={() => setResults(true)}>Worth the hours?</Button>}
            <Button type="button" variant="outline" onClick={() => setTalk(true)}>Talk track</Button>
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <ToggleChip key={v} role="radio" selected={view === v} count={counts[v]} onClick={() => { setView(v); setPage(1); }}>{VIEWS[v]}</ToggleChip>
            ))}
            <ToggleChip selected={withPhone} count={phoned} onClick={() => { setWithPhone(!withPhone); setPage(1); }}>Has a phone</ToggleChip>
          </DataToolbar>
        }
        footer={visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="policies" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No paper-bill policies" hint="Every in-force policy pays by draft or card." />
        ) : visible.length === 0 ? (
          <NoMatches noun="policies" onClear={() => { setView("all"); setSearch(""); setPage(1); }} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th className="w-[110px] text-right">Premium</th>
                <th>On paper for</th>
                {showState && <th>Where it stands</th>}
                <th className="w-[260px] text-right"><span className="sr-only">Work it</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((r) => {
                const name = r.clientName ? personName(r.clientName) : "No client linked";
                return (
                  <tr key={r.key} className="m-row">
                    <td>
                      <span className="block truncate font-semibold text-foreground" title={campaign.showOwners && r.owner ? `Owner: ${r.owner.name}` : undefined}>{name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.phone ? <span className="select-all tabular-nums text-foreground" title="Check the calling window and do-not-call list before dialling">{phoneText(r.phone)}</span> : "No phone"}
                        {" · "}
                        <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="hover:underline">{r.carrierName} {r.policyNumber}</Link>
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{money(r.monthlyCents)}<span className="text-muted-foreground">/mo</span></td>
                    <td className="truncate text-foreground" title={r.history}>{r.history.replace(/^Paying by post for /, "")}</td>
                    {showState && <td>
                      <StatusChip tone={TONE[r.state]}>{STATE_LABELS[r.state]}</StatusChip>
                      {(r.state === "declined" && r.returnsOn) || r.lastAttempt ? (
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {r.state === "declined" && r.returnsOn ? `Back ${fileDay(r.returnsOn)}` : `${CONVERSION_OUTCOME_LABELS[r.lastAttempt!.outcome]}, ${fileDay(r.lastAttempt!.at.slice(0, 10))}${r.lastAttempt!.by ? ` · ${r.lastAttempt!.by}` : ""}`}
                        </span>
                      ) : null}
                    </td>}
                    <td className="text-right">
                      {!readOnly && r.state === "remaining" && (
                        <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setLogging(r)}>Log call</Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => setConverting(r)}>Start conversion</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {results && (
        <Dialog open onOpenChange={(next) => { if (!next) setResults(false); }}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Worth the hours?</DialogTitle>
              <DialogDescription>From the carrier files: converted policies against those still paying by post.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 text-sm">
              <ul className="m-0 grid list-none gap-1 p-0">
                <li className="flex justify-between gap-2"><span>Converted</span><span className="tabular-nums">{campaign.lapse.converted}</span></li>
                <li className="flex justify-between gap-2"><span>Still on paper</span><span className="tabular-nums">{campaign.lapse.onPaper}</span></li>
                {!campaign.lapse.comparable && <li className="text-xs text-muted-foreground">Too few on one side to compare yet.</li>}
              </ul>
              <ul className="m-0 grid list-none gap-1 border-t border-border p-0 pt-4">
                {campaign.people.length === 0 ? <li className="text-muted-foreground">No calls logged yet.</li> : campaign.people.map((p) => (
                  <li key={p.name} className="flex justify-between gap-2"><span className="min-w-0 truncate">{p.name}</span><span className="shrink-0 tabular-nums">{p.verified} converted · {p.agreed} agreed · {p.calls} calls</span></li>
                ))}
              </ul>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResults(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {converting && <ServicingRequestDialog carrierId={converting.carrierId} policyNumber={converting.policyNumber} type="bill_to_draft_conversion" origin="campaign" fromQueue={false} onClose={() => setConverting(null)} onDone={() => { setConverting(null); router.refresh(); }} />}
      {logging && <LogCallDialog row={logging} cooloffDays={campaign.cooloffDays} onClose={() => setLogging(null)} onDone={() => { setLogging(null); router.refresh(); }} />}
      {talk && <TalkTrackDialog text={campaign.talkTrack} isOwn={campaign.talkTrackIsOwn} canEdit={isOwner && !readOnly} onClose={() => setTalk(false)} onDone={() => { setTalk(false); router.refresh(); }} />}
    </>
  );
}

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/retention/campaign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
}

function LogCallDialog({ row, cooloffDays, onClose, onDone }: { row: CampaignRow; cooloffDays: number; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<(typeof LOGGABLE_OUTCOMES)[number] | "">("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = outcome !== "" && (outcome !== "declined" || reason.trim().length >= 3);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "log_call", carrier_id: row.carrierId, policy_number: row.policyNumber, outcome, decline_reason: outcome === "declined" ? reason.trim() : null, note: note.trim() || null });
      notify.done(outcome === "declined" ? `Logged. It comes back to the list in ${cooloffDays} days.` : outcome === "unable_no_bank_account" ? "Logged. It leaves the campaign and goes to the save queue." : "Logged.");
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
          <DialogTitle>Log the call to {row.clientName ? personName(row.clientName) : row.policyNumber}</DialogTitle>
          <DialogDescription>{row.carrierName} · {row.policyNumber}. Agreed? Use Start conversion.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label htmlFor="conv-outcome" className={labelClass}>
            What happened
            <select id="conv-outcome" className={field} value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="">Choose…</option>
              {LOGGABLE_OUTCOMES.map((o) => <option key={o} value={o}>{CONVERSION_OUTCOME_LABELS[o]}</option>)}
            </select>
          </label>
          {outcome === "declined" && <label htmlFor="conv-reason" className={labelClass}>Why<input id="conv-reason" autoComplete="off" maxLength={500} className={field} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
          {outcome === "unable_no_bank_account" && <p className="m-0 text-sm text-muted-foreground">They won&apos;t be asked again. The policy goes to the save queue, where its risk decides what else is worth trying.</p>}
          <label htmlFor="conv-note" className={labelClass}>Note<textarea id="conv-note" className={`${field} min-h-16 py-2`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {error && <Callout tone="error" title={error} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Saving…" : "Log the call"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TalkTrackDialog({ text, isOwn, canEdit, onClose, onDone }: { text: string; isOwn: boolean; canEdit: boolean; onClose: () => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "talk_track", text: value });
      notify.done(value === null ? "Back to the Insurvas talk track." : "Talk track saved.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Talk track</DialogTitle>
          <DialogDescription>{isOwn ? "Your agency's words." : "The Insurvas starting point. An owner can write your own."}</DialogDescription>
        </DialogHeader>
        {editing ? (
          <textarea aria-label="Talk track" className={`${field} min-h-48 py-2`} maxLength={4000} value={draft} onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <div className="grid gap-3 text-sm text-foreground">{text.split(/\n{2,}/).map((p, i) => <p key={i} className="m-0">{p}</p>)}</div>
        )}
        {error && <Callout tone="error" title={error} />}
        <DialogFooter>
          {canEdit && !editing && isOwn && <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>Use the Insurvas text</Button>}
          {canEdit && !editing && <Button type="button" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
          {editing && <Button type="button" variant="outline" onClick={() => { setEditing(false); setDraft(text); }}>Cancel</Button>}
          {editing && <Button type="button" disabled={busy || draft.trim().length < 10} onClick={() => void save(draft)}>{busy ? "Saving…" : "Save"}</Button>}
          {!editing && <Button type="button" onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
