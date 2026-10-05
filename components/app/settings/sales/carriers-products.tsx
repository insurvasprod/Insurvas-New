"use client";

/**
 * LA-3.6 / 3.25 · one carrier's products in Settings › Sales › Carriers and products: tiers, issue ages,
 * face limits, the per-$1,000 plausibility band the quote check reads, accepted payment methods, and —
 * for a term life product — term lengths, health classes and the exam threshold. A platform product
 * is read-only until it is copied to the agency; the copy replaces it for this agency only.
 */

import { Field, Pill, ToggleRow, control } from "@/components/app/settings/primitives";
import { FE_TIERS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, TIER_LABEL, type PaymentMethod } from "@/lib/applications/constants";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { updateProductSchema, type ProductBody } from "@/lib/salesSettings/carrierSchemas";
import type { CarrierProductView, ProductLine } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { CopyToAgencyButton, checkbox } from "./shared";

export type ProductDraft = {
  key: string;
  id: string | null;
  tenantOwned: boolean;
  productCode: string;
  name: string;
  tiers: string[];
  ageMin: string;
  ageMax: string;
  faceMin: string;
  faceMax: string;
  bandMin: string;
  bandMax: string;
  methods: PaymentMethod[];
  isActive: boolean;
  termLengths: string;
  healthClasses: string;
  examAbove: string;
  convertible: boolean;
  conversionRule: string;
  renewalType: "" | "annual_renewable" | "level";
};

const dollars = (cents: number | null) => (cents === null ? "" : formatCents(cents).replace(/\.00$/, ""));

export function draftOfProduct(p: CarrierProductView): ProductDraft {
  return {
    key: p.id, id: p.id, tenantOwned: p.tenantOwned, productCode: p.productCode, name: p.name, tiers: p.tiers,
    ageMin: p.issueAgeMin === null ? "" : String(p.issueAgeMin), ageMax: p.issueAgeMax === null ? "" : String(p.issueAgeMax),
    faceMin: dollars(p.faceMinCents), faceMax: dollars(p.faceMaxCents), bandMin: p.bandMin ?? "", bandMax: p.bandMax ?? "",
    methods: p.acceptedPaymentMethods, isActive: p.isActive, termLengths: (p.termLengths ?? []).join(", "), healthClasses: (p.healthClasses ?? []).join(", "),
    examAbove: dollars(p.examAboveFaceCents), convertible: Boolean(p.convertible), conversionRule: p.conversionDeadlineRule ?? "", renewalType: p.renewalType ?? "",
  };
}

export function newProductDraft(productCode: string): ProductDraft {
  return {
    key: `new-${Date.now()}`, id: null, tenantOwned: true, productCode, name: "", tiers: productCode === "term_life" ? [] : ["level"], ageMin: "", ageMax: "", faceMin: "", faceMax: "",
    bandMin: "", bandMax: "", methods: ["ach"], isActive: true, termLengths: productCode === "term_life" ? "10, 20, 30" : "", healthClasses: productCode === "term_life" ? "Preferred plus, Preferred, Standard plus, Standard" : "",
    examAbove: "", convertible: false, conversionRule: "", renewalType: "",
  };
}

