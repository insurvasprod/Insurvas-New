"use client";

import type { ReactNode } from "react";
import { Banknote, Calendar, Check, DollarSign, Ellipsis, FileText, Hash, Landmark, List, ListChecks, Mail, Phone, Plus, RotateCcw, ShieldCheck, ToggleLeft, Trash2, Type, X, Columns2, RectangleHorizontal, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusChip } from "@/components/ui/status-chip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
      <Tag htmlFor={htmlFor} className="text-xs font-semibold text-[var(--ink)]">{children}</Tag>
      {tip && <InfoTip label={`About “${typeof children === "string" ? children : "this"}”`}>{tip}</InfoTip>}
    </span>
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

const TYPE_ICON: Record<TemplateFieldType, LucideIcon> = {
  text: Type, long_text: FileText, number: Hash, date: Calendar, currency: DollarSign, phone: Phone, email: Mail,
  ssn: ShieldCheck, bank_routing: Landmark, bank_account: Banknote, boolean: ToggleLeft, single_select: List, multi_select: ListChecks,
};
const small = "mt-0 h-8 text-sm";

/** A 32px icon that is one choice of a few; its name is the tooltip and the accessible name. */
function IconChoice({ label, selected, onClick, children }: { label: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
        selected ? "border-transparent bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]",
      )}
    >
      {children}
    </button>
  );
}

function NumberPair({ id, lead, between = "to", low, high, onLow, onHigh, prefix }: { id: string; lead: string; between?: string; low: number | undefined; high: number | undefined; onLow: (value: number | undefined) => void; onHigh: (value: number | undefined) => void; prefix?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
      <span>{lead}</span>
      {prefix && <span aria-hidden="true">{prefix}</span>}
      <input id={`${id}-low`} aria-label={`${lead}, lowest`} className={cn(control, small, "w-24")} type="number" value={low ?? ""} onChange={(event) => onLow(numberOrUndefined(event.target.value))} />
      <span>{between}</span>
      {prefix && <span aria-hidden="true">{prefix}</span>}
      <input id={`${id}-high`} aria-label={`${lead}, highest`} className={cn(control, small, "w-24")} type="number" value={high ?? ""} onChange={(event) => onHigh(numberOrUndefined(event.target.value))} />
    </div>
  );
}

