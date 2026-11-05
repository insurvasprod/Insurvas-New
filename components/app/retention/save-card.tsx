"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field, textareaControl } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout } from "@/components/app/settings/primitives";
import { IncomeCapture } from "@/components/app/retention/income-capture";
import { ServicingRequestForm } from "@/components/app/retention/servicing-request-form";
import { fileDay } from "@/lib/ingestion/constants";
import { personName } from "@/lib/format/personName";
import { ACTION_LABELS, actionsFor, defaultActionFor, isUnreached } from "@/lib/retention/callLog";
import { CLIENT_REASON_LABELS, CLIENT_REASONS, CONTACT_OUTCOME_LABELS, CONTACT_OUTCOMES, SNOOZE_DAYS, type ActionTaken, type ClientReason, type ContactOutcome } from "@/lib/retention/constants";
import { REQUEST_LABELS, type RequestType } from "@/lib/retention/servicing";
import type { CallLogEntry, SaveCard } from "@/lib/retention/queueStore";
import { notify } from "@/lib/notify";

/**
 * A save card's page (the pick of 2026-11-05, docs/retention/CRITIQUE.md, "SqA"): the client parts. The page
 * is the call: Why (server), Fix (the request form in place), Calls (log one, and every earlier one) and
 * Income. Only a snooze or dismissal is a pop-up, because the card leaves the queue.
 */

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/retention/save-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
  return data;
}

const nameOf = (card: Pick<SaveCard, "clientName" | "policyNumber">) => (card.clientName ? personName(card.clientName) : card.policyNumber);
export const cardHref = (card: Pick<SaveCard, "carrierId" | "policyNumber">) => `/app/save-queue/${card.carrierId}/${encodeURIComponent(card.policyNumber)}`;

