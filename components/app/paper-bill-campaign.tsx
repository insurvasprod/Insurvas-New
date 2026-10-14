"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
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
const VIEWS = { remaining: "To call", in_progress: "Switch asked for", converted: "Converted", resting: "Said no / no bank account", all: "Everything" } as const;
type View = keyof typeof VIEWS;
const field = `${toolbarControl} w-full`;
const labelClass = "grid gap-1.5 text-sm font-medium text-foreground";
const alertClass = "rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]";

/**
 * LA-5.5 (Notion sprint) · paper bill → bank payment. A standing list worked on a quiet afternoon,
 * biggest premium first. "12 converted, 26 to go" makes it a task with an end; a conversion counts
 * only when the carrier file shows it.
 */
export function PaperBillCampaign({ campaign, isOwner, readOnly }: { campaign: Campaign; isOwner: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<View>("remaining");
  const [page, setPage] = useState(1);
  const [converting, setConverting] = useState<CampaignRow | null>(null);
  const [logging, setLogging] = useState<CampaignRow | null>(null);
  const [talk, setTalk] = useState(false);
  const { totals, rows } = campaign;
  const visible = useMemo(() => rows.filter((r) => view === "all" || (view === "resting" ? r.state === "declined" || r.state === "no_bank_account" : r.state === view)), [rows, view]);
  const shown = paginate(visible, page, 10);

  return (
    <>
      {rows.length > 0 && (
        <StatStrip label="Paper-bill campaign">
          <StatTile label="On paper bills" value={totals.policies.toLocaleString("en-US")} footnote={`${money(totals.monthlyCents)}/mo in premium`} />
          <StatTile label="Converted" value={totals.converted.toLocaleString("en-US")} valueTone={totals.converted ? "good" : undefined} footnote={totals.converted ? `${money(totals.monthlyMovedCents)}/mo moved off paper` : "shown by a carrier file"} />
          <StatTile label="Switch asked for" value={totals.inProgress.toLocaleString("en-US")} footnote="waiting for the file to show it" />
          <StatTile label="To go" value={totals.remaining.toLocaleString("en-US")} footnote={`${totals.declined} said no · ${totals.noBankAccount} no bank account`} />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {view !== "remaining" && <ClearFiltersButton onClick={() => { setView("remaining"); setPage(1); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
            <Button type="button" variant="outline" onClick={() => setTalk(true)}>Talk track</Button>
          </>}>
            <select aria-label="Which policies" className={toolbarControl} value={view} onChange={(e) => { setView(e.target.value as View); setPage(1); }}>
              {(Object.keys(VIEWS) as View[]).map((v) => <option key={v} value={v}>{VIEWS[v]}</option>)}
            </select>
            <span className="text-sm text-muted-foreground">Biggest premium first</span>
          </DataToolbar>
        }
        footer={visible.length > 10 ? <Pager page={shown.current} pageSize={10} total={visible.length} noun="policies" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No paper-bill policies" hint="Every in-force policy pays by draft or card. Policies the carrier files show as mailed bill appear here." />
        ) : visible.length === 0 ? (
          <NoMatches noun="policies" onClear={() => { setView("all"); setPage(1); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[230px]">Client</th>
                <th className="w-[100px] text-right">Premium</th>
                <th>History</th>
                <th className="w-[220px]">Where it stands</th>
                <th className="w-[260px] text-right"><span className="sr-only">Work it</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <span className="block font-semibold text-foreground">{r.clientName ?? "No client linked"}</span>
                    {r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="block font-medium tabular-nums text-[var(--accent-ink)] hover:underline">{phoneText(r.phone)}</a> : <span className="block text-xs text-muted-foreground">No phone on file</span>}
                    <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="block text-xs text-muted-foreground hover:underline">{r.carrierName} · {r.policyNumber}</Link>
                  </td>
                  <td className="text-right tabular-nums">{money(r.monthlyCents)}<span className="block text-xs text-muted-foreground">a month</span></td>
                  <td className="text-muted-foreground">{r.history}</td>
                  <td>
                    <StatusChip tone={TONE[r.state]}>{STATE_LABELS[r.state]}</StatusChip>
                    {r.state === "declined" && r.returnsOn && <span className="mt-1 block text-xs text-muted-foreground">Back on the list {fileDay(r.returnsOn)}</span>}
                    {r.lastAttempt && <span className="mt-1 block text-xs text-muted-foreground">{CONVERSION_OUTCOME_LABELS[r.lastAttempt.outcome]}, {fileDay(r.lastAttempt.at.slice(0, 10))}{r.lastAttempt.by ? ` · ${r.lastAttempt.by}` : ""}</span>}
                  </td>
                  <td className="text-right">
                    {!readOnly && r.state === "remaining" && (
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        <Button type="button" onClick={() => setConverting(r)}>Start conversion</Button>
                        <Button type="button" variant="ghost" onClick={() => setLogging(r)}>Log call</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {rows.length > 0 && (
        <TableCard title="Is it worth the hours?" description="From the carrier files: how many converted policies lapsed, against those still paying by post.">
          <div className="grid gap-6 px-4 py-4 sm:grid-cols-2">
            <ul className="m-0 grid list-none gap-1 p-0 text-sm">
              <li className="flex justify-between gap-2"><span>Converted</span><span className="tabular-nums">{campaign.lapse.converted}</span></li>
              <li className="flex justify-between gap-2"><span>Still on paper</span><span className="tabular-nums">{campaign.lapse.onPaper}</span></li>
              {!campaign.lapse.comparable && <li className="text-xs text-muted-foreground">Too few policies on one side to compare as percentages yet.</li>}
            </ul>
            <ul className="m-0 grid list-none gap-1 p-0 text-sm">
              {campaign.people.length === 0 ? <li className="text-muted-foreground">No calls logged yet.</li> : campaign.people.map((p) => (
                <li key={p.name} className="flex justify-between gap-2"><span className="min-w-0 truncate">{p.name}</span><span className="shrink-0 tabular-nums">{p.verified} converted · {p.agreed} agreed · {p.calls} calls</span></li>
              ))}
            </ul>
          </div>
        </TableCard>
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
          <DialogTitle>Log the call to {row.clientName ?? row.policyNumber}</DialogTitle>
          <DialogDescription>{row.carrierName} · {row.policyNumber}. If they agreed, use Start conversion instead.</DialogDescription>
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
          {error && <p role="alert" className={alertClass}>{error}</p>}
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
        {error && <p role="alert" className={alertClass}>{error}</p>}
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
