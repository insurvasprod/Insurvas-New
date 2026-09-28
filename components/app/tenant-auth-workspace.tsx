"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkArrow } from "@/components/ui/link-arrow";
import { PortalAuthSplitShell, type PortalAuthMode } from "@/components/portal/portal-auth-split-shell";
import type { PublicPlanOption } from "@/lib/plans/public";
import type { MaintenanceStatus } from "@/lib/system/constants";

type BillingCycle = "monthly" | "quarterly" | "yearly";

const cycleLabels: Record<BillingCycle, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

/**
 * The panel is reassurance, not content.
 *
 * It says what this door is for — the floor, and the boundary around it — so a partner or a member
 * of staff who landed here can tell in one look that they are at the wrong door. Below 1024px the
 * shell drops it entirely rather than pushing the form under the fold.
 */
const floorLines = [
  { label: "Inbound transfers, claimed once", value: "One claim" },
  { label: "Screening re-checked before every dial", value: "Server-side" },
  { label: "Cost traced through to the issued policy", value: "True CPA" },
  { label: "Callbacks, appointments and the book", value: "One record" },
];

const trialPoints = [
  {
    title: "Card details are never typed here",
    description: "Payment happens on the provider\u2019s hosted page, after checkout.",
  },
  {
    title: "Your plan decides the menu",
    description: "Features you have not bought are never shown as broken screens.",
  },
];

