# Homepage copy source snapshot

Captured 2026-11-02 before visual redesign. These verbatim source files preserve the homepage wording and context, including conditional copy. Live catalog values are data-driven and are not captured here. This is a source snapshot, not a rendered text-only export.

## app/page.tsx

```tsx
import type { Metadata } from "next";

import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";
import { LandingHero } from "@/components/marketing/landing-hero";
import { LandingIntro } from "@/components/marketing/landing-intro";
import { LandingExploded } from "@/components/marketing/landing-exploded";
import { LandingBento } from "@/components/marketing/landing-bento";
import { LandingCta, LandingFaq, LandingPricingTeaser, LandingTruths } from "@/components/marketing/landing-sections";
import { fetchPublicPlans } from "@/lib/publicPlans/queries";
import type { PublicPlan } from "@/lib/publicPlans/types";

export const metadata: Metadata = {
  title: "Insurvas · Know what every lead cost you",
  description:
    "The inbound floor, the outbound dialer, applications and the book of business in one workspace — with every issued policy traced back to the campaign that paid for it.",
};

/**
 * The landing page. `/` used to redirect to /pricing; the p-pub-root board called making it a real
 * page "the proposal" (p-mkt-home), and the owner asked for a standout presentation of the whole
 * product. Pricing stays the front door for plans; this is the front door for the product.
 *
 * The one server read is the plan catalog for the pricing teaser, and it is allowed to fail: a
 * marketing page must never 500 because a price query did.
 */
export default async function Home() {
  const plans: PublicPlan[] = await fetchPublicPlans().catch(() => []);
  return (
    <div className="type-brand min-h-screen bg-background">
      {/* First visit of a session: the mark is drawn out of the hero's lines, then the page opens. */}
      <LandingIntro />
      <SiteHeader current="home" floating />
      <main>
        {/* The story (2026-10-13, after the research pass): the promise, light and editorial, with a
            living WebGL ribbon → who it is for → inside one call (the product comes apart in 3D) →
            what it does (tiles with live 3D objects) → price → questions → the close. */}
        <LandingHero />
        <LandingTruths />
        <LandingExploded />
        <LandingBento />
        <LandingPricingTeaser plans={plans} />
        <LandingFaq />
        <LandingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

```

## components/marketing/landing-hero.tsx

```tsx
import Link from "next/link";
import { ViewTransition, type CSSProperties } from "react";
import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LandingObject } from "@/components/marketing/three/landing-object";
import styles from "@/components/marketing/landing.module.css";

/**
 * The hero (2026-10-13). Light and editorial, with one living object: a WebGL ribbon in the brand
 * greens flowing behind the headline — the stream of leads and money the product follows.
 *
 * Its entrance is one sequence, in CSS so it runs from the first paint and never waits on
 * hydration (owner, 2026-10-13): after the intro lifts, the ribbon sweeps in slowly, then the
 * headline rises word by word, then the rest. Every delay is measured from --intro-delay
 * (landing.module.css), which is 0 when there is no intro. Under reduced motion it all just shows.
 */
const at = (ms: number) => ({ "--at": `${ms}ms` }) as CSSProperties;

function Words({ text, from, className = "" }: { text: string; from: number; className?: string }) {
  const words = text.split(" ");
  return words.map((word, index) => (
    <span key={`${word}-${index}`}>
      <span className={styles.heroWordClip}><span className={`${styles.heroWord} ${className}`} style={at(from + index * 80)}>{word}</span></span>
      {index < words.length - 1 ? " " : null}
    </span>
  ));
}

export function LandingHero() {
  return (
    <section data-landing-hero="" className={`relative isolate overflow-hidden bg-background ${styles.hero}`}>
      {/* Named, so it morphs into the sign-in pages' brand panel (components/portal/portal-auth-split-shell.tsx). */}
      <ViewTransition name="brand-ribbon" share="ribbon-morph" default="none">
        <LandingObject kind="ribbon" className={`pointer-events-none absolute -right-[12%] top-[-6%] -z-10 h-[112%] w-[100%] [mask-image:linear-gradient(90deg,transparent_0%,black_35%,black_85%,transparent_100%)] lg:w-[78%] ${styles.ribbonIn}`} />
      </ViewTransition>
      {/* Keeps the headline legible where the ribbon passes behind it. On phones the text spans the whole width, so the veil never clears completely there (2026-10-22). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-full bg-[linear-gradient(90deg,var(--background)_30%,transparent_70%)] max-sm:bg-[linear-gradient(90deg,var(--background)_35%,color-mix(in_srgb,var(--background)_60%,transparent)_100%)] lg:w-2/3" />

      <div className="mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-center px-4 pb-20 pt-32 sm:px-6 lg:px-16">
        <p className={`text-sm font-semibold text-[var(--accent-ink)] ${styles.heroRise}`} style={at(700)}>For life &amp; health agencies and call centers that buy their leads</p>
        <h1 className="mt-5 max-w-[840px] text-headline-lg font-semibold leading-[1.0] tracking-[-0.045em] text-[var(--ink)] sm:text-hero lg:text-[clamp(3.5rem,6.2vw,5.25rem)]">
          <Words text="Know what every lead" from={850} />{" "}
          <Words text="really" from={1170} className="pr-[0.1em] font-light italic text-[var(--accent-ink)]" />{" "}
          <Words text="cost you." from={1250} />
        </h1>
        <p className={`mt-7 max-w-[560px] text-base leading-[1.65] text-muted-foreground sm:text-lg ${styles.heroRise}`} style={at(1500)}>
          Live transfers, dialing, applications and commissions in one workspace — and every issued policy traced back to
          the campaign that paid for it.
        </p>
        <div className={`mt-9 flex flex-wrap items-center gap-3 ${styles.heroRise}`} style={at(1650)}>
          <Button asChild className="h-12 rounded-full px-7 text-base">
            <Link href="/signup">Start your free trial<ArrowRight className="size-4" aria-hidden="true" /></Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-full bg-background/70 px-7 text-base backdrop-blur">
            <Link href="#product">See the product</Link>
          </Button>
        </div>
        <ul className={`mt-8 flex flex-wrap gap-x-6 gap-y-2 p-0 text-sm text-muted-foreground ${styles.heroRise}`} style={at(1780)}>
          {/* Each line is one the product can back: a card is taken at checkout but nothing is charged
              during the trial; there is no per-lead fee (add-ons and metered usage are priced on
              /pricing); screening runs the agency's own checks and vendors, it is not a legal guarantee. */}
          {["$0 due during the free trial", "No per-lead fees", "Consent, DNC and calling-window screening before a dial"].map((item) => (
            <li key={item} className="flex list-none items-center gap-2"><Check className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

```

