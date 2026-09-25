"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  // The password fields stay uncontrolled (the form posts FormData, and a failed submit keeps every
  // value); this only mirrors whether the two agree, read from the form as the second one changes.
  const [confirmState, setConfirmState] = useState<"empty" | "match" | "differs">("empty");
  const matchState = (form: HTMLFormElement): "empty" | "match" | "differs" => {
    const data = new FormData(form);
    const confirm = String(data.get("confirmPassword") ?? "");
    return confirm ? (confirm === String(data.get("password") ?? "") ? "match" : "differs") : "empty";
  };

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
    if (form.get("password") !== form.get("confirmPassword")) {
      setError("The two passwords do not match");
      return;
    }
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
    <div className="flex flex-col gap-12 lg:flex-row lg:gap-12">
      <div className="min-w-0 flex-1">
        <h1 className="text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
          Create your workspace
        </h1>
        <p className="mb-7 mt-2.5 max-w-[620px] text-base leading-normal tracking-[-0.02em] text-muted-foreground">
          Your account comes first; you name your agency on the next step and pay only at checkout. If anything goes
          wrong, everything you typed stays on the page.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">
              Full name <span className="text-[var(--error)]">*</span>
            </Label>
            <Input id="fullName" name="fullName" autoComplete="name" minLength={2} maxLength={120} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">
              Work email <span className="text-[var(--error)]">*</span>
            </Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">
              Mobile phone <span className="text-[var(--error)]">*</span>
            </Label>
            <Input id="phone" name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={40} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">
              Password <span className="text-[var(--error)]">*</span>
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              onChange={(event) => setConfirmState(event.currentTarget.form ? matchState(event.currentTarget.form) : "empty")}
            />
            <p className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">At least 12 characters.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">
              Confirm password <span className="text-[var(--error)]">*</span>
            </Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              aria-describedby="confirm-note"
              onChange={(event) => setConfirmState(event.currentTarget.form ? matchState(event.currentTarget.form) : "empty")}
            />
            <p id="confirm-note" className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground" aria-live="polite">
              {confirmState === "match" ? "Matches." : confirmState === "differs" ? "Does not match yet." : " "}
            </p>
          </div>

          {legalDocs.length > 0 && (
            <div className="space-y-2 rounded-lg bg-[var(--surface-alt)] p-4">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
                <input
                  type="checkbox"
                  name="acceptTerms"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  I agree to the{" "}
                  {legalDocs.map((doc, index) => (
                    <span key={doc.id}>
                      {index > 0 && (index === legalDocs.length - 1 ? " and the " : ", ")}
                      <Link
                        href={`/legal/${doc.doc_type}?v=${doc.version}`}
                        target="_blank"
                        className="font-semibold text-foreground"
                      >
                        {doc.title} v{doc.version}
                      </Link>
                    </span>
                  ))}
                  . Acceptance is recorded against the version shown, and each link resolves to that version.
                </span>
              </label>
              {legalDocs.some((doc) => doc.is_draft) && (
                <p className="pl-[26px] text-xs text-[var(--warning-ink)]">
                  These documents are drafts and have not been reviewed by a lawyer.
                </p>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="h-12 w-full"
            disabled={submitting || loadingPlans || !selectedPrice || !accepted}
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
            {submitting ? "Creating workspace…" : "Create workspace and continue"}
          </Button>

          <p className="text-center text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
            No card is taken here. Payment happens on the provider&rsquo;s hosted page after checkout.
          </p>
          <p className="text-center text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
            Already have an account?{" "}
            <Link href="/app/login" className="font-semibold text-foreground">
              Sign in
            </Link>
          </p>
        </form>
      </div>

      <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[340px]">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Order summary</h2>

          {loadingPlans ? (
            <div className="flex h-40 items-center justify-center">
              <LoaderCircle className="animate-spin" />
            </div>
          ) : selectedPlan ? (
            <>
              <dl className="mt-4 grid gap-4">
                {[
                  { term: "Plan", value: selectedPlan.name },
                  { term: "Cycle", value: BILLING_CYCLE_LABELS[cycle] },
                  {
                    term: "Price",
                    value: priceCents == null ? "Cycle unavailable" : formatCentsAsCurrency(priceCents),
                  },
                  { term: "Trial", value: selectedPlan.trial_days > 0 ? `${selectedPlan.trial_days} days` : "No trial" },
                  // Nothing is charged on this page. With a trial, checkout charges nothing either;
                  // without one, checkout charges the first period.
                  {
                    term: "Due at checkout",
                    value: selectedPlan.trial_days > 0 ? formatCentsAsCurrency(0) : priceCents == null ? "—" : formatCentsAsCurrency(priceCents),
                  },
                ].map((row) => (
                  <div key={row.term}>
                    <dt className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
                      {row.term}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold leading-normal tracking-[-0.02em] tabular-nums text-foreground">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 space-y-4 border-t border-border pt-5">
                <div className="space-y-1.5">
                  <Label htmlFor="plan">Plan</Label>
                  <select
                    id="plan"
                    value={planCode}
                    onChange={(event) => selectPlan(event.target.value)}
                    className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-card px-3 text-sm"
                  >
                    {plans.map((plan) => (
                      <option key={plan.code} value={plan.code}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cycle">Billing cycle</Label>
                  <select
                    id="cycle"
                    value={cycle}
                    onChange={(event) => setCycle(event.target.value as BillingCycle)}
                    className="h-10 w-full rounded-md border border-[var(--border-strong)] bg-card px-3 text-sm"
                  >
                    {BILLING_CYCLES.map((item) => (
                      <option key={item} value={item} disabled={!publicPriceForCycle(selectedPlan, item)}>
                        {BILLING_CYCLE_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="mt-4 text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
                {initialPlanCode && selectedPlan.code === initialPlanCode ? "The plan you picked on " : "Compare every plan on "}
                <Link href="/pricing" className="font-semibold text-foreground">the pricing page</Link>
                {initialPlanCode && selectedPlan.code === initialPlanCode ? ". Change it here if you like." : "."}
              </p>
            </>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">No public plan is available.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
