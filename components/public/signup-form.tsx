"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  formatCentsAsCurrency,
  parseDollarsToCents,
  type BillingCycle,
} from "@/lib/money";
import { publicPriceForCycle, type PublicPlan } from "@/lib/publicPlans/types";

type LegalDoc = { id: string; doc_type: string; version: number; title: string; is_draft: boolean };

type Props = { initialPlanCode?: string; initialCycle?: string };

export function SignupForm({ initialPlanCode, initialCycle }: Props) {
  const router = useRouter();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [planCode, setPlanCode] = useState(initialPlanCode ?? "");
  const [cycle, setCycle] = useState<BillingCycle>(
    BILLING_CYCLES.includes(initialCycle as BillingCycle) ? (initialCycle as BillingCycle) : "monthly",
  );
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legalDocs, setLegalDocs] = useState<LegalDoc[]>([]);
  // Unticked, and initialised unticked — never derived from anything that could arrive true.
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    fetch("/api/public/legal", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setLegalDocs(body?.documents ?? []))
      .catch(() => setLegalDocs([]));
  }, []);

  useEffect(() => {
    fetch("/api/public/plans", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load plans");
        const loaded = body as PublicPlan[];
        setPlans(loaded);
        const requested = loaded.find((plan) => plan.code === initialPlanCode);
        const selected = requested ?? loaded.find((plan) => plan.is_default) ?? loaded[0];
        if (selected) {
          setPlanCode(selected.code);
          if (!publicPriceForCycle(selected, cycle)) {
            const firstCycle = BILLING_CYCLES.find((candidate) => publicPriceForCycle(selected, candidate));
            if (firstCycle) setCycle(firstCycle);
          }
        }
      })
      .catch((reason) => setError(reason?.message ?? "Could not load plans"))
      .finally(() => setLoadingPlans(false));
    // The query-string choice is intentionally captured once; form selections own state after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.code === planCode), [plans, planCode]);
  const selectedPrice = selectedPlan ? publicPriceForCycle(selectedPlan, cycle) : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!selectedPlan || !selectedPrice) {
      setError("Choose an available plan and billing cycle");
      return;
    }
    if (!accepted) {
      setError("You must accept the terms and privacy policy to continue");
      return;
    }

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    const response = await fetch("/api/public/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.get("fullName"),
        email: form.get("email"),
        password: form.get("password"),
        phone: form.get("phone"),
        planCode: selectedPlan.code,
        billingCycle: cycle,
        // The exact versions shown next to the box that was ticked.
        acceptedDocumentIds: accepted ? legalDocs.map((doc) => doc.id) : [],
      }),
    });
    const body = await response.json().catch(() => null);
    setSubmitting(false);
    if (!response.ok) {
      setError(body?.error ?? "Could not create your account");
      return;
    }
    router.push(body?.redirectTo ?? "/app/verify-email");
    router.refresh();
  }

  function selectPlan(code: string) {
    const plan = plans.find((candidate) => candidate.code === code);
    if (!plan) return;
    setPlanCode(code);
    if (!publicPriceForCycle(plan, cycle)) {
      const firstCycle = BILLING_CYCLES.find((candidate) => publicPriceForCycle(plan, candidate));
      if (firstCycle) setCycle(firstCycle);
    }
  }

  const priceCents = selectedPrice ? parseDollarsToCents(selectedPrice) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <Card className="bg-white shadow-[0_18px_50px_rgba(0,64,127,0.10)]">
        <CardHeader>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--brand-600)]">Create account</p>
          <CardTitle className="text-3xl font-extrabold tracking-tight">Start your Insurvas workspace</CardTitle>
          <p className="text-sm text-[var(--color-text-muted)]">Four details now. Business setup comes after email verification.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" name="fullName" autoComplete="name" minLength={2} maxLength={120} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
                <p className="text-xs text-[var(--color-text-muted)]">At least 12 characters</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Mobile phone</Label>
                <Input id="phone" name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={40} required />
              </div>
            </div>

            {legalDocs.length > 0 && (
              <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-page-bg)] p-4">
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="acceptTerms"
                    checked={accepted}
                    onChange={(event) => setAccepted(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--brand-600)]"
                  />
                  <span>
                    I have read and agree to the{" "}
                    {legalDocs.map((doc, index) => (
                      <span key={doc.id}>
                        {index > 0 && (index === legalDocs.length - 1 ? " and " : ", ")}
                        <Link
                          href={`/legal/${doc.doc_type}?v=${doc.version}`}
                          target="_blank"
                          className="font-bold text-[var(--brand-600)] underline"
                        >
                          {doc.title}
                        </Link>{" "}
                        <span className="text-[var(--color-text-muted)]">(v{doc.version})</span>
                      </span>
                    ))}
                    .
                  </span>
                </label>
                {legalDocs.some((doc) => doc.is_draft) && (
                  <p className="pl-7 text-xs text-[var(--color-warning)]">
                    These documents are drafts and have not been reviewed by a lawyer.
                  </p>
                )}
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)]">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={submitting || loadingPlans || !selectedPrice || !accepted}>
              {submitting ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
              {submitting ? "Creating account…" : "Create account"}
            </Button>
            <p className="text-center text-xs text-[var(--color-text-muted)]">
              Already have an account? <Link href="/app/login" className="font-bold text-[var(--brand-600)]">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>

      <aside className="space-y-4 lg:sticky lg:top-6">
        <Card className="overflow-hidden bg-white">
          <div className="bg-[var(--brand-700)] px-6 py-4 text-sm font-extrabold uppercase tracking-wide text-white">
            Selected plan
          </div>
          <CardContent className="pt-1">
            {loadingPlans ? (
              <div className="flex h-40 items-center justify-center"><LoaderCircle className="animate-spin" /></div>
            ) : selectedPlan ? (
              <div className="space-y-5">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xl font-extrabold">{selectedPlan.name}</h2>
                    <Link href="/pricing" className="text-sm font-bold text-[var(--brand-600)] hover:underline">Change</Link>
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {priceCents == null ? "Cycle unavailable" : `${formatCentsAsCurrency(priceCents)} / ${cycle}`}
                  </p>
                  <p className="mt-2 text-sm font-bold text-[var(--color-success)]">
                    {selectedPlan.trial_days}-day trial
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="plan">Plan</Label>
                  <select
                    id="plan"
                    value={planCode}
                    onChange={(event) => selectPlan(event.target.value)}
                    className="h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"
                  >
                    {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cycle">Billing cycle</Label>
                  <select
                    id="cycle"
                    value={cycle}
                    onChange={(event) => setCycle(event.target.value as BillingCycle)}
                    className="h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"
                  >
                    {BILLING_CYCLES.map((item) => (
                      <option key={item} value={item} disabled={!publicPriceForCycle(selectedPlan, item)}>
                        {BILLING_CYCLE_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <p className="py-8 text-sm text-[var(--color-text-muted)]">No public plan is available.</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3 rounded-xl border bg-[var(--brand-50)] p-5 text-sm">
          {["No sales call required", "Email verification protects your account", "Card collected securely at checkout"].map((item) => (
            <div key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]" />{item}</div>
          ))}
        </div>
      </aside>
    </div>
  );
}
