"use client";

import { DismissButton } from "@/components/app/route-sheet";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Field, control, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { DELETION_VIA, EVIDENCE_NOTE_MIN, METHOD_LABELS, VIA_LABELS, holdRemaining, type VerificationMethod } from "@/lib/compliance/dataSubject";
import type { DeletionRequest } from "@/lib/compliance/dataSubjectStore";
import { OPEN_DELETION, deletionChip, deletionName, deletionNext, deletionQueue, type DeletionQueue } from "@/lib/compliance/deletionView";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { dayMonthYear } from "@/lib/format/dates";
import { Callout } from "@/components/app/settings/primitives";
import { ViewTabs } from "@/components/app/view-tabs";
import { ComplianceSlot } from "@/components/app/compliance/compliance-slot";

/**
 * LA-6.5 · deletion requests: log one, verify who it is, hold, perform, certify. Performing deletes data for
 * good, so it asks once more and only the agency's performers (Compliance settings) see it.
 *
 * Foundation pass (2026-11-03, docs/compliance/FOUNDATION-PASS.md), list page → record page → tabs:
 *   /app/deletion-requests           Open · Ready to delete · Done · All on the title line (`?queue=`), the
 *                                    figures link to them, Log a request the one primary; what waits goes to
 *                                    the bell and the rail's badge, never a line on the page.
 *   /app/deletion-requests/new       Log a request (was a pop-up), with a leave guard.
 *   /app/deletion-requests/[id]      the request (was a side sheet): title, status chip, one facts line; the
 *                                    step's action and More, each a confirm with its fields; tabs What we hold
 *                                    · Audit trail.
 */
export type { DeletionQueue };
/** "16 Oct 2026", as every Compliance step dates things. */
const day = (iso: string | null) => (iso ? dayMonthYear(iso) : "—");

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

/* ── /app/deletion-requests ────────────────────────────────────────────── */

