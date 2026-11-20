"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Minus } from "lucide-react";

import { monthlyNumber } from "@/components/marketing/price-card";
import { RollingValue } from "@/components/public/pricing-motion";
import { Table } from "@/components/ui/table";
import { catalogFeatures } from "@/lib/pricing/planFit";
import { CYCLE_MONTHS, formatCentsAsCurrency, parseDollarsToCents, type BillingCycle } from "@/lib/money";
import { featuresByModule, publicPriceForCycle, type PublicFeature, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * "What changes between plans" (pricing r1, option A, owner pick 2026-11-19). It replaced the
 * 48-row compare table and the "Explain each feature" view.
 *
 * One table across every audience: the agent's plans, Agency (its seat bands grant the same features,
 * so one column) and IMO & FMO (everything in Agency, priced on request). It shows only the rows
 * where the columns differ, under a plan header that stays on screen, with price, seats and trial as
 * the first rows. The features every plan shares sit behind one button. Rows, columns and ticks are
 * the live catalog, so a feature added in the admin catalog shows up here without a code change.
 */

type Column = {
  key: string;
  name: string;
  features: Set<string>;
  /** The header's price line; `rank` lets a changing figure roll the right way. */
  price: { text: string; rank: number; prefix?: string; suffix?: string } | null;
  priceNote: string;
  seats: string;
  trial: string;
  cta: { href: string; label: string } | { onClick: () => void; label: string };
};

const IMO_MAIL = "mailto:support@insurvas.com?subject=IMO%20%2F%20FMO%20pricing";

function cyclePrice(plan: PublicPlan, cycle: BillingCycle) {
  // The cycle's price as a monthly figure; a plan with no price on the cycle shows its monthly one.
  const raw = publicPriceForCycle(plan, cycle);
  const cents = raw ? parseDollarsToCents(raw) : null;
  if (cents != null) return Math.round(cents / CYCLE_MONTHS[cycle]);
  return plan.price_monthly ? parseDollarsToCents(plan.price_monthly) : null;
}

function money(cents: number) {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : formatCentsAsCurrency(cents);
}

