"use client";

import { useState, type ReactNode } from "react";
import { Copy, Plus, RotateCcw, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { Switch } from "@/components/app/settings/primitives";
import { inputControl } from "@/components/ui/field";
import { TEMPLATE_FIELD_TYPES, type TemplateField, type TemplateFieldType, type TemplateFormDefinition, type TemplateFormField, type TemplateLogic, type TemplateValidation } from "@/lib/templates/constants";
import { TEMPLATE_FIELD_PLAIN, requiredChoice, type RequiredChoice } from "@/lib/templates/plainLabels";
import { questionSentence } from "@/lib/templates/questionSentence";
import { placementWidth } from "@/lib/templates/placementWidth";
import { applicationFieldsFor } from "@/lib/templates/applicationMatch";
import { logicRuleCount, placementLogic } from "@/lib/templates/logic";
import { ruleCount } from "@/lib/templates/fieldRules";
import { LogicEditor } from "@/components/app/form-templates/logic-editor";
import { ValidationEditor } from "@/components/app/form-templates/validation-editor";

const CHOICE_TYPES: readonly TemplateFieldType[] = ["single_select", "multi_select"];
type Tab = "field" | "logic" | "validation";

function Row({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {htmlFor ? <label htmlFor={htmlFor} className="text-sm text-[var(--body)]">{label}</label> : <span className="text-sm text-[var(--body)]">{label}</span>}
      {children}
    </div>
  );
}

/**
 * The inspector, the builder's right pane (board A2–A4): the picked question's Field, Logic and
 * Validation. Every edit goes into the form's one draft. On an extra form the question itself belongs
 * to the product, so only where it sits, whether it must be answered and its logic can change.
 */
export function QuestionPanel({ field, fields, form, sectionKey, placement, position, changed, locked, setField, setValidation, setPlacement, setLogic, setPageSkip, onRequired, onAgentsOnly, onReset, onDelete, onDuplicate, onClose, onPickLogic }: {
  field: TemplateField;
  fields: TemplateField[];
  form: TemplateFormDefinition;
  /** The page it was picked on; null when it is kept for agents only. */
  sectionKey: string | null;
  placement: TemplateFormField | null;
  /** "Page 2 · question 1". */
  position: string;
  changed: boolean;
  /** The question's own words and type belong to the product (an extra form). */
  locked: boolean;
  setField: (fieldKey: string, patch: Partial<TemplateField>) => void;
  setValidation: (fieldKey: string, patch: Partial<TemplateValidation>) => void;
  setPlacement: (sectionKey: string, fieldKey: string, patch: Partial<TemplateFormField>) => void;
  setLogic: (sectionKey: string, fieldKey: string, logic: TemplateLogic | null) => void;
  setPageSkip: (sectionKey: string, logic: TemplateLogic | null) => void;
  onRequired: (choice: RequiredChoice) => void;
  /** On: off the form, kept on the lead for agents; off: back onto the open page. */
  onAgentsOnly: (on: boolean) => void;
  onReset: (() => void) | null;
  onDelete: () => void;
  onDuplicate: (() => void) | null;
  onClose: () => void;
  onPickLogic: (fieldKey: string | null, sectionKey: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("field");
  const [technical, setTechnical] = useState(false);
  const key = field.field_key;
  const logic = placement ? placementLogic(placement) : null;
  const lands = applicationFieldsFor(key);
  const choice = requiredChoice(field, placement);
  const full = placementWidth(field, placement) === "full";
  const view: Tab = sectionKey ? tab : tab === "logic" ? "field" : tab;

  function setType(type: TemplateFieldType) {
    setField(key, { type, options: CHOICE_TYPES.includes(type) ? (field.options.length ? field.options : ["First choice", "Second choice"]) : [], validation: {} });
  }
  const setOption = (index: number, value: string) => setField(key, { options: field.options.map((option, at) => (at === index ? value : option)) });

  return (
    <section aria-label={`Change “${field.label || "Untitled question"}”`} className="m-glass flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)]">
      <div className="m-glass-head flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]" title={field.label}>{field.label || "Untitled question"}</strong>
        <span className="shrink-0 text-xs text-[var(--muted)]">{position}</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Close the question" title="Close" onClick={onClose}><X aria-hidden="true" /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
        {/* The inspector's three views: an in-panel switch, not a page's sub-pages. */}
        <div className="mb-3">
          <Segmented
            label="Question settings"
            value={view}
            onChange={setTab}
            options={[
              { key: "field", label: "Field" },
              ...(sectionKey ? [{ key: "logic" as const, label: "Logic", count: logicRuleCount(logic) || null }] : []),
              { key: "validation", label: "Validation", count: ruleCount(field) || null },
            ]}
          />
        </div>
        {changed && <p className="m-0 mb-3 text-xs text-[var(--muted)]">Changed. Not live until you publish.</p>}

        {view === "field" && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Question
              <input className={inputControl} maxLength={120} value={field.label} disabled={locked} onChange={(event) => setField(key, { label: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Help under the question
              <textarea className={cn(inputControl, "h-auto min-h-20 py-2")} maxLength={500} placeholder="None" value={field.help_text ?? ""} disabled={locked} onChange={(event) => setField(key, { help_text: event.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Answer with
              <select className={inputControl} value={field.type} disabled={locked} onChange={(event) => setType(event.target.value as TemplateFieldType)}>
                {TEMPLATE_FIELD_TYPES.map((type) => <option key={type} value={type}>{TEMPLATE_FIELD_PLAIN[type].label} · {TEMPLATE_FIELD_PLAIN[type].hint}</option>)}
              </select>
            </label>
            {CHOICE_TYPES.includes(field.type) && (
              <div className="flex flex-col gap-1.5">
                <span className="text-label text-[var(--body)]">Choices</span>
                {field.options.map((option, index) => (
                  <span key={index} className="flex items-center gap-1">
                    <input aria-label={`Choice ${index + 1}`} className={cn(inputControl, "h-8")} maxLength={120} value={option} disabled={locked} onChange={(event) => setOption(index, event.target.value)} />
                    <Button type="button" variant="ghost" size="icon-xs" disabled={locked} aria-label={`Remove choice ${option || index + 1}`} title="Remove this choice" onClick={() => setField(key, { options: field.options.filter((_, at) => at !== index) })}><X aria-hidden="true" /></Button>
                  </span>
                ))}
                {!locked && <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setField(key, { options: [...field.options, ""] })}><Plus aria-hidden="true" />Add a choice</Button>}
              </div>
            )}
            <Row label="Must be answered" htmlFor="question-required"><Switch id="question-required" checked={choice !== "no"} onChange={(on) => onRequired(on ? (placement ? "form" : "always") : "no")} /></Row>
            {choice !== "no" && placement && (
              <label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Where it must be answered
                <select className={inputControl} value={choice} onChange={(event) => onRequired(event.target.value as RequiredChoice)} disabled={locked && choice === "always"}>
                  <option value="form">On this form</option>
                  <option value="always" disabled={locked}>On every lead, from any source</option>
                </select>
              </label>
            )}
            {sectionKey && placement && (
              <Row label="Width">
                <Segmented label="Width" value={full ? "full" : "half"} onChange={(width) => setPlacement(sectionKey, key, { width })} options={[{ key: "half", label: "Half" }, { key: "full", label: "Full" }]} />
              </Row>
            )}
            <Row label="Only your agents see it" htmlFor="question-agents"><Switch id="question-agents" checked={!sectionKey} onChange={onAgentsOnly} /></Row>
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2.5">
              <span className="text-xs text-[var(--muted)]">Lands on the application as</span>
              <div className="mt-1 flex items-center gap-2">
                <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{lands.length ? lands.join(", ") : "Nothing on the application"}</strong>
                <StatusChip tone={lands.length ? "good" : "warning"}>{lands.length ? "Matched" : "No match"}</StatusChip>
              </div>
              <p className="m-0 mt-1 text-xs text-[var(--muted)]">{lands.length ? "Answers fill these application fields by name." : "It stays on the lead. Map it in Application field sets if a carrier needs it."}</p>
              <button type="button" className="mt-1.5 text-xs font-semibold text-[var(--accent-ink)] underline-offset-4 hover:underline" onClick={() => setTechnical((on) => !on)} aria-expanded={technical}>{technical ? "Hide technical details" : "Show technical details"}</button>
              {technical && (
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ink)]">{key}</code>
                  <Button type="button" variant="ghost" size="xs" onClick={() => void navigator.clipboard?.writeText(key)}>Copy</Button>
                </div>
              )}
            </div>
            <p className="m-0 text-xs text-[var(--muted)]">{questionSentence(field, placement, null)}</p>
          </div>
        )}

        {view === "logic" && sectionKey && placement && (
          <LogicEditor
            field={field}
            fields={fields}
            form={form}
            sectionKey={sectionKey}
            logic={logic}
            onLogic={(next) => setLogic(sectionKey, key, next)}
            onPageSkip={setPageSkip}
            onPick={onPickLogic}
          />
        )}

        {view === "validation" && <ValidationEditor field={field} onValidation={(patch) => setValidation(key, patch)} locked={locked} />}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-4 py-2.5">
        <Button type="button" variant="ghost" size="sm" className="text-[var(--error-ink)]" onClick={onDelete}><Trash2 aria-hidden="true" />{sectionKey ? "Remove" : "Delete"}</Button>
        <span className="flex-1" />
        {onReset && <Button type="button" variant="ghost" size="sm" onClick={onReset}><RotateCcw aria-hidden="true" />Put back</Button>}
        {onDuplicate && <Button type="button" variant="outline" size="sm" onClick={onDuplicate}><Copy aria-hidden="true" />Duplicate</Button>}
      </div>
    </section>
  );
}
