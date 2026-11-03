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
