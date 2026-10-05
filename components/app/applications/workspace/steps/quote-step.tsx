"use client";

/**
 * Step ③ — quote (LA-3.4 quotation template, 3.5 capture and comparison, 3.6 payout, 3.25 term;
 * board l3-ws-quote). The agent rates in the carrier's own tool and types the premium here; this
 * step validates, compares side by side, and records which quote goes on the application. Selecting
 * one discards the rest — nothing is deleted.
 *
 * Live: carriers, products and the quotation template come from the case's catalogue; each quote is
 * saved with its template id/version and every rating input frozen, and payout and appointment come
 * back on the server's QuoteView. Sample: the design catalogue, quotes built on screen.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { notify } from "@/lib/notify";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { DEFAULT_QUOTE_VALID_DAYS, quoteExpired } from "@/lib/applications/listRules";
import { FE_TIERS, PAYMENT_METHOD_LABEL } from "@/lib/applications/constants";
import type { AttemptView, CaseView, FieldValue, InterviewView, QuoteView } from "@/lib/applications/types";
import { formatCents } from "@/lib/money";
import { estimatePayout } from "@/lib/quotes/math";

import { AddQuoteForm, type QuoteDraft } from "@/components/app/applications/quotes/add-quote-form";
import { appointmentFor, catalogueFromLive, productIn, SAMPLE_CATALOGUE, templateFor, type LiveCatalog, type QuoteCatalogue } from "@/components/app/applications/quotes/catalogue";
import { PayoutStrip } from "@/components/app/applications/quotes/payout-strip";
import { QuoteComparison } from "@/components/app/applications/quotes/quote-comparison";
import { RATING_SOURCE_KEY, type RatingField, type RatingPrefill, type RatingTemplate } from "@/components/app/applications/quotes/rating-inputs";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { isPrefilled } from "./step-bits";
import { shortDate } from "@/components/app/applications/parts";

/** "15,000" for 1 500 000¢, "15,000.50" when there are cents. */
function dollarsText(cents: number) {
  const whole = Math.floor(cents / 100).toLocaleString("en-US");
  return cents % 100 === 0 ? whole : `${whole}.${formatCents(cents).split(".")[1]}`;
}

/** Interview questions that answer a rating input, by the question keys templates use for them. */
const INTERVIEW_KEYS: Record<"dob" | "gender" | "tobacco", string[]> = {
  dob: ["dob", "date_of_birth"],
  gender: ["gender", "sex"],
  tobacco: ["tobacco", "tobacco_use", "nicotine", "smoker"],
};

/** Every scalar interview answer as text (true → "yes"), by question key. */
function interviewText(interview: InterviewView | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, a] of Object.entries(interview?.answers ?? {})) {
    const v = a?.value;
    if (v === true) out[key] = "yes";
    else if (v === false) out[key] = "no";
    else if (typeof v === "string" && v.trim()) out[key] = v.trim();
    else if (typeof v === "number") out[key] = String(v);
  }
  return out;
}

function initialTemplate(attempt: AttemptView, caseView: CaseView, interview: InterviewView | null): { template: RatingTemplate; fromInterview: RatingField[] } {
  const str = (key: string) => (typeof attempt.values[key]?.value === "string" ? (attempt.values[key]!.value as string) : "");
  const answers = interviewText(interview);
  const fromInterview: ("dob" | "gender" | "tobacco")[] = [];
  // The application's value first; failing that, what the client said in the interview.
  const pick = (field: "dob" | "gender" | "tobacco", key: string) => {
    const own = str(key);
    if (own) return own;
    const said = INTERVIEW_KEYS[field].map((k) => answers[k]).find(Boolean) ?? "";
    if (said) fromInterview.push(field);
    return said;
  };
  const faceValue = attempt.values["cov.face_amount"]?.value;
  const tierValue = str("cov.product_tier") || attempt.tier || "level";
  const gender = pick("gender", "insured.gender").toLowerCase();
  const tobacco = pick("tobacco", "insured.tobacco").toLowerCase();
  const dob = pick("dob", "insured.dob");
  const selected = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId);
  const template: RatingTemplate = {
    dob: /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : "",
    gender: gender === "female" || gender === "male" ? gender : "",
    state: (str("addr.state") || caseView.clientState || "").toUpperCase(),
    tobacco: tobacco === "yes" || tobacco === "no" ? tobacco : "",
    faceText: typeof faceValue === "number" ? dollarsText(faceValue) : "",
    tier: (FE_TIERS as readonly string[]).includes(tierValue) ? tierValue : "level",
    riders: selected?.riders.map((r) => r.name) ?? [],
    extra: {},
  };
  return { template, fromInterview: fromInterview.filter((f) => template[f] !== "") };
}

