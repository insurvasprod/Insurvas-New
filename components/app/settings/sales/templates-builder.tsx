"use client";

/**
 * LA-3.1 · the question builder: sections and their questions in order, and the selected question's
 * card (the board's "Question 9 of 14"). It edits a `UwDraft`, which saves as exactly LA-1.4's
 * {fields, form_definition} — knockout metadata on the form field, `show_when` for follow-ups, the
 * persistency flag on the field. The five persistency questions cannot be deleted.
 */

import { StatusChip } from "@/components/ui/status-chip";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";

import { Field, SettingsCard, ToggleRow, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { freshKey, hasChoices, isLockedPersistency, orderBySection, type UwDraft, type UwQuestion } from "@/lib/salesSettings/templateDefinition";
import { feedOfQuestionKey, INTERVIEW_FEEDS, type InterviewFeed } from "@/lib/applications/prefill";
import type { UwFieldType } from "@/lib/salesSettings/templateSchemas";
import { cn } from "@/lib/utils";

import { notify } from "@/lib/notify";

import { QuestionBank } from "./question-bank";
import { Segmented } from "@/components/ui/view-tabs";

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

/** A question's follow-ups, and theirs, by key. */
export function descendantKeys(key: string, qs: readonly UwQuestion[]): Set<string> {
  const out = new Set<string>();
  const walk = (k: string) => { for (const x of qs) if (x.showWhen?.key === k && !out.has(x.key)) { out.add(x.key); walk(x.key); } };
  walk(key);
  return out;
}

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
  /**
   * Owner pick C (2026-10-28): lay the builder out beside the question bank. `carrierName` is the
   * one carrier the template is for, or null for a template every carrier uses (the knockout wording).
   */
  bank?: { templateName: string; carrierName?: string | null };
};

/**
 * Two cards, one after the other in the stack: the template's sections and questions, then the
 * question picked. Neither sits inside the other (UI-CONSISTENCY §8).
 */
