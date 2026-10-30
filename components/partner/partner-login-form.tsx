"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AuthHeading } from "@/components/portal/auth-layout";
import { AuthAlert, AuthInput, authLabel } from "@/components/portal/auth-controls";
import { LinkArrow } from "@/components/ui/link-arrow";
import { PartnerAuthFrame } from "@/components/partner/partner-auth-frame";

const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());

/** The address that last signed in at this door on this browser. */
const LAST_EMAIL_KEY = "insurvas:last-partner-email";

/**
 * The partner sign-in, in the shared partner frame (PartnerAuthFrame: logo, legal links, and the brand
 * panel saying what a partner can and cannot see). Laid out like the agent sign-in since the redesign
 * (2026-10-24): "Forgot password?" beside the field, and a real reset (it used to email support).
 */
export function PartnerLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // "Forgot password?" swaps the form for a one-field reset request in the same panel.
  const [resetting, setResetting] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    let remembered = "";
    try { remembered = window.localStorage.getItem(LAST_EMAIL_KEY) ?? ""; } catch { /* storage blocked */ }
    if (remembered) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after mount
      setEmail((current) => current || remembered);
      passwordRef.current?.focus();
    } else {
      emailRef.current?.focus();
    }
  }, []);

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
      try { window.localStorage.setItem(LAST_EMAIL_KEY, email.trim()); } catch { /* storage blocked */ }
      // One navigation, not push + refresh (which rendered the portal twice after sign-in).
      router.replace(body?.redirectTo ?? "/partner");
    } catch {
      setError("Could not sign in. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function requestReset(event: FormEvent) {
    event.preventDefault();
    setResetError(null);
    if (!validEmail(resetEmail)) { setResetError("Enter the email address you sign in with."); return; }
    setResetState("sending");
    try {
      const response = await fetch("/api/partner/auth/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: resetEmail }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setResetError(body?.error ?? "Could not send a reset link. Try again."); setResetState("idle"); return; }
      setResetState("sent");
    } catch {
      setResetError("Could not send a reset link. Check your connection and try again.");
      setResetState("idle");
    }
  }

  if (resetting) {
    return (
      <PartnerAuthFrame animated>
        {resetState === "sent" ? (
          <AuthHeading title="Check your inbox">
            If <strong className="font-semibold text-foreground">{resetEmail.trim()}</strong> belongs to a partner account, a link to choose a new password is on its way. It works once.
          </AuthHeading>
        ) : (
          <>
            <AuthHeading title="Reset your password">Enter the email you sign in with. We send a one-time link to choose a new password.</AuthHeading>
            <form className="flex flex-col gap-4" onSubmit={requestReset} noValidate>
              <div className="space-y-1.5">
                <label htmlFor="partner-reset-email" className={authLabel}>Email</label>
                <AuthInput id="partner-reset-email" type="email" inputMode="email" autoComplete="username" autoFocus value={resetEmail} onChange={(event) => { setResetEmail(event.target.value); setResetError(null); }} />
              </div>
              {resetError && <AuthAlert>{resetError}</AuthAlert>}
              <Button type="submit" className="mt-1 h-11 w-full" disabled={resetState === "sending"}>{resetState === "sending" ? "Sending…" : "Send the reset link"}</Button>
            </form>
          </>
        )}
        <div className="mt-[22px]">
          <LinkArrow asChild><button type="button" onClick={() => setResetting(false)}>Back to sign in</button></LinkArrow>
        </div>
      </PartnerAuthFrame>
    );
  }

  return (
    <PartnerAuthFrame animated>
      <AuthHeading title="Partner sign in">Submit leads and follow every one to its outcome.</AuthHeading>

      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <label htmlFor="partner-email" className={authLabel}>Email</label>
          <AuthInput
            ref={emailRef}
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
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="partner-password" className={authLabel}>Password</label>
            <button type="button" onClick={() => { setResetEmail(email); setResetState("idle"); setResetError(null); setResetting(true); }} className="text-sm font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <AuthInput
              ref={passwordRef}
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
              className="portal-auth-visibility"
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

        <label htmlFor="partner-remember" className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
          <input id="partner-remember" type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-5 shrink-0 accent-[var(--accent-ink)]" />
          Keep me signed in on this device
        </label>

        {error && (
          <AuthAlert id="partner-login-error">{error}</AuthAlert>
        )}

        <Button type="submit" className="mt-1 h-11 w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-sm leading-normal text-muted-foreground">
        Invited by an agency? Use the link in your invitation email to choose your password.
      </p>
      <p className="mt-3 text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
        An agent or agency?{" "}
        <Link href="/app/login" className="font-semibold text-foreground">Use the agent sign in instead</Link>.
      </p>
    </PartnerAuthFrame>
  );
}
