"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, CircleCheck, Eye, EyeOff, LockKeyhole, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isPartnerRole, partnerRoleLabel, type PartnerRole } from "@/lib/partnerAuth/roles";

type TokenState =
  | { status: "checking" }
  | { status: "valid"; email: string; name: string; partnerName: string; role: PartnerRole | null; expiresAt: string }
  | { status: "invalid" };

const requirements = [
  { label: "At least 12 characters", test: (value: string) => value.length >= 12 },
  { label: "One uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "One lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { label: "One number", test: (value: string) => /\d/.test(value) },
  { label: "One symbol", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

function formatExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invitation expiry unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PartnerSetPasswordForm({
  endpoint = "/api/partner/auth/set-password",
  loginPath = "/partner/login",
}: { endpoint?: string; loginPath?: string } = {}) {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [tokenState, setTokenState] = useState<TokenState>(token ? { status: "checking" } : { status: "invalid" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${endpoint}?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled) return;
        setTokenState(body?.valid ? {
          status: "valid",
          email: body.email,
          name: body.name,
          partnerName: body.partnerName ?? "your partner organization",
          role: typeof body.role === "string" && isPartnerRole(body.role) ? body.role : null,
          expiresAt: body.expiresAt ?? "",
        } : { status: "invalid" });
      })
      .catch(() => !cancelled && setTokenState({ status: "invalid" }));
    return () => { cancelled = true; };
  }, [endpoint, token]);

  const requirementState = useMemo(() => requirements.map((requirement) => ({ ...requirement, met: requirement.test(password) })), [password]);
  const strength = requirementState.filter((requirement) => requirement.met).length;
  const strengthLabel = strength >= 5 ? "Strong" : strength >= 3 ? "Getting there" : password ? "Needs work" : "Not started";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 12) { setError("Password must be at least 12 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not set password"); return; }
      setDone(true);
      window.setTimeout(() => router.push(loginPath), 1800);
    } catch {
      setError("Could not set password. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return <div className="portal-partner portal-partner-set-password-page">
    <header className="portal-partner-auth-header">
      <Link href={loginPath} className="portal-partner-auth-brand inline-flex items-center gap-2.5" aria-label="Insurvas partner portal"><span aria-hidden="true" className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]">I</span><span className="text-sm font-semibold tracking-[-0.01em] text-foreground">Insurvas partners</span></Link>
      <nav aria-label="Partner setup links"><Link href={loginPath}>Partner portal</Link><a href="mailto:support@insurvas.com">Help</a></nav>
    </header>
    <main className="portal-partner-set-password-main">
      {tokenState.status === "checking" && <Card className="portal-partner-set-password-card"><CardContent className="portal-set-password-status"><span className="portal-set-password-spinner" aria-hidden="true" /><p>Checking your secure invitation…</p><span>We’ll confirm the link before you create a password.</span></CardContent></Card>}
      {tokenState.status === "invalid" && <Card className="portal-partner-set-password-card"><CardHeader className="portal-set-password-status"><span className="portal-set-password-status-icon portal-set-password-status-icon-danger"><TriangleAlert className="size-5" aria-hidden="true" /></span><CardTitle role="heading" aria-level={1}>Link no longer valid</CardTitle><CardDescription>This invitation has expired or has already been used. Ask your partner administrator to send a new one.</CardDescription></CardHeader><CardContent><Button asChild className="w-full"><Link href={loginPath}>Return to partner sign in</Link></Button></CardContent></Card>}
      {tokenState.status === "valid" && !done && <Card className="portal-partner-set-password-card">
        <CardHeader className="portal-set-password-heading"><p className="portal-partner-auth-eyebrow">Secure account setup</p><CardTitle role="heading" aria-level={1}>Choose your password</CardTitle><CardDescription>After setup, you&rsquo;ll enter {tokenState.partnerName}&rsquo;s isolated partner workspace.</CardDescription></CardHeader>
        <CardContent>
          <dl className="portal-set-password-meta"><div><dt>Organization</dt><dd>{tokenState.partnerName}</dd></div><div><dt>Role</dt><dd>{tokenState.role ? partnerRoleLabel(tokenState.role) : "—"}</dd></div><div><dt>Invite expires</dt><dd>{tokenState.expiresAt ? formatExpiry(tokenState.expiresAt) : "See your invitation email"}</dd></div></dl>
          <form className="portal-set-password-form" onSubmit={handleSubmit} noValidate>
            {/* The account the password is for, so a password manager files it under the right login. */}
            <input type="email" name="username" autoComplete="username" value={tokenState.email} readOnly hidden />
            <div className="space-y-1.5"><Label htmlFor="partner-new-password">New password</Label><div className="relative"><Input id="partner-new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} required aria-invalid={Boolean(error)} value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} className="pr-11" /><button type="button" className="portal-set-password-visibility" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide new password" : "Show new password"} aria-pressed={showPassword}>{showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button></div></div>
            <div className="space-y-1.5"><Label htmlFor="partner-confirm-password">Confirm password</Label><div className="relative"><Input id="partner-confirm-password" type={showConfirm ? "text" : "password"} autoComplete="new-password" minLength={12} required aria-invalid={Boolean(error && confirm)} value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(null); }} className="pr-11" /><button type="button" className="portal-set-password-visibility" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={showConfirm}>{showConfirm ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button></div></div>
            <section className="portal-set-password-requirements" aria-label="Password requirements"><div className="portal-set-password-requirements-header"><div><h2>Password requirements</h2><p>Use a unique password for this partner workspace.</p></div><div className="portal-set-password-strength" data-strength={strength} aria-label={`Password strength: ${strengthLabel}`}><span className="portal-set-password-strength-bars" aria-hidden="true">{[0, 1, 2, 3].map((bar) => <i key={bar} className={strength >= bar + 2 ? "is-filled" : ""} />)}</span><strong>{strengthLabel}</strong></div></div><ul>{requirementState.map((requirement) => <li key={requirement.label} data-met={requirement.met}><span aria-hidden="true">{requirement.met ? <Check className="size-3" /> : ""}</span>{requirement.label}</li>)}</ul></section>
            {error && <p className="portal-set-password-error" role="alert">{error}</p>}
            <Button type="submit" className="portal-set-password-submit" disabled={loading}>{loading ? "Setting password…" : "Set password & continue"}</Button>
          </form>
          <div className="portal-set-password-return"><Link href={loginPath}>Return to partner sign in</Link></div>
          <div className="portal-set-password-boundary"><LockKeyhole className="size-4 shrink-0" aria-hidden="true" /><p>This invitation is single-use. After setup, you’ll enter your isolated partner workspace.</p></div>
        </CardContent>
      </Card>}
      {tokenState.status === "valid" && done && <Card className="portal-partner-set-password-card"><CardHeader className="portal-set-password-status"><span className="portal-set-password-status-icon portal-set-password-status-icon-success"><CircleCheck className="size-5" aria-hidden="true" /></span><CardTitle role="heading" aria-level={1}>Password set</CardTitle><CardDescription>Your partner account is ready. Taking you to sign in…</CardDescription></CardHeader></Card>}
    </main>
    <footer className="portal-partner-auth-footer"><Link href="/legal/privacy">Privacy</Link><Link href="/legal/tos">Terms</Link><a href="mailto:support@insurvas.com">Support</a></footer>
  </div>;
}
