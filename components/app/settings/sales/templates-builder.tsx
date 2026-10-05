"use client";

/**
 * LA-3.1 · the question builder: sections and their questions in order, and the selected question's
 * card (the board's "Question 9 of 14"). It edits a `UwDraft`, which saves as exactly LA-1.4's
 * {fields, form_definition} — knockout metadata on the form field, `show_when` for follow-ups, the
 * persistency flag on the field. The five persistency questions cannot be deleted.
 */

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Field, Pill, SettingsCard, ToggleRow, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { freshKey, hasChoices, isLockedPersistency, orderBySection, type UwDraft, type UwQuestion } from "@/lib/salesSettings/templateDefinition";
import { feedOfQuestionKey, INTERVIEW_FEEDS, type InterviewFeed } from "@/lib/applications/prefill";
import type { UwFieldType } from "@/lib/salesSettings/templateSchemas";
import { cn } from "@/lib/utils";

import { WithReason } from "./shared";

const PERSISTENCY_LABEL = "Keeps the policy on the books";
const LOCKED_TITLE = "One of the five persistency questions. It stays on every template.";
const YNU = ["Yes", "No", "Unsure"];

type TypeChoice = UwFieldType | "yes_no_unsure";
const TYPE_CHOICES: { value: TypeChoice; label: string }[] = [
  { value: "boolean", label: "Yes / No" },
  { value: "yes_no_unsure", label: "Yes / No / Unsure" },
  { value: "single_select", label: "One choice" },
  { value: "multi_select", label: "Several choices" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Dollar amount" },
  { value: "text", label: "Free text" },
  { value: "long_text", label: "Long free text" },
  { value: "medication_list", label: "Medication list" },
];
const TYPE_SHORT: Record<UwFieldType, string> = {
  boolean: "Yes / No", single_select: "One choice", multi_select: "Several choices", date: "Date", number: "Number", currency: "Dollar amount",
  text: "Free text", long_text: "Long free text", medication_list: "Medication list",
};

const isYnu = (q: UwQuestion) => q.type === "single_select" && q.options.length === 3 && q.options.every((o, i) => o === YNU[i]);
const typeChoiceOf = (q: UwQuestion): TypeChoice => (isYnu(q) ? "yes_no_unsure" : q.type);
const answerText = (parent: UwQuestion | undefined, equals: string) => (parent?.type === "boolean" ? (equals === "true" ? "Yes" : "No") : equals);

type Props = {
  draft: UwDraft;
  onChange: (next: UwDraft) => void;
  readOnly: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** The builder card's heading, and the fields that sit above the question list. */
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
};

/**
 * Two cards, one after the other in the stack: the template's sections and questions, then the
 * question picked. Neither sits inside the other (UI-CONSISTENCY §8).
 */
export function QuestionBuilder({ draft, onChange, readOnly, selectedKey, onSelect, title, sub, children }: Props) {
  const ordered = orderBySection(draft);
  const qs = ordered.questions;
  const selected = qs.find((q) => q.key === selectedKey) ?? null;
  const set = (questions: UwQuestion[], sections = draft.sections) => onChange(orderBySection({ sections, questions }));
  const patch = (key: string, p: Partial<UwQuestion>) => set(qs.map((q) => (q.key === key ? { ...q, ...p } : q)));

  const move = (key: string, by: -1 | 1) => {
    const list = [...qs];
    const i = list.findIndex((q) => q.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length || list[j].section !== list[i].section) return;
    [list[i], list[j]] = [list[j], list[i]];
    set(list);
  };
  // A question's key is what its answer is stored and matched under; renaming it carries its
  // follow-ups with it. Only the builder renames, and only for "Fills on the application".
  const rekey = (from: string, to: string) => {
    set(qs.map((q) => ({ ...q, key: q.key === from ? to : q.key, showWhen: q.showWhen?.key === from ? { ...q.showWhen, key: to } : q.showWhen })));
    onSelect(to);
  };
  const remove = (key: string) => {
    set(qs.filter((q) => q.key !== key));
    if (selectedKey === key) onSelect(null);
  };
  const addQuestion = (section: string) => {
    const key = freshKey("new question", qs.map((q) => q.key));
    const list = [...qs];
    const last = list.map((q) => q.section).lastIndexOf(section);
    list.splice(last < 0 ? list.length : last + 1, 0, { key, label: "New question", type: "boolean", options: [], help: null, required: false, persistency: false, section, knockout: null, showWhen: null, appliesTo: "all" });
    set(list);
    onSelect(key);
  };
  const addSection = () => {
    const key = freshKey(`section ${draft.sections.length + 1}`, draft.sections.map((s) => s.key));
    set(qs, [...draft.sections, { key, label: `Section ${draft.sections.length + 1}` }]);
  };
  const renameSection = (key: string, label: string) => set(qs, draft.sections.map((s) => (s.key === key ? { ...s, label } : s)));
  const removeSection = (key: string) => set(qs, draft.sections.filter((s) => s.key !== key));

  const numberOf = new Map(qs.map((q, i) => [q.key, i + 1]));
  return (
    <>
    <SettingsCard
      title={title}
      sub={sub}
      action={!readOnly ? <Button type="button" variant="outline" onClick={addSection}><Plus aria-hidden="true" />Add a section</Button> : undefined}
    >
      <div className="flex flex-col gap-5">
      {children}
      <div className="min-w-0">
        {ordered.sections.map((s, si) => {
          const inSection = qs.filter((q) => q.section === s.key);
          return (
            <div key={s.key} className={cn("py-3", si === 0 ? "pt-0" : "border-t border-[var(--border)]")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {readOnly ? (
                  <h4 className="m-0 text-[14px] leading-[1.5] font-semibold text-[var(--ink)]">{s.label}</h4>
                ) : (
                  <input
                    aria-label={`Section name: ${s.label}`}
                    className={cn(control, "mt-0 max-w-xs font-semibold")}
                    value={s.label}
                    onChange={(e) => renameSection(s.key, e.target.value)}
                  />
                )}
                {!readOnly && (
                  <span className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => addQuestion(s.key)}><Plus aria-hidden="true" />Add a question</Button>
                    {inSection.length === 0 && (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove the empty section ${s.label}`} onClick={() => removeSection(s.key)}><Trash2 aria-hidden="true" /></Button>
                    )}
                  </span>
                )}
              </div>
              {inSection.length === 0 ? (
                <p className="m-0 mt-2 text-[14px] text-[var(--muted)]">No questions in this section.</p>
              ) : (
                <ol className="m-0 mt-2 flex list-none flex-col p-0">
                  {inSection.map((q, i) => {
                    const locked = isLockedPersistency(q);
                    const parent = q.showWhen ? qs.find((x) => x.key === q.showWhen?.key) : undefined;
                    const hasChildren = qs.some((x) => x.showWhen?.key === q.key);
                    const on = q.key === selectedKey;
                    return (
                      <li key={q.key} className={cn("flex items-start gap-2 rounded-[8px] px-2 py-1.5", on && "bg-[var(--brand-50)]", q.showWhen && "ml-4")}>
                        <button
                          type="button"
                          onClick={() => onSelect(on ? null : q.key)}
                          aria-pressed={on}
                          className="min-w-0 flex-1 rounded-[6px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                        >
                          <span className="flex gap-2 text-[14px] leading-[1.5] text-[var(--ink)]">
                            <span className="w-6 shrink-0 tabular-nums text-[var(--muted)]">{numberOf.get(q.key)}.</span>
                            <span className="min-w-0">{q.label || <span className="text-[var(--muted)]">No question text</span>}</span>
                          </span>
                          <span className="mt-1 ml-8 flex flex-wrap gap-1.5">
                            <Pill tone="neutral">{isYnu(q) ? "Yes / No / Unsure" : TYPE_SHORT[q.type]}</Pill>
                            {q.required && <Pill tone="neutral">Required</Pill>}
                            {q.knockout && <Pill tone="error">Knockout</Pill>}
                            {q.showWhen && (
                              // A pill never wraps: a long parent question is cut to the card's width (in full on hover), so it cannot run out of the card on a phone.
                              <span className="flex min-w-0 max-w-full" title={`When “${parent?.label ?? q.showWhen.key}” is ${answerText(parent, q.showWhen.equals)}`}>
                                <Pill tone="info" className="min-w-0 max-w-full"><span className="truncate">When “{parent?.label ?? q.showWhen.key}” is {answerText(parent, q.showWhen.equals)}</span></Pill>
                              </span>
                            )}
                            {q.persistency && <Pill tone="success">{PERSISTENCY_LABEL}</Pill>}
                          </span>
                        </button>
                        {!readOnly && (
                          <span className="flex shrink-0 items-center gap-0.5">
                            <WithReason reason={i === 0 ? "Already first in its section." : null}>
                              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move “${q.label}” up`} disabled={i === 0} onClick={() => move(q.key, -1)}><ArrowUp aria-hidden="true" /></Button>
                            </WithReason>
                            <WithReason reason={i === inSection.length - 1 ? "Already last in its section." : null}>
                              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move “${q.label}” down`} disabled={i === inSection.length - 1} onClick={() => move(q.key, 1)}><ArrowDown aria-hidden="true" /></Button>
                            </WithReason>
                            <WithReason reason={locked ? LOCKED_TITLE : hasChildren ? "Remove its follow-ups first." : null}>
                              <Button type="button" variant="ghost" size="icon-sm" aria-label={locked ? `“${q.label}” cannot be deleted` : `Delete “${q.label}”`} disabled={locked || hasChildren} onClick={() => remove(q.key)}>
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </WithReason>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </SettingsCard>

      {selected && (
        <QuestionCard
          q={selected}
          index={qs.findIndex((q) => q.key === selected.key) + 1}
          total={qs.length}
          all={qs}
          sections={draft.sections}
          readOnly={readOnly}
          onPatch={(p) => patch(selected.key, p)}
          onQuestions={(list) => set(list)}
          onRekey={(to) => rekey(selected.key, to)}
        />
      )}
    </>
  );
}

function QuestionCard({ q, index, total, all, sections, readOnly, onPatch, onQuestions, onRekey }: {
  q: UwQuestion; index: number; total: number; all: UwQuestion[]; sections: UwDraft["sections"]; readOnly: boolean;
  onPatch: (p: Partial<UwQuestion>) => void; onQuestions: (list: UwQuestion[]) => void; onRekey: (to: string) => void;
}) {
  const id = (part: string) => `uw-${q.key}-${part}`;
  const locked = isLockedPersistency(q);
  const at = all.findIndex((x) => x.key === q.key);
  const earlier = all.slice(0, at).filter((x) => x.type === "boolean" || x.type === "single_select");
  const parent = q.showWhen ? all.find((x) => x.key === q.showWhen?.key) : undefined;
  const valuesFor = (x: UwQuestion | undefined) => (x?.type === "boolean" ? [{ v: "true", l: "Yes" }, { v: "false", l: "No" }] : (x?.options ?? []).map((o) => ({ v: o, l: o })));
  const followUps = all.filter((x) => x.showWhen?.key === q.key && x.showWhen.equals === "true");
  const firstFollowUp = followUps.find((x) => x.type === "text" || x.type === "long_text") ?? null;

  const setType = (choice: TypeChoice) => {
    if (choice === "yes_no_unsure") return onPatch({ type: "single_select", options: [...YNU], knockout: null });
    const next: Partial<UwQuestion> = { type: choice };
    if (choice !== "boolean") next.knockout = null;
    if (hasChoices(choice) && q.options.length < 2) next.options = ["First choice", "Second choice"];
    onPatch(next);
  };

  const setFollowUp = (label: string) => {
    if (firstFollowUp) {
      if (!label.trim() && !all.some((x) => x.showWhen?.key === firstFollowUp.key)) return onQuestions(all.filter((x) => x.key !== firstFollowUp.key));
      return onQuestions(all.map((x) => (x.key === firstFollowUp.key ? { ...x, label } : x)));
    }
    if (!label.trim()) return;
    const key = freshKey(`${q.key}_details`, all.map((x) => x.key));
    const list = [...all];
    list.splice(at + 1, 0, { key, label, type: "text", options: [], help: null, required: false, persistency: false, section: q.section, knockout: null, showWhen: { key: q.key, equals: "true" }, appliesTo: "all" });
    onQuestions(list);
  };

  // "Fills on the application": the feed this question's key already fills, and who else holds each one.
  const feed = feedOfQuestionKey(q.key);
  const holder = (f: InterviewFeed) => all.find((x) => x.key !== q.key && feedOfQuestionKey(x.key)?.field === f.field);
  const feedBlocked = (f: InterviewFeed) => {
    const other = holder(f);
    if (other) return `Already filled by “${other.label}”`;
    return (f.types as readonly string[]).includes(q.type) ? null : `Needs ${(f.types as readonly string[]).includes("number") ? "a Number" : "a Yes / No"} answer type`;
  };
  const setFeed = (field: string) => {
    const next = INTERVIEW_FEEDS.find((f) => f.field === field);
    if (next) return onRekey(next.key);
    if (!feed) return;
    // A key made from "Height?" would be `height`, a synonym that fills the field all over again.
    const taken = all.filter((x) => x.key !== q.key).map((x) => x.key);
    const plain = freshKey(q.label, taken);
    onRekey(feedOfQuestionKey(plain) ? freshKey(`${q.label} question`, taken) : plain);
  };

  return (
    <SettingsCard
      title={`Question ${index} of ${total}`}
      className={cn(q.knockout && "border-l-[3px] border-l-[var(--error)]")}
      action={(q.persistency || q.knockout) ? (
        <span className="flex flex-wrap items-center gap-2">
          {q.persistency && <Pill tone="success">{PERSISTENCY_LABEL}</Pill>}
          {q.knockout && <Pill tone="error">Knockout</Pill>}
        </span>
      ) : undefined}
    >
      <div className="flex flex-col gap-4">
        <Field label="Question text" htmlFor={id("label")} required hint="The agent reads this aloud. Write it the way it should sound, not the way a form would.">
          <textarea id={id("label")} rows={2} className={cn(control, "h-auto py-2")} value={q.label} disabled={readOnly} onChange={(e) => onPatch({ label: e.target.value })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Answer type" htmlFor={id("type")} hint="Only Yes / No can carry a knockout.">
            <select id={id("type")} className={control} value={typeChoiceOf(q)} disabled={readOnly || locked} title={locked ? LOCKED_TITLE : undefined} onChange={(e) => setType(e.target.value as TypeChoice)}>
              {TYPE_CHOICES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Applies to" htmlFor={id("applies")} hint="A skipped question is recorded as skipped, never as No.">
            <select
              id={id("applies")}
              className={control}
              value={q.appliesTo}
              disabled={readOnly || locked}
              title={locked ? LOCKED_TITLE : undefined}
              onChange={(e) => onPatch({ appliesTo: e.target.value as UwQuestion["appliesTo"] })}
            >
              <option value="age_50_plus">Ages 50 and over</option>
              <option value="all">Every applicant</option>
              <option value="age_under_50">Ages under 50</option>
              <option value="tobacco">Tobacco users</option>
            </select>
          </Field>
        </div>

        <Field
          label="Fills on the application"
          htmlFor={id("feeds")}
          hint={feed
            ? `The answer fills ${feed.label} on the Application step, marked as from the interview. Disclosure rules call this question health.${q.key}.`
            : `Interview only. Disclosure rules call this question health.${q.key}.`}
        >
          <select id={id("feeds")} className={control} value={feed?.field ?? ""} disabled={readOnly || locked} title={locked ? LOCKED_TITLE : undefined} onChange={(e) => setFeed(e.target.value)}>
            <option value="">Nothing — interview only</option>
            {INTERVIEW_FEEDS.map((f) => {
              const blocked = f.field === feed?.field ? null : feedBlocked(f);
              return <option key={f.field} value={f.field} disabled={Boolean(blocked)}>{blocked ? `${f.label} — ${blocked}` : f.label}</option>;
            })}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Section" htmlFor={id("section")}>
            <select id={id("section")} className={control} value={q.section} disabled={readOnly} onChange={(e) => onPatch({ section: e.target.value })}>
              {sections.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Help text" htmlFor={id("help")} hint="Shown under the question in the interview.">
            <input id={id("help")} className={control} value={q.help ?? ""} disabled={readOnly} onChange={(e) => onPatch({ help: e.target.value || null })} />
          </Field>
        </div>

        {hasChoices(q.type) && !isYnu(q) && (
          <Field label="Choices" htmlFor={id("options")} hint="One per line, in the order the agent reads them.">
            <textarea id={id("options")} rows={4} className={cn(control, "h-auto py-2")} value={q.options.join("\n")} disabled={readOnly || locked} onChange={(e) => onPatch({ options: e.target.value.split("\n") })} />
          </Field>
        )}

        <ToggleRow id={id("required")} title="Required" help="The interview cannot be marked complete without an answer." checked={q.required} disabled={readOnly} onChange={(on) => onPatch({ required: on })} />
        <ToggleRow
          id={id("persistency")}
          title={PERSISTENCY_LABEL}
          help={locked ? LOCKED_TITLE : "Marks a question about whether the policy will stay in force, asked before the health questions."}
          checked={q.persistency}
          disabled={readOnly || locked}
          onChange={(on) => onPatch({ persistency: on })}
        />

        {q.type === "boolean" && (
          <>
            <ToggleRow
              id={id("knockout")}
              title="A Yes is a knockout for this carrier"
              help="A knockout does not stop the interview. It marks the carrier as one that will decline and sends the agent to the Quote step to pick another."
              checked={Boolean(q.knockout)}
              disabled={readOnly}
              onChange={(on) => onPatch({ knockout: on ? { when: "true", note: q.knockout?.note ?? "" } : null })}
            />
            {q.knockout && (
              <Field label="What the agent sees" htmlFor={id("ko-note")} required hint="Shown as “Knockout — …” the moment Yes is given.">
                <input id={id("ko-note")} className={control} value={q.knockout.note} disabled={readOnly} placeholder="Most carriers decline this; guaranteed issue only." onChange={(e) => onPatch({ knockout: { when: "true", note: e.target.value } })} />
              </Field>
            )}
            <div className="border-l-2 border-[var(--border)] pl-4">
              <Field label="Follow-up question" htmlFor={id("follow")} hint="Asked only when the answer is Yes. The answer goes on the application as written.">
                <input id={id("follow")} className={control} value={firstFollowUp?.label ?? ""} disabled={readOnly} placeholder="When were you last treated, and who treated you?" onChange={(e) => setFollowUp(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Asked only when" htmlFor={id("sw-key")} hint={earlier.length === 0 ? "No earlier yes / no or one-choice question to follow." : "Makes this a follow-up to an earlier question."}>
            <select
              id={id("sw-key")}
              className={control}
              value={q.showWhen?.key ?? ""}
              disabled={readOnly || locked || earlier.length === 0}
              onChange={(e) => {
                const next = earlier.find((x) => x.key === e.target.value);
                onPatch({ showWhen: next ? { key: next.key, equals: next.type === "boolean" ? "true" : (next.options[0] ?? "") } : null });
              }}
            >
              <option value="">Always asked</option>
              {earlier.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="The answer is" htmlFor={id("sw-value")}>
            <select id={id("sw-value")} className={control} value={q.showWhen?.equals ?? ""} disabled={readOnly || !q.showWhen} onChange={(e) => q.showWhen && onPatch({ showWhen: { key: q.showWhen.key, equals: e.target.value } })}>
              {!q.showWhen && <option value="">—</option>}
              {valuesFor(parent).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </SettingsCard>
  );
}