/** The draft as the route's body, or the first thing wrong with it (in words). */
export function productBody(d: ProductDraft): { body: ProductBody | null; error: string | null } {
  const int = (s: string) => (s.trim() === "" ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const cents = (s: string) => (s.trim() === "" ? null : parseDollarsToCents(s) ?? NaN);
  const term = d.productCode === "term_life";
  const raw = {
    product_code: d.productCode, name: d.name, tiers: term ? [] : d.tiers, issue_age_min: int(d.ageMin), issue_age_max: int(d.ageMax),
    face_min_cents: cents(d.faceMin), face_max_cents: cents(d.faceMax), band_min: d.bandMin.trim() || null, band_max: d.bandMax.trim() || null,
    accepted_payment_methods: d.methods, is_active: d.isActive,
    term_lengths: term ? d.termLengths.split(",").map((x) => x.trim()).filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : NaN)) : null,
    health_classes: term ? d.healthClasses.split(",").map((x) => x.trim()).filter(Boolean) : null,
    exam_required_above_face_cents: term ? cents(d.examAbove) : null,
    convertible: term ? d.convertible : null,
    conversion_deadline_rule: term ? d.conversionRule.trim() || null : null,
    renewal_type: term ? d.renewalType || null : null,
  };
  if ([raw.issue_age_min, raw.issue_age_max].some((v) => Number.isNaN(v))) return { body: null, error: `${d.name || "A product"}: issue ages are whole years.` };
  if ([raw.face_min_cents, raw.face_max_cents, raw.exam_required_above_face_cents].some((v) => Number.isNaN(v))) return { body: null, error: `${d.name || "A product"}: write face amounts in dollars, like 25000.` };
  if (raw.term_lengths?.some((v) => Number.isNaN(v))) return { body: null, error: `${d.name || "A product"}: term lengths are whole years, like 10, 20, 30.` };
  const parsed = updateProductSchema.safeParse(raw);
  if (!parsed.success) return { body: null, error: `${d.name || "A product"}: ${parsed.error.issues[0]?.message ?? "check the values"}.` };
  return { body: parsed.data, error: null };
}

const pair = "mt-1.5 flex items-center gap-2";
const pairInput = cn(control, "mt-0 tabular-nums");

