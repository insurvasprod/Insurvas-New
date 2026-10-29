"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { Callout, KeyValues } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import type { DispositionOption } from "@/lib/dispositions/types";
import { US_CUSTOMER_TIMEZONES } from "@/lib/callbacks/timezone";
import { cn } from "@/lib/utils";
import { answerLabel, useDispositionWalk, when, type DispositionWalk, type WalkView } from "@/components/app/use-disposition-walk";
import { callHref } from "@/components/app/inbound/use-floor";
import { CallerCardForCall } from "@/components/app/inbound/caller-card";
import { CallbackPicker } from "@/components/app/callbacks/callback-picker";
import { notify } from "@/lib/notify";

const b = {
  edit: "cursor-pointer border-0 bg-transparent p-1 text-xs leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
};
const control = "mt-1.5 box-border h-11 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-base leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";
const fieldLabel = "text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]";

function Choice({ name, checked, disabled, onSelect, title, sub, multi }: { name: string; checked: boolean; disabled: boolean; onSelect: () => void; title: string; sub?: ReactNode; multi?: boolean }) {
  return (
    <label className={cn("flex w-full cursor-pointer items-center gap-3.5 rounded-[8px] px-4 py-3.5", checked ? "border-[1.5px] border-[var(--primary)] bg-[var(--brand-50)]" : "border border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-alt)]", disabled && "cursor-not-allowed opacity-60")}>
      <input type={multi ? "checkbox" : "radio"} name={name} checked={checked} disabled={disabled} onChange={onSelect} className="size-[18px] shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0">
        <span className="block text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{title}</span>
        {sub && <span className="block text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{sub}</span>}
      </span>
    </label>
  );
}

/**
 * The overlay board's option card: 13/14 padding, radius 8, a 17px round marker, the title in
 * accent ink when selected, and a 12px consequence line. A real radio (or checkbox) underneath.
 */
export function OptionCard({ name, checked, disabled, onSelect, title, sub, multi, stage }: { name: string; checked: boolean; disabled: boolean; onSelect: () => void; title: string; sub?: ReactNode; multi?: boolean; /** The pipeline stage the outcome lands in, drawn in that stage's board colour (owner 2026-10-27). */ stage?: { name: string; color?: string | null } | null }) {
  const tint = stage?.color || null;
  return (
    <label
      style={tint ? { borderLeftColor: tint, ...(checked ? { borderColor: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` } : null) } : undefined}
      className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-[8px] border px-3.5 py-[13px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring-color)]", tint && "border-l-4", checked ? "border-[var(--primary)] bg-[var(--brand-50)]" : "border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-alt)]", disabled && "cursor-not-allowed opacity-60")}
    >
      <input type={multi ? "checkbox" : "radio"} name={name} checked={checked} disabled={disabled} onChange={onSelect} className="sr-only" />
      <span aria-hidden style={checked && tint ? { borderColor: tint, background: tint } : undefined} className={cn("mt-[3px] inline-flex size-[17px] shrink-0 items-center justify-center border-2", multi ? "rounded-[4px]" : "rounded-full", checked ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border-strong)] bg-transparent")}>
        {checked && <Check className="size-2.5" strokeWidth={4} />}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-sm leading-[1.5] font-semibold tracking-[-0.02em]", checked && !tint ? "text-[var(--accent-ink)]" : "text-[var(--ink)]")}>{title}</span>
        {stage && (
          <span className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs leading-[1.5] font-semibold text-[var(--body)]">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: tint ?? "var(--muted)" }} />
            <span className="truncate">{stage.name}</span>
          </span>
        )}
        {sub && <span className="block text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{sub}</span>}
      </span>
    </label>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="m-0 text-title-sm leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{title}</h2>
      {sub && <p className="mt-1 mb-4 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{sub}</p>}
      <div className={sub ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

/* ── the pieces the page and the dialog share ──────────────────────────────── */

/** The free-text answer, or the choice list, for the current (or edited) question. */
export function QuestionAnswer({ walk, view, readOnly, consequence }: { walk: DispositionWalk; view: WalkView; readOnly: boolean; consequence?: (option: DispositionOption) => ReactNode }) {
  const node = view.node;
  if (!node) return null;
  if (node.node_type === "free_text") {
    return (
      <div>
        <label htmlFor="walk-answer" className={fieldLabel}>{node.label}</label>
        <textarea id="walk-answer" className={cn(control, "h-auto min-h-24 py-2")} value={typeof walk.answer === "string" ? walk.answer : ""} disabled={readOnly || walk.saving} onChange={(event) => walk.setAnswer(event.target.value)} />
      </div>
    );
  }
  const Item = consequence ? OptionCard : Choice;
  return (
    <div role={view.multi ? "group" : "radiogroup"} aria-label={node.label} className="flex flex-col gap-2.5">
      {node.options.map((option) => (
        <Item
          key={option.option_key}
          name={`node-${node.id}`}
          multi={view.multi}
          checked={view.multi ? view.selected.includes(option.option_key) : walk.answer === option.option_key}
          disabled={readOnly || walk.saving}
          title={option.label}
          sub={consequence?.(option)}
          onSelect={() => walk.setAnswer(view.multi ? (view.selected.includes(option.option_key) ? view.selected.filter((key) => key !== option.option_key) : [...view.selected, option.option_key]) : option.option_key)}
        />
      ))}
    </div>
  );
}

/** The mapped outcomes, or why there are none. `card` draws them as the overlay board's cards. */
export function OutcomeChoices({ walk, readOnly, card, grid }: { walk: DispositionWalk; readOnly: boolean; card?: boolean; /** Two columns from sm (the one-page outcome, 2026-10-26). */ grid?: boolean }) {
  const wizard = walk.wizard;
  const options = wizard ? wizard.outcomeOptions ?? null : null;
  if (options === null) return <Callout tone="error" title="The outcomes could not be loaded">Reload this page. Nothing has been recorded.</Callout>;
  if (options.length === 0) {
    return (
      <Callout tone="warning" title="No outcome is mapped to a stage yet">
        Every outcome has to land in a pipeline stage before it can be recorded. Map them in <Link href="/app/settings#dispositions" className="font-semibold text-[var(--ink)] underline underline-offset-2">Settings › Dispositions</Link>, then reload this page.
      </Callout>
    );
  }
  const Item = card ? OptionCard : Choice;
  return (
    <div role="radiogroup" aria-label="Call outcome" className={grid ? "grid gap-2.5 sm:grid-cols-2" : "flex flex-col gap-2.5"}>
      {options.map((option) => (
        <Item
          key={option.disposition_key}
          name="final-disposition"
          checked={walk.dispositionKey === option.disposition_key}
          disabled={readOnly || walk.saving}
          title={option.label}
          stage={card ? option.stage : undefined}
          sub={card && option.stage ? (option.needs_verification ? "Needs verification complete" : undefined) : <>{option.description}{option.needs_verification ? " · needs verification complete" : ""}</>}
          onSelect={() => walk.setDispositionKey(option.disposition_key)}
        />
      ))}
    </div>
  );
}

/** Callback day and time (the Appointments month, then the day's times), assignee and topic, in the customer's timezone. */
export function CallbackDetailsFields({ walk, view, readOnly }: { walk: DispositionWalk; view: WalkView; readOnly: boolean }) {
  const wizard = walk.wizard;
  if (!wizard) return null;
  return (
    <div className="flex flex-col gap-4">
      {wizard.customerTimezone ? null : (
        <div className="sm:max-w-[320px]">
          {/* The lead's state is unknown or spans zones: the agent says which, never a guess. */}
          <label htmlFor="callback-timezone" className={fieldLabel}>Customer’s timezone</label>
          <select id="callback-timezone" required className={control} value={walk.callbackTimezone} disabled={readOnly || walk.saving} onChange={(event) => walk.setCallbackTimezone(event.target.value)}>
            <option value="">Choose…</option>
            {US_CUSTOMER_TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
          </select>
        </div>
      )}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className={fieldLabel}>Day and time</span>
          <span id="callback-timezones" className="text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Customer’s time ({view.customerZone ?? "choose their timezone"}){view.callbackAt ? ` · ${when(view.callbackAt)} your time` : ""}</span>
        </div>
        <CallbackPicker value={walk.callbackLocal} onChange={walk.setCallbackLocal} zone={view.customerZone ?? null} disabled={readOnly || walk.saving} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="callback-assignee" className={fieldLabel}>Assignee</label>
          <select id="callback-assignee" className={control} value={walk.callbackAssignee} disabled={readOnly || walk.saving} onChange={(event) => walk.setCallbackAssignee(event.target.value)}>
            <option value="">Me</option>
            {wizard.assignees.filter((person) => person.id !== wizard.currentUserId).map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name} · {assignee.role}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="callback-detail" className={fieldLabel}>What to talk about</label>
          <input id="callback-detail" className={control} value={walk.callbackSubtype} disabled={readOnly || walk.saving} onChange={(event) => walk.setCallbackSubtype(event.target.value)} placeholder="Add timing or context if relevant" maxLength={120} />
        </div>
      </div>
    </div>
  );
}

/** The review: outcome, where it lands, the callback, and the verification warning. */
export function ReviewSummary({ walk, view, workItemId, verificationLink }: { walk: DispositionWalk; view: WalkView; workItemId: string; verificationLink?: ReactNode }) {
  const { chosen, isCallback, callbackAt, assigneeName, myName } = view;
  const wizard = walk.wizard;
  return (
    <>
      {chosen ? (
        <KeyValues items={[
          { label: "Outcome", value: chosen.label },
          // Call mode says what the dialer does (a retry never moves stage); inbound, where it lands.
          chosen.preview !== undefined || !chosen.stage
            ? { label: "What happens", value: chosen.description }
            : { label: chosen.stage.is_current ? "Stays in" : "Moves to", value: `${chosen.stage.name} · ${chosen.stage.pipeline_name}` },
          ...(isCallback ? [
            { label: "Callback", value: callbackAt && view.customerZone ? when(callbackAt, view.customerZone) : "—" },
            { label: "Assigned to", value: assigneeName ?? myName },
          ] : []),
        ]} />
      ) : (
        <p className="m-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">Choose an outcome first.</p>
      )}
      {chosen?.needs_verification && (
        <div className="mt-5">
          <Callout tone="warning" title={`Verification is ${wizard?.verification?.progress ?? 0}% complete`}>
            “{chosen.label}” records an application, so it is refused until every required field is confirmed. {verificationLink ?? <Link href={`/app/inbound/${workItemId}/verification`} className="font-semibold text-[var(--ink)] underline underline-offset-2">Finish verification</Link>}
          </Callout>
        </div>
      )}
    </>
  );
}

/** What the chosen outcome will do, as one sentence. Only what the outcome's configuration does. */
export function OutcomeEffects({ walk, view }: { walk: DispositionWalk; view: WalkView }) {
  const { chosen, isCallback, callbackAt, assigneeName, myName } = view;
  const wizard = walk.wizard;
  if (!chosen || !wizard) return null;
  // Call mode: the dialer path's own sentence, from the outcome's next-action settings.
  if (chosen.preview !== undefined || !chosen.stage) return <>{chosen.preview ?? chosen.description}</>;
  const stage = chosen.stage;
  const lands = `${stage.is_current ? "stays in" : "moves to"}`;
  const keeps = myName === "You" ? <>you keep ownership</> : <><strong>{myName}</strong> keeps ownership</>;
  return (
    <>
      {isCallback ? (
        <>A callback is scheduled for {callbackAt ? <><strong>{when(callbackAt, view.customerZone ?? undefined)}</strong> (<strong>{when(callbackAt)}</strong> your time)</> : "the time you choose"}, the lead {lands} <strong>{stage.name}</strong>, and {assigneeName ? <><strong>{assigneeName}</strong> is assigned the callback</> : keeps}.</>
      ) : (
        <>The lead {lands} <strong>{stage.name}</strong>{stage.is_current ? "" : ` in ${stage.pipeline_name}`}, and {keeps}.</>
      )}
      {chosen.closes_as === "dropped" ? " The transfer closes as dropped." : ""}
      {chosen.adds_to_do_not_call ? " The number is added to your do-not-call list." : ""}
      {" "}The call record ends, verification closes, and the partner is told the outcome.
    </>
  );
}

/* ── the full page ─────────────────────────────────────────────────────────── */

/**
 * Option B, "One page" (owner pick 2026-10-26, canvas M1 · Inbound): the questions answered so far
 * fold into a list you can change, the open question sits under them, then the outcome, then the
 * callback when the outcome books one — all on one page, with a bar at the foot that says what will
 * happen and records it. The same walk, the same server calls: only the arrangement changed.
 */
/**
 * After the outcome (Inbound A, 2026-10-27): straight on to the next caller, or a break. A break
 * saves your status first, so no caller is offered to you while you are away.
 */
function AfterTheCall() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function takeBreak() {
    setBusy(true);
    const response = await fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "presence", status: "on_break" }) }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { notify.block("Your break could not be saved. Try again."); return; }
    router.push("/app/inbound");
  }
  return (
    <>
      <Button asChild><Link href="/app/inbound">Take the next caller</Link></Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void takeBreak()}>{busy ? "Saving…" : "Take a break"}</Button>
    </>
  );
}

/** `stepBar`: on the call page (step 3, Finish the call), the Inbound steps under the title. */
/** `embedded` (owner 2026-10-28): inside the call page, which draws the step bar — no title or bar here. */
export function DispositionWizard({ workItemId, readOnly, stepBar, embedded = false }: { workItemId: string; readOnly: boolean; stepBar?: ReactNode; embedded?: boolean }) {
  const walk = useDispositionWalk({ workItemId, readOnly });
  const { wizard, loading, saving, error, editingSequence, view } = walk;
  // A walk whose outcome question was answered before (an earlier visit, or before 2026-10-27 when
  // the outcome was asked twice) carries that answer's outcome, so it is not asked for again.
  const answeredOutcome = wizard?.steps.map((step) => wizard.flow.nodes.find((item) => item.id === step.node_id)?.options.find((option) => option.option_key === step.option_key)?.disposition_key ?? null).find(Boolean) ?? null;
  const { dispositionKey, setDispositionKey } = walk;
  useEffect(() => {
    if (!dispositionKey && answeredOutcome && editingSequence === null) setDispositionKey(answeredOutcome);
  }, [dispositionKey, answeredOutcome, editingSequence, setDispositionKey]);
  const backHref = callHref(workItemId, "verify");

  const header = embedded ? null : (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={view?.customerName ? `Call with ${view.customerName}` : "Finish the call"}
        actions={<Button asChild variant="outline"><Link href={backHref}>Back to verification</Link></Button>}
      />
      {stepBar}
    </div>
  );

  if (loading && !wizard) return <PageLoading strip={false} rows={6} />;
  if (!wizard || !view) return <><div className="flex w-full min-w-0 flex-col gap-6">{header}<Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">{error || "The call outcome wizard is unavailable."}<Button type="button" variant="outline" onClick={() => void walk.load()}>Try again</Button></span>} /></div></>;

  const { node, multi, selected, completed, chosen, isCallback, orderedSteps, firstSequence, nodesById, walking, customerZone } = view;
  const verification = wizard.verification ?? null;
  const blockedByVerification = Boolean(chosen?.needs_verification && verification && !verification.complete);
  const callbackReady = !isCallback || Boolean(walk.callbackLocal && customerZone);

  // The flow's outcome question (every answer names an outcome) IS the call's outcome: asked once,
  // with its answers drawn as the outcomes, instead of the same question and then the outcome list.
  const isOutcomeQuestion = (candidate: typeof node) => Boolean(candidate && candidate.node_type === "choice" && candidate.options.length > 0 && candidate.options.every((option) => option.disposition_key));
  const askingOutcome = isOutcomeQuestion(node);
  const outcomeAnswered = orderedSteps.some((step) => isOutcomeQuestion(nodesById.get(step.node_id) ?? null));
  const picked = askingOutcome && node ? node.options.find((option) => option.option_key === walk.answer) ?? null : null;
  // The answer ends the questions (no follow-up): saving it and recording the outcome are one click,
  // when it is first answered and when it is changed.
  const recordsNow = Boolean(picked && !picked.next_node_id);
  const sequence = editingSequence ?? wizard.steps.length;

  // What is still missing, said beside the button instead of a disabled button that gives no reason.
  const missing = askingOutcome && !picked ? "Choose the outcome."
    : walking && !askingOutcome ? "Answer the open question first."
    : !walking && !chosen ? "Choose the outcome."
    : isCallback && !walk.callbackLocal ? "Choose the callback time."
    : isCallback && !customerZone ? "Choose the customer’s timezone."
    : blockedByVerification ? "Finish verification to record this outcome."
    : null;
  const answerReady = multi ? selected.length > 0 : Boolean(walk.answer);
  const recordReady = !readOnly && !saving && !blockedByVerification && callbackReady;
  // The one button on the question's row: record, or save this answer and go on to the next question.
  const action = node
    ? recordsNow
      ? { label: "Record outcome", disabled: !recordReady || !picked, run: () => { if (picked?.disposition_key) void walk.answerAndRecord(node, sequence, picked.disposition_key); } }
      : { label: editingSequence !== null ? "Save answer" : "Continue", disabled: readOnly || saving || !answerReady, run: () => { void walk.saveAnswer(node, sequence); } }
    : { label: "Record outcome", disabled: !recordReady || !chosen, run: () => walk.record() };
  const title = node ? node.prompt || node.label : outcomeAnswered ? "Ready to record" : "What was the outcome of the call?";

  if (completed) {
    return (
      <>
        <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
          {header}
          <div className="w-full max-w-[760px]">
            <Panel title="Call finished" sub="The outcome is saved and the call is closed.">
              <div className="flex items-start gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] px-4 py-3">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-[var(--success-ink)]" />
                <div className="min-w-0">
                  <p className="m-0 text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{wizard.dispositions.find((item) => item.disposition_key === wizard.walk.final_disposition_key)?.label ?? chosen?.label ?? wizard.walk.final_disposition_key}</p>
                  <p className="mt-1 mb-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{wizard.walk.composed_note || "No note was composed."}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <AfterTheCall />
                {firstSequence !== null && <Button type="button" variant="outline" onClick={() => walk.beginEdit(firstSequence)} disabled={readOnly}>Change an answer</Button>}
                <Button asChild variant="outline"><Link href={`/app/deal-flow?focus_lead_id=${encodeURIComponent(wizard.lead.id)}`}>Open Daily deal flow</Link></Button>
              </div>
            </Panel>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {header}
        {readOnly && <Callout tone="info" title="Your account is read-only: the outcome cannot be changed." />}
        {error && <Callout tone="error" title={`The outcome was not recorded: ${error}`} />}

        {/* Laid out like step 2 (owner, 2026-10-27): the caller on the left, the one card that does
            the work on the right, its action on the same row as the question. */}
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
          <aside aria-label="The caller" className="flex min-w-0 flex-col gap-4 max-lg:order-2 lg:sticky lg:top-[calc(var(--top-bar-h)+16px)] lg:max-h-[calc(100dvh-var(--top-bar-h)-32px)] lg:w-[320px] lg:shrink-0 lg:self-start lg:overflow-y-auto">
            <CallerCardForCall workItemId={workItemId} />
          </aside>

          <section aria-label="Finish the call" className="m-glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-[var(--border)] max-lg:order-1">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <h2 className="m-0 min-w-0 text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{title}</h2>
              <div className="flex flex-wrap items-center gap-3">
                {missing && <span className="text-xs text-[var(--muted)]">{missing}</span>}
                {editingSequence !== null && <Button type="button" variant="outline" onClick={walk.cancelEdit} disabled={saving}>Cancel</Button>}
                <Button type="button" onClick={action.run} disabled={action.disabled}>
                  {saving && <Loader2 aria-hidden className="animate-spin" />}{action.label}
                </Button>
              </div>
            </div>

            {/* The answers so far, each changeable. */}
            {orderedSteps.length > 0 && (
              <ol className="m-0 list-none p-0">
                {orderedSteps.map((step) => {
                  const stepNode = nodesById.get(step.node_id);
                  const editing = editingSequence === step.sequence;
                  return (
                    <li key={step.id} className={cn("flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-2.5", editing && "bg-[var(--primary-soft)]")}>
                      <Check aria-hidden className="size-4 shrink-0 text-[var(--accent-ink)]" />
                      <span className="min-w-0 flex-1 text-sm text-[var(--body)]">{stepNode?.prompt || step.node_label}</span>
                      <strong className="text-sm font-semibold text-[var(--ink)]">{answerLabel(step, stepNode)}</strong>
                      <button type="button" onClick={() => walk.beginEdit(step.sequence)} disabled={readOnly || saving || editing} className={b.edit} aria-label={`Change the answer to ${stepNode?.prompt || step.node_label}`}>Change</button>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="flex flex-col gap-4 p-4">
              {askingOutcome && node ? (
                // The outcome question: its answers as the outcomes, each saying where the lead goes.
                <div role="radiogroup" aria-label={node.prompt || node.label} className="grid gap-2.5 sm:grid-cols-2">
                  {node.options.map((option) => {
                    const outcome = wizard.outcomeOptions?.find((item) => item.disposition_key === option.disposition_key) ?? null;
                    return (
                      <OptionCard
                        key={option.id}
                        name={`node-${node.id}`}
                        checked={walk.answer === option.option_key}
                        disabled={readOnly || saving}
                        title={option.label}
                        stage={outcome?.stage}
                        sub={outcome?.needs_verification ? "Needs verification complete" : undefined}
                        onSelect={() => { walk.setAnswer(option.option_key); walk.setDispositionKey(option.disposition_key ?? ""); }}
                      />
                    );
                  })}
                </div>
              ) : node ? (
                <QuestionAnswer walk={walk} view={view} readOnly={readOnly} />
              ) : outcomeAnswered ? (
                chosen
                  ? <p className="m-0 text-sm text-[var(--muted)]">Everything is answered. Record the outcome to close the call.</p>
                  : <Callout tone="warning" title="That outcome has no pipeline stage to land in">Map it in <Link href="/app/settings#pipelines" className="font-semibold text-[var(--ink)] underline underline-offset-2">Settings › Pipelines &amp; outcomes</Link>, or choose another with Change above.</Callout>
              ) : (
                // A flow with no outcome question: the outcomes themselves.
                <OutcomeChoices walk={walk} readOnly={readOnly} card grid />
              )}

              {chosen && blockedByVerification && verification && (
                <Callout tone="warning" title={`Verification is ${verification.progress ?? 0}% complete`}>
                  “{chosen.label}” records an application, so it is refused until every required field is confirmed. <Link href={backHref} className="font-semibold text-[var(--ink)] underline underline-offset-2">Finish verification</Link>
                </Callout>
              )}

              {/* The callback, only for the outcome that books one. */}
              {isCallback && (askingOutcome || !walking) && (
                <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
                  <span className="text-sm font-semibold text-[var(--ink)]">Callback</span>
                  <CallbackDetailsFields walk={walk} view={view} readOnly={readOnly} />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
