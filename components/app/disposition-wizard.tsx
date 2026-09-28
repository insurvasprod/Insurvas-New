"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";

import { Callout, KeyValues } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import type { DispositionOption } from "@/lib/dispositions/types";
import { cn } from "@/lib/utils";
import { answerLabel, useDispositionWalk, when, type DispositionWalk, type Step, type WalkView } from "@/components/app/use-disposition-walk";

const b = {
  edit: "cursor-pointer border-0 bg-transparent p-1 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
};
const control = "mt-1.5 box-border h-11 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";
const fieldLabel = "text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]";
const label12 = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol aria-label="Call outcome steps" className="m-0 flex list-none items-center overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5">
      {steps.map((step, index) => (
        <li key={step.key} aria-current={step.state === "current" ? "step" : undefined} className={cn("flex min-w-0 items-center", index < steps.length - 1 && "flex-1")}>
          <span className="flex shrink-0 items-center gap-2.5">
            <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-[12px] leading-[1.5] font-semibold", step.state === "done" ? "bg-[var(--success)] text-[var(--surface)]" : step.state === "current" ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--muted)]")}>
              {step.state === "done" ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : index + 1}
            </span>
            <span className={cn("text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] whitespace-nowrap", step.state === "upcoming" ? "text-[var(--muted)]" : "text-[var(--ink)]")}>{step.label}</span>
          </span>
          {index < steps.length - 1 && <span aria-hidden className={cn("m-track mx-3 h-0.5 min-w-4 flex-1", step.state === "done" ? "bg-[var(--success)]" : "bg-[var(--border)]")} />}
        </li>
      ))}
    </ol>
  );
}

function Choice({ name, checked, disabled, onSelect, title, sub, multi }: { name: string; checked: boolean; disabled: boolean; onSelect: () => void; title: string; sub?: ReactNode; multi?: boolean }) {
  return (
    <label className={cn("flex w-full cursor-pointer items-center gap-3.5 rounded-[8px] px-4 py-3.5", checked ? "border-[1.5px] border-[var(--primary)] bg-[var(--brand-50)]" : "border border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-alt)]", disabled && "cursor-not-allowed opacity-60")}>
      <input type={multi ? "checkbox" : "radio"} name={name} checked={checked} disabled={disabled} onChange={onSelect} className="size-[18px] shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0">
        <span className="block text-[16px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{title}</span>
        {sub && <span className="block text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{sub}</span>}
      </span>
    </label>
  );
}

/**
 * The overlay board's option card: 13/14 padding, radius 8, a 17px round marker, the title in
 * accent ink when selected, and a 12px consequence line. A real radio (or checkbox) underneath.
 */
export function OptionCard({ name, checked, disabled, onSelect, title, sub, multi }: { name: string; checked: boolean; disabled: boolean; onSelect: () => void; title: string; sub?: ReactNode; multi?: boolean }) {
  return (
    <label className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-[8px] border px-3.5 py-[13px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring-color)]", checked ? "border-[var(--primary)] bg-[var(--brand-50)]" : "border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-alt)]", disabled && "cursor-not-allowed opacity-60")}>
      <input type={multi ? "checkbox" : "radio"} name={name} checked={checked} disabled={disabled} onChange={onSelect} className="sr-only" />
      <span aria-hidden className={cn("mt-[3px] inline-flex size-[17px] shrink-0 items-center justify-center border-2", multi ? "rounded-[4px]" : "rounded-full", checked ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)] bg-transparent")}>
        {checked && <Check className="size-2.5" strokeWidth={4} />}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em]", checked ? "text-[var(--accent-ink)]" : "text-[var(--ink)]")}>{title}</span>
        {sub && <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{sub}</span>}
      </span>
    </label>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{title}</h2>
      {sub && <p className="mt-1 mb-4 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{sub}</p>}
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
export function OutcomeChoices({ walk, readOnly, card }: { walk: DispositionWalk; readOnly: boolean; card?: boolean }) {
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
    <div role="radiogroup" aria-label="Call outcome" className="flex flex-col gap-2.5">
      {options.map((option) => (
        <Item
          key={option.disposition_key}
          name="final-disposition"
          checked={walk.dispositionKey === option.disposition_key}
          disabled={readOnly || walk.saving}
          title={option.label}
          sub={<>{option.description}{option.needs_verification ? " · needs verification complete" : ""}</>}
          onSelect={() => walk.setDispositionKey(option.disposition_key)}
        />
      ))}
    </div>
  );
}