export function QuestionBuilder({ draft, onChange, readOnly, selectedKey, onSelect, title, sub, children, bank }: Props) {
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
  const moveSection = (key: string, by: -1 | 1) => {
    const list = [...draft.sections];
    const i = list.findIndex((s) => s.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set(qs, list);
  };

  // S6 (owner 2026-10-30): drag a question — its follow-ups travel with it — before another, or onto
  // a section to put it last there. A drop that would ask a follow-up before its question is refused.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [phonePane, setPhonePane] = useState<"list" | "side" | null>(null);
  // The bank (or the question open) stays in view while the list scrolls (owner 2026-10-30): it
  // sticks to the top of the box that scrolls — the settings content, else the window — and is never
  // taller than that box, scrolling inside itself instead.
  const sideRef = useRef<HTMLDivElement>(null);
  const [sideBox, setSideBox] = useState<{ top: number; maxHeight: number } | null>(null);
  useEffect(() => {
    const el = sideRef.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>("[data-settings-scroll]");
    const wide = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      if (!wide.matches) return setSideBox(null);
      const scrolls = scroller && getComputedStyle(scroller).overflowY !== "visible";
      const bar = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-bar-h")) || 0;
      setSideBox(scrolls ? { top: 16, maxHeight: scroller.clientHeight - 32 } : { top: bar + 16, maxHeight: window.innerHeight - bar - 32 });
    };
    update();
    const observer = new ResizeObserver(update);
    if (scroller) observer.observe(scroller);
    window.addEventListener("resize", update);
    wide.addEventListener("change", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); wide.removeEventListener("change", update); };
  }, [bank]);
  const [overKey, setOverKey] = useState<string | null>(null);
  const endDrag = () => { setDragKey(null); setOverKey(null); };
  const moveBlock = (from: string, before: string | null, section: string) => {
    const block = new Set([from, ...descendantKeys(from, qs)]);
    if (before && block.has(before)) return;
    const moving = qs.filter((q) => block.has(q.key)).map((q) => ({ ...q, section }));
    const rest = qs.filter((q) => !block.has(q.key));
    let at = before ? rest.findIndex((q) => q.key === before) : rest.map((q) => q.section).lastIndexOf(section) + 1;
    if (at <= 0 && !before) at = draft.sections.slice(0, draft.sections.findIndex((s) => s.key === section)).reduce((n, s) => n + rest.filter((q) => q.section === s.key).length, 0);
    rest.splice(at < 0 ? rest.length : at, 0, ...moving);
    const next = orderBySection({ sections: draft.sections, questions: rest }).questions;
    const index = new Map(next.map((q, i) => [q.key, i]));
    if (next.some((q) => q.showWhen && (index.get(q.showWhen.key) ?? -1) > (index.get(q.key) ?? 0))) {
      notify.warn("A follow-up has to come after its question", { detail: "Move the question it follows, and it comes with it." });
      return;
    }
    set(next);
  };
  const dropProps = (before: string | null, section: string, marker: string) => readOnly ? {} : {
    onDragOver: (e: DragEvent) => { if (dragKey && dragKey !== before) { e.preventDefault(); e.stopPropagation(); setOverKey(marker); } },
    onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); if (dragKey) moveBlock(dragKey, before, section); endDrag(); },
  };

  const numberOf = new Map(qs.map((q, i) => [q.key, i + 1]));
  const listCard = (
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
            <div key={s.key} className={cn("rounded-[10px] py-3", si === 0 ? "pt-0" : "border-t border-[var(--border)]", overKey === `section:${s.key}` && "bg-[var(--primary-soft)]")} {...dropProps(null, s.key, `section:${s.key}`)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {readOnly ? (
                  <h4 className="m-0 text-sm leading-[1.5] font-semibold text-[var(--ink)]">{s.label}</h4>
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
                    <WithReason reason={si === 0 ? "Already the first section." : null}>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move the section ${s.label} up`} disabled={si === 0} onClick={() => moveSection(s.key, -1)}><ArrowUp aria-hidden="true" /></Button>
                    </WithReason>
                    <WithReason reason={si === ordered.sections.length - 1 ? "Already the last section." : null}>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move the section ${s.label} down`} disabled={si === ordered.sections.length - 1} onClick={() => moveSection(s.key, 1)}><ArrowDown aria-hidden="true" /></Button>
                    </WithReason>
                    <Button type="button" variant="ghost" size="sm" onClick={() => addQuestion(s.key)}><Plus aria-hidden="true" />Add a question</Button>
                    {inSection.length === 0 && (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove the empty section ${s.label}`} onClick={() => removeSection(s.key)}><Trash2 aria-hidden="true" /></Button>
                    )}
                  </span>
                )}
              </div>
              {inSection.length === 0 ? (
                <p className="m-0 mt-2 text-sm text-[var(--muted)]">No questions in this section.</p>
              ) : (
                <ol className="m-0 mt-2 flex list-none flex-col p-0">
                  {inSection.map((q, i) => {
                    const locked = isLockedPersistency(q);
                    const parent = q.showWhen ? qs.find((x) => x.key === q.showWhen?.key) : undefined;
                    const hasChildren = qs.some((x) => x.showWhen?.key === q.key);
                    const on = q.key === selectedKey;
                    return (
                      <li
                        key={q.key}
                        draggable={!readOnly}
                        onDragStart={(e) => { setDragKey(q.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", q.key); }}
                        onDragEnd={endDrag}
                        {...dropProps(q.key, s.key, q.key)}
                        className={cn(
                          "flex items-start gap-2 rounded-[8px] px-2 py-1.5 transition-[box-shadow,opacity] duration-150",
                          on && "bg-[var(--brand-50)]", q.showWhen && "ml-4",
                          overKey === q.key && dragKey !== q.key && "shadow-[inset_0_2px_0_var(--primary)]",
                          dragKey === q.key && "opacity-50",
                        )}
                      >
                        {!readOnly && <GripVertical aria-hidden="true" className="mt-1 size-4 shrink-0 cursor-grab text-[var(--body)]" />}
                        <button
                          type="button"
                          onClick={() => { setPhonePane(null); onSelect(on ? null : q.key); }}
                          aria-pressed={on}
                          className="min-w-0 flex-1 rounded-[6px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                        >
                          <span className="flex gap-2 text-sm leading-[1.5] text-[var(--ink)]">
                            <span className="w-6 shrink-0 tabular-nums text-[var(--muted)]">{numberOf.get(q.key)}.</span>
                            <span className="min-w-0">{q.label || <span className="text-[var(--muted)]">No question text</span>}</span>
                          </span>
                          <span className="mt-1 ml-8 flex flex-wrap gap-1.5">
                            <StatusChip dot={false} tone="neutral">{isYnu(q) ? "Yes / No / Unsure" : TYPE_SHORT[q.type]}</StatusChip>
                            {q.required && <StatusChip dot={false} tone="neutral">Required</StatusChip>}
                            {q.knockout && <StatusChip dot={false} tone="danger">Knockout</StatusChip>}
                            {q.showWhen && (
                              // A pill never wraps: a long parent question is cut to the card's width (in full on hover), so it cannot run out of the card on a phone.
                              <span className="flex min-w-0 max-w-full" title={`When “${parent?.label ?? q.showWhen.key}” is ${answerText(parent, q.showWhen.equals)}`}>
                                <StatusChip dot={false} tone="info" className="min-w-0 max-w-full"><span className="truncate">When “{parent?.label ?? q.showWhen.key}” is {answerText(parent, q.showWhen.equals)}</span></StatusChip>
                              </span>
                            )}
                            {q.persistency && <StatusChip dot={false} tone="good">{PERSISTENCY_LABEL}</StatusChip>}
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
  );
  const editor = selected && (
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
      knockoutFor={bank?.carrierName ?? null}
    />
  );

  // Owner 2026-10-28 (after pick C): the template's own questions are the page — wide, on the left;
  // the question bank is the side tool on the right. A question clicked in the list opens its editor
  // in the bank's place, with the way back to the bank.
  // S15 (owner 2026-10-30): on a phone the two columns are one switch — the list, or the bank (or
  // the question picked) — instead of the bank stacked under the whole list.
  if (bank) {
    const side = phonePane === "side" || Boolean(selected && phonePane !== "list");
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="lg:hidden">
          <Segmented
            label="Show"
            value={side ? "side" : "list"}
            onChange={(k) => setPhonePane(k)}
            options={[{ key: "list", label: `Questions ${qs.length}` }, { key: "side", label: selected ? "This question" : "Question bank" }]}
          />
        </div>
        <div className={cn("min-w-0", side && "hidden lg:block")}>{listCard}</div>
        <div ref={sideRef} style={sideBox ?? undefined} className={cn("flex min-w-0 flex-col gap-3 lg:sticky lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-width:thin]", !side && "hidden lg:flex")}>
          {selected ? (
            <>
              <span><Button type="button" variant="outline" size="sm" onClick={() => onSelect(null)}><ArrowLeft aria-hidden="true" />Question bank</Button></span>
              {editor}
            </>
          ) : (
            <QuestionBank draft={draft} onChange={(next) => onChange(orderBySection(next))} readOnly={readOnly} templateName={bank.templateName} />
          )}
        </div>
      </div>
    );
  }
  return (
    <>
      {listCard}
      {editor}
    </>
  );
}

function QuestionCard({ q, index, total, all, sections, readOnly, onPatch, onQuestions, onRekey, knockoutFor = null }: {
  q: UwQuestion; index: number; total: number; all: UwQuestion[]; sections: UwDraft["sections"]; readOnly: boolean;
  onPatch: (p: Partial<UwQuestion>) => void; onQuestions: (list: UwQuestion[]) => void; onRekey: (to: string) => void;
  /** The one carrier the template is for; null when every carrier uses it. */
  knockoutFor?: string | null;
}) {
  const id = (part: string) => `uw-${q.key}-${part}`;
  const locked = isLockedPersistency(q);
  const at = all.findIndex((x) => x.key === q.key);
  const earlier = all.slice(0, at).filter((x) => x.type === "boolean" || x.type === "single_select");
  const parent = q.showWhen ? all.find((x) => x.key === q.showWhen?.key) : undefined;
  const valuesFor = (x: UwQuestion | undefined) => (x?.type === "boolean" ? [{ v: "true", l: "Yes" }, { v: "false", l: "No" }] : (x?.options ?? []).map((o) => ({ v: o, l: o })));

  const setType = (choice: TypeChoice) => {
    if (choice === "yes_no_unsure") return onPatch({ type: "single_select", options: [...YNU], knockout: null });
    const next: Partial<UwQuestion> = { type: choice };
    if (choice !== "boolean") next.knockout = null;
    if (hasChoices(choice) && q.options.length < 2) next.options = ["First choice", "Second choice"];
    onPatch(next);
  };

  /** A new free-text follow-up for this answer, after the question and the follow-ups it already has. */
  const addFollowUp = (equals: "true" | "false") => {
    const key = freshKey(`${q.key}_details`, all.map((x) => x.key));
    const list = [...all];
    const tree = descendantKeys(q.key, all);
    const last = Math.max(at, ...list.map((x, i) => (tree.has(x.key) ? i : -1)));
    list.splice(last + 1, 0, { key, label: equals === "true" ? "Tell me more about that." : "Why not?", type: "text", options: [], help: null, required: false, persistency: false, section: q.section, knockout: null, showWhen: { key: q.key, equals }, appliesTo: "all" });
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
          {q.persistency && <StatusChip dot={false} tone="good">{PERSISTENCY_LABEL}</StatusChip>}
          {q.knockout && <StatusChip dot={false} tone="danger">Knockout</StatusChip>}
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

        {/* S4 (owner 2026-10-30): one picture of the branch — for Yes and for No, whether it rules
            the carrier out, what the agent sees, and the questions it opens. */}
        {q.type === "boolean" && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-[var(--ink)]">When the answer is…</span>
            <div className="grid gap-3">
              {(["true", "false"] as const).map((v) => {
                const word = v === "true" ? "Yes" : "No";
                const ko = q.knockout?.when === v ? q.knockout : null;
                const kids = all.filter((x) => x.showWhen?.key === q.key && x.showWhen.equals === v);
                return (
                  <div key={v} className={cn("flex flex-col gap-3 rounded-[12px] border p-3", ko ? "border-[color-mix(in_srgb,var(--error)_50%,var(--border))]" : "border-[var(--border)]")}>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusChip dot={false} tone={ko ? "danger" : "neutral"}>{word}</StatusChip>
                      {ko && <span className="text-xs font-semibold text-[var(--error-ink)]">Rules out {knockoutFor ?? "the carrier being quoted"}</span>}
                    </span>
                    <ToggleRow
                      id={id(`knockout-${v}`)}
                      title={knockoutFor ? `A ${word} is a knockout for ${knockoutFor}` : `A ${word} is a knockout for the carrier being quoted`}
                      help="It doesn't stop the interview: the agent sees it at once and picks another carrier on Quote."
                      checked={Boolean(ko)}
                      disabled={readOnly || (Boolean(q.knockout) && !ko)}
                      onChange={(on) => onPatch({ knockout: on ? { when: v, note: q.knockout?.note ?? "" } : null })}
                    />
                    {ko && (
                      <Field label="What the agent sees" htmlFor={id(`ko-note-${v}`)} required hint={`Shown as “Knockout — …” the moment ${word} is given.`}>
                        <input id={id(`ko-note-${v}`)} className={control} value={ko.note} disabled={readOnly} placeholder="Most carriers decline this; guaranteed issue only." onChange={(e) => onPatch({ knockout: { when: v, note: e.target.value } })} />
                      </Field>
                    )}
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-semibold text-[var(--ink)]">{kids.length ? `Then ask (${kids.length})` : `Nothing else is asked when ${word}.`}</span>
                      {kids.map((k) => {
                        const hasOwn = all.some((x) => x.showWhen?.key === k.key);
                        return (
                          <span key={k.key} className="flex items-center gap-2">
                            <input aria-label={`Follow-up when ${word}`} className={cn(control, "mt-0 min-w-0 flex-1")} value={k.label} disabled={readOnly} onChange={(e) => onQuestions(all.map((x) => (x.key === k.key ? { ...x, label: e.target.value } : x)))} />
                            {!readOnly && (
                              <WithReason reason={hasOwn ? "Remove its own follow-ups first." : null}>
                                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove the follow-up “${k.label}”`} disabled={hasOwn} onClick={() => onQuestions(all.filter((x) => x.key !== k.key))}><Trash2 aria-hidden="true" /></Button>
                              </WithReason>
                            )}
                          </span>
                        );
                      })}
                      {!readOnly && (
                        <span><Button type="button" variant="outline" size="sm" onClick={() => addFollowUp(v)}><Plus aria-hidden="true" />Ask another when {word}</Button></span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
