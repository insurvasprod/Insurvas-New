"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthCard, AuthFact } from "@/components/app/auth-card";
import { NewPasswordField, passwordLongEnough } from "@/components/app/password-field";
import { Button } from "@/components/ui/button";
import { AuthAlert } from "@/components/portal/auth-controls";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";

type TokenState =
  | { status: "checking" }
  | { status: "valid"; email: string; name: string; purpose: "invite" | "password_reset"; expiresAt: string | null; organization: string | null; role: string | null; hasAccount?: boolean }
  | { status: "invalid" }
  | { status: "unreachable" };

function expiry(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime(date, viewerTimeZone()); // the token is read in an effect, after mount
}

export function SetPasswordForm({
  endpoint = "/api/app/auth/set-password",
  loginPath = "/app/login",
}: { endpoint?: string; loginPath?: string } = {}) {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  // A missing token is knowable at first render, so it's the initial state rather than
  // something an effect corrects afterwards.
  const [tokenState, setTokenState] = useState<TokenState>(token ? { status: "checking" } : { status: "invalid" });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  // Bumped by "Try again" after the link could not be checked at all (a dropped connection is not an expired link).
  const [attempt, setAttempt] = useState(0);

  // Check the link up front so an expired invite says so before anyone types a password.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${endpoint}?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setTokenState(body?.valid
          ? { status: "valid", email: body.email, name: body.name, purpose: body.purpose === "password_reset" ? "password_reset" : "invite", expiresAt: body.expiresAt ?? null, organization: body.organization ?? null, role: body.role ?? null, hasAccount: body.hasAccount === true }
          : { status: "invalid" });
      })
      .catch(() => !cancelled && setTokenState({ status: "unreachable" }));
    return () => { cancelled = true; };
  }, [endpoint, token, attempt]);

  // The server's one rule (setPasswordSchema), the same as sign-up's: length, not complexity.
  const ready = passwordLongEnough(password);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!ready) return;
    setLoading(true);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Something went wrong");
        return;
      }
      setDone(true);
      // Straight in with the password just chosen (redesign, 2026-10-24): the same sign-in route and
      // checks as the form, so nobody is sent back to type it again. Two-factor, a suspended agency or
      // anything else the sign-in refuses falls back to the sign-in page, which explains it.
      const email = tokenState.status === "valid" ? tokenState.email : "";
      const signIn = await fetch("/api/app/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, remember: true }) }).catch(() => null);
      const signedIn = signIn?.ok ? await signIn.json().catch(() => null) : null;
      if (signedIn?.redirectTo && !signedIn.twoFactor && loginPath === "/app/login") { router.replace(signedIn.redirectTo); return; }
      setTimeout(() => router.push(loginPath), 1200);
    } catch {
      setError("Could not set your password. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (tokenState.status === "checking") {
    return <AuthCard width={640}><p className="text-center text-sm text-muted-foreground" role="status">Checking your link…</p></AuthCard>;
  }

  if (tokenState.status === "unreachable") {
    return (
      <AuthCard width={640} title="We could not check your link" description="Insurvas could not be reached. Your link has not been used.">
        <Button type="button" className="mt-6 h-11 w-full" onClick={() => { setTokenState({ status: "checking" }); setAttempt((value) => value + 1); }}>Try again</Button>
      </AuthCard>
    );
  }

  if (tokenState.status === "invalid") {
    return (
      <AuthCard width={640} title="This link no longer works" description="It has expired or has already been used. A link works once.">
        <p className="mt-6 text-sm text-[var(--body)]">Invited to a workspace? Ask whoever invited you to send a new invitation. Resetting a password? Ask for a new link from sign in, or sign in with an emailed link instead.</p>
        <Button asChild className="mt-6 h-11 w-full"><Link href={loginPath}>Go to sign in</Link></Button>
      </AuthCard>
    );
  }

  if (done) {
    return <AuthCard width={640} title={tokenState.hasAccount ? "You've joined" : "Password set"} description={tokenState.hasAccount ? "Sign in with your usual password, then pick this workspace." : "Signing you in…"} />;
  }

  const invite = tokenState.purpose === "invite";

  // AG-0.6 · an existing Insurvas account joins a second agency without choosing a new password.
  if (invite && tokenState.hasAccount) {
    const accept = async () => {
      setError(null);
      setLoading(true);
      try {
        const res = await fetch("/api/app/auth/accept-invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        const body = await res.json().catch(() => null);
        if (!res.ok) { setError(body?.error ?? "Could not accept this invitation"); return; }
        setDone(true);
        setTimeout(() => router.push(loginPath), 2200);
      } catch {
        setError("Could not accept this invitation. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    };
    return (
      <AuthCard width={640} title={`Join ${tokenState.organization ?? "this workspace"}`} description={`You already have an Insurvas account as ${tokenState.email}. Your password stays the same.`}>
        <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg bg-[var(--surface-alt)] p-4 sm:grid-cols-3">
          <AuthFact label="Organization" value={tokenState.organization ?? "—"} />
          <AuthFact label="Role" value={tokenState.role ?? "—"} />
          <AuthFact label="Invitation expires" value={expiry(tokenState.expiresAt)} />
        </div>
        {error && <AuthAlert>{error}</AuthAlert>}
        <Button type="button" className="mt-6 h-11 w-full" disabled={loading} onClick={accept}>{loading ? "Joining…" : "Accept invitation"}</Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      width={640}
      title={invite ? "Choose your password" : "Choose a new password"}
      description={invite ? "You were invited to a workspace. This invitation can be used once." : `For ${tokenState.email}. This link can be used once.`}
    >
      <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg bg-[var(--surface-alt)] p-4 sm:grid-cols-3">
        {invite ? <AuthFact label="Organization" value={tokenState.organization ?? "—"} /> : <AuthFact label="Account" value={tokenState.email} />}
        {invite ? <AuthFact label="Role" value={tokenState.role ?? "—"} /> : <AuthFact label="Workspace" value={tokenState.organization ?? "—"} />}
        <AuthFact label={invite ? "Invitation expires" : "Link expires"} value={expiry(tokenState.expiresAt)} />
      </div>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {/* The account the password is for, so a password manager files it under the right name. */}
        <input type="email" name="username" autoComplete="username" value={tokenState.email} readOnly hidden />
        <NewPasswordField id="new-password" label="New password" autoFocus value={password} onChange={(next) => { setPassword(next); setError(null); }} inputClassName="h-11 border-[var(--border-strong)] bg-card px-3 text-base" />

        {error && <AuthAlert>{error}</AuthAlert>}
        <Button type="submit" className="mt-2 h-11 w-full" disabled={!ready || loading}>{loading ? "Saving…" : invite ? "Set password and open Insurvas" : "Set password and sign in"}</Button>
      </form>
    </AuthCard>
  );
}
