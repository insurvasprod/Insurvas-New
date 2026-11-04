"use client";

import Link from "next/link";
import { ArrowRight, Check, Users, X } from "lucide-react";

import { Reveal } from "@/components/marketing/motion";
import styles from "@/components/marketing/landing-pricing.module.css";
import { featuresByModule, type PublicFeature, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * The pricing teaser. Since 2026-11-04 (owner's reference, a three-card pricing page): each card
 * has a tab cut into its top corner, a large price with how it is billed beneath, the plan's blurb,
 * and the same list of features on every card, ticked where the plan has it and crossed where it
 * does not, so the step from one plan to the next reads straight across. The recommended plan is the
 * raised card with the hatched edge.
 *
 * Every price, plan name, blurb, feature and trial length is read from the live catalog — nothing
 * is typed in (UI-CONSISTENCY §13) — so the teaser can never promise what a plan does not grant.
 */
function monthlyNumber(plan: PublicPlan) {
  const n = plan.price_monthly ? Number(plan.price_monthly.replace(/[^0-9.]/g, "")) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** "2499.00" → "$2,499", the way the cards show a whole-dollar price. */
function dollars(value: string) {
  const n = Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return value;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/**
 * The rows every card shares: the top plan's features, one from each module in turn, so the list
 * shows the whole product and the lower plans' crosses show what they leave out.
 */
function comparisonRows(top: PublicPlan, limit: number) {
  const groups = featuresByModule(top.features);
  const rows: PublicFeature[] = [];
  for (let round = 0; rows.length < limit && groups.some((group) => group.features.length > round); round += 1) {
    for (const group of groups) {
      if (rows.length < limit && group.features[round]) rows.push(group.features[round]);
    }
  }
  // Read top to bottom in the catalog order, not the order they were picked in.
  return rows.sort((a, b) => a.moduleOrder - b.moduleOrder || a.order - b.order);
}

/** The tab in each card's corner. */
function tabLabel(index: number, count: number, recommended: number) {
  if (index === recommended) return "Recommended";
  if (index === 0) return "Start here";
  if (index === count - 1) return "Everything";
  return null;
}

export function LandingPricingTeaser({ plans }: { plans: PublicPlan[] }) {
  // The ladder is the individual-agent plans; agencies get one line under it, to their own view of
  // /pricing (2026-10-22: the agency seat bands are a different purchase, not a fourth rung).
  const ladder = plans.filter((plan) => plan.audience === "individual").sort((a, b) => monthlyNumber(a) - monthlyNumber(b));
  const agencyFrom = plans.filter((plan) => plan.audience === "agency").sort((a, b) => monthlyNumber(a) - monthlyNumber(b))[0] ?? null;
  const trialDays = ladder.find((plan) => plan.trial_days > 0)?.trial_days ?? null;
  const recommended = ladder.length === 3 ? 1 : Math.max(0, ladder.findIndex((plan) => plan.is_default));
  const rows = ladder.length ? comparisonRows(ladder[ladder.length - 1], 10) : [];

  return (
    <section id="pricing" aria-labelledby="pricing-title" className={styles.section}>
      <div className={styles.inner}>
        <Reveal className={styles.head}>
          <h2 id="pricing-title" className={styles.title}>Priced per workspace, never per lead.</h2>
          <p className={styles.lede}>
            {trialDays ? <><b>{trialDays} days free on every plan.</b> Nothing charged until the trial ends.</> : "Start with your book, and add the floor and the dialer when you are ready."}
          </p>
        </Reveal>

        {ladder.length > 0 && (
          <div className={styles.ladder} data-count={ladder.length}>
            {ladder.map((plan, index) => {
              const featured = index === recommended;
              const has = new Set(plan.features.map((feature) => feature.key));
              const tab = tabLabel(index, ladder.length, recommended);
              return (
                <Reveal key={plan.code} variant="rise" delay={index * 110} className={styles.cell}>
                  <article className={`${styles.card} ${featured ? styles.featured : ""}`} aria-label={`${plan.name} plan`}>
                    {tab && <span className={styles.tab}>{tab}<i aria-hidden="true" /></span>}
                    <header className={styles.cardHead}>
                      <h3 className={styles.tier}>{plan.name}</h3>
                      {plan.price_monthly ? (
                        <div className={styles.price}>
                          <span className={styles.whole}>{dollars(plan.price_monthly)}</span>
                          <span className={styles.per}>
                            <span>/ month (USD)</span>
                            <span>{plan.price_yearly ? `${dollars(plan.price_yearly)} billed yearly` : plan.trial_days > 0 ? `${plan.trial_days}-day free trial` : "Billed monthly"}</span>
                          </span>
                        </div>
                      ) : null}
                      {plan.blurb && <p className={styles.blurb}>{plan.blurb}</p>}
                    </header>
                    <ul className={styles.rows}>
                      {rows.map((row) => {
                        const included = has.has(row.key);
                        return (
                          <li key={row.key} data-included={included}>
                            <span className={styles.mark} aria-hidden="true">{included ? <Check /> : <X />}</span>
                            <span>{row.label}</span>
                            {!included && <span className="sr-only"> (not included)</span>}
                          </li>
                        );
                      })}
                    </ul>
                    <footer className={styles.cardFoot}>
                      <Link href={`/signup?plan=${encodeURIComponent(plan.code)}`} className={`${styles.planCta} ${featured ? styles.planCtaFeatured : ""}`}>
                        {plan.trial_days > 0 ? `Start ${plan.trial_days}-day free trial` : "Start free trial"}
                      </Link>
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
                <b>{agencyFrom.price_monthly ? `${dollars(agencyFrom.price_monthly)}/month` : "a flat band"}</b>
                {agencyFrom.max_seats ? ` for up to ${agencyFrom.max_seats} seats` : ""}.
              </span>
              <Link href="/pricing?for=agency">See agency pricing<ArrowRight aria-hidden="true" /></Link>
            </p>
          )}
          <Link href="/pricing" className={styles.compare}>Compare every plan<ArrowRight aria-hidden="true" /></Link>
          <p className={styles.fine}>Add-ons and usage above a plan’s allowance are priced separately.</p>
        </div>
      </div>
    </section>
  );
}
