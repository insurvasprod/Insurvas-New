"use client";

import type { ReactNode } from "react";
import { ChevronDown, Plus, RotateCcw, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { InfoTip } from "@/components/ui/info-tip";
import { Switch, control } from "@/components/app/settings/primitives";
import { TEMPLATE_FIELD_TYPES, type TemplateField, type TemplateFieldType, type TemplateFormDefinition, type TemplateFormField, type TemplateValidation } from "@/lib/templates/constants";
import { BANK_ACCOUNT_MAX_DIGITS, BANK_ACCOUNT_MIN_DIGITS } from "@/lib/templates/formats";
import { COMMON_FIELD_TYPES, REQUIRED_CHOICE_LABELS, TEMPLATE_FIELD_PLAIN, requiredChoice, requiredChoices, type RequiredChoice } from "@/lib/templates/plainLabels";
import { questionSentence } from "@/lib/templates/questionSentence";
import { placementWidth } from "@/lib/templates/placementWidth";
import { numberOrUndefined } from "@/components/app/form-templates/draft";

const CHOICE_TYPES: readonly TemplateFieldType[] = ["single_select", "multi_select"];
/** Character rules in plain words; the stored value stays a regular expression. */
const PATTERNS: ReadonlyArray<{ label: string; pattern: string }> = [
  { label: "Anything", pattern: "" },
  { label: "Letters only", pattern: "^[A-Za-z .'-]*$" },
  { label: "Digits only", pattern: "^[0-9]*$" },
  { label: "Letters and digits", pattern: "^[A-Za-z0-9 ]*$" },
];
const CUSTOM = "__custom__";
/** The "where it sits" select: a part of the form, or the agents-only list. */
const AGENTS_ONLY = "__agents_only__";

/** A label with its tip, the panel's one way of explaining a control. */
function Label({ htmlFor, tip, children }: { htmlFor?: string; tip?: string; children: ReactNode }) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <span className="flex items-center gap-1">
      <Tag htmlFor={htmlFor} className="text-sm font-semibold text-[var(--ink)]">{children}</Tag>
      {tip && <InfoTip label={`About “${typeof children === "string" ? children : "this"}”`}>{tip}</InfoTip>}
    </span>
  );
}

/**
 * One folded setting: its name and current value on a 44px row; open it to change it. Native
 * details/summary, so it works with the keyboard and screen readers without any script.
 */
function Fold({ label, value, open, children }: { label: string; value: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group border-t border-[var(--border)]">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-3 px-4 hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring-color)] [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 text-sm font-semibold text-[var(--ink)]">{label}</span>
        <span className="ml-auto min-w-0 truncate text-sm text-[var(--muted)]">{value}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--muted)] transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-3.5">{children}</div>
    </details>
  );
}

const LIMIT_TYPES: readonly TemplateFieldType[] = ["number", "currency", "date", "text", "long_text", "bank_routing", "bank_account"];
const limitsFor = (type: TemplateFieldType) => LIMIT_TYPES.includes(type);

/** The limits in a few words, for the folded row. */
function limitSummary(field: TemplateField): string {
  const v = field.validation ?? {};
  const span = (low: number | undefined, high: number | undefined, show: (n: number) => string) =>
    low != null && high != null ? `${show(low)} to ${show(high)}` : low != null ? `At least ${show(low)}` : high != null ? `At most ${show(high)}` : "None";
  if (field.type === "currency") return span(v.min, v.max, (n) => "$" + n.toLocaleString("en-US"));
  if (field.type === "number") return span(v.min, v.max, (n) => n.toLocaleString("en-US"));
  if (field.type === "date") { const ages = span(v.age_min, v.age_max, String); return ages === "None" ? "Any age" : `Age ${ages.toLowerCase()}`; }
  if (field.type === "bank_routing" || field.type === "bank_account") return "Set by the bank";
  const length = span(v.min_length, v.max_length, String);
  const chars = PATTERNS.find((item) => item.pattern === (v.pattern ?? ""))?.label ?? "Custom rule";
  return [length === "None" ? null : `${length} characters`, v.pattern ? chars : null].filter(Boolean).join(", ") || "None";
}

