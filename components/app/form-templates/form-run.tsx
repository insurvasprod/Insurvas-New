"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { checkboxControl, control, textareaControl } from "@/components/app/settings/primitives";
import type { TemplateField, TemplateFormDefinition, TemplateFormField } from "@/lib/templates/constants";
import { effectiveTemplateForm } from "@/lib/templates/sectionAvailability";
import { pruneHiddenTemplateValues, templateFormFieldVisible } from "@/lib/templates/visibility";
import { logicHolds, logicSentence, placementLogic } from "@/lib/templates/logic";
import { checkFieldValue } from "@/lib/templates/fieldRules";
import { placementWidth } from "@/lib/templates/placementWidth";

/** The pages a person walks through for these answers: skipped pages left out. */
export function walkedPages(form: TemplateFormDefinition, values: Record<string, unknown>) {
  return form.sections.filter((section) => !(section.skip_when && section.skip_when.rules.length && logicHolds(section.skip_when, values)));
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

/** One answer box, as a person filling the form gets it. */
function Answer({ id, field, value, onChange, invalid }: { id: string; field: TemplateField; value: unknown; onChange: (value: unknown) => void; invalid: boolean }) {
  const common = { id, "aria-invalid": invalid || undefined } as const;
  switch (field.type) {
    case "long_text":
      return <textarea {...common} className={textareaControl} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
    case "number":
    case "currency":
      return <input {...common} className={control} type="number" inputMode="decimal" value={typeof value === "number" ? value : ""} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} />;
    case "date":
      return <input {...common} className={control} type="date" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
    case "boolean":
      return (
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="mt-1.5 grid grid-cols-2 gap-2">
          {[{ v: "true", label: "Yes" }, { v: "false", label: "No" }].map((option) => (
            <ToggleChip key={option.v} role="radio" selected={String(value ?? "") === option.v} onClick={() => onChange(option.v)} className="justify-center">{option.label}</ToggleChip>
          ))}
        </div>
      );
    case "single_select":
      return (
        <select {...common} className={control} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          <option value="" disabled>Choose…</option>
          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    case "multi_select": {
      const picked = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-labelledby={`${id}-label`} className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-[var(--body)]">
              <input type="checkbox" className={checkboxControl} checked={picked.includes(option)} onChange={(event) => onChange(event.target.checked ? [...picked, option] : picked.filter((item) => item !== option))} />
              {option}
            </label>
          ))}
        </div>
      );
    }
    default:
      return <input {...common} className={control} type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  }
}

/**
 * The draft as a person fills it (board A5): one page at a time, progress, Back / Next, the logic
 * running on every answer, and each question's rules checked on Next. Nothing is saved from here.
 */
export function FormRun({ fields, form, title, mode, values, onValues, onSend, sendLabel = "Send" }: {
  fields: TemplateField[];
  form: TemplateFormDefinition;
  title: string;
  mode: "computer" | "phone";
  values: Record<string, unknown>;
  onValues: (values: Record<string, unknown>) => void;
  /** The last page's button; without it the last page says the form is done. */
  onSend?: (values: Record<string, unknown>) => void;
  sendLabel?: string;
}) {
  const effective = useMemo(() => effectiveTemplateForm(form, fields), [form, fields]);
  const byKey = useMemo(() => new Map(fields.map((field) => [field.field_key, field])), [fields]);
  const labelOf = (key: string) => byKey.get(key)?.label ?? key;
  const pages = walkedPages(effective, values);
  const [at, setAt] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const index = Math.min(at, Math.max(0, pages.length - 1));
  const page = pages[index];
  const shown = (placed: TemplateFormField) => byKey.has(placed.field_key) && templateFormFieldVisible(placed, values);

  function change(key: string, value: unknown) {
    onValues(pruneHiddenTemplateValues(effective, { ...values, [key]: value }));
    setErrors((current) => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; });
  }
  function check(): boolean {
    if (!page) return true;
    const next: Record<string, string> = {};
    for (const placed of page.fields) {
      const field = byKey.get(placed.field_key);
      if (!field || !shown(placed)) continue;
      const value = values[placed.field_key];
      if (isEmpty(value)) { if (field.is_required || placed.is_required) next[placed.field_key] = `${field.label} must be answered.`; continue; }
      const result = checkFieldValue(field, value);
      if (!result.ok) next[placed.field_key] = result.message;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  if (!page) return <p className="m-0 text-sm text-[var(--body)]">This form has no pages yet.</p>;
  const last = index === pages.length - 1;
  const progress = Math.round(((index + 1) / pages.length) * 100);
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", mode === "phone" && "gap-2.5")}>
      {mode === "computer" ? (
        <div className="flex items-baseline justify-between gap-3">
          <strong className="text-base font-semibold text-[var(--ink)]">{title}</strong>
          <span className="text-xs text-[var(--muted)] tabular-nums">Page {index + 1} of {pages.length}</span>
        </div>
      ) : <span className="text-xs text-[var(--muted)] tabular-nums">Page {index + 1} of {pages.length}</span>}
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]" role="progressbar" aria-label="How far through the form" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span className="block h-full rounded-full bg-[var(--primary)] transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <strong className="text-base font-semibold text-[var(--ink)]">{page.label}</strong>
      <div className={cn("grid gap-3", mode === "computer" && "sm:grid-cols-2")}>
        {page.fields.filter(shown).map((placed) => {
          const field = byKey.get(placed.field_key)!;
          const id = `run-${mode}-${field.field_key}`;
          const logic = placementLogic(placed);
          const full = mode === "phone" || placementWidth(field, placed) === "full";
          return (
            <div key={placed.field_key} className={cn("min-w-0", full && "sm:col-span-2")}>
              <label id={`${id}-label`} htmlFor={field.type === "boolean" || field.type === "multi_select" ? undefined : id} className="text-label text-[var(--ink)]">
                {field.label}{(field.is_required || placed.is_required) && <span className="text-[var(--error-ink)]"> *</span>}
              </label>
              <Answer id={id} field={field} value={values[field.field_key]} onChange={(value) => change(field.field_key, value)} invalid={Boolean(errors[field.field_key])} />
              {errors[field.field_key] ? (
                <span role="alert" className="mt-1.5 block text-xs text-[var(--error-ink)]">{errors[field.field_key]}</span>
              ) : field.help_text ? (
                <span className="mt-1.5 block text-xs text-[var(--muted)]">{field.help_text}</span>
              ) : logic && mode === "computer" ? (
                <span className="mt-1.5 block text-xs text-[var(--muted)]">Shown because {logicSentence(logic, labelOf)}.</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className={cn("flex items-center gap-2 pt-1", mode === "phone" && "flex-col-reverse items-stretch")}>
        {index > 0 && <Button type="button" variant="outline" onClick={() => { setErrors({}); setAt(index - 1); }}>Back</Button>}
        <span className="flex-1" />
        {!last && <Button type="button" onClick={() => { if (check()) setAt(index + 1); }}>{mode === "computer" ? `Next · ${pages[index + 1].label}` : "Next"}</Button>}
        {last && onSend && <Button type="button" onClick={() => { if (check()) onSend(values); }}>{sendLabel}</Button>}
        {last && !onSend && <span className="text-sm text-[var(--muted)]">Last page</span>}
      </div>
    </div>
  );
}
