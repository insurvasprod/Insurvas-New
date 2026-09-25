"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Reveal, Tilt3D } from "@/components/marketing/motion";
import styles from "@/components/marketing/landing.module.css";
import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  CYCLE_MONTHS,
  formatCentsAsCurrency,
  parseDollarsToCents,
  type BillingCycle,
} from "@/lib/money";
import { publicPriceForCycle, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * The public pricing page (board p-pub-pricing).
 *
 * Everything priced or compared here comes from the catalog, which the page promises in so many
 * words. It used to keep a hard-coded comparison table for "Starter / Growth / Scale" and three
 * literal add-ons, while the live catalog sells differently named plans — so the table compared
 * plans nobody could buy. Now:
 *  - plans and add-ons are read on the server and passed in (no client fetch, no loading flash);
 *  - the comparison table is built from each plan's real feature grants;
 *  - the yearly badge, the yearly answer and the closing line are computed, not written.
 */
export type PricingAddon = { code: string; name: string; description: string | null; price_cents: number; billing_cycle: BillingCycle };

function savingPercent(plan: PublicPlan, cycle: BillingCycle): number | null {
  if (cycle === "monthly" || !plan.price_monthly) return null;
  const monthly = parseDollarsToCents(plan.price_monthly);
  const selected = publicPriceForCycle(plan, cycle);
  const selectedCents = selected ? parseDollarsToCents(selected) : null;
  if (monthly == null || selectedCents == null || monthly <= 0) return null;
  const fullPrice = monthly * CYCLE_MONTHS[cycle];
  if (selectedCents >= fullPrice) return null;
  return Math.round(((fullPrice - selectedCents) / fullPrice) * 100);
}

/** The best saving any plan offers on a cycle, or null when none does. */
function bestSaving(plans: PublicPlan[], cycle: BillingCycle): number | null {
  const savings = plans.map((plan) => savingPercent(plan, cycle)).filter((value): value is number => value !== null);
  return savings.length ? Math.max(...savings) : null;
}

/** "2 months free" when a yearly saving is exactly two of twelve months, otherwise "save N%". */
function savingLabel(percent: number, cycle: BillingCycle): string {
  const months = (percent / 100) * CYCLE_MONTHS[cycle];
  const whole = Math.round(months);
  if (cycle === "yearly" && whole >= 1 && Math.abs(months - whole) < 0.15) return `${whole} month${whole === 1 ? "" : "s"} free`;
  return `save up to ${percent}%`;
}

const ADDON_CYCLE: Record<BillingCycle, string> = { monthly: "/ month", quarterly: "/ quarter", yearly: "/ year" };

function CompareCell({ included }: { included: boolean }) {
  return (
    <span className="w-[150px] shrink-0 text-center">
      {included ? (
        <Check className="mx-auto size-[13px] stroke-[3] text-[var(--success)]" aria-label="Included" />
      ) : (
        <span className="text-sm text-muted-foreground" aria-label="Not included">—</span>
      )}
    </span>
  );
}

export function PricingPage({ plans, addons, loadError }: { plans: PublicPlan[]; addons: PricingAddon[]; loadError: string | null }) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const offeredCycles = useMemo(
    () => BILLING_CYCLES.filter((candidate) => plans.some((plan) => publicPriceForCycle(plan, candidate))),
    [plans],
  );
  const yearlySaving = bestSaving(plans, "yearly");
  const defaultPlan = plans.find((plan) => plan.is_default) ?? null;
  // "Move down" only makes sense when there is something cheaper than the plan we lead with.
  const monthlyCents = (plan: PublicPlan) => (plan.price_monthly ? parseDollarsToCents(plan.price_monthly) : null) ?? Number.POSITIVE_INFINITY;
  const defaultIsCheapest = defaultPlan ? plans.every((plan) => monthlyCents(defaultPlan) <= monthlyCents(plan)) : false;
  const defaultIsDearest = defaultPlan ? plans.every((plan) => monthlyCents(defaultPlan) >= monthlyCents(plan)) : false;
  const closingLine = !defaultPlan
    ? "Start your trial. Keep your data either way."
    : plans.length < 2
      ? `Start on ${defaultPlan.name}. Keep your data either way.`
      : defaultIsCheapest
        ? `Start on ${defaultPlan.name}. Move up when you outgrow it.`
        : defaultIsDearest
          ? `Start on ${defaultPlan.name}. Move down if you do not need it all.`
          : `Start on ${defaultPlan.name}. Move up or down as you grow.`;

  // Rows are every feature any public plan grants, in the order the cheapest plan lists them and
  // then the rest; a plan's column ticks the features it actually grants.
  const compareRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const plan of plans) for (const label of plan.feature_bullets) if (!seen.has(label)) { seen.add(label); rows.push(label); }
    return rows;
  }, [plans]);

  const faqs = [
    { q: "What happens when the trial ends?", a: "Nothing is charged until you finish checkout. If you do not, the workspace stays readable and writing is disabled — your book of business is never held hostage." },
    { q: "Is there a per-lead charge?", a: "No. Seats and monthly imports are the limits, and both are printed on every plan." },
    { q: "Can I change plan mid-cycle?", a: "Yes. You choose whether it applies now with proration or at renewal, and the confirmation names the effective date before anything moves." },
    { q: "What happens to existing subscribers when you change a plan?", a: "They keep the version they bought. Plans are versioned, so publishing a new version leaves every current subscriber on theirs until they renew." },
    yearlySaving
      ? { q: "Do you offer a discount for yearly billing?", a: `Yes — ${savingLabel(yearlySaving, "yearly")} on yearly billing. Switch the toggle above and the prices update.` }
      : { q: "Do you offer a discount for yearly billing?", a: "Not at the moment: every plan is billed at the same monthly rate whichever cycle you choose." },
  ];

  return (
    <main>
      <section className="relative isolate overflow-hidden px-4 pt-20 text-center sm:px-6 lg:px-16">
        <div aria-hidden="true" className={`${styles.aurora} left-1/2 -top-[520px] -translate-x-1/2 opacity-50`} />
        <Reveal>
          <h1 className="mx-auto max-w-[780px] text-[40px] font-semibold leading-[1.02] tracking-[-0.035em] text-foreground sm:text-[56px]">
            Priced per workspace, not per lead.
          </h1>
          <p className="mx-auto mt-5 max-w-[620px] text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            You already pay your vendors by the lead. We are not going to charge you again for the same one.
          </p>
        </Reveal>

        {offeredCycles.length > 1 && (
          <div className="mt-8">
            <span role="group" aria-label="Billing cycle" className="inline-flex gap-1 rounded-full bg-[var(--surface-alt)] p-[5px]">
              {offeredCycles.map((item) => {
                const saving = bestSaving(plans, item);
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={cycle === item}
                    onClick={() => setCycle(item)}
                    className={`inline-flex h-11 items-center gap-2 rounded-full border px-5 text-sm font-semibold tracking-[-0.01em] ${
                      cycle === item ? "border-border bg-[var(--surface)] text-foreground" : "border-transparent bg-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {BILLING_CYCLE_LABELS[item]}
                    {saving ? <span className="rounded-full bg-[var(--brand-50)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-ink)]">{savingLabel(saving, item)}</span> : null}
                  </button>
                );
              })}
            </span>
          </div>
        )}
      </section>

      <section className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-16">
        {loadError ? (
          <div className="rounded-xl border border-[var(--error)]/30 bg-card p-10 text-center text-[var(--error-ink)]">{loadError}</div>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">No public plans are available right now.</div>
        ) : (
          <div className={`grid gap-6 ${plans.length >= 3 ? "lg:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2 lg:mx-auto lg:max-w-[880px]" : "mx-auto max-w-[440px]"}`}>
            {plans.map((plan, index) => {
              const rawPrice = publicPriceForCycle(plan, cycle);
              const cents = rawPrice ? parseDollarsToCents(rawPrice) : null;
              const saving = savingPercent(plan, cycle);
              const equivalent = cents == null ? null : Math.round(cents / CYCLE_MONTHS[cycle]);
              return (
                <Reveal key={plan.code} variant="tilt" delay={index * 110} className="h-full">
                  <Tilt3D max={6} glare className="h-full">
                    <div
                      className={`relative flex h-full flex-col rounded-2xl bg-card p-8 ${
                        plan.is_default ? "border-[1.5px] border-[var(--primary)] shadow-[0_24px_70px_-24px_var(--primary)]" : "border border-border"
                      }`}
                    >
                      {plan.is_default && (
                        <div className="absolute -top-[13px] left-8 rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-semibold text-[var(--on-primary)]" style={{ transform: "translateZ(30px)" }}>
                          Most agencies start here
                        </div>
                      )}

                      <div className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">{plan.name}</div>
                      <p className="mt-2 min-h-[42px] text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
                        {plan.blurb ?? "Everything you need to run your insurance business."}
                      </p>

                      {cents == null ? (
                        <div className="mt-5 rounded-lg bg-muted px-4 py-5 text-sm text-muted-foreground">Not available on the {cycle} cycle</div>
                      ) : (
                        <>
                          <div className="mt-5 flex items-baseline gap-2" style={{ transform: "translateZ(24px)" }}>
                            <span className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] tabular-nums text-foreground">{formatCentsAsCurrency(equivalent!)}</span>
                            <span className="text-sm leading-normal tracking-[-0.02em] text-muted-foreground">/month</span>
                          </div>
                          <div className="mt-1.5 min-h-[18px] text-xs leading-normal tracking-[-0.01em] text-[var(--accent-ink)]">
                            {cycle === "monthly" ? "Billed monthly" : `${formatCentsAsCurrency(cents)} billed ${cycle}`}
                            {saving ? ` · save ${saving}%` : ""}
                          </div>
                        </>
                      )}

                      <div className="mt-5 flex-1 border-t border-border pt-5">
                        {plan.feature_bullets.map((feature) => (
                          <div key={feature} className="flex gap-2.5 py-[7px]">
                            <Check className="mt-0.5 size-[13px] shrink-0 stroke-[3] text-[var(--success)]" aria-hidden="true" />
                            <span className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{feature}</span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-6">
                        {cents != null ? (
                          <Button asChild variant={plan.is_default ? "default" : "secondary"} className={`h-12 w-full rounded-full ${plan.is_default ? "" : "border-[var(--border-strong)]"}`}>
                            <Link href={`/signup?plan=${encodeURIComponent(plan.code)}&cycle=${cycle}`}>
                              {plan.trial_days > 0 ? `Start ${plan.trial_days}-day trial` : "Get started"}
                            </Link>
                          </Button>
                        ) : (
                          <Button disabled variant="secondary" className="h-12 w-full rounded-full border-[var(--border-strong)]">Cycle unavailable</Button>
                        )}
                      </div>
                    </div>
                  </Tilt3D>
                </Reveal>
              );
            })}
          </div>
        )}

        <p className="mt-6 text-center text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
          Every plan includes a trial, no card, and every price on this page is read from the catalog — nothing here is a literal.
        </p>
      </section>

      {plans.length > 1 && compareRows.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-[72px] sm:px-6 lg:px-16">
          <Reveal>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="flex items-end gap-4 border-b border-border px-6 py-5">
                    <span className="flex-1 text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Compare every plan</span>
                    {plans.map((plan) => (
                      <span key={plan.code} className={`w-[150px] shrink-0 text-center text-sm font-semibold tracking-[-0.01em] ${plan.is_default ? "text-[var(--accent-ink)]" : "text-foreground"}`}>{plan.name}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 border-b border-border bg-[var(--surface-alt)] px-6 py-3">
                    <span className="flex-1 text-sm font-semibold leading-normal text-foreground">Price per month, billed {cycle}</span>
                    {plans.map((plan) => {
                      const raw = publicPriceForCycle(plan, cycle);
                      const cents = raw ? parseDollarsToCents(raw) : null;
                      return <span key={plan.code} className="w-[150px] shrink-0 text-center text-sm font-semibold tabular-nums text-foreground">{cents == null ? "—" : formatCentsAsCurrency(Math.round(cents / CYCLE_MONTHS[cycle]))}</span>;
                    })}
                  </div>
                  <div className="flex items-center gap-4 border-b border-border px-6 py-3">
                    <span className="flex-1 text-sm leading-normal text-[var(--body)]">Free trial</span>
                    {plans.map((plan) => <span key={plan.code} className="w-[150px] shrink-0 text-center text-sm font-semibold tabular-nums text-foreground">{plan.trial_days ? `${plan.trial_days} days` : "—"}</span>)}
                  </div>
                  {compareRows.map((label) => (
                    <div key={label} className="flex items-center gap-4 border-t border-border px-6 py-3 first:border-t-0">
                      <span className="flex-1 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{label}</span>
                      {plans.map((plan) => <CompareCell key={plan.code} included={plan.feature_bullets.includes(label)} />)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      )}

      {addons.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pt-[72px] sm:px-6 lg:px-16">
          <Reveal className="max-w-[680px]">
            <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--accent-ink)]">Add-ons</div>
            <h2 className="mt-3 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[40px]">Buy the bit you actually ran out of</h2>
            <p className="mt-3.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
              An add-on grants features and credits through exactly the same entitlement path as a plan, so an operator can always see both sources.
            </p>
          </Reveal>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {addons.map((addon, index) => (
              <Reveal key={addon.code} variant="rise" delay={index * 90}>
                <div className="m-card h-full rounded-2xl border border-border bg-card p-6">
                  <div className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">{addon.name}</div>
                  <div className="mt-2 min-h-10 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">{addon.description ?? "Adds to any plan that offers it."}</div>
                  <div className="mt-3 text-lg font-semibold leading-[1.28] tracking-[-0.015em] tabular-nums text-foreground">
                    {formatCentsAsCurrency(addon.price_cents)} <span className="text-sm font-normal text-muted-foreground">{ADDON_CYCLE[addon.billing_cycle]}</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 pt-[72px] sm:px-6 lg:px-16">
        <div className="mx-auto max-w-[680px] text-center">
          <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--accent-ink)]">Questions</div>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[40px]">Before you enter a card</h2>
        </div>

        <div className="mx-auto mt-8 max-w-[900px]">
          {faqs.map((item, index) => {
            const open = openFaq === index;
            return (
              <div key={item.q}>
                <button type="button" aria-expanded={open} onClick={() => setOpenFaq(open ? null : index)} className="flex w-full items-center gap-3.5 border-t border-border py-[22px] text-left">
                  <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform duration-150 ${open ? "text-[var(--accent-ink)]" : "-rotate-90 text-muted-foreground"}`} />
                  <span className="flex-1 text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">{item.q}</span>
                </button>
                {open && <p className="m-in mb-[22px] ml-[30px] max-w-[820px] text-base leading-normal tracking-[-0.02em] text-muted-foreground">{item.a}</p>}
              </div>
            );
          })}
          <div className="border-t border-border" />
        </div>
      </section>

      <section className="relative isolate mt-[72px] overflow-hidden bg-[var(--brand-50)] px-4 py-[72px] text-center sm:px-6 lg:px-16">
        <Reveal>
          <h2 className="text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[40px]">
            {closingLine}
          </h2>
          <div className="mt-7 flex justify-center gap-3.5">
            <Button asChild className="h-13 rounded-full px-7 text-base">
              <Link href={defaultPlan ? `/signup?plan=${encodeURIComponent(defaultPlan.code)}&cycle=${cycle}` : "/signup"}>Start your trial</Link>
            </Button>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