## components/marketing/landing-exploded.tsx

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BadgeCheck, Check, CircleDollarSign, PhoneIncoming, Receipt, ShieldCheck, UserRound } from "lucide-react";

import { segment, useStickyProgress } from "@/components/marketing/motion";
import { Satellite } from "@/components/marketing/landing-mocks";

/**
 * "Inside one call" (2026-10-13, third pass: owner asked for it to be as striking as the rest of the
 * page, and still easy to follow). One lead, followed from the transfer to the commission:
 *  - a journey rail across the top, with the intro's point of light riding it from station to
 *    station;
 *  - one live call card that becomes each moment in turn — the transfer ringing and being claimed,
 *    the lead getting its price tag, the four checks ticking off, the application typing itself and
 *    taking its Issued stamp, the commission counting up;
 *  - a running ledger under it that fills in as the sale builds, with a chip floating out at each
 *    milestone;
 *  - on the left, the step's number, name and one plain sentence.
 * Everything is driven by scroll position (one sticky stage), rests at transform: none so text is
 * pixel-sharp, and below lg (or under reduced motion) the five moments are simply laid out in order.
 */
type Step = { key: string; icon: typeof Check; station: string; title: string; body: string };

const STEPS: Step[] = [
  { key: "floor", icon: PhoneIncoming, station: "Transfer", title: "A live transfer lands", body: "A partner sends a caller to your floor. Two closers reach for it — the server settles who won, in the same second." },
  { key: "lead", icon: UserRound, station: "Lead", title: "The lead, and what it cost", body: "The campaign and the vendor that sold it ride along with the lead — so its price is never lost." },
  { key: "checks", icon: ShieldCheck, station: "Checks", title: "Four checks before the dial", body: "Consent, DNC, your suppression list and the caller's local time — re-checked by the server, every dial." },
  { key: "application", icon: BadgeCheck, station: "Policy", title: "Quoted, applied, issued", body: "The application is filled and submitted while the customer is still on the line." },
  { key: "commission", icon: Receipt, station: "Commission", title: "The answer you buy leads for", body: "The carrier's statement is matched to the policy — so the cost of that lead finally has a return beside it." },
];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (from: number, to: number, value: number) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };
const typed = (text: string, t: number) => text.slice(0, Math.round(text.length * clamp01(t)));
const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px) and (prefers-reduced-motion: no-preference)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

/* ── The five moments. Each draws itself from t: 0 when it begins, 1 when it is complete. ───────── */

function FloorScene({ t }: { t: number }) {
  const claimed = t > 0.45;
  const wait = Math.round(4 + t * 17);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="relative">
        {!claimed && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[color-mix(in_srgb,var(--primary)_35%,transparent)]" />}
        <span className={`relative inline-flex size-16 items-center justify-center rounded-full text-title-sm font-semibold transition-colors duration-500 ${claimed ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[color-mix(in_srgb,var(--primary)_18%,var(--color-card))] text-[var(--accent-ink)]"}`}>
          {claimed ? <Check className="size-7" strokeWidth={3} aria-hidden="true" /> : "MV"}
        </span>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">{claimed ? "Claimed by you" : "Incoming live transfer"}</div>
        <div className="mt-1 text-title-sm font-semibold text-foreground">Marisol Vega</div>
        <div className="text-sm text-muted-foreground">Northline BPO → your floor · waiting <span className="tabular-nums">0:{String(wait).padStart(2, "0")}</span></div>
      </div>
      <div className="grid w-full max-w-[340px] grid-cols-2 gap-2">
        <div className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-all duration-500 ${claimed ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-foreground" : "border-border text-foreground"}`}>
          You {claimed ? "· won it" : "· Claim"}
        </div>
        <div className={`rounded-xl border border-border px-3 py-2 text-sm font-semibold transition-all duration-500 ${claimed ? "text-muted-foreground line-through opacity-60" : "text-foreground"}`}>
          Dana R. {claimed ? "· too late" : "· Claim"}
        </div>
      </div>
    </div>
  );
}

function LeadScene({ t }: { t: number }) {
  const facts: Array<[string, string]> = [["Campaign", "Cobalt Media · FE-Sep"], ["Vendor", "Cobalt Media"], ["State", "Illinois"], ["Product", "Final expense"]];
  const tag = smooth(0.55, 0.85, t);
  return (
    // Below 480px (the stacked phone cards) the price tag drops into the flow under the name instead of
    // floating over it, and the facts follow it (2026-10-22).
    <div className="relative flex h-full flex-col justify-center px-7 max-[479px]:px-5">
      <div className="flex items-center gap-3 pr-32 max-[479px]:pr-0">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_18%,var(--color-card))] text-sm font-semibold text-[var(--accent-ink)]">MV</span>
        <div>
          <div className="text-title-sm font-semibold text-foreground">Marisol Vega</div>
          <div className="text-sm text-muted-foreground">(312) 555-0148</div>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-2 max-[479px]:order-2">
        {facts.map(([label, value], index) => {
          const shown = smooth(index * 0.12, index * 0.12 + 0.2, t);
          return (
            <div key={label} className="rounded-xl border border-border px-3 py-2" style={{ opacity: shown, transform: `translate3d(0, ${(1 - shown) * 10}px, 0)` }}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="m-0 text-sm font-semibold text-foreground">{value}</dd>
            </div>
          );
        })}
      </dl>
      {/* The price tag swings onto the lead. */}
      <div
        className="absolute right-6 top-6 origin-top-right rounded-xl max-[479px]:static max-[479px]:order-1 max-[479px]:mt-4 max-[479px]:self-start max-[479px]:origin-top-left border border-[var(--primary)] bg-[var(--color-card)] px-3.5 py-2 shadow-[0_14px_30px_-14px_color-mix(in_srgb,var(--primary)_70%,transparent)]"
        style={{ opacity: tag, transform: `rotate(${(1 - tag) * -14 + 4}deg) scale(${0.85 + tag * 0.15})` }}
      >
        <div className="text-xs text-muted-foreground">Paid for this lead</div>
        <div className="text-title-sm font-semibold tabular-nums text-[var(--accent-ink)]">$38.00</div>
      </div>
    </div>
  );
}

const CHECKS = ["Consent on file", "DNC check", "Your suppression list", "Caller's calling window"];

