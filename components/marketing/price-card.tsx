"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";

import styles from "@/components/marketing/price-card.module.css";
import { CYCLE_MONTHS, parseDollarsToCents, type BillingCycle } from "@/lib/money";
import { featuresByModule, publicPriceForCycle, type PublicFeature, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * The price card, one component for the landing page's pricing teaser and /pricing (pricing r1,
 * 2026-11-19: "the pricing page's cards look the same as the homepage's"). Each card has a tab cut
 * into its top corner, a large price with how it is billed beneath, the plan's blurb, and the same
 * list of rows on every card of a ladder, ticked where the plan has it and crossed where it does not.
 *
 * Selectable (Umar's review, 4 Nov): clicking a card, or moving focus into it, selects it, and the
 * selected card lifts with a brand edge and a filled button. The card is not itself a button (it holds
 * a link), so keyboard users select it by tabbing to its link.
 *
 * Every price, plan name, blurb and feature comes from the live catalog (UI-CONSISTENCY §13); the
 * callers only pick which plans and rows to show.
 */

export type PriceCardRow = { key: string; label: string; included: boolean; lead?: boolean };

export type PriceCardPrice =
  /** `whole` is the big figure ("$2,499"); `rank` orders figures so a change rolls the right way. */
  | { kind: "amount"; whole: string; rank: number; lines: string[] }
  | { kind: "contact"; title: string; note?: string | null };

/** "2499.00" or 249900 cents → "$2,499"; the cents only when there are some. */
export function wholeDollars(value: string | number, unit: "dollars" | "cents" = "dollars") {
  const n = typeof value === "number" ? (unit === "cents" ? value / 100 : value) : Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return String(value);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** A plan's monthly price as a number, for sorting a ladder; unpriced plans sort last. */
export function monthlyNumber(plan: PublicPlan) {
  const n = plan.price_monthly ? Number(plan.price_monthly.replace(/[^0-9.]/g, "")) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** "Agency · 1–50 seats" → "1–50 seats": an agency band's card names its band. */
export function tierName(plan: Pick<PublicPlan, "name">) {
  return plan.name.includes(" · ") ? plan.name.split(" · ").slice(1).join(" · ") : plan.name;
}

/**
 * The rows every card of a ladder shares: the top plan's features, one from each module in turn, so
 * the list shows the whole product and the lower plans' crosses show what they leave out.
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

/**
 * The shared row list for a ladder of plans (ten rows). A team ladder leads with what only a team
 * gets (the Agency module), then the product around it.
 */
export function ladderRows(ladder: PublicPlan[], team: boolean): PublicFeature[] {
  const top = ladder.length ? ladder[ladder.length - 1] : null;
  if (!top) return [];
  const teamOnly = team ? top.features.filter((feature) => feature.moduleLabel === "Agency").slice(0, 6) : [];
  return [...teamOnly, ...comparisonRows({ ...top, features: top.features.filter((feature) => !teamOnly.includes(feature)) }, 10 - teamOnly.length)];
}

/** One plan's ticks against a ladder's shared rows. */
export function rowsFor(plan: PublicPlan, rows: PublicFeature[]): PriceCardRow[] {
  const has = new Set(plan.features.map((feature) => feature.key));
  return rows.map((row) => ({ key: row.key, label: row.label, included: has.has(row.key) }));
}

/**
 * A card's price on the cycle: the yearly price shown per month with the yearly total beneath it.
 * A plan the cycle does not price (the agency bands are monthly only today) keeps its monthly price
 * and says so, rather than inventing a yearly one.
 */
export function cyclePrice(plan: PublicPlan, cycle: BillingCycle): PriceCardPrice | null {
  const raw = publicPriceForCycle(plan, cycle);
  const cents = raw ? parseDollarsToCents(raw) : null;
  if (cents != null && cycle !== "monthly") {
    const perMonth = Math.round(cents / CYCLE_MONTHS[cycle]);
    return { kind: "amount", whole: wholeDollars(perMonth, "cents"), rank: perMonth, lines: ["/ month (USD)", `${wholeDollars(cents, "cents")} billed yearly`] };
  }
  if (!plan.price_monthly) return null;
  const monthly = parseDollarsToCents(plan.price_monthly) ?? 0;
  return { kind: "amount", whole: wholeDollars(plan.price_monthly), rank: monthly, lines: ["/ month (USD)", "Billed monthly"] };
}

/** The grid of cards. `swapKey` changes when a whole new ladder comes in, so its cards rise in turn. */
export function PriceLadder({ count, swapKey, children, className }: { count: number; swapKey?: string; children: ReactNode; className?: string }) {
  return (
    <div key={swapKey} className={`${styles.ladder} ${className ?? ""}`} data-count={count}>
      {children}
    </div>
  );
}

/** "$207.50" → "$207" with ".50" small and raised; a whole figure is left as it is. */
function figure(value: string) {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return value;
  return <>{value.slice(0, dot)}<span className={styles.cents}>{value.slice(dot)}</span></>;
}

/** A big figure that rolls when it changes: up when it grows, down when it falls. The first render stands still. */
function RollingWhole({ value, rank }: { value: string; rank: number }) {
  const [state, setState] = useState({ current: value, rank, previous: null as string | null, up: true, turn: 0 });
  if (state.current !== value) {
    setState({ current: value, rank, previous: state.current, up: rank >= state.rank, turn: state.turn + 1 });
  }
  return (
    <span className={styles.whole}>
      <span key={`now-${state.turn}`} className={state.turn ? (state.up ? styles.rollUp : styles.rollDown) : undefined}>{figure(state.current)}</span>
      {state.previous !== null && (
        <span
          key={`was-${state.turn}`}
          aria-hidden="true"
          className={state.up ? styles.rollOutUp : styles.rollOutDown}
          onAnimationEnd={() => setState((now) => (now.turn === state.turn ? { ...now, previous: null } : now))}
        >
          {figure(state.previous)}
        </span>
      )}
    </span>
  );
}

export function PriceCard({
  id,
  index = 0,
  entering = false,
  name,
  tab,
  featured = false,
  selected,
  onSelect,
  price,
  blurb,
  rows,
  cta,
  wrap,
}: {
  id?: string;
  /** Position in the ladder: staggers the rise when a ladder swaps in. */
  index?: number;
  /** True while a swapped-in ladder rises into place. */
  entering?: boolean;
  name: string;
  tab?: string | null;
  featured?: boolean;
  selected: boolean;
  onSelect: () => void;
  price: PriceCardPrice | null;
  blurb?: string | null;
  rows: PriceCardRow[];
  cta: { href: string; label: string };
  /** Wraps the card (the landing page's scroll Reveal); the cell keeps the grid height either way. */
  wrap?: (card: ReactNode) => ReactNode;
}) {
  const card = (
    <article
      id={id}
      className={`${styles.card} ${featured ? styles.featured : ""}`}
      data-selected={selected}
      aria-label={`${name} plan`}
      onClick={onSelect}
      onFocus={onSelect}
    >
      {tab && <span className={styles.tab}>{tab}<i aria-hidden="true" /></span>}
      <header className={styles.cardHead}>
        <h3 className={styles.tier}>{name}</h3>
        {price?.kind === "amount" ? (
          <div className={styles.price}>
            <RollingWhole value={price.whole} rank={price.rank} />
            <span className={styles.per}>
              {price.lines.map((line, lineIndex) => <span key={lineIndex === price.lines.length - 1 ? `l-${line}` : lineIndex}>{line}</span>)}
            </span>
          </div>
        ) : price?.kind === "contact" ? (
          <>
            <div className={styles.contact}>{price.title}</div>
            {price.note ? <div className={styles.contactNote}>{price.note}</div> : null}
          </>
        ) : null}
        {blurb && <p className={styles.blurb}>{blurb}</p>}
      </header>
      {rows.length > 0 ? (
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.key} data-included={row.included} data-lead={row.lead ? "true" : undefined}>
              <span className={styles.mark} aria-hidden="true">{row.included ? <Check /> : <X />}</span>
              <span>{row.label}</span>
              {!row.included && <span className="sr-only"> (not included)</span>}
            </li>
          ))}
        </ul>
      ) : <div className={styles.rowsEmpty} />}
      <footer className={styles.cardFoot}>
        {cta.href.startsWith("mailto:") ? (
          <a href={cta.href} className={`${styles.planCta} ${selected ? styles.planCtaFeatured : ""}`}>{cta.label}</a>
        ) : (
          <Link href={cta.href} className={`${styles.planCta} ${selected ? styles.planCtaFeatured : ""}`}>{cta.label}</Link>
        )}
      </footer>
    </article>
  );
  return (
    <div className={styles.cell} data-enter={entering ? "true" : undefined} style={{ "--i": index } as CSSProperties}>
      {wrap ? wrap(card) : card}
    </div>
  );
}