function availableCycles(plan: PublicPlanOption) {
  return (["monthly", "quarterly", "yearly"] as BillingCycle[]).filter((cycle) => plan.prices[cycle] !== null);
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function StoryPanel({ mode }: { mode: PortalAuthMode }) {
  if (mode === "sign-up") {
    return (
      <div className="m-stagger mx-auto w-full max-w-[38rem]">
        <h2 className="mb-8 max-w-[460px] text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--on-dark)] sm:text-[40px]">
          Fourteen days, no card.
        </h2>
        <div className="flex max-w-[460px] flex-col gap-6">
          {trialPoints.map((point) => (
            <div key={point.title} className="flex items-start gap-3.5">
              <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-[var(--nav-line)] text-[var(--primary)]">
                <Check className="size-4 stroke-[3]" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-[var(--on-dark)]">
                  {point.title}
                </span>
                <span className="mt-1 block text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)]">
                  {point.description}
                </span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-[460px] text-xs leading-normal tracking-[-0.01em] text-[var(--nav-muted)]">
          Your workspace and owner account are created before payment, so nothing you type here is lost at checkout.
        </p>
      </div>
    );
  }

  return (
    <div className="m-stagger mx-auto w-full max-w-[38rem]">
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--nav-muted)]">
        Licensed agent portal
      </div>
      <h2 className="mt-3.5 max-w-[460px] text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--on-dark)] sm:text-[40px]">
        Your floor is already running.
      </h2>
      <div className="mt-8 max-w-[460px]">
        {floorLines.map((line) => (
          <div
            key={line.label}
            className="flex items-center justify-between gap-4 border-t border-[var(--nav-line)] py-3"
          >
            <span className="text-sm leading-normal tracking-[-0.02em] text-[var(--nav-ink)]">{line.label}</span>
            <span className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] tabular-nums text-[var(--on-dark)]">
              {line.value}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-8 max-w-[460px] text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)]">
        This panel is the reason a licensed agent signs in here rather than anywhere else: the queue does not wait for
        you, and the first thing you should see is how far behind it is.
      </p>
    </div>
  );
}

export function TenantAuthWorkspace({
  plans,
  initialMode = "sign-in",
  maintenance,
}: {
  plans: PublicPlanOption[];
  initialMode?: PortalAuthMode;
  maintenance?: MaintenanceStatus | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<PortalAuthMode>(initialMode);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const firstPlan = plans[0];
  const initialCycles = firstPlan ? availableCycles(firstPlan) : [];
  const [workspaceName, setWorkspaceName] = useState("");
  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [planId, setPlanId] = useState(firstPlan?.id ?? "");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(initialCycles[0] ?? "monthly");
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupLoading, setSignupLoading] = useState(false);

  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === planId) ?? null, [plans, planId]);
  const selectedCycles = selectedPlan ? availableCycles(selectedPlan) : [];

  // "Forgot password" swaps the sign-in form for a one-field reset request in the same panel.
  const [resetting, setResetting] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");
  const [resetError, setResetError] = useState<string | null>(null);

  function switchMode(next: PortalAuthMode) {
    setMode(next);
    setResetting(false);
    setLoginError(null);
    setSignupError(null);
  }

  function openReset() {
    setResetEmail(loginEmail);
    setResetState("idle");
    setResetError(null);
    setResetting(true);
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetError(null);
    if (!resetEmail.trim()) { setResetError("Enter the email address you sign in with."); return; }
    setResetState("sending");
    try {
      const response = await fetch("/api/app/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: resetEmail }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setResetError(body?.error ?? "Could not send a reset link. Try again."); setResetState("idle"); return; }
      setResetState("sent");
    } catch {
      setResetError("Could not send a reset link. Check your connection and try again.");
      setResetState("idle");
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const response = await fetch("/api/app/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: loginPassword }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setLoginError(body?.error ?? "Something went wrong"); return; }
      // Straight to the landing page, once. The old push("/app") + refresh() rendered the landing page
      // twice and bounced through /app's redirect — the slowest part of "11 seconds after login".
      // Nothing above the shell reads the session, so no refresh is needed for the new cookie.
      router.replace(body?.redirectTo ?? "/app/dashboard");
    } catch {
      setLoginError("Could not sign in. Check your connection and try again.");
    } finally {
      setLoginLoading(false);
    }
  }

  function choosePlan(nextPlanId: string) {
    const nextPlan = plans.find((plan) => plan.id === nextPlanId);
    setPlanId(nextPlanId);
    const cycles = nextPlan ? availableCycles(nextPlan) : [];
    if (!cycles.includes(billingCycle)) setBillingCycle(cycles[0] ?? "monthly");
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSignupError(null);
    if (passwordTooShort(signupPassword)) { setSignupError("Use a password with at least 12 characters."); return; }
    if (signupPassword !== confirmPassword) { setSignupError("The passwords do not match."); return; }
    if (!workspaceName.trim() || !fullName.trim() || !signupEmail.trim()) { setSignupError("Complete your workspace and account details."); return; }
    if (!selectedPlan || !selectedCycles.includes(billingCycle)) { setSignupError("Choose an available plan and billing cycle."); return; }
    setSignupLoading(true);
    try {
      const response = await fetch("/api/app/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceName, fullName, email: signupEmail, password: signupPassword, planId, billingCycle }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setSignupError(body?.error ?? "We could not create your workspace. Check the form and try again."); return; }
      router.replace(body?.redirectTo ?? "/app/dashboard");
    } catch {
      setSignupError("Could not create your workspace. Check your connection and try again.");
    } finally {
      setSignupLoading(false);
    }
  }

  const brand = (
    <Link href="/app/login" className="mb-10 flex items-center gap-2.5 no-underline" aria-label="Insurvas licensed agent portal">
      <span className="inline-flex size-[30px] items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-semibold text-[var(--on-primary)]">
        I
      </span>
      <span className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Insurvas</span>
    </Link>
  );

  const signIn = (
    <div className="m-stagger portal-auth-form-inner">
      {brand}
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
        Licensed agent
      </div>
      <h1 className="mt-2 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[40px]">
        Welcome back
      </h1>
      <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        One message covers a wrong email and a wrong password — naming which would confirm the address exists.
      </p>

      <form className="flex flex-col gap-4" onSubmit={handleLogin} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="tenant-login-email">Work email</Label>
          <Input
            id="tenant-login-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={loginEmail}
            onChange={(event) => {
              setLoginEmail(event.target.value);
              setLoginError(null);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tenant-login-password">Password</Label>
          <div className="relative">
            <Input
              id="tenant-login-password"
              type={showLoginPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={loginPassword}
              onChange={(event) => {
                setLoginPassword(event.target.value);
                setLoginError(null);
              }}
              className="pr-11"
            />
            <button
              type="button"
              className="portal-auth-visibility"
              onClick={() => setShowLoginPassword((value) => !value)}
              aria-label={showLoginPassword ? "Hide password" : "Show password"}
              aria-pressed={showLoginPassword}
            >
              {showLoginPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
          <p className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
            Paste is allowed, and nothing is autofocused.
          </p>
        </div>

        {maintenance?.level === "locked" && (
          <div role="alert" className="portal-auth-alert">
            <strong>Sign in is temporarily unavailable</strong>
            <span>{maintenance.message}</span>
          </div>
        )}
        {loginError && (
          <p className="portal-auth-alert" role="alert">
            {loginError}
          </p>
        )}

        <Button type="submit" className="mt-2 h-12 w-full" disabled={loginLoading || maintenance?.level === "locked"}>
          {loginLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="mt-[22px] flex flex-wrap items-center justify-between gap-4">
        <LinkArrow asChild>
          <button type="button" onClick={openReset}>
            Forgot password
          </button>
        </LinkArrow>
        <LinkArrow asChild>
          <button type="button" onClick={() => switchMode("sign-up")}>
            Create a workspace
          </button>
        </LinkArrow>
      </div>

      <p className="mt-[18px] text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
        Partner or affiliate?{" "}
        <Link href="/partner/login" className="font-semibold text-foreground">
          Use the partner portal instead
        </Link>
        . Insurvas staff sign in at a different door.
      </p>
    </div>
  );

  const reset = (
    <div className="m-stagger portal-auth-form-inner">
      {brand}
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
        Licensed agent
      </div>
      <h1 className="mt-2 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[40px]">
        {resetState === "sent" ? "Check your inbox" : "Reset your password"}
      </h1>
      {resetState === "sent" ? (
        <>
          <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            If <strong className="font-semibold text-foreground">{resetEmail.trim()}</strong> belongs to an agent account, a link to choose a new password is on its way. It works once. The answer is the same for every address, so this page cannot be used to learn who has an account.
          </p>
          <p className="text-sm leading-normal text-[var(--body)]">Nothing arrived after a few minutes? Check spam, then write to <a href="mailto:support@insurvas.com?subject=Password%20help" className="font-semibold text-foreground">support@insurvas.com</a>.</p>
        </>
      ) : (
        <>
          <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            Enter the email you sign in with. We send a one-time link to choose a new password.
          </p>
          <form className="flex flex-col gap-4" onSubmit={handleReset} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="tenant-reset-email">Work email</Label>
              <Input id="tenant-reset-email" type="email" inputMode="email" autoComplete="username" required value={resetEmail} onChange={(event) => { setResetEmail(event.target.value); setResetError(null); }} />
            </div>
            {resetError && <p className="portal-auth-alert" role="alert">{resetError}</p>}
            <Button type="submit" className="mt-2 h-12 w-full" disabled={resetState === "sending" || maintenance?.level === "locked"}>
              {resetState === "sending" ? "Sending…" : "Send the reset link"}
            </Button>
          </form>
        </>
      )}
      <div className="mt-[22px]">
        <LinkArrow asChild>
          <button type="button" onClick={() => setResetting(false)}>
            Back to sign in
          </button>
        </LinkArrow>
      </div>
    </div>
  );

  const signUp = (
    <div className="m-stagger portal-auth-form-inner portal-auth-signup-inner">
      {brand}
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
        Licensed agent
      </div>
      <h1 className="mt-2 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[40px]">
        Create your workspace
      </h1>
      <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        Nothing here is hard-coded. If the plans call fails, this form says so and refuses to submit rather than
        creating an account with no plan.
      </p>

      <form className="flex flex-col gap-4" onSubmit={handleSignup} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="tenant-workspace-name">Workspace name</Label>
          <Input
            id="tenant-workspace-name"
            required
            maxLength={160}
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tenant-full-name">Your full name</Label>
          <Input
            id="tenant-full-name"
            required
            maxLength={120}
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tenant-signup-email">Work email</Label>
          <Input
            id="tenant-signup-email"
            type="email"
            required
            autoComplete="email"
            value={signupEmail}
            onChange={(event) => setSignupEmail(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tenant-signup-password">Password</Label>
          <div className="relative">
            <Input
              id="tenant-signup-password"
              type={showSignupPassword ? "text" : "password"}
              required
              minLength={12}
              autoComplete="new-password"
              value={signupPassword}
              onChange={(event) => {
                setSignupPassword(event.target.value);
                setSignupError(null);
              }}
              className="pr-11"
            />
            <button
              type="button"
              className="portal-auth-visibility"
              onClick={() => setShowSignupPassword((value) => !value)}
              aria-label={showSignupPassword ? "Hide password" : "Show password"}
              aria-pressed={showSignupPassword}
            >
              {showSignupPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tenant-confirm-password">Confirm password</Label>
          <div className="relative">
            <Input
              id="tenant-confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              required
              minLength={12}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setSignupError(null);
              }}
              className="pr-11"
            />
            <button
              type="button"
              className="portal-auth-visibility"
              onClick={() => setShowConfirmPassword((value) => !value)}
              aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
              aria-pressed={showConfirmPassword}
            >
              {showConfirmPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
          <p className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
            At least 12 characters. Both fields have their own visibility toggle.
          </p>
        </div>

        <div className="rounded-lg bg-[var(--surface-alt)] p-4">
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
              Plan — live from the API
            </span>
            <span className="text-xs font-semibold text-[var(--accent-ink)]">
              {selectedPlan ? `${selectedPlan.prices.trialDays}-day trial` : "Plans unavailable"}
            </span>
          </div>

          {plans.length ? (
            <div className="flex flex-col gap-2">
              {plans.map((plan) => {
                const cycles = availableCycles(plan);
                const checked = plan.id === planId;
                return (
                  <label
                    key={plan.id}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3.5 py-3 text-left ${
                      checked
                        ? "border-[1.5px] border-[var(--primary)] bg-[var(--soft-orange-surface)]"
                        : "border border-[var(--border-strong)] bg-card"
                    }`}
                  >
                    <input
                      type="radio"
                      name="tenant-plan"
                      className="sr-only"
                      checked={checked}
                      onChange={() => choosePlan(plan.id)}
                    />
                    <span
                      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
                        checked
                          ? "bg-[var(--primary)] text-[var(--on-primary)]"
                          : "border-[1.5px] border-[var(--border-strong)]"
                      }`}
                      aria-hidden="true"
                    >
                      {checked && <Check className="size-3 stroke-[3]" />}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">
                        {plan.name}
                      </span>
                      <span className="block text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
                        {plan.description || `${plan.planType.replaceAll("_", " ")} workspace`}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {cycles.length
                        ? `${money(plan.prices[cycles[0]] ?? 0, plan.prices.currency)} / ${cycleLabels[cycles[0]].toLowerCase()}`
                        : "Custom"}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="portal-auth-plan-empty">Plans are temporarily unavailable. Try again later.</p>
          )}

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="tenant-billing-cycle">Billing cycle</Label>
            <select
              id="tenant-billing-cycle"
              value={billingCycle}
              onChange={(event) => setBillingCycle(event.target.value as BillingCycle)}
              disabled={!selectedCycles.length}
              className="h-11 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-base"
            >
              {selectedCycles.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {cycleLabels[cycle]} — {money(selectedPlan?.prices[cycle] ?? 0, selectedPlan?.prices.currency ?? "USD")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {signupError && (
          <p className="portal-auth-alert" role="alert">
            {signupError}
          </p>
        )}

        <Button type="submit" className="mt-2 h-11 w-full" disabled={signupLoading || !plans.length}>
          {signupLoading ? "Creating workspace…" : "Create workspace and continue"}
        </Button>
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-4">
        <LinkArrow asChild>
          <button type="button" onClick={() => switchMode("sign-in")}>
            Sign in instead
          </button>
        </LinkArrow>
        <span className="text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
          <Link href="/legal/privacy">Privacy</Link> · <Link href="/legal/tos">Terms</Link> ·{" "}
          <a href="mailto:support@insurvas.com">Support</a>
        </span>
      </div>
    </div>
  );

  const form = mode === "sign-in" ? (resetting ? reset : signIn) : signUp;

  return <PortalAuthSplitShell mode={mode} className="portal-agent portal-tenant-auth-shell" form={form} story={<StoryPanel mode={mode} />} />;
}

function passwordTooShort(value: string) {
  return value.length < 12;
}
