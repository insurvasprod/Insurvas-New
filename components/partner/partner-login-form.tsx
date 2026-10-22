"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkArrow } from "@/components/ui/link-arrow";
import { PartnerAuthFrame } from "@/components/partner/partner-auth-frame";

const validEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());

/**
 * The partner sign-in, in the shared partner frame (PartnerAuthFrame: logo, legal links, and the brand
 * panel saying what a partner can and cannot see). Compact (2026-10-13): it fits one screen, with the
 * invitation pointer as one line rather than a card.
 */
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
    <PartnerAuthFrame>
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">
        Partner access
      </div>
      <h1 className="mt-2 text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        Sign in to your workspace
      </h1>
      <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
        Submit leads and follow every one to its outcome.
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

      <p className="mt-6 text-sm text-muted-foreground">
        Invited by an agency?{" "}
        <Link href="/partner/accept-invite" className="font-semibold text-[var(--accent-ink)]">Open your invitation</Link> from the email first.
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <LinkArrow href="mailto:support@insurvas.com?subject=Partner%20password%20help">Forgot password</LinkArrow>
        <LinkArrow asChild>
          <Link href="/app/login">Agent sign in</Link>
        </LinkArrow>
      </div>
    </PartnerAuthFrame>
  );
}
