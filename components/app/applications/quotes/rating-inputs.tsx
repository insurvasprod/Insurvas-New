"use client";

/**
 * The quotation template's fields (LA-3.4; board l3-ws-quote, first card): exactly the fields the
 * published template lists, in its order. Values the lead or the interview already gave are
 * prefilled, drawn warm and marked with where they came from until the agent types over them; the
 * age beside the date of birth is the age this quote rates on (nearest or last birthday). A field
 * the form does not know by name still renders, from its type, and is frozen with the quote.
 */

import { Field, control } from "@/components/app/settings/primitives";
import { TIER_LABEL } from "@/lib/applications/constants";
import type { FieldValue } from "@/lib/applications/types";
import { US_STATES } from "@/lib/appointments/constants";
import { ratingAge } from "@/lib/quotes/math";
import { cn } from "@/lib/utils";

import { PREFILL_SURFACE, PrefillHint } from "@/components/app/applications/workspace/steps/step-bits";
import type { AgeBasis, CarrierProduct, QuotationField } from "./catalogue";

export type RatingTemplate = {
  dob: string;
  gender: "" | "female" | "male";
  state: string;
  tobacco: "" | "yes" | "no";
  faceText: string;
  /** A benefit type (level, graded, …). */
  tier: string;
  riders: string[];
  /** Any other field the template asks for, by its key. */
  extra: Record<string, string>;
};

export type RatingField = "dob" | "gender" | "state" | "tobacco" | "face" | "tier";

/** Where a prefilled rating input came from: a stored application value (confirmable) or an interview answer. */
export type RatingPrefill = { fv: FieldValue; confirmable: boolean };

/** The canonical application field each prefilled rating input comes from. */
export const RATING_SOURCE_KEY: Record<RatingField, string> = {
  dob: "insured.dob", gender: "insured.gender", state: "addr.state", tobacco: "insured.tobacco", face: "cov.face_amount", tier: "cov.product_tier",
};

/** The template key → the input it drives. */
const KNOWN: Record<string, RatingField | "riders"> = { dob: "dob", gender: "gender", state: "state", tobacco: "tobacco", face_amount: "face", tier: "tier", riders: "riders" };

export const AGE_BASIS_SHORT: Record<AgeBasis, string> = { nearest: "nearest birthday", last: "last birthday" };

