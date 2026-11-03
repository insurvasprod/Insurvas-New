"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Users } from "lucide-react";

import { MarketingCta } from "@/components/marketing/cta";
import { Reveal } from "@/components/marketing/motion";
import styles from "@/components/marketing/landing-pricing.module.css";
import { featuresByModule, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * The pricing teaser (2026-11-03): the owner's reference layout. The middle plan starts lifted; click
 * (or Enter on) any plan and it comes to the front while the others settle back. Every price, plan name, blurb, module and trial length
 * is read from the live catalog — nothing is typed in (UI-CONSISTENCY §13) — so the teaser can never
 * promise what a plan does not grant. Each step lists only the modules it adds to the one below.
 */
function monthlyNumber(plan: PublicPlan) {
  const n = plan.price_monthly ? Number(plan.price_monthly.replace(/[^0-9.]/g, "")) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** "2499.00" → { whole: "$2,499", cents: ".00" }, the way /pricing shows the same plan. */
function price(value: string) {
  const n = Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return { whole: value, cents: "" };
  const [whole, cents] = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(".");
  return { whole: `$${whole}`, cents: `.${cents}` };
}

export function LandingPricingTeaser({ plans }: { plans: PublicPlan[] }) {
  // The ladder is the individual-agent plans; agencies get one line under it, to their own view of
  // /pricing (2026-10-22: the agency seat bands are a different purchase, not a fourth rung).
  const ladder = plans.filter((plan) => plan.audience === "individual").sort((a, b) => monthlyNumber(a) - monthlyNumber(b));
  const agencyFrom = plans.filter((plan) => plan.audience === "agency").sort((a, b) => monthlyNumber(a) - monthlyNumber(b))[0] ?? null;
  const trialDays = ladder.find((plan) => plan.trial_days > 0)?.trial_days ?? null;
  // The lifted plan: the middle one of three to start with (the reference layout), then whichever
  // plan the visitor picks. Picking moves the lift, the badge and the bright button across.
  const [picked, setPicked] = useState(() => (ladder.length === 3 ? 1 : Math.max(0, ladder.findIndex((plan) => plan.is_default))));

  return (
    <section id="pricing" aria-labelledby="pricing-title" className={styles.section}>
      <div className={styles.inner}>
        <Reveal className={styles.head}>
          <p className={styles.eyebrow}>Pricing</p>
          <h2 id="pricing-title" className={styles.title}>Priced per workspace, never per lead.</h2>
          <p className={styles.lede}>
            You already pay your vendors by the lead. Start with your book, add the floor and the dialer when you are ready
            {trialDays ? <> — <b>{trialDays} days free</b>, with nothing charged until the trial ends</> : null}. Add-ons and usage above a plan’s allowance are priced separately.
          </p>
        </Reveal>

        {ladder.length > 0 && (
          <div className={styles.ladder} data-count={ladder.length}>
            {ladder.map((plan, index) => {
              const below = index > 0 ? new Set(ladder[index - 1].features.map((feature) => feature.module)) : new Set<string>();
              const modules = featuresByModule(plan.features).filter((group) => !below.has(group.module));
              const featured = index === picked;
              const amount = plan.price_monthly ? price(plan.price_monthly) : null;
              const highlights = [
                ...(index > 0 ? [`Everything in ${ladder[index - 1].name}`] : []),
                ...modules.map((group) => `${group.label} · ${group.features.length} ${group.features.length === 1 ? "feature" : "features"}`),
              ];
              return (
                <Reveal key={plan.code} variant="rise" delay={index * 110} className={styles.cell}>
                  <article
                    className={`${styles.card} ${featured ? styles.featured : ""}`}
                    tabIndex={0}
                    aria-current={featured ? "true" : undefined}
                    aria-label={`${plan.name} plan${featured ? ", selected" : ", select to compare"}`}
                    onClick={(event) => { if (!(event.target as HTMLElement).closest("a")) setPicked(index); }}
                    onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); setPicked(index); } }}
                  >
                    <span className={styles.badge} aria-hidden={!featured}>{plan.trial_days > 0 ? `${plan.trial_days}-day free trial` : "Selected"}</span>
                    <header className={styles.cardHead}>
                      <p className={styles.tier}>{plan.name}</p>
                      {amount ? (
                        <div className={styles.price}><span className={styles.whole}>{amount.whole}</span><span className={styles.per}>/month</span></div>
                      ) : (
                        <div className={styles.whole}>{plan.name}</div>
                      )}
                      {plan.blurb && <p className={styles.blurb}>{plan.blurb}</p>}
                    </header>
                    <div className={styles.highlights}>
                      <p className={styles.includes}>Plan highlights</p>
                      <ul className={styles.modules}>
                        {highlights.map((text) => (
                          <li key={text}><Check aria-hidden="true" /><span>{text}</span></li>
                        ))}
                      </ul>
                    </div>
                    <footer className={styles.cardFoot}>
                      <Link href={`/signup?plan=${encodeURIComponent(plan.code)}`} className={`${styles.planCta} ${featured ? styles.planCtaFeatured : ""}`}>Start free trial</Link>
                      <p className={styles.footNote}>Nothing charged until the trial ends. <Link href="/pricing" tabIndex={featured ? 0 : -1}>See every plan</Link></p>
                    </footer>
                  </article>
                </Reveal>
              );
            })}
          </div>
        )}

        <div className={styles.foot}>
          {agencyFrom && (
            <p className={styles.agency}>
              <span className={styles.agencyIcon} aria-hidden="true"><Users /></span>
              <span>
                Running an agency? One flat price for the whole team, from{" "}
                <b>{agencyFrom.price_monthly ? `${price(agencyFrom.price_monthly).whole}${price(agencyFrom.price_monthly).cents}/month` : "a flat band"}</b>
                {agencyFrom.max_seats ? ` for up to ${agencyFrom.max_seats} seats` : ""}.
              </span>
              <Link href="/pricing?for=agency">See agency pricing<ArrowRight aria-hidden="true" /></Link>
            </p>
          )}
          <MarketingCta href="/pricing" variant="secondary">Compare every plan</MarketingCta>
        </div>
      </div>
    </section>
  );
}