export function DeletionRequestsBoard({ requests, holdDays, queue, mayPerform, readOnly }: { requests: DeletionRequest[]; holdDays: number; queue: DeletionQueue; mayPerform: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const pageSize = useFittingPageSize(480, 45);
  const [now] = useState(() => new Date());
  const isDue = (r: DeletionRequest) => r.status === "scheduled" && holdRemaining(r.scheduledPurgeAt, now).due;
  // The tab's requests oldest first (the clock started the day each arrived), as the request page's ‹ › walk them.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return deletionQueue(requests, queue, now).filter((r) =>
      !needle || [r.requesterName, r.email].some((v) => v?.toLowerCase().includes(needle)) || (digits.length >= 3 && (r.phoneDigits ?? "").includes(digits)));
  }, [requests, queue, q, now]);
  const shown = paginate(visible, page, pageSize);
  const openCount = requests.filter((r) => OPEN_DELETION.has(r.status)).length;
  const due = requests.filter(isDue).length;
  const href = (next: DeletionQueue) => (next === "open" ? "/app/deletion-requests" : `/app/deletion-requests?queue=${next}`);
  return (
    <>
      <ComplianceSlot slot="lead">
        <ViewTabs label="Deletion requests" idPrefix="deletions-view" value={queue}
          tabs={[
            { key: "open", label: "Open", count: openCount, href: href("open") },
            { key: "ready", label: "Ready to delete", count: due || null, tone: "danger", href: href("ready") },
            { key: "done", label: "Done", count: requests.length - openCount, href: href("done") },
            { key: "all", label: "All", count: requests.length, href: href("all") },
          ]} />
      </ComplianceSlot>
      {!readOnly ? <ComplianceSlot slot="corner"><Button asChild><Link href="/app/deletion-requests/new"><Plus aria-hidden="true" />Log a request</Link></Button></ComplianceSlot> : null}
      {/* What waits on someone goes to the bell (owner 2026-11-02) and the rail's badge; on the page it is the
          tabs' counts, the Ready to delete tile's chip and each row's Next step (r7 5·A). No notice card. */}
      <StatStrip label="Deletion requests">
        <StatTile label="Open" value={String(openCount)} footnote="not yet deleted" href={href("open")} />
        <StatTile label="Ready to delete" value={String(due)} footnote={due ? <StatusChip tone="warning">Hold over</StatusChip> : mayPerform ? "hold over" : "the agency owner deletes"} href={href("ready")} />
        <StatTile label="Deleted" value={String(requests.filter((r) => r.status === "completed").length)} footnote="certificate issued" href={href("done")} />
        <StatTile label="Hold" value={`${holdDays} days`} footnote="after verification" />
      </StatStrip>
      <TableCard
        toolbar={<DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}><ToolbarSearch value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search name, phone or email" label="Search deletion requests" /></DataToolbar>}
        footer={visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun={visible.length === 1 ? "request" : "requests"} onPage={setPage} /> : undefined}
      >
        {requests.length === 0 ? (
          <EmptyState title="No deletion requests" hint="When someone asks to be deleted, log it the day it arrives." action={!readOnly ? <Button asChild><Link href="/app/deletion-requests/new">Log a request</Link></Button> : undefined} />
        ) : visible.length === 0 ? (
          q ? <NoMatches noun="requests" onClear={() => setQ("")} /> : <EmptyState title={queue === "ready" ? "No hold is over" : "Nothing here"} hint="Every request stays under All." />
        ) : (
          // One line a request, one chip, the next step a verb (r7 5·A). The whole row opens the request; nothing
          // deletes from the list. Email is the name's tooltip; Phone keeps a column, as the DNC entry is kept by number.
          <table className="portal-lead-table w-full min-w-[680px] text-left text-sm">
            <thead><tr><th>Person</th><th>Phone</th><th>Received</th><th>Status</th><th>Next step</th></tr></thead>
            <tbody>
              {shown.rows.map((r) => {
                const chip = deletionChip(r, now);
                const nextStep = deletionNext(r, now);
                return (
                  <tr key={r.id} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(`/app/deletion-requests/${r.id}`); }}>
                    <td className="max-w-[260px] truncate whitespace-nowrap font-medium text-foreground" title={[r.requesterName, r.email].filter(Boolean).join(" · ") || undefined}><Link href={`/app/deletion-requests/${r.id}`} className="hover:underline">{deletionName(r)}</Link></td>
                    <td className={cn("whitespace-nowrap tabular-nums", !r.phoneDigits && "text-muted-foreground")}>{r.phoneDigits ? formatPhone(r.phoneDigits) : "—"}</td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{day(r.receivedAt)}</td>
                    <td className="whitespace-nowrap"><StatusChip tone={chip.tone}>{chip.label}</StatusChip></td>
                    <td className="whitespace-nowrap" title={nextStep.sentence}>{nextStep.verb} ›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

/* ── /app/deletion-requests/new ────────────────────────────────────────── */

export function NewDeletionRequestForm() {
  const router = useRouter();
  const blank = { phone: "", email: "", requester_name: "", received_via: "phone", received_at: new Date().toISOString().slice(0, 10) };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const scope = useRef<HTMLFormElement>(null);
  const dirty = Boolean(f.phone || f.email || f.requester_name);
  const save = async (): Promise<boolean> => {
    // A problem is a toast, never a notice on the page (r7 2026-11-11).
    if (!f.phone.trim() && !f.email.trim()) { notify.block("Enter the phone number or the email to delete."); return false; }
    setBusy(true);
    try {
      const body = await send("/api/app/compliance/deletions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: f.phone || null, email: f.email || null, requester_name: f.requester_name || null, received_via: f.received_via, received_at: f.received_at ? new Date(`${f.received_at}T12:00:00Z`).toISOString() : null }) });
      notify.done("Request logged. Verify who it is next.");
      setF(blank);
      router.push(`/app/deletion-requests/${body.id}`);
      return true;
    } catch (err) {
      notify.block(err instanceof Error ? err.message : "That didn't save", { detail: "Nothing was changed." });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };
  return (
    <form ref={scope} onSubmit={submit} className={cn(cardSurface, "flex flex-col gap-4 p-5")}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Phone number" htmlFor="del-phone" hint="The number to delete. Nothing is deleted until identity is verified and the hold has passed."><input id="del-phone" className={control} inputMode="tel" maxLength={40} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email" htmlFor="del-email"><input id="del-email" className={control} type="email" maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Who asked" htmlFor="del-name"><input id="del-name" className={control} maxLength={200} value={f.requester_name} onChange={(e) => setF({ ...f, requester_name: e.target.value })} /></Field>
        <Field label="Arrived by" htmlFor="del-via"><select id="del-via" className={control} value={f.received_via} onChange={(e) => setF({ ...f, received_via: e.target.value })}>{DELETION_VIA.map((v) => <option key={v} value={v}>{VIA_LABELS[v]}</option>)}</select></Field>
        <Field label="Received on" htmlFor="del-received" hint="Log it the day it arrives."><input id="del-received" type="date" className={control} max={new Date().toISOString().slice(0, 10)} value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <DismissButton href="/app/deletion-requests">Discard</DismissButton>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Log request"}</Button>
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setF(blank)} what="this request" />
    </form>
  );
}

/* ── /app/deletion-requests/[id]: the header's buttons ─────────────────── */

type Step = null | "verify" | "reject" | "cancel" | "perform";

/**
 * The request's buttons on the title line, by status: Verify (and Reject in More) while identity is
 * unchecked; Delete now once the hold is over (Cancel the request in More); the certificate once deleted.
 * Each step is a confirm with the fields it needs. Only the agency's performers see the moving steps.
 */
export function DeletionRequestActions({ request, methods, holdDays, mayPerform, readOnly }: { request: DeletionRequest; methods: VerificationMethod[]; holdDays: number; mayPerform: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(null);
  const [method, setMethod] = useState<VerificationMethod>(methods[0] ?? "phone_match");
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const r = request;
  const canMove = mayPerform && !readOnly;
  const hold = holdRemaining(r.scheduledPurgeAt, now);
  const act = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/app/compliance/deletions/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      notify.done(done);
      setStep(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const verifying = r.status === "received" || r.status === "verifying";
  const noteNeeded = method === "document" || method === "known_customer";
  const close = (open: boolean) => { if (!open) { setStep(null); setError(null); } };
  const failure = error ? <Callout tone="error" title={error} /> : null;

  return (
    <>
      {canMove && verifying ? <MoreMenu items={[{ label: "Reject the request", onSelect: () => setStep("reject") }]} /> : null}
      {canMove && r.status === "scheduled" ? <MoreMenu items={[{ label: "Cancel the request", onSelect: () => setStep("cancel") }]} /> : null}
      {canMove && verifying ? <Button onClick={() => setStep("verify")}>Verify who it is</Button> : null}
      {canMove && r.status === "scheduled" && hold.due ? <Button onClick={() => setStep("perform")}>Delete now</Button> : null}
      {r.status === "completed" ? <Button asChild><a href={`/api/app/compliance/deletions/${r.id}/certificate`}>Download the certificate</a></Button> : null}

      <ConfirmDialog open={step === "verify"} onOpenChange={close} busy={busy} destructive={false}
        title="Verify who it is"
        description={`Records how identity was confirmed and starts the ${holdDays}-day hold. The request can still be cancelled during the hold.`}
        confirmLabel={busy ? "Verifying…" : `Verify and start the ${holdDays}-day hold`}
        confirmDisabled={noteNeeded && note.trim().length < EVIDENCE_NOTE_MIN}
        onConfirm={() => void act({ action: "verify", method, note: note || null, contact: contact || null }, `Verified. Deletable after ${holdDays} days.`)}
        fields={<>
          <Field label="How identity was verified" htmlFor="del-method"><select id="del-method" className={control} value={method} onChange={(e) => setMethod(e.target.value as VerificationMethod)}>{methods.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}</select></Field>
          {!r.requesterPhone && !r.requesterEmail ? <Field label="Where the request came from" htmlFor="del-contact" hint="The number they called from, or the address they wrote from: the match is made against it."><input id="del-contact" className={control} maxLength={254} value={contact} onChange={(e) => setContact(e.target.value)} /></Field> : null}
          <Field label="Note" htmlFor="del-note" required={noteNeeded} hint={noteNeeded ? `Describe how you confirmed it (at least ${EVIDENCE_NOTE_MIN} characters).` : undefined}><textarea id="del-note" className={textareaControl} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {failure}
        </>} />
      <ConfirmDialog open={step === "reject"} onOpenChange={close} busy={busy}
        title="Reject this request?"
        description="The requester is told why, and what would satisfy you. Nothing is deleted."
        confirmLabel={busy ? "Rejecting…" : "Reject the request"} cancelLabel="Keep it open"
        confirmDisabled={reason.trim().length < 10}
        onConfirm={() => void act({ action: "reject", reason }, "Request rejected")}
        fields={<><Field label="Why, and what would satisfy you" htmlFor="del-reason" required><textarea id="del-reason" className={textareaControl} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{failure}</>} />
      <ConfirmDialog open={step === "cancel"} onOpenChange={close} busy={busy}
        title="Cancel this request?"
        description="The hold stops and nothing is deleted. The request and its audit trail are kept."
        confirmLabel={busy ? "Cancelling…" : "Cancel the request"} cancelLabel="Keep the hold"
        onConfirm={() => void act({ action: "cancel", reason: null }, "Request cancelled")}
        fields={failure} />
      <ConfirmDialog open={step === "perform"} onOpenChange={close} busy={busy}
        title="Delete this person's data?"
        description="This cannot be undone. Their calls, notes, consent records, answers and contact details are deleted; policies, commissions, complaints and the do-not-call entry are kept without them."
        confirmLabel={busy ? "Deleting…" : "Delete"} cancelLabel="Keep it"
        onConfirm={() => void act({ action: "perform", confirm: true }, "Deleted. The certificate is ready.")}
        fields={failure} />
    </>
  );
}
