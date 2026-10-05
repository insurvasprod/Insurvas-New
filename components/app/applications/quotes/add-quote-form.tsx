"use client";

/**
 * The Quote step's first card (LA-3.4 + 3.5 + 3.25; board l3-ws-quote): the quotation template's
 * rating inputs, then the one carrier quote being typed from the carrier's own tool — carrier,
 * product, monthly premium, age basis, and for a term product the term length, assumed health class
 * and annual premium. Nothing here rates. One hard rule blocks the save (premium missing, or as large
 * as the face); per-$1,000 out of band, face or age outside the product are amber and save anyway.
 * The premium clears once the quote is saved; the rating inputs stay for the next carrier.
 */

import { useState } from "react";
import { Plus } from "lucide-react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { bandFallback, checkQuote, premiumPer1000, ratingAge, type QuoteWarning } from "@/lib/quotes/math";
import { cn } from "@/lib/utils";

import { StepCard } from "@/components/app/applications/workspace/step-card";
import { isTermProduct, productIn, quotationFields, templateFor, type AgeBasis, type CarrierProduct, type QuoteCatalogue } from "./catalogue";
import { AGE_BASIS_SHORT, RatingInputs, type RatingField, type RatingPrefill, type RatingTemplate } from "./rating-inputs";

/** One quote as typed, before it is saved. */
export type QuoteDraft = {
  product: CarrierProduct;
  tier: string;
  faceCents: number;
  premiumCents: number;
  /** Term only: typed from the carrier's tool (annual is not always 12 × monthly). */
  annualCents: number | null;
  termLength: number | null;
  healthClass: string | null;
  riders: string[];
  ageBasis: AgeBasis;
  age: number | null;
  warnings: QuoteWarning[];
  /** Every rating input as it was when the quote was typed, keyed by the template's field keys. */
  ratingInputs: Record<string, unknown>;
};

const per1000Text = (n: number) => `$${n.toFixed(2)}`;