/** The header's two buttons and More. `canWork`: the card can be worked now (not past due, not held out). */
export function SaveCardActions({ card, canWork, canStartFix, readOnly }: { card: SaveCard; canWork: boolean; canStartFix: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [holding, setHolding] = useState(false);
  const base = cardHref(card);
  if (readOnly) return null;
  return (
    <>
      {canWork && canStartFix && <Button asChild><Link href={`${base}?tab=fix`}>Start the fix</Link></Button>}
      {canWork && <Button asChild variant="outline"><Link href={`${base}?tab=calls`}>Log call</Link></Button>}
      <MoreMenu items={[
        canWork && { label: "Snooze or dismiss", onSelect: () => setHolding(true) },
        { label: card.incomeKnown ? "Change income" : "Add income", href: `${base}?tab=income` },
        { label: "Open the policy", href: `/app/policies/carrier/${card.carrierId}/${encodeURIComponent(card.policyNumber)}` },
      ]} />
      {holding && <HoldDialog card={card} onClose={() => setHolding(false)} onDone={() => { setHolding(false); router.push("/app/save-queue"); }} />}
    </>
  );
}

/** Snooze (7/14/30 days) or dismiss, with a required reason: a confirm, because the card leaves the queue. */
export function HoldDialog({ card, onClose, onDone }: { card: Pick<SaveCard, "carrierId" | "policyNumber" | "clientName">; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"snooze" | "dismiss">("snooze");
  const [days, setDays] = useState<number>(SNOOZE_DAYS[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "hold", carrier_id: card.carrierId, policy_number: card.policyNumber, kind, reason: reason.trim(), days: kind === "snooze" ? days : null });
      notify.done(kind === "snooze" ? `Snoozed for ${days} days. It comes back sooner if the risk rises.` : "Dismissed. It comes back only if the risk rises.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{kind === "snooze" ? "Snooze" : "Dismiss"} {nameOf(card)}?</DialogTitle>
          <DialogDescription>Off the queue {kind === "snooze" ? "until then" : "for good"}; back sooner if the risk rises.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="For how long" htmlFor="hold-kind">
            <select id="hold-kind" className={control} value={kind === "dismiss" ? "dismiss" : String(days)} onChange={(e) => { if (e.target.value === "dismiss") setKind("dismiss"); else { setKind("snooze"); setDays(Number(e.target.value)); } }}>
              {SNOOZE_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
              <option value="dismiss">Until the risk rises</option>
            </select>
          </Field>
          <Field label="Why" htmlFor="hold-reason" required><textarea id="hold-reason" className={textareaControl} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {error && <Callout tone="error" title={error} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Keep on the queue</Button>
          <Button type="button" disabled={reason.trim().length < 3 || busy} onClick={() => void save()}>{busy ? "Saving…" : kind === "snooze" ? `Snooze ${days} days` : "Dismiss"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The fixes this card offers, as chips, and the request form for the one picked, in place. */
export function FixTab({ card, fixes, active, canWork }: { card: SaveCard; fixes: Array<{ action: string; label: string; type: RequestType }>; active: RequestType | null; canWork: boolean }) {
  const router = useRouter();
  const base = cardHref(card);
  const [type, setType] = useState<RequestType | null>(active ?? fixes[0]?.type ?? null);
  if (!canWork) return <TableCard><EmptyState title="Not worked from here now" hint="This policy is past due (work it on Lapse risk) or held out on purpose." /></TableCard>;
  if (card.openRequests.length && !fixes.length) {
    return <TableCard><EmptyState title="A fix is already with the carrier" hint={card.openRequests.map((r) => REQUEST_LABELS[r.type]).join(", ")} action={<Button asChild variant="outline"><Link href="/app/servicing">Open Servicing</Link></Button>} /></TableCard>;
  }
  if (!fixes.length || !type) return <TableCard><EmptyState title="No fix to send" hint="This card's advice is a call, not a change: log it under Calls." action={<Button asChild variant="outline"><Link href={`${base}?tab=calls`}>Log the call</Link></Button>} /></TableCard>;
  return (
    <>
      {fixes.length > 1 && (
        <div role="radiogroup" aria-label="Which fix" className="flex flex-wrap gap-2">
          {fixes.map((f) => <ToggleChip key={f.type} role="radio" selected={type === f.type} onClick={() => setType(f.type)}>{f.label}</ToggleChip>)}
        </div>
      )}
      <ServicingRequestForm key={type} carrierId={card.carrierId} policyNumber={card.policyNumber} type={type} origin="save_queue" fromQueue onDone={(id) => router.push(id ? `/app/servicing/${id}` : "/app/servicing")} />
    </>
  );
}

/** Log a call in place (what you did follows what happened), then every call on this card. */
export function CallsTab({ card, calls, canLog }: { card: SaveCard; calls: CallLogEntry[]; canLog: boolean }) {
  const router = useRouter();
  const suggested = card.fixes.map((f) => f.action as ActionTaken);
  const [outcome, setOutcome] = useState<ContactOutcome | "">("");
  const [clientReason, setClientReason] = useState<ClientReason | "">("");
  const [action, setAction] = useState<ActionTaken>("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = actionsFor(outcome, suggested);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "log_attempt", carrier_id: card.carrierId, policy_number: card.policyNumber, outcome, action_taken: isUnreached(outcome) ? "none" : action, note: note.trim() || null, client_reason: outcome === "reached_refused" && clientReason ? clientReason : null });
      notify.done("Logged. It leaves the queue until the cooldown ends, or the risk rises.");
      setOutcome(""); setClientReason(""); setAction("none"); setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canLog && (
        <form className={`${cardSurface} flex flex-col gap-4 p-5`} onSubmit={(e) => { e.preventDefault(); if (outcome && !busy) void save(); }}>
          <h2 className="m-0 text-base font-semibold text-foreground">Log this call</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="What happened" htmlFor="call-outcome" required>
              <select id="call-outcome" className={control} value={outcome} onChange={(e) => { const next = e.target.value as ContactOutcome | ""; setOutcome(next); setAction(defaultActionFor(next, suggested)); }}>
                <option value="">Choose…</option>
                {CONTACT_OUTCOMES.map((o) => <option key={o} value={o}>{CONTACT_OUTCOME_LABELS[o]}</option>)}
              </select>
            </Field>
            {outcome === "reached_refused" && (
              <Field label="Why they said no" htmlFor="call-reason">
                <select id="call-reason" className={control} value={clientReason} onChange={(e) => setClientReason(e.target.value as ClientReason | "")}>
                  <option value="">They didn&apos;t say, or something else</option>
                  {CLIENT_REASONS.map((r) => <option key={r} value={r}>{CLIENT_REASON_LABELS[r]}</option>)}
                </select>
              </Field>
            )}
            {outcome && !isUnreached(outcome) && (
              <Field label="What you did" htmlFor="call-action">
                <select id="call-action" className={control} value={action} onChange={(e) => setAction(e.target.value as ActionTaken)}>
                  {choices.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}{suggested.includes(a) ? " (suggested)" : ""}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Note" htmlFor="call-note"><textarea id="call-note" className={textareaControl} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {/* On a page a Callout goes to the bell: an error the user must fix stays beside the button (§11). */}
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={!outcome || busy}>{busy ? "Saving…" : "Log the call"}</Button>
          </div>
        </form>
      )}
      <TableCard footer={calls.length ? <span>{calls.length === 1 ? "1 call" : `${calls.length} calls`}, newest first</span> : undefined}>
        {calls.length === 0 ? (
          <EmptyState title="No calls logged yet" hint="Each call on this card shows here, with what was done." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th className="w-[120px]">When</th>
                <th>What happened</th>
                <th>What was done</th>
                <th>Note</th>
                <th className="w-[160px]">By</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td className="tabular-nums">{fileDay(c.at.slice(0, 10))}</td>
                  <td>{CONTACT_OUTCOME_LABELS[c.outcome] ?? c.outcome}{c.clientReason ? <span className="block text-xs text-muted-foreground">{CLIENT_REASON_LABELS[c.clientReason]}</span> : null}</td>
                  <td>{ACTION_LABELS[c.actionTaken] ?? c.actionTaken}{c.servicingRequestId ? <Link href={`/app/servicing/${c.servicingRequestId}`} className="block text-xs text-[var(--accent-ink)] hover:underline">The request</Link> : null}</td>
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

/** Income (LA-5.10), on its own tab: every view and change is access-logged, so it opens only here. */
export function IncomeTab({ card, readOnly }: { card: SaveCard; readOnly: boolean }) {
  const router = useRouter();
  return (
    <div className={`${cardSurface} max-w-[760px] p-5`}>
      <IncomeCapture
        readOnly={readOnly}
        readUrl={`/api/app/retention/income?carrier_id=${card.carrierId}&policy_number=${encodeURIComponent(card.policyNumber)}`}
        save={(income) => fetch("/api/app/retention/income", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: card.carrierId, policy_number: card.policyNumber, income }) })}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
