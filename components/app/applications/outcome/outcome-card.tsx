"use client";

/**
 * Outcome (LA-3.16; board l3-ws-after): how the attempt ended, recorded from the carrier's notice —
 * issued, counteroffer, declined, postponed, declined by the client, expired, withdrawn — with a
 * structured reason. A closed attempt is read-only for ever; a decline, postponement, refusal or
 * lapse offers the next attempt (the health interview, address, beneficiaries and payment carry
 * forward) or closing the case as lost.
 */

import { useState } from "react";
import { ArrowLeft, BadgeCheck, CircleX, Clock, Hourglass, Repeat, Undo2, UserX, type LucideIcon } from "lucide-react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { cn } from "@/lib/utils";
import { APPLICATION_OUTCOME_LABEL, OUTCOME_REASONS, type ApplicationOutcome } from "@/lib/applications/constants";
import { notify } from "@/lib/notify";

import { AttemptStatusChip, shortDate } from "@/components/app/applications/parts";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { CloseCaseDialog } from "./close-case-dialog";
import { dateInput } from "./model";

type Choice = "issued" | "counteroffer" | "declined" | "postponed" | "declined_by_client" | "offer_expired" | "withdrawn";

type Tone = "good" | "warning" | "danger" | "neutral";
const TONE_INK: Record<Tone, string> = { good: "text-[var(--success-ink)]", warning: "text-[var(--warning-ink)]", danger: "text-[var(--error-ink)]", neutral: "text-[var(--muted)]" };

const CHOICES: { value: Choice; label: string; hint: string; tone: Tone; icon: LucideIcon }[] = [
  { value: "issued", label: "Issued", hint: "Approved — the policy is in force", tone: "good", icon: BadgeCheck },
  { value: "counteroffer", label: "Counteroffer", hint: "Different coverage or price offered", tone: "warning", icon: Repeat },
  { value: "declined", label: "Declined by carrier", hint: "The carrier said no", tone: "danger", icon: CircleX },
  { value: "postponed", label: "Postponed", hint: "Apply again after a wait", tone: "warning", icon: Clock },
  { value: "declined_by_client", label: "Declined by client", hint: "They turned the offer down", tone: "danger", icon: UserX },
  { value: "offer_expired", label: "Offer expired", hint: "They never answered the offer", tone: "neutral", icon: Hourglass },
  { value: "withdrawn", label: "Withdrawn", hint: "Pulled before a decision", tone: "neutral", icon: Undo2 },
];

/** Outcomes that offer the next attempt (STATUS-MODEL §4, "After a transition"). */
const RETRYABLE: readonly ApplicationOutcome[] = ["declined", "postponed", "declined_by_client", "offer_expired"];
const CARRY_LINE = "The next attempt carries forward health answers, medications, address, beneficiaries and payment — not the quote, disclosures or QA verdict.";

