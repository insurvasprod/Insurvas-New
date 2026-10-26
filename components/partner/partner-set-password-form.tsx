"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { AuthFact } from "@/components/app/auth-card";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { NewPasswordField, passwordLongEnough } from "@/components/app/password-field";
import { isPartnerRole, partnerRoleLabel, type PartnerRole } from "@/lib/partnerAuth/roles";

type TokenState =
  | { status: "checking" }
  | { status: "valid"; purpose: "invite" | "password_reset"; email: string; name: string; partnerName: string; role: PartnerRole | null; expiresAt: string }
  | { status: "invalid" }
  | { status: "unreachable" };

function formatExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * A partner choosing a password: the first one, from the agency's invitation, or a new one, from
 * "Forgot password?" (2026-10-24). The same field and rule as every other door (one rule: 12+
 * characters), and the partner is signed straight in afterwards rather than sent to sign in again.
 * The logo, the legal links and the brand panel come from PartnerAuthFrame (app/partner/set-password).
 */
export function PartnerSetPasswordForm({
  endpoint = "/api/partner/auth/set-password",
  loginPath = "/partner/login",
}: { endpoint?: string; loginPath?: string } = {}) {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [tokenState, setTokenState] = useState<TokenState>(token ? { status: "checking" } : { status: "invalid" });
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState("");
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
          purpose: body.purpose === "password_reset" ? "password_reset" : "invite",
          email: body.email,
          name: body.name,
          partnerName: body.partnerName ?? "your partner organization",
          role: typeof body.role === "string" && isPartnerRole(body.role) ? body.role : null,
          expiresAt: body.expiresAt ?? "",
        } : { status: "invalid" });
      })
      // A dropped connection is not an expired link: say so, and offer to check again.
      .catch(() => !cancelled && setTokenState({ status: "unreachable" }));
    return () => { cancelled = true; };
  }, [endpoint, token, attempt]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!passwordLongEnough(password)) { setError("Use at least 12 characters."); return; }
    setLoading(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not set password"); return; }
      setDone(true);
      // Straight in with the password just chosen, through the partner sign-in and its checks.
      const email = tokenState.status === "valid" ? tokenState.email : "";
      const signIn = await fetch("/api/partner/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, remember: true }) }).catch(() => null);
      const signedIn = signIn?.ok ? await signIn.json().catch(() => null) : null;
      if (signedIn) { router.replace(signedIn.redirectTo ?? "/partner"); return; }
      window.setTimeout(() => router.push(loginPath), 1200);
    } catch {
      setError("Could not set password. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (tokenState.status === "checking") {
    return <p className="text-sm text-muted-foreground" role="status">Checking your link…</p>;
  }

  if (tokenState.status === "unreachable") {
    return (
      <div>
        <FunnelHeading title="We could not check your link">Insurvas could not be reached. Your link has not been used.</FunnelHeading>
        <Button type="button" className="h-12 w-full" onClick={() => { setTokenState({ status: "checking" }); setAttempt((value) => value + 1); }}>Try again</Button>
      </div>
    );
  }

  if (tokenState.status === "invalid") {
    return (
      <div>
        <FunnelHeading title="This link no longer works">It has expired or was already used. A link works once.</FunnelHeading>
        <Button asChild className="h-12 w-full"><Link href={loginPath}>Go to partner sign in</Link></Button>
        <p className="mt-4 text-sm text-muted-foreground">Invited by an agency? Ask your partner administrator for a new invitation. Resetting your password? Ask for a new link from sign in.</p>
      </div>
    );
  }

  if (done) {
    return <FunnelHeading title="Password set">Signing you in…</FunnelHeading>;
  }

  const invite = tokenState.purpose === "invite";
  return (
    <div>
      <FunnelHeading title={invite ? "Choose your password" : "Choose a new password"}>
        {invite ? `Then you’re in ${tokenState.partnerName}’s partner workspace.` : `For ${tokenState.email}. Every other signed-in device will be signed out.`}
      </FunnelHeading>
      <div className="mb-6 grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg bg-[var(--surface-alt)] p-4 sm:grid-cols-3">
        <AuthFact label="Organization" value={tokenState.partnerName} />
        <AuthFact label="Role" value={tokenState.role ? partnerRoleLabel(tokenState.role) : "—"} />
        <AuthFact label="Link expires" value={tokenState.expiresAt ? formatExpiry(tokenState.expiresAt) : "—"} />
      </div>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {/* The account the password is for, so a password manager files it under the right login. */}
        <input type="email" name="username" autoComplete="username" value={tokenState.email} readOnly hidden />
        <NewPasswordField id="partner-new-password" label="New password" autoFocus value={password} onChange={(next) => { setPassword(next); setError(null); }} inputClassName="h-11 border-[var(--border-strong)] bg-card px-3 text-base" />
        {error && <p role="alert" className="rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]">{error}</p>}
        <Button type="submit" className="mt-2 h-12 w-full" disabled={loading || !passwordLongEnough(password)}>{loading ? "Saving…" : "Set password and sign in"}</Button>
      </form>
      <p className="mt-5 text-sm"><Link href={loginPath} className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">Back to partner sign in</Link></p>
    </div>
  );
}
