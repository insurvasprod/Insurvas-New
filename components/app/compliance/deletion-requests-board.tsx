"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { DELETION_VIA, METHOD_LABELS, STATUS_LABELS, VIA_LABELS, holdRemaining, type DeletionStatus, type VerificationMethod } from "@/lib/compliance/dataSubject";
import type { DeletionRequest } from "@/lib/compliance/dataSubjectStore";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { notify } from "@/lib/notify";

/**
 * LA-6.5 · deletion requests: log one, verify who it is, hold, perform, certify. Performing deletes
 * data for good, so it asks once more and only the owner sees it.
 */
const TONE: Record<DeletionStatus, StatusTone> = { received: "info", verifying: "info", verified: "info", scheduled: "warning", completed: "good", rejected: "neutral", cancelled: "neutral" };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const who = (r: DeletionRequest) => [r.requesterName, r.phoneDigits ? formatPhone(r.phoneDigits) : null, r.email].filter(Boolean).join(" · ") || "A client record";

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

function NewRequest({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ phone: "", email: "", requester_name: "", received_via: "phone", received_at: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await send("/api/app/compliance/deletions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: f.phone || null, email: f.email || null, requester_name: f.requester_name || null, received_via: f.received_via, received_at: f.received_at ? new Date(`${f.received_at}T12:00:00Z`).toISOString() : null }) });
      notify.done("Request logged. Verify who it is next.");
      onSaved(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const field = "flex flex-col gap-1 text-sm";
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Log a deletion request</DialogTitle>
            <DialogDescription>Log it the day it arrives. Nothing is deleted until identity is verified and the hold has passed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>Phone number<input className={toolbarControl} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className={field}>Email<input className={toolbarControl} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label className={field}>Who asked<input className={toolbarControl} value={f.requester_name} onChange={(e) => setF({ ...f, requester_name: e.target.value })} /></label>
            <label className={field}>Arrived by<select className={toolbarControl} value={f.received_via} onChange={(e) => setF({ ...f, received_via: e.target.value })}>{DELETION_VIA.map((v) => <option key={v} value={v}>{VIA_LABELS[v]}</option>)}</select></label>
            <label className={field}>Received on<input type="date" className={toolbarControl} value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} /></label>
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Log request"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Detail = { request: DeletionRequest; events: { at: string; action: string; detail: Record<string, unknown> }[]; preview: Record<string, number> | null };

function RequestPanel({ id, methods, holdDays, isOwner, readOnly, onClose, onChanged }: { id: string; methods: VerificationMethod[]; holdDays: number; isOwner: boolean; readOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [method, setMethod] = useState<VerificationMethod>(methods[0] ?? "phone_match");
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/app/compliance/deletions/${id}`).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (live) { if (res.ok) setD(body); else setError(body?.error ?? "Could not open the request"); }
    });
    return () => { live = false; };
  }, [id]);
  const act = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const body = await send(`/api/app/compliance/deletions/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setD((cur) => ({ request: body.request, events: body.events, preview: cur?.preview ?? null }));
      notify.done(done);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  const r = d?.request;
  const hold = r ? holdRemaining(r.scheduledPurgeAt, new Date()) : null;
  const canMove = isOwner && !readOnly;
  return (
    <DetailPanel mode="overlay" title={r ? who(r) : "Deletion request"} subtitle={r ? `Received ${day(r.receivedAt)} by ${VIA_LABELS[r.receivedVia as keyof typeof VIA_LABELS] ?? r.receivedVia}` : undefined}
      status={r ? <StatusChip tone={TONE[r.status as DeletionStatus]}>{STATUS_LABELS[r.status as DeletionStatus] ?? r.status}</StatusChip> : undefined} onClose={onClose}>
      {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
      {!r ? null : (
        <>
          {d?.preview ? (
            <p className="text-sm">We hold, for this person: {d.preview.clients} client record(s), {d.preview.leads} lead(s), {d.preview.applications} application(s), {d.preview.policies} policy(ies), {d.preview.carrierRows} carrier row(s).</p>
          ) : null}
          {(r.status === "verifying" || r.status === "received") && canMove ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-sm font-semibold">Verify who it is</span>
              <select className={toolbarControl} value={method} onChange={(e) => setMethod(e.target.value as VerificationMethod)} aria-label="How identity was verified">{methods.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}</select>
              <input className={toolbarControl} placeholder="Number they called from, or address they wrote from" value={contact} onChange={(e) => setContact(e.target.value)} aria-label="The number or email the request came from" />
              <textarea className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Note (required for a document)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button disabled={busy} onClick={() => void act({ action: "verify", method, note: note || null, contact: contact || null },`Verified. Deletable after ${holdDays} days.`)}>Verify and start the {holdDays}-day hold</Button>
              <span className="text-sm font-semibold">Or reject it</span>
              <textarea className="min-h-16 rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Why, and what would satisfy you (the requester is told)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="outline" disabled={busy || reason.trim().length < 10} onClick={() => void act({ action: "reject", reason }, "Request rejected")}>Reject with this reason</Button>
            </div>
          ) : null}
          {r.status === "scheduled" ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-sm">{hold?.label}</span>
              {canMove ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => void act({ action: "cancel", reason: null }, "Request cancelled")}>Cancel the request</Button>
                  {hold?.due ? <Button disabled={busy} onClick={() => setConfirming(true)}>Delete now</Button> : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {r.status === "rejected" ? <p className="text-sm">Rejected: {r.rejectionReason}</p> : null}
          {r.status === "completed" ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-sm">Deleted {day(r.completedAt)}. The number stays on the do-not-call list so they are never called again.</span>
              <Button asChild variant="outline"><a href={`/api/app/compliance/deletions/${r.id}/certificate`}>Download the certificate</a></Button>
            </div>
          ) : null}
          <div className="flex flex-col gap-1 border-t border-border pt-4 text-sm">
            <span className="font-semibold">Audit trail</span>
            {(d?.events ?? []).map((e) => <span key={`${e.at}-${e.action}`} className="text-muted-foreground">{e.at.slice(0, 16).replace("T", " ")} · {e.action.replace(":", " ")}</span>)}
          </div>
          {confirming ? (
            <Dialog open onOpenChange={(next) => { if (!next) setConfirming(false); }}>
              <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                  <DialogTitle>Delete this person&apos;s data?</DialogTitle>
                  <DialogDescription>This cannot be undone. Their calls, notes, consent records, answers and contact details are deleted; policies, commissions, complaints and the do-not-call entry are kept without them.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirming(false)}>Keep it</Button>
                  <Button disabled={busy} onClick={() => void act({ action: "perform", confirm: true }, "Deleted. The certificate is ready.")}>{busy ? "Deleting…" : "Delete"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      )}
    </DetailPanel>
  );
}

export function DeletionRequestsBoard({ requests, methods, holdDays, isOwner, readOnly }: { requests: DeletionRequest[]; methods: VerificationMethod[]; holdDays: number; isOwner: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const shown = paginate(requests, page, 15);
  const openCount = requests.filter((r) => ["received", "verifying", "verified", "scheduled"].includes(r.status)).length;
  const due = requests.filter((r) => r.status === "scheduled" && holdRemaining(r.scheduledPurgeAt, new Date()).due).length;
  return (
    <>
      <StatStrip label="Deletion requests">
        <StatTile label="Open" value={String(openCount)} footnote="not yet deleted" />
        <StatTile label="Ready to delete" value={String(due)} valueTone={due ? "warning" : undefined} footnote="hold over" />
        <StatTile label="Deleted" value={String(requests.filter((r) => r.status === "completed").length)} footnote="certificate issued" />
        <StatTile label="Hold" value={`${holdDays} days`} footnote="after verification" />
      </StatStrip>
      <TableCard
        toolbar={<DataToolbar actions={<>{!readOnly ? <Button onClick={() => setCreating(true)}>Log a request</Button> : null}<RefreshButton onClick={refresh} refreshing={refreshing} /></>} />}
        footer={requests.length > 15 ? <Pager page={shown.current} pageSize={15} total={requests.length} noun="requests" onPage={setPage} /> : undefined}
      >
        {requests.length === 0 ? (
          <EmptyState title="No deletion requests" hint="When someone asks to be deleted, log it the day it arrives." action={!readOnly ? <Button onClick={() => setCreating(true)}>Log a request</Button> : undefined} />
        ) : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead><tr><th className="w-[120px]">Received</th><th>Who</th><th className="w-[200px]">Status</th><th className="w-[260px]">Next</th><th className="w-[90px] text-right" /></tr></thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.id}>
                  <td>{day(r.receivedAt)}</td>
                  <td>{who(r)}</td>
                  <td><StatusChip tone={TONE[r.status as DeletionStatus]}>{STATUS_LABELS[r.status as DeletionStatus] ?? r.status}</StatusChip></td>
                  <td className="text-muted-foreground">{r.status === "scheduled" ? holdRemaining(r.scheduledPurgeAt, new Date()).label : r.status === "verifying" || r.status === "received" ? "Verify who it is" : r.status === "completed" ? "Certificate issued" : "—"}</td>
                  <td className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {creating ? <NewRequest onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setOpen(id); refresh(); }} /> : null}
      {open ? <RequestPanel key={open} id={open} methods={methods} holdDays={holdDays} isOwner={isOwner} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={refresh} /> : null}
    </>
  );
}
