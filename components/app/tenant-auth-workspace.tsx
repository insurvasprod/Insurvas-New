"use client";

import { startTransition, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkArrow } from "@/components/ui/link-arrow";
import { AuthBrand, PortalAuthSplitShell, type PortalAuthMode } from "@/components/portal/portal-auth-split-shell";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { OtpInput } from "@/components/app/otp-input";
import { TRIAL_DAYS } from "@/lib/checkout/constants";
import { SIGN_IN_LINK_MINUTES, TRUSTED_DEVICE_DAYS } from "@/lib/tenantAuth/signInConstants";
import type { MaintenanceStatus } from "@/lib/system/constants";

/** The address that last signed in on this browser, so a returning agent types only the password. */
const LAST_EMAIL_KEY = "insurvas:last-sign-in-email";

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
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  // "Keep me signed in on this device" (ticked by default, the cookie the app always gave) and
  // "Trust this device for 30 days" at the code step.
  const [remember, setRemember] = useState(true);
  const [trustDevice, setTrustDevice] = useState(false);

  // "Email me a sign-in link": the request panel, and the link itself when this page was opened from one.
  const [linkRequest, setLinkRequest] = useState<"closed" | "open" | "sending" | "sent">("closed");
  const [linkEmail, setLinkEmail] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkCooldown, setLinkCooldown] = useState(0);
  const [linkToken, setLinkToken] = useState<string | null>(null);

  // A link arrives as /app/login#link=…: the fragment never reaches a server, and it is cleared from
  // the address bar at once so it is not left in history or shared by accident.
  useEffect(() => {
    const match = /^#link=(.+)$/.exec(window.location.hash);
    if (!match) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the fragment is only readable after mount
    setLinkToken(decodeURIComponent(match[1]));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    if (linkCooldown <= 0) return;
    const timer = window.setInterval(() => setLinkCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [linkCooldown]);

  // A remembered address fills the field and puts the cursor in the password; otherwise the email.
  useEffect(() => {
    if (/^#link=/.test(window.location.hash)) return;
    let remembered = "";
    try { remembered = window.localStorage.getItem(LAST_EMAIL_KEY) ?? ""; } catch { /* storage blocked */ }
    if (remembered) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after mount
      setLoginEmail((current) => current || remembered);
      passwordRef.current?.focus();
    } else {
      emailRef.current?.focus();
    }
  }, []);

  function rememberEmail() {
    try { window.localStorage.setItem(LAST_EMAIL_KEY, loginEmail.trim()); } catch { /* storage blocked */ }
  }

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

  function openLinkRequest() {
    setLinkEmail(loginEmail);
    setLinkError(null);
    setLinkRequest("open");
  }

  async function requestLink(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (linkCooldown > 0) return;
    setLinkError(null);
    if (!linkEmail.trim()) { setLinkError("Enter the email address you sign in with."); return; }
    setLinkRequest("sending");
    try {
      const response = await fetch("/api/app/auth/sign-in-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: linkEmail, remember }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setLinkError(body?.error ?? "Could not send a sign-in link. Try again."); setLinkRequest("open"); return; }
      setLinkRequest("sent");
      setLinkCooldown(30);
    } catch {
      setLinkError("Could not send a sign-in link. Check your connection and try again.");
      setLinkRequest("open");
    }
  }

  /** The password, or the emailed link, goes to the same sign-in route. */
  async function submitSignIn(payload: Record<string, unknown>) {
    setLoginError(null);
    setLoginLoading(true);
    try {
      const response = await fetch("/api/app/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, remember }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setLoginError(body?.error ?? "Something went wrong"); return; }
      if (body?.twoFactor) { setLinkToken(null); setTwoFactorStep(true); setTwoFactorCode(""); setUseRecoveryCode(false); return; }
      router.replace(body?.redirectTo ?? "/app/dashboard");
    } catch {
      setLoginError("Could not sign in. Check your connection and try again.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const response = await fetch("/api/app/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: loginPassword, remember }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setLoginError(body?.error ?? "Something went wrong"); return; }
      rememberEmail();
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

  async function handleTwoFactor(event: FormEvent<HTMLFormElement> | null, typed?: string) {
    event?.preventDefault();
    const code = typed ?? twoFactorCode;
    if (loginLoading || !code.trim()) return;
    setLoginError(null);
    setLoginLoading(true);
    try {
      const payload = useRecoveryCode ? { recoveryCode: code.trim(), trust: trustDevice } : { code: code.replace(/\s/g, ""), trust: trustDevice };
      const response = await fetch("/api/app/auth/verify-2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (response.status === 401 && /Sign in again/.test(body?.error ?? "")) { setTwoFactorStep(false); setLoginError(body.error); return; }
      if (!response.ok) { setLoginError(body?.error ?? "That code is not right."); if (!useRecoveryCode) setTwoFactorCode(""); return; }
      router.replace(body?.redirectTo ?? "/app/dashboard");
    } catch {
      setLoginError("Could not check the code. Check your connection and try again.");
    } finally {
      setLoginLoading(false);
    }
  }

  const rememberBox = (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
      <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-5 shrink-0 accent-[var(--accent-ink)]" />
      Keep me signed in on this device
    </label>
  );

  const brand = (
    <AuthBrand href="/" label="Insurvas home">
      <InsurvasLogo size="auth" />
    </AuthBrand>
  );

  const signIn = (
    <div className="m-stagger portal-auth-form-inner">
      {brand}
      <h1 className="text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        Welcome back
      </h1>
      <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        Sign in to your agency&rsquo;s workspace.
      </p>

      <form className="flex flex-col gap-4" onSubmit={handleLogin} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="tenant-login-email">Email</Label>
          <Input
            ref={emailRef}
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
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="tenant-login-password">Password</Label>
            <button type="button" onClick={openReset} className="text-sm font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Input
              ref={passwordRef}
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

        {rememberBox}

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

        <Button type="submit" className="mt-1 h-12 w-full" disabled={loginLoading || maintenance?.level === "locked"}>
          {loginLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="h-12 w-full border-[var(--border-strong)]" onClick={openLinkRequest} disabled={maintenance?.level === "locked"}>
        Email me a sign-in link
      </Button>

      <p className="mt-6 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
        New to Insurvas?{" "}
        <Link href="/signup" className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">
          Start a {TRIAL_DAYS}-day trial
        </Link>
      </p>

      <p className="mt-3 text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
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
      <h1 className="text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        {resetState === "sent" ? "Check your inbox" : "Reset your password"}
      </h1>
      {resetState === "sent" ? (
        <>
          <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            If <strong className="font-semibold text-foreground">{resetEmail.trim()}</strong> belongs to an agent account, a link to choose a new password is on its way. It works once.
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
              <Label htmlFor="tenant-reset-email">Email</Label>
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
      <h1 className="text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        {useRecoveryCode ? "Enter a recovery code" : "Enter your 6-digit code"}
      </h1>
      <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        {useRecoveryCode ? "Type one of the recovery codes you saved. Each one works once." : "From your authenticator app. You are signed in as soon as the sixth digit is in."}
      </p>
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleTwoFactor(event)} noValidate>
        {useRecoveryCode ? (
          <div className="space-y-1.5">
            <Label htmlFor="tenant-login-code">Recovery code</Label>
            <Input
              id="tenant-login-code"
              autoComplete="off"
              autoFocus
              required
              maxLength={20}
              placeholder="xxxx-xxxx"
              value={twoFactorCode}
              onChange={(event) => { setTwoFactorCode(event.target.value); setLoginError(null); }}
            />
          </div>
        ) : (
          <OtpInput
            idPrefix="tenant-login-code"
            value={twoFactorCode}
            autoFocus
            disabled={loginLoading}
            onChange={(next) => { setTwoFactorCode(next); setLoginError(null); }}
            onComplete={(code) => void handleTwoFactor(null, code)}
          />
        )}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
          <input type="checkbox" checked={trustDevice} onChange={(event) => setTrustDevice(event.target.checked)} className="size-5 shrink-0 accent-[var(--accent-ink)]" />
          Trust this device for {TRUSTED_DEVICE_DAYS} days
        </label>
        {loginError && <p className="portal-auth-alert" role="alert">{loginError}</p>}
        <Button type="submit" className="mt-1 h-12 w-full" disabled={loginLoading || !twoFactorCode.trim()}>
          {loginLoading ? "Checking…" : "Verify and sign in"}
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

  const backToPassword = (
    <div className="mt-[22px]">
      <LinkArrow asChild>
        <button type="button" onClick={() => { setLinkRequest("closed"); setLinkToken(null); setLoginError(null); }}>
          Use my password instead
        </button>
      </LinkArrow>
    </div>
  );

  const linkRequestPanel = (
    <div className="m-stagger portal-auth-form-inner">
      {brand}
      <h1 className="text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        {linkRequest === "sent" ? "Check your inbox" : "Sign in with a link"}
      </h1>
      {linkRequest === "sent" ? (
        <>
          <p className="mb-6 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            If <strong className="font-semibold text-foreground">{linkEmail.trim()}</strong> belongs to an agent account, a sign-in link is on its way. It works once, for {SIGN_IN_LINK_MINUTES} minutes.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <Button asChild variant="outline" className="h-12 border-[var(--border-strong)] px-4">
              <a href="https://mail.google.com/mail/u/0/#search/from%3Ainsurvas" target="_blank" rel="noopener noreferrer">Open Gmail</a>
            </Button>
            <Button asChild variant="outline" className="h-12 border-[var(--border-strong)] px-4">
              <a href="https://outlook.office.com/mail/" target="_blank" rel="noopener noreferrer">Open Outlook</a>
            </Button>
          </div>
          {linkError && <p className="portal-auth-alert mt-4" role="alert">{linkError}</p>}
          <p className="mt-5 text-sm leading-normal text-[var(--body)]">
            Nothing arrived?{" "}
            <button type="button" className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline disabled:text-muted-foreground disabled:no-underline" disabled={linkCooldown > 0} onClick={() => void requestLink()}>
              {linkCooldown > 0 ? `Send it again in ${linkCooldown}s` : "Send it again"}
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            We email you a link that signs you in once, within {SIGN_IN_LINK_MINUTES} minutes. No password needed.
          </p>
          <form className="flex flex-col gap-4" onSubmit={(event) => void requestLink(event)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="tenant-link-email">Email</Label>
              <Input id="tenant-link-email" type="email" inputMode="email" autoComplete="username" autoFocus required value={linkEmail} onChange={(event) => { setLinkEmail(event.target.value); setLinkError(null); }} />
            </div>
            {rememberBox}
            {linkError && <p className="portal-auth-alert" role="alert">{linkError}</p>}
            <Button type="submit" className="mt-1 h-12 w-full" disabled={linkRequest === "sending" || maintenance?.level === "locked"}>
              {linkRequest === "sending" ? "Sending…" : "Email me the link"}
            </Button>
          </form>
        </>
      )}
      {backToPassword}
    </div>
  );

  // Opened from the emailed link. Nothing happens until the button is pressed, so a mail scanner that
  // opens the link does not use it up.
  const linkFinishPanel = (
    <div className="m-stagger portal-auth-form-inner">
      {brand}
      <h1 className="text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        Finish signing in
      </h1>
      <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        You opened your sign-in link. Press the button to sign in on this device.
      </p>
      <div className="flex flex-col gap-4">
        {rememberBox}
        {loginError && <p className="portal-auth-alert" role="alert">{loginError}</p>}
        <Button type="button" className="h-12 w-full" autoFocus disabled={loginLoading || maintenance?.level === "locked"} onClick={() => void submitSignIn({ link: linkToken })}>
          {loginLoading ? "Signing in…" : "Sign in"}
        </Button>
      </div>
      {backToPassword}
    </div>
  );

  const form = twoFactorStep ? twoFactor : linkToken ? linkFinishPanel : linkRequest !== "closed" ? linkRequestPanel : resetting ? reset : signIn;

  return <PortalAuthSplitShell mode="sign-in" className="portal-agent portal-tenant-auth-shell" form={form} story={<StoryPanel mode="sign-in" />} />;
}
