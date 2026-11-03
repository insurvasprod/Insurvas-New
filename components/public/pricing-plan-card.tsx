"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ModuleIcon, RollingValue } from "@/components/public/pricing-motion";
import { formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import type { ModuleGroup, PlanIncrement } from "@/lib/pricing/planFit";
import type { PublicPlan } from "@/lib/publicPlans/types";

/** A module longer than this shows its first few features and a "+N more". */
const VISIBLE_PER_MODULE = 3;

export type CardPrice = { totalCents: number; monthlyCents: number; saving: number | null } | null;

function ModuleBlock({ group }: { group: ModuleGroup }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = group.features.length - VISIBLE_PER_MODULE;
  const rows = expanded || hidden <= 0 ? group.features : group.features.slice(0, VISIBLE_PER_MODULE);
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--primary-soft)] text-[var(--accent-ink)]">
          <ModuleIcon module={group.module} className="size-3.5" />
        </span>
        <span className="text-sm font-semibold tracking-[-0.01em] text-foreground">{group.label}</span>
      </div>
      <ul className="mt-1.5 pl-[38px]">
        {rows.map((feature, index) => (
          <li
            key={feature.key}
            className={`flex gap-2 py-1 ${index >= VISIBLE_PER_MODULE ? "pz-swap" : ""}`}
            style={index >= VISIBLE_PER_MODULE ? { animationDelay: `${(index - VISIBLE_PER_MODULE) * 40}ms` } : undefined}
          >
            <Check aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 stroke-[3] text-[var(--accent-ink)]" />
            <span className="text-sm leading-normal tracking-[-0.01em] text-[var(--body)]">{feature.label}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((now) => !now)}
          className="mt-0.5 ml-[38px] rounded text-xs font-semibold text-[var(--accent-ink)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
        >
          {expanded ? "Show less" : `+${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One plan (2026-10-13 pricing): no tilt, no glare. The default plan carries a slow rotating
 * gradient border and a breathing glow; the picker's answer gets a ring that settles in.
 */
export function PricingPlanCard({ plan, increment, cycle, price, recommended, pickTurn, seats = null, recommendedLabel = "Fits what you picked" }: { plan: PublicPlan; increment: PlanIncrement; cycle: BillingCycle; price: CardPrice; recommended: boolean; pickTurn: number; /** An agency band's seat range ("Up to 50 seats"), shown under the price. */ seats?: string | null; /** What the ring means: the picker's answer, or the band the team-size slider lands on. */ recommendedLabel?: string }) {
  const featured = plan.is_default;
  const signupHref = `/signup?plan=${encodeURIComponent(plan.code)}&cycle=${cycle}`;
  const moduleCount = increment.modules.length;

  return (
    <div id={`plan-${plan.code}`} className="relative h-full scroll-mt-28">
      {recommended && (
        <div key={`pick-${pickTurn}`} aria-hidden="true" className="pz-pick pointer-events-none absolute -inset-[7px] rounded-[24px] border-2 border-[var(--primary)] shadow-[var(--shadow-brand)]" />
      )}

      {/* A still, emphasised border for the plan we lead with (redesign A, 2026-10-24): the rotating
          ring and breathing glow drew the eye away from the price. */}
      <div className={`relative h-full overflow-hidden rounded-[18px] shadow-[0_18px_40px_color-mix(in_srgb,var(--ink)_8%,transparent)] ${featured ? "bg-[var(--primary)] p-[2px]" : "bg-[var(--border)] p-px"}`}>
        <div className="relative flex h-full flex-col rounded-[16px] bg-card p-6 sm:p-7">
          <div className="flex min-h-7 flex-wrap items-center gap-2">
            <h3 className="text-title-sm font-semibold tracking-[-0.015em] text-foreground">{plan.name}</h3>
            {featured && (
              <span className="rounded-full bg-[var(--primary)] px-2.5 py-0.5 text-xs font-semibold text-[var(--on-primary)]">Recommended</span>
            )}
            {recommended && (
              <span key={`fit-${pickTurn}`} className="pz-swap rounded-full bg-[var(--primary-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-ink)]">{recommendedLabel}</span>
            )}
          </div>
          <p className="mt-2 min-h-[42px] text-sm leading-normal tracking-[-0.01em] text-muted-foreground">{plan.blurb ?? ""}</p>

          {price == null ? (
            <div className="mt-5 rounded-lg bg-[var(--surface-alt)] px-4 py-5 text-sm text-muted-foreground">Not available on the {cycle} cycle</div>
          ) : (
            <>
              <div className="mt-5 flex flex-wrap items-baseline gap-x-1.5">
                {/* "$99", not "$99.00": the cents only when there are some, so three prices fit side by side. */}
                <RollingValue value={price.monthlyCents % 100 === 0 ? `$${(price.monthlyCents / 100).toLocaleString("en-US")}` : formatCentsAsCurrency(price.monthlyCents)} rank={price.monthlyCents} className="shrink-0 whitespace-nowrap text-headline-lg font-semibold tracking-[-0.03em] tabular-nums text-foreground" />
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              <div key={cycle} className="pz-fade mt-1 min-h-[18px] text-xs font-semibold tracking-[-0.01em] text-[var(--accent-ink)]">
                {cycle === "monthly" ? "Billed monthly" : `${formatCentsAsCurrency(price.totalCents)} billed ${cycle}`}
                {price.saving ? ` · save ${price.saving}%` : ""}
              </div>
            </>
          )}

          {seats && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm font-semibold text-foreground">
              <Users className="size-4 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" />
              {seats}
              <span className="font-normal text-muted-foreground">· one flat price</span>
            </div>
          )}

          <div className="mt-5">
            {price != null ? (
              <>
                <Button asChild variant={featured ? "default" : "secondary"} className={`h-12 w-full rounded-full ${featured ? "shadow-[var(--shadow-brand)]" : "border-[var(--border-strong)]"}`}>
                  <Link href={signupHref}>{plan.trial_days > 0 ? `Start ${plan.trial_days}-day trial` : "Get started"}</Link>
                </Button>
                {/* The trial terms where the decision is made, not in a footnote. */}
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {plan.trial_days > 0 ? "$0 today · cancel any time in Settings" : "Cancel any time in Settings"}
                </p>
              </>
            ) : (
              <Button disabled variant="secondary" className="h-11 w-full rounded-full border-[var(--border-strong)]">Cycle unavailable</Button>
            )}
          </div>

          <div className="mt-6 flex-1 border-t border-border pt-5">
            <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {increment.buildsOn ? `Everything in ${increment.buildsOn.name}${moduleCount ? ", plus" : ""}` : "What's included"}
            </div>
            {moduleCount === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{increment.buildsOn ? (seats ? "The same features, for a bigger team." : "Nothing more on this plan.") : "No features are listed for this plan yet."}</p>
            ) : (
              <div className="mt-4 space-y-4">
                {increment.modules.map((group) => (
                  <ModuleBlock key={group.module} group={group} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
