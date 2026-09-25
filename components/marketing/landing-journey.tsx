"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BadgeCheck, Check, FileSignature, Handshake, Phone, Receipt, ScanSearch, Send } from "lucide-react";

import { usePrefersReducedMotion } from "@/components/marketing/motion";
import { CpaMock, DialerMock } from "@/components/marketing/landing-mocks";
import styles from "@/components/marketing/landing.module.css";

/**
 * "Follow one lead": the whole product as one lead's journey, told on scroll. Seven steps on the
 * right; on the left a sticky 3D deck of screens where the current step's card sits at the front
 * and the ones already passed lift away over the top. The step nearest the middle of the viewport
 * is the active one. Below lg the deck is not sticky: each step shows its own screen inline.
 */
type Step = { key: string; title: string; icon: typeof Send; body: string; points: string[]; screen: ReactNode };

function Card({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_70px_-24px_rgba(0,0,0,.45)]">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--surface-alt)] px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{title}</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">Sample data</span>
      </div>
      {children}
    </div>
  );
}

const ok = (label: string, value: string) => (
  <div className="flex items-center gap-2.5 border-t border-border px-4 py-2.5 text-xs first:border-t-0">
    <span className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--success)] text-white"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span>
    <span className="flex-1 font-semibold text-foreground">{label}</span>
    <span className="text-muted-foreground">{value}</span>
  </div>
);

