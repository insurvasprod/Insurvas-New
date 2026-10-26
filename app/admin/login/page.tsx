"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkArrow } from "@/components/ui/link-arrow";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { AuthBrand, PortalAuthSplitShell } from "@/components/portal/portal-auth-split-shell";
import { OtpInput } from "@/components/app/otp-input";

/**
 * The staff sign-in (2026-10-13: brought into the same split frame as the agent and partner doors —
 * the form on one side, the brand panel with the night ribbon on the other — so the three doors read
 * as one product, in the app's colours like the rest of /admin).
 *
 * Still two steps and two requests: the credentials go to /api/admin/auth/login, and only once they
 * pass does the second step — the authenticator code — open in the same place, as its own form
 * posting to /api/admin/auth/verify-2fa. A step indicator above the form shows where you are, and
 * "Use a different account" goes back.
 */
type Step = "credentials" | "totp";

/** First sign-in of a new staff account: the authenticator is enrolled here, by its owner. */
type Enrolment = { qrDataUrl: string; secret: string };

// Each line is a statement about what the code does, checked against it:
//   audit      lib/audit/log.ts writes ip + user agent on every admin write; audit_log is append-only
//              (20260912193000). Reads are not audited, hence "change", not "action".
//   same answer app/api/admin/auth/login returns one 401 body for an unknown address, a wrong
//              password, an inactive account or a non-staff role, with a dummy hash to level timing.
//              Passing it does reveal the password was right (it is what opens step two), so the
//              line does not claim a failure hides "which factor".
//   maintenance proxy.ts lets /admin/login through; no admin auth route reads maintenance status.
//   12 hours   lib/adminAuth/session.ts: 12h token expiry; the cookie ends with the browser.
const SIGN_IN_FACTS = [
  "Every change you make from here is written to the append-only audit log, with your IP.",
  "A wrong address, a wrong password and a disabled account all get the same answer.",
  "This door stays open during maintenance — staff need in while customers are out.",
  "Sessions last 12 hours.",
];

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  // Step two opens in place of step one; the code boxes take the keyboard (autoFocus) when it does.
  const onTotp = step === "totp";

  async function handleCredentials(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Something went wrong");
        return;
      }
      if (body?.requires2fa) {
        if (body.enrol2fa) {
          // No authenticator on this account yet: fetch a secret for its owner to scan. It is
          // stored only once a code from it verifies (verify-2fa).
          const enrolRes = await fetch("/api/admin/auth/enroll-2fa", { method: "POST" });
          const enrolBody = await enrolRes.json().catch(() => null);
          if (!enrolRes.ok || !enrolBody?.qrDataUrl) {
            setError(enrolBody?.error ?? "Could not start authenticator setup. Try again.");
            return;
          }
          setEnrolment({ qrDataUrl: enrolBody.qrDataUrl, secret: enrolBody.secret });
        } else {
          setEnrolment(null);
        }
        setStep("totp");
        return;
      }
      router.replace("/admin");
    } catch {
      setError("Could not sign in. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(event: FormEvent | null, typed?: string) {
    event?.preventDefault();
    const entered = typed ?? code;
    if (loading || entered.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: entered }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Something went wrong");
        setCode("");
        return;
      }
      router.replace("/admin");
    } catch {
      setError("Could not verify the code. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    setStep("credentials");
    setCode("");
    setEnrolment(null);
    setPassword("");
    setError(null);
  }

  // The authenticator entry is labelled "Insurvas Admin" + the account's email (lib/adminAuth/totp.ts).
  // Shown only once the credentials step has passed, so it never echoes an address nobody confirmed.
  const accountEmail = onTotp ? email.trim().toLowerCase() : "";

  const errorBox = error && (
    <p
      id="admin-login-error"
      role="alert"
      className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]"
    >
      {error}
    </p>
  );

  return (
    <PortalAuthSplitShell
      mode="sign-in"
      className="portal-tenant-auth-shell"
      form={
        <div className="m-stagger portal-auth-form-inner">
          <AuthBrand href="/" label="Insurvas home">
            <InsurvasLogo size="auth" />
          </AuthBrand>

          {/* The same two-bar step line as the sign-up journey (redesign, 2026-10-24). */}
          <div className="mb-8">
            <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-muted-foreground">
              <span className="text-foreground">Step {onTotp ? 2 : 1} of 2</span> · {onTotp ? "Your code" : "Your account"}
            </p>
            <ol className="mt-3 grid grid-cols-2 gap-1.5" aria-label="Sign-in steps">
              <li className="h-1 rounded-full bg-[var(--primary)]" aria-current={onTotp ? undefined : "step"}><span className="sr-only">Your account{onTotp ? ", done" : ", current step"}</span></li>
              <li className={`h-1 rounded-full transition-colors duration-300 ${onTotp ? "bg-[var(--primary)]" : "bg-border"}`} aria-current={onTotp ? "step" : undefined}><span className="sr-only">Your code{onTotp ? ", current step" : ""}</span></li>
            </ol>
          </div>
          <h1 className="text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
            {onTotp ? (enrolment ? "Set up your authenticator" : "Enter your 6-digit code") : "Staff sign in"}
          </h1>
          <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            {onTotp ? "From your authenticator app. You are signed in as soon as the sixth digit is in." : "Insurvas staff only. Your password, then a code from your authenticator app."}
          </p>

          {!onTotp ? (
            <form key="credentials" className="flex flex-col gap-4" onSubmit={handleCredentials}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Staff email</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Label htmlFor="password">Password</Label>
                  <button type="button" aria-expanded={showForgot} aria-controls="admin-forgot" onClick={() => setShowForgot((value) => !value)} className="text-sm font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">
                    Forgot password?
                  </button>
                </div>
                {/* Staff passwords are reset by another super admin, never by email: a staff account opens
                    every agency, so its reset stays a person-to-person step. */}
                {showForgot && (
                  <p id="admin-forgot" className="rounded-lg bg-[var(--surface-alt)] px-3 py-2.5 text-sm leading-normal text-[var(--body)]">
                    Ask another super admin to reset it in Admin › Admin users. Locked out entirely? Write to <a href="mailto:support@insurvas.com" className="font-semibold text-foreground">support@insurvas.com</a>.
                  </p>
                )}
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    aria-describedby={error ? "admin-login-error" : undefined}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>
              {errorBox}
              <Button type="submit" className="mt-2 h-12 w-full" disabled={loading}>
                {loading ? "Checking…" : "Continue"}
              </Button>
            </form>
          ) : (
            <form key="totp" className="flex flex-col gap-4" onSubmit={(event) => void handleTotp(event)}>
              {/* The board says the code "goes to" the email. It does not: it is a TOTP code from an
                  authenticator app (lib/adminAuth/totp.ts), and nothing is ever emailed. */}
              {enrolment ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
                    Two-factor authentication is required and this account has none yet. Scan this code
                    with your authenticator app, then enter the six-digit code it shows for{" "}
                    <strong className="font-semibold text-foreground">{accountEmail}</strong>.
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data: URI */}
                  <img
                    src={enrolment.qrDataUrl}
                    alt="Authenticator setup QR code"
                    width={180}
                    height={180}
                    // Stays white in dark mode on purpose: a QR code needs a light quiet zone.
                    className="self-center rounded-md border border-border bg-white p-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    Can&apos;t scan? Enter this key by hand:{" "}
                    <code className="break-all font-mono text-foreground">{enrolment.secret}</code>
                  </p>
                </div>
              ) : (
                <p className="text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
                  Open your authenticator app and enter the code under{" "}
                  <strong className="font-semibold text-foreground">Insurvas Admin</strong> for{" "}
                  <strong className="font-semibold text-foreground">{accountEmail}</strong>.
                </p>
              )}
              <OtpInput
                idPrefix="code"
                value={code}
                autoFocus
                disabled={loading}
                onChange={(next) => { setCode(next); setError(null); }}
                onComplete={(typed) => void handleTotp(null, typed)}
              />
              {errorBox}
              <Button type="submit" className="mt-2 h-12 w-full" disabled={loading || code.length !== 6}>
                {loading ? "Verifying…" : "Verify and enter"}
              </Button>
              <button type="button" onClick={startOver} className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" aria-hidden="true" /> Use a different account
              </button>
            </form>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Tenant or agent?</span>
            <LinkArrow asChild>
              <Link href="/app/login">Sign in to the Insurvas app</Link>
            </LinkArrow>
          </div>

          <nav className="portal-login-footer" aria-label="Legal links">
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/tos">Terms</Link>
            <a href="mailto:support@insurvas.com">Support</a>
          </nav>
        </div>
      }
      story={
        <div className="m-stagger mx-auto w-full max-w-[38rem]">
          <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--nav-muted)]">
            Insurvas · Super admin
          </div>
          <h2 className="mt-3.5 max-w-[520px] text-headline-lg font-semibold leading-[1.0] tracking-[-0.045em] text-[var(--on-dark)] lg:text-[clamp(2.75rem,4.2vw,3.75rem)]">
            The platform, from the inside.
          </h2>

          <div className="mt-8 max-w-[460px] rounded-xl border border-[var(--nav-line)] bg-[color-mix(in_srgb,var(--nav-bg)_62%,transparent)] p-6 backdrop-blur-md">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="size-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
              <span className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-[var(--on-dark)]">
                What happens when you sign in
              </span>
            </div>
            <ul className="mt-4 p-0">
              {SIGN_IN_FACTS.map((line) => (
                <li key={line} className="flex list-none gap-2.5 py-1.5">
                  <Lock className="size-[13px] shrink-0 translate-y-1 text-[var(--nav-muted)]" strokeWidth={2.4} aria-hidden="true" />
                  <span className="text-sm leading-normal tracking-[-0.02em] text-[var(--nav-ink)]">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      }
    />
  );
}
