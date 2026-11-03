"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AuthFact } from "@/components/app/auth-card";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { AuthInput, authLabel } from "@/components/portal/auth-controls";
import { isPartnerRole, partnerRoleLabel, type PartnerRole } from "@/lib/partnerAuth/roles";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";

type TokenState =
  | { status: "checking" }
  | { status: "valid"; email: string; name: string; partnerName: string; invitedBy: string; role: PartnerRole | null; expiresAt: string }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "unreachable" };

/**
 * An existing Insurvas account accepting a partner's invitation: confirm with the current password,
 * and the extra membership is added. Laid out like the other doors since the redesign (2026-10-24).
 * Opening the page with no link says where the link is, rather than calling a link that was never
 * there "no longer valid", and a dropped connection is told apart from an expired link.
 */
export function AcceptPartnerInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [tokenState, setTokenState] = useState<TokenState>(token ? { status: "checking" } : { status: "missing" });
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`/api/partner/auth/accept-invite?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled) setTokenState(body?.valid ? { status: "valid", email: body.email, name: body.name, partnerName: body.partnerName, invitedBy: body.invitedBy ?? "Your partner admin", role: typeof body.role === "string" && isPartnerRole(body.role) ? body.role : null, expiresAt: body.expiresAt } : { status: "invalid" }); })
      .catch(() => { if (!cancelled) setTokenState({ status: "unreachable" }); });
    return () => { cancelled = true; };
  }, [token, attempt]);

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
      router.replace(body?.redirectTo ?? "/partner");
    } catch {
      setError("Could not accept this invitation. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (tokenState.status === "checking") return <p className="text-sm text-muted-foreground" role="status">Checking your invitation…</p>;

  if (tokenState.status === "missing") {
    return (
      <div>
        <FunnelHeading title="Open your invitation">This page needs the link from the invitation email an agency sent you. Open that email and press its button.</FunnelHeading>
        <Button asChild variant="outline" className="h-11 w-full border-[var(--border-strong)]"><Link href="/partner/login">Go to partner sign in</Link></Button>
      </div>
    );
  }

  if (tokenState.status === "unreachable") {
    return (
      <div>
        <FunnelHeading title="We could not check your invitation">Insurvas could not be reached. Your invitation has not been used.</FunnelHeading>
        <Button type="button" className="h-11 w-full" onClick={() => { setTokenState({ status: "checking" }); setAttempt((value) => value + 1); }}>Try again</Button>
      </div>
    );
  }

  if (tokenState.status === "invalid") {
    return (
      <div>
        <FunnelHeading title="This invitation no longer works">It has expired or was already used. Ask your partner administrator to send a new one.</FunnelHeading>
        <Button asChild variant="outline" className="h-11 w-full border-[var(--border-strong)]"><Link href="/partner/login">Go to partner sign in</Link></Button>
      </div>
    );
  }

  if (done) return <FunnelHeading title="Access accepted">Opening the partner portal…</FunnelHeading>;

  return (
    <div>
      <FunnelHeading title={`Join ${tokenState.partnerName}`}>You already have an Insurvas account. Confirm with your current password to add this partner access.</FunnelHeading>
      <div className="mb-6 grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg bg-[var(--surface-alt)] p-4 sm:grid-cols-2">
        <AuthFact label="Role" value={tokenState.role ? partnerRoleLabel(tokenState.role) : "—"} />
        <AuthFact label="Invited by" value={tokenState.invitedBy} />
        <AuthFact label="Account" value={tokenState.email} />
        <AuthFact label="Invite expires" value={dateTime(tokenState.expiresAt, viewerTimeZone())} />
      </div>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <input type="email" name="username" autoComplete="username" value={tokenState.email} readOnly hidden />
        <div className="space-y-1.5">
          <label htmlFor="existing-password" className={authLabel}>Current password</label>
          <div className="relative">
            <AuthInput id="existing-password" type={showPassword ? "text" : "password"} autoComplete="current-password" autoFocus required value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(null); }} className="pr-11" aria-describedby={error ? "invite-password-error" : undefined} />
            <button type="button" className="portal-auth-visibility" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}</button>
          </div>
          {error && <p id="invite-password-error" className="text-sm text-[var(--error-ink)]" role="alert">{error}</p>}
        </div>
        <label htmlFor="invite-remember" className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
          <input id="invite-remember" type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-5 shrink-0 accent-[var(--accent-ink)]" />
          Keep me signed in on this device
        </label>
        <Button type="submit" className="mt-1 h-11 w-full" disabled={loading}>{loading ? "Accepting…" : "Accept and open the portal"}</Button>
      </form>
      <p className="mt-5 text-sm text-muted-foreground">Access covers only {tokenState.partnerName}’s leads and messages. <Link href="/partner/login" className="font-semibold text-[var(--accent-ink)] hover:underline">Use a different account</Link></p>
    </div>
  );
}