export function AddQuoteForm({ catalogue, template, onTemplate, onExtra, prefill, prefillExtra, defaultCarrierId, onAdd, readOnly }: {
  catalogue: QuoteCatalogue;
  template: RatingTemplate;
  onTemplate: (patch: Partial<RatingTemplate>, field?: RatingField) => void;
  onExtra: (key: string, value: string) => void;
  prefill: (field: RatingField) => RatingPrefill | undefined;
  prefillExtra: (key: string) => RatingPrefill | undefined;
  defaultCarrierId: string | null;
  /** Resolves true once the quote is saved (or, in the sample, added). */
  onAdd: (draft: QuoteDraft) => Promise<boolean>;
  readOnly: boolean;
}) {
  const carrierList = catalogue.carriers;
  const [carrierId, setCarrierId] = useState(defaultCarrierId && productIn(catalogue, defaultCarrierId) ? defaultCarrierId : carrierList[0]?.id ?? "");
  const fields = quotationFields(catalogue, carrierId);
  const products = catalogue.products.filter((p) => p.carrierId === carrierId);
  const [productLabel, setProductLabel] = useState(products[0]?.productLabel ?? "");
  const product = productIn(catalogue, carrierId, productLabel) ?? products[0];
  const term = isTermProduct(product);
  const [basisChoice, setBasis] = useState<AgeBasis | null>(null);
  const ageBasis: AgeBasis = basisChoice ?? product?.ageBasis ?? templateFor(catalogue, carrierId)?.ageBasis ?? "nearest";
  const [premiumText, setPremiumText] = useState("");
  const [annualText, setAnnualText] = useState("");
  const [termChoice, setTermChoice] = useState<number | null>(null);
  const [classChoice, setClassChoice] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const termLength = term && product ? (termChoice !== null && product.termLengths.includes(termChoice) ? termChoice : product.termLengths[0] ?? null) : null;
  const healthClass = term && product ? (classChoice !== null && product.healthClasses.includes(classChoice) ? classChoice : product.healthClasses[0] ?? null) : null;
  const tiers = product?.tiers.length ? product.tiers : ["level"];
  const tier = tiers.includes(template.tier) ? template.tier : tiers[0];

  const faceCents = parseDollarsToCents(template.faceText);
  const premiumCents = parseDollarsToCents(premiumText);
  const annualCents = term ? parseDollarsToCents(annualText) : null;
  const faceFormat = template.faceText.trim() && (faceCents === null || faceCents <= 0) ? "Use a dollar amount, like 15,000." : null;
  const premiumFormat = premiumText.trim() && (premiumCents === null || premiumCents <= 0) ? "Use dollars and cents, like 68.40." : null;
  const annualFormat = term && annualText.trim() && (annualCents === null || annualCents <= 0) ? "Use dollars and cents, like 820.80." : null;
  const annualMissing = term && !annualText.trim() ? "Type the annual premium from the carrier's tool." : null;
  const age = template.dob ? ratingAge(template.dob, ageBasis) : null;
  const check = checkQuote({
    monthlyPremiumCents: premiumCents ?? 0,
    faceCents: faceCents ?? 0,
    age,
    band: product?.band ?? bandFallback(product?.productCode),
    faceMinCents: product?.faceMinCents,
    faceMaxCents: product?.faceMaxCents,
    issueAgeMin: product?.issueAgeMin,
    issueAgeMax: product?.issueAgeMax,
  });
  const typed = Boolean(template.faceText.trim() && premiumText.trim());
  const blocking = faceFormat || premiumFormat || annualFormat || check.error || (tried ? annualMissing : null);
  const showError = (tried || typed) && !faceFormat && !premiumFormat ? check.error ?? annualFormat ?? (tried ? annualMissing : null) : null;
  const per = faceCents && premiumCents ? premiumPer1000(premiumCents, faceCents) : null;
  const bandWarning = !check.error ? check.warnings.find((w) => w.code === "QUOTE_PER1000_BAND") : undefined;
  const otherWarnings = !check.error ? check.warnings.filter((w) => w.code !== "QUOTE_PER1000_BAND") : [];

  function changeCarrier(id: string) {
    setCarrierId(id);
    setProductLabel(catalogue.products.find((p) => p.carrierId === id)?.productLabel ?? "");
  }

  // The template's own inputs, as they will be stored. Only these are kept: an input the template
  // switches off is "not asked, not stored" (Settings › Sales › Quotation templates).
  const riders = product ? template.riders.filter((r) => !product.riders.length || product.riders.includes(r)) : [];
  const valueFor = (key: string): unknown => {
    switch (key) {
      case "dob": return template.dob || null;
      case "gender": return template.gender || null;
      case "state": return template.state || null;
      case "tobacco": return template.tobacco || null;
      case "face_amount": return faceCents;
      case "tier": return tier;
      case "riders": return riders;
      default: return template.extra[key]?.trim() || null;
    }
  };
  const missing = fields.filter((f) => f.required && f.key !== "riders" && (valueFor(f.key) === null || valueFor(f.key) === "")).map((f) => f.label);
  if (faceCents === null && !faceFormat && !missing.includes("Face amount")) missing.push("Face amount");
  const requiredError = missing.length ? `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required by this quotation template.` : null;

  async function save() {
    setTried(true);
    if (!product || requiredError || faceFormat || premiumFormat || annualFormat || annualMissing || check.error || faceCents === null || premiumCents === null) return;
    setBusy(true);
    try {
      const ok = await onAdd({
        product, tier, faceCents, premiumCents, annualCents, termLength, healthClass, riders, ageBasis, age, warnings: check.warnings,
        ratingInputs: {
          ...Object.fromEntries(fields.map((f) => [f.key, valueFor(f.key)])),
          face_amount: faceCents, age_basis: ageBasis, age_used: age,
          ...(term ? { term_length: termLength, health_class: healthClass } : {}),
        },
      });
      if (!ok) return;
      setPremiumText("");
      setAnnualText("");
      setTried(false);
    } finally {
      setBusy(false);
    }
  }

  const tpl = templateFor(catalogue, carrierId);

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) void save(); }}>
      <StepCard
        title="Type the premium from the carrier’s own tool"
        chips={<StatusChip tone="neutral" dot={false}>{tpl ? `Quotation template v${tpl.version}` : "Default quotation fields"}</StatusChip>}
        footerNote={product ? (age !== null ? `Rated at age ${age} (${AGE_BASIS_SHORT[ageBasis]}) for ${product.carrierName}.` : `Quoting ${product.carrierName} · ${product.productLabel}.`) : null}
        actions={!readOnly && product ? <Button type="submit" disabled={busy} title={busy ? "Saving the quote" : undefined}><Plus aria-hidden="true" />{busy ? "Adding…" : "Add quote"}</Button> : undefined}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RatingInputs fields={fields} value={{ ...template, tier }} onChange={onTemplate} onExtra={onExtra} prefill={prefill} prefillExtra={prefillExtra} product={product} ageBasis={ageBasis} readOnly={readOnly} />

          <Field label="Carrier" htmlFor="quote.carrier" required>
            <select id="quote.carrier" className={control} value={carrierId} disabled={readOnly} onChange={(e) => changeCarrier(e.target.value)}>
              {carrierList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Product" htmlFor="quote.product" required>
            <select id="quote.product" className={control} value={product?.productLabel ?? ""} disabled={readOnly} onChange={(e) => setProductLabel(e.target.value)}>
              {products.map((p) => <option key={p.id ?? p.productLabel} value={p.productLabel}>{p.productLabel}</option>)}
            </select>
          </Field>
          {term && product && (
            <>
              <Field label="Term length" htmlFor="quote.term_length" required>
                <select id="quote.term_length" className={control} value={termLength ?? ""} disabled={readOnly} onChange={(e) => setTermChoice(Number(e.target.value))}>
                  {product.termLengths.map((y) => <option key={y} value={y}>{y} years</option>)}
                </select>
              </Field>
              <Field label="Assumed health class" htmlFor="quote.health_class" required={product.healthClasses.length > 0} hint="The class you quoted — the carrier sets the real one.">
                <select id="quote.health_class" className={control} value={healthClass ?? ""} disabled={readOnly || product.healthClasses.length === 0} title={product.healthClasses.length === 0 ? "This product lists no health classes" : undefined} onChange={(e) => setClassChoice(e.target.value)}>
                  {product.healthClasses.length === 0 && <option value="">None listed</option>}
                  {product.healthClasses.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </>
          )}
          <Field label="Monthly premium" htmlFor="cov.monthly_premium" required error={premiumFormat} hint={per !== null ? `${per1000Text(per)} per $1,000` : "From the carrier's quote tool."}>
            <input id="cov.monthly_premium" inputMode="decimal" autoComplete="off" placeholder="68.40" aria-invalid={Boolean(premiumFormat || showError)} className={cn(control, "tabular-nums")} value={premiumText} disabled={readOnly} onChange={(e) => setPremiumText(e.target.value)} />
          </Field>
          {term && (
            <Field label="Annual premium" htmlFor="quote.annual_premium" required error={annualFormat} hint={premiumCents ? `12 × monthly is ${formatCentsAsCurrency(premiumCents * 12)} — type the carrier's annual figure.` : "From the carrier's quote tool."}>
              <input id="quote.annual_premium" inputMode="decimal" autoComplete="off" placeholder="780.00" aria-invalid={Boolean(annualFormat)} className={cn(control, "tabular-nums")} value={annualText} disabled={readOnly} onChange={(e) => setAnnualText(e.target.value)} />
            </Field>
          )}
          <Field label="Age basis" htmlFor="quote.age_basis">
            <select id="quote.age_basis" className={control} value={ageBasis} disabled={readOnly} onChange={(e) => setBasis(e.target.value as AgeBasis)}>
              <option value="nearest">Nearest birthday</option>
              <option value="last">Last birthday</option>
            </select>
          </Field>
          {faceFormat && <p role="alert" className="text-sm text-[var(--error-ink)] sm:col-span-2 lg:col-span-3">{faceFormat}</p>}
        </div>

        {tried && requiredError && <p role="alert" className="text-sm font-semibold text-[var(--error-ink)]">{requiredError}</p>}
        {showError && blocking && <p role="alert" className="text-sm font-semibold text-[var(--error-ink)]">{showError}</p>}
        {(bandWarning || otherWarnings.length > 0) && (
          <div className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5">
            {bandWarning && per !== null && (
              <>
                <p className="text-sm font-semibold text-[var(--warning-ink)]">
                  {per1000Text(per)} per $1,000 is {product?.band && per > product.band.max ? "above" : product?.band && per < product.band.min ? "below" : "outside"} the usual band for this product
                </p>
                <p className="mt-1 text-sm text-[var(--body)]">
                  {product?.band ? `Between ${per1000Text(product.band.min)} and ${per1000Text(product.band.max)} is typical for ${product.productLabel}. ` : ""}It is allowed — check you read the carrier’s tool correctly before you continue.
                </p>
              </>
            )}
            {otherWarnings.map((w) => <p key={w.code} className={cn("text-sm text-[var(--warning-ink)]", bandWarning && "mt-1")}>{w.message} It still saves.</p>)}
          </div>
        )}
      </StepCard>
    </form>
  );
}
