"use client";

import { startTransition, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkArrow } from "@/components/ui/link-arrow";
import { AuthBrand, PortalAuthSplitShell, type PortalAuthMode } from "@/components/portal/portal-auth-split-shell";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import type { MaintenanceStatus } from "@/lib/system/constants";

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

// The trial needs a card: it starts on Whop's hosted checkout, which takes the card (2026-10-15).
const trialPoints = [
  {
    title: "A card is required for the trial",
    description: "You enter it on Whop\u2019s hosted checkout page, never on an Insurvas form.",
  },
  {
    title: "Your plan decides the menu",
    description: "Features you have not bought are never shown as broken screens.",
  },
];

/** The brand panel beside the agent forms; AppAuthFrame (set password, verify and confirm email) shows the sign-in one. */
export function StoryPanel({ mode }: { mode: PortalAuthMode }) {
  if (mode === "sign-up") {
    return (
      <div className="m-stagger mx-auto w-full max-w-[38rem]">
        <h2 className="mb-8 max-w-[520px] text-headline-lg font-semibold leading-[1.0] tracking-[-0.045em] text-[var(--on-dark)] lg:text-[clamp(2.75rem,4.2vw,3.75rem)]">
          Free trial. Card required.
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
      </div>
    );
  }

  return (
    <div className="m-stagger mx-auto w-full max-w-[38rem]">
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--nav-muted)]">
        Licensed agent portal
      </div>
      <h2 className="mt-3.5 max-w-[520px] text-headline-lg font-semibold leading-[1.0] tracking-[-0.045em] text-[var(--on-dark)] lg:text-[clamp(2.75rem,4.2vw,3.75rem)]">
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
    </div>
  );
}

/**
 * Sign-in only. Sign-up is the one public flow at /signup (/api/public/signup): email verification,
 * legal acceptance, the disposable-address check and Whop checkout. The form that used to live here
 * posted to the legacy app sign-up route (now 410), which skipped all of that and failed on every attempt.
 */
export function TenantAuthWorkspace({
  maintenance,
}: {
  maintenance?: MaintenanceStatus | null;
}) {
  const router = useRouter();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  // LA-8.2: with two-factor on, the password is step one; the authenticator (or a recovery) code is step two.
  const [twoFactorStep, setTwoFactorStep] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  // "Forgot password" swaps the sign-in form for a one-field reset request in the same panel.
  const [resetting, setResetting] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");
  const [resetError, setResetError] = useState<string | null>(null);

  function openReset() {
    startTransition(() => {
      setResetEmail(loginEmail);
      setResetState("idle");
      setResetError(null);
      setResetting(true);
    });
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
      if (body?.twoFactor) { setTwoFactorStep(true); setTwoFactorCode(""); setUseRecoveryCode(false); return; }
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

  async function handleTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const payload = useRecoveryCode ? { recoveryCode: twoFactorCode.trim() } : { code: twoFactorCode.replace(/\s/g, "") };
      const response = await fetch("/api/app/auth/verify-2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (response.status === 401 && /Sign in again/.test(body?.error ?? "")) { setTwoFactorStep(false); setLoginError(body.error); return; }
      if (!response.ok) { setLoginError(body?.error ?? "That code is not right."); return; }
      router.replace(body?.redirectTo ?? "/app/dashboard");
    } catch {
      setLoginError("Could not check the code. Check your connection and try again.");
    } finally {
      setLoginLoading(false);
    }
  }

  const brand = (
    <AuthBrand href="/" label="Insurvas home">
      <InsurvasLogo size="auth" />
    </AuthBrand>
  );

  const signIn = (
    <div className="m-stagger portal-auth-form-inner">
      {brand}
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
        Licensed agent
      </div>
      <h1 className="mt-2 text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        Welcome back
      </h1>
      <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        Sign in to your agency&rsquo;s workspace.
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
          <Link href="/signup">Create a workspace</Link>
        </LinkArrow>
      </div>

      <p className="mt-[18px] text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
        Partner or affiliate?{" "}
        <Link href="/partner/login" className="font-semibold text-foreground">
          Use the partner portal instead
        </Link>
        .
      </p>

      <nav className="portal-login-footer" aria-label="Legal links">
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/tos">Terms</Link>
        <a href="mailto:support@insurvas.com">Support</a>
      </nav>
    </div>
  );

  const reset = (
    <div className="m-stagger portal-auth-form-inner">
      {brand}
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
        Licensed agent
      </div>
      <h1 className="mt-2 text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
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

  const twoFactor = (
    <div className="m-stagger portal-auth-form-inner">
      {brand}
      <h1 className="mt-2 text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        Enter your code
      </h1>
      <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        {useRecoveryCode ? "Type one of the recovery codes you saved. Each one works once." : "Open your authenticator app and type the six-digit code for Insurvas."}
      </p>
      <form className="flex flex-col gap-4" onSubmit={handleTwoFactor} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="tenant-login-code">{useRecoveryCode ? "Recovery code" : "Authentication code"}</Label>
          <Input
            id="tenant-login-code"
            inputMode={useRecoveryCode ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={useRecoveryCode ? 20 : 6}
            value={twoFactorCode}
            onChange={(event) => { setTwoFactorCode(event.target.value); setLoginError(null); }}
          />
        </div>
        {loginError && <p className="portal-auth-alert" role="alert">{loginError}</p>}
        <Button type="submit" className="mt-2 h-12 w-full" disabled={loginLoading || !twoFactorCode.trim()}>
          {loginLoading ? "Checking…" : "Continue"}
        </Button>
      </form>
      <div className="mt-[22px] flex flex-wrap items-center justify-between gap-4">
        <LinkArrow asChild>
          <button type="button" onClick={() => { setUseRecoveryCode((value) => !value); setTwoFactorCode(""); setLoginError(null); }}>
            {useRecoveryCode ? "Use the authenticator app" : "Use a recovery code"}
          </button>
        </LinkArrow>
        <LinkArrow asChild>
          <button type="button" onClick={() => { setTwoFactorStep(false); setLoginError(null); }}>
            Back to sign in
          </button>
        </LinkArrow>
      </div>
    </div>
  );

  const form = twoFactorStep ? twoFactor : resetting ? reset : signIn;

  return <PortalAuthSplitShell mode="sign-in" className="portal-agent portal-tenant-auth-shell" form={form} story={<StoryPanel mode="sign-in" />} />;
}