export function OutcomeCard({ onRecordCounteroffer, onAnswerOffer, busy }: {
  onRecordCounteroffer: () => void;
  /** The pending counteroffer's answer (declined by client / expired) goes through its own route. */
  onAnswerOffer: (response: "reject" | "expire") => void;
  busy: boolean;
}) {
  const { caseView, attempt, attemptsForInsured, readOnly, seatReadOnly, sample, actions, updateAttempt, goTo, timeZone } = useWorkspace();
  const [choice, setChoice] = useState<Choice | "">("");
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [policy, setPolicy] = useState("");
  const [today] = useState(() => dateInput(Date.now()));
  const [issuedOn, setIssuedOn] = useState(today);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [lateNumber, setLateNumber] = useState("");
  const [savingNumber, setSavingNumber] = useState(false);

  const status = attempt.status;
  const decidable = status === "submitted" || status === "pending_carrier";
  const offerPending = status === "counteroffer_pending";
  const allowed = (c: Choice) => c === "withdrawn" ? status !== "closed"
    : c === "declined_by_client" || c === "offer_expired" ? offerPending
    : decidable;
  const reasons = choice === "declined" || choice === "postponed" || choice === "withdrawn"
    ? OUTCOME_REASONS.filter((r) => (r.outcomes as readonly string[]).includes(choice))
    : [];
  const needsReason = reasons.length > 0;
  const reasonError = needsReason && !reason ? "Choose the reason on the carrier's letter." : undefined;
  const textError = reason === "other" && !text.trim() ? "Say what the reason was." : undefined;

  async function record() {
    setTried(true);
    if (!choice || reasonError || textError || saving || busy) return;
    if (choice === "counteroffer") { onRecordCounteroffer(); return; }
    if (choice === "declined_by_client") { onAnswerOffer("reject"); return; }
    if (choice === "offer_expired") { onAnswerOffer("expire"); return; }
    if (sample) {
      updateAttempt({ status: "closed", outcome: choice, outcomeReasonCode: (reason || null) as never, outcomeReasonText: text.trim() || null, closedAt: new Date().toISOString() });
      notify.done(`${APPLICATION_OUTCOME_LABEL[choice]} recorded`, { detail: "Sample data — nothing was saved." });
      return;
    }
    setSaving(true);
    try {
      const r = await actions.transition("closed", {
        outcome: choice, reasonCode: needsReason ? reason : null, reasonText: text.trim() || null,
        policyNumber: choice === "issued" ? policy.trim().toUpperCase() || null : null, issuedOn: choice === "issued" ? issuedOn : null,
      });
      if (!r) return;
      if (choice === "issued") {
        notify.done(policy.trim() ? `Issued · policy ${policy.trim().toUpperCase()}` : "Recorded as issued", { detail: r.policy?.message ?? (policy.trim() ? undefined : "It stays on the Missing reference list until you add the policy number.") });
      } else {
        notify.done(`${APPLICATION_OUTCOME_LABEL[choice]} recorded`, { detail: RETRYABLE.includes(choice) ? "Start the next attempt, or close the case as lost." : undefined });
      }
    } finally {
      setSaving(false);
    }
  }

  // ── a closed attempt ─────────────────────────────────────────────────────
  if (status === "closed") {
    const label = OUTCOME_REASONS.find((r) => r.code === attempt.outcomeReasonCode)?.label ?? null;
    const newest = attemptsForInsured.every((a) => a.attemptNo <= attempt.attemptNo);
    const retry = !seatReadOnly && newest && caseView.status === "open" && attempt.outcome !== null && RETRYABLE.includes(attempt.outcome);
    // Any last attempt that ended without a policy can close the case — a withdrawn retry too, which
    // otherwise left the case open with no way to close it.
    const canLose = newest && caseView.status === "open" && attempt.outcome !== null && attempt.outcome !== "issued";
    const anyLive = caseView.attempts.some((a) => a.status !== "closed");
    const policyNo = attempt.outcome === "issued" ? [...attempt.submissions].reverse().find((s) => s.policyNumber)?.policyNumber ?? null : null;
    // Issued without a number: the Missing reference list sends the agent here, so the number is
    // added here (QA pass 2026-10-22: the card was read-only and the sale could never reach the book).
    const latestSubmission = attempt.submissions.at(-1) ?? null;
    const canAddNumber = !seatReadOnly && attempt.outcome === "issued" && !policyNo && latestSubmission !== null;
    async function saveLateNumber() {
      const number = lateNumber.trim().toUpperCase();
      if (!number || !latestSubmission) return;
      if (sample) { notify.done(`Policy ${number} added`, { detail: "Sample data — nothing was saved." }); return; }
      setSavingNumber(true);
      try {
        if (await actions.setReference(latestSubmission.id, { policyNumber: number })) notify.done(`Policy ${number} added`, { detail: "The sale now joins your book." });
      } finally {
        setSavingNumber(false);
      }
    }
    return (
      <StepCard
        title="Outcome"
        chips={<AttemptStatusChip status={attempt.status} outcome={attempt.outcome} />}
        footerNote={retry ? CARRY_LINE : canAddNumber ? "This attempt is closed. Only the missing policy number can still be added." : "This attempt is closed, so nothing on it changes."}
        actions={<>
          <Button type="button" variant="outline" onClick={() => goTo("submit")}><ArrowLeft aria-hidden="true" />Back to Submit</Button>
          {canLose && !seatReadOnly && (
            <span title={anyLive ? "Close or withdraw the other open application first" : undefined}>
              <Button type="button" variant="outline" onClick={() => setClosing(true)} disabled={anyLive}>Close the case as lost</Button>
            </span>
          )}
          {retry && <Button type="button" onClick={() => void actions.nextAttempt()} disabled={sample} title={sample ? "Sample data" : undefined}>Start attempt {attempt.attemptNo + 1}</Button>}
        </>}
      >
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
          {label && (<><dt className="text-[var(--muted)]">Reason</dt><dd className="font-semibold text-[var(--ink)]">{label}</dd></>)}
          {attempt.outcomeReasonText && (<><dt className="text-[var(--muted)]">{label ? "Details" : "Reason"}</dt><dd>{attempt.outcomeReasonText}</dd></>)}
          {attempt.outcome === "issued" && (<><dt className="text-[var(--muted)]">Policy number</dt><dd>{policyNo ? <span className="font-mono font-semibold">{policyNo}</span> : <StatusChip tone="warning">Missing reference</StatusChip>}</dd></>)}
          {canAddNumber && (<><dt className="text-[var(--muted)]"><label htmlFor="outcome-late-policy-number">Add the policy number</label></dt><dd>
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void saveLateNumber(); }}>
              <input id="outcome-late-policy-number" className={`${control} max-w-[240px] font-mono uppercase`} value={lateNumber} onChange={(e) => setLateNumber(e.target.value)} maxLength={80} autoComplete="off" spellCheck={false} />
              <Button type="submit" variant="outline" disabled={!lateNumber.trim() || savingNumber}>{savingNumber ? "Saving…" : "Save policy number"}</Button>
            </form>
          </dd></>)}
          <dt className="text-[var(--muted)]">Closed</dt><dd className="tabular-nums">{shortDate(attempt.closedAt, { timeZone })}</dd>
        </dl>
        <CloseCaseDialog open={closing} onOpenChange={setClosing} defaultReason={attempt.outcomeReasonCode} />
      </StepCard>
    );
  }

  // ── recording it ─────────────────────────────────────────────────────────
  const why = readOnly ? "Read-only — nothing on this attempt can change" : saving || busy ? "Saving…" : !choice ? "Choose the outcome" : undefined;
  return (
    <StepCard
      title="Outcome"
      chips={<StatusChip tone="neutral">Not recorded</StatusChip>}
      actions={<>
        <Button type="button" variant="outline" onClick={() => goTo("submit")}><ArrowLeft aria-hidden="true" />Back to Submit</Button>
        <Button type="button" onClick={() => void record()} disabled={Boolean(why)} title={why}>
          {saving ? "Saving…" : choice ? `Record: ${CHOICES.find((c) => c.value === choice)?.label ?? "outcome"}` : "Record outcome"}
        </Button>
      </>}
    >
      {/* Owner 2026-10-28: the outcome as one click on a tile (only the ones that can happen now), then
          only what that outcome needs. */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-[var(--ink)]">What did the carrier decide?</span>
        <div id="outcome-choice" role="radiogroup" aria-label="Outcome" className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {CHOICES.filter((c) => allowed(c.value)).map((c) => {
            const on = choice === c.value;
            const Icon = c.icon;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={readOnly}
                onClick={() => { setChoice(c.value); setReason(""); setTried(false); }}
                className={cn(
                  "flex items-start gap-2.5 rounded-[10px] border-[1.5px] px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  on ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] hover:border-[var(--border-strong)]",
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_INK[c.tone])} aria-hidden="true" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <strong className={cn("text-sm font-semibold", on ? "text-[var(--ink)]" : "text-[var(--body)]")}>{c.label}</strong>
                  <span className="text-xs text-[var(--muted)]">{c.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {choice === "issued" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Policy number" htmlFor="outcome-policy-number" hint={policy.trim() ? "From the carrier's issue notice." : "Without it, it stays on the Missing reference list."}>
            <input id="outcome-policy-number" className={`${control} font-mono uppercase`} placeholder="From the issue notice" value={policy} onChange={(e) => setPolicy(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Issued on" htmlFor="outcome-issued-on">
            <input id="outcome-issued-on" type="date" className={control} value={issuedOn} max={today} onChange={(e) => setIssuedOn(e.target.value)} />
          </Field>
        </div>
      )}

      {needsReason && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-[var(--ink)]">Why? <span className="font-normal text-[var(--muted)]">· from the carrier&apos;s letter</span></span>
          <span id="outcome-reason" role="radiogroup" aria-label="Reason" className="flex flex-wrap gap-1.5">
            {reasons.map((r) => <ToggleChip key={r.code} role="radio" selected={reason === r.code} disabled={readOnly} onClick={() => setReason(r.code)}>{r.label}</ToggleChip>)}
          </span>
          {tried && reasonError && <p role="alert" className="text-xs text-[var(--error-ink)]">{reasonError}</p>}
          <Field label="Details" htmlFor="outcome-reason-text" required={reason === "other"} error={tried ? textError : undefined}>
            <textarea id="outcome-reason-text" rows={2} className={`${control} h-auto py-2`} placeholder="What the letter says, in its words" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
      )}
      {(choice === "declined" || choice === "postponed" || choice === "declined_by_client" || choice === "offer_expired") && (
        <p className="text-xs text-[var(--muted)]">{CARRY_LINE}</p>
      )}
      {offerPending && <p className="text-xs text-[var(--muted)]">A counteroffer is waiting on the client — answer it above, or record that they declined or let it expire.</p>}
    </StepCard>
  );
}
