"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicPlanOption } from "@/lib/plans/public";

type BillingCycle = "monthly" | "quarterly" | "yearly";

const cycleLabels: Record<BillingCycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function availableCycles(plan: PublicPlanOption): BillingCycle[] {
  return (["monthly", "quarterly", "yearly"] as BillingCycle[]).filter(
    (cycle) => plan.prices[cycle] !== null,
  );
}

export function TenantSignupForm({ plans }: { plans: PublicPlanOption[] }) {
  const router = useRouter();
  const firstPlan = plans[0];
  const firstCycles = firstPlan ? availableCycles(firstPlan) : [];
  const [workspaceName, setWorkspaceName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [planId, setPlanId] = useState(firstPlan?.id ?? "");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(firstCycles[0] ?? "monthly");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedPlan = plans.find((plan) => plan.id === planId) ?? null;
  const selectedCycles = selectedPlan ? availableCycles(selectedPlan) : [];

  function choosePlan(nextPlanId: string) {
    const nextPlan = plans.find((plan) => plan.id === nextPlanId);
    setPlanId(nextPlanId);
    const cycles = nextPlan ? availableCycles(nextPlan) : [];
    if (!cycles.includes(billingCycle)) setBillingCycle(cycles[0] ?? "monthly");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError("Use a password with at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!selectedPlan || !selectedCycles.includes(billingCycle)) {
      setError("Choose an available plan and billing cycle.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/app/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceName,
        fullName,
        email,
        password,
        planId,
        billingCycle,
      }),
    });

    const body = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) {
      setError(body?.error ?? "We could not create your workspace. Check the form and try again.");
      return;
    }

    router.push("/app/dashboard");
    router.refresh();
  }

  if (!plans.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No subscriptions are available yet</CardTitle>
          <CardDescription>
            A super admin must publish a plan with at least one billing cycle before tenants can sign up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => router.push("/app/login")}>
            Back to tenant sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workspace details</CardTitle>
          <CardDescription>Create the workspace and owner account used to access Insurvas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="workspaceName">Workspace name</Label>
            <Input id="workspaceName" required maxLength={160} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Your full name</Label>
            <Input id="fullName" required maxLength={120} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input id="confirmPassword" type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Choose a subscription</CardTitle>
          <CardDescription>Your selection is saved with the new tenant in Supabase. This local flow does not charge a card.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3">
            {plans.map((plan) => {
              const cycles = availableCycles(plan);
              const checked = plan.id === planId;
              return (
                <label key={plan.id} className={`cursor-pointer rounded-lg border p-4 transition-colors ${checked ? "border-[var(--color-blue)] bg-[var(--color-blue-faint)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"}`}>
                  <input type="radio" name="plan" className="sr-only" checked={checked} onChange={() => choosePlan(plan.id)} />
                  <span className="flex items-start justify-between gap-4">
                    <span>
                      <span className="block font-semibold">{plan.name}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">{plan.description || `${plan.planType.replaceAll("_", " ")} workspace`}</span>
                      <span className="mt-2 block text-sm font-medium">
                        {cycles.map((cycle) => `${cycleLabels[cycle]} ${money(plan.prices[cycle] ?? 0, plan.prices.currency)}`).join(" · ")}
                      </span>
                      {plan.prices.trialDays > 0 && <span className="mt-1 block text-xs text-muted-foreground">Includes a {plan.prices.trialDays}-day trial</span>}
                    </span>
                    {checked && <Check aria-label="Selected" className="size-5 shrink-0 text-[var(--color-blue)]" />}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="billingCycle">Billing cycle</Label>
            <select id="billingCycle" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" value={billingCycle} onChange={(event) => setBillingCycle(event.target.value as BillingCycle)}>
              {selectedCycles.map((cycle) => <option key={cycle} value={cycle}>{cycleLabels[cycle]} — {money(selectedPlan?.prices[cycle] ?? 0, selectedPlan?.prices.currency ?? "USD")}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" /> Secure account creation</span>
            <span className="inline-flex items-center gap-1.5"><CreditCard className="size-4" /> No charge in local demo</span>
          </div>
          {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>{loading ? "Creating workspace…" : "Create workspace and continue"}</Button>
        </CardContent>
      </Card>
    </form>
  );
}
