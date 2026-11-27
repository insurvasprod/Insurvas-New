"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, X } from "lucide-react";

import { monthlyNumber } from "@/components/marketing/price-card";
import { RollingValue } from "@/components/public/pricing-motion";
import { Switch } from "@/components/ui/field";
import { Table } from "@/components/ui/table";
import { catalogFeatures } from "@/lib/pricing/planFit";
import { CYCLE_MONTHS, formatCentsAsCurrency, parseDollarsToCents, type BillingCycle } from "@/lib/money";
import { featuresByModule, publicPriceForCycle, type PublicFeature, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * "Compare features" (owner's reference, 2026-11-27; built on pricing r1 option A, 2026-11-19).
 *
 * One table across every audience on a rounded card: the agent's plans, Agency (its seat bands grant
 * the same features, so one column) and IMO & FMO (everything in Agency, priced on request). Each plan
 * column carries its name, price per month, how it is billed and a "Get plan" button; the recommended
 * plan has a "Best value" badge and the page's one gold feature button (BRAND.md). The Annual switch
 * sits in the top-left cell. Rows are grouped under section headings, values are text or ✓ / ✕.
 *
 * Two ways to show it:
 * - `collapsed` (/pricing, owner 2026-11-27; taken off the landing page the same day): the plan header, the basics and the first
 *   section, faded out under a "Compare features" button that opens every feature: what changes
 *   between plans first, then what every plan shares.
 * - `changes` (/pricing): only the rows where plans differ; the features every plan shares sit behind
 *   one button.
 *
 * Rows, columns and ticks are the live catalog, so a feature added in the admin catalog shows up here
 * without a code change (UI-CONSISTENCY §13).
 */

type Column = {
  key: string;
  name: string;
  features: Set<string>;
  /** The price per month; `rank` lets a changing figure roll the right way. */
  price: { text: string; rank: number; prefix?: string } | null;
  priceNote: string;
  billed: string;
  seats: string;
  trial: string;
  cta: { href: string; label: string } | { onClick: () => void; label: string };
  best?: boolean;
};

type Row = { key: string; label: string; sub?: string; values: (included: Column) => ReactNode };

const IMO_MAIL = "mailto:support@insurvas.com?subject=IMO%20%2F%20FMO%20pricing";
/** Collapsed height: the plan header, the basics and the first section, then the fade (owner, 2026-11-27). */
const COLLAPSED_PX = 660;

function money(cents: number) {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : formatCentsAsCurrency(cents);
}

/** A plan's price on the cycle, per month, and how it is billed. A cycle the plan does not price shows its monthly one. */
function priceOn(plan: PublicPlan, cycle: BillingCycle): { perMonth: number | null; billed: string } {
  const raw = publicPriceForCycle(plan, cycle);
  const cents = raw ? parseDollarsToCents(raw) : null;
  if (cents != null && cycle !== "monthly") return { perMonth: Math.round(cents / CYCLE_MONTHS[cycle]), billed: `${money(cents)} billed yearly` };
  return { perMonth: plan.price_monthly ? parseDollarsToCents(plan.price_monthly) : null, billed: "Billed monthly" };
}

/** "2 months free" when the best yearly saving is two of twelve months, otherwise "Save N%". */
function yearlyNote(plans: PublicPlan[]): string | null {
  const savings = plans.map((plan) => {
    const monthly = plan.price_monthly ? parseDollarsToCents(plan.price_monthly) : null;
    const yearly = plan.price_yearly ? parseDollarsToCents(plan.price_yearly) : null;
    if (!monthly || yearly == null || yearly >= monthly * 12) return null;
    return (monthly * 12 - yearly) / (monthly * 12);
  }).filter((value): value is number => value != null);
  if (!savings.length) return null;
  const best = Math.max(...savings);
  const months = Math.round(best * 12);
  return Math.abs(best * 12 - months) < 0.15 ? `${months} month${months === 1 ? "" : "s"} free` : `Save ${Math.round(best * 100)}%`;
}

export function PricingCompare({
  plans,
  cycle,
  onCycleChange,
  onShowAgency,
  variant = "changes",
}: {
  plans: PublicPlan[];
  cycle: BillingCycle;
  /** Draws the Annual switch in the top-left cell. */
  onCycleChange?: (cycle: BillingCycle) => void;
  /** The Agency column's button; without it the button links to /pricing?for=agency. */
  onShowAgency?: () => void;
  variant?: "changes" | "collapsed";
}) {
  const [showShared, setShowShared] = useState(false);

  const columns = useMemo<Column[]>(() => {
    const individual = plans.filter((plan) => plan.audience === "individual").sort((a, b) => monthlyNumber(a) - monthlyNumber(b));
    const agency = plans.filter((plan) => plan.audience === "agency").sort((a, b) => monthlyNumber(a) - monthlyNumber(b));
    // As on the cards: the middle of three agent plans is the recommended one, otherwise the default.
    const bestIndex = individual.length === 3 ? 1 : individual.findIndex((plan) => plan.is_default);
    const out: Column[] = individual.map((plan, index) => {
      const { perMonth, billed } = priceOn(plan, cycle);
      return {
        key: plan.code,
        name: plan.name,
        features: new Set(plan.features.map((feature) => feature.key)),
        price: perMonth == null ? null : { text: money(perMonth), rank: perMonth },
        priceNote: "",
        billed,
        seats: "1 agent",
        trial: plan.trial_days > 0 ? `${plan.trial_days} days` : "—",
        cta: { href: `/signup?plan=${encodeURIComponent(plan.code)}&cycle=${cycle}`, label: "Get plan" },
        best: index === bestIndex,
      };
    });
    if (agency.length) {
      const features = new Set(agency.flatMap((plan) => plan.features.map((feature) => feature.key)));
      const priced = agency.map((plan) => priceOn(plan, cycle)).filter((entry) => entry.perMonth != null);
      const lowest = priced.length ? priced.reduce((low, entry) => ((entry.perMonth ?? 0) < (low.perMonth ?? 0) ? entry : low)) : null;
      const trial = Math.max(...agency.map((plan) => plan.trial_days));
      out.push({
        key: "agency",
        name: "Agency",
        features,
        price: lowest?.perMonth == null ? null : { text: money(lowest.perMonth), rank: lowest.perMonth, prefix: "From " },
        priceNote: "",
        billed: lowest?.billed ?? "Billed monthly",
        seats: "Your whole team",
        trial: trial > 0 ? `${trial} days` : "—",
        cta: onShowAgency ? { onClick: onShowAgency, label: "See seats" } : { href: "/pricing?for=agency", label: "See seats" },
      });
      out.push({
        key: "imo",
        name: "IMO & FMO",
        features,
        price: null,
        priceNote: "Custom",
        billed: "Talk to us for pricing",
        seats: "Your downline",
        trial: "On request",
        cta: { href: IMO_MAIL, label: "Talk to us" },
      });
    }
    return out;
  }, [plans, cycle, onShowAgency]);

  const { groups, shared } = useMemo(() => {
    const all = [...catalogFeatures(plans).values()];
    const differs = (feature: PublicFeature) => new Set(columns.map((column) => column.features.has(feature.key))).size > 1;
    // What changes between plans comes first; the features every plan shares follow (collapsed) or sit
    // behind their own button (changes).
    return {
      groups: featuresByModule(all.filter(differs)),
      shared: featuresByModule(all.filter((feature) => !differs(feature) && columns.every((column) => column.features.has(feature.key)))),
    };
  }, [plans, columns]);
  const sharedCount = shared.reduce((sum, group) => sum + group.features.length, 0);
  const note = useMemo(() => yearlyNote(plans), [plans]);
  const offersYearly = plans.some((plan) => plan.price_yearly);

  // Collapsed: closed to COLLAPSED_PX under a fade; opening eases to the table's full height, then
  // lets go of the height (and the clip) so the plan header can stick to the page while it scrolls.
  const [open, setOpen] = useState(variant !== "collapsed");
  const [settled, setSettled] = useState(variant !== "collapsed");
  const [height, setHeight] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (variant !== "collapsed" || !bodyRef.current) return;
    setHeight(bodyRef.current.scrollHeight);
  }, [variant, open]);
  const toggle = () => {
    if (open) {
      // Measure first so the close eases down from the real height, not from "none".
      setHeight(bodyRef.current?.scrollHeight ?? null);
      setSettled(false);
      requestAnimationFrame(() => setOpen(false));
      bodyRef.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      setOpen(true);
    }
  };

  const span = columns.length + 1;
  const sticky = settled ? "lg:sticky lg:top-[76px] lg:z-20" : "";
  const mark = (included: boolean, planName: string) => included
    ? <Check className="mx-auto size-4 stroke-[2.5] text-[var(--accent-ink)]" aria-label={`Included in ${planName}`} />
    : <X className="mx-auto size-4 stroke-[1.75] text-muted-foreground" aria-label={`Not in ${planName}`} />;

  const basics: Row[] = [
    { key: "seats", label: "Seats", sub: "Everyone who signs in", values: (column) => column.seats },
    { key: "trial", label: "Free trial", sub: "Nothing charged until it ends", values: (column) => column.trial },
  ];
  const rowsFor = (features: PublicFeature[]): Row[] => features.map((feature) => ({ key: feature.key, label: feature.label, values: (column) => mark(column.features.has(feature.key), column.name) }));

  const section = (key: string, label: string, rows: Row[], extra?: { className?: string; animate?: boolean }) => (
    <Fragment key={key}>
      <tr>
        <th scope="colgroup" colSpan={span} className="sticky left-0 bg-card px-5 pt-7 pb-2 text-left text-base font-semibold tracking-[-0.01em] text-foreground">{label}</th>
      </tr>
      {rows.map((row, index) => (
        <tr
          key={row.key}
          className={`${extra?.animate ? "pz-swap" : ""} transition-colors hover:bg-[color-mix(in_srgb,var(--surface-alt)_45%,transparent)]`}
          style={extra?.animate ? { animationDelay: `${Math.min(index, 16) * 28}ms` } : undefined}
        >
          <th scope="row" className="sticky left-0 border-b border-border bg-card px-4 py-3 text-left font-normal sm:px-5">
            <span className={`block text-sm ${extra?.className ?? "text-foreground"}`}>{row.label}</span>
            {row.sub ? <span className="mt-0.5 block text-xs text-muted-foreground">{row.sub}</span> : null}
          </th>
          {columns.map((column) => (
            <td key={column.key} className="border-b border-border px-3 py-3 text-left text-xs leading-[1.4] text-[var(--body)]">{row.values(column)}</td>
          ))}
        </tr>
      ))}
    </Fragment>
  );

  const cta = (column: Column) => {
    const className = `mt-4 inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-[background-color,transform] duration-200 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${
      column.best
        ? "bg-[var(--highlight)] text-[var(--on-highlight)] shadow-[0_10px_24px_-12px_color-mix(in_srgb,var(--highlight)_80%,transparent)] hover:bg-[color-mix(in_srgb,var(--highlight)_88%,var(--ink))]"
        : "border border-border bg-[var(--surface-alt)] text-foreground hover:bg-[var(--surface-sunken)]"
    }`;
    if ("onClick" in column.cta) return <button type="button" onClick={column.cta.onClick} className={className}>{column.cta.label}</button>;
    if (column.cta.href.startsWith("mailto:")) return <a href={column.cta.href} className={className}>{column.cta.label}</a>;
    return <Link href={column.cta.href} className={className}>{column.cta.label}</Link>;
  };

  const collapsedStyle = variant === "collapsed" && !settled
    ? {
        maxHeight: open ? (height ?? 4000) : COLLAPSED_PX,
        overflow: "hidden" as const,
        transition: "max-height 700ms var(--e-out)",
        WebkitMaskImage: open ? undefined : "linear-gradient(to bottom, black 62%, transparent)",
        maskImage: open ? undefined : "linear-gradient(to bottom, black 62%, transparent)",
      }
    : undefined;

  return (
    <div>
      <div className="rounded-[24px] border border-border bg-card p-2 sm:p-3">
        <div
          ref={bodyRef}
          style={collapsedStyle}
          onTransitionEnd={(event) => { if (event.propertyName === "max-height" && open) setSettled(true); }}
        >
          <Table containerClassName={`rounded-[18px] ${settled ? "lg:overflow-visible" : ""}`} className="min-w-[760px] border-separate border-spacing-0 sm:min-w-[820px]">
            <caption className="sr-only">Compare features by plan</caption>
            <thead>
              <tr>
                <th scope="col" className={`w-[148px] bg-card px-4 pt-6 pb-5 text-left align-bottom font-normal sm:w-[26%] sm:px-5 ${sticky}`}>
                  {onCycleChange && offersYearly ? (
                    <label className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-border bg-[var(--surface-alt)] px-3 py-2 text-sm font-semibold text-foreground">
                      Annual
                      {note ? <span className="hidden text-xs font-semibold text-[var(--accent-ink)] sm:inline">{note}</span> : null}
                      <Switch checked={cycle === "yearly"} onChange={(next) => onCycleChange(next ? "yearly" : "monthly")} label="Bill yearly" />
                    </label>
                  ) : null}
                </th>
                {columns.map((column) => (
                  <th key={column.key} scope="col" className={`bg-card px-3 pt-6 pb-5 text-left align-top font-normal ${sticky}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold tracking-[-0.01em] text-foreground">{column.name}</span>
                      {column.best ? <span className="rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-ink)]">Best value</span> : null}
                    </span>
                    <span className="mt-3 block text-sm font-semibold text-foreground tabular-nums">
                      {column.price ? <>{column.price.prefix}<RollingValue value={column.price.text} rank={column.price.rank} />/month</> : column.priceNote}
                    </span>
                    <span key={column.billed} className="pz-fade mt-0.5 block text-xs text-muted-foreground">{column.billed}</span>
                    {cta(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section("basics", "The basics", basics)}
              {groups.map((group) => section(group.module, group.label, rowsFor(group.features)))}
            </tbody>
            {(variant === "collapsed" || showShared) && sharedCount > 0 && (
              <tbody id="pricing-shared-features">
                {shared.map((group) => section(`shared-${group.module}`, `${group.label} · on every plan`, rowsFor(group.features), { className: "text-muted-foreground", animate: variant !== "collapsed" }))}
              </tbody>
            )}
          </Table>
        </div>
      </div>

      <div className="mt-5 flex justify-center">
        {variant === "collapsed" ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold text-foreground transition-[background-color,transform] duration-200 hover:bg-[var(--surface-alt)] active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
          >
            {open ? "Show less" : "Compare features"}
            <ChevronDown aria-hidden="true" className={`size-4 transition-transform duration-300 ease-[var(--e-out)] ${open ? "rotate-180" : ""}`} />
          </button>
        ) : sharedCount > 0 ? (
          <button
            type="button"
            aria-expanded={showShared}
            aria-controls="pricing-shared-features"
            onClick={() => setShowShared((now) => !now)}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold text-foreground transition-[background-color,transform] duration-200 hover:bg-[var(--surface-alt)] active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
          >
            {showShared ? "Hide the shared features" : `Show the ${sharedCount} features on every plan`}
            <ChevronDown aria-hidden="true" className={`size-4 transition-transform duration-300 ease-[var(--e-out)] ${showShared ? "rotate-180" : ""}`} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
