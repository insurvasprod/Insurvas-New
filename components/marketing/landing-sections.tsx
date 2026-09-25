import Link from "next/link";
import { ArrowRight, Ban, Check, ChevronDown, Eye, FileCheck2, Lock, PhoneIncoming, PhoneOutgoing, ScrollText, ShieldCheck, Sigma, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CountUp, Reveal, Tilt3D } from "@/components/marketing/motion";
import { LandingConverge } from "@/components/marketing/landing-converge";
import styles from "@/components/marketing/landing.module.css";
import type { PublicPlan } from "@/lib/publicPlans/types";

/**
 * The landing page's static sections: truths, problem, three jobs, compliance, pricing teaser,
 * questions and the closing call to action. Server-rendered; the motion is layered on by the client
 * helpers (Reveal, Tilt3D, CountUp, LandingConverge).
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
  { icon: Lock, text: "Card details never reach our servers" },
  { icon: FileCheck2, text: "Consent and disclosure evidence kept per attempt" },
  { icon: ScrollText, text: "Nothing in the product is destructively deleted" },
];

export function LandingTruths() {
  const row = [...TRUTHS, ...TRUTHS];
  return (
    <section aria-label="What Insurvas guarantees" className="overflow-hidden border-b border-border bg-card py-5">
      <div className={styles.marquee}>
        {row.map((truth, index) => {
          const Icon = truth.icon;
          return (
            <span key={index} aria-hidden={index >= TRUTHS.length} className="mx-6 inline-flex items-center gap-2.5 whitespace-nowrap text-sm font-semibold text-foreground">
              <Icon className="size-4 text-[var(--primary)]" aria-hidden="true" />
              {truth.text}
            </span>
          );
        })}
      </div>
    </section>
  );
}

/* ── The problem ─────────────────────────────────────────────────────────────────────────────── */
export function LandingProblem() {
  return (
    <section className="bg-background px-4 py-24 sm:px-6 lg:px-16 lg:py-32">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-2">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">The problem</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[44px]">Four tools, and none of them can tell you what a policy cost.</h2>
          <p className="mt-5 max-w-[56ch] text-base leading-[1.6] text-muted-foreground">
            A dialer here, a CRM there, a spreadsheet for vendor spend, and a partner emailing transfers. By the time a policy
            issues, nothing connects it to the list it came from.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { title: "Computed", body: "Cost per issued policy from linked spend — not estimated." },
              { title: "Honest", body: "A campaign with no issued policy shows —, not a free lead." },
              { title: "0 invented", body: "We never hear the call, so we never claim talk-time." },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-card p-4">
                <div className="text-base font-semibold text-foreground">{item.title}</div>
                <p className="mt-1 text-sm leading-normal text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </Reveal>
        <LandingConverge />
      </div>
    </section>
  );
}

/* ── Three jobs ──────────────────────────────────────────────────────────────────────────────── */
const JOBS = [
  { n: "01", icon: PhoneIncoming, title: "Inbound, without the race", lead: "A transfer lands, one closer claims it, and the server decides who won.", points: ["Claimed is separated from on a call, so a held lead never looks worked", "Screening travels with the row — clear, needs review, duplicate", "A lead that saved but never reached the queue is shown, not swallowed"] },
  { n: "02", icon: PhoneOutgoing, title: "Outbound that can prove itself", lead: "Scored order, compliant dialing, and an honest answer about whether the score helps.", points: ["The server re-checks DNC in the moment before the dial", "Queue scoring publishes its weights, its holdout and its interval", "Slot rotation and retry windows, drawn rather than described"] },
  { n: "03", icon: Wallet, title: "The number nobody can answer", lead: "Cost per issued policy, computed from your own linked data.", points: ["Attribution is set at import and never re-derived in a browser", "Effective cost per dialable lead, after suppression", "Return claims carry their evidence, with the credit beside the claim"] },
];

