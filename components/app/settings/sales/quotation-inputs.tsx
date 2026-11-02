"use client";

/**
 * Settings › Quotation templates: the editor's two halves (round 1 board B, 2026-10-30).
 *
 * `QuoteInputsEditor` — the inputs the Quote step asks, in order, then the catalogue inputs it does
 * not ask. Each asked input carries the LA-3.4 field facts: the carrier's own wording, whether it
 * blocks Save quote, the note the agent reads under it, its choices, and its place in the order. An
 * agency may add inputs of its own; the Quote step draws them from their type.
 *
 * `QuoteAgentView` — the template drawn with the Quote step's own inputs (RatingInputs), so what the
 * owner sees here is what an agent gets.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Field, control } from "@/components/app/settings/primitives";
import { RatingInputs, type RatingTemplate } from "@/components/app/applications/quotes/rating-inputs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { TIER_LABEL } from "@/lib/applications/constants";
import { US_STATES } from "@/lib/appointments/constants";
import { quotationFieldsOf } from "@/lib/quotes/quotationTemplate";
import { ALWAYS_ASKED_INPUTS, CUSTOM_QUOTE_TYPES, customQuoteKey, type QuoteDraftField } from "@/lib/salesSettings/templateDefinition";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = Object.fromEntries(CUSTOM_QUOTE_TYPES.map((t) => [t.type, t.label]));
const sub = "text-xs leading-[1.5] tracking-[-0.01em] text-[var(--body)]";

/** "Level, Graded" · "12 states" · "3 riders" — what an input offers, in a few words. */
function choicesLine(f: QuoteDraftField) {
  if (f.key === "tier") return f.options.length ? f.options.map((t) => TIER_LABEL[t] ?? t).join(", ") : "Every benefit type the product has";
  if (f.key === "state") return !f.options.length || f.options.length >= US_STATES.length ? "Every state" : `${f.options.length} states`;
  if (f.key === "gender") return "Female, Male";
  if (f.key === "riders" || f.type === "single_select") return f.options.length ? f.options.join(", ") : "No choices yet";
  return null;
}

