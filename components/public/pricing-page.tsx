"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/page-states";
import { Reveal, usePrefersReducedMotion } from "@/components/marketing/motion";
import heroStyles from "@/components/marketing/landing-hero.module.css";
import { MarketingCta } from "@/components/marketing/cta";
import { PriceCard, PriceLadder, cyclePrice, ladderRows, monthlyNumber, rowsFor, tierName } from "@/components/marketing/price-card";
import { PricingCompare } from "@/components/public/pricing-compare";
import { Collapse, PRICING_CSS, SegmentedControl } from "@/components/public/pricing-motion";
import { PricingPicker } from "@/components/public/pricing-picker";
import {
  BILLING_CYCLE_LABELS,
  CYCLE_MONTHS,
  formatCentsAsCurrency,
  parseDollarsToCents,
  type BillingCycle,
} from "@/lib/money";
import { availableNeeds, recommendPlan } from "@/lib/pricing/planFit";
import { publicPriceForCycle, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * The public pricing page (board p-pub-pricing; redesigned 2026-10-13; pricing r1 2026-11-19).
 *
 * Prices and plan contents are read from the live catalog on the server and passed in. The page
 * reads, in order: who it is for and the billing cycle; the plans, on the landing page's price cards
 * (components/marketing/price-card.tsx, one card for both pages); a "Which plan fits you?" picker for
 * agents; "What changes between plans" (pricing r1 option A); add-ons; questions; the closing call.
 *
 * Three audiences (pricing r1, owner 2026-11-19), one at a time behind the switch at the top:
 * - Agent: an independent agent with no team, on the individual plans (Ledger, Basic, Advanced).
 * - Agency: the agency plans (AG-0.12's seat bands, until the one base price + seat add-on lands).
 * - IMO & FMO: no price, "Talk to us for pricing".
 * ?for=agency and ?for=imo link straight to a view. Monthly / Yearly only.
 */
export type PricingAudience = "individual" | "agency" | "imo";

const AUDIENCE_COPY: Record<PricingAudience, { title: string; lede: string }> = {
  individual: {
    title: "Priced per workspace. Never per lead.",
    lede: "For an independent agent working on their own. You already pay your vendors for every lead, so Insurvas is priced by plan and the lead you bought is not charged twice.",
  },
  agency: {
    title: "One flat price for your whole agency.",
    lede: "Pick the band your team fits in. Producers, managers and assistants all work inside it, with payouts, lead routing and the agency dashboard included — never priced per lead.",
  },
  imo: {
    title: "Built for IMOs and FMOs.",
    lede: "Agencies and agents beneath you, on one platform. We price it to your downline, so talk to us.",
  },
};

const AUDIENCE_LABELS: Record<PricingAudience, string> = { individual: "Agent", agency: "Agency", imo: "IMO & FMO" };
const CYCLES = ["monthly", "yearly"] as const satisfies readonly BillingCycle[];
const IMO_MAIL = "mailto:support@insurvas.com?subject=IMO%20%2F%20FMO%20pricing";

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

/** The tab in each card's corner, as on the landing page. */
function tabLabel(index: number, count: number, recommended: number, audience: PricingAudience) {
  if (index === recommended) return "Recommended";
  if (index === 0) return audience === "agency" ? "Small team" : "Start here";
  if (index === count - 1) return audience === "agency" ? "Large floor" : "Everything";
  return null;
}

const ADDON_CYCLE: Record<BillingCycle, string> = { monthly: "/ month", quarterly: "/ quarter", yearly: "/ year" };

const SECTION = "mx-auto max-w-7xl px-4 sm:px-6 lg:px-16";
const EYEBROW = "text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--accent-ink)]";
const H2 = "mt-3 text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg";

export function PricingPage({ plans: catalog, addons, loadError, initialAudience = "individual" }: { plans: PublicPlan[]; addons: PricingAddon[]; loadError: string | null; initialAudience?: PricingAudience }) {
  // IMO & FMO is offered once there is an agency product for it to build on.
  const audiences = useMemo<PricingAudience[]>(() => {
    const sold = (["individual", "agency"] as const).filter((item) => catalog.some((plan) => plan.audience === item));
    return sold.includes("agency") ? [...sold, "imo"] : [...sold];
  }, [catalog]);
  const [audience, setAudienceState] = useState<PricingAudience>(audiences.includes(initialAudience) ? initialAudience : audiences[0] ?? "individual");
  // Set once the visitor switches audience, so the new ladder rises in; the first one is scroll-revealed.
  const [swapped, setSwapped] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [needs, setNeeds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const reduced = usePrefersReducedMotion();

  const setAudience = useCallback((next: PricingAudience) => {
    setAudienceState(next);
    setSwapped(true);
    setPicked(null);
    setNeeds([]);
    // Shareable: /pricing?for=agency and /pricing?for=imo open those views.
    const url = new URL(window.location.href);
    if (next === "individual") url.searchParams.delete("for");
    else url.searchParams.set("for", next);
    window.history.replaceState(null, "", url);
  }, []);

  const individual = useMemo(() => catalog.filter((plan) => plan.audience === "individual").sort((a, b) => monthlyNumber(a) - monthlyNumber(b)), [catalog]);
  const agency = useMemo(() => catalog.filter((plan) => plan.audience === "agency").sort((a, b) => monthlyNumber(a) - monthlyNumber(b)), [catalog]);
  const ladder = audience === "individual" ? individual : audience === "agency" ? agency : [];
  const sellable = audience === "imo" ? agency : ladder;

  const offeredCycles = useMemo(() => CYCLES.filter((candidate) => candidate === "monthly" || catalog.some((plan) => publicPriceForCycle(plan, candidate))), [catalog]);
  const questions = useMemo(() => availableNeeds(individual), [individual]);
  const fit = useMemo(
    () => recommendPlan(individual.map((plan) => ({ ...plan, monthlyCents: plan.price_monthly ? parseDollarsToCents(plan.price_monthly) : null })), needs),
    [individual, needs],
  );

  // As on the landing page: the middle of three cards is recommended and starts selected. The
  // picker's answer selects its card instead.
  const recommended = ladder.length === 3 ? 1 : Math.max(0, ladder.findIndex((plan) => plan.is_default));
  const fitIndex = audience === "individual" && fit.status === "match" ? ladder.findIndex((plan) => plan.code === fit.code) : -1;
  const selected = picked ?? (fitIndex >= 0 ? fitIndex : recommended);
  const rows = useMemo(() => ladderRows(ladder, audience === "agency"), [ladder, audience]);

  const yearlySaving = bestSaving(sellable, "yearly");
  const leadPlan = ladder[recommended] ?? ladder[0] ?? null;
  const closingLine = audience === "imo"
    ? "Tell us about your downline. We will price it with you."
    : audience === "agency"
      ? "Start on the band your team fits. Move up the day you grow."
      : leadPlan
        ? `Start on ${leadPlan.name}. Move up or down as you grow.`
        : "Start your trial. Export your data either way.";

  const faqs = [
    // One story everywhere (signup, checkout, landing): a card is entered at checkout, $0 is charged
    // for the trial, then the plan renews automatically until cancelled.
    { q: "What happens when the trial ends?", a: "You enter a card at checkout, and nothing is charged during the trial. When it ends, the plan’s price is charged to that card and the subscription renews automatically each billing period until you cancel. Cancel before the trial ends, in Settings › Plan & billing, and you are not charged. Taxes may apply. If a later payment fails, the workspace stays readable and writing is paused until it is settled." },
    { q: "Is there a per-lead charge?", a: "No. A plan is priced per workspace, not per lead: you already pay your vendors for every lead, and we do not charge you for it again. Add-ons you choose, and metered usage above your plan’s allowance, are billed at the rates shown." },
    { q: "Can I bring my existing book?", a: "Yes. Upload your carriers’ policy and commission files, or forward the emails they arrive in, and every policy is matched to its client and agent. You can also import a book you keep in a spreadsheet." },
    { q: "Can I change plan mid-cycle?", a: "Yes. You choose whether it applies now with proration or at renewal, and the confirmation names the effective date before anything moves." },
    { q: "What happens to existing subscribers when you change a plan?", a: "They keep the version they bought. Plans are versioned, so publishing a new version leaves every current subscriber on theirs until they renew." },
    ...(audience !== "individual"
      ? [
          { q: "Who uses a seat?", a: "Every accepted, working member of the agency: the owner, producers, managers and assistants. Each person is one seat, whatever they do." },
          { q: "What happens when my team outgrows its band?", a: "Move up a band at any time: the change applies straight away and you pay the prorated difference for the rest of the period. Moving down takes effect at the end of the period, with no refund." },
        ]
      : []),
    yearlySaving
      ? { q: "Do you offer a discount for yearly billing?", a: `Yes — ${savingLabel(yearlySaving, "yearly")} on yearly billing. Switch the toggle above and the prices update.` }
      : { q: "Do you offer a discount for yearly billing?", a: "Not on these plans at the moment: they are billed at the same monthly rate whichever cycle you choose." },
  ];

  const toggleNeed = (id: string) => {
    setNeeds((now) => (now.includes(id) ? now.filter((item) => item !== id) : [...now, id]));
    setPicked(null);
  };
  const showPlan = (code: string) => {
    const index = ladder.findIndex((plan) => plan.code === code);
    if (index >= 0) setPicked(index);
    document.getElementById(`plan-${code}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  };
  const showAgency = useCallback(() => {
    setAudience("agency");
    document.getElementById("pricing-top")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [setAudience, reduced]);

  const ready = !loadError && catalog.length > 0;
  const imoRows = useMemo(() => {
    const top = agency.length ? agency[agency.length - 1] : null;
    const teamOnly = top ? top.features.filter((feature) => feature.moduleLabel === "Agency") : [];
    return [
      { key: "everything-in-agency", label: "Everything in Agency", included: true, lead: true },
      ...teamOnly.map((feature) => ({ key: feature.key, label: feature.label, included: true })),
    ];
  }, [agency]);

  return (
    <main className="overflow-x-clip">
      <style>{PRICING_CSS}</style>

      {/* The landing page's deep-olive hero (2026-11-03), so going from the landing page to pricing
          reads as one site. The cards sit below it on the page's own ground, as on the landing page,
          so each card's corner tab shows the colour it is cut from. */}
      <section id="pricing-top" className={`relative isolate scroll-mt-0 overflow-hidden px-4 pb-[72px] pt-[128px] text-center sm:px-6 sm:pt-[144px] lg:px-16 ${heroStyles.pricingHero}`}>
        <div aria-hidden="true" className={heroStyles.backdrop} />
        <Reveal>
          <h1 key={audience} className="pz-swap mx-auto max-w-[860px] text-balance text-headline-lg font-semibold leading-[1.0] tracking-[-0.035em] text-[var(--nav-ink)] sm:text-hero lg:text-[clamp(3.25rem,5.4vw,4.5rem)]">
            {AUDIENCE_COPY[audience].title}
          </h1>
          <p key={`${audience}-lede`} className="pz-swap mx-auto mt-5 max-w-[600px] text-base leading-[1.65] tracking-[-0.01em] text-[var(--nav-muted)] sm:text-lg" style={{ animationDelay: "60ms" }}>
            {AUDIENCE_COPY[audience].lede}
          </p>
        </Reveal>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          {audiences.length > 1 && (
            <SegmentedControl
              label="Who it is for"
              value={audience}
              onChange={setAudience}
              options={audiences.map((item) => ({ value: item, label: AUDIENCE_LABELS[item] }))}
            />
          )}
          {ready && offeredCycles.length > 1 && (
            <SegmentedControl
              label="Billing cycle"
              value={cycle}
              onChange={setCycle}
              options={offeredCycles.map((item) => {
                const saving = bestSaving(catalog, item);
                return { value: item, label: BILLING_CYCLE_LABELS[item], note: saving ? savingLabel(saving, item) : null };
              })}
            />
          )}
        </div>
      </section>

      <section className={`${SECTION} pt-[72px]`}>
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
        ) : catalog.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">No plan is open for sign-up right now. <a href="mailto:support@insurvas.com?subject=Pricing" className="font-semibold text-foreground">Contact us</a>.</div>
        ) : (
          <>
            {audience === "imo" ? (
              <PriceLadder count={1} swapKey={audience}>
                <PriceCard
                  id="plan-imo"
                  entering={swapped}
                  name="IMO & FMO"
                  tab="Custom"
                  featured
                  selected
                  onSelect={() => undefined}
                  price={{ kind: "contact", title: "Talk to us for pricing", note: "Priced to your downline and how you pay it." }}
                  blurb="For marketing organisations running agencies and agents beneath them."
                  rows={imoRows}
                  cta={{ href: IMO_MAIL, label: "Talk to us" }}
                />
              </PriceLadder>
            ) : (
              <PriceLadder count={ladder.length} swapKey={audience}>
                {ladder.map((plan, index) => (
                  <PriceCard
                    key={plan.code}
                    id={`plan-${plan.code}`}
                    index={index}
                    entering={swapped}
                    name={tierName(plan)}
                    tab={tabLabel(index, ladder.length, recommended, audience)}
                    featured={index === recommended}
                    selected={index === selected}
                    onSelect={() => setPicked(index)}
                    price={cyclePrice(plan, cycle)}
                    blurb={plan.blurb}
                    rows={rowsFor(plan, rows)}
                    cta={{ href: `/signup?plan=${encodeURIComponent(plan.code)}&cycle=${cycle}`, label: plan.trial_days > 0 ? `Start ${plan.trial_days}-day free trial` : "Get started" }}
                    wrap={swapped ? undefined : (card) => <Reveal variant="rise" delay={index * 110} className="h-full">{card}</Reveal>}
                  />
                ))}
              </PriceLadder>
            )}

            {/* What a buyer checks before trusting a card form; each line is one the product backs. */}
            <ul className="mx-auto mt-10 flex max-w-[1000px] flex-wrap justify-center gap-x-7 gap-y-2 p-0 text-sm text-muted-foreground">
              {["Card entered on the provider’s page, never ours", "Export your book any time", "Cancel in Settings, no call needed", "No per-lead fees"].map((item) => (
                <li key={item} className="flex list-none items-center gap-2"><Check className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />{item}</li>
              ))}
            </ul>

            {audience === "individual" && ladder.length > 1 && questions.length > 0 && (
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
            <h2 className={H2}>What you get on each plan</h2>
            <p className="mt-3.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">What changes between plans comes first. Open the table to see every feature.</p>
          </Reveal>
          <Reveal className="mt-8">
            <PricingCompare plans={catalog} cycle={cycle} onCycleChange={setCycle} onShowAgency={showAgency} variant="collapsed" />
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
            {audience === "imo"
              ? <MarketingCta href={IMO_MAIL}>Talk to us</MarketingCta>
              : <MarketingCta href={leadPlan ? `/signup?plan=${encodeURIComponent(leadPlan.code)}&cycle=${cycle}` : "/signup"}>Start your free trial</MarketingCta>}
          </div>
        </Reveal>
      </section>
    </main>
  );
}
