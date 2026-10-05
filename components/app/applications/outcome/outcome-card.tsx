"use client";

/**
 * Outcome (LA-3.16; board l3-ws-after): how the attempt ended, recorded from the carrier's notice —
 * issued, counteroffer, declined, postponed, declined by the client, expired, withdrawn — with a
 * structured reason. A closed attempt is read-only for ever; a decline, postponement, refusal or
 * lapse offers the next attempt (the health interview, address, beneficiaries and payment carry
 * forward) or closing the case as lost.
 */

import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { APPLICATION_OUTCOME_LABEL, OUTCOME_REASONS, type ApplicationOutcome } from "@/lib/applications/constants";
import { notify } from "@/lib/notify";

import { AttemptStatusChip, shortDate } from "@/components/app/applications/parts";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { CloseCaseDialog } from "./close-case-dialog";
import { dateInput } from "./model";

type Choice = "issued" | "counteroffer" | "declined" | "postponed" | "declined_by_client" | "offer_expired" | "withdrawn";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "issued", label: "Issued" },
  { value: "counteroffer", label: "Counteroffer" },
  { value: "declined", label: "Declined by carrier" },
  { value: "postponed", label: "Postponed" },
  { value: "declined_by_client", label: "Declined by client" },
  { value: "offer_expired", label: "Offer expired" },
  { value: "withdrawn", label: "Withdrawn" },
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
  const { caseView, attempt, attemptsForInsured, readOnly, sample, actions, updateAttempt, goTo, timeZone } = useWorkspace();
  const [choice, setChoice] = useState<Choice | "">("");
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [policy, setPolicy] = useState("");
  const [today] = useState(() => dateInput(Date.now()));
  const [issuedOn, setIssuedOn] = useState(today);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);

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
    const retry = newest && caseView.status === "open" && attempt.outcome !== null && RETRYABLE.includes(attempt.outcome);
    // Any last attempt that ended without a policy can close the case — a withdrawn retry too, which
    // otherwise left the case open with no way to close it.
    const canLose = newest && caseView.status === "open" && attempt.outcome !== null && attempt.outcome !== "issued";
    const anyLive = caseView.attempts.some((a) => a.status !== "closed");
    const policyNo = attempt.outcome === "issued" ? [...attempt.submissions].reverse().find((s) => s.policyNumber)?.policyNumber ?? null : null;
    return (
      <StepCard
        title="Outcome"
        chips={<AttemptStatusChip status={attempt.status} outcome={attempt.outcome} />}
        footerNote={retry ? CARRY_LINE : "This attempt is closed, so nothing on it changes."}
        actions={<>
          <Button type="button" variant="outline" onClick={() => goTo("submit")}><ArrowLeft aria-hidden="true" />Back to Submit</Button>
          {canLose && (
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
          <dt className="text-[var(--muted)]">Closed</dt><dd className="tabular-nums">{shortDate(attempt.closedAt, { timeZone })}</dd>
        </dl>
        <CloseCaseDialog open={closing} onOpenChange={setClosing} defaultReason={attempt.outcomeReasonCode} />
      </StepCard>
    );
  }

  // ── recording it ─────────────────────────────────────────────────────────
  const why = readOnly ? "This attempt is closed" : saving || busy ? "Saving…" : !choice ? "Choose the outcome" : undefined;
  return (
    <StepCard
      title="Outcome"
      chips={<StatusChip tone="neutral">Not recorded</StatusChip>}
      actions={<>
        <Button type="button" variant="outline" onClick={() => goTo("submit")}><ArrowLeft aria-hidden="true" />Back to Submit</Button>
        <Button type="button" onClick={() => void record()} disabled={Boolean(why)} title={why}>
          {choice === "counteroffer" ? "Record counteroffer" : saving ? "Saving…" : "Record outcome"}
        </Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Outcome" htmlFor="outcome-choice">
          <select id="outcome-choice" className={control} value={choice} onChange={(e) => { setChoice(e.target.value as Choice); setReason(""); setTried(false); }} disabled={readOnly}>
            <option value="">Choose the outcome</option>
            {CHOICES.map((c) => <option key={c.value} value={c.value} disabled={!allowed(c.value)}>{c.label}</option>)}
          </select>
        </Field>
        {choice === "issued" ? (
          <Field label="Policy number" htmlFor="outcome-policy-number" hint={policy.trim() ? "From the carrier's issue notice." : "Without it, it stays on the Missing reference list."}>
            <input id="outcome-policy-number" className={`${control} font-mono uppercase`} value={policy} onChange={(e) => setPolicy(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        ) : (
          <Field label="Reason" htmlFor="outcome-reason" required={needsReason} error={tried ? reasonError : undefined} hint={!needsReason && choice ? "No reason needed for this outcome." : undefined}>
            <select id="outcome-reason" className={control} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!needsReason || readOnly}>
              <option value="">{needsReason ? "Choose a reason" : "—"}</option>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </Field>
        )}
        {choice === "issued" && (
          <Field label="Issued on" htmlFor="outcome-issued-on">
            <input id="outcome-issued-on" type="date" className={control} value={issuedOn} max={today} onChange={(e) => setIssuedOn(e.target.value)} />
          </Field>
        )}
        {needsReason && (
          <Field label="Details" htmlFor="outcome-reason-text" required={reason === "other"} error={tried ? textError : undefined} hint="What the carrier's letter says, in its words." className="sm:col-span-2">
            <textarea id="outcome-reason-text" rows={2} className={`${control} h-auto py-2`} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
      </div>
      {(choice === "declined" || choice === "postponed" || choice === "declined_by_client" || choice === "offer_expired") && (
        <p className="text-xs text-[var(--muted)]">{CARRY_LINE}</p>
      )}
      {offerPending && <p className="text-xs text-[var(--muted)]">A counteroffer is waiting on the client — answer it above, or record that they declined or let it expire.</p>}
    </StepCard>
  );
}
