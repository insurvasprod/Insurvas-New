"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/ui/status-chip";
import { inputControl } from "@/components/ui/field";
import { Switch } from "@/components/app/settings/primitives";
import type { TemplateField, TemplateValidation } from "@/lib/templates/constants";
import { BANK_ACCOUNT_MAX_DIGITS, BANK_ACCOUNT_MIN_DIGITS } from "@/lib/templates/formats";
import { checkFieldValue, storedAnswer } from "@/lib/templates/fieldRules";
import { numberOrUndefined } from "@/components/app/form-templates/draft";

/** Character rules in plain words; the stored value stays a regular expression. */
const PATTERNS: ReadonlyArray<{ label: string; pattern: string }> = [
  { label: "Anything", pattern: "" },
  { label: "Letters only", pattern: "^[A-Za-z .'-]*$" },
  { label: "Digits only", pattern: "^[0-9]*$" },
  { label: "Letters and digits", pattern: "^[A-Za-z0-9 ]*$" },
];
const CUSTOM = "__custom__";
const box = cn(inputControl, "h-8 w-24 text-sm");

function Pair({ label, help, low, high, onLow, onHigh, prefix, disabled }: { label: string; help?: ReactNode; low: number | undefined; high: number | undefined; onLow: (value: number | undefined) => void; onHigh: (value: number | undefined) => void; prefix?: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-[var(--body)]">{label}</span>
      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input aria-label={`${label}, lowest`} className={box} type="number" placeholder="No limit" disabled={disabled} value={low ?? ""} onChange={(event) => onLow(numberOrUndefined(event.target.value))} />
        <span className="text-[var(--muted)]">to</span>
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input aria-label={`${label}, highest`} className={box} type="number" placeholder="No limit" disabled={disabled} value={high ?? ""} onChange={(event) => onHigh(numberOrUndefined(event.target.value))} />
      </div>
      {help && <span className="text-xs text-[var(--muted)]">{help}</span>}
    </div>
  );
}

/**
 * Inspector › Validation (board A4): the question's rules in plain words, the message a person reads
 * when one fails, and "Try a value", which checks a typed answer against them without saving.
 */
export function ValidationEditor({ field, onValidation, locked }: { field: TemplateField; onValidation: (patch: Partial<TemplateValidation>) => void; locked: boolean }) {
  const [trial, setTrial] = useState("");
  const v = field.validation ?? {};
  const result = trial.trim() ? checkFieldValue(field, storedAnswer(field, trial)) : null;
  const fixed: Partial<Record<TemplateField["type"], string>> = {
    phone: "Always 10 digits, US numbers.",
    email: "Always an email address, like name@example.com.",
    ssn: "Always 9 digits. Shown masked once saved.",
    bank_routing: "Always nine digits that pass the bank check. Saved as the digits only.",
    bank_account: `Always ${BANK_ACCOUNT_MIN_DIGITS} to ${BANK_ACCOUNT_MAX_DIGITS} digits. Saved as the digits only.`,
    boolean: "Yes or No.",
    single_select: "One of its choices.",
    multi_select: "Any of its choices.",
  };
  return (
    <div className="flex flex-col gap-4">
      {fixed[field.type] && <p className="m-0 text-sm text-[var(--body)]">{fixed[field.type]}</p>}
      {field.type === "currency" && <Pair label="Amount allowed" prefix="$" low={v.min} high={v.max} disabled={locked} onLow={(min) => onValidation({ min })} onHigh={(max) => onValidation({ max })} />}
      {field.type === "number" && <Pair label="Number allowed" low={v.min} high={v.max} disabled={locked} onLow={(min) => onValidation({ min })} onHigh={(max) => onValidation({ max })} />}
      {field.type === "date" && (
        <>
          <Pair label="Age on the day they apply" help="For a date of birth these are the ages in Form settings › Who can apply. Change one, both change." low={v.age_min} high={v.age_max} disabled={locked} onLow={(age_min) => onValidation({ age_min })} onHigh={(age_max) => onValidation({ age_max })} />
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="rule-no-future" className="text-sm text-[var(--body)]">No dates in the future</label>
            <Switch id="rule-no-future" checked={Boolean(v.no_future)} disabled={locked} onChange={(on) => onValidation({ no_future: on || undefined })} />
          </div>
        </>
      )}
      {(field.type === "text" || field.type === "long_text") && (
        <>
          <Pair label="Characters" low={v.min_length} high={v.max_length} disabled={locked} onLow={(min_length) => onValidation({ min_length })} onHigh={(max_length) => onValidation({ max_length })} />
          <label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Allowed
            <select className={inputControl} disabled={locked} value={PATTERNS.find((item) => item.pattern === (v.pattern ?? ""))?.pattern ?? CUSTOM} onChange={(event) => { if (event.target.value !== CUSTOM) onValidation({ pattern: event.target.value || undefined }); }}>
              {PATTERNS.map((item) => <option key={item.label} value={item.pattern}>{item.label}</option>)}
              {!PATTERNS.some((item) => item.pattern === (v.pattern ?? "")) && <option value={CUSTOM}>A custom rule set by Insurvas</option>}
            </select>
          </label>
        </>
      )}
      <label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Message when it fails
        <textarea className={cn(inputControl, "h-auto min-h-16 py-2")} maxLength={300} disabled={locked} placeholder="The usual message" value={v.message ?? ""} onChange={(event) => onValidation({ message: event.target.value || undefined })} />
        <span className="text-xs text-[var(--muted)]">{field.type === "date" ? "{age} is filled in for you. " : ""}Shown in the preview and test submissions; the partner form uses it once it reads these rules.</span>
      </label>
      <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
        <h4 className="m-0 text-sm font-semibold text-[var(--ink)]">Try a value</h4>
        <p className="m-0 text-xs text-[var(--muted)]">Checks the rules above without saving.</p>
        <input aria-label="A value to try" className={inputControl} placeholder={field.type === "date" ? "03/14/1958" : field.type === "currency" ? "15000" : "Type an answer"} value={trial} onChange={(event) => setTrial(event.target.value)} />
        {result && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={result.ok ? "good" : "danger"}>{result.ok ? result.note?.startsWith("Passes") ? result.note : "Passes" : `Fails · ${result.short.replace(/^Fails · /, "")}`}</StatusChip>
            {!result.ok && <span className="text-sm text-[var(--error-ink)]">{result.message}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
