"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";

import { AuthCard, AuthFact, authControl, authLabel } from "@/components/app/auth-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";

type TokenState =
  | { status: "checking" }
  | { status: "valid"; email: string; name: string; purpose: "invite" | "password_reset"; expiresAt: string | null; organization: string | null; role: string | null }
  | { status: "invalid" };

/**
 * The four rules the board lists. The server's floor is 12 characters (setPasswordSchema); the
 * other three are this page's, and the button waits for all four so the list is a gate rather than
 * advice. An unmet rule is an outline circle, never red: the reader has not done anything wrong yet.
 */
const RULES = [
  { label: "At least 12 characters", test: (value: string) => value.length >= 12 },
  { label: "One uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { label: "One number", test: (value: string) => /\d/.test(value) },
  { label: "One symbol", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

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
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Check the link up front so an expired invite says so before anyone types a password.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${endpoint}?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setTokenState(body?.valid
          ? { status: "valid", email: body.email, name: body.name, purpose: body.purpose === "password_reset" ? "password_reset" : "invite", expiresAt: body.expiresAt ?? null, organization: body.organization ?? null, role: body.role ?? null }
          : { status: "invalid" });
      })
      .catch(() => !cancelled && setTokenState({ status: "invalid" }));
    return () => { cancelled = true; };
  }, [endpoint, token]);

  const rules = useMemo(() => RULES.map((rule) => ({ ...rule, met: rule.test(password) })), [password]);
  const met = rules.filter((rule) => rule.met).length;
  const matches = confirm.length > 0 && confirm === password;
  const ready = met === RULES.length && matches;

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
      setTimeout(() => router.push(loginPath), 1800);
    } catch {
      setError("Could not set your password. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (tokenState.status === "checking") {
    return <AuthCard width={640}><p className="text-center text-sm text-muted-foreground" role="status">Checking your link…</p></AuthCard>;
  }

  if (tokenState.status === "invalid") {
    return (
      <AuthCard width={640} title="This link no longer works" description="It has expired or has already been used. A link works once.">
        <p className="mt-6 text-center text-sm text-[var(--body)]">Invited to a workspace? Ask whoever invited you to send a new invitation. Resetting a password? Request a new link from sign in.</p>
        <Button asChild className="mt-6 h-11 w-full"><Link href={loginPath}>Back to sign in</Link></Button>
      </AuthCard>
    );
  }

  if (done) {
    return <AuthCard width={640} title="Password set" description="Taking you to sign in…" />;
  }

  const invite = tokenState.purpose === "invite";
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
        <label className="block">
          <span className={authLabel}>New password</span>
          <input type="password" autoComplete="new-password" className={authControl} value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} />
        </label>
        <label className="block">
          <span className={authLabel}>Confirm password</span>
          <input type="password" autoComplete="new-password" className={authControl} value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(null); }} />
          <span className="mt-1.5 block text-xs text-muted-foreground" aria-live="polite">{confirm ? (matches ? "Matches." : "Does not match yet.") : " "}</span>
        </label>

        <section className="rounded-lg bg-[var(--surface-alt)] p-4" aria-label="Password requirements">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">Requirements</span>
            <span className="flex w-[110px] gap-1" role="img" aria-label={`${met} of ${RULES.length} met`}>
              {RULES.map((rule, index) => <span key={rule.label} className={cn("h-[5px] flex-1 rounded-full", index < met ? "bg-[var(--success)]" : "bg-[var(--border)]")} />)}
            </span>
          </div>
          <ul className="mt-1">
            {rules.map((rule) => (
              <li key={rule.label} className="flex items-center gap-2.5 py-1.5">
                <span className={cn("inline-flex size-[18px] shrink-0 items-center justify-center rounded-full", rule.met ? "bg-[var(--success)] text-white" : "border-[1.5px] border-[var(--border-strong)]")} aria-hidden="true">
                  {rule.met && <Check className="size-3 stroke-[3]" />}
                </span>
                <span className={cn("text-sm", rule.met ? "text-[var(--body)]" : "text-muted-foreground")}>{rule.label}<span className="sr-only">{rule.met ? " — met" : " — not yet"}</span></span>
              </li>
            ))}
          </ul>
        </section>

        {error && <p role="alert" className="rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3 text-sm text-[var(--error-ink)]">{error}</p>}
        <Button type="submit" className="mt-2 h-11 w-full" disabled={!ready || loading}>{loading ? "Saving…" : "Set password & continue"}</Button>
      </form>
    </AuthCard>
  );
}