const STEPS: Step[] = [
  {
    key: "submit", icon: Send, title: "A partner sends a lead",
    body: "Publishers submit on a form you govern, in their own portal. They see their own leads and the stages those reached — never another partner's, never your notes, never your cost.",
    points: ["Fields and presets you define per product", "Duplicates caught at the door, with an override that is logged"],
    screen: (
      <Card title="Partner portal · Submit a lead">
        <div className="space-y-2 p-4">
          {[["Full name", "Marisol Vega"], ["Phone", "(312) 555–0148"], ["State", "Illinois"], ["Product", "Final expense"]].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="font-semibold text-foreground">{value}</span></div>
          ))}
          <div className="flex items-center justify-between pt-1"><span className="text-xs text-muted-foreground">Cobalt Media · FE-Sep</span><span className="rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--on-primary)]">Submit lead</span></div>
        </div>
      </Card>
    ),
  },
  {
    key: "screen", icon: ScanSearch, title: "Screened the moment it lands",
    body: "Consent evidence, duplicates and suppression are read on arrival and travel with the row, so a closer sees the state before they touch it.",
    points: ["Clear, needs review or duplicate — on the row", "A lead that saved but never reached the queue is shown, not swallowed"],
    screen: (
      <Card title="Screening">
        <div>{ok("Consent evidence", "Web form, 12 Sep")}{ok("Duplicate check", "No match in 90 days")}{ok("Tenant suppression", "Not suppressed")}{ok("Litigator list", "Clear")}</div>
      </Card>
    ),
  },
  {
    key: "claim", icon: Handshake, title: "One closer claims it",
    body: "Two agents click at once; the server decides who won. Claimed is kept separate from on a call, so a held lead never looks worked.",
    points: ["Longest-waiting first, with the SLA on the row", "Escalates to the partner if nobody claims in time"],
    screen: (
      <Card title="Agent floor · Transfer">
        <div className="grid grid-cols-2 gap-3 p-4">
          <div className="rounded-xl border-2 border-[var(--success)] bg-[var(--success-surface)] p-3">
            <div className="text-xs text-[var(--success-ink)]">Ray · closer</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-foreground"><BadgeCheck className="size-4 text-[var(--success)]" aria-hidden="true" />Claimed</div>
          </div>
          <div className="rounded-xl border border-border p-3 opacity-70">
            <div className="text-xs text-muted-foreground">Dana · closer</div>
            <div className="mt-1 text-sm font-semibold text-muted-foreground">Taken by Ray</div>
          </div>
          <div className="col-span-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-xs text-muted-foreground">Settled on the server: exactly one claim can win.</div>
        </div>
      </Card>
    ),
  },
  {
    key: "dial", icon: Phone, title: "Dialled only when it is legal",
    body: "Consent, the DNC registry, your suppression list and the customer's local calling window are re-checked by the server in the instant before the call — the browser cannot talk its way past a refusal.",
    points: ["Scored order, with the weights and holdout published", "Retries rotate through time slots instead of hammering one"],
    screen: <Card title="Outbound dialer"><DialerMock scanClass={styles.scan} /></Card>,
  },
  {
    key: "disposition", icon: FileSignature, title: "One outcome, one record",
    body: "The disposition is the stage change. The board, the call log and the pipeline can never disagree, because there is only one write.",
    points: ["Callbacks booked in the customer's timezone", "Every outcome lands somewhere — nothing falls out of the funnel"],
    screen: (
      <Card title="Disposition">
        <div className="p-4">
          <div className="flex flex-wrap gap-1.5">
            {["Contacted", "Quoted", "Callback", "No answer"].map((label, index) => (
              <span key={label} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${index === 1 ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-foreground" : "border-border text-muted-foreground"}`}>{label}</span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-xs"><span className="text-muted-foreground">Stage</span><span className="font-semibold text-foreground">Contacted</span><span className="text-muted-foreground">→</span><span className="font-semibold text-[var(--accent-ink)]">Quoted</span></div>
        </div>
      </Card>
    ),
  },
  {
    key: "issue", icon: Receipt, title: "The policy issues — and pays",
    body: "The policy lands in your book of business, and the commission is traced to the carrier statement line behind it.",
    points: ["Lapse signals raised before a chargeback", "Nothing recorded in the ledger without a source"],
    screen: (
      <Card title="Book of business">
        <div className="p-4">
          <div className="flex items-center justify-between"><span className="text-sm font-semibold text-foreground">Marisol Vega · Final expense</span><span className="rounded-full bg-[var(--success-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--success-ink)]">Issued</span></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            {[["Annual premium", "$1,284"], ["Carrier", "Sample Life"], ["Commission", "$963"]].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border px-2.5 py-2"><div className="text-muted-foreground">{label}</div><div className="mt-0.5 font-semibold tabular-nums text-foreground">{value}</div></div>
            ))}
          </div>
        </div>
      </Card>
    ),
  },
  {
    key: "cost", icon: BadgeCheck, title: "And you finally know what it cost",
    body: "Attribution is set at import and never re-derived in a browser, so every issued policy traces back to a campaign, a spend and a date.",
    points: ["Cost per issued policy, per vendor and campaign", "Return claims carry their evidence, with the credit beside the claim"],
    screen: <Card title="True CPA"><CpaMock /></Card>,
  },
];

export function LandingJourney() {
  const [active, setActive] = useState(0);
  const reduced = usePrefersReducedMotion();
  const stepRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    // The active step is whichever crosses a thin band across the middle of the viewport.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
      }
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
    stepRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="journey" className="scroll-mt-20 border-y border-border bg-[var(--surface-alt)] px-4 py-24 sm:px-6 lg:px-16 lg:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-[720px]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">Follow one lead</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[44px]">From a partner&rsquo;s form to the cost of the policy.</h2>
          <p className="mt-4 max-w-[60ch] text-base leading-[1.6] text-muted-foreground">Seven steps, one record. Scroll to walk a lead through Insurvas.</p>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* The deck — sticky beside the steps on large screens. */}
          <div className="hidden lg:block">
            <div className="sticky top-28" style={{ perspective: 1600 }}>
              <div className="relative h-[420px]" style={{ transformStyle: "preserve-3d" }}>
                {STEPS.map((step, index) => {
                  const offset = index - active;
                  const passed = offset < 0;
                  const depth = Math.min(offset, 3);
                  const transform = reduced
                    ? `translateY(${offset === 0 ? 0 : 12}px)`
                    : passed
                      ? "translate3d(0, -120%, 80px) rotateX(38deg)"
                      : `translate3d(0, ${-depth * 20}px, ${-depth * 60}px) scale(${1 - depth * 0.05})`;
                  return (
                    <div
                      key={step.key}
                      aria-hidden={offset !== 0}
                      className="absolute inset-x-0 top-8 h-[380px]"
                      style={{
                        transform,
                        opacity: passed ? 0 : offset > 3 ? 0 : 1 - depth * 0.28,
                        zIndex: STEPS.length - Math.abs(offset),
                        transition: "transform 800ms cubic-bezier(.16,1,.3,1), opacity 600ms cubic-bezier(.16,1,.3,1)",
                        pointerEvents: offset === 0 ? "auto" : "none",
                      }}
                    >
                      {step.screen}
                    </div>
                  );
                })}
              </div>
              {/* Where we are: seven dots with the current one stretched. */}
              <div className="mt-6 flex items-center gap-1.5" aria-hidden="true">
                {STEPS.map((step, index) => (
                  <span key={step.key} className={`h-1.5 rounded-full transition-all duration-500 ${index === active ? "w-8 bg-[var(--primary)]" : index < active ? "w-3 bg-[color-mix(in_srgb,var(--primary)_45%,transparent)]" : "w-3 bg-[var(--border-strong)]"}`} />
                ))}
              </div>
            </div>
          </div>

          {/* The steps. */}
          <ol className="relative m-0 list-none p-0">
            <span aria-hidden="true" className="absolute bottom-6 left-[19px] top-6 w-px bg-border" />
            <span aria-hidden="true" className="absolute left-[19px] top-6 w-px bg-[var(--primary)] transition-[height] duration-700" style={{ height: `calc((100% - 48px) * ${(active / (STEPS.length - 1)).toFixed(4)})` }} />
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const on = index === active;
              return (
                <li key={step.key}>
                  <div ref={(node) => { stepRefs.current[index] = node; }} data-index={index} className="relative flex gap-5 pb-16 lg:min-h-[62vh] lg:pb-0">
                    <span className={`relative z-10 inline-flex size-10 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-500 ${on ? "scale-110 border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_0_0_6px_color-mix(in_srgb,var(--primary)_18%,transparent)]" : index < active ? "border-[var(--primary)] bg-card text-[var(--primary)]" : "border-[var(--border-strong)] bg-card text-muted-foreground"}`}>
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className={`min-w-0 pt-1 transition-opacity duration-500 ${on ? "lg:opacity-100" : "lg:opacity-40"}`}>
                      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Step {index + 1}</p>
                      <h3 className="mt-1 text-2xl font-semibold leading-[1.2] tracking-[-0.02em] text-foreground">{step.title}</h3>
                      <p className="mt-3 max-w-[52ch] text-base leading-[1.6] text-muted-foreground">{step.body}</p>
                      <ul className="mt-4 space-y-2 p-0">
                        {step.points.map((point) => (
                          <li key={point} className="flex list-none items-start gap-2 text-sm text-foreground"><Check className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />{point}</li>
                        ))}
                      </ul>
                      <div className="mt-6 lg:hidden">{step.screen}</div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