export function ProductEditor({
  draft,
  productLines,
  readOnly,
  onChange,
  onCopy,
  canCopy,
}: {
  draft: ProductDraft;
  productLines: ProductLine[];
  readOnly: boolean;
  onChange: (patch: Partial<ProductDraft>) => void;
  onCopy: () => void;
  canCopy: boolean;
}) {
  const ro = readOnly || !draft.tenantOwned;
  const id = (part: string) => `prod-${draft.key}-${part}`;
  const term = draft.productCode === "term_life";
  const toggle = <T extends string>(list: T[], value: T, on: boolean, order: readonly T[]) => (on ? order.filter((x) => x === value || list.includes(x)) : list.filter((x) => x !== value));

  return (
    <div className="min-w-0 border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] leading-[1.5] font-semibold text-[var(--ink)]">{draft.name || "New product"}</span>
          {!draft.tenantOwned && <Pill tone="neutral">Platform default</Pill>}
          {!draft.isActive && <Pill tone="neutral">Not offered</Pill>}
        </span>
        {!draft.tenantOwned && (
          <CopyToAgencyButton label={draft.name} onClick={onCopy} disabled={!canCopy} reason="Only an owner can copy a product." />
        )}
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Product name" htmlFor={id("name")} required>
          <input id={id("name")} className={control} value={draft.name} disabled={ro} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Product line" htmlFor={id("line")} hint={draft.id ? undefined : "Term life asks for term lengths and health classes instead of tiers."}>
          <select id={id("line")} className={control} value={draft.productCode} disabled={ro || Boolean(draft.id)} onChange={(e) => onChange({ productCode: e.target.value })}>
            {productLines.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Issue ages" htmlFor={id("age-min")}>
          <div className={pair}>
            <input id={id("age-min")} inputMode="numeric" className={pairInput} value={draft.ageMin} disabled={ro} onChange={(e) => onChange({ ageMin: e.target.value })} />
            <span className="text-[14px] text-[var(--muted)]">to</span>
            <input aria-label={`${draft.name || "Product"} oldest issue age`} inputMode="numeric" className={pairInput} value={draft.ageMax} disabled={ro} onChange={(e) => onChange({ ageMax: e.target.value })} />
          </div>
        </Field>
        <Field label="Face amount ($)" htmlFor={id("face-min")}>
          <div className={pair}>
            <input id={id("face-min")} inputMode="decimal" className={pairInput} value={draft.faceMin} disabled={ro} onChange={(e) => onChange({ faceMin: e.target.value })} />
            <span className="text-[14px] text-[var(--muted)]">to</span>
            <input aria-label={`${draft.name || "Product"} largest face amount`} inputMode="decimal" className={pairInput} value={draft.faceMax} disabled={ro} onChange={(e) => onChange({ faceMax: e.target.value })} />
          </div>
        </Field>
        <Field label="Plausible $ per $1,000" htmlFor={id("band-min")} hint="A monthly premium outside this band gets an amber check-the-quote warning and still saves.">
          <div className={pair}>
            <input id={id("band-min")} inputMode="decimal" className={pairInput} value={draft.bandMin} disabled={ro} onChange={(e) => onChange({ bandMin: e.target.value })} />
            <span className="text-[14px] text-[var(--muted)]">to</span>
            <input aria-label={`${draft.name || "Product"} highest plausible premium per $1,000`} inputMode="decimal" className={pairInput} value={draft.bandMax} disabled={ro} onChange={(e) => onChange({ bandMax: e.target.value })} />
          </div>
        </Field>
        {term && (
          <>
            <Field label="Term lengths (years)" htmlFor={id("terms")} hint="Comma-separated, like 10, 20, 30.">
              <input id={id("terms")} className={control} value={draft.termLengths} disabled={ro} onChange={(e) => onChange({ termLengths: e.target.value })} />
            </Field>
            <Field label="Health classes" htmlFor={id("classes")} hint="Comma-separated, best first.">
              <input id={id("classes")} className={control} value={draft.healthClasses} disabled={ro} onChange={(e) => onChange({ healthClasses: e.target.value })} />
            </Field>
            <Field label="Exam required above ($)" htmlFor={id("exam")} hint="A face amount above this needs a paramed exam.">
              <input id={id("exam")} inputMode="decimal" className={control} value={draft.examAbove} disabled={ro} onChange={(e) => onChange({ examAbove: e.target.value })} />
            </Field>
            <Field label="Renewal" htmlFor={id("renewal")}>
              <select id={id("renewal")} className={control} value={draft.renewalType} disabled={ro} onChange={(e) => onChange({ renewalType: e.target.value as ProductDraft["renewalType"] })}>
                <option value="">Not recorded</option>
                <option value="level">Level</option>
                <option value="annual_renewable">Annual renewable</option>
              </select>
            </Field>
            <Field label="Conversion deadline" htmlFor={id("conversion")} hint="As the carrier words it, like “before age 70 or the end of year 10”.">
              <input id={id("conversion")} className={control} value={draft.conversionRule} disabled={ro || !draft.convertible} onChange={(e) => onChange({ conversionRule: e.target.value })} />
            </Field>
          </>
        )}
      </div>

      {term && (
        <div className="mt-4 max-w-md">
          <ToggleRow id={id("convertible")} title="Convertible" help="The client can convert to permanent coverage without new underwriting." checked={draft.convertible} disabled={ro} onChange={(on) => onChange({ convertible: on })} />
        </div>
      )}

      {!term && (
        <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
          <legend className="p-0 text-[14px] leading-[1.5] font-semibold text-[var(--body)]">Tiers</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
            {FE_TIERS.map((tier) => (
              <label key={tier} htmlFor={id(`tier-${tier}`)} className="inline-flex items-center gap-2 text-[14px] text-[var(--body)]">
                <input id={id(`tier-${tier}`)} type="checkbox" className={checkbox} checked={draft.tiers.includes(tier)} disabled={ro} onChange={(e) => onChange({ tiers: toggle(draft.tiers, tier, e.target.checked, FE_TIERS as readonly string[]) })} />
                {TIER_LABEL[tier]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
        <legend className="p-0 text-[14px] leading-[1.5] font-semibold text-[var(--body)]">Accepted payment methods</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
          {PAYMENT_METHODS.map((method) => (
            <label key={method} htmlFor={id(`pm-${method}`)} className="inline-flex items-center gap-2 text-[14px] text-[var(--body)]">
              <input id={id(`pm-${method}`)} type="checkbox" className={checkbox} checked={draft.methods.includes(method)} disabled={ro} onChange={(e) => onChange({ methods: toggle(draft.methods, method, e.target.checked, PAYMENT_METHODS) })} />
              {PAYMENT_METHOD_LABEL[method]}
            </label>
          ))}
        </div>
      </fieldset>

      {draft.tenantOwned && (
        <div className="mt-4 max-w-md">
          <ToggleRow id={id("active")} title="Offered" help="Switched off, the Quote step stops offering it. Quotes already made keep it." checked={draft.isActive} disabled={ro} onChange={(on) => onChange({ isActive: on })} />
        </div>
      )}
    </div>
  );
}
