"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { OverlayFrame } from "@/components/app/dialer-overlay-frame";
import { CallbackDetailsFields, OutcomeChoices, OutcomeEffects, QuestionAnswer, ReviewSummary } from "@/components/app/disposition-wizard";
import { Callout, btn } from "@/components/app/settings/primitives";
import { CALLBACK_KEY, answerLabel, useDispositionWalk, type DispositionWalk, type WalkView } from "@/components/app/use-disposition-walk";
import type { DispositionOption } from "@/lib/dispositions/types";
import { cn } from "@/lib/utils";

/**
 * "Record call outcome" as an overlay (board p-ov-disposition-wizard): the same walk as the full
 * page at /app/inbound/[id]/disposition, through the same hook, in the dialog frame. The page stays
 * for deep links. Opened from the Dialer, the lead workspace and the verification panel.
 */

const h3 = "m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";
const help = "mt-1.5 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]";
const label12 = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";

/** An outcome's real side effects beyond the stage it lands in. */
function extras(outcome: NonNullable<WalkView["options"]>[number]): string[] {
  // Call mode's descriptions are the dialer path's whole sentence already (callConsequence.ts).
  if (outcome.preview !== undefined) return [];
  const out: string[] = [];
  if (outcome.disposition_key === CALLBACK_KEY) out.push("asks for a callback time");
  if (outcome.adds_to_do_not_call) out.push("adds the number to your do-not-call list");
  if (outcome.needs_verification) out.push("needs verification complete");
  return out;
}

/**
 * The 12px line under an option, derived from the option itself: the outcome it leads to (from
 * the mapped outcomes the route already returns) and/or the question it asks next.
 */
function consequence(option: DispositionOption, walk: DispositionWalk, view: WalkView): string {
  const wizard = walk.wizard;
  const parts: string[] = [];
  if (option.disposition_key) {
    const outcome = wizard?.outcomeOptions?.find((item) => item.disposition_key === option.disposition_key);
    if (outcome) parts.push([outcome.description, ...extras(outcome)].join(", "));
    else parts.push(`Suggests “${wizard?.dispositions.find((item) => item.disposition_key === option.disposition_key)?.label ?? option.disposition_key}”, which ${wizard?.callMode ? "the dialer cannot record: it is archived" : "is not mapped to a stage yet"}`);
  }
  const nextId = option.next_node_id ?? (option.disposition_key ? null : view.node?.next_node_id ?? null);
  const nextNode = nextId ? view.nodesById.get(nextId) : undefined;
  if (nextNode) parts.push(`Asks: ${nextNode.prompt || nextNode.label}`);
  if (parts.length === 0) parts.push("Ends the questions; you choose the outcome next");
  return parts.join(" · ");
}

/** What the current answer or outcome leads to, in words that are true of its configuration. */
function NextActionPreview({ walk, view }: { walk: DispositionWalk; view: WalkView }) {
  let body: ReactNode = null;
  if (view.walking && view.node) {
    const option = view.node.node_type === "choice" ? view.node.options.find((item) => item.option_key === walk.answer) : undefined;
    const outcome = option?.disposition_key ? walk.wizard?.outcomeOptions?.find((item) => item.disposition_key === option.disposition_key) : undefined;
    const nextId = option ? option.next_node_id ?? (option.disposition_key ? null : view.node.next_node_id) : view.node.next_node_id;
    const nextNode = nextId ? view.nodesById.get(nextId) : undefined;
    if (view.node.node_type === "choice" && !option) body = "Choose an answer to see what it leads to.";
    else if (outcome?.preview !== undefined) {
      body = <><strong>{outcome.label}</strong> · {outcome.preview} You confirm it before it is recorded.</>;
    } else if (outcome) {
      const effects = extras(outcome);
      body = <><strong>{outcome.label}</strong> · {outcome.description.charAt(0).toLowerCase()}{outcome.description.slice(1)}{effects.length ? `, ${effects.join(", ")}` : ""}. You confirm it before it is recorded; the stage and the outcome are then written in one transaction, so neither can exist without the other.</>;
    } else if (nextNode) body = <>Your answer is saved and the next question is <strong>{nextNode.prompt || nextNode.label}</strong>. Nothing moves until you record the outcome.</>;
    else body = "Your answer is saved. Next you choose the outcome; nothing moves until you record it.";
  } else if (!view.completed && view.chosen) {
    body = <OutcomeEffects walk={walk} view={view} />;
  }
  if (!body) return null;
  return <Callout tone="info" title="Next action preview">{body}</Callout>;
}