export function LandingJobs() {
  return (
    <section className="bg-background px-4 pb-24 sm:px-6 lg:px-16 lg:pb-32">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-[720px]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">What it does</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[44px]">Three jobs, done properly</h2>
          <p className="mt-4 text-base leading-[1.6] text-muted-foreground">Not a suite. Three surfaces that share one queue, one claim and one record.</p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {JOBS.map((job, index) => {
            const Icon = job.icon;
            return (
              <Reveal key={job.n} variant="tilt" delay={index * 120}>
                <Tilt3D max={8} glare className="h-full">
                  <article className="relative h-full overflow-hidden rounded-2xl border border-border bg-card p-7">
                    <span aria-hidden="true" className="absolute -right-4 -top-6 text-[120px] font-semibold leading-none tracking-[-0.06em] text-[color-mix(in_srgb,var(--primary)_9%,transparent)]">{job.n}</span>
                    <span className="relative inline-flex size-11 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--accent-ink)]" style={{ transform: "translateZ(40px)" }}>
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="relative mt-5 text-xl font-semibold leading-[1.25] tracking-[-0.02em] text-foreground">{job.title}</h3>
                    <p className="relative mt-2 text-sm leading-[1.6] text-muted-foreground">{job.lead}</p>
                    <ul className="relative mt-5 space-y-2.5 border-t border-border p-0 pt-5">
                      {job.points.map((point) => (
                        <li key={point} className="flex list-none items-start gap-2 text-sm leading-normal text-foreground"><Check className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />{point}</li>
                      ))}
                    </ul>
                  </article>
                </Tilt3D>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Compliance ──────────────────────────────────────────────────────────────────────────────── */
const CHECKS = [
  { title: "Consent on file", body: "The evidence behind the lead, kept with it." },
  { title: "DNC registry", body: "Looked up fresh, in the moment of the dial." },
  { title: "Your suppression list", body: "Anyone who asked you to stop, stays stopped." },
  { title: "Calling window", body: "The customer’s local time, not the agent’s." },
];

export function LandingCompliance() {
  return (
    <section id="compliance" className="relative isolate scroll-mt-20 overflow-hidden bg-[var(--footer-bg)] px-4 py-24 text-[var(--nav-ink)] sm:px-6 lg:px-16 lg:py-32">
      <div aria-hidden="true" className={`${styles.aurora} -right-80 -top-60 opacity-50`} />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color-mix(in_srgb,var(--primary)_70%,white)]">Compliance</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">The browser can&rsquo;t talk its way past a refusal.</h2>
          <p className="mt-5 max-w-[54ch] text-base leading-[1.6] text-[var(--nav-muted)]">
            The dialer panel shows you the state. Then the server re-checks all four, in the instant before the call is placed.
            If any one fails, the dial is refused — and the refusal is logged with the reason.
          </p>
          <div className="mt-8 flex flex-wrap gap-8">
            <div><div className="text-4xl font-semibold tracking-[-0.03em]"><CountUp value={4} /></div><div className="mt-1 text-sm text-[var(--nav-muted)]">checks before every dial</div></div>
            <div><div className="text-4xl font-semibold tracking-[-0.03em]"><CountUp value={0} /></div><div className="mt-1 text-sm text-[var(--nav-muted)]">dials the browser can force</div></div>
            <div><div className="text-4xl font-semibold tracking-[-0.03em]"><CountUp value={1} /></div><div className="mt-1 text-sm text-[var(--nav-muted)]">record per attempt, kept</div></div>
          </div>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2" style={{ perspective: 1400 }}>
          {CHECKS.map((check, index) => (
            <Reveal key={check.title} variant="tilt" delay={index * 110}>
              <div className={`rounded-2xl border border-[var(--nav-line)] bg-[color-mix(in_srgb,white_4%,transparent)] p-6 backdrop-blur ${styles.scan}`}>
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--success)] text-white"><Check className="size-4" strokeWidth={3} aria-hidden="true" /></span>
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
function lowestMonthly(plans: PublicPlan[]): string | null {
  const prices = plans.map((plan) => plan.price_monthly).filter((price): price is string => Boolean(price)).map((price) => ({ price, n: Number(price.replace(/[^0-9.]/g, "")) })).filter((item) => Number.isFinite(item.n) && item.n > 0);
  if (!prices.length) return null;
  return prices.sort((a, b) => a.n - b.n)[0].price;
}

export function LandingPricingTeaser({ plans }: { plans: PublicPlan[] }) {
  const from = lowestMonthly(plans);
  const trialDays = plans.find((plan) => plan.trial_days > 0)?.trial_days ?? 14;
  return (
    <section className="bg-background px-4 py-24 sm:px-6 lg:px-16">
      <Reveal variant="zoom" className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 sm:p-12">
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--primary)_22%,transparent),transparent)]" />
          <div className="relative grid items-center gap-8 md:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">Pricing</p>
              <h2 className="mt-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-foreground sm:text-[36px]">Priced per workspace, not per lead.</h2>
              <p className="mt-3 max-w-[50ch] text-base leading-[1.6] text-muted-foreground">You already pay your vendors by the lead. We are not going to charge you again for the same one — seats and import limits are printed on every plan.</p>
            </div>
            <div className="rounded-2xl border border-border bg-[var(--surface-alt)] p-6">
              {from ? (
                <>
                  <div className="text-sm text-muted-foreground">Plans from</div>
                  <div className="mt-1 text-4xl font-semibold tabular-nums tracking-[-0.03em] text-foreground">{from}<span className="text-base font-normal text-muted-foreground"> / month</span></div>
                </>
              ) : (
                <div className="text-base font-semibold text-foreground">Every plan, side by side</div>
              )}
              <p className="mt-2 text-sm text-muted-foreground">{plans.length ? `${plans.length} plan${plans.length === 1 ? "" : "s"} · ` : ""}{trialDays}-day trial · no card</p>
              <Button asChild className="mt-5 h-11 w-full rounded-full"><Link href="/pricing">Compare plans<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ── Questions ───────────────────────────────────────────────────────────────────────────────── */
const FAQS = [
  { q: "Do you store card details?", a: "No. Payment happens on the provider’s hosted page. A card number never reaches an Insurvas server, and the checkout screen says so directly under the button." },
  { q: "Is screening really run before every dial?", a: "Yes, and on the server. The panel shows you the state, then the API re-checks consent, DNC, tenant suppression and the calling window in the moment before the call is placed. If any of them fails, the dial is refused — the browser cannot talk its way past it." },
  { q: "What happens to my data?", a: "It stays in your workspace. Leads and policies export from the app, and nothing in this product is destructively deleted — offboarding a partner never deletes their history either; records and users stay visible for audit and reporting." },
  { q: "Can partners see each other’s leads?", a: "Never. A partner signs into their own view: leads their organisation submitted, the stages those leads reached, and their channel with you. No other partner’s anything, no agent-internal notes, and no lead cost." },
  { q: "Do you charge per lead?", a: "No. You already pay your vendors by the lead; we are not going to charge you again for the same one. Pricing is per workspace, with seat and import limits stated on every plan." },
];

export function LandingFaq() {
  return (
    <section className="bg-background px-4 pb-24 sm:px-6 lg:px-16 lg:pb-32">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)]">Questions</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[44px]">The ones people actually ask</h2>
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
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        <div className={styles.orb} />
      </div>
      <Reveal className="relative mx-auto max-w-[760px]">
        <h2 className="text-[36px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[52px]">Fourteen days. No card.<br />Your own data.</h2>
        <p className="mx-auto mt-5 max-w-[52ch] text-base leading-[1.6] text-[var(--nav-muted)]">Import one vendor list and run a day on the floor. If it does not tell you something you did not know, close the tab.</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button asChild className="h-12 rounded-full px-8 text-base shadow-[0_10px_40px_-8px_var(--primary)]"><Link href="/signup">Start your trial<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
          <Link href="/pricing" className="inline-flex h-12 items-center rounded-full border border-[var(--nav-line)] px-7 text-base font-semibold text-[var(--nav-ink)] no-underline transition-colors hover:border-[var(--nav-muted)] hover:bg-white/5">See pricing</Link>
        </div>
      </Reveal>
    </section>
  );
}