/** Pressed-button chips for a single choice, 36px like every control. */
function Chips<K extends string>({ label, options, value, onChange }: { label: string; options: ReadonlyArray<{ key: K; label: string }>; value: K | null; onChange: (key: K) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = option.key === value;
        return (
          <button
            key={option.key}
            onClick={() => onChange(option.key)}
            type="button"
            aria-pressed={on}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
              on ? "border-2 border-[var(--ink)] bg-[var(--primary-soft)] px-[11px] font-semibold text-[var(--ink)]" : "border-[var(--border-strong)] bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function NumberPair({ id, lead, between = "to", low, high, onLow, onHigh, prefix }: { id: string; lead: string; between?: string; low: number | undefined; high: number | undefined; onLow: (value: number | undefined) => void; onHigh: (value: number | undefined) => void; prefix?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
      <span>{lead}</span>
      {prefix && <span aria-hidden="true">{prefix}</span>}
      <input id={`${id}-low`} aria-label={`${lead}, lowest`} className={cn(control, "mt-0 w-28")} type="number" value={low ?? ""} onChange={(event) => onLow(numberOrUndefined(event.target.value))} />
      <span>{between}</span>
      {prefix && <span aria-hidden="true">{prefix}</span>}
      <input id={`${id}-high`} aria-label={`${lead}, highest`} className={cn(control, "mt-0 w-28")} type="number" value={high ?? ""} onChange={(event) => onHigh(numberOrUndefined(event.target.value))} />
    </div>
  );
}

/**
 * Form templates, layout C: "Change this question". A plain sentence at the top says what partners
 * will experience and updates as you edit; under it the question, what they answer with, whether
 * they have to, a hint, the limits that answer type has, its choices, and when it is asked. Every
 * edit goes into the page's one draft. "Put back how it was" undoes this question's own changes.
 */
export function QuestionPanel({ field, fields, form, sectionKey, placement, changed, setField, setValidation, setPlacement, onRequired, onMoveTo, onReset, onDelete, onClose }: {
  field: TemplateField;
  fields: TemplateField[];
  form: TemplateFormDefinition;
  /** The part of the form it was picked in; null when it is kept for agents only. */
  sectionKey: string | null;
  placement: TemplateFormField | null;
  /** True when this question or its place differs from the live form. */
  changed: boolean;
  setField: (fieldKey: string, patch: Partial<TemplateField>) => void;
  setValidation: (fieldKey: string, patch: Partial<TemplateValidation>) => void;
  setPlacement: (sectionKey: string, fieldKey: string, patch: Partial<TemplateFormField>) => void;
  onRequired: (choice: RequiredChoice) => void;
  /** Into another part of the form, or (null) off the form and kept for agents. */
  onMoveTo: (target: string | null) => void;
  onReset: (() => void) | null;
  onDelete: () => void;
  onClose: () => void;
}) {
  const key = field.field_key;
  const v = field.validation ?? {};
  const condition = placement ? placement.show_when ?? placement.conditional_on ?? null : null;
  const target = condition ? fields.find((item) => item.field_key === condition.field_key) ?? null : null;
  const sentence = questionSentence(field, placement, condition && target ? { label: target.label, equals: condition.equals ?? "" } : null);
  const rare = TEMPLATE_FIELD_TYPES.filter((type) => !COMMON_FIELD_TYPES.includes(type));
  const others = fields.filter((item) => item.field_key !== key);
  const full = placementWidth(field, placement) === "full";
  const answers = (item: TemplateField | null): string[] | null => (!item ? null : item.type === "boolean" ? ["Yes", "No"] : CHOICE_TYPES.includes(item.type) && item.options.length ? item.options : null);

  function setType(type: TemplateFieldType) {
    setField(key, { type, options: CHOICE_TYPES.includes(type) ? (field.options.length ? field.options : ["First choice", "Second choice"]) : [], validation: {} });
  }
  function setOption(index: number, value: string) { setField(key, { options: field.options.map((option, at) => (at === index ? value : option)) }); }
  function setCondition(next: { field_key: string; equals: string } | null) { if (sectionKey) setPlacement(sectionKey, key, { show_when: next, conditional_on: null }); }

  return (
    <DetailPanel
      mode="split"
      splitFrom="xl"
      title="Change this question"
      onClose={onClose}
      closeLabel="Close the question"
      className="xl:sticky xl:top-[calc(var(--top-bar-h)+1rem)] xl:max-h-[calc(100dvh-var(--top-bar-h)-2rem)] xl:self-start"
      footer={
        <>
          {onReset && <Button onClick={onReset} type="button" variant="ghost"><RotateCcw aria-hidden="true" />Put back how it was</Button>}
          <Button onClick={onDelete} type="button" variant="ghost" className="ml-auto text-[var(--error-ink)]"><Trash2 aria-hidden="true" />Delete question</Button>
        </>
      }
    >
      <p aria-live="polite" className="m-0 rounded-[10px] bg-[var(--surface-alt)] px-3.5 py-3 text-sm leading-[1.55] text-[var(--ink)]">
        {sentence}
        {changed && <span className="mt-1.5 block text-xs font-semibold text-[var(--warning-ink)]">Changed. Not live until you publish.</span>}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="question-label" tip="The words partners read above the box.">The question</Label>
        <input id="question-label" className={cn(control, "mt-0")} maxLength={120} value={field.label} onChange={(event) => setField(key, { label: event.target.value })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label tip="Decides the box they get: a date picker, a list to pick from, a money amount.">They answer with…</Label>
        <Chips label="They answer with" options={COMMON_FIELD_TYPES.map((type) => ({ key: type, label: TEMPLATE_FIELD_PLAIN[type].label }))} value={COMMON_FIELD_TYPES.includes(field.type) ? field.type : null} onChange={setType} />
        <select aria-label="Other kinds of answer" className={cn(control, rare.includes(field.type) && "border-2 border-[var(--ink)] font-semibold")} value={rare.includes(field.type) ? field.type : ""} onChange={(event) => { if (event.target.value) setType(event.target.value as TemplateFieldType); }}>
          <option value="">Other kinds…</option>
          {rare.map((type) => <option key={type} value={type}>{TEMPLATE_FIELD_PLAIN[type].label} ({TEMPLATE_FIELD_PLAIN[type].hint})</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label tip="“Yes, always” also stops agents from saving a lead without it. “Only on this form” means only partners must answer.">Do they have to answer?</Label>
        <Chips label="Do they have to answer?" options={requiredChoices(placement).map((choice) => ({ key: choice, label: REQUIRED_CHOICE_LABELS[choice] }))} value={requiredChoice(field, placement)} onChange={onRequired} />
      </div>

      {/* The rest, folded: each row says its current value, so nothing hides behind a click. */}
      <div key={key} className="-mx-4 border-b border-[var(--border)]">
        {sectionKey && placement && (
          <Fold label="Size" value={`${full ? "Full row" : "Half row"}${placement.width ? "" : " (usual)"}`}>
            <Chips label="Size" options={[{ key: "half", label: "Half row" }, { key: "full", label: "Full row" }]} value={full ? "full" : "half"} onChange={(width) => setPlacement(sectionKey, key, { width })} />
            <p className="m-0 text-xs text-[var(--muted)]">Two half-row questions sit side by side. On a phone every question takes the whole row.</p>
          </Fold>
        )}

        <Fold label="Hint under the box" value={field.help_text ? `“${field.help_text}”` : "None"}>
          <input aria-label="Hint under the box" className={cn(control, "mt-0")} maxLength={500} placeholder="For example: As it is on their driver’s licence" value={field.help_text ?? ""} onChange={(event) => setField(key, { help_text: event.target.value })} />
        </Fold>

        {limitsFor(field.type) && (
          <Fold label="Limits" value={limitSummary(field)}>
            <p className="m-0 text-xs text-[var(--muted)]">Partners can’t send the form until the answer fits. Leave a box empty for no limit.</p>
            {field.type === "currency" && <NumberPair id="question-money" lead="Between" between="and" prefix="$" low={v.min} high={v.max} onLow={(min) => setValidation(key, { min })} onHigh={(max) => setValidation(key, { max })} />}
            {field.type === "number" && <NumberPair id="question-number" lead="Between" between="and" low={v.min} high={v.max} onLow={(min) => setValidation(key, { min })} onHigh={(max) => setValidation(key, { max })} />}
            {field.type === "date" && <NumberPair id="question-age" lead="Age from" low={v.age_min} high={v.age_max} onLow={(age_min) => setValidation(key, { age_min })} onHigh={(age_max) => setValidation(key, { age_max })} />}
            {["text", "long_text"].includes(field.type) && (
              <>
                <NumberPair id="question-length" lead="Characters from" low={v.min_length} high={v.max_length} onLow={(min_length) => setValidation(key, { min_length })} onHigh={(max_length) => setValidation(key, { max_length })} />
                <label className="block text-sm text-[var(--body)]">
                  <span className="font-semibold">Allowed characters</span>
                  <select className={control} value={PATTERNS.find((item) => item.pattern === (v.pattern ?? ""))?.pattern ?? CUSTOM} onChange={(event) => { if (event.target.value !== CUSTOM) setValidation(key, { pattern: event.target.value || undefined }); }}>
                    {PATTERNS.map((item) => <option key={item.label} value={item.pattern}>{item.label}</option>)}
                    {!PATTERNS.some((item) => item.pattern === (v.pattern ?? "")) && <option value={CUSTOM}>A custom rule set by Insurvas</option>}
                  </select>
                </label>
              </>
            )}
            {field.type === "bank_routing" && <p className="m-0 text-sm text-[var(--body)]">Always nine digits that pass the bank check. Saved as the digits only.</p>}
            {field.type === "bank_account" && <p className="m-0 text-sm text-[var(--body)]">Always {BANK_ACCOUNT_MIN_DIGITS} to {BANK_ACCOUNT_MAX_DIGITS} digits. Saved as the digits only.</p>}
          </Fold>
        )}

        {CHOICE_TYPES.includes(field.type) && (
          <Fold label="Choices" value={`${field.options.length} ${field.options.length === 1 ? "choice" : "choices"}`} open>
            <p className="m-0 text-xs text-[var(--muted)]">Partners pick from these, in this order.</p>
            {field.options.map((option, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input aria-label={`Choice ${index + 1}`} className={cn(control, "mt-0")} maxLength={120} value={option} onChange={(event) => setOption(index, event.target.value)} />
                <Button onClick={() => setField(key, { options: field.options.filter((_, at) => at !== index) })} type="button" variant="ghost" size="icon" aria-label={`Remove choice ${option || index + 1}`}><X aria-hidden="true" /></Button>
              </div>
            ))}
            <Button onClick={() => setField(key, { options: [...field.options, ""] })} type="button" variant="ghost" className="self-start"><Plus aria-hidden="true" />Add a choice</Button>
          </Fold>
        )}

        {sectionKey && placement && (
          <Fold label="When it’s asked" value={condition && target ? `After “${condition.equals}” to ${target.label}` : "Always"}>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="question-after" className="text-sm text-[var(--body)]">Only ask it after a certain answer to an earlier question</label>
              <Switch id="question-after" checked={Boolean(condition)} onChange={(on) => setCondition(on ? { field_key: others[0]?.field_key ?? key, equals: answers(others[0] ?? null)?.[0] ?? "" } : null)} />
            </div>
            {condition && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
                <span>after</span>
                <select aria-label="The earlier question" className={cn(control, "mt-0 w-auto min-w-0 flex-[1_1_140px]")} value={condition.field_key} onChange={(event) => { const next = fields.find((item) => item.field_key === event.target.value) ?? null; setCondition({ field_key: event.target.value, equals: answers(next)?.[0] ?? "" }); }}>
                  {others.map((item) => <option key={item.field_key} value={item.field_key}>{item.label}</option>)}
                </select>
                <span>is</span>
                {answers(target) ? (
                  <select aria-label="The answer" className={cn(control, "mt-0 w-auto min-w-0 flex-[1_1_100px]")} value={condition.equals ?? ""} onChange={(event) => setCondition({ field_key: condition.field_key, equals: event.target.value })}>
                    {!answers(target)!.includes(condition.equals ?? "") && <option value={condition.equals ?? ""}>{condition.equals || "Choose…"}</option>}
                    {answers(target)!.map((answer) => <option key={answer} value={answer}>{answer}</option>)}
                  </select>
                ) : (
                  <input aria-label="The answer" className={cn(control, "mt-0 w-auto min-w-0 flex-[1_1_100px]")} value={condition.equals ?? ""} onChange={(event) => setCondition({ field_key: condition.field_key, equals: event.target.value })} />
                )}
              </div>
            )}
          </Fold>
        )}

        <Fold label="Where it sits" value={sectionKey ? form.sections.find((section) => section.section_key === sectionKey)?.label ?? "" : "Agents only"}>
          <select aria-label="Where it sits" className={cn(control, "mt-0")} value={sectionKey ?? AGENTS_ONLY} onChange={(event) => onMoveTo(event.target.value === AGENTS_ONLY ? null : event.target.value)}>
            {form.sections.map((section, index) => <option key={section.section_key} value={section.section_key}>Part {index + 1}: {section.label}</option>)}
            <option value={AGENTS_ONLY}>For your agents only (partners never see it)</option>
          </select>
          <p className="m-0 text-xs text-[var(--muted)]">Saved on each lead under the name {key}. That name never changes.</p>
        </Fold>
      </div>
    </DetailPanel>
  );
}