type CatalogueState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; catalogue: QuoteCatalogue };

/** The live catalogue for this case; the design sample in preview. */
function useCatalogue(caseId: string, sample: boolean, productLine: string | null) {
  const [state, setState] = useState<CatalogueState>(() => (sample ? { status: "ready", catalogue: SAMPLE_CATALOGUE } : { status: "loading" }));
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (sample) return;
    let live = true;
    fetch(`/api/app/applications/cases/${caseId}/catalog`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setState({ status: "error", message: typeof data?.error === "string" ? data.error : `The server said ${res.status}` });
        else setState({ status: "ready", catalogue: catalogueFromLive(data as LiveCatalog, productLine) });
      })
      .catch(() => { if (live) setState({ status: "error", message: "No connection. Try again." }); });
    return () => { live = false; };
  }, [caseId, sample, reload, productLine]);

  const retry = useCallback(() => { setState({ status: "loading" }); setReload((n) => n + 1); }, []);
  return { state, retry };
}

function QuoteStepFor() {
  const { caseView, attempt, interview, readOnly, sample, updateAttempt, actions, goTo, timeZone } = useWorkspace();
  const [initial] = useState(() => initialTemplate(attempt, caseView, interview));
  const [template, setTemplate] = useState(initial.template);
  // A rating input the agent has typed over is theirs now: its prefilled marker goes.
  const [edited, setEdited] = useState<ReadonlySet<RatingField>>(() => new Set());
  const answers = interviewText(interview);
  const [selecting, setSelecting] = useState<string | null>(null);
  const { state: cat, retry } = useCatalogue(caseView.caseId, sample, attempt.productCode);
  const catalogue = cat.status === "ready" ? cat.catalogue : null;
  const method = attempt.payment?.method ?? null;
  const [now] = useState(() => Date.now());
  // A quote past its template's validity (Settings › Quotation) may no longer be the carrier's price.
  const validDaysFor = (carrierId: string) => (catalogue ? templateFor(catalogue, carrierId)?.validDays : undefined) ?? DEFAULT_QUOTE_VALID_DAYS;
  const expired = catalogue ? attempt.quotes.filter((q) => q.status !== "discarded" && quoteExpired(q.createdAt, validDaysFor(q.carrierId), now)) : [];

  const prefill = (field: RatingField): RatingPrefill | undefined => {
    if (edited.has(field)) return undefined;
    const fv = attempt.values[RATING_SOURCE_KEY[field]];
    if (isPrefilled(fv)) return { fv, confirmable: true };
    if ((field === "dob" || field === "gender" || field === "tobacco") && initial.fromInterview.includes(field)) return { fv: { value: template[field], source: "interview", reviewed: false }, confirmable: false };
    return undefined;
  };
  // A template field the form has no special input for takes the interview's answer to the same key.
  const prefillExtra = (key: string): RatingPrefill | undefined =>
    key in template.extra || !(key in answers) ? undefined : { fv: { value: answers[key], source: "interview", reviewed: false }, confirmable: false };
  function changeTemplate(patch: Partial<RatingTemplate>, field?: RatingField) {
    setTemplate((t) => ({ ...t, ...patch }));
    if (field && !edited.has(field)) setEdited((s) => new Set(s).add(field));
  }
  const changeExtra = (key: string, value: string) => setTemplate((t) => ({ ...t, extra: { ...t.extra, [key]: value } }));
  const formTemplate: RatingTemplate = { ...template, extra: { ...answers, ...template.extra } };

  /** Sample: build the QuoteView on screen, with a local payout estimate. */
  function addSampleQuote(d: QuoteDraft) {
    const p = d.product;
    const payout = p.samplePayout ? estimatePayout({ monthlyPremiumCents: d.premiumCents, ...p.samplePayout }) : null;
    const q: QuoteView = {
      id: `q-${crypto.randomUUID().slice(0, 8)}`,
      carrierId: p.carrierId, carrierName: p.carrierName, productLabel: p.productLabel, tier: d.tier,
      termLength: d.termLength, healthClass: d.healthClass,
      faceAmountCents: d.faceCents, monthlyPremiumCents: d.premiumCents, annualPremiumCents: d.annualCents,
      riders: d.riders.map((name) => ({ name, monthlyPremiumCents: 0 })),
      ageUsed: d.age, status: "draft", appointed: appointmentFor(p, template.state),
      acceptsPaymentMethod: method && p.acceptedPaymentMethods.length ? p.acceptedPaymentMethods.includes(method) : null,
      warnings: d.warnings,
      payout: payout && p.samplePayout ? { fycCents: payout.fycCents, advanceCents: payout.advanceCents, advanceMonths: p.samplePayout.advanceMonths, contractLevelBp: p.samplePayout.rateBp } : null,
      createdAt: new Date().toISOString(),
    };
    updateAttempt({ quotes: [...attempt.quotes, q] });
    notify.done(`${q.carrierName} quote added`);
  }

  async function addQuote(d: QuoteDraft): Promise<boolean> {
    if (sample) { addSampleQuote(d); return true; }
    const p = d.product;
    const tpl = catalogue ? templateFor(catalogue, p.carrierId) : null;
    const saved = await actions.saveQuote({
      carrier_id: p.carrierId,
      carrier_product_id: p.id,
      product_code: p.productCode,
      tier: d.tier,
      face_amount_cents: d.faceCents,
      monthly_premium_cents: d.premiumCents,
      annual_premium_cents: d.annualCents,
      term_length: d.termLength,
      assumed_health_class: d.healthClass,
      riders: d.riders.map((name) => ({ name, monthlyPremiumCents: 0 })),
      rating_inputs: d.ratingInputs,
      dob: template.dob || null,
      age_basis: d.ageBasis,
      quotation_template_id: tpl?.id ?? null,
      template_version: tpl?.version ?? null,
    });
    if (!saved) return false;
    // The server's checks are the ones on record; they also show on the quote's column.
    if (saved.warnings.length) notify.warn(`${p.carrierName} quote added`, { detail: saved.warnings.map((w) => w.message).join(" ") });
    else notify.done(`${p.carrierName} quote added`);
    return true;
  }

  async function select(q: QuoteView) {
    // Allowed, with a warning: the carrier's own tool is the authority on whether the price stands.
    if (expired.some((x) => x.id === q.id)) {
      notify.warn(`This ${q.carrierName} quote is over ${validDaysFor(q.carrierId)} days old`, { detail: "Check the premium in the carrier's own tool before you submit. It is selected anyway." });
    }
    if (!sample) {
      setSelecting(q.id);
      try {
        if (await actions.selectQuote(q.id)) notify.done(`${q.carrierName} is on the application`);
      } finally {
        setSelecting(null);
      }
      return;
    }
    const quotes = attempt.quotes.map((x): QuoteView => (x.id === q.id ? { ...x, status: "selected" } : { ...x, status: "discarded" }));
    const p = productIn(SAMPLE_CATALOGUE, q.carrierId, q.productLabel);
    const sameCarrier = attempt.carrierId === q.carrierId;
    const fromQuote = (value: number | string): FieldValue => ({ value, source: "quote", reviewed: true });
    updateAttempt({
      quotes, selectedQuoteId: q.id, carrierId: q.carrierId, carrierName: q.carrierName, productLabel: q.productLabel, productCode: p?.productCode ?? attempt.productCode,
      tier: q.tier, appointment: q.appointed,
      carrierPortalUrl: sameCarrier ? attempt.carrierPortalUrl : null, portalUsername: sameCarrier ? attempt.portalUsername : null,
      product: p ? { issueAgeMin: p.issueAgeMin, issueAgeMax: p.issueAgeMax, faceMinCents: p.faceMinCents, faceMaxCents: p.faceMaxCents, acceptedPaymentMethods: p.acceptedPaymentMethods } : attempt.product,
      values: { ...attempt.values, "cov.face_amount": fromQuote(q.faceAmountCents), "cov.product_tier": fromQuote(q.tier), "cov.monthly_premium": fromQuote(q.monthlyPremiumCents) },
    });
    notify.done(`${q.carrierName} is on the application`);
  }

  let formCard;
  if (cat.status === "loading") formCard = <StepCard title="Type the premium from the carrier’s own tool"><SectionLoading rows={2} columns={3} label="Loading the carriers" /></StepCard>;
  else if (cat.status === "error") formCard = <StepCard title="Type the premium from the carrier’s own tool"><ErrorState title="The carriers did not load" detail={cat.message} action={<Button type="button" variant="outline" onClick={retry}>Try again</Button>} /></StepCard>;
  else if (catalogue && catalogue.carriers.length === 0) formCard = <StepCard title="Type the premium from the carrier’s own tool"><EmptyState title="No carriers to quote" hint="Add the carriers you're contracted with, and their products, in Settings › Carrier library." /></StepCard>;
  else if (catalogue) formCard = <AddQuoteForm catalogue={catalogue} template={formTemplate} onTemplate={changeTemplate} onExtra={changeExtra} prefill={prefill} prefillExtra={prefillExtra} defaultCarrierId={attempt.carrierId} onAdd={addQuote} readOnly={readOnly} />;

  const others = Math.max(attempt.quotes.length - 1, 0);
  const printHref = `/app/applications/${caseView.caseId}/quotes/print?attempt=${attempt.attemptNo}&insured=${attempt.insuredRole}${sample ? "&preview=sample" : ""}`;

  return (
    <div className="flex flex-col gap-5">
      {formCard}

      {expired.length > 0 && (
        <Callout tone="warning" title={expired.length === 1 ? "A quote has expired" : `${expired.length} quotes have expired`}>
          <ul className="flex flex-col gap-1.5">
            {expired.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-2">
                <StatusChip tone="warning">Quote expired</StatusChip>
                <span>{q.carrierName} · {q.productLabel}, typed {shortDate(q.createdAt, { timeZone })}. Quotes on this template stand {validDaysFor(q.carrierId)} days — check the premium in the carrier&apos;s tool again.</span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {attempt.quotes.length === 0 ? (
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
          <EmptyState title="No quotes yet" hint="Type each carrier's premium above to compare them side by side." />
        </div>
      ) : (
        <QuoteComparison
          quotes={attempt.quotes}
          onSelect={(q) => { void select(q); }}
          busyId={selecting}
          expiredIds={new Set(expired.map((q) => q.id))}
          readOnly={readOnly}
          paymentMethodLabel={method ? PAYMENT_METHOD_LABEL[method] : null}
        />
      )}

      <PayoutStrip quotes={attempt.quotes} />

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <span className="min-w-0 text-xs text-[var(--muted)]">
          {others > 0 ? `Selecting a quote discards the ${others === 1 ? "other one" : `other ${others}`} from this attempt — every quote stays listed under Quotes.` : null}
        </span>
        <span className="flex flex-wrap items-center gap-3">
          {attempt.quotes.some((q) => q.status !== "discarded") ? (
            <Button asChild variant="outline"><a href={printHref} target="_blank" rel="noreferrer">Client comparison (print)</a></Button>
          ) : (
            <Button type="button" variant="outline" disabled title="Add a quote first — the client sees every quote that is not discarded.">Client comparison (print)</Button>
          )}
          <Button type="button" variant="outline" onClick={() => goTo("interview")}><ArrowLeft aria-hidden="true" />Back to Interview</Button>
          <Button type="button" onClick={() => goTo("application")}>Continue to Application<ArrowRight aria-hidden="true" /></Button>
        </span>
      </div>
    </div>
  );
}

export function QuoteStep() {
  const { attempt } = useWorkspace();
  // Local drafts belong to one attempt: switching attempts starts the template afresh.
  return <QuoteStepFor key={attempt.id} />;
}
