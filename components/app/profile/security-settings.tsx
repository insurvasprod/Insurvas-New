"use client";

/**
 * My profile › Sign-in and security (LA-8.2, Notion sprint): the sign-in email, the password,
 * two-factor authentication, every live session, and the account's own security log.
 *
 * Every call is the signed-in person's own; nothing here can touch anyone else's account.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import { PASSWORD_MIN } from "@/lib/tenantAuth/securityRules";

type TwoFactor = { enabled: boolean; enabledAt: string | null; pending: boolean; recoveryCodesLeft: number; required: boolean; sessionVerified: boolean };
type Session = { id: string; tenantName: string; createdAt: string; lastSeenAt: string; ip: string | null; location: string | null; device: string; current: boolean; twoFactor: boolean };
type SecurityEvent = { id: string; type: string; label: string; at: string; ip: string | null };

function Section({ id, title, sub, children, sectionRef }: { id: string; title: string; sub?: ReactNode; children: ReactNode; sectionRef?: Ref<HTMLElement> }) {
  return (
    <section ref={sectionRef} aria-labelledby={id} className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <header className="border-b border-[var(--border)] px-5 py-4">
        <h2 id={id} className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        {sub ? <p className="mt-0.5 text-sm text-[var(--muted)]">{sub}</p> : null}
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
    </section>
  );
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
    const body = await response.json().catch(() => null);
    return response.ok ? { ok: true, data: body as T } : { ok: false, error: body?.error ?? "That did not work. Nothing changed.", status: response.status };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection.", status: 0 };
  }
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

const TWO_FACTOR_UNAVAILABLE = "Two-factor is not available yet. Contact support.";

/** A read that failed: said plainly, with a way to try again (redesign, 2026-10-24). */
function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-[var(--error-ink)]">
      <span>Could not load {what}.</span>
      <Button type="button" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function SecuritySettings({ email, timeZone, promptTwoFactor }: { email: string; timeZone: string | null; promptTwoFactor: boolean }) {
  const router = useRouter();
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: timeZone ?? undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // ── sign-in email ──────────────────────────────────────────────────────────────────────────────
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // ── password ───────────────────────────────────────────────────────────────────────────────────
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // ── two-factor ─────────────────────────────────────────────────────────────────────────────────
  const [twoFactor, setTwoFactor] = useState<TwoFactor | null>(null);
  const [enrolment, setEnrolment] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [managing, setManaging] = useState<"disable" | "recovery_codes" | null>(null);

  // ── sessions and the log ───────────────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[] | null | undefined>(undefined);
  const [events, setEvents] = useState<SecurityEvent[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // A failed read is said, with Retry, instead of a loader that never ends (redesign, 2026-10-24).
  const [loadFailed, setLoadFailed] = useState<{ twoFactor: boolean; sessions: boolean; events: boolean }>({ twoFactor: false, sessions: false, events: false });
  const [twoFactorUnavailable, setTwoFactorUnavailable] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const twoFactorSection = useRef<HTMLElement>(null);
  const autoStarted = useRef(false);

  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    void Promise.all([
      call<TwoFactor>("/api/app/profile/two-factor"),
      call<{ sessions: Session[] | null }>("/api/app/profile/sessions"),
      call<{ events: SecurityEvent[] | null }>("/api/app/profile/security-events"),
    ]).then(([tf, ss, ev]) => {
      if (!live) return;
      if (tf.ok) setTwoFactor(tf.data);
      setSessions(ss.ok ? ss.data.sessions : null);
      setEvents(ev.ok ? ev.data.events : null);
      setLoadFailed({ twoFactor: !tf.ok, sessions: !ss.ok, events: !ev.ok });
      setTwoFactorUnavailable(!tf.ok && tf.status === 503);
    });
    return () => { live = false; };
  }, [reloads]);
  const retry = () => {
    setLoadFailed({ twoFactor: false, sessions: false, events: false });
    setSessions(undefined);
    setEvents(undefined);
    load();
  };

  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setEmailError(null);
    const result = await call<{ newEmail: string }>("/api/app/profile/email", post({ newEmail, currentPassword: emailPassword }));
    setBusy(false);
    if (!result.ok) { setEmailError(result.error); return; }
    setEmailSent(result.data.newEmail);
    setEmailOpen(false);
    setNewEmail("");
    setEmailPassword("");
    void load();
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (next.length < PASSWORD_MIN) { setPasswordError(`Use at least ${PASSWORD_MIN} characters.`); return; }
    if (next !== confirm) { setPasswordError("The new passwords do not match."); return; }
    setBusy(true);
    const result = await call<{ otherSessionsEnded: number }>("/api/app/profile/password", post({ current, next }));
    setBusy(false);
    if (!result.ok) { setPasswordError(result.error); return; }
    setCurrent(""); setNext(""); setConfirm("");
    notify.done(result.data.otherSessionsEnded ? `Password changed — ${result.data.otherSessionsEnded} other session${result.data.otherSessionsEnded === 1 ? "" : "s"} signed out` : "Password changed");
    void load();
  }

  async function twoFactorAction(body: Record<string, string>) {
    setBusy(true);
    setTwoFactorError(null);
    const result = await call<{ qr?: string; secret?: string; recoveryCodes?: string[] }>("/api/app/profile/two-factor", post(body));
    setBusy(false);
    // 503 is the server saying two-factor cannot run here yet (its table missing, or no key to seal
    // secrets with). That wording was for us, not the reader (redesign, 2026-10-24).
    if (!result.ok) { setTwoFactorError(result.status === 503 ? TWO_FACTOR_UNAVAILABLE : result.error); return null; }
    return result.data;
  }

  const startEnrolment = () =>
    void twoFactorAction({ action: "start" }).then((d) => { if (d?.qr && d.secret) { setEnrolment({ qr: d.qr, secret: d.secret }); setCode(""); } });

  // Sent here by sign-in with ?two_factor=required (the role needs it): go straight to the two-factor
  // section and start enrolment, once, instead of leaving the reader to find the button
  // (redesign, 2026-10-24). Not when it is already on or a QR code is already showing.
  useEffect(() => {
    if (!promptTwoFactor || autoStarted.current || !twoFactor || twoFactor.enabled || enrolment || codes) return;
    autoStarted.current = true;
    twoFactorSection.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    startEnrolment();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the status first arrives
  }, [promptTwoFactor, twoFactor]);

  const copyCodes = (list: string[]) => {
    setCopyFallback(false);
    const write = navigator.clipboard?.writeText(list.join("\n"));
    if (!write) { setCopyFallback(true); return; }
    void write.then(() => notify.done("Recovery codes copied"), () => setCopyFallback(true));
  };

  // The codes as a plain text file, made in the browser: nothing is sent anywhere to produce it.
  const downloadCodes = (list: string[]) => {
    const blob = new Blob([`Insurvas recovery codes for ${email}\nEach code signs you in once.\n\n${list.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "insurvas-recovery-codes.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  async function endSession(id: string | null) {
    setBusy(true);
    const result = await call<{ ended: number }>("/api/app/profile/sessions", post(id ? { action: "end", id } : { action: "end_others" }));
    setBusy(false);
    if (!result.ok) { notify.fail(result.error); return; }
    notify.done(id ? "Session ended" : result.data.ended ? `${result.data.ended} other session${result.data.ended === 1 ? "" : "s"} ended` : "No other sessions were open");
    void load();
  }

  const codesBlock = codes ? (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--border)] p-4">
      <p className="m-0 text-sm font-semibold text-[var(--ink)]">Save these recovery codes now. They will not be shown again.</p>
      <p className="m-0 text-sm text-[var(--muted)]">Each one signs you in once if your phone is not with you.</p>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-1 p-0 font-mono text-sm tabular-nums">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => copyCodes(codes)}>Copy</Button>
        <Button type="button" variant="outline" onClick={() => downloadCodes(codes)}>Download .txt</Button>
        <Button type="button" onClick={() => { setCodes(null); setCopyFallback(false); }}>I have saved them</Button>
      </div>
      {/* A refused or missing clipboard (an http page, a browser that says no) said nothing before. */}
      {copyFallback ? (
        <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">Could not copy. Download them as a file, or select the codes above and copy them yourself.</p>
      ) : null}
    </div>
  ) : null;

  return (
    <div id="security" className="flex max-w-[720px] scroll-mt-24 flex-col gap-6">
      <Section id="security-email" title="Sign-in email" sub="Changing it takes effect only when the new address confirms it. Both addresses are told.">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="font-semibold text-[var(--ink)]">{email}</span>
          {!emailOpen ? <Button type="button" variant="outline" onClick={() => { setEmailOpen(true); setEmailSent(null); }}>Change</Button> : null}
        </div>
        {emailSent ? <p className="m-0 text-sm text-[var(--body)]">Check {emailSent} for a link. Until it is used, you keep signing in with {email}.</p> : null}
        {emailOpen ? (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void changeEmail(event)}>
            <div className="flex flex-col gap-1.5"><Label htmlFor="security-new-email">New email</Label><Input id="security-new-email" type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="security-email-password">Current password</Label><Input id="security-email-password" type="password" autoComplete="current-password" required value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} /></div>
            {emailError ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)] sm:col-span-2">{emailError}</p> : null}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy || !newEmail.trim() || !emailPassword}>Send the confirmation link</Button>
              <Button type="button" variant="outline" onClick={() => { setEmailOpen(false); setEmailError(null); }}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </Section>

      <Section id="security-password" title="Password" sub={`At least ${PASSWORD_MIN} characters. Changing it signs out every other session.`}>
        <form className="grid gap-4 sm:grid-cols-3" onSubmit={(event) => void changePassword(event)}>
          <div className="flex flex-col gap-1.5"><Label htmlFor="security-current-password">Current password</Label><Input id="security-current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="security-new-password">New password</Label><Input id="security-new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="security-confirm-password">Repeat it</Label><Input id="security-confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          {passwordError ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)] sm:col-span-3">{passwordError}</p> : null}
          <div className="sm:col-span-3"><Button type="submit" disabled={busy || !current || !next}>Change password</Button></div>
        </form>
      </Section>

      <Section id="security-two-factor" sectionRef={twoFactorSection} title="Two-factor authentication" sub="A code from an authenticator app each time you sign in. Text messages are not offered.">
        {!twoFactor && twoFactorUnavailable ? (
          <p className="m-0 text-sm text-[var(--muted)]">{TWO_FACTOR_UNAVAILABLE}</p>
        ) : !twoFactor && loadFailed.twoFactor ? (
          <LoadFailed what="your two-factor status" onRetry={retry} />
        ) : !twoFactor ? <SectionLoading rows={2} columns={2} label="Checking two-factor" /> : (
          <>
            {!twoFactor.enabled && twoFactor.required ? (
              <p role="status" className="m-0 rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">
                {promptTwoFactor ? "Set this up now. " : ""}Your role can reveal Social Security and bank numbers, and revealing them is blocked until two-factor is on. Everything else keeps working.
              </p>
            ) : null}
            {twoFactor.enabled && !twoFactor.sessionVerified ? (
              <p role="status" className="m-0 text-sm text-[var(--body)]">This session started before two-factor was on. Sign in again with your code to reveal sensitive details here.</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {twoFactor.enabled
                ? <StatusChip tone="good">On since {when(twoFactor.enabledAt ?? "")}</StatusChip>
                : <StatusChip tone={twoFactor.required ? "warning" : "neutral"}>{twoFactor.required ? "Off — required for your role" : "Off"}</StatusChip>}
              {twoFactor.enabled ? <span className="text-[var(--muted)]">{twoFactor.recoveryCodesLeft} recovery code{twoFactor.recoveryCodesLeft === 1 ? "" : "s"} left</span> : null}
            </div>

            {!twoFactor.enabled && !enrolment && !codes ? (
              <div className="flex flex-col gap-2">
                <div><Button type="button" disabled={busy} onClick={startEnrolment}>Turn on two-factor</Button></div>
                {/* Start's own error had nowhere to show until the enrolment form opened. */}
                {twoFactorError ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{twoFactorError}</p> : null}
              </div>
            ) : null}

            {enrolment ? (
              <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void twoFactorAction({ action: "confirm", code }).then((d) => { if (d?.recoveryCodes) { setCodes(d.recoveryCodes); setEnrolment(null); notify.done("Two-factor is on"); void load(); } }); }}>
                <div className="flex flex-wrap items-start gap-5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made on the server */}
                  <img src={enrolment.qr} alt="QR code to scan with your authenticator app" width={160} height={160} className="rounded-md border border-[var(--border)] bg-white p-1" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
                    <p className="m-0">Scan it with Google Authenticator, 1Password, Authy or similar. Or type this key:</p>
                    <code className="break-all rounded bg-[var(--surface-alt)] px-2 py-1 font-mono text-xs">{enrolment.secret}</code>
                    <div className="flex flex-col gap-1.5"><Label htmlFor="security-enrol-code">The six-digit code it shows</Label><Input id="security-enrol-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></div>
                  </div>
                </div>
                {twoFactorError ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{twoFactorError}</p> : null}
                <div className="flex gap-2"><Button type="submit" disabled={busy || code.trim().length !== 6}>Turn on</Button><Button type="button" variant="outline" onClick={() => { setEnrolment(null); setTwoFactorError(null); }}>Cancel</Button></div>
              </form>
            ) : null}

            {codesBlock}

            {twoFactor.enabled && !codes ? (
              managing ? (
                <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void twoFactorAction({ action: managing, code }).then((d) => { if (!d) return; if (d.recoveryCodes) setCodes(d.recoveryCodes); else notify.done("Two-factor is off"); setManaging(null); setCode(""); void load(); router.refresh(); }); }}>
                  <div className="flex max-w-xs flex-col gap-1.5">
                    <Label htmlFor="security-manage-code">{managing === "disable" ? "A current code, or a recovery code" : "A current code"}</Label>
                    <Input id="security-manage-code" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
                  </div>
                  {twoFactorError ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{twoFactorError}</p> : null}
                  <div className="flex gap-2">
                    <Button type="submit" variant={managing === "disable" ? "destructive" : "default"} disabled={busy || !code.trim()}>{managing === "disable" ? "Turn off two-factor" : "Make new codes"}</Button>
                    <Button type="button" variant="outline" onClick={() => { setManaging(null); setCode(""); setTwoFactorError(null); }}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => { setManaging("recovery_codes"); setCode(""); }}>New recovery codes</Button>
                  <Button type="button" variant="outline" onClick={() => { setManaging("disable"); setCode(""); }}>Turn off</Button>
                </div>
              )
            ) : null}
          </>
        )}
      </Section>

      <Section id="security-sessions" title="Sessions" sub="Everywhere you are signed in. Ending one signs that device out on its next click.">
        {sessions === undefined ? <SectionLoading rows={3} columns={4} label="Loading your sessions" /> : loadFailed.sessions ? (
          <LoadFailed what="your sessions" onRetry={retry} />
        ) : sessions === null ? (
          <p className="m-0 text-sm text-[var(--muted)]">The session list is not available yet. Contact support.</p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col p-0 text-sm">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] py-3 first:border-t-0 first:pt-0">
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--ink)]">{s.device} · {s.tenantName}</div>
                    <div className="text-xs text-[var(--muted)] tabular-nums">
                      {[s.location ?? "Location unknown", s.ip, `signed in ${when(s.createdAt)}`, s.current ? null : `last used ${when(s.lastSeenAt)}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {s.current ? <StatusChip tone="good">This session</StatusChip> : <Button type="button" variant="outline" disabled={busy} onClick={() => void endSession(s.id)}>End</Button>}
                </li>
              ))}
            </ul>
            <div><Button type="button" variant="outline" disabled={busy} onClick={() => void endSession(null)}>Sign out every other session</Button></div>
          </>
        )}
      </Section>

      <Section id="security-log" title="Security log" sub="Changes to how your account signs in, and bursts of failed sign-ins.">
        {events === undefined ? <SectionLoading rows={3} columns={3} label="Loading your security log" /> : loadFailed.events ? (
          <LoadFailed what="your security log" onRetry={retry} />
        ) : events === null ? (
          <p className="m-0 text-sm text-[var(--muted)]">The security log is not available yet. Contact support.</p>
        ) : events.length === 0 ? (
          <p className="m-0 text-sm text-[var(--muted)]">Nothing yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {events.slice(0, 50).map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className={e.type === "failed_logins" ? "font-semibold text-[var(--warning-ink)]" : "text-[var(--ink)]"}>{e.label}</span>
                <span className="text-xs text-[var(--muted)] tabular-nums">{when(e.at)}{e.ip ? ` · ${e.ip}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
