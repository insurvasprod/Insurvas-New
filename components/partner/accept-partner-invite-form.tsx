"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, Lock, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isPartnerRole, partnerRoleLabel, type PartnerRole } from "@/lib/partnerAuth/roles";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";

type TokenState = { status: "checking" } | { status: "valid"; email: string; name: string; partnerName: string; invitedBy: string; role: PartnerRole | null; expiresAt: string } | { status: "invalid" };

export function AcceptPartnerInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [tokenState, setTokenState] = useState<TokenState>(token ? { status: "checking" } : { status: "invalid" });
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`/api/partner/auth/accept-invite?token=${encodeURIComponent(token)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled) setTokenState(body?.valid ? { status: "valid", email: body.email, name: body.name, partnerName: body.partnerName, invitedBy: body.invitedBy ?? "Your partner admin", role: typeof body.role === "string" && isPartnerRole(body.role) ? body.role : null, expiresAt: body.expiresAt } : { status: "invalid" }); })
      .catch(() => { if (!cancelled) setTokenState({ status: "invalid" }); });
    return () => { cancelled = true; };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!password) { setError("Enter your current Insurvas password"); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/partner/auth/accept-invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, email: tokenState.status === "valid" ? tokenState.email : "", password, remember }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not accept this invitation"); return; }
      setDone(true);
      window.setTimeout(() => router.push(body?.redirectTo ?? "/partner"), 1200);
    } catch {
      setError("Could not accept this invitation. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (tokenState.status === "checking") return <Card className="portal-partner-invite-card w-full max-w-[640px]"><CardContent className="py-12 text-center" role="status" aria-live="polite"><div className="portal-auth-spinner mx-auto mb-4" aria-hidden="true" /><p className="font-semibold">Checking your invitation…</p><p className="mt-1 text-sm text-muted-foreground">Verifying the secure invitation link.</p></CardContent></Card>;
  if (tokenState.status === "invalid") return <Card className="portal-partner-invite-card w-full max-w-[640px]"><CardHeader><div className="portal-partner-auth-eyebrow">Partner invitation</div><div className="portal-partner-auth-icon portal-partner-auth-icon-error"><TriangleAlert className="size-5" aria-hidden="true" /></div><CardTitle role="heading" aria-level={1}>Link no longer valid</CardTitle><CardDescription>This invitation has expired, been used, or is not available for an existing Insurvas account.</CardDescription></CardHeader><CardContent><Button asChild variant="outline" className="w-full"><a href="/partner/login">Go to partner sign in</a></Button></CardContent></Card>;
  if (done) return <Card className="portal-partner-invite-card w-full max-w-[640px]"><CardHeader><div className="portal-partner-auth-eyebrow">Partner invitation</div><div className="portal-partner-auth-icon portal-partner-auth-icon-success"><CheckCircle2 className="size-5" aria-hidden="true" /></div><CardTitle role="heading" aria-level={1}>Access accepted</CardTitle><CardDescription>Your account is ready. Taking you to the partner portal…</CardDescription></CardHeader></Card>;

  return <Card className="portal-partner-invite-card w-full max-w-[640px]"><CardHeader><div className="portal-partner-auth-eyebrow">Partner invitation</div><CardTitle role="heading" aria-level={1}>Accept partner access</CardTitle><CardDescription>You already have an Insurvas account. Confirm with your current password that you want this extra membership.</CardDescription></CardHeader><CardContent><div className="portal-partner-invite-summary"><dl><div><dt>Organization</dt><dd>{tokenState.partnerName}</dd></div><div><dt>Role</dt><dd>{tokenState.role ? partnerRoleLabel(tokenState.role) : "—"}</dd></div><div><dt>Invited by</dt><dd>{tokenState.invitedBy}</dd></div><div><dt>Invite expires</dt><dd>{dateTime(tokenState.expiresAt, viewerTimeZone())}</dd></div></dl></div><form className="mt-6 space-y-4" onSubmit={submit} noValidate><div className="space-y-1.5"><Label htmlFor="existing-email">Email</Label><div className="relative"><Lock className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="existing-email" type="email" autoComplete="username" value={tokenState.email} readOnly aria-readonly="true" aria-describedby="existing-email-help" className="portal-partner-invite-bound pl-9" /></div><p id="existing-email-help" className="text-xs text-muted-foreground">The invitation is bound to this address and cannot be changed.</p></div><div className="space-y-1.5"><Label htmlFor="existing-password">Current password</Label><div className="relative"><Input id="existing-password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(null); }} className="pr-11" aria-describedby={error ? "invite-password-error" : undefined} /><button type="button" className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button></div>{error && <p id="invite-password-error" className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}</div><label htmlFor="invite-remember" className="portal-remember-me"><input id="invite-remember" type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Keep me signed in on this device</label><Button type="submit" className="w-full" disabled={loading}>{loading ? "Accepting access…" : "Accept partner access"}</Button></form><div className="portal-partner-auth-note"><Lock className="size-3.5 shrink-0" aria-hidden="true" /><p>This one-time invitation grants access only to <strong>{tokenState.partnerName}</strong> leads and messages. It cannot be forwarded.</p></div><div className="portal-partner-auth-secondary"><a href="/partner/login">Sign in with a different account</a></div></CardContent></Card>;
}
