"use client";

/**
 * My profile › Signing in (LA-8.2, Notion sprint; redesign 2026-10-27, layout B): the sign-in email,
 * the password, two-step sign-in (two-factor) and every device signed in — one card of rows, each
 * part under ./security/. The sign-in history moved to the History tab (owner, 2026-10-27); a line
 * at the bottom of the card points there.
 *
 * Every call is the signed-in person's own; nothing here can touch anyone else's account. This file
 * reads the two statuses and hands them to the rows.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { TwoStepFacts } from "@/lib/users/profileStatus";

import { RowCard } from "@/components/app/profile/row";
import { PasswordChange } from "@/components/app/profile/security/password";
import { Sessions } from "@/components/app/profile/security/sessions";
import { call, type Session, type TwoFactor } from "@/components/app/profile/security/shared";
import { SignInEmail } from "@/components/app/profile/security/sign-in-email";
import { TwoFactorSection } from "@/components/app/profile/security/two-factor";

export function SecuritySettings({ email, timeZone, promptTwoFactor, onTwoFactor, emailAsks = 0, onChanged, onShowHistory }: {
  email: string;
  timeZone: string | null;
  promptTwoFactor: boolean;
  /** How many times About you's "Change" on the email row asked for the email form: each ask opens it. */
  emailAsks?: number;
  /** My profile's tab status: told each time the two-factor status is read, so turning it on shows at once. */
  onTwoFactor?: (facts: TwoStepFacts) => void;
  /** Something here changed (a password, two-step sign-in, a device signed out): History reads its log again. */
  onChanged?: () => void;
  onShowHistory: () => void;
}) {
  const reportTwoFactor = useRef(onTwoFactor);
  const reportChange = useRef(onChanged);
  useEffect(() => { reportTwoFactor.current = onTwoFactor; reportChange.current = onChanged; }, [onTwoFactor, onChanged]);
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: timeZone ?? undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const [twoFactor, setTwoFactor] = useState<TwoFactor | null>(null);
  const [sessions, setSessions] = useState<Session[] | null | undefined>(undefined);

  // A failed read is said, with Retry, instead of a loader that never ends (redesign, 2026-10-24).
  const [loadFailed, setLoadFailed] = useState<{ twoFactor: boolean; sessions: boolean }>({ twoFactor: false, sessions: false });
  const [twoFactorUnavailable, setTwoFactorUnavailable] = useState(false);

  const [reloads, setReloads] = useState(0);
  // A read after a change made here (the sign-in history records it), not after Retry.
  const changed = useRef(false);
  const load = useCallback(() => { changed.current = true; setReloads((n) => n + 1); }, []);
  useEffect(() => {
    let live = true;
    if (changed.current) { changed.current = false; reportChange.current?.(); }
    void Promise.all([
      call<TwoFactor>("/api/app/profile/two-factor"),
      call<{ sessions: Session[] | null }>("/api/app/profile/sessions"),
    ]).then(([tf, ss]) => {
      if (!live) return;
      if (tf.ok) setTwoFactor(tf.data);
      if (tf.ok) reportTwoFactor.current?.({ enabled: tf.data.enabled, required: tf.data.required });
      else if (tf.status === 503) reportTwoFactor.current?.("unavailable");
      setSessions(ss.ok ? ss.data.sessions : null);
      setLoadFailed({ twoFactor: !tf.ok, sessions: !ss.ok });
      setTwoFactorUnavailable(!tf.ok && tf.status === 503);
    });
    return () => { live = false; };
  }, [reloads]);
  const retry = () => {
    setLoadFailed({ twoFactor: false, sessions: false });
    setSessions(undefined);
    setReloads((n) => n + 1);
  };

  return (
    <div id="security" className="scroll-mt-24">
      <RowCard id="security-heading" title="Signing in" sub="How you get into your account, and where you're signed in right now.">
        <SignInEmail email={email} onChanged={load} asks={emailAsks} />
        <PasswordChange onChanged={load} />
        <TwoFactorSection email={email} twoFactor={twoFactor} unavailable={twoFactorUnavailable} failed={loadFailed.twoFactor} onRetry={retry} onChanged={load} promptTwoFactor={promptTwoFactor} when={when} />
        <Sessions sessions={sessions} failed={loadFailed.sessions} onRetry={retry} onChanged={load} when={when} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-2.5">
          <p className="m-0 text-sm text-[var(--muted)]">Your sign-ins and security changes are under History.</p>
          <Button type="button" variant="ghost" onClick={onShowHistory}>See sign-in history</Button>
        </div>
      </RowCard>
    </div>
  );
}
