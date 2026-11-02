"use client";

/**
 * The Quote step's first card (LA-3.4 + 3.5 + 3.25; board l3-ws-quote): the quotation template's
 * rating inputs, then the one carrier quote being typed from the carrier's own tool — carrier,
 * product, monthly premium, age basis, and for a term product the term length, assumed health class
 * and annual premium. Nothing here rates. One hard rule blocks the save (premium missing, or as large
 * as the face); per-$1,000 out of band, face or age outside the product are amber and save anyway.
 * The premium clears once the quote is saved; the rating inputs stay for the next carrier.
 *
 * Owner 2026-10-28: laid out in the order the agent works, as four numbered parts: 1 the client (one
 * line, opened only to correct it), 2 the coverage (a dollar face amount with quick picks, tier as
 * chips, riders), 3 the carrier (product, term and health class as chips, the age it rates on), and
 * 4 the price from their tool, ending in "Add quote". After a quote is added the carrier picker takes
 * focus so the next carrier is quick.
 */

import { useRef, useState, type ReactNode } from "react";
import { Check, Plus } from "lucide-react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { bandFallback, checkQuote, premiumPer1000, ratingAge, type QuoteWarning } from "@/lib/quotes/math";
import { TIER_LABEL } from "@/lib/applications/constants";
import { US_STATES } from "@/lib/appointments/constants";
import { cn } from "@/lib/utils";

import { PREFILL_SURFACE, PrefillHint } from "@/components/app/applications/workspace/steps/step-bits";

import { StepCard } from "@/components/app/applications/workspace/step-card";
import { isTermProduct, productIn, quotationFields, templateFor, type AgeBasis, type CarrierProduct, type QuoteCatalogue } from "./catalogue";
import { AGE_BASIS_SHORT, RATING_SOURCE_KEY, RatingInputs, type RatingField, type RatingPrefill, type RatingTemplate } from "./rating-inputs";

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
const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
/** The coverage part's fields; every other template field describes the client. */
const COVERAGE_KEYS = new Set(["face_amount", "tier", "riders"]);

/** "15000" → "15,000" as it is typed; cents after a point are kept. */
function groupDigits(text: string) {
  const [whole, ...rest] = text.replace(/[^\d.]/g, "").split(".");
  const grouped = whole ? Number(whole).toLocaleString("en-US") : "";
  return rest.length ? `${grouped}.${rest.join("").slice(0, 2)}` : grouped;
}

/** Common face amounts inside the product's limits (cents). */
function faceQuickPicks(product: CarrierProduct | undefined) {
  const term = isTermProduct(product);
  const picks = (term ? [100_000, 250_000, 500_000, 1_000_000] : [5_000, 10_000, 15_000, 25_000]).map((d) => d * 100);
  return picks.filter((c) => (!product?.faceMinCents || c >= product.faceMinCents) && (!product?.faceMaxCents || c <= product.faceMaxCents));
}