export function QuoteInputsEditor({ draft, onChange, readOnly }: { draft: QuoteDraftField[]; onChange: (next: QuoteDraftField[]) => void; readOnly: boolean }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<string>("boolean");

  const asked = draft.filter((f) => f.on);
  const notAsked = draft.filter((f) => !f.on);
  const set = (key: string, patch: Partial<QuoteDraftField>) => onChange(draft.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  /** Switched on, an input joins the end of the asked list; switched off, it leaves it. */
  const toggle = (f: QuoteDraftField, on: boolean) => {
    const rest = draft.filter((x) => x.key !== f.key);
    const at = on ? rest.filter((x) => x.on).length : rest.length;
    onChange([...rest.slice(0, at), { ...f, on }, ...rest.slice(at)]);
    if (!on && openKey === f.key) setOpenKey(null);
  };
  const move = (key: string, by: -1 | 1) => {
    const i = draft.findIndex((f) => f.key === key);
    const j = i + by;
    if (j < 0 || j >= asked.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (key: string) => { onChange(draft.filter((f) => f.key !== key)); setOpenKey(null); };
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = customQuoteKey(label, draft.map((f) => f.key));
    const f: QuoteDraftField = { key, title: label, label, type: newType, options: [], required: false, help: "", on: true, custom: true };
    const at = asked.length;
    onChange([...draft.slice(0, at), f, ...draft.slice(at)]);
    setNewLabel("");
    setOpenKey(newType === "single_select" ? key : null);
  };

  const row = (f: QuoteDraftField, index: number) => {
    const always = ALWAYS_ASKED_INPUTS.includes(f.key);
    const open = openKey === f.key && f.on;
    const choices = choicesLine(f);
    const facts = [
      f.custom ? `Your own · ${TYPE_LABEL[f.type] ?? f.type}` : f.title !== f.label ? f.title : null,
      always ? "Always asked — a quote can't be saved without it" : null,
      f.on ? choices : null,
      f.on && f.help.trim() ? `Note: “${f.help.trim()}”` : null,
    ].filter(Boolean).join(" · ");
    return (
      <li key={f.key} className="rounded-[12px] border border-[var(--border)] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Switch checked={f.on} disabled={readOnly || always} onChange={(next) => toggle(f, next)} label={`Ask ${f.label}`} />
          <span className="min-w-0 flex-1 basis-48">
            <span className={cn("block text-sm leading-[1.5] font-semibold tracking-[-0.02em]", f.on ? "text-[var(--ink)]" : "text-[var(--body)]")}>{f.label}</span>
            {facts && <span className={cn("block", sub)}>{facts}</span>}
          </span>
          {f.on && (
            <span className="flex items-center gap-1.5">
              <ToggleChip selected={always || f.required} disabled={readOnly || always} onClick={() => set(f.key, { required: !f.required })}>Required</ToggleChip>
              <Button type="button" variant="ghost" size="icon" className="size-8" disabled={readOnly || index === 0} onClick={() => move(f.key, -1)} aria-label={`Move ${f.label} up`}><ArrowUp aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-8" disabled={readOnly || index === asked.length - 1} onClick={() => move(f.key, 1)} aria-label={`Move ${f.label} down`}><ArrowDown aria-hidden="true" /></Button>
              <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpenKey(open ? null : f.key)}>{open ? "Done" : readOnly ? "Details" : "Edit"}</Button>
            </span>
          )}
        </div>
        {open && (
          <div className="m-stagger">
            <InputDetails f={f} readOnly={readOnly} onChange={(patch) => set(f.key, patch)} onRemove={f.custom ? () => remove(f.key) : undefined} />
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="qt-asked" className="flex flex-col gap-2">
        <h4 id="qt-asked" className="m-0 text-label text-[var(--ink)]">Asked on the Quote step, in this order</h4>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">{asked.map(row)}</ol>
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-2 rounded-[12px] border border-dashed border-[var(--border-strong)] px-3 py-2.5">
            <Field label="Add your own input" htmlFor="qt-new-label" className="min-w-0 flex-1 basis-56">
              <input id="qt-new-label" className={control} value={newLabel} maxLength={300} placeholder="e.g. Height and weight" onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
            </Field>
            <Field label="Answer" htmlFor="qt-new-type" className="w-40">
              <select id="qt-new-type" className={control} value={newType} onChange={(e) => setNewType(e.target.value)}>
                {CUSTOM_QUOTE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </Field>
            <Button type="button" variant="outline" disabled={!newLabel.trim()} onClick={add}><Plus aria-hidden="true" />Add input</Button>
          </div>
        )}
      </section>

      {notAsked.length > 0 && (
        <section aria-labelledby="qt-not-asked" className="flex flex-col gap-2">
          <h4 id="qt-not-asked" className="m-0 text-label text-[var(--ink)]">Not asked</h4>
          <p className={cn("m-0", sub)}>Switch one on and it joins the end of the list above. Inputs that are off are not asked and not stored.</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{notAsked.map((f) => row(f, -1))}</ul>
        </section>
      )}
    </div>
  );
}

/** The opened input: its wording, the note under it, its choices — and, for the agency's own, its type. */
function InputDetails({ f, readOnly, onChange, onRemove }: { f: QuoteDraftField; readOnly: boolean; onChange: (patch: Partial<QuoteDraftField>) => void; onRemove?: () => void }) {
  const id = `qt-${f.key}`;
  const pick = (value: string) => onChange({ options: f.options.includes(value) ? f.options.filter((o) => o !== value) : [...f.options, value] });
  return (
    <div className="mt-3 grid gap-4 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
      <Field label="What the agent reads" htmlFor={`${id}-label`} hint="Use the carrier's own words when they differ.">
        <input id={`${id}-label`} className={control} value={f.label} maxLength={300} disabled={readOnly} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Field label="Note under it" htmlFor={`${id}-help`} hint="Shown to the agent on the Quote step.">
        <input id={`${id}-help`} className={control} value={f.help} maxLength={500} disabled={readOnly} placeholder="e.g. This carrier counts cigars as tobacco" onChange={(e) => onChange({ help: e.target.value })} />
      </Field>

      {f.custom && (
        <Field label="Answer" htmlFor={`${id}-type`}>
          <select id={`${id}-type`} className={control} value={f.type} disabled={readOnly} onChange={(e) => onChange({ type: e.target.value, options: e.target.value === "single_select" ? f.options : [] })}>
            {CUSTOM_QUOTE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </Field>
      )}

      {f.key === "tier" && (
        <Choices label="Benefit types offered" hint="The Quote step offers these where the product has them. None picked offers all of the product's.">
          {Object.entries(TIER_LABEL).map(([code, name]) => <ToggleChip key={code} selected={f.options.includes(code)} disabled={readOnly} onClick={() => pick(code)}>{name}</ToggleChip>)}
        </Choices>
      )}
      {f.key === "state" && (
        <Choices label="States offered" hint="None picked offers every state." action={!readOnly && (
          <span className="flex gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ options: US_STATES.map(([code]) => code) })}>All</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ options: [] })}>None</Button>
          </span>
        )}>
          {US_STATES.map(([code, name]) => <ToggleChip key={code} selected={f.options.includes(code)} disabled={readOnly} onClick={() => pick(code)}><span title={name}>{code}</span></ToggleChip>)}
        </Choices>
      )}
      {(f.key === "riders" || (f.custom && f.type === "single_select")) && (
        <OptionList label={f.key === "riders" ? "Riders offered" : "Choices"} hint={f.key === "riders" ? "Used when the product lists no riders of its own." : "The agent picks one."} options={f.options} readOnly={readOnly} onChange={(options) => onChange({ options })} id={id} />
      )}
      {f.key === "gender" && <p className={cn("m-0 self-end sm:col-span-2", sub)}>Female and Male — the carrier&apos;s rate cards use these two.</p>}

      {onRemove && !readOnly && (
        <div className="sm:col-span-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 text-[var(--error-ink)]" onClick={onRemove}><Trash2 aria-hidden="true" />Remove this input</Button>
        </div>
      )}
    </div>
  );
}

function Choices({ label, hint, action, children }: { label: string; hint: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
      <span className="flex items-center justify-between gap-2"><span className="text-label text-[var(--body)]">{label}</span>{action}</span>
      <span className="flex flex-wrap gap-1.5">{children}</span>
      <span className={sub}>{hint}</span>
    </div>
  );
}

/** A list of typed choices: each a removable chip, a new one typed and added. */
function OptionList({ id, label, hint, options, readOnly, onChange }: { id: string; label: string; hint: string; options: string[]; readOnly: boolean; onChange: (next: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v || options.includes(v)) return;
    onChange([...options, v]);
    setText("");
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
      <label htmlFor={`${id}-opt`} className="text-label text-[var(--body)]">{label}</label>
      {options.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {options.map((o) => <ToggleChip key={o} selected onRemove={readOnly ? undefined : () => onChange(options.filter((x) => x !== o))} disabled={readOnly}>{o}</ToggleChip>)}
        </span>
      )}
      {!readOnly && (
        <span className="flex gap-2">
          <input id={`${id}-opt`} className={cn(control, "mt-0 min-w-0 flex-1")} value={text} maxLength={120} placeholder="Type a choice" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Button type="button" variant="outline" disabled={!text.trim()} onClick={add}>Add</Button>
        </span>
      )}
      <span className={sub}>{hint}</span>
    </div>
  );
}

const EMPTY: RatingTemplate = { dob: "", gender: "", state: "", tobacco: "", faceText: "", tier: "", riders: [], extra: {} };

/** The template as the Quote step draws it, with the Quote step's own inputs. Nothing typed here is kept. */
export function QuoteAgentView({ definition, ageBasis, validDays }: { definition: unknown; ageBasis: "nearest" | "last"; validDays: number }) {
  const [value, setValue] = useState<RatingTemplate>(EMPTY);
  const fields = quotationFieldsOf(definition);
  return (
    <div className="flex flex-col gap-4">
      <p className={cn("m-0", sub)}>Try it: this is the Quote step&apos;s first part, as an agent sees it with this version. Nothing you type here is saved.</p>
      {/* One column: it sits in a narrow side card, and a flex column ignores the riders field's col-span. */}
      <div className="flex flex-col gap-4">
        <RatingInputs
          fields={fields}
          value={value}
          onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
          onExtra={(key, next) => setValue((v) => ({ ...v, extra: { ...v.extra, [key]: next } }))}
          prefill={() => undefined}
          prefillExtra={() => undefined}
          product={undefined}
          ageBasis={ageBasis}
          readOnly={false}
        />
      </div>
      <p className={cn("m-0", sub)}>
        The agent then picks the carrier and types the premium from the carrier&apos;s own quote tool. A quote stands {validDays} days, then it is shown struck through on the case.
      </p>
    </div>
  );
}
