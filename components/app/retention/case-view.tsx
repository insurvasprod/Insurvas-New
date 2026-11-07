"use client";

import Link from "next/link";
import { NoteField } from "@/components/ui/note-field";
import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkboxControl, control, Field } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FactTable } from "@/components/ui/fact-table";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { Callout } from "@/components/app/settings/primitives";
import { ServicingRequestForm } from "@/components/app/retention/servicing-request-form";
import { CaseActions as ReinstatementActions, CaseComparison as ReinstatementComparison, CaseNeedsForm as ReinstatementNeeds } from "@/components/app/retention/reinstatement-case";
import { STATUS_MEANING } from "@/components/app/retention/ladder-mark";
import type { CaseRow as ReinstatementRow } from "@/lib/retention/reinstatementStore";
import { fileDay } from "@/lib/ingestion/constants";
import { personName } from "@/lib/format/personName";
import { ACTION_LABELS, actionsFor, defaultActionFor, isUnreached } from "@/lib/retention/callLog";
import { CONTACT_OUTCOME_LABELS, CONTACT_OUTCOMES, type ActionTaken, type ContactOutcome } from "@/lib/retention/constants";
import { OPEN_STATUSES, type Reason } from "@/lib/retention/cases/ladder";
import type { CaseCall, CaseRow } from "@/lib/retention/cases/store";
import type { RequestType } from "@/lib/retention/servicing";
import { notify } from "@/lib/notify";

/**
 * A Retention case's page, the client parts (pick A, owner 2026-11-05): the header's buttons, "What to do" for the
 * case's step, and the Calls tab. Everything is in place; only "close without a save" and "assign" are pop-ups
 * (a confirm each). A fix never closes the case: it waits for a carrier file to prove it.
 */

async function act(body: Record<string, unknown>) {
  const response = await fetch("/api/app/retention/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
  return data;
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : "That could not be saved.");
const isOpen = (row: CaseRow) => (OPEN_STATUSES as readonly string[]).includes(row.status);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const nameOf = (row: CaseRow) => (row.clientName ? personName(row.clientName) : row.policyNumber);

/**
 * The header's primary (this step's next action) and More: assign (owner), close without a save, the policy. On
 * the What to do tab the primary is left out: it only linked to the tab you are on, beside the tab's own button
 * (walk 2026-11-05: "Take the payment" over "Payment taken").
 */
export function CaseActions({ row, isOwner, owners, readOnly, onDoTab = false }: { row: CaseRow; isOwner: boolean; owners: Array<{ id: string; name: string }>; readOnly: boolean; onDoTab?: boolean }) {
  const [closing, setClosing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [losing, setLosing] = useState(false);
  const router = useRouter();
  const base = `/app/retention/${row.id}`;
  const policy = { label: "Open the policy", href: `/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}` };
  if (readOnly || !isOpen(row)) return <MoreMenu items={[policy]} />;
  return (
    <>
      {row.step === "lost"
        // Closing a lost case is final: a confirm that names the client, never one click (critique A2).
        ? <Button type="button" onClick={() => setLosing(true)}>Close to win-back</Button>
        : onDoTab ? null : <Button asChild><Link href={`${base}?tab=do`}>{row.status === "waiting_on_carrier" ? "What's left" : row.nextAction}</Link></Button>}
      {losing && <LostDialog row={row} onClose={() => setLosing(false)} onDone={() => { setLosing(false); router.push("/app/retention"); }} />}
      <MoreMenu items={[
        isOwner && { label: "Assign", onSelect: () => setAssigning(true) },
        { label: "Log a call", href: `${base}?tab=calls` },
        { label: "Close without a save", onSelect: () => setClosing(true) },
        policy,
      ]} />
      {closing && <CloseDialog row={row} onClose={() => setClosing(false)} onDone={() => { setClosing(false); router.push("/app/retention"); }} />}
      {assigning && <AssignDialog row={row} owners={owners} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); router.refresh(); }} />}
    </>
  );
}

const CLOSE_REASONS = ["The client wants to cancel", "The client can't afford it", "Duplicate case", "Not our policy", "Other"];