function ChecksScene({ t }: { t: number }) {
  const done = CHECKS.map((_, index) => t > 0.12 + index * 0.18);
  const cleared = t > 0.86;
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-7">
      {CHECKS.map((label, index) => (
        <div key={label} className={`relative flex items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-2.5 transition-colors duration-500 ${done[index] ? "border-[color-mix(in_srgb,var(--success)_45%,transparent)]" : "border-border"}`}>
          {/* The scan passing over the row being checked. */}
          {!done[index] && (index === 0 || done[index - 1]) && t > 0 && (
            <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--primary)_22%,transparent),transparent)]" style={{ transform: `translateX(${((t * 900) % 300) - 100}%)` }} />
          )}
          <span className={`relative inline-flex size-5 items-center justify-center rounded-full transition-colors duration-300 ${done[index] ? "bg-[var(--success)] text-[var(--on-success)]" : "border border-[var(--border-strong)]"}`}>
            {done[index] && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
          </span>
          <span className="relative text-sm font-semibold text-foreground">{label}</span>
          <span className={`relative ml-auto text-sm ${done[index] ? "text-[var(--success)]" : "text-muted-foreground"}`}>{done[index] ? "Clear" : "Checking…"}</span>
        </div>
      ))}
      <div className={`mt-1 self-start rounded-full px-3 py-1 text-xs font-semibold transition-all duration-500 ${cleared ? "bg-[var(--primary)] text-[var(--on-primary)] opacity-100" : "opacity-0"}`}>
        Cleared to dial · 2:14 PM her time
      </div>
    </div>
  );
}