export function RatingInputs({ fields, value, onChange, onExtra, prefill, prefillExtra, product, ageBasis, readOnly }: {
  fields: QuotationField[];
  value: RatingTemplate;
  onChange: (patch: Partial<RatingTemplate>, field?: RatingField) => void;
  /** A field the form has no special input for, by its template key. */
  onExtra: (key: string, value: string) => void;
  /** The carried-in value behind a field, while the agent has not typed over it. */
  prefill: (field: RatingField) => RatingPrefill | undefined;
  prefillExtra: (key: string) => RatingPrefill | undefined;
  product: CarrierProduct | undefined;
  ageBasis: AgeBasis;
  readOnly: boolean;
}) {
  const age = value.dob ? ratingAge(value.dob, ageBasis) : null;

  const warm = (field: RatingField) => (prefill(field) ? PREFILL_SURFACE : "");
  const hint = (field: RatingField, extra?: string) => {
    const p = prefill(field);
    return <PrefillHint fv={p?.fv} confirmable={p?.confirmable} fieldKey={RATING_SOURCE_KEY[field]} readOnly={readOnly} extra={extra} />;
  };

  return (
    <>
      {fields.map((f) => {
        const known = KNOWN[f.key];
        const id = `rate.${f.key}`;
        switch (known) {
          case "dob":
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required}>
                <div className="mt-1.5 flex items-center gap-2">
                  <input id={id} type="date" className={cn(control, "mt-0 min-w-0 flex-1", warm("dob"))} value={value.dob} disabled={readOnly} onChange={(e) => onChange({ dob: e.target.value }, "dob")} />
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--ink)]" aria-live="polite">{age !== null ? `Age ${age}` : "Age —"}</span>
                </div>
                {hint("dob", `age ${AGE_BASIS_SHORT[ageBasis]}`)}
              </Field>
            );
          case "gender":
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required}>
                <select id={id} className={cn(control, warm("gender"))} value={value.gender} disabled={readOnly} onChange={(e) => onChange({ gender: e.target.value as RatingTemplate["gender"] }, "gender")}>
                  <option value="">Choose</option>
                  {(f.options.length ? f.options : ["Female", "Male"]).map((o) => <option key={o} value={o.toLowerCase()}>{o}</option>)}
                </select>
                {hint("gender")}
              </Field>
            );
          case "state":
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required}>
                <select id={id} className={cn(control, warm("state"))} value={value.state} disabled={readOnly} onChange={(e) => onChange({ state: e.target.value }, "state")}>
                  <option value="">Choose</option>
                  {US_STATES.filter(([code]) => !f.options.length || f.options.includes(code)).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
                {hint("state")}
              </Field>
            );
          case "tobacco":
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required}>
                <select id={id} className={cn(control, warm("tobacco"))} value={value.tobacco} disabled={readOnly} onChange={(e) => onChange({ tobacco: e.target.value as RatingTemplate["tobacco"] }, "tobacco")}>
                  <option value="">Choose</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
                {hint("tobacco")}
              </Field>
            );
          case "face":
            // `cov.face_amount` is the id QA's face-limit items land on.
            return (
              <Field key={f.key} label={f.label} htmlFor="cov.face_amount" required={f.required}>
                <input id="cov.face_amount" inputMode="decimal" autoComplete="off" placeholder="15,000" className={cn(control, "tabular-nums", warm("face"))} value={value.faceText} disabled={readOnly} onChange={(e) => onChange({ faceText: e.target.value }, "face")} />
                {hint("face")}
              </Field>
            );
          case "tier": {
            const allowed = (f.options.length ? f.options : Object.keys(TIER_LABEL)).filter((t) => !product?.tiers.length || product.tiers.includes(t));
            const options = allowed.length ? allowed : product?.tiers ?? [];
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required}>
                <select id={id} className={cn(control, warm("tier"))} value={options.includes(value.tier) ? value.tier : options[0] ?? ""} disabled={readOnly} onChange={(e) => onChange({ tier: e.target.value }, "tier")}>
                  {options.map((t) => <option key={t} value={t}>{TIER_LABEL[t] ?? t}</option>)}
                </select>
                {hint("tier")}
              </Field>
            );
          }
          case "riders": {
            const options = product?.riders.length ? product.riders : f.options;
            return (
              <fieldset key={f.key} className="min-w-0 sm:col-span-2 lg:col-span-3">
                <legend className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">{f.label}</legend>
                {options.length === 0 ? (
                  <p className="mt-1.5 flex h-9 items-center text-sm text-muted-foreground">None on this product</p>
                ) : (
                  <div className="mt-1.5 flex min-h-9 flex-wrap items-center gap-x-5 gap-y-1">
                    {options.map((r) => {
                      const rid = `rate.rider.${r.toLowerCase().replace(/\W+/g, "_")}`;
                      return (
                        <label key={r} htmlFor={rid} className="inline-flex items-center gap-2 text-sm">
                          <input id={rid} type="checkbox" className="size-4 accent-[var(--primary)]" checked={value.riders.includes(r)} disabled={readOnly} onChange={(e) => onChange({ riders: e.target.checked ? [...value.riders, r] : value.riders.filter((x) => x !== r) })} />
                          {r}
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            );
          }
          default: {
            // A field this form has no special input for: drawn from its type, frozen with the quote as typed.
            const v = value.extra[f.key] ?? "";
            const set = (next: string) => onExtra(f.key, next);
            const p = prefillExtra(f.key);
            const cls = cn(control, p && PREFILL_SURFACE);
            let input;
            if (f.type === "boolean") {
              input = <select id={id} className={cls} value={v} disabled={readOnly} onChange={(e) => set(e.target.value)}><option value="">Choose</option><option value="yes">Yes</option><option value="no">No</option></select>;
            } else if (f.type === "single_select" && f.options.length) {
              input = <select id={id} className={cls} value={v} disabled={readOnly} onChange={(e) => set(e.target.value)}><option value="">Choose</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
            } else {
              input = <input id={id} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" || f.type === "currency" ? "decimal" : undefined} className={cls} value={v} disabled={readOnly} onChange={(e) => set(e.target.value)} />;
            }
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required}>
                {input}
                <PrefillHint fv={p?.fv} confirmable={false} fieldKey={id} readOnly />
              </Field>
            );
          }
        }
      })}
    </>
  );
}