/** The only manual close: a confirm with a reason. It counts as "closed without a save", apart from saves. */
function CloseDialog({ row, onClose, onDone }: { row: CaseRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(CLOSE_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = [reason, note.trim()].filter(Boolean).join(": ");
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Close without a save?</DialogTitle>
          <DialogDescription>{nameOf(row)} · {row.carrierName} {row.policyNumber}. It leaves Retention and counts as not saved.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Why" htmlFor="close-why"><select id="close-why" className={control} value={reason} onChange={(e) => setReason(e.target.value)}>{CLOSE_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Note" htmlFor="close-note" required={reason === "Other"}><NoteField id="close-note"  maxLength={900} value={note} onChange={setNote} /></Field>
          {error && <Callout tone="error" title={error} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Keep it open</Button>
          <Button type="button" variant="destructive" disabled={busy || (reason === "Other" && note.trim().length < 3)} onClick={async () => {
            setBusy(true); setError(null);
            try { await act({ action: "close", id: row.id, as: "closed_no_save", reason: text }); notify.done("Closed without a save."); onDone(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
          }}>{busy ? "Closing…" : "Close without a save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LOST_REASONS = ["Lapsed past the carrier's window", "Charged back", "The client cancelled", "Other"];

/** Closing a lost case: it leaves Retention for good and the client goes to win-back after the cooling-off. */
function LostDialog({ row, onClose, onDone }: { row: CaseRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(row.reason === "chargeback" ? LOST_REASONS[1] : LOST_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      title="Close to win-back?"
      description={`${nameOf(row)} · ${row.carrierName} ${row.policyNumber}. It leaves Retention for good and counts as lost. The client goes to win-back after the cooling-off.`}
      confirmLabel={busy ? "Closing…" : "Close to win-back"}
      cancelLabel="Keep it open"
      busy={busy}
      confirmDisabled={reason === "Other" && note.trim().length < 3}
      fields={
        <>
          <Field label="Why it was lost" htmlFor="lost-why"><select id="lost-why" className={control} value={reason} onChange={(e) => setReason(e.target.value)}>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Note" htmlFor="lost-note" required={reason === "Other"}><NoteField id="lost-note"  maxLength={900} value={note} onChange={setNote} /></Field>
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
        </>
      }
      onConfirm={async () => {
        setBusy(true); setError(null);
        try {
          await act({ action: "close", id: row.id, as: "lost", reason: [reason, note.trim()].filter(Boolean).join(": ") });
          notify.done("Closed. The client goes to win-back after the cooling-off.");
          onDone();
        } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
      }}
    />
  );
}

function AssignDialog({ row, owners, onClose, onDone }: { row: CaseRow; owners: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(owners.find((o) => o.id !== row.ownerId)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Assign {nameOf(row)}&apos;s case</DialogTitle>
          <DialogDescription>Now: {row.ownerName ?? "nobody"}.</DialogDescription>
        </DialogHeader>
        <Field label="To" htmlFor="assign-to"><select id="assign-to" className={control} value={to} onChange={(e) => setTo(e.target.value)}>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        {error && <Callout tone="error" title={error} />}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Back</Button>
          <Button type="button" disabled={!to || busy || to === row.ownerId} onClick={async () => {
            setBusy(true); setError(null);
            try { await act({ action: "assign", id: row.id, user_id: to }); notify.done("Assigned."); onDone(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
          }}>{busy ? "Assigning…" : "Assign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the agent can say, per step: an opening line that names the real problem, never a pressure line. */
const SCRIPT: Partial<Record<Reason, string>> = {
  first_draft_failed: "Your first payment hasn't reached the carrier, so the policy hasn't started yet. Can we get it set up with the right account or date?",
  later_draft_failed: "Your last payment didn't come through. Can we take it now, so your cover stays in place?",
  bounced_draft: "Your bank returned the last draft. Has the account or the date changed? We can fix it in a few minutes.",
  banking_problem: "The carrier can't take the payment from the account on file. Shall we update the bank details?",
  pending_lapse: "The carrier will end your policy soon because a payment is missing. Can we take it today?",
  lapse_notice: "You'll have had a letter from the carrier about a missed payment. I can help you sort it now.",
  lapsed_reinstatable: "Your policy lapsed, but the carrier will still take it back for a short time. Shall we bring it back?",
  cancellation_request: "I saw you asked to cancel. Can I ask what changed? There may be an option that suits you better.",
  mailed_bill: "Your bill comes in the post. Most clients find it easier paid straight from the bank on the day their money arrives.",
};

/** Step 1, 2 and paperwork fixes that go to the carrier as a servicing request (verified by the next file). */
// The button says what the form it opens is titled (critique C4: "New draft date" opened "Payment date").
const DATE = { type: "draft_date_change" as const, label: "New payment date" };
const BANK = { type: "payment_method_change" as const, label: "New bank or card" };
const SERVICING: Partial<Record<Reason, Array<{ type: RequestType; label: string }>>> = {
  first_draft_failed: [DATE, BANK],
  later_draft_failed: [DATE, BANK],
  bounced_draft: [BANK, DATE],
  banking_problem: [BANK],
  pending_lapse: [DATE, BANK],
  lapse_notice: [DATE, BANK],
  payment_date_change: [DATE],
  mailed_bill: [{ type: "bill_to_draft_conversion", label: "Switch to bank payment" }],
};

/** One step of "What to do": done steps tick off, the current one shows its body (its buttons, its script). */
type Step = { key: string; title: string; done: boolean; body?: ReactNode };

const PAID_HOW = ["Card over the phone", "Bank draft run again", "Carrier's payment line", "Mailed check", "Other"];

/**
 * "What to do": the case's step, its playbook, in place. On step 3 the reinstatement (LA-5.6) is worked here,
 * not on a second page with its own tracker (critique D1): its next step, what the carrier needs, and the
 * reinstate-or-sell-new comparison beside the files' facts.
 */
export function WhatToDo({ row, reinstatement, readOnly }: { row: CaseRow; reinstatement: ReinstatementRow | null; readOnly: boolean }) {
  const router = useRouter();
  const fixes = SERVICING[row.reason] ?? [];
  const [form, setForm] = useState<RequestType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // "Payment taken" captures what was taken, so the next person knows before the file catches up (critique C3).
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidHow, setPaidHow] = useState(PAID_HOW[0]);
  // Today where the agent is, not in UTC (an evening payment is not tomorrow's).
  const [paidOn, setPaidOn] = useState(() => new Date().toLocaleDateString("en-CA"));
  const open = isOpen(row) && !readOnly;
  const record = async (kind: "payment_taken" | "sent_to_carrier" | "checklist", items?: string[]) => {
    setBusy(true); setError(null);
    try {
      const paid = kind === "payment_taken" ? `${paidHow}, ${fileDay(paidOn)}` : null;
      const cents = kind === "payment_taken" && amount.trim() ? Math.round(Number(amount) * 100) : null;
      await act({ action: "fix", id: row.id, kind, note: [paid, note.trim()].filter(Boolean).join(" · ") || null, ...(cents !== null ? { amount_cents: cents } : {}), ...(items ? { items } : {}) });
      notify.done(kind === "checklist" ? "Saved." : "Noted. It stays here until a carrier file shows it.");
      setNote(""); setPaying(false); setAmount("");
      router.refresh();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const saveNote = async () => {
    setBusy(true); setError(null);
    try {
      await act({ action: "note", id: row.id, note: note.trim() });
      notify.done("Note saved.");
      setNote("");
      router.refresh();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const amountOk = amount.trim() === "" || (/^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0);

  if (!isOpen(row)) return <TableCard className="lg:flex-1"><EmptyState title={row.status === "saved" ? "Saved: a carrier file proved it" : row.status === "lost" ? "Lost" : "Closed without a save"} hint={row.outcomeReason ?? (row.resolvedAt ? `On ${fileDay(row.resolvedAt.slice(0, 10))}.` : "Nothing left to do.")} /></TableCard>;
  if (form) {
    return <ServicingRequestForm carrierId={row.carrierId} policyNumber={row.policyNumber} type={form} origin="retention_board" fromQueue={false} initialNote={note} onCancel={() => setForm(null)} onDone={async (requestId) => {
      if (requestId) { try { await act({ action: "link_servicing", id: row.id, request_id: requestId }); } catch (e) { notify.fail(errorText(e)); } }
      setForm(null); setNote(""); router.refresh();
    }} />;
  }

  const afterLapse = row.step === "lapsed_reinstatable" || row.step === "lost";
  const checklist = row.reason === "pending_manual_action" ? ["Find out what the carrier needs", "Got it from the client", "Sent to the carrier"] : null;
  const reinstating = row.step === "lapsed_reinstatable" && reinstatement !== null;
  const meaning = row.evidence.status ? STATUS_MEANING[String(row.evidence.status)] : null;
  const called = Boolean(row.lastContactAt || row.lastCall || row.contactAttempts > 0);
  const fixed = row.status === "waiting_on_carrier" || Boolean(row.servicingRequestId);
  const base = `/app/retention/${row.id}`;
  const script = SCRIPT[row.reason];

  // The pieces a step can hold: the call, the fixes, the payment fields, the wait for the file.
  const callBody = (
    <>
      {/* With no phone on file, "call the client" is a dead end: say where to find a number (critique C2). */}
      {!row.phone && <p className="m-0 text-sm text-[var(--warning-ink)]">No phone on file: find a number on the application, or ask the carrier.</p>}
      {script && <p className="m-0 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm text-foreground"><span className="text-xs font-semibold text-muted-foreground">Say </span>&ldquo;{script}&rdquo;</p>}
      {open && <div><Button asChild size="sm" variant="outline"><Link href={`${base}?tab=calls`}>Log the call</Link></Button></div>}
    </>
  );
  const payingFields = open && paying && (
    // What was taken, in place (critique C3): the amount, how and when; the next carrier file proves it.
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3" role="group" aria-label="The payment taken">
      <Field label="Amount ($)" htmlFor="paid-amount" error={amountOk ? undefined : "An amount like 63.48"}><input id="paid-amount" inputMode="decimal" autoComplete="off" className={control} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="How" htmlFor="paid-how"><select id="paid-how" className={control} value={paidHow} onChange={(e) => setPaidHow(e.target.value)}>{PAID_HOW.map((h) => <option key={h}>{h}</option>)}</select></Field>
      <Field label="When" htmlFor="paid-on"><input id="paid-on" type="date" className={control} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-3">
        <Button type="button" variant="outline" onClick={() => setPaying(false)}>Cancel</Button>
        <Button type="button" disabled={busy || !amountOk || !paidOn} onClick={() => void record("payment_taken")}>{busy ? "Saving…" : "Record the payment"}</Button>
      </div>
    </div>
  );
  const fixBody = (
    <>
      {payingFields}
      {open && !paying && (
        <div className="flex flex-wrap items-center gap-2">
          {(row.step === "payment_problem" || row.step === "pending_lapse") && <Button type="button" size="sm" disabled={busy} onClick={() => setPaying(true)}>Payment taken</Button>}
          {fixes.map((f) => <Button key={f.type} type="button" size="sm" variant={row.step === "paperwork" ? "default" : "outline"} disabled={busy} onClick={() => setForm(f.type)}>{f.label}</Button>)}
          {row.step === "paperwork" && !fixes.length && <Button type="button" size="sm" disabled={busy} onClick={() => void record("sent_to_carrier")}>Sent to the carrier</Button>}
        </div>
      )}
    </>
  );
  const fileBody = <p className="m-0 text-sm text-muted-foreground">Nothing to press: the next carrier file closes it as saved{row.evidence.file_date ? ` (latest file ${fileDay(String(row.evidence.file_date))})` : ""}.</p>;

  // The steps, in order. `sequential`: each follows the one before (a done step ticks off, the next opens);
  // otherwise they are a plain list (owner 2026-11-06: "continuing if they have to be, if not, not").
  const r = reinstatement;
  const rDone = (s: string) => Boolean(r && ["contacted", "client_agreed", "submitted"].indexOf(r.status) >= ["contacted", "client_agreed", "submitted"].indexOf(s));
  const plan: { sequential: boolean; steps: Step[] } =
    row.step === "lost" ? { sequential: false, steps: [
      { key: "why", title: "Nothing left to save: the files show the policy gone", done: false },
      { key: "close", title: "Close it to win-back; the client is called again after the cooling-off", done: false },
    ] }
      : row.step === "lapsed_reinstatable" ? { sequential: true, steps: [
        // Each step shows the reinstatement's own next button (Called them › Client agreed › Sent to the carrier).
        { key: "call", title: "Call: the carrier still takes it back", done: r ? rDone("contacted") : called, body: <>{callBody}{r && open ? <div className="flex flex-wrap items-center gap-2"><ReinstatementActions row={r} /></div> : null}</> },
        { key: "agree", title: "Agree it with the client, and fill in what the carrier needs below", done: r ? rDone("client_agreed") : false, body: r ? <ReinstatementActions row={r} /> : null },
        { key: "send", title: "Send it to the carrier", done: r ? rDone("submitted") : fixed, body: r ? <ReinstatementActions row={r} /> : (open && <div><Button type="button" size="sm" disabled={busy} onClick={() => void record("sent_to_carrier")}>Sent to the carrier</Button></div>) },
        { key: "file", title: "The next file shows it back in force", done: false, body: fileBody },
      ] }
        : checklist ? { sequential: false, steps: checklist.map((item) => ({ key: item, title: item, done: checked.includes(item) })) }
          : row.reason === "payment_date_change" ? { sequential: true, steps: [
            { key: "confirm", title: "Confirm the new date with the client", done: called, body: callBody },
            { key: "fix", title: "Send the change to the carrier", done: fixed, body: fixBody },
            { key: "file", title: "The next file shows the new date", done: false, body: fileBody },
          ] }
            : { sequential: true, steps: [
              { key: "call", title: row.reason === "mailed_bill" ? "Call before the next bill is due" : row.reason === "cancellation_request" ? "Call: find out why they want to cancel" : "Call the client", done: called, body: callBody },
              { key: "fix", title: row.reason === "mailed_bill" ? "Offer a bank payment on the day their money arrives" : row.reason === "cancellation_request" ? "Offer a fix, or close it without a save" : row.step === "paperwork" ? "Get what is needed and send it" : fixes.length ? "Take the payment, or fix the bank or the date" : "Take the payment", done: fixed, body: fixBody },
              { key: "file", title: "The next carrier file closes it", done: false, body: fileBody },
            ] };
  const current = plan.sequential ? plan.steps.findIndex((s) => !s.done) : -1;
  // The step on show: the current one, unless the agent opened another (a client who calls in needs step 2 first).
  const shownKey = picked && plan.steps.some((s) => s.key === picked) ? picked : plan.steps[current]?.key;
  const facts: Array<[string, ReactNode]> = [
    ...((meaning || row.evidence.carrier_word) ? [["Carrier says", <>{meaning ? meaning.charAt(0).toUpperCase() + meaning.slice(1) : `“${String(row.evidence.carrier_word)}”`}{meaning && row.evidence.carrier_word ? <span className="text-muted-foreground"> (&ldquo;{String(row.evidence.carrier_word)}&rdquo;)</span> : null}</>] as [string, ReactNode]] : []),
    ...(row.evidence.file_date ? [["Latest file", fileDay(String(row.evidence.file_date))] as [string, ReactNode]] : []),
    ...(row.evidence.paid_to ? [["Paid to", fileDay(String(row.evidence.paid_to))] as [string, ReactNode]] : []),
    // A lapsed or lost policy shows when it lapsed, not "0 days past due" (critique A4).
    ...(afterLapse && row.evidence.lapsed_on ? [["Lapsed on", fileDay(String(row.evidence.lapsed_on))] as [string, ReactNode]] : []),
    ...(!afterLapse && typeof row.evidence.days_past_due === "number" ? [["Days past due", String(row.evidence.days_past_due)] as [string, ReactNode]] : []),
    ...(row.evidence.chargeback ? [["Charged back", `$${Math.round(Math.abs(Number(row.evidence.chargeback.amount_cents)) / 100).toLocaleString("en-US")} on ${fileDay(String(row.evidence.chargeback.statement_date))}`] as [string, ReactNode]] : []),
    ["Deadline", row.deadline ? fileDay(row.deadline) : "No carrier window"],
    ["Owner", row.ownerName ?? "Nobody yet"],
    ["Worked", row.lastContactAt ? `Last call ${fileDay(row.lastContactAt.slice(0, 10))}${row.contactAttempts ? ` · ${row.contactAttempts} ${row.contactAttempts === 1 ? "try" : "tries"}` : ""}` : "Not worked yet"],
  ];

  return (
    // Grows to the foot of the screen; both cards stretch with it (owner 2026-11-06: "no gaps").
    <div className="grid gap-4 lg:flex-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className={`${cardSurface} flex flex-col gap-4 p-5`} aria-label="What to do">
        <h2 className="m-0 text-sm font-semibold text-foreground">What to do</h2>
        <ol className="m-0 grid list-none gap-0 p-0">
          {plan.steps.map((s, i) => {
            const state = !plan.sequential ? "plain" : s.done ? "done" : i === current ? "now" : "next";
            const last = i === plan.steps.length - 1;
            return (
              <li key={s.key} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3" aria-current={state === "now" ? "step" : undefined}>
                <span className="flex flex-col items-center">
                  {/* A done step ticks off; the current one is ringed in the accent; the next ones wait (greyed). */}
                  <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${state === "done" ? "bg-[var(--success-ink)] text-[var(--surface)]" : state === "now" ? "border-2 border-[var(--accent-ink)] text-[var(--accent-ink)]" : "border border-border text-muted-foreground"}`}>
                    {state === "done" ? <Check className="size-4" /> : plan.sequential ? i + 1 : "•"}
                  </span>
                  {!last && <span aria-hidden="true" className={`w-px flex-1 ${plan.sequential ? (s.done ? "bg-[var(--success-ink)]" : "bg-border") : "bg-transparent"}`} />}
                </span>
                <div className={`flex min-w-0 flex-col gap-2 ${last ? "" : "pb-4"}`}>
                  {plan.sequential && s.body ? (
                    // Any step opens on its title; the one you are on is open to start with.
                    <button type="button" onClick={() => setPicked(s.key)} aria-expanded={shownKey === s.key} className={`rounded pt-1 text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring ${state === "now" || shownKey === s.key ? "font-semibold text-foreground" : state === "done" ? "text-muted-foreground line-through decoration-1" : "text-muted-foreground"}`}>
                      {s.title}{state === "done" && <span className="sr-only"> (done)</span>}
                    </button>
                  ) : (
                    <span className={`pt-1 text-sm ${state === "done" ? "text-muted-foreground line-through decoration-1" : state === "next" ? "text-muted-foreground" : "text-foreground"}`}>{s.title}</span>
                  )}
                  {(plan.sequential && shownKey === s.key && s.body) || null}
                  {checklist && state === "plain" && open && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" className={checkboxControl} checked={s.done} onChange={(e) => setChecked(e.target.checked ? [...checked, s.key] : checked.filter((x) => x !== s.key))} />Done
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {checklist && open && <div><Button type="button" size="sm" variant="outline" disabled={busy || !checked.length} onClick={() => void record("checklist", checked)}>Save the checklist</Button></div>}
        {/* On a page a Callout goes to the bell: an error the user must fix stays beside the buttons (§11). */}
        {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
        {open && (
          <div className="grid gap-2 border-t border-border pt-4">
            <label htmlFor="do-note" className="text-sm font-semibold text-foreground">Note</label>
            {/* Dictation is inside the box (owner 2026-11-06); each phrase is added to what is there. */}
            <NoteField id="do-note" maxLength={2000} rows={3} placeholder="What happened, what was promised…" value={note} onChange={setNote} />
            <div className="flex justify-end"><Button type="button" size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void saveNote()}>{busy ? "Saving…" : "Save the note"}</Button></div>
          </div>
        )}
      </section>
      <section className={`${cardSurface} flex flex-col gap-2 p-5`} aria-label="From the files">
        <h2 className="m-0 text-sm font-semibold text-foreground">From the files</h2>
        {/* The facts as a table: the meaning first, the carrier's own word in grey (critique C5: "IssNotPaid"). */}
        <FactTable rows={facts} />
      </section>
      {reinstating && (
        <>
          {/* What the carrier needs, in place, and the reinstate-or-sell-new comparison with the reinstatement's steps. */}
          <div className="flex flex-col gap-2"><h2 className="m-0 text-xs font-semibold text-muted-foreground">What the carrier needs</h2><ReinstatementNeeds row={reinstatement} readOnly={readOnly} /></div>
          <div className="flex flex-col gap-2"><h2 className="m-0 text-xs font-semibold text-muted-foreground">Reinstate or sell new</h2><ReinstatementComparison row={reinstatement} /></div>
        </>
      )}
    </div>
  );
}

/** Calls: log one (what you did follows what happened), then every call on this policy, newest first. */
export function CaseCalls({ row, calls, unreachableAfter, readOnly }: { row: CaseRow; calls: CaseCall[]; unreachableAfter: number; readOnly: boolean }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<ContactOutcome | "">("");
  const [did, setDid] = useState<ActionTaken>("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = actionsFor(outcome, []);
  const canLog = isOpen(row) && !readOnly;
  return (
    <>
      {canLog && (
        <form className={`${cardSurface} flex flex-col gap-4 p-5`} onSubmit={async (e) => {
          e.preventDefault();
          if (!outcome || busy) return;
          setBusy(true); setError(null);
          try {
            await act({ action: "call", id: row.id, outcome, did: isUnreached(outcome) ? "none" : did, note: note.trim() || null });
            notify.done(isUnreached(outcome) && row.contactAttempts + 1 >= unreachableAfter ? `Logged. ${unreachableAfter} tries without reaching them: marked unreachable.` : "Logged.");
            setOutcome(""); setDid("none"); setNote(""); router.refresh();
          } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
        }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-base font-semibold text-foreground">Log this call</h2>
            {/* The number to dial, beside the form (critique C6), copyable: never a raw tel: link (the dialer's gates). */}
            {row.phone
              ? <span className="select-all text-sm font-semibold tabular-nums text-foreground">{phoneText(row.phone)}</span>
              : <span className="text-sm text-[var(--warning-ink)]">No phone on file: find one on the application or ask the carrier</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="What happened" htmlFor="cc-outcome" required>
              <select id="cc-outcome" className={control} value={outcome} onChange={(e) => { const next = e.target.value as ContactOutcome | ""; setOutcome(next); setDid(defaultActionFor(next, [])); }}>
                <option value="">Choose…</option>
                {CONTACT_OUTCOMES.map((o) => <option key={o} value={o}>{CONTACT_OUTCOME_LABELS[o]}</option>)}
              </select>
            </Field>
            {outcome && !isUnreached(outcome) && (
              <Field label="What you did" htmlFor="cc-did"><select id="cc-did" className={control} value={did} onChange={(e) => setDid(e.target.value as ActionTaken)}>{choices.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}</select></Field>
            )}
          </div>
          <Field label="Note" htmlFor="cc-note"><NoteField id="cc-note"  maxLength={2000} value={note} onChange={setNote} /></Field>
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{row.contactAttempts ? `${row.contactAttempts} ${row.contactAttempts === 1 ? "try" : "tries"} without reaching them · unreachable after ${unreachableAfter}` : `Unreachable after ${unreachableAfter} tries without reaching them`}</span>
            <Button type="submit" disabled={!outcome || busy}>{busy ? "Saving…" : "Log the call"}</Button>
          </div>
        </form>
      )}
      <TableCard className="lg:flex-1" footer={calls.length ? <span>{calls.length === 1 ? "1 call" : `${calls.length} calls`} on this policy, newest first</span> : undefined}>
        {calls.length === 0 ? <EmptyState title="No calls yet" hint="Each call on this policy shows here, including those logged on Lapse risk before." /> : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th className="w-[120px]">When</th><th>What happened</th><th>What was done</th><th>Note</th><th className="w-[160px]">By</th></tr></thead>
            <tbody>
              {calls.map((c, i) => (
                <tr key={`${c.at}-${i}`}>
                  <td className="tabular-nums">{fileDay(c.at.slice(0, 10))}</td>
                  <td>{CONTACT_OUTCOME_LABELS[c.outcome as ContactOutcome] ?? c.outcome.replace(/_/g, " ")}{c.source === "lapse_risk" ? <span className="block text-xs text-muted-foreground">logged on Lapse risk</span> : null}</td>
                  <td>{c.did ? ACTION_LABELS[c.did as ActionTaken] ?? c.did : "—"}</td>
                  <td><span className="line-clamp-2 whitespace-normal text-muted-foreground" title={c.note ?? undefined}>{c.note ?? "—"}</span></td>
                  <td className="truncate">{c.by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

