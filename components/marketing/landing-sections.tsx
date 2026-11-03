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
