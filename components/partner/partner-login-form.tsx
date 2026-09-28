"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, LockKeyhole, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkArrow } from "@/components/ui/link-arrow";

const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());

/**
 * What this door lets you see, and what it does not.
 *
 * The denials are the point: a partner who can read the boundary before signing in never files a
 * ticket asking why another organisation's leads are missing.
 */
const boundary = [
  { label: "Leads your organisation submitted", allowed: true },
  { label: "Their stage, and who moved them", allowed: true },
  { label: "Your channel with the agency", allowed: true },
  { label: "Another partner\u2019s leads or messages", allowed: false },
  { label: "Agent-internal notes and lead cost", allowed: false },
];

export function PartnerLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    if (!email.trim()) { setFieldError("Enter your email address"); return; }
    if (!validEmail(email)) { setFieldError("Enter a valid email address"); return; }
    if (!password) { setFieldError("Enter your password"); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/partner/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, remember }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Something went wrong"); return; }
      // One navigation, not push + refresh (which rendered the portal twice after sign-in).
      router.replace(body?.redirectTo ?? "/partner");
    } catch {
      setError("Could not sign in. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="portal-partner portal-partner-login-page">
      <section className="portal-login-form-panel">
        <div className="m-stagger portal-login-form-inner">
          <Link
            href="/partner/login"
            className="mb-10 flex items-center gap-2.5 no-underline"
            aria-label="Insurvas partner portal"
          >
            <span className="inline-flex size-[30px] items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-semibold text-[var(--on-primary)]">
              I
            </span>
            <span className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">
              Insurvas partners
            </span>
          </Link>

          <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
            Partner access
          </div>
          <h1 className="mt-2 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-[40px]">
            Sign in to your workspace
          </h1>
          <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            One message covers a wrong email and a wrong password.
          </p>

          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="partner-email">Work email</Label>
              <Input
                id="partner-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                aria-required="true"
                aria-invalid={Boolean(fieldError && (!email || !validEmail(email)))}
                aria-describedby={fieldError && (!email || !validEmail(email)) ? "partner-email-error" : undefined}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setFieldError(null);
                }}
              />
              {fieldError && (!email || !validEmail(email)) && (
                <p id="partner-email-error" className="text-sm text-[var(--error-ink)]" role="alert">
                  {fieldError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="partner-password">Password</Label>
              <div className="relative">
                <Input
                  id="partner-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-required="true"
                  aria-invalid={Boolean(fieldError && validEmail(email) && !password)}
                  aria-describedby={
                    fieldError && validEmail(email) && !password
                      ? "partner-password-error"
                      : error
                        ? "partner-login-error"
                        : undefined
                  }
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setFieldError(null);
                    setError(null);
                  }}
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
              {fieldError && validEmail(email) && !password && (
                <p id="partner-password-error" className="text-sm text-[var(--error-ink)]" role="alert">
                  {fieldError}
                </p>
              )}
            </div>

            <label htmlFor="partner-remember" className="portal-remember-me">
              <input id="partner-remember" type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              Keep me signed in on this device
            </label>

            {error && (
              <p
                id="partner-login-error"
                role="alert"
                className="rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]"
              >
                {error}
              </p>
            )}

            <Button type="submit" className="mt-2 h-12 w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">
              Received an invitation?
            </div>
            <p className="mb-2.5 mt-1.5 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
              Partner accounts are created by the agency. Open the secure link from your email — signing in here will
              not work until you have.
            </p>
            <LinkArrow asChild>
              <Link href="/partner/accept-invite">Open an invitation</Link>
            </LinkArrow>
          </div>

          <div className="mt-[18px] flex flex-wrap items-center justify-between gap-4">
            <LinkArrow href="mailto:support@insurvas.com?subject=Partner%20password%20help">Forgot password</LinkArrow>
            <LinkArrow asChild>
              <Link href="/app/login">Agent sign in</Link>
            </LinkArrow>
          </div>

          <nav className="portal-login-footer" aria-label="Legal links">
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/tos">Terms</Link>
            <a href="mailto:support@insurvas.com">Support</a>
          </nav>
        </div>
      </section>

      <aside className="portal-login-feature-panel">
        <div className="m-stagger portal-login-feature-inner">
          <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--nav-muted)]">
            Partner portal
          </div>
          <h2 className="mt-3.5 max-w-[480px] text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--on-dark)] sm:text-[40px]">
            Submit, track and coordinate — without crossing data boundaries.
          </h2>
          <p className="mt-4 max-w-[460px] text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)]">
            You are not signing into the agency&rsquo;s workspace. You are signing into your own view of it, and this
            panel says exactly where it stops.
          </p>

          <div className="mt-8 max-w-[460px] rounded-xl border border-[var(--nav-line)] bg-[var(--nav-bg)] p-6">
            <div className="flex items-center gap-2.5">
              <LockKeyhole className="size-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
              <span className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-[var(--on-dark)]">
                Your organisation only
              </span>
            </div>
            <div className="mt-4">
              {boundary.map((item) => (
                <div key={item.label} className="flex gap-2.5 py-1.5">
                  {item.allowed ? (
                    <Check className="size-[13px] shrink-0 translate-y-1 stroke-[3] text-[var(--nav-success)]" aria-hidden="true" />
                  ) : (
                    <X className="size-[13px] shrink-0 translate-y-1 stroke-[3] text-[var(--nav-muted)]" aria-hidden="true" />
                  )}
                  <span
                    className={`text-sm leading-normal tracking-[-0.02em] ${
                      item.allowed ? "text-[var(--nav-ink)]" : "text-[var(--nav-muted)]"
                    }`}
                  >
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