function ApplicationScene({ t }: { t: number }) {
  const fields: Array<[string, string, number, number]> = [
    ["Carrier", "Mutual · Living Promise", 0.05, 0.3],
    ["Face amount", "$14,000", 0.3, 0.45],
    ["Draft date", "3rd of the month", 0.45, 0.62],
  ];
  const stamp = smooth(0.72, 0.9, t);
  return (
    <div className="relative flex h-full flex-col justify-center px-7">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Application · on the same call</div>
      <div className="mt-3 space-y-2">
        {fields.map(([label, value, from, to]) => {
          const text = typed(value, (t - from) / (to - from));
          const typing = t > from && t < to;
          return (
            <div key={label} className="flex items-center justify-between rounded-xl border border-border px-3.5 py-2.5">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-sm font-semibold text-foreground">
                {text}
                {typing && <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-[var(--primary)]" />}
              </span>
            </div>
          );
        })}
      </div>
      {/* The Issued stamp lands across the form (below it on narrow phones, where it would cover a field). */}
      <div
        className="pointer-events-none absolute bottom-5 right-6 rounded-xl border-2 max-[479px]:static max-[479px]:mr-2 max-[479px]:mt-4 max-[479px]:self-end border-[var(--success)] px-3 py-1.5 text-center text-[var(--success)]"
        style={{ opacity: stamp, transform: `rotate(-8deg) scale(${1.6 - stamp * 0.6})` }}
      >
        <div className="text-sm font-semibold uppercase tracking-[0.12em]">Issued</div>
        <div className="text-xs font-semibold tabular-nums">FE-20931</div>
      </div>
    </div>
  );
}

function CommissionScene({ t }: { t: number }) {
  const earned = 612 * (1 - Math.pow(1 - smooth(0.05, 0.6, t), 3));
  const equation = smooth(0.55, 0.8, t);
  return (
    <div className="flex h-full flex-col justify-center px-7">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Matched to the carrier&apos;s statement</div>
      <div className="mt-1 text-hero font-semibold leading-none tracking-[-0.04em] tabular-nums text-[var(--accent-ink)]">+${money(earned)}</div>
      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm" style={{ opacity: equation, transform: `translate3d(0, ${(1 - equation) * 10}px, 0)` }}>
        <span className="rounded-full border border-border px-3 py-1 font-semibold text-foreground">Lead $38.00</span>
        <span aria-hidden="true" className="text-muted-foreground">→</span>
        <span className="rounded-full border border-border px-3 py-1 font-semibold text-foreground">Issued $14,000</span>
        <span aria-hidden="true" className="text-muted-foreground">→</span>
        <span className="rounded-full bg-[var(--primary)] px-3 py-1 font-semibold text-[var(--on-primary)]">Earned $612.00</span>
      </div>
      <div className="mt-4 text-sm text-muted-foreground" style={{ opacity: smooth(0.75, 0.95, t) }}>
        Across the whole campaign: <span className="font-semibold text-foreground">$227.44</span> per issued policy.
      </div>
    </div>
  );
}

const SCENES = [FloorScene, LeadScene, ChecksScene, ApplicationScene, CommissionScene];

/* ── The pieces around the card ─────────────────────────────────────────────────────────────── */

/** The journey rail: five stations, the line filling behind the lead's point of light. */
function JourneyRail({ active, t }: { active: number; t: number }) {
  const position = Math.min(1, (active + smooth(0.75, 1, t)) / (STEPS.length - 1));
  return (
    <div className="relative px-4 pb-1 pt-2">
      <div className="absolute left-[calc(1rem+16px)] right-[calc(1rem+16px)] top-[calc(0.5rem+16px)] h-0.5 rounded-full bg-border">
        <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${position * 100}%` }} />
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--primary)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_25%,transparent),0_0_18px_4px_color-mix(in_srgb,var(--primary)_55%,transparent)]"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <ol className="relative m-0 flex justify-between p-0">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          const reached = index <= active;
          return (
            <li key={step.key} className="flex w-16 list-none flex-col items-center gap-1.5">
              <span className={`inline-flex size-8 items-center justify-center rounded-full border transition-all duration-500 ${reached ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-border bg-[var(--color-card)] text-muted-foreground"} ${index === active ? "scale-110" : ""}`}>
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className={`text-xs font-semibold transition-colors duration-500 ${reached ? "text-foreground" : "text-muted-foreground"}`}>{step.station}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The running ledger: what this one lead has cost, been through and earned so far. */
function Ledger({ active, t }: { active: number; t: number }) {
  const checks = active > 2 ? 4 : active === 2 ? CHECKS.filter((_, index) => t > 0.12 + index * 0.18).length : 0;
  const cells: Array<{ label: string; value: string; on: boolean }> = [
    { label: "Lead cost", value: active >= 1 && (active > 1 || t > 0.55) ? "$38.00" : "—", on: active >= 1 && (active > 1 || t > 0.55) },
    { label: "Checks", value: `${checks} / 4`, on: checks === 4 },
    { label: "Issued", value: active > 3 || (active === 3 && t > 0.72) ? "$14,000" : "—", on: active > 3 || (active === 3 && t > 0.72) },
    { label: "Commission", value: active === 4 ? `+$${money(612 * (1 - Math.pow(1 - smooth(0.05, 0.6, t), 3)))}` : "—", on: active === 4 && t > 0.6 },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {cells.map((cell) => (
        <div key={cell.label} className={`rounded-xl border px-3 py-2 transition-colors duration-500 ${cell.on ? "border-[color-mix(in_srgb,var(--primary)_60%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,var(--color-card))]" : "border-border bg-[var(--color-card)]"}`}>
          <div className="text-xs text-muted-foreground">{cell.label}</div>
          <div className="text-sm font-semibold tabular-nums text-foreground">{cell.value}</div>
        </div>
      ))}
    </div>
  );
}

/** A chip that floats out beside the card when a milestone is reached, then settles and fades. */
function Milestone({ show, className, children }: { show: boolean; className: string; children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)] ${className}`}
      style={{ opacity: show ? 1 : 0, transform: show ? "none" : "translate3d(0, 14px, 0) scale(.94)" }}
    >
      {children}
    </div>
  );
}

/** The console surface, shared by the desktop stage and the stacked phone cards. */
const CONSOLE = "border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_5%,var(--color-card))] text-foreground";

function CallChrome({ seconds, children }: { seconds: number; children: ReactNode }) {
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    // The console follows the theme: a light, mint-tinted card in light mode and a dark one in dark
    // mode, both edged and lit in brand green (owner, 2026-10-13).
    <div className={`${CONSOLE} relative overflow-hidden rounded-2xl shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_12%,transparent),0_40px_80px_-30px_color-mix(in_srgb,var(--primary)_45%,transparent)]`}>
      <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--primary)_22%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,var(--color-card))] px-4 py-2.5">
        <span className="relative inline-flex size-2">
          <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[var(--primary)]" />
          <span className="relative inline-flex size-2 rounded-full bg-[var(--primary)]" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">One call · Marisol Vega</span>
        <span className="ml-auto text-xs font-semibold tabular-nums text-foreground">{clock}</span>
      </div>
      {children}
    </div>
  );
}

export function LandingExploded() {
  const desktop = useDesktop();
  const { ref, progress } = useStickyProgress<HTMLElement>();
  // The scroll is shared evenly between the five moments; t is how far into the current one we are.
  const span = segment(progress, 0.03, 0.95) * STEPS.length;
  const active = Math.min(STEPS.length - 1, Math.floor(span));
  const t = active === STEPS.length - 1 ? clamp01(span - active) : span - active;
  const step = STEPS[active];
  const seconds = Math.round(21 + progress * 540); // the call's own clock: one call, start to finish

  return (
    <section ref={ref} id="product" aria-labelledby="exploded-title" className="relative scroll-mt-16 bg-[var(--surface-alt)] antialiased lg:h-[520vh]">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 py-24 sm:px-6 lg:sticky lg:top-0 lg:h-screen lg:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)] lg:gap-16 lg:px-16 lg:pb-10 lg:pt-24">
        <div>
          <p className="text-sm font-semibold text-[var(--accent-ink)]">Inside one call</p>
          <h2 id="exploded-title" className="mt-3 text-title-lg font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--ink)] sm:text-headline-lg">Everything a sale touches, in one place.</h2>

          {desktop ? (
            <div className="mt-10">
              <div className="flex items-baseline gap-2 tabular-nums">
                <span className="text-headline-lg font-semibold leading-none tracking-[-0.04em] text-[var(--accent-ink)]">{String(active + 1).padStart(2, "0")}</span>
                <span className="text-sm font-semibold text-muted-foreground">/ {String(STEPS.length).padStart(2, "0")}</span>
              </div>
              {/* The step's words, crossfading as the step changes. */}
              <div className="relative mt-4 min-h-[132px]">
                {STEPS.map((item, index) => (
                  <div
                    key={item.key}
                    aria-hidden={index !== active}
                    className="absolute inset-x-0 top-0 transition-all duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
                    style={{ opacity: index === active ? 1 : 0, transform: index === active ? "none" : `translate3d(0, ${index < active ? -12 : 12}px, 0)` }}
                  >
                    <h3 className="text-title-md font-semibold leading-tight tracking-[-0.02em] text-foreground">{item.title}</h3>
                    <p className="mt-2 max-w-[44ch] text-base leading-relaxed text-muted-foreground">{item.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex gap-1.5" aria-hidden="true">
                {STEPS.map((item, index) => (
                  <span key={item.key} className="h-1 flex-1 overflow-hidden rounded-full bg-border">
                    <span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${index < active ? 100 : index === active ? clamp01(t) * 100 : 0}%` }} />
                  </span>
                ))}
              </div>
              <p className="sr-only">Step {active + 1} of {STEPS.length}: {step.title}.</p>
            </div>
          ) : (
            <ol className="mt-8 space-y-6 p-0">
              {STEPS.map((item, index) => {
                const Scene = SCENES[index];
                const Icon = item.icon;
                return (
                  <li key={item.key} className="list-none">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-[var(--primary)] text-[var(--on-primary)]"><Icon className="size-4" aria-hidden="true" /></span>
                      <span className="text-base font-semibold text-foreground">{item.title}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-normal text-muted-foreground">{item.body}</p>
                    <div aria-hidden="true" className={`${CONSOLE} mt-3 grid min-h-[300px] overflow-hidden rounded-2xl py-5`}><Scene t={1} /></div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {desktop && (
          <div aria-hidden="true" className="relative">
            <JourneyRail active={active} t={t} />
            <div className="relative mt-5">
              {/* A soft halo of green behind the console. */}
              <div aria-hidden="true" className="pointer-events-none absolute -inset-12 -z-0 rounded-[48px] bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--primary)_22%,transparent),transparent)] blur-2xl" />
              <CallChrome seconds={seconds}>
                <div className="relative h-[340px]">
                  {SCENES.map((Scene, index) => (
                    <div
                      key={STEPS[index].key}
                      className="absolute inset-0 transition-all duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
                      style={{
                        opacity: index === active ? 1 : 0,
                        transform: index === active ? "none" : `translate3d(${index < active ? -24 : 24}px, 0, 0)`,
                        pointerEvents: "none",
                      }}
                    >
                      <Scene t={index < active ? 1 : index === active ? t : 0} />
                    </div>
                  ))}
                </div>
              </CallChrome>
              <Milestone show={active === 0 && t > 0.5} className="-right-6 top-10">
                <Satellite icon={<Check className="size-4" aria-hidden="true" />} label="Claimed in" value="4 seconds" tone="success" />
              </Milestone>
              <Milestone show={active === 2 && t > 0.88} className="-left-8 bottom-16">
                <Satellite icon={<ShieldCheck className="size-4" aria-hidden="true" />} label="Compliance" value="4 of 4 clear" tone="success" />
              </Milestone>
              <Milestone show={active === 4 && t > 0.62} className="-right-8 top-20">
                <Satellite icon={<CircleDollarSign className="size-4" aria-hidden="true" />} label="Return on this lead" value="16.1×" />
              </Milestone>
            </div>
            <div className="mt-4">
              <Ledger active={active} t={t} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

```

## components/marketing/landing-bento.tsx

```tsx
import type { ReactNode } from "react";

import { CountUp, Reveal } from "@/components/marketing/motion";
import { LandingObject } from "@/components/marketing/three/landing-object";

/**
 * The capability grid (2026-10-13): four calm tiles, three of them holding a live 3D object — calls
 * arcing across a globe, a heater shield with a scan passing down it, a policy card turning in the
 * light. Every line is something the product does today; figures are labelled samples. The three
 * small text-only tiles were removed at the owner's request, and the section sits close to pricing.
 */
function Tile({ title, body, children, className = "", tone = "light" }: { title: string; body: string; children?: ReactNode; className?: string; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <article className={`relative flex flex-col overflow-hidden rounded-[28px] border p-7 sm:p-8 ${dark ? "border-transparent bg-[var(--footer-bg)] text-[var(--nav-ink)]" : "border-border bg-card"} ${className}`}>
      <h3 className={`max-w-[26ch] text-title-sm font-semibold leading-[1.2] tracking-[-0.02em] ${dark ? "" : "text-[var(--ink)]"}`}>{title}</h3>
      <p className={`mt-2 max-w-[44ch] text-sm leading-[1.6] ${dark ? "text-[var(--nav-muted)]" : "text-muted-foreground"}`}>{body}</p>
      {children}
    </article>
  );
}

const VENDORS = [
  { name: "Cobalt Media", value: 227, width: 46 },
  { name: "Summit Live", value: 312, width: 64 },
  { name: "Bayview Data", value: 488, width: 100 },
];

export function LandingBento() {
  return (
    <section id="features" aria-labelledby="bento-title" className="scroll-mt-20 bg-background px-4 pb-10 pt-24 sm:px-6 lg:px-16 lg:pb-12 lg:pt-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-[760px]">
          <p className="text-sm font-semibold text-[var(--accent-ink)]">What it does</p>
          <h2 id="bento-title" className="mt-3 text-title-lg font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--ink)] sm:text-headline-lg">
            Built for the way insurance is really sold.
          </h2>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Reveal className="lg:col-span-7" variant="rise">
            <Tile title="Every live transfer, claimed exactly once." body="Transfers from your partners land on one floor, screened, with the wait on the row. Two closers click — the server settles who won." className="h-full min-h-[480px]">
              <LandingObject kind="sphere" className="pointer-events-none absolute -bottom-4 -right-6 size-[340px] sm:size-[400px] lg:bottom-0 lg:right-0 lg:size-[380px]" />
            </Tile>
          </Reveal>
          <Reveal className="lg:col-span-5" variant="rise" delay={100}>
            <Tile tone="dark" title="Four checks before every dial." body="Consent, DNC, your suppression list and the customer's calling window — re-checked by the server in the instant before the call. A refusal is logged with its reason." className="h-full min-h-[480px]">
              <LandingObject kind="shield" className="pointer-events-none absolute bottom-2 left-1/2 size-[300px] -translate-x-1/2" />
            </Tile>
          </Reveal>

          <Reveal className="lg:col-span-5" variant="rise">
            <Tile title="Every commission matched to its policy." body="Carrier statements come in, each line meets the policy you wrote, and what was owed is set against what was paid." className="h-full min-h-[400px]">
              <LandingObject kind="card" className="pointer-events-none absolute inset-x-0 bottom-0 h-[260px]" />
            </Tile>
          </Reveal>
          <Reveal className="lg:col-span-7" variant="rise" delay={100}>
            <Tile title="The number nobody else can give you." body="True cost per issued policy, by campaign and by vendor — computed from your own linked data, never estimated." className="h-full min-h-[400px]">
              <div className="mt-auto pt-8">
                <div className="flex items-baseline gap-3">
                  <span className="text-hero font-semibold tabular-nums tracking-[-0.04em] text-[var(--ink)]"><CountUp value={227.44} prefix="$" decimals={2} /></span>
                  <span className="text-sm text-muted-foreground">per issued policy · sample</span>
                </div>
                <ul className="m-0 mt-6 space-y-3 p-0">
                  {VENDORS.map((vendor, index) => (
                    <li key={vendor.name} className="list-none">
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">{vendor.name}</span><span className="font-semibold tabular-nums text-foreground">${vendor.value}</span></div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                        <div className="h-full rounded-full" style={{ width: `${vendor.width}%`, background: index === 0 ? "var(--primary)" : `color-mix(in srgb, var(--primary) ${60 - index * 18}%, var(--surface-alt))` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </Tile>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

```

## components/marketing/landing-sections.tsx

```tsx
import Link from "next/link";
import { ArrowRight, Ban, Check, ChevronDown, Eye, FileCheck2, Lock, ScrollText, ShieldCheck, Sigma } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CountUp, Reveal, SplitWords } from "@/components/marketing/motion";
import { LandingObject } from "@/components/marketing/three/landing-object";
import styles from "@/components/marketing/landing.module.css";
import { featuresByModule, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * The landing page's static sections: truths, problem, three jobs, compliance, pricing teaser,
 * questions and the closing call to action. Server-rendered; the motion is layered on by the client
 * helpers (Reveal, SplitWords, CountUp).
 *
 * Every claim on this page is one the product enforces. The board's customer logos, named
 * testimonial, "40,000+ policies" line and "SOC 2 Type II" badge are not here: none of them is
 * backed by anything we can show, and a marketing page is a promise a customer can hold us to.
 */

/* ── A marquee of what the product refuses to do / always does ──────────────────────────────── */
const TRUTHS = [
  { icon: ShieldCheck, text: "4 checks re-run by the server before every dial" },
  { icon: Sigma, text: "True CPA computed from your own linked data" },
  { icon: Ban, text: "A missing figure reads —, never $0.00" },
  { icon: Eye, text: "Partners never see each other’s leads" },
  { icon: Lock, text: "Subscription card payments are taken on the provider’s hosted page" },
  { icon: FileCheck2, text: "Consent and disclosure evidence kept per attempt" },
  { icon: ScrollText, text: "Changes to key records are kept in an audit log" },
];

/**
 * Who it is for, said plainly (2026-10-13): no customer logos we cannot name, no moving marquee —
 * a still line of the businesses it is built for, and the guarantees beside it.
 */
const AUDIENCE = ["Final expense", "Term & whole life", "Medicare & health", "Live-transfer floors", "Outbound call centers", "IMOs & FMOs", "Independent agents"];

export function LandingTruths() {
  return (
    <section id="industries" aria-label="Who Insurvas is for, and what it does" className="scroll-mt-20 border-y border-border bg-background px-4 py-10 sm:px-6 lg:px-16">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 text-center">
        <p className="text-sm font-semibold text-muted-foreground">Built for</p>
        <p className="m-0 flex flex-wrap justify-center gap-x-8 gap-y-3 text-base font-semibold tracking-[-0.01em] text-[var(--ink)] sm:text-lg">
          {AUDIENCE.map((name) => <span key={name}>{name}</span>)}
        </p>
        <ul className="m-0 flex flex-wrap justify-center gap-x-7 gap-y-2 p-0">
          {TRUTHS.slice(0, 4).map((truth) => {
            const Icon = truth.icon;
            return (
              <li key={truth.text} className="flex list-none items-center gap-2 text-sm text-muted-foreground">
                <Icon className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />{truth.text}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ── Compliance ──────────────────────────────────────────────────────────────────────────────── */
const CHECKS = [
  { title: "Consent on file", body: "The evidence behind the lead, kept with it." },
  { title: "DNC lists", body: "Checked against the DNC sources your agency configures, before the dial." },
  { title: "Your suppression list", body: "Anyone who asked you to stop, stays stopped." },
  { title: "Calling window", body: "The customer’s local time, not the agent’s." },
];

export function LandingCompliance() {
  return (
    <section id="compliance" className="relative isolate scroll-mt-20 overflow-hidden bg-[var(--footer-bg)] px-4 py-24 text-[var(--nav-ink)] sm:px-6 lg:px-16 lg:py-32">
      <div aria-hidden="true" className={`${styles.aurora} -right-80 -top-60 opacity-50`} />
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color-mix(in_srgb,var(--primary)_70%,white)]">Compliance</p>
          <h2 className="mt-3 text-title-lg font-semibold leading-[1.1] tracking-[-0.03em] sm:text-headline-lg"><SplitWords text="The browser can’t talk its way past a refusal." /></h2>
          <p className="mt-5 max-w-[54ch] text-base leading-[1.6] text-[var(--nav-muted)]">
            The dialer panel shows you the state. Then the server re-checks all four, in the instant before the call is placed.
            If any one fails, the dial is refused — and the refusal is logged with the reason. Screening uses the checks and
            vendors your agency configures; it is a tool, not a guarantee of legal compliance.
          </p>
          <div className="mt-8 flex flex-wrap gap-8">
            <div><div className="text-headline-lg font-semibold tracking-[-0.03em]"><CountUp value={4} /></div><div className="mt-1 text-sm text-[var(--nav-muted)]">checks before every dial</div></div>
            <div><div className="text-headline-lg font-semibold tracking-[-0.03em]"><CountUp value={0} /></div><div className="mt-1 text-sm text-[var(--nav-muted)]">dials the browser can force</div></div>
            <div><div className="text-headline-lg font-semibold tracking-[-0.03em]"><CountUp value={1} /></div><div className="mt-1 text-sm text-[var(--nav-muted)]">record per attempt, kept</div></div>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" style={{ perspective: 1400 }}>
          {CHECKS.map((check, index) => (
            <Reveal key={check.title} variant="tilt" delay={index * 110}>
              <div className={`rounded-2xl border border-[var(--nav-line)] bg-[color-mix(in_srgb,white_4%,transparent)] p-6 backdrop-blur ${styles.scan}`} style={{ animationDelay: `${index * 0.9}s` }}>
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--success)] text-[var(--on-success)]"><Check className="size-4" strokeWidth={3} aria-hidden="true" /></span>
                <div className="mt-4 text-lg font-semibold">{check.title}</div>
                <p className="mt-1 text-sm leading-normal text-[var(--nav-muted)]">{check.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Pricing teaser, from the live catalog ───────────────────────────────────────────────────── */
function monthlyNumber(plan: PublicPlan) {
  const n = plan.price_monthly ? Number(plan.price_monthly.replace(/[^0-9.]/g, "")) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** "2499.00" → "$2,499.00", the way /pricing shows the same plan (QA 2026-10-22: the teaser had no currency). */
function dollars(price: string) {
  const n = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : price;
}

/**
 * The plans as a ladder (2026-10-13): each step names the modules it adds to the one below, read
 * from the catalog — so the teaser can never promise a module a plan does not grant.
 */
export function LandingPricingTeaser({ plans }: { plans: PublicPlan[] }) {
  // The ladder is the individual-agent plans; agencies get one line under it, to their own view of
  // /pricing (2026-10-22: the agency seat bands are a different purchase, not a fourth rung).
  const ladder = plans.filter((plan) => plan.audience === "individual").sort((a, b) => monthlyNumber(a) - monthlyNumber(b));
  const agencyFrom = plans.filter((plan) => plan.audience === "agency").sort((a, b) => monthlyNumber(a) - monthlyNumber(b))[0] ?? null;
  const trialDays = ladder.find((plan) => plan.trial_days > 0)?.trial_days ?? null;
  return (
    <section className="bg-background px-4 pb-24 pt-14 sm:px-6 lg:px-16 lg:pb-32 lg:pt-16">
      <div className="mx-auto max-w-7xl">
        <Reveal className="mx-auto max-w-[720px] text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">Pricing</p>
          <h2 className="mt-3 text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">Priced per workspace, never per lead.</h2>
          <p className="mt-4 text-base leading-[1.65] text-muted-foreground">You already pay your vendors by the lead. Start with your book, add the floor and the dialer when you are ready{trialDays ? <> — {trialDays} days free, with nothing charged until the trial ends</> : null}. Add-ons and usage above a plan’s allowance are priced separately.</p>
        </Reveal>

        {ladder.length > 0 && (
          <div className={`mt-12 grid grid-cols-1 gap-5 ${ladder.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
            {ladder.map((plan, index) => {
              const below = index > 0 ? new Set(ladder[index - 1].features.map((feature) => feature.module)) : new Set<string>();
              const modules = featuresByModule(plan.features).filter((group) => !below.has(group.module));
              return (
                <Reveal key={plan.code} variant="rise" delay={index * 120} className="h-full">
                  <div className={`relative flex h-full flex-col rounded-3xl border bg-card p-7 ${plan.is_default ? `border-transparent ${styles.glowBorder}` : "border-border"}`}>
                    {plan.is_default && <span className="absolute -top-3 left-7 rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-[var(--on-primary)]">Recommended</span>}
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-title-sm font-semibold text-foreground">{plan.name}</span>
                      {plan.price_monthly && <span className="text-title-md font-semibold tabular-nums tracking-[-0.02em] text-foreground">{dollars(plan.price_monthly)}<span className="text-sm font-normal text-muted-foreground">/mo</span></span>}
                    </div>
                    {plan.blurb && <p className="mt-2 text-sm leading-normal text-muted-foreground">{plan.blurb}</p>}
                    <p className="mt-5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{index === 0 ? "Includes" : `Everything in ${ladder[index - 1].name}, plus`}</p>
                    <ul className="mt-3 flex flex-1 flex-wrap content-start gap-2 p-0">
                      {modules.map((group) => (
                        <li key={group.module} className="list-none rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--accent-ink)]">
                          {group.label} <span className="font-normal opacity-70">· {group.features.length}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              );
            })}
          </div>
        )}

        {agencyFrom && (
          <p className="mt-8 text-center text-base text-muted-foreground">
            Running an agency? One flat price for the whole team, from{" "}
            <span className="font-semibold text-foreground">{agencyFrom.price_monthly ? `${dollars(agencyFrom.price_monthly)}/month` : "a flat band"}</span>
            {agencyFrom.max_seats ? ` for up to ${agencyFrom.max_seats} seats` : ""}.{" "}
            <Link href="/pricing?for=agency" className="font-semibold text-[var(--accent-ink)]">See agency pricing</Link>
          </p>
        )}

        <div className="mt-8 flex justify-center">
          <Button asChild variant="outline" className="h-11 rounded-full px-6"><Link href="/pricing"><span className="min-[400px]:hidden">See every plan</span><span className="hidden min-[400px]:inline">See every plan, module by module</span><ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
        </div>
      </div>
    </section>
  );
}

/* ── Questions ───────────────────────────────────────────────────────────────────────────────── */
const FAQS = [
  { q: "Do you store card details?", a: "Not for your subscription: it is paid on our payment provider’s hosted page, and the card number never reaches an Insurvas server. Payment details your agents take from a client on an insurance application are a different matter — those are stored, encrypted, in your workspace so the application can be submitted." },
  { q: "Is screening really run before every dial?", a: "Yes, and on the server. The panel shows you the state, then the API re-checks consent, DNC, your suppression list and the calling window in the moment before the call is placed. If any of them fails, the dial is refused. The checks use the rules and vendors your agency configures — it is a screening tool, not a guarantee that every call is lawful, and compliance stays your agency’s responsibility." },
  { q: "What happens to my data?", a: "Your workspace’s data is kept separate from other agencies’ and is processed only to run the service for you, as our Privacy Policy describes. Leads and policies export from the app. Offboarding a partner keeps their history for audit and reporting. If you cancel, the workspace stays readable for a set period so you can export; after that, ask support to delete what remains." },
  { q: "Can partners see each other’s leads?", a: "Never. A partner signs into their own view: leads their organisation submitted, the stages those leads reached, and their channel with you. No other partner’s anything, no agent-internal notes, and no lead cost." },
  { q: "Do you charge per lead?", a: "No. You already pay your vendors by the lead; we are not going to charge you again for the same one. Pricing is per workspace, with seat and import limits stated on every plan; add-ons you choose and metered usage above your plan’s allowance (for example extra statement pages) are billed at the rates shown." },
];

export function LandingFaq() {
  return (
    <section id="faq" className="scroll-mt-24 bg-background px-4 pb-24 sm:px-6 lg:px-16 lg:pb-32">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">Questions</p>
          <h2 className="mt-3 text-title-lg font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-headline-lg">The ones people actually ask</h2>
        </Reveal>
        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          {FAQS.map((item) => (
            <details key={item.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-foreground">
                {item.q}
                <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-3 max-w-[70ch] text-sm leading-[1.7] text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Closing call to action ──────────────────────────────────────────────────────────────────── */
export function LandingCta() {
  return (
    <section className="relative isolate overflow-hidden bg-[var(--footer-bg)] px-4 py-28 text-center text-[var(--nav-ink)] sm:px-6 lg:px-16">
      <LandingObject kind="ribbon" className="pointer-events-none absolute inset-x-[-10%] top-[10%] -z-10 h-[90%] opacity-70" />
      {/* A pool of ink behind the words, so the ribbon's bright strips never run through the text. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_46%_58%_at_50%_48%,var(--footer-bg)_40%,transparent_100%)]" />
      <Reveal className="relative mx-auto max-w-[760px]">
        <h2 className="text-headline-lg font-semibold leading-[1.05] tracking-[-0.035em] sm:text-hero"><SplitWords text="Try it free." /><br /><SplitWords text="Your own data." delay={260} wordClassName={styles.shimmerText} /></h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-base leading-[1.6] text-[var(--nav-muted)]">Import one vendor list and run a day on the floor. If it does not tell you something you did not know, close the tab.</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild className="h-12 rounded-full px-8 text-base shadow-[0_10px_40px_-8px_var(--primary)]"><Link href="/signup">Start your trial<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
          <Link href="/pricing" className="inline-flex h-12 items-center rounded-full border border-[var(--nav-line)] px-7 text-base font-semibold text-[var(--nav-ink)] no-underline transition-colors hover:border-[var(--nav-muted)] hover:bg-white/5">See pricing</Link>
        </div>
      </Reveal>
    </section>
  );
}

```

## components/public/site-header.tsx

```tsx
"use client";

import Link from "next/link";
import { ViewTransition, useEffect, useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import styles from "@/components/public/site-header.module.css";
import { ThemeSwitch } from "@/components/public/theme-switch";

/**
 * The marketing rail (2026-10-13): a floating, borderless glass pill rather than a full-width bar.
 * At the top of the page it sits nearly clear over the hero; once you scroll it firms up its glass
 * and casts a soft shadow. A light/dark switch sits beside Sign in. Links are 14px semibold, so the
 * nav never competes with the headline.
 *
 * `floating` (the landing page) lets the hero run underneath it; the other public pages keep it in
 * the flow. The section links are anchors on the landing page (/#…), so they work from every public
 * page. Below xl the nav folds into the shared Popover (foundation v3): a tap on one of its links,
 * Escape, or anywhere outside it closes it again, and focus returns to the menu button.
 *
 * Phones (2026-10-22): the pill tightens below sm and the logo steps down below 380px, so logo, trial
 * button and menu fit a 320px screen; below that (fold covers) the trial button moves into the
 * menu. The menu also carries the light/dark switch the bar drops below sm.
 */
const NAV: Array<{ href: string; label: string; key?: "home" | "pricing" }> = [
  { href: "/#product", label: "Product" },
  { href: "/#features", label: "Features" },
  { href: "/#industries", label: "Who it's for" },
  { href: "/#faq", label: "FAQ" },
  { href: "/pricing", label: "Pricing", key: "pricing" },
];

export function SiteHeader({ current, floating = false }: { current?: "home" | "pricing"; floating?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className={`${floating ? "fixed inset-x-0" : "sticky"} top-0 z-50 px-3 pt-3 sm:px-6`}>
      <div
        // Borderless frosted glass: mostly transparent, with a strong blur and a little extra
        // saturation so whatever scrolls underneath shows through softened, like a reflection.
        className={`relative mx-auto flex items-center gap-2 overflow-visible rounded-full border-0 py-2.5 pl-4 pr-2 backdrop-blur-2xl sm:gap-3 sm:py-3 sm:pl-6 sm:pr-3 backdrop-saturate-150 transition-[max-width,background-color,box-shadow] duration-500 ease-[cubic-bezier(.16,1,.3,1)] md:gap-8 ${
          scrolled
            ? "max-w-6xl bg-[color-mix(in_srgb,var(--color-card)_38%,transparent)] shadow-[0_12px_40px_-24px_rgba(13,64,55,.35)]"
            : "max-w-7xl bg-[color-mix(in_srgb,var(--color-card)_18%,transparent)] shadow-none"
        }`}
      >
        <Link href="/" aria-current={current === "home" ? "page" : undefined} className="flex shrink-0 items-center no-underline">
          {/* Named, so it glides into the sign-in form's logo (AuthBrand). */}
          <ViewTransition name="brand-logo" share="ribbon-morph" default="none">
            <InsurvasLogo size="public" alt="Insurvas" className={styles.introLogo} />
          </ViewTransition>
        </Link>

        <nav aria-label="Primary" className="mx-auto hidden max-w-2xl flex-1 items-center justify-evenly gap-2 xl:flex xl:gap-4">
          {NAV.map((item) => {
            const active = item.key && current === item.key;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold tracking-[-0.01em] no-underline transition-colors ${active ? "bg-[var(--surface-alt)] text-foreground" : "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--surface-alt)_80%,transparent)] hover:text-foreground"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <span className="flex-1 xl:hidden" />

        <div className="flex shrink-0 items-center gap-2">
          {/* Off below sm: logo + switch + trial + menu is wider than a 375px phone, which clipped the
              menu button off the edge (QA 2026-10-22). The phone follows the system theme. */}
          <span className="hidden sm:contents"><ThemeSwitch /></span>
          <Button asChild variant="ghost" className="hidden h-10 rounded-full px-4 sm:inline-flex">
            <Link href="/app/login">Sign in</Link>
          </Button>
          <Button asChild className="h-10 rounded-full px-3 text-sm max-[319px]:hidden sm:px-5">
            <Link href="/signup"><span className="sm:hidden">Try free</span><span className="hidden sm:inline">Start free trial</span></Link>
          </Button>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Menu" className="flex size-10 cursor-pointer items-center justify-center rounded-full border border-[var(--border-strong)] text-foreground xl:hidden">
                <Menu className="size-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={10} className="w-56 p-2">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} onClick={closeMenu} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-foreground no-underline hover:bg-[var(--surface-alt)]">
                  {item.label}
                </Link>
              ))}
              <div className="my-1 border-t border-border" />
              <Link href="/app/login" onClick={closeMenu} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-foreground no-underline hover:bg-[var(--surface-alt)]">Sign in</Link>
              <Link href="/signup" onClick={closeMenu} className="mt-1 block rounded-lg bg-[var(--primary)] px-3 py-2.5 text-center text-sm font-semibold text-[var(--on-primary)] no-underline min-[320px]:hidden">Start free trial</Link>
              <div className="flex items-center justify-between rounded-lg px-3 py-1 sm:hidden">
                <span className="text-sm font-semibold text-foreground">Theme</span>
                <ThemeSwitch />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}

```

## components/public/site-footer.tsx

```tsx
import Link from "next/link";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";
import { fetchCurrentDocuments } from "@/lib/legal/queries";

/**
 * The dark close of a public page.
 *
 * Ink ground, because a marketing page needs one hard edge at the bottom that says the reading is
 * over. The column set is deliberately short: only destinations that actually exist are listed — a
 * footer full of links that 404 is worse than a footer with a few. The three sign-in doors are all
 * here, because agents, partners and staff share a domain and land on the wrong form constantly.
 *
 * The strapline states only what the product enforces. It used to claim "SOC 2 Type II", which
 * nothing in the product or its documents backs; a certification is a claim a customer can hold
 * us to, so it goes back only with the report behind it.
 *
 * The brand block is the real mark (owner, 2026-10-13): the full logo, isotype and wordmark, in its
 * on-dark cut, since the ground here is always ink.
 *
 * The Legal column lists only documents that have a published version: /legal/dpa used to be linked
 * here and answered 404 because no DPA had been published. A failed read lists none rather than
 * guessing.
 */
const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "Inside one call" },
      { href: "/#features", label: "Features" },
      { href: "/#industries", label: "Who it's for" },
      { href: "/#faq", label: "Questions" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Sign in",
    links: [
      { href: "/app/login", label: "Agents" },
      { href: "/partner/login", label: "Partners" },
      { href: "/admin/login", label: "Insurvas staff" },
    ],
  },
];

/** Footer wording per document type, in the order the column shows them. */
const LEGAL_LINK_LABELS: Record<LegalDocType, string> = {
  tos: "Terms of service",
  privacy: "Privacy policy",
  dpa: "Data processing",
  subprocessors: "Subprocessors",
  cookies: "Cookies",
  refund: "Refunds",
};
const LEGAL_LINK_ORDER: LegalDocType[] = ["tos", "privacy", "dpa", "subprocessors", "cookies", "refund"];

async function publishedLegalLinks(): Promise<Array<{ href: string; label: string }>> {
  const documents = await fetchCurrentDocuments().catch(() => []);
  const published = new Set(documents.map((doc) => doc.doc_type));
  return LEGAL_LINK_ORDER.filter((type) => LEGAL_DOC_TYPES.includes(type) && published.has(type)).map((type) => ({
    href: `/legal/${type}`,
    label: LEGAL_LINK_LABELS[type],
  }));
}

export async function SiteFooter() {
  const legalLinks = await publishedLegalLinks();
  const columns = legalLinks.length > 0 ? [...COLUMNS, { title: "Legal", links: legalLinks }] : COLUMNS;
  return (
    <footer className="bg-[var(--footer-bg)] px-4 pb-10 pt-20 sm:px-6 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
          <div>
            <Link href="/" className="inline-flex no-underline">
              <InsurvasLogo size="auth" tone="dark" alt="Insurvas" />
            </Link>
            <p className="mt-4 max-w-[260px] text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)]">
              The operating system for insurance teams that buy leads and write policies.
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--nav-ink)]">{column.title}</div>
              <div className="mt-3">
                {column.links.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block py-[5px] text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)] no-underline hover:text-[var(--nav-ink)]"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-6 border-t border-[var(--nav-line)] pt-6">
          <span className="text-xs leading-normal tracking-[-0.01em] text-[var(--nav-muted)]">
            © {new Date().getFullYear()} Insurvas Inc. All rights reserved.
          </span>
          <span className="text-xs leading-normal tracking-[-0.01em] text-[var(--nav-muted)]">
            Pre-dial screening uses the checks and vendors your agency configures · Subscription payments are taken on our payment provider&rsquo;s hosted page
          </span>
        </div>
      </div>
    </footer>
  );
}

```