/** Callback date, assignee and topic, in the customer's timezone. */
export function CallbackDetailsFields({ walk, view, readOnly }: { walk: DispositionWalk; view: WalkView; readOnly: boolean }) {
  const wizard = walk.wizard;
  if (!wizard) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="callback-local" className={fieldLabel}>Callback date and time</label>
        <input id="callback-local" type="datetime-local" required className={control} value={walk.callbackLocal} disabled={readOnly || walk.saving} onChange={(event) => walk.setCallbackLocal(event.target.value)} aria-describedby="callback-timezones" />
        <span id="callback-timezones" className="mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Customer’s time ({wizard.customerTimezone}){view.callbackAt ? ` · ${when(view.callbackAt)} your time` : ""}</span>
      </div>
      <div>
        <label htmlFor="callback-assignee" className={fieldLabel}>Assignee</label>
        <select id="callback-assignee" className={control} value={walk.callbackAssignee} disabled={readOnly || walk.saving} onChange={(event) => walk.setCallbackAssignee(event.target.value)}>
          <option value="">Me</option>
          {wizard.assignees.filter((person) => person.id !== wizard.currentUserId).map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name} · {assignee.role}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="callback-detail" className={fieldLabel}>What to talk about</label>
        <input id="callback-detail" className={control} value={walk.callbackSubtype} disabled={readOnly || walk.saving} onChange={(event) => walk.setCallbackSubtype(event.target.value)} placeholder="Add timing or context if relevant" maxLength={120} />
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
            { label: "Callback", value: callbackAt && wizard ? when(callbackAt, wizard.customerTimezone) : "—" },
            { label: "Assigned to", value: assigneeName ?? myName },
          ] : []),
        ]} />
      ) : (
        <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">Choose an outcome first.</p>
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
        <>A callback is scheduled for {callbackAt ? <><strong>{when(callbackAt, wizard.customerTimezone)}</strong> (<strong>{when(callbackAt)}</strong> your time)</> : "the time you choose"}, the lead {lands} <strong>{stage.name}</strong>, and {assigneeName ? <><strong>{assigneeName}</strong> is assigned the callback</> : keeps}.</>
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

export function DispositionWizard({ workItemId, readOnly }: { workItemId: string; readOnly: boolean }) {
  const walk = useDispositionWalk({ workItemId, readOnly });
  const { wizard, loading, saving, error, editingSequence, phase, view } = walk;

  const header = (
    <PageHeader
      title="Record the call outcome"
      actions={<Button asChild variant="outline"><Link href={`/app/inbound/${workItemId}/verification`}>Back to verification</Link></Button>}
    />
  );

  if (loading && !wizard) return <PageLoading strip={false} rows={6} />;
  if (!wizard || !view) return <div className="flex w-full min-w-0 flex-col gap-6">{header}<Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">{error || "The call outcome wizard is unavailable."}<Button type="button" variant="outline" onClick={() => void walk.load()}>Try again</Button></span>} /></div>;

  const { node, multi, selected, completed, chosen, isCallback, orderedSteps, firstSequence, nodesById, walking, steps } = view;

  const preview = chosen && !completed && !walking ? (
    <div className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--primary)] bg-[var(--brand-50)] px-4 py-3">
      <div className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--accent-ink)]">What this outcome will do</div>
      <p className="mt-1 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]"><OutcomeEffects walk={walk} view={view} /></p>
    </div>
  ) : null;

  // The board puts Back and the primary action under the walked path and the preview, not in the card.
  const footer = completed ? null : node ? (
    <div className="flex justify-between gap-3">
      {editingSequence !== null
        ? <Button type="button" variant="outline" onClick={walk.cancelEdit} disabled={saving}>Cancel</Button>
        : <Button asChild variant="outline"><Link href={`/app/inbound/${workItemId}/verification`}>Back</Link></Button>}
      <Button type="button" onClick={() => void walk.saveAnswer(node, editingSequence ?? wizard.steps.length)} disabled={readOnly || saving || (multi ? selected.length === 0 : !walk.answer)}>
        {saving && <Loader2 aria-hidden className="animate-spin" />}{editingSequence !== null ? "Save answer" : "Continue"}
      </Button>
    </div>
  ) : phase === "outcome" ? (
    <div className="flex justify-between gap-3">
      <Button asChild variant="outline"><Link href={`/app/inbound/${workItemId}/verification`}>Back</Link></Button>
      <Button type="button" onClick={walk.next} disabled={readOnly || !chosen}>Continue</Button>
    </div>
  ) : phase === "details" ? (
    <div className="flex justify-between gap-3">
      <Button type="button" variant="outline" onClick={walk.back}>Back</Button>
      <Button type="button" onClick={walk.next} disabled={readOnly || !walk.callbackLocal}>Continue</Button>
    </div>
  ) : (
    <div className="flex justify-between gap-3">
      <Button type="button" variant="outline" onClick={walk.back} disabled={saving}>Back</Button>
      <Button type="button" onClick={walk.record} disabled={readOnly || saving || !chosen || (isCallback && !walk.callbackLocal)}>
        {saving && <Loader2 aria-hidden className="animate-spin" />}Record outcome
      </Button>
    </div>
  );

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      <div className="flex w-full min-w-0 justify-center">
        <div className="flex w-full max-w-[720px] min-w-0 flex-col gap-4">
          <Stepper steps={steps} />

          {readOnly && <Callout tone="info" title="Your account is read-only: the outcome cannot be changed." />}
          {error && <Callout tone="error" title={`The outcome was not recorded: ${error}`} />}

          {completed ? (
            <Panel title="Outcome recorded" sub="This call is closed.">
              <div className="flex items-start gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] px-4 py-3">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-[var(--success-ink)]" />
                <div className="min-w-0">
                  <p className="m-0 text-[16px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{wizard.dispositions.find((item) => item.disposition_key === wizard.walk.final_disposition_key)?.label ?? chosen?.label ?? wizard.walk.final_disposition_key}</p>
                  <p className="mt-1 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{wizard.walk.composed_note || "No note was composed."}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {firstSequence !== null && <Button type="button" variant="outline" onClick={() => walk.beginEdit(firstSequence)} disabled={readOnly}>Edit an earlier answer</Button>}
                <Button asChild><Link href={`/app/deal-flow?focus_lead_id=${encodeURIComponent(wizard.lead.id)}`}>Open Daily deal flow</Link></Button>
              </div>
            </Panel>
          ) : node ? (
            <Panel title={node.prompt || node.label}>
              <QuestionAnswer walk={walk} view={view} readOnly={readOnly} />
            </Panel>
          ) : phase === "outcome" ? (
            <Panel title="What was the outcome?">
              <OutcomeChoices walk={walk} readOnly={readOnly} />
            </Panel>
          ) : phase === "details" ? (
            <Panel title="Callback details">
              <CallbackDetailsFields walk={walk} view={view} readOnly={readOnly} />
            </Panel>
          ) : (
            <Panel title="Review">
              <ReviewSummary walk={walk} view={view} workItemId={workItemId} />
            </Panel>
          )}

          <section aria-label="Walked path" className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className={label12}>Walked path</div>
            {orderedSteps.length === 0 ? (
              <p className="mt-2 mb-0 border-t border-[var(--border)] pt-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No answers recorded yet.</p>
            ) : (
              <ol className="m-0 mt-2 list-none p-0">
                {orderedSteps.map((step, index) => {
                  const stepNode = nodesById.get(step.node_id);
                  return (
                    <li key={step.id} className="flex items-center gap-2.5 border-t border-[var(--border)] py-2">
                      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[12px] leading-[1.5] font-semibold text-[var(--ink)]">{index + 1}</span>
                      <span className="min-w-0 flex-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{stepNode?.prompt || step.node_label}</span>
                      <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{answerLabel(step, stepNode)}</span>
                      <button type="button" onClick={() => walk.beginEdit(step.sequence)} disabled={readOnly || saving} className={b.edit} aria-label={`Edit the answer to ${stepNode?.prompt || step.node_label}`}>Edit</button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {preview}
          {footer}
        </div>
      </div>
    </div>
  );
}