export function AddQuoteForm({ catalogue, template, onTemplate, onExtra, prefill, prefillExtra, defaultCarrierId, caseProductCode = null, onAdd, readOnly }: {
  catalogue: QuoteCatalogue;
  template: RatingTemplate;
  onTemplate: (patch: Partial<RatingTemplate>, field?: RatingField) => void;
  onExtra: (key: string, value: string) => void;
  prefill: (field: RatingField) => RatingPrefill | undefined;
  prefillExtra: (key: string) => RatingPrefill | undefined;
  defaultCarrierId: string | null;
  /** The product line chosen before the call (Term Life…): only its products are offered. None chosen: every product. */
  caseProductCode?: string | null;
  /** Resolves true once the quote is saved (or, in the sample, added). */
  onAdd: (draft: QuoteDraft) => Promise<boolean>;
  readOnly: boolean;
}) {
  const carrierList = catalogue.carriers;
  const [carrierId, setCarrierId] = useState(defaultCarrierId && productIn(catalogue, defaultCarrierId) ? defaultCarrierId : carrierList[0]?.id ?? "");
  const fields = quotationFields(catalogue, carrierId);
  const carrierProducts = catalogue.products.filter((p) => p.carrierId === carrierId);
  const onLine = caseProductCode ? carrierProducts.filter((p) => p.productCode === caseProductCode) : [];
  const products = onLine.length ? onLine : carrierProducts;
  const [productLabel, setProductLabel] = useState(products[0]?.productLabel ?? "");
  const product = productIn(catalogue, carrierId, productLabel) ?? products[0];
  const term = isTermProduct(product);
  // The product's (or its template's) own basis: the agent no longer changes it here (owner 2026-10-28).
  const ageBasis: AgeBasis = product?.ageBasis ?? templateFor(catalogue, carrierId)?.ageBasis ?? "nearest";
  const [premiumText, setPremiumText] = useState("");
  const [annualText, setAnnualText] = useState("");
  const [termChoice, setTermChoice] = useState<number | null>(null);
  const [classChoice, setClassChoice] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editClient, setEditClient] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const carrierRef = useRef<HTMLSelectElement>(null);

  const termLength = term && product ? (termChoice !== null && product.termLengths.includes(termChoice) ? termChoice : product.termLengths[0] ?? null) : null;
  const healthClass = term && product ? (classChoice !== null && product.healthClasses.includes(classChoice) ? classChoice : product.healthClasses[0] ?? null) : null;
  // The product's tiers, narrowed to the ones its quotation template offers (Settings › Quotation templates).
  const productTiers = product?.tiers.length ? product.tiers : ["level"];
  const templateTiers = fields.find((f) => f.key === "tier")?.options ?? [];
  const offered = templateTiers.length ? productTiers.filter((t) => templateTiers.includes(t)) : productTiers;
  const tiers = offered.length ? offered : productTiers;
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
    setJustAdded(null);
    setCarrierId(id);
    const mine = catalogue.products.filter((p) => p.carrierId === id);
    setProductLabel((mine.find((p) => caseProductCode && p.productCode === caseProductCode) ?? mine[0])?.productLabel ?? "");
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
      // The client and the coverage stay; the next carrier is one pick away.
      setJustAdded(product.carrierName);
      carrierRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const tpl = templateFor(catalogue, carrierId);

  // 1 · the client: the template's own client fields (and any it adds), shown as one line until opened.
  const clientFields = fields.filter((f) => !COVERAGE_KEYS.has(f.key));
  const clientMissing = clientFields.filter((f) => f.required && (valueFor(f.key) === null || valueFor(f.key) === ""));
  const clientOpen = editClient || clientMissing.length > 0;
  const clientLine = [
    template.gender ? template.gender[0].toUpperCase() + template.gender.slice(1) : null,
    age !== null ? `${age} (${AGE_BASIS_SHORT[ageBasis]})` : null,
    template.state ? STATE_NAME.get(template.state) ?? template.state : null,
    template.tobacco === "yes" ? "Tobacco" : template.tobacco === "no" ? "No tobacco" : null,
  ].filter(Boolean).join(" · ");
  // 2 · the coverage
  const tierField = fields.find((f) => f.key === "tier");
  const faceField = fields.find((f) => f.key === "face_amount");
  const riderField = fields.filter((f) => f.key === "riders");
  const facePrefill = prefill("face");
  const faceOptions = faceQuickPicks(product);
  // What still stands between the agent and "Add quote", in words.
  const notYet = !product ? "Pick a carrier and product" : faceCents === null ? "Type the face amount" : !premiumText.trim() ? "Type the monthly premium from their tool" : term && !annualText.trim() ? "Type the annual premium from their tool" : null;

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) void save(); }}>
      <StepCard
        title="Add a quote"
        chips={<StatusChip tone="neutral" dot={false}>{tpl ? `Quotation template v${tpl.version}` : "Default quotation fields"}</StatusChip>}
      >
        {/* The client and the coverage side by side, half each (owner 2026-10-28); the carrier and the price stay full width. */}
        <div className="grid gap-5 border-b border-[var(--border)] pb-5 lg:grid-cols-2 lg:gap-6 [&>section]:border-b-0 [&>section]:pb-0 max-lg:[&>section:first-child]:border-b max-lg:[&>section:first-child]:pb-5">
        <Part n={1} title="The client">
          {clientOpen ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <RatingInputs fields={clientFields} value={{ ...template, tier }} onChange={onTemplate} onExtra={onExtra} prefill={prefill} prefillExtra={prefillExtra} product={product} ageBasis={ageBasis} readOnly={readOnly} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-alt)] px-3.5 py-2.5">
              <Check aria-hidden="true" className="size-4 shrink-0 text-[var(--accent-ink)]" />
              <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--ink)]">{clientLine || "Nothing on file yet"}</span>
              {!readOnly && <Button type="button" size="sm" variant="ghost" onClick={() => setEditClient(true)}>Edit</Button>}
            </div>
          )}
          {clientOpen && editClient && clientMissing.length === 0 && (
            <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setEditClient(false)}><Check aria-hidden="true" />Looks right</Button>
          )}
        </Part>

        <Part n={2} title="The coverage">
          <div className="grid gap-4 ">
            <Field label={faceField?.label ?? "Face amount"} htmlFor="cov.face_amount" required error={faceFormat} hint={faceField?.help}>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--muted)]">$</span>
                {/* `cov.face_amount` is the id QA's face-limit items land on. */}
                <input id="cov.face_amount" inputMode="numeric" autoComplete="off" placeholder="15,000" className={cn(control, "pl-6 tabular-nums", facePrefill && PREFILL_SURFACE)} value={template.faceText} disabled={readOnly} onChange={(e) => onTemplate({ faceText: groupDigits(e.target.value) }, "face")} />
              </div>
              {!readOnly && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {faceOptions.map((c) => (
                    <ToggleChip role="radio" key={c} selected={faceCents === c} onClick={() => onTemplate({ faceText: (c / 100).toLocaleString("en-US") }, "face")}>${(c / 100).toLocaleString("en-US")}</ToggleChip>
                  ))}
                </span>
              )}
              <PrefillHint fv={facePrefill?.fv} confirmable={facePrefill?.confirmable} fieldKey={RATING_SOURCE_KEY.face} readOnly={readOnly} />
            </Field>
            {/* A product with one tier has nothing to choose (owner 2026-10-28): the tier is still saved, just not asked. */}
            {tierField && tiers.length > 1 && (
              <div className="flex flex-col">
                <span className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">{tierField.label}{tierField.required && <span className="text-[var(--error-ink)]"> *</span>}</span>
                <span id="rate.tier" role="radiogroup" aria-label={tierField.label} className="mt-1.5 flex flex-wrap gap-1.5">
                  {tiers.map((t) => <ToggleChip role="radio" key={t} selected={tier === t} disabled={readOnly} onClick={() => onTemplate({ tier: t }, "tier")}>{TIER_LABEL[t] ?? t}</ToggleChip>)}
                </span>
                {tierField.help && <span className="mt-1.5 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{tierField.help}</span>}
              </div>
            )}
          </div>
          {riderField.length > 0 && (
            <div className="grid">
              <RatingInputs fields={riderField} value={{ ...template, tier }} onChange={onTemplate} onExtra={onExtra} prefill={prefill} prefillExtra={prefillExtra} product={product} ageBasis={ageBasis} readOnly={readOnly} />
            </div>
          )}
        </Part>
        </div>

        <Part n={3} title="The carrier">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Carrier" htmlFor="quote.carrier" required>
              <select id="quote.carrier" ref={carrierRef} className={control} value={carrierId} disabled={readOnly} onChange={(e) => changeCarrier(e.target.value)}>
                {carrierList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="flex flex-col">
              <span className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Product <span className="text-[var(--error-ink)]">*</span></span>
              {products.length <= 1 ? (
                <span id="quote.product" className="mt-1.5 flex h-9 items-center text-sm font-semibold text-[var(--ink)]">{product?.productLabel ?? "No product set up for this carrier"}</span>
              ) : (
                <span id="quote.product" role="radiogroup" aria-label="Product" className="mt-1.5 flex flex-wrap gap-1.5">
                  {products.map((p) => <ToggleChip role="radio" key={p.id ?? p.productLabel} selected={product?.productLabel === p.productLabel} disabled={readOnly} onClick={() => setProductLabel(p.productLabel)}>{p.productLabel}</ToggleChip>)}
                </span>
              )}
            </div>
          </div>
          {term && product && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col">
                <span className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Term length <span className="text-[var(--error-ink)]">*</span></span>
                <span id="quote.term_length" role="radiogroup" aria-label="Term length" className="mt-1.5 flex flex-wrap gap-1.5">
                  {product.termLengths.map((y) => <ToggleChip role="radio" key={y} selected={termLength === y} disabled={readOnly} onClick={() => setTermChoice(y)}>{y} years</ToggleChip>)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Assumed health class{product.healthClasses.length > 0 && <span className="text-[var(--error-ink)]"> *</span>}</span>
                <span id="quote.health_class" role="radiogroup" aria-label="Assumed health class" className="mt-1.5 flex flex-wrap gap-1.5">
                  {product.healthClasses.length === 0
                    ? <span className="text-sm text-[var(--muted)]">None listed for this product</span>
                    : product.healthClasses.map((c) => <ToggleChip role="radio" key={c} selected={healthClass === c} disabled={readOnly} onClick={() => setClassChoice(c)}>{c}</ToggleChip>)}
                </span>
              </div>
            </div>
          )}
        </Part>

        <Part n={4} title="The price from their tool">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Monthly premium" htmlFor="cov.monthly_premium" required error={premiumFormat} hint={per !== null ? `${per1000Text(per)} per $1,000` : undefined}>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--muted)]">$</span>
                <input id="cov.monthly_premium" inputMode="decimal" autoComplete="off" placeholder="68.40" aria-invalid={Boolean(premiumFormat || showError)} className={cn(control, "pl-6 font-semibold tabular-nums")} value={premiumText} disabled={readOnly} onChange={(e) => setPremiumText(e.target.value)} />
              </div>
            </Field>
            {term && (
              <Field label="Annual premium" htmlFor="quote.annual_premium" required error={annualFormat} hint={premiumCents ? `About ${formatCentsAsCurrency(premiumCents * 12)} (12 × monthly). Type the carrier's own annual figure.` : undefined}>
                <div className="relative">
                  <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-[var(--muted)]">$</span>
                  <input id="quote.annual_premium" inputMode="decimal" autoComplete="off" placeholder="780.00" aria-invalid={Boolean(annualFormat)} className={cn(control, "pl-6 font-semibold tabular-nums")} value={annualText} disabled={readOnly} onChange={(e) => setAnnualText(e.target.value)} />
                </div>
              </Field>
            )}
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

          {!readOnly && product && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-alt)] px-3.5 py-3">
              <span className="text-sm text-[var(--body)]" aria-live="polite">
                {justAdded ? <span className="font-semibold text-[var(--accent-ink)]">{justAdded} added. Pick the next carrier to compare.</span> : notYet ?? `Ready: ${product.carrierName} · ${product.productLabel}${faceCents ? ` · $${(faceCents / 100).toLocaleString("en-US")}` : ""}.`}
              </span>
              <Button type="submit" disabled={busy} title={busy ? "Saving the quote" : notYet ?? undefined}><Plus aria-hidden="true" />{busy ? "Adding…" : "Add quote"}</Button>
            </div>
          )}
        </Part>
      </StepCard>
    </form>
  );
}

/** One numbered part of the form: its number and what it is. */
function Part({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex gap-3 border-b border-[var(--border)] pb-5 last:border-b-0 last:pb-0">
      <span aria-hidden="true" className="inline-grid size-[30px] shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--accent-ink)]">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h4 className="m-0 text-card-title text-[var(--ink)]">{title}</h4>
        {children}
      </div>
    </section>
  );
}
