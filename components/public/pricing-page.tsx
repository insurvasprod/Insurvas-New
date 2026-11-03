"use client";

import { useMemo, useState, ViewTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/page-states";
import { Reveal, usePrefersReducedMotion } from "@/components/marketing/motion";
import { LandingObject } from "@/components/marketing/three/landing-object";
import landingStyles from "@/components/marketing/landing.module.css";
import { PricingCompareTable } from "@/components/public/pricing-compare-table";
import { PricingExplorer } from "@/components/public/pricing-explorer";
import { Collapse, PRICING_CSS, SegmentedControl } from "@/components/public/pricing-motion";
import { PricingPicker } from "@/components/public/pricing-picker";
import { PricingPlanCard, type CardPrice } from "@/components/public/pricing-plan-card";
import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  CYCLE_MONTHS,
  formatCentsAsCurrency,
  parseDollarsToCents,
  type BillingCycle,
} from "@/lib/money";
import { availableNeeds, planIncrements, recommendPlan } from "@/lib/pricing/planFit";
import { publicPriceForCycle, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * The public pricing page (board p-pub-pricing; redesigned 2026-10-13).
 *
 * Prices and plan contents are read from the live catalog on the server and passed in. The page
 * reads, in order: the per-workspace promise and the billing cycle; a "Which plan fits you?" picker
 * that lights up the cheapest plan covering the jobs ticked; the plans, each listing what it adds to
 * the one before it, by module; a module-by-module explorer (which replaced the flat compare table);
 * add-ons; questions; the closing call. The feature descriptions in the explorer are written copy,
 * kept in components/public/pricing-explorer.tsx — everything priced or granted is catalog data.
 *
 * Two audiences (2026-10-22): individual agents and agencies, one at a time behind a toggle at the
 * top (?for=agency links straight to the agency view). Agencies buy AG-0.12's flat seat bands: the
 * first band reads "Everything in <the top individual plan>, plus" the agency-only features, each
 * card names its seat range, and the questions add who uses a seat and how band changes are billed.
 * The "which plan fits you" picker is an individual-agent question, so it shows only there.
 */
export type PricingAudience = "individual" | "agency";

const AUDIENCE_COPY: Record<PricingAudience, { title: string; lede: string }> = {
  individual: {
    title: "Priced per workspace. Never per lead.",
    lede: "You already pay your vendors for every lead. Insurvas is priced by plan, so the lead you bought is not charged twice. Add-ons and usage above a plan’s allowance are priced separately.",
  },
  agency: {
    title: "One flat price for your whole agency.",
    lede: "Pick the band your team fits in. Producers, managers and assistants all work inside it, with payouts, lead routing and the agency dashboard included — never priced per seat or per lead.",
  },
};

/** "Up to 50 seats", "51–150 seats", "151+ seats": each band from the one below it. */
function seatLabels(plans: PublicPlan[]): (string | null)[] {
  return plans.map((plan, index) => {
    const below = index > 0 ? plans[index - 1].max_seats : null;
    if (plan.max_seats == null || plan.max_seats <= 0) return below != null ? `${(below + 1).toLocaleString("en-US")}+ seats` : null;
    if (below == null) return `Up to ${plan.max_seats.toLocaleString("en-US")} seats`;
    return `${(below + 1).toLocaleString("en-US")}–${plan.max_seats.toLocaleString("en-US")} seats`;
  });
}
export type PricingAddon = { code: string; name: string; description: string | null; price_cents: number; billing_cycle: BillingCycle };

function savingPercent(plan: PublicPlan, cycle: BillingCycle): number | null {
  if (cycle === "monthly" || !plan.price_monthly) return null;
  const monthly = parseDollarsToCents(plan.price_monthly);
  const selected = publicPriceForCycle(plan, cycle);
  const selectedCents = selected ? parseDollarsToCents(selected) : null;
  if (monthly == null || selectedCents == null || monthly <= 0) return null;
  const fullPrice = monthly * CYCLE_MONTHS[cycle];
  if (selectedCents >= fullPrice) return null;
  return Math.round(((fullPrice - selectedCents) / fullPrice) * 100);
}

/** The best saving any plan offers on a cycle, or null when none does. */
function bestSaving(plans: PublicPlan[], cycle: BillingCycle): number | null {
  const savings = plans.map((plan) => savingPercent(plan, cycle)).filter((value): value is number => value !== null);
  return savings.length ? Math.max(...savings) : null;
}

/** "2 months free" when a yearly saving is exactly two of twelve months, otherwise "save N%". */
function savingLabel(percent: number, cycle: BillingCycle): string {
  const months = (percent / 100) * CYCLE_MONTHS[cycle];
  const whole = Math.round(months);
  if (cycle === "yearly" && whole >= 1 && Math.abs(months - whole) < 0.15) return `${whole} month${whole === 1 ? "" : "s"} free`;
  return `save up to ${percent}%`;
}

function cardPrice(plan: PublicPlan, cycle: BillingCycle): CardPrice {
  const raw = publicPriceForCycle(plan, cycle);
  const totalCents = raw ? parseDollarsToCents(raw) : null;
  if (totalCents == null) return null;
  return { totalCents, monthlyCents: Math.round(totalCents / CYCLE_MONTHS[cycle]), saving: savingPercent(plan, cycle) };
}

const ADDON_CYCLE: Record<BillingCycle, string> = { monthly: "/ month", quarterly: "/ quarter", yearly: "/ year" };

const SECTION = "mx-auto max-w-7xl px-4 sm:px-6 lg:px-16";
const EYEBROW = "text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--accent-ink)]";
const H2 = "mt-3 text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg";

export function PricingPage({ plans: catalog, addons, loadError, initialAudience = "individual" }: { plans: PublicPlan[]; addons: PricingAddon[]; loadError: string | null; initialAudience?: PricingAudience }) {
  const audiences = useMemo(() => (["individual", "agency"] as const).filter((item) => catalog.some((plan) => plan.audience === item)), [catalog]);
  const [audience, setAudienceState] = useState<PricingAudience>(audiences.includes(initialAudience) ? initialAudience : audiences[0] ?? "individual");
  const setAudience = (next: PricingAudience) => {
    setAudienceState(next);
    setNeeds([]);
    // Shareable: /pricing?for=agency opens the agency view.
    const url = new URL(window.location.href);
    if (next === "agency") url.searchParams.set("for", "agency");
    else url.searchParams.delete("for");
    window.history.replaceState(null, "", url);
  };
  const plans = useMemo(() => catalog.filter((plan) => plan.audience === audience), [catalog, audience]);
  // An agency band builds on the top individual plan: its card says so, then lists only what it adds.
  const baseForAgency = useMemo(() => {
    const individual = catalog.filter((plan) => plan.audience === "individual");
    return individual.length ? individual[individual.length - 1] : null;
  }, [catalog]);
  const seats = useMemo(() => (audience === "agency" ? seatLabels(plans) : plans.map(() => null)), [audience, plans]);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [needs, setNeeds] = useState<string[]>([]);
  const [pickTurn, setPickTurn] = useState(0);
  const reduced = usePrefersReducedMotion();

  const offeredCycles = useMemo(
    () => BILLING_CYCLES.filter((candidate) => plans.some((plan) => publicPriceForCycle(plan, candidate))),
    [plans],
  );
  const increments = useMemo(
    () => (audience === "agency" && baseForAgency ? planIncrements([baseForAgency, ...plans]).slice(1) : planIncrements(plans)),
    [audience, baseForAgency, plans],
  );
  const questions = useMemo(() => availableNeeds(plans), [plans]);
  const fit = useMemo(
    () => recommendPlan(plans.map((plan) => ({ ...plan, monthlyCents: plan.price_monthly ? parseDollarsToCents(plan.price_monthly) : null })), needs),
    [plans, needs],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [compareView, setCompareView] = useState<"table" | "explain">("table");

  // Agency bands by seat limit; the slider's team size picks the first band it fits in (the last
  // band, with no limit, takes everyone above). Its card gets the same ring the picker gives.
  const seatBands = useMemo(() => (audience === "agency" ? plans.filter((plan) => plan.price_monthly) : []), [audience, plans]);
  const limited = seatBands.map((plan) => plan.max_seats).filter((value): value is number => value != null && value > 0);
  const seatMax = Math.max(50, ...limited.map((value) => Math.ceil((value * 1.5) / 10) * 10));
  const [teamSize, setTeamSize] = useState(10);
  const seatBand = seatBands.find((plan) => plan.max_seats != null && plan.max_seats > 0 && teamSize <= plan.max_seats)
    ?? seatBands.find((plan) => plan.max_seats == null || plan.max_seats <= 0)
    ?? null;

  const recommendedCode = audience === "agency" ? (seatBands.length > 1 ? seatBand?.code ?? null : null) : fit.status === "match" ? fit.code : null;

  const yearlySaving = bestSaving(plans, "yearly");
  const defaultPlan = plans.find((plan) => plan.is_default) ?? null;
  // "Move down" only makes sense when there is something cheaper than the plan we lead with.
  const monthlyCents = (plan: PublicPlan) => (plan.price_monthly ? parseDollarsToCents(plan.price_monthly) : null) ?? Number.POSITIVE_INFINITY;
  const defaultIsCheapest = defaultPlan ? plans.every((plan) => monthlyCents(defaultPlan) <= monthlyCents(plan)) : false;
  const defaultIsDearest = defaultPlan ? plans.every((plan) => monthlyCents(defaultPlan) >= monthlyCents(plan)) : false;
  const leadPlan = defaultPlan ?? plans[0] ?? null;
  const closingLine = audience === "agency"
    ? "Start on the band your team fits. Move up the day you grow."
    : !defaultPlan
    ? "Start your trial. Export your data either way."
    : plans.length < 2
      ? `Start on ${defaultPlan.name}. Export your data either way.`
      : defaultIsCheapest
        ? `Start on ${defaultPlan.name}. Move up when you outgrow it.`
        : defaultIsDearest
          ? `Start on ${defaultPlan.name}. Move down if you do not need it all.`
          : `Start on ${defaultPlan.name}. Move up or down as you grow.`;

  const faqs = [
    // One story everywhere (signup, checkout, landing): a card is entered at checkout, $0 is charged
    // for the trial, then the plan renews automatically until cancelled.
    { q: "What happens when the trial ends?", a: "You enter a card at checkout, and nothing is charged during the trial. When it ends, the plan’s price is charged to that card and the subscription renews automatically each billing period until you cancel. Cancel before the trial ends, in Settings › Plan & billing, and you are not charged. Taxes may apply. If a later payment fails, the workspace stays readable and writing is paused until it is settled." },
    { q: "Is there a per-lead charge?", a: "No. A plan is priced per workspace, not per lead: you already pay your vendors for every lead, and we do not charge you for it again. Add-ons you choose, and metered usage above your plan’s allowance, are billed at the rates shown." },
    { q: "Can I bring my existing book?", a: "Yes. Upload your carriers’ policy and commission files, or forward the emails they arrive in, and every policy is matched to its client and agent. You can also import a book you keep in a spreadsheet." },
    { q: "Can I change plan mid-cycle?", a: "Yes. You choose whether it applies now with proration or at renewal, and the confirmation names the effective date before anything moves." },
    { q: "What happens to existing subscribers when you change a plan?", a: "They keep the version they bought. Plans are versioned, so publishing a new version leaves every current subscriber on theirs until they renew." },
    ...(audience === "agency"
      ? [
          { q: "Who uses a seat?", a: "Every accepted, working member of the agency: the owner, producers, managers and assistants. Each person is one seat, whatever they do." },
          { q: "What happens when my team outgrows its band?", a: "Move up a band at any time: the change applies straight away and you pay the prorated difference for the rest of the period. Moving down takes effect at the end of the period, with no refund." },
        ]
      : []),
    yearlySaving
      ? { q: "Do you offer a discount for yearly billing?", a: `Yes — ${savingLabel(yearlySaving, "yearly")} on yearly billing. Switch the toggle above and the prices update.` }
      : { q: "Do you offer a discount for yearly billing?", a: "Not at the moment: every plan is billed at the same monthly rate whichever cycle you choose." },
  ];

  const toggleNeed = (id: string) => {
    setNeeds((now) => (now.includes(id) ? now.filter((item) => item !== id) : [...now, id]));
    setPickTurn((turn) => turn + 1);
  };
  const showPlan = (code: string) => {
    document.getElementById(`plan-${code}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    setPickTurn((turn) => turn + 1);
  };

  const ready = !loadError && plans.length > 0;

  return (
    <main className="overflow-x-clip">
      <style>{PRICING_CSS}</style>

      {/* The landing hero's living ribbon (owner, 2026-10-24: "like the hero section on the landing
          page"), the same named object, so going from the landing page to pricing reads as one scene. */}
      <section className="relative isolate overflow-hidden bg-background px-4 pb-[132px] pt-20 text-center sm:px-6 sm:pt-24 lg:px-16">
        <ViewTransition name="brand-ribbon" share="ribbon-morph" default="none">
          <LandingObject kind="ribbon" className={`pointer-events-none absolute -right-[12%] top-[-6%] -z-10 h-[112%] w-[100%] [mask-image:linear-gradient(90deg,transparent_0%,black_35%,black_85%,transparent_100%)] lg:w-[78%] ${landingStyles.ribbonIn}`} />
        </ViewTransition>
        {/* Keeps the centred headline legible where the ribbon passes behind it. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_62%_at_50%_42%,var(--background)_40%,color-mix(in_srgb,var(--background)_60%,transparent)_72%,transparent_100%)]" />
        <Reveal>
          <h1 key={audience} className="pz-fade mx-auto max-w-[860px] text-balance text-headline-lg font-semibold leading-[1.0] tracking-[-0.045em] text-[var(--ink)] sm:text-hero lg:text-[clamp(3.25rem,5.4vw,4.5rem)]">
            {AUDIENCE_COPY[audience].title}
          </h1>
          <p key={`${audience}-lede`} className="pz-fade mx-auto mt-5 max-w-[600px] text-base leading-[1.65] tracking-[-0.02em] text-muted-foreground sm:text-lg">
            {AUDIENCE_COPY[audience].lede}
          </p>
        </Reveal>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          {audiences.length > 1 && (
            <SegmentedControl
              label="Who it is for"
              value={audience}
              onChange={setAudience}
              options={audiences.map((item) => ({ value: item, label: item === "agency" ? "Agencies" : "Individual agents" }))}
            />
          )}
          {ready && offeredCycles.length > 1 && (
            <SegmentedControl
              label="Billing cycle"
              value={cycle}
              onChange={setCycle}
              options={offeredCycles.map((item) => {
                const saving = bestSaving(plans, item);
                return { value: item, label: BILLING_CYCLE_LABELS[item], note: saving ? savingLabel(saving, item) : null };
              })}
            />
          )}
        </div>
      </section>

      <section className={`${SECTION} relative -mt-[96px]`}>
        {loadError ? (
          <div className="mx-auto max-w-[720px] rounded-2xl border border-border bg-card">
          <ErrorState
            title="Pricing could not be loaded"
            detail="Nothing is wrong with your account. Try again in a moment, or ask us for prices directly."
            action={(
              <div className="flex flex-wrap justify-center gap-3">
                <Button type="button" onClick={() => window.location.reload()}>Try again</Button>
                <Button asChild variant="outline"><a href="mailto:support@insurvas.com?subject=Pricing">Contact us</a></Button>
              </div>
            )}
          />
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">No plan is open for sign-up right now. <a href="mailto:support@insurvas.com?subject=Pricing" className="font-semibold text-foreground">Contact us</a>.</div>
        ) : (
          <>
            {/* Agencies: how many people, and the band that fits lights up (redesign A, 2026-10-24). */}
            {audience === "agency" && seatBands.length > 1 && (
              <div className="mx-auto mb-6 max-w-[880px] rounded-2xl border border-border bg-card p-5 text-left sm:p-6">
                <label htmlFor="pricing-seats" className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-foreground">
                  How many people will use Insurvas?
                  <span className="text-title-sm font-semibold tabular-nums text-[var(--accent-ink)]">{teamSize.toLocaleString("en-US")} {teamSize === 1 ? "person" : "people"}</span>
                </label>
                <input id="pricing-seats" type="range" min={1} max={seatMax} value={teamSize} onChange={(event) => setTeamSize(Number(event.target.value))} className="mt-3 w-full accent-[var(--accent-ink)]" />
                <p className="mt-2 text-xs text-muted-foreground">Everyone who signs in is one seat: owner, producers, managers and assistants. An IMO or FMO with downlines? <a href="mailto:support@insurvas.com?subject=IMO%20pricing" className="font-semibold text-foreground">Talk to us</a>.</p>
              </div>
            )}

            <div className={`grid items-stretch gap-6 ${plans.length >= 3 ? "lg:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2 lg:mx-auto lg:max-w-[880px]" : "mx-auto max-w-[440px]"}`}>
              {plans.map((plan, index) => (
                <Reveal key={`${audience}-${plan.code}`} delay={index * 110} className="h-full">
                  <PricingPlanCard
                    plan={plan}
                    increment={increments[index]}
                    cycle={cycle}
                    price={cardPrice(plan, cycle)}
                    recommended={plan.code === recommendedCode}
                    pickTurn={pickTurn}
                    seats={seats[index]}
                    recommendedLabel={audience === "agency" ? "Fits your team" : "Fits what you picked"}
                  />
                </Reveal>
              ))}
            </div>

            {/* What a buyer checks before trusting a card form; each line is one the product backs. */}
            <ul className="mx-auto mt-8 flex max-w-[1000px] flex-wrap justify-center gap-x-7 gap-y-2 p-0 text-sm text-muted-foreground">
              {["Card entered on the provider’s page, never ours", "Export your book any time", "Cancel in Settings, no call needed", "No per-lead fees"].map((item) => (
                <li key={item} className="flex list-none items-center gap-2"><Check className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />{item}</li>
              ))}
            </ul>

            {audience === "individual" && plans.length > 1 && questions.length > 0 && (
              <div className="mx-auto mt-10 max-w-[960px]">
                <button
                  type="button"
                  aria-expanded={pickerOpen}
                  aria-controls="pricing-picker"
                  onClick={() => setPickerOpen((open) => !open)}
                  className="mx-auto flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
                >
                  <ChevronDown aria-hidden="true" className={`size-4 transition-transform duration-300 ease-[var(--e-out)] ${pickerOpen ? "" : "-rotate-90"}`} />
                  Not sure which plan? Tick what you do
                </button>
                <Collapse open={pickerOpen} id="pricing-picker">
                  <div className="pt-4">
                    <PricingPicker needs={questions} selected={needs} onToggle={toggleNeed} result={fit} onShow={showPlan} />
                    {needs.length > 0 && (
                      <button type="button" onClick={() => setNeeds([])} className="mt-2 text-sm font-semibold text-[var(--accent-ink)] hover:underline">Clear</button>
                    )}
                  </div>
                </Collapse>
              </div>
            )}
          </>
        )}
      </section>

      {ready && (
        <section className={`${SECTION} pt-[88px]`}>
          <Reveal className="mx-auto max-w-[680px] text-center">
            <div className={EYEBROW}>Compare</div>
            <h2 className={H2}>Every feature, plan by plan</h2>
          </Reveal>
          <div className="mt-8 flex justify-center">
            <SegmentedControl
              label="How to compare"
              value={compareView}
              onChange={setCompareView}
              options={[{ value: "table", label: "Compare table" }, { value: "explain", label: "Explain each feature" }]}
            />
          </div>
          <Reveal className="mt-8">
            {compareView === "table" ? <PricingCompareTable plans={plans} /> : <PricingExplorer plans={plans} />}
          </Reveal>
        </section>
      )}

      {addons.length > 0 && (
        <section className={`${SECTION} pt-[88px]`}>
          <Reveal className="max-w-[680px]">
            <div className={EYEBROW}>Add-ons</div>
            <h2 className={H2}>Buy the bit you actually ran out of</h2>
            <p className="mt-3.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
              Add one to any plan that offers it, without changing plan. It shows on your invoice next to the plan.
            </p>
          </Reveal>

          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
            {addons.map((addon, index) => (
              <Reveal key={addon.code} delay={index * 90}>
                <div className="h-full rounded-2xl border border-border bg-card p-6 transition-[transform,box-shadow] duration-200 ease-[var(--e-out)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)]">
                  <div className="text-title-sm font-semibold tracking-[-0.015em] text-foreground">{addon.name}</div>
                  <div className="mt-2 min-h-10 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">{addon.description ?? "Adds to any plan that offers it."}</div>
                  <div className="mt-3 text-title-sm font-semibold tracking-[-0.015em] tabular-nums text-foreground">
                    {formatCentsAsCurrency(addon.price_cents)} <span className="text-sm font-normal text-muted-foreground">{ADDON_CYCLE[addon.billing_cycle]}</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      <section className={`${SECTION} pt-[88px]`}>
        <Reveal className="mx-auto max-w-[680px] text-center">
          <div className={EYEBROW}>Questions</div>
          <h2 className={H2}>Before you enter a card</h2>
        </Reveal>

        <div className="mx-auto mt-8 max-w-[900px]">
          {faqs.map((item, index) => {
            const open = openFaq === index;
            return (
              <div key={item.q} className="border-t border-border">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`faq-${index}`}
                  onClick={() => setOpenFaq(open ? null : index)}
                  className="flex w-full items-center gap-3.5 py-[22px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
                >
                  <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform duration-300 ease-[var(--e-out)] ${open ? "text-[var(--accent-ink)]" : "-rotate-90 text-muted-foreground"}`} />
                  <span className="flex-1 text-title-sm font-semibold tracking-[-0.015em] text-foreground">{item.q}</span>
                </button>
                <Collapse open={open} id={`faq-${index}`}>
                  <p className="mb-[22px] ml-[30px] max-w-[820px] text-base leading-normal tracking-[-0.02em] text-muted-foreground">{item.a}</p>
                </Collapse>
              </div>
            );
          })}
          <div className="border-t border-border" />
        </div>
      </section>

      <section className="relative isolate mt-[88px] overflow-hidden bg-[var(--primary-soft)] px-4 py-[72px] text-center sm:px-6 lg:px-16">
        <Reveal>
          <h2 className="text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">{closingLine}</h2>
          <div className="mt-7 flex justify-center gap-3.5">
            <Button asChild className="h-12 rounded-full px-7 text-base shadow-[var(--shadow-brand)]">
              <Link href={leadPlan ? `/signup?plan=${encodeURIComponent(leadPlan.code)}&cycle=${cycle}` : "/signup"}>Start your trial</Link>
            </Button>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
