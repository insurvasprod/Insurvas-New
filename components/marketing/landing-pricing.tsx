"use client";

import { useState } from "react";

import { Reveal } from "@/components/marketing/motion";
import { PriceCard, PriceLadder, ladderRows, monthlyNumber, rowsFor, tierName, wholeDollars } from "@/components/marketing/price-card";
import styles from "@/components/marketing/landing-pricing.module.css";
import type { PublicPlan } from "@/lib/publicPlans/types";

/**
 * The pricing teaser. Since 2026-11-04 (owner's reference, a three-card pricing page): each card
 * has a tab cut into its top corner, a large price with how it is billed beneath, the plan's blurb,
 * and the same list of features on every card, ticked where the plan has it and crossed where it
 * does not, so the step from one plan to the next reads straight across. A switch on top shows the
 * agent's plans or the team (agency) seat bands in the same cards.
 *
 * The card itself is components/marketing/price-card.tsx since 2026-11-19, shared with /pricing so
 * both pages show the same card (pricing r1).
 *
 * Every price, plan name, blurb, feature and trial length is read from the live catalog — nothing
 * is typed in (UI-CONSISTENCY §13) — so the teaser can never promise what a plan does not grant.
 */

/** The tab in each card's corner. */
function tabLabel(index: number, count: number, recommended: number, audience: "individual" | "agency") {
  if (index === recommended) return "Recommended";
  if (index === 0) return audience === "agency" ? "Small team" : "Start here";
  if (index === count - 1) return audience === "agency" ? "Large floor" : "Everything";
  return null;
}

export function LandingPricingTeaser({ plans }: { plans: PublicPlan[] }) {
  // One ladder at a time: the independent agent's plans, or the team's seat bands (2026-11-04, owner).
  const audiences = (["individual", "agency"] as const).filter((who) => plans.some((plan) => plan.audience === who));
  const [audience, setAudience] = useState<"individual" | "agency">("individual");
  const [picked, setPicked] = useState<number | null>(null);
  const ladder = plans.filter((plan) => plan.audience === audience).sort((a, b) => monthlyNumber(a) - monthlyNumber(b));
  const trialDays = ladder.find((plan) => plan.trial_days > 0)?.trial_days ?? null;
  // Both views look the same (owner, 2026-11-04): the middle card is recommended and every card has its tab.
  const recommended = ladder.length === 3 ? 1 : Math.max(0, ladder.findIndex((plan) => plan.is_default));
  const selected = picked ?? recommended;
  const rows = ladderRows(ladder, audience === "agency");

  return (
    <section id="pricing" aria-labelledby="pricing-title" className={styles.section}>
      <div className={styles.inner}>
        <Reveal className={styles.head}>
          <h2 id="pricing-title" className={styles.title}>Priced per workspace, never per lead.</h2>
          <p className={styles.lede}>
            {trialDays ? <><b>{trialDays} days free on every plan.</b> Nothing charged until the trial ends.</> : "Start with your book, and add the floor and the dialer when you are ready."}
          </p>
          {audiences.length > 1 && (
            <div className={styles.switch} role="group" aria-label="Plans for">
              {audiences.map((who) => (
                <button key={who} type="button" aria-pressed={audience === who} onClick={() => { setAudience(who); setPicked(null); }}>
                  {who === "individual" ? "Agent workspace" : "Team workspace"}
                </button>
              ))}
            </div>
          )}
        </Reveal>

        {ladder.length > 0 && (
          <PriceLadder count={ladder.length} swapKey={audience} className={styles.ladder}>
            {ladder.map((plan, index) => (
              <PriceCard
                key={plan.code}
                index={index}
                name={tierName(plan)}
                tab={tabLabel(index, ladder.length, recommended, audience)}
                featured={index === recommended}
                selected={index === selected}
                onSelect={() => setPicked(index)}
                price={plan.price_monthly ? {
                  kind: "amount",
                  whole: wholeDollars(plan.price_monthly),
                  rank: monthlyNumber(plan),
                  lines: ["/ month (USD)", plan.price_yearly ? `${wholeDollars(plan.price_yearly)} billed yearly` : plan.trial_days > 0 ? `${plan.trial_days}-day free trial` : "Billed monthly"],
                } : null}
                blurb={plan.blurb}
                rows={rowsFor(plan, rows)}
                cta={{ href: `/signup?plan=${encodeURIComponent(plan.code)}`, label: plan.trial_days > 0 ? `Start ${plan.trial_days}-day free trial` : "Start free trial" }}
                wrap={(card) => <Reveal variant="rise" delay={index * 110} className="h-full">{card}</Reveal>}
              />
            ))}
          </PriceLadder>
        )}

      </div>
    </section>
  );
}