/**
 * "Change this question", opened in place under the question (owner 2026-11-03: compact, icons for the
 * small choices). The header carries where it sits, whether it changed, and three icons: put back,
 * delete, done. Under it the question, the answer kinds as icons, then a tight row of the other
 * settings. Every edit goes into the page's one draft.
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
  const where = sectionKey ? form.sections.find((section) => section.section_key === sectionKey)?.label ?? "" : "Agents only";
  const shownTypes = rare.includes(field.type) ? [...COMMON_FIELD_TYPES, field.type] : COMMON_FIELD_TYPES;
  const answers = (item: TemplateField | null): string[] | null => (!item ? null : item.type === "boolean" ? ["Yes", "No"] : CHOICE_TYPES.includes(item.type) && item.options.length ? item.options : null);

  function setType(type: TemplateFieldType) {
    setField(key, { type, options: CHOICE_TYPES.includes(type) ? (field.options.length ? field.options : ["First choice", "Second choice"]) : [], validation: {} });
  }
  function setOption(index: number, value: string) { setField(key, { options: field.options.map((option, at) => (at === index ? value : option)) }); }
  function setCondition(next: { field_key: string; equals: string } | null) { if (sectionKey) setPlacement(sectionKey, key, { show_when: next, conditional_on: null }); }

  return (
    <section aria-label={`Change “${field.label || "Untitled question"}”`} className="flex flex-col gap-3 rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip>{where}</StatusChip>
        {changed && <span className="text-xs font-semibold text-[var(--muted)]">Changed. Not live until you publish.</span>}
        <span className="ml-auto flex items-center gap-0.5">
          {onReset && <Button onClick={onReset} type="button" variant="ghost" size="icon-sm" aria-label="Put back how it was" title="Put back how it was"><RotateCcw aria-hidden="true" /></Button>}
          <Button onClick={onDelete} type="button" variant="ghost" size="icon-sm" className="text-[var(--error-ink)]" aria-label="Delete question" title="Delete question"><Trash2 aria-hidden="true" /></Button>
          <Button onClick={onClose} type="button" variant="ghost" size="icon-sm" aria-label="Done" title="Done"><Check aria-hidden="true" /></Button>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="question-label" tip={sentence}>The question</Label>
        <input id="question-label" className={cn(control, small)} maxLength={120} value={field.label} onChange={(event) => setField(key, { label: event.target.value })} />
      </div>

      <div className="flex flex-col gap-1">
        <Label tip="Decides the box they get: a date picker, a list to pick from, a money amount.">They answer with <span className="font-normal text-[var(--muted)]">· {TEMPLATE_FIELD_PLAIN[field.type].label}</span></Label>
        <div role="radiogroup" aria-label="They answer with" className="flex flex-wrap items-center gap-1">
          {shownTypes.map((type) => {
            const Icon = TYPE_ICON[type];
            return <IconChoice key={type} label={`${TEMPLATE_FIELD_PLAIN[type].label}: ${TEMPLATE_FIELD_PLAIN[type].hint}`} selected={field.type === type} onClick={() => setType(type)}><Icon className="size-4" aria-hidden="true" /></IconChoice>;
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`More kinds of answer (${rare.length})`} title={`More kinds of answer (${rare.length})`}><Ellipsis aria-hidden="true" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {rare.map((type) => {
                const Icon = TYPE_ICON[type];
                return <DropdownMenuItem key={type} onSelect={() => setType(type)}><Icon aria-hidden="true" />{TEMPLATE_FIELD_PLAIN[type].label}</DropdownMenuItem>;
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="question-required" tip="“Yes, always” also stops agents from saving a lead without it. “Only on this form” means only partners must answer.">Must they answer?</Label>
          <select id="question-required" className={cn(control, small)} value={requiredChoice(field, placement)} onChange={(event) => onRequired(event.target.value as RequiredChoice)}>
            {requiredChoices(placement).map((choice) => <option key={choice} value={choice}>{REQUIRED_CHOICE_LABELS[choice]}</option>)}
          </select>
        </div>
        {sectionKey && placement && (
          <div className="flex min-w-0 flex-col gap-1">
            <Label tip="Two half-row questions sit side by side. On a phone every question takes the whole row.">Size</Label>
            <div role="radiogroup" aria-label="Size" className="flex gap-1">
              <IconChoice label="Half row (usual)" selected={!full} onClick={() => setPlacement(sectionKey, key, { width: "half" })}><Columns2 className="size-4" aria-hidden="true" /></IconChoice>
              <IconChoice label="Full row" selected={full} onClick={() => setPlacement(sectionKey, key, { width: "full" })}><RectangleHorizontal className="size-4" aria-hidden="true" /></IconChoice>
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="question-where" tip={`Saved on each lead under the name ${key}. That name never changes.`}>Where it sits</Label>
          <select
            id="question-where"
            className={cn(control, small)}
            value={sectionKey ?? AGENTS_ONLY}
            onChange={(event) => onMoveTo(event.target.value === AGENTS_ONLY ? null : event.target.value)}
          >
            {form.sections.map((section, index) => <option key={section.section_key} value={section.section_key}>{`Part ${index + 1}: ${section.label}`}</option>)}
            <option value={AGENTS_ONLY}>For your agents only</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="question-hint" tip="Small text under the box. For example: As it is on their driver’s licence.">Hint under the box</Label>
        <input id="question-hint" className={cn(control, small)} maxLength={500} placeholder="None" value={field.help_text ?? ""} onChange={(event) => setField(key, { help_text: event.target.value })} />
      </div>

      {CHOICE_TYPES.includes(field.type) && (
        <div className="flex flex-col gap-1">
          <Label tip="Partners pick from these, in this order.">Choices</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {field.options.map((option, index) => (
              <span key={index} className="inline-flex items-center gap-0.5">
                <input aria-label={`Choice ${index + 1}`} className={cn(control, small, "w-36")} maxLength={120} value={option} onChange={(event) => setOption(index, event.target.value)} />
                <Button onClick={() => setField(key, { options: field.options.filter((_, at) => at !== index) })} type="button" variant="ghost" size="icon-xs" aria-label={`Remove choice ${option || index + 1}`} title="Remove this choice"><X aria-hidden="true" /></Button>
              </span>
            ))}
            <Button onClick={() => setField(key, { options: [...field.options, ""] })} type="button" variant="ghost" size="icon-sm" aria-label="Add a choice" title="Add a choice"><Plus aria-hidden="true" /></Button>
          </div>
        </div>
      )}

      {limitsFor(field.type) && (
        <div className="flex flex-col gap-1">
          <Label tip="Partners can’t send the form until the answer fits. Leave a box empty for no limit.">Limits <span className="font-normal text-[var(--muted)]">· {limitSummary(field)}</span></Label>
          {field.type === "currency" && <NumberPair id="question-money" lead="Between" between="and" prefix="$" low={v.min} high={v.max} onLow={(min) => setValidation(key, { min })} onHigh={(max) => setValidation(key, { max })} />}
          {field.type === "number" && <NumberPair id="question-number" lead="Between" between="and" low={v.min} high={v.max} onLow={(min) => setValidation(key, { min })} onHigh={(max) => setValidation(key, { max })} />}
          {field.type === "date" && <NumberPair id="question-age" lead="Age from" low={v.age_min} high={v.age_max} onLow={(age_min) => setValidation(key, { age_min })} onHigh={(age_max) => setValidation(key, { age_max })} />}
          {["text", "long_text"].includes(field.type) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <NumberPair id="question-length" lead="Characters from" low={v.min_length} high={v.max_length} onLow={(min_length) => setValidation(key, { min_length })} onHigh={(max_length) => setValidation(key, { max_length })} />
              <label className="flex items-center gap-2 text-sm text-[var(--body)]">
                <span>Allowed</span>
                <select className={cn(control, small, "w-auto")} value={PATTERNS.find((item) => item.pattern === (v.pattern ?? ""))?.pattern ?? CUSTOM} onChange={(event) => { if (event.target.value !== CUSTOM) setValidation(key, { pattern: event.target.value || undefined }); }}>
                  {PATTERNS.map((item) => <option key={item.label} value={item.pattern}>{item.label}</option>)}
                  {!PATTERNS.some((item) => item.pattern === (v.pattern ?? "")) && <option value={CUSTOM}>A custom rule set by Insurvas</option>}
                </select>
              </label>
            </div>
          )}
          {field.type === "bank_routing" && <p className="m-0 text-sm text-[var(--body)]">Always nine digits that pass the bank check. Saved as the digits only.</p>}
          {field.type === "bank_account" && <p className="m-0 text-sm text-[var(--body)]">Always {BANK_ACCOUNT_MIN_DIGITS} to {BANK_ACCOUNT_MAX_DIGITS} digits. Saved as the digits only.</p>}
        </div>
      )}

      {sectionKey && placement && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="question-after" tip="Only ask this after a certain answer to an earlier question.">Only ask it after an earlier answer</Label>
            <Switch id="question-after" checked={Boolean(condition)} onChange={(on) => setCondition(on ? { field_key: others[0]?.field_key ?? key, equals: answers(others[0] ?? null)?.[0] ?? "" } : null)} />
          </div>
          {condition && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
              <span>after</span>
              <select aria-label="The earlier question" className={cn(control, small, "w-auto min-w-0 flex-[1_1_140px]")} value={condition.field_key} onChange={(event) => { const next = fields.find((item) => item.field_key === event.target.value) ?? null; setCondition({ field_key: event.target.value, equals: answers(next)?.[0] ?? "" }); }}>
                {others.map((item) => <option key={item.field_key} value={item.field_key}>{item.label}</option>)}
              </select>
              <span>is</span>
              {answers(target) ? (
                <select aria-label="The answer" className={cn(control, small, "w-auto min-w-0 flex-[1_1_100px]")} value={condition.equals ?? ""} onChange={(event) => setCondition({ field_key: condition.field_key, equals: event.target.value })}>
                  {!answers(target)!.includes(condition.equals ?? "") && <option value={condition.equals ?? ""}>{condition.equals || "Choose…"}</option>}
                  {answers(target)!.map((answer) => <option key={answer} value={answer}>{answer}</option>)}
                </select>
              ) : (
                <input aria-label="The answer" className={cn(control, small, "w-auto min-w-0 flex-[1_1_100px]")} value={condition.equals ?? ""} onChange={(event) => setCondition({ field_key: condition.field_key, equals: event.target.value })} />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