export function PricingCompare({ plans, cycle, onShowAgency }: { plans: PublicPlan[]; cycle: BillingCycle; onShowAgency: () => void }) {
  const [showShared, setShowShared] = useState(false);

  const columns = useMemo<Column[]>(() => {
    const individual = plans.filter((plan) => plan.audience === "individual").sort((a, b) => monthlyNumber(a) - monthlyNumber(b));
    const agency = plans.filter((plan) => plan.audience === "agency").sort((a, b) => monthlyNumber(a) - monthlyNumber(b));
    const out: Column[] = individual.map((plan) => {
      const cents = cyclePrice(plan, cycle);
      return {
        key: plan.code,
        name: plan.name,
        features: new Set(plan.features.map((feature) => feature.key)),
        price: cents == null ? null : { text: money(cents), rank: cents, suffix: " / mo" },
        priceNote: "",
        seats: "1",
        trial: plan.trial_days > 0 ? `${plan.trial_days} days` : "—",
        cta: { href: `/signup?plan=${encodeURIComponent(plan.code)}&cycle=${cycle}`, label: "Start trial" },
      };
    });
    if (agency.length) {
      const features = new Set(agency.flatMap((plan) => plan.features.map((feature) => feature.key)));
      const from = agency.map((plan) => cyclePrice(plan, cycle)).filter((value): value is number => value != null);
      const lowest = from.length ? Math.min(...from) : null;
      const trial = Math.max(...agency.map((plan) => plan.trial_days));
      out.push({
        key: "agency",
        name: "Agency",
        features,
        price: lowest == null ? null : { text: money(lowest), rank: lowest, prefix: "From ", suffix: " / mo" },
        priceNote: "",
        seats: "Your whole team",
        trial: trial > 0 ? `${trial} days` : "—",
        cta: { onClick: onShowAgency, label: "See seats" },
      });
      out.push({
        key: "imo",
        name: "IMO & FMO",
        features,
        price: null,
        priceNote: "Talk to us",
        seats: "Your downline",
        trial: "On request",
        cta: { href: IMO_MAIL, label: "Talk to us" },
      });
    }
    return out;
  }, [plans, cycle, onShowAgency]);

  const { differing, shared } = useMemo(() => {
    const all = [...catalogFeatures(plans).values()];
    const differs = (feature: PublicFeature) => new Set(columns.map((column) => column.features.has(feature.key))).size > 1;
    return {
      differing: featuresByModule(all.filter(differs)),
      shared: featuresByModule(all.filter((feature) => !differs(feature) && columns.every((column) => column.features.has(feature.key)))),
    };
  }, [plans, columns]);
  const sharedCount = shared.reduce((sum, group) => sum + group.features.length, 0);
  const span = columns.length + 1;

  const tick = (included: boolean, planName: string) => included
    ? <span className="mx-auto grid size-5 place-items-center rounded-full bg-[var(--primary)] text-[var(--on-primary)]"><Check className="size-3 stroke-[3.5]" aria-label={`Included in ${planName}`} /></span>
    : <Minus className="mx-auto size-4 text-muted-foreground" aria-label={`Not in ${planName}`} />;

  const groupRow = (label: string) => (
    <tr className="border-t border-border bg-[var(--surface-alt)]">
      <th scope="colgroup" colSpan={span} className="sticky left-0 bg-[var(--surface-alt)] px-5 py-2 text-left text-xs font-semibold text-muted-foreground">{label}</th>
    </tr>
  );

  return (
    <div>
      <div className="rounded-[20px] border border-border bg-card">
        <Table containerClassName="rounded-[20px] lg:overflow-visible" className="min-w-[760px] border-separate border-spacing-0">
          <caption className="sr-only">What changes between plans</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[28%] rounded-tl-[20px] bg-card px-5 py-4 lg:sticky lg:top-[76px] lg:z-20" />
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`bg-card px-3 pt-5 pb-4 text-center align-bottom font-normal lg:sticky lg:top-[76px] lg:z-20 ${index === columns.length - 1 ? "rounded-tr-[20px]" : ""}`}
                >
                  <span className="block text-base font-semibold tracking-[-0.01em] text-foreground">{column.name}</span>
                  <span className="mt-1 block min-h-5 text-sm font-medium text-muted-foreground tabular-nums">
                    {column.price ? (
                      <>{column.price.prefix}<RollingValue value={column.price.text} rank={column.price.rank} />{column.price.suffix}</>
                    ) : column.priceNote}
                  </span>
                  {"href" in column.cta ? (
                    column.cta.href.startsWith("mailto:")
                      ? <a href={column.cta.href} className="mt-3 inline-flex h-9 items-center rounded-full border border-border bg-[var(--surface-alt)] px-4 text-sm font-semibold text-foreground transition-colors hover:bg-[var(--surface-sunken)]">{column.cta.label}</a>
                      : <Link href={column.cta.href} className="mt-3 inline-flex h-9 items-center rounded-full border border-border bg-[var(--surface-alt)] px-4 text-sm font-semibold text-foreground transition-colors hover:bg-[var(--surface-sunken)]">{column.cta.label}</Link>
                  ) : (
                    <button type="button" onClick={column.cta.onClick} className="mt-3 inline-flex h-9 items-center rounded-full border border-border bg-[var(--surface-alt)] px-4 text-sm font-semibold text-foreground transition-colors hover:bg-[var(--surface-sunken)]">{column.cta.label}</button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupRow("The basics")}
            <tr>
              <th scope="row" className="sticky left-0 border-t border-border bg-card px-5 py-3 text-left font-normal text-[var(--body)]">Seats</th>
              {columns.map((column) => <td key={column.key} className="border-t border-border px-3 py-3 text-center text-[var(--body)]">{column.seats}</td>)}
            </tr>
            <tr>
              <th scope="row" className="sticky left-0 border-t border-border bg-card px-5 py-3 text-left font-normal text-[var(--body)]">Free trial</th>
              {columns.map((column) => <td key={column.key} className="border-t border-border px-3 py-3 text-center text-[var(--body)]">{column.trial}</td>)}
            </tr>
            {differing.map((group) => (
              <Fragment key={group.module}>
                {groupRow(group.label)}
                {group.features.map((feature) => (
                  <tr key={feature.key} className="transition-colors hover:bg-[color-mix(in_srgb,var(--surface-alt)_45%,transparent)]">
                    <th scope="row" className="sticky left-0 border-t border-border bg-card px-5 py-3 text-left font-normal text-[var(--body)]">{feature.label}</th>
                    {columns.map((column) => <td key={column.key} className="border-t border-border px-3 py-3 text-center">{tick(column.features.has(feature.key), column.name)}</td>)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          {showShared && sharedCount > 0 && (
            <tbody id="pricing-shared-features">
              {groupRow("On every plan")}
              {shared.flatMap((group) => group.features).map((feature, index) => (
                <tr key={feature.key} className="pz-swap" style={{ animationDelay: `${Math.min(index, 16) * 28}ms` }}>
                  <th scope="row" className="sticky left-0 border-t border-border bg-card px-5 py-3 text-left font-normal text-muted-foreground">{feature.label}</th>
                  {columns.map((column) => <td key={column.key} className="border-t border-border px-3 py-3 text-center">{tick(true, column.name)}</td>)}
                </tr>
              ))}
            </tbody>
          )}
        </Table>
      </div>
      {sharedCount > 0 && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            aria-expanded={showShared}
            aria-controls="pricing-shared-features"
            onClick={() => setShowShared((open) => !open)}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-semibold text-foreground transition-[background-color,transform] duration-200 hover:bg-[var(--surface-alt)] active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
          >
            <ChevronDown aria-hidden="true" className={`size-4 transition-transform duration-300 ease-[var(--e-out)] ${showShared ? "rotate-180" : ""}`} />
            {showShared ? "Hide the shared features" : `Show the ${sharedCount} features on every plan`}
          </button>
        </div>
      )}
    </div>
  );
}
