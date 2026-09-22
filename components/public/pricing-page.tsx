"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  CYCLE_MONTHS,
  formatCentsAsCurrency,
  parseDollarsToCents,
  type BillingCycle,
} from "@/lib/money";
import { publicPriceForCycle, type PublicPlan } from "@/lib/publicPlans/types";

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

export function PricingPage() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/plans", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load pricing");
        setPlans(body as PublicPlan[]);
      })
      .catch((reason) => {
        if (reason?.name !== "AbortError") setError(reason?.message ?? "Could not load pricing");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const offeredCycles = useMemo(
    () => BILLING_CYCLES.filter((candidate) => plans.some((plan) => publicPriceForCycle(plan, candidate))),
    [plans],
  );

  return (
    <main>
      <section className="bg-[var(--surface-alt)] px-4 pb-28 pt-20 text-center">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">
          Simple, transparent pricing
        </p>
        <h1 className="mx-auto max-w-3xl text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">
          The operating system for modern insurance teams
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
          Choose the plan that fits today. Your workspace and owner account are created immediately.
        </p>
      </section>

      <section className="mx-auto -mt-14 max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-md border border-border bg-card p-1 text-foreground">
            {(offeredCycles.length ? offeredCycles : BILLING_CYCLES).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCycle(item)}
                className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
                  cycle === item
                    ? "bg-primary text-[var(--on-primary)]"
                    : "text-muted-foreground hover:bg-[var(--brand-50)]"
                }`}
              >
                {BILLING_CYCLE_LABELS[item]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-72 items-center justify-center rounded-lg border border-border bg-card">
            <LoaderCircle className="size-7 animate-spin text-[var(--primary)]" aria-label="Loading plans" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-[var(--error)]/30 bg-card p-10 text-center text-[var(--error)]">
            {error}
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
            No public plans are available right now.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {plans.map((plan) => {
              const rawPrice = publicPriceForCycle(plan, cycle);
              const cents = rawPrice ? parseDollarsToCents(rawPrice) : null;
              const saving = savingPercent(plan, cycle);
              const equivalent = cents == null ? null : Math.round(cents / CYCLE_MONTHS[cycle]);
              return (
                <Card
                  key={plan.code}
                  className={`relative overflow-hidden ${
                    plan.is_default ? "border-[var(--brand-500)] shadow-[0_18px_50px_rgba(0,64,127,0.16)]" : ""
                  }`}
                >
                  {plan.is_default && (
                    <div className="absolute right-0 top-0 rounded-bl-lg bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-[0.02em] text-[var(--on-primary)]">
                      Most popular
                    </div>
                  )}
                  <CardHeader className="pt-8">
                    <CardTitle className="text-2xl font-semibold tracking-[-0.02em]">{plan.name}</CardTitle>
                    <p className="min-h-12 text-sm leading-6 text-muted-foreground">
                      {plan.blurb ?? "Everything you need to run your insurance business."}
                    </p>
                  </CardHeader>
                  <CardContent className="flex-1">
                    {cents == null ? (
                      <div className="mb-7 rounded-lg bg-muted px-4 py-5 text-sm text-muted-foreground">
                        Not available on the {cycle} cycle
                      </div>
                    ) : (
                      <div className="mb-7">
                        <div className="flex items-end gap-2">
                          <span className="text-[32px] font-semibold leading-[1.13] tracking-[-0.025em]">
                            {formatCentsAsCurrency(equivalent!)}
                          </span>
                          <span className="pb-1 text-sm text-muted-foreground">/month</span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {cycle === "monthly"
                            ? "Billed monthly"
                            : `${formatCentsAsCurrency(cents)} billed ${cycle}`}
                          {saving ? (
                            <span className="ml-2 font-semibold text-[var(--color-success)]">Save {saving}%</span>
                          ) : null}
                        </p>
                      </div>
                    )}
                    <ul className="space-y-3">
                      {plan.feature_bullets.map((feature) => (
                        <li key={feature} className="flex gap-3 text-sm">
                          <Check className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]" />
                          <span className="text-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter className="flex-col items-stretch gap-3">
                    <Button asChild={cents != null} size="lg" disabled={cents == null} className="w-full rounded-full">
                      {cents != null ? (
                        <Link href={`/signup?plan=${encodeURIComponent(plan.code)}&cycle=${cycle}`}>
                          Start {plan.trial_days}-day trial
                        </Link>
                      ) : (
                        <span>Cycle unavailable</span>
                      )}
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Card details are collected securely at checkout.
                    </p>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