export function DispositionWizardDialog({
  workItemId,
  open,
  onOpenChange,
  readOnly,
  onRecorded,
  onBackToVerification,
  attemptId,
}: {
  workItemId: string;
  /** Call mode: record the outcome against this dial attempt, through the dialer's route. */
  attemptId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly: boolean;
  /** Replaces the default after-record step (a toast and Daily deal flow). */
  onRecorded?: (result: { leadId: string | null }) => void;
  /** Where "Back to verification" goes; the verification page when not given. */
  onBackToVerification?: () => void;
}) {
  const router = useRouter();
  const walk = useDispositionWalk({ workItemId, readOnly, enabled: open, onRecorded, attemptId });
  const [editing, setEditing] = useState(false);
  const { wizard, loading, saving, error, editingSequence, phase, view } = walk;

  const toVerification = onBackToVerification ?? (() => { onOpenChange(false); router.push(`/app/inbound/${workItemId}/verification`); });
  const callMode = wizard?.callMode ?? null;
  // In call mode Back never leaves the dialer mid-call: it steps back through this call's answers.
  const hasVerification = !callMode && Boolean(wizard?.verification);
  const lastSequence = callMode?.earlierWalk ? null : view?.orderedSteps.at(-1)?.sequence ?? null;
  // True of this path: inbound keeps the walk and note; call mode stores the answers with the
  // attempt only when there are answers from THIS call (linkWalkToAttempt).
  const footerNote = !callMode
    ? "The answers, note and outcome are kept for audit."
    : (wizard?.steps.length ?? 0) > 0 && !callMode.earlierWalk
      ? "The answers and the outcome are recorded against this call."
      : "The outcome is recorded against this call.";

  const counter = !view ? null
    : view.completed ? "Recorded"
      : view.walking ? `Question ${editingSequence !== null ? view.orderedSteps.findIndex((step) => step.sequence === editingSequence) + 1 : view.orderedSteps.length + 1}`
        : phase === "outcome" ? "Outcome" : phase === "details" ? "Details" : "Review";

  // "Back" at the start of the walk: to verification when this transfer has a session, else to the
  // last answer (or out of the dialog when there is none).
  const backButton = hasVerification
    ? <button type="button" onClick={toVerification} disabled={saving} className={btn("secondary", "h-10")}>Back to verification</button>
    : <button type="button" onClick={() => (lastSequence !== null ? walk.beginEdit(lastSequence) : onOpenChange(false))} disabled={saving || (lastSequence !== null && readOnly)} className={btn("secondary", "h-10")}>Back</button>;

  let actions: ReactNode = null;
  if (!wizard || !view) {
    actions = <button type="button" onClick={() => onOpenChange(false)} className={btn("secondary", "h-10")}>Close</button>;
  } else if (view.completed) {
    actions = <>
      <button type="button" onClick={() => onOpenChange(false)} className={btn("secondary", "h-10")}>Close</button>
      <Link href={`/app/deal-flow?focus_lead_id=${encodeURIComponent(wizard.lead.id)}`} className={btn("primary")}>Open Daily deal flow</Link>
    </>;
  } else if (view.node) {
    const node = view.node;
    actions = <>
      {editingSequence !== null
        ? <button type="button" onClick={walk.cancelEdit} disabled={saving} className={btn("secondary", "h-10")}>Cancel</button>
        : backButton}
      <button type="button" onClick={() => void walk.saveAnswer(node, editingSequence ?? wizard.steps.length)} disabled={readOnly || saving || (view.multi ? view.selected.length === 0 : !walk.answer)} className={btn("primary")}>
        {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}{editingSequence !== null ? "Save answer" : "Continue"}
      </button>
    </>;
  } else if (phase === "outcome") {
    actions = <>{backButton}<button type="button" onClick={walk.next} disabled={readOnly || !view.chosen} className={btn("primary")}>Continue</button></>;
  } else if (phase === "details") {
    actions = <>
      <button type="button" onClick={walk.back} className={btn("secondary", "h-10")}>Back</button>
      <button type="button" onClick={walk.next} disabled={readOnly || !walk.callbackLocal} className={btn("primary")}>Continue</button>
    </>;
  } else {
    actions = <>
      <button type="button" onClick={walk.back} disabled={saving} className={btn("secondary", "h-10")}>Back</button>
      <button type="button" onClick={walk.record} disabled={readOnly || saving || !view.chosen || (view.isCallback && !walk.callbackLocal)} className={btn("primary")}>
        {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}Record outcome
      </button>
    </>;
  }

  let body: ReactNode;
  if (loading && !wizard) {
    body = <p role="status" className="m-0 inline-flex items-center gap-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]"><Loader2 aria-hidden className="size-4 animate-spin" />Loading call outcome…</p>;
  } else if (!wizard || !view) {
    body = <Callout tone="error" title="The call outcome wizard is unavailable">{error || "The call outcome wizard is unavailable."} <button type="button" onClick={() => void walk.load()} className={btn("secondary", "ml-2")}>Try again</button></Callout>;
  } else {
    const { node, completed, orderedSteps, nodesById } = view;
    body = <>
      {readOnly && <Callout tone="info" title="Read-only access">Your account is read-only. You can review the call path, but cannot change its outcome.</Callout>}
      {error && <Callout tone="error" title="The outcome was not recorded">{error}</Callout>}
      <div className="flex min-w-0 flex-col gap-[22px] md:flex-row">
        <section aria-label="Answered so far" className="min-w-0 md:w-[300px] md:shrink-0">
          <div className={label12}>{callMode?.earlierWalk ? "Answered on an earlier call" : "Answered so far"}</div>
          {orderedSteps.length === 0 ? (
            <p className="mt-2 mb-0 border-t border-[var(--border)] py-[11px] text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{callMode && !callMode.walkAvailable ? "This lead's stage has no questions set up, so choose the outcome directly." : "No answers recorded yet."}</p>
          ) : (
            <ol className="m-0 mt-2 list-none p-0">
              {orderedSteps.map((step) => {
                const stepNode = nodesById.get(step.node_id);
                const question = stepNode?.prompt || step.node_label;
                return (
                  <li key={step.id} className={cn("flex gap-3 border-t border-[var(--border)] py-[11px]", editingSequence === step.sequence && "bg-[var(--brand-50)]")}>
                    <Check aria-hidden className="mt-[3px] size-4 shrink-0 text-[var(--success)]" strokeWidth={2.6} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{question}</span>
                      <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] break-words text-[var(--ink)]">{answerLabel(step, stepNode)}</span>
                    </span>
                    {editing && <button type="button" onClick={() => { walk.beginEdit(step.sequence); setEditing(false); }} disabled={readOnly || saving} aria-label={`Edit the answer to ${question}`} className="shrink-0 cursor-pointer self-center border-0 bg-transparent p-1 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:underline disabled:cursor-not-allowed disabled:opacity-50">Edit</button>}
                  </li>
                );
              })}
            </ol>
          )}
          {callMode?.earlierWalk && orderedSteps.length > 0 && <p className="mt-2 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">These questions belong to this lead&rsquo;s earlier call and are not asked again. Choose this call&rsquo;s outcome.</p>}
          {orderedSteps.length > 0 && !callMode?.earlierWalk && (
            <button type="button" onClick={() => setEditing((on) => !on)} disabled={readOnly || saving} aria-pressed={editing} className={btn("ghost", "mt-1 h-[34px]")}>
              {editing ? "Done choosing" : "Edit an earlier answer"}
            </button>
          )}
        </section>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {completed ? (
            <>
              <div>
                <h3 className={h3}>Outcome recorded</h3>
                <p className={help}>This call is closed. The answers, note and outcome are kept for audit.</p>
              </div>
              <div className="flex items-start gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] px-4 py-3.5">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-[var(--success-ink)]" />
                <div className="min-w-0">
                  <p className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{wizard.dispositions.find((item) => item.disposition_key === wizard.walk.final_disposition_key)?.label ?? view.chosen?.label ?? wizard.walk.final_disposition_key}</p>
                  <p className="mt-1 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{wizard.walk.composed_note || "No note was composed."}</p>
                </div>
              </div>
            </>
          ) : node ? (
            <>
              <div>
                <h3 className={h3}>{node.prompt || node.label}</h3>
                <p className={help}>{editingSequence !== null ? "Correct the answer and the walk continues from here." : "Your answer decides the next question."}</p>
              </div>
              <QuestionAnswer walk={walk} view={view} readOnly={readOnly} consequence={(option) => consequence(option, walk, view)} />
            </>
          ) : phase === "outcome" ? (
            <>
              <div>
                <h3 className={h3}>What was the outcome?</h3>
                <p className={help}>Only the dispositions mapped to a stage in your pipelines are offered.</p>
              </div>
              <OutcomeChoices walk={walk} readOnly={readOnly} card />
            </>
          ) : phase === "details" ? (
            <>
              <div>
                <h3 className={h3}>Callback details</h3>
                <p className={help}>Booked in {view.customerName}’s timezone ({wizard.customerTimezone}) and checked against their calling window.</p>
              </div>
              <CallbackDetailsFields walk={walk} view={view} readOnly={readOnly} />
            </>
          ) : (
            <>
              <div>
                <h3 className={h3}>Review</h3>
                <p className={help}>Check the outcome before you record it.</p>
              </div>
              <div>
                <ReviewSummary
                  walk={walk}
                  view={view}
                  workItemId={workItemId}
                  verificationLink={<button type="button" onClick={toVerification} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-[var(--ink)] underline underline-offset-2">Finish verification</button>}
                />
              </div>
            </>
          )}
          <NextActionPreview walk={walk} view={view} />
        </div>
      </div>
    </>;
  }

  return (
    <OverlayFrame
      open={open}
      onOpenChange={onOpenChange}
      width={880}
      top={76}
      title="Record call outcome"
      description="Capture one structured outcome so the next action is clear and auditable."
      counter={counter}
      footerNote={footerNote}
      footerActions={actions}
    >
      {body}
    </OverlayFrame>
  );
}
