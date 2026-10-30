"use client";

/**
 * My profile › Signing in (LA-8.2; settings redesign R4, 2026-10-29): the sign-in email and password
 * as rows that open a short dialog each, two-step verification, where you are signed in, and a danger
 * zone for the two things that cut access. The security log moved to History (SecurityLog, below).
 *
 * Every call is the signed-in person's own; nothing here can touch anyone else's account.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { DangerAction, DangerZone, FormSection, FormSections } from "@/components/app/settings/patterns";
import { Callout, Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { PASSWORD_MIN } from "@/lib/tenantAuth/securityRules";

type TwoFactor = { enabled: boolean; enabledAt: string | null; pending: boolean; recoveryCodesLeft: number; required: boolean; sessionVerified: boolean };
type Session = { id: string; tenantName: string; createdAt: string; lastSeenAt: string; ip: string | null; location: string | null; device: string; current: boolean; twoFactor: boolean };
type SecurityEvent = { id: string; type: string; label: string; at: string; ip: string | null };

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

const TWO_STEP_UNAVAILABLE = "Two-step verification is not available yet. Contact support.";

/** "28 Oct, 12:12" in the person's own time zone: the one date form across Settings (audit P9). */
const whenIn = (timeZone: string | null) => (iso: string) => dateTime(iso, timeZone ?? viewerTimeZone());

/** A read that failed: said plainly, with a way to try again. */
function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-[var(--error-ink)]">
      <span>Could not load {what}.</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  );
}

/** One way in: what it is, its value, and the button that changes it. */
function SignInRow({ id, label, value, action }: { id: string; label: string; value: ReactNode; action: ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-24 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="m-0 text-label text-[var(--body)]">{label}</p>
        <div className="mt-0.5 text-sm text-[var(--muted)]">{value}</div>
      </div>
      {action}
    </div>
  );
}

/** A short form in a 440px dialog (Foundation v3: a Dialog for a short edit). */
function FormDialog({ open, onOpenChange, title, description, submitLabel, busy, disabled, error, destructive, onSubmit, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  submitLabel: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  destructive?: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={destructive ? "sm" : "md"}>
        <form className="flex flex-col gap-4" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(); }}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          {error ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || disabled}>{busy ? "Working…" : submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SecuritySettings({ email, timeZone, promptTwoFactor }: { email: string; timeZone: string | null; promptTwoFactor: boolean }) {
  const router = useRouter();
  const when = whenIn(timeZone);

  // ── dialogs ────────────────────────────────────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<"email" | "password" | "recovery_codes" | "disable" | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const open = (next: typeof dialog) => { setDialog(next); setDialogError(null); };
  const close = () => { setDialog(null); setDialogError(null); setNewEmail(""); setEmailPassword(""); setCurrent(""); setNext(""); setConfirm(""); setCode(""); };

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  // ── two-step ───────────────────────────────────────────────────────────────────────────────────
  const [twoFactor, setTwoFactor] = useState<TwoFactor | null>(null);
  const [enrolment, setEnrolment] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  // ── sessions ───────────────────────────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const [loadFailed, setLoadFailed] = useState<{ twoFactor: boolean; sessions: boolean }>({ twoFactor: false, sessions: false });
  const [twoFactorUnavailable, setTwoFactorUnavailable] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const autoStarted = useRef(false);

  const [reloads, setReloads] = useState(0);
  const load = useCallback(() => setReloads((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    void Promise.all([
      call<TwoFactor>("/api/app/profile/two-factor"),
      call<{ sessions: Session[] | null }>("/api/app/profile/sessions"),
    ]).then(([tf, ss]) => {
      if (!live) return;
      if (tf.ok) setTwoFactor(tf.data);
      setSessions(ss.ok ? ss.data.sessions : null);
      setLoadFailed({ twoFactor: !tf.ok, sessions: !ss.ok });
      setTwoFactorUnavailable(!tf.ok && tf.status === 503);
    });
    return () => { live = false; };
  }, [reloads]);
  const retry = () => {
    setLoadFailed({ twoFactor: false, sessions: false });
    setSessions(undefined);
    load();
  };

  async function changeEmail() {
    setBusy(true);
    setDialogError(null);
    const result = await call<{ newEmail: string }>("/api/app/profile/email", post({ newEmail, currentPassword: emailPassword }));
    setBusy(false);
    if (!result.ok) { setDialogError(result.error); return; }
    setEmailSent(result.data.newEmail);
    close();
    load();
  }

  async function changePassword() {
    setDialogError(null);
    if (next.length < PASSWORD_MIN) { setDialogError(`Use at least ${PASSWORD_MIN} characters.`); return; }
    if (next !== confirm) { setDialogError("The new passwords do not match."); return; }
    setBusy(true);
    const result = await call<{ otherSessionsEnded: number }>("/api/app/profile/password", post({ current, next }));
    setBusy(false);
    if (!result.ok) { setDialogError(result.error); return; }
    close();
    notify.done(result.data.otherSessionsEnded ? `Password changed — ${result.data.otherSessionsEnded} other session${result.data.otherSessionsEnded === 1 ? "" : "s"} signed out` : "Password changed");
    load();
  }

  async function twoFactorAction(body: Record<string, string>, onError: (message: string) => void) {
    setBusy(true);
    const result = await call<{ qr?: string; secret?: string; recoveryCodes?: string[] }>("/api/app/profile/two-factor", post(body));
    setBusy(false);
    // 503: two-step cannot run here yet (its table missing, or no key to seal secrets with).
    if (!result.ok) { onError(result.status === 503 ? TWO_STEP_UNAVAILABLE : result.error); return null; }
    return result.data;
  }

  const startEnrolment = () => {
    setTwoFactorError(null);
    void twoFactorAction({ action: "start" }, setTwoFactorError).then((d) => { if (d?.qr && d.secret) { setEnrolment({ qr: d.qr, secret: d.secret }); setCode(""); } });
  };

  // Sent here by sign-in with ?two_factor=required (the role needs it): go straight to two-step and
  // start enrolment, once. Not when it is already on or a QR code is already showing.
  useEffect(() => {
    if (!promptTwoFactor || autoStarted.current || !twoFactor || twoFactor.enabled || enrolment || codes) return;
    autoStarted.current = true;
    document.getElementById("security-two-factor")?.scrollIntoView({ block: "start", behavior: "smooth" });
    startEnrolment();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the status first arrives
  }, [promptTwoFactor, twoFactor]);

  async function manageTwoFactor(action: "recovery_codes" | "disable") {
    setDialogError(null);
    const d = await twoFactorAction({ action, code }, setDialogError);
    if (!d) return;
    close();
    if (d.recoveryCodes) setCodes(d.recoveryCodes);
    else notify.done("Two-step verification is off");
    load();
    router.refresh();
  }

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
    load();
  }

  const others = sessions ? sessions.filter((s) => !s.current) : [];

  return (
    <div id="security" className="flex min-w-0 scroll-mt-24 flex-col gap-6">
      <FormSections>
        <FormSection id="security-heading" title="Sign-in" info="How you get into your account. Each change asks for your password first.">
          <SignInRow
            id="security-email"
            label="Email"
            value={<>
              <span className="text-[var(--ink)]">{email}</span>
              {emailSent ? <span className="mt-1 block text-[var(--body)]">Check {emailSent} for a link. Until it is used, you keep signing in with {email}.</span> : null}
            </>}
            action={<Button type="button" variant="secondary" size="sm" onClick={() => { open("email"); setEmailSent(null); }}>Change email</Button>}
          />
          <SignInRow
            id="security-password"
            label="Password"
            value={`At least ${PASSWORD_MIN} characters. Changing it signs out every other session.`}
            action={<Button type="button" variant="secondary" size="sm" onClick={() => open("password")}>Change password</Button>}
          />
        </FormSection>

          <FormSection
            id="security-two-factor"
            title="Two-step verification"
            info="A code from an authenticator app each time you sign in. Text messages are not offered."
            aside={twoFactor ? (twoFactor.enabled
              ? <StatusChip tone="good">On since {when(twoFactor.enabledAt ?? "")}</StatusChip>
              : <StatusChip tone={twoFactor.required ? "warning" : "neutral"}>{twoFactor.required ? "Off · required for your role" : "Off"}</StatusChip>) : null}
          >
            {!twoFactor && twoFactorUnavailable ? (
              <p className="m-0 text-sm text-[var(--muted)]">{TWO_STEP_UNAVAILABLE}</p>
            ) : !twoFactor && loadFailed.twoFactor ? (
              <LoadFailed what="your two-step status" onRetry={retry} />
            ) : !twoFactor ? <SectionLoading rows={2} columns={2} label="Checking two-step verification" /> : (
              <>
                {!twoFactor.enabled && twoFactor.required ? (
                  <Callout tone="warning" title={`${promptTwoFactor ? "Set this up now. " : ""}Your role can reveal Social Security and bank numbers.`}>Revealing them is blocked until two-step verification is on. Everything else keeps working.</Callout>
                ) : null}
                {twoFactor.enabled && !twoFactor.sessionVerified ? (
                  <p role="status" className="m-0 text-sm text-[var(--body)]">This session started before two-step verification was on. Sign in again with your code to reveal sensitive details here.</p>
                ) : null}

                {codes ? (
                  <div className="flex flex-col gap-3">
                    <p className="m-0 text-label text-[var(--ink)]">Save these recovery codes now. They will not be shown again.</p>
                    <p className="m-0 text-sm text-[var(--muted)]">Each one signs you in once if your phone is not with you.</p>
                    <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-[var(--surface-alt)] p-3 font-mono text-sm tabular-nums">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => copyCodes(codes)}>Copy</Button>
                      <Button type="button" variant="outline" onClick={() => downloadCodes(codes)}>Download .txt</Button>
                      <Button type="button" onClick={() => { setCodes(null); setCopyFallback(false); }}>I have saved them</Button>
                    </div>
                    {copyFallback ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">Could not copy. Download them as a file, or select the codes above and copy them yourself.</p> : null}
                  </div>
                ) : enrolment ? (
                  <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); setTwoFactorError(null); void twoFactorAction({ action: "confirm", code }, setTwoFactorError).then((d) => { if (d?.recoveryCodes) { setCodes(d.recoveryCodes); setEnrolment(null); setCode(""); notify.done("Two-step verification is on"); load(); } }); }}>
                    <div className="flex flex-wrap items-start gap-5">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made on the server */}
                      <img src={enrolment.qr} alt="QR code to scan with your authenticator app" width={152} height={152} className="rounded-lg border border-[var(--border)] bg-white p-1" />
                      <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
                        <p className="m-0 text-[var(--body)]">Scan it with Google Authenticator, 1Password, Authy or similar. Or type this key:</p>
                        <code className="break-all rounded-md bg-[var(--surface-alt)] px-2 py-1 font-mono text-xs">{enrolment.secret}</code>
                        <Field label="The six-digit code it shows" htmlFor="security-enrol-code">
                          <input id="security-enrol-code" className={`${control} block max-w-40 font-mono tabular-nums`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
                        </Field>
                      </div>
                    </div>
                    {twoFactorError ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{twoFactorError}</p> : null}
                    <div className="flex gap-2"><Button type="submit" disabled={busy || code.trim().length !== 6}>Turn on</Button><Button type="button" variant="outline" onClick={() => { setEnrolment(null); setTwoFactorError(null); }}>Cancel</Button></div>
                  </form>
                ) : twoFactor.enabled ? (
                  <SignInRow
                    id="security-recovery-codes"
                    label="Recovery codes"
                    value={`${twoFactor.recoveryCodesLeft} left. Each signs you in once without your phone.`}
                    action={<Button type="button" variant="secondary" size="sm" onClick={() => open("recovery_codes")}>Make new codes</Button>}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    <div><Button type="button" disabled={busy} onClick={startEnrolment}>Turn on two-step verification</Button></div>
                    {twoFactorError ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{twoFactorError}</p> : null}
                  </div>
                )}
              </>
            )}
          </FormSection>

        <FormSection id="security-sessions" title="Where you're signed in" info="Ending a session signs that device out on its next click.">
          {sessions === undefined ? <SectionLoading rows={3} columns={3} label="Loading your sessions" /> : loadFailed.sessions ? (
            <LoadFailed what="your sessions" onRetry={retry} />
          ) : sessions === null ? (
            <p className="m-0 text-sm text-[var(--muted)]">The session list is not available yet. Contact support.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0 text-sm">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] py-3 first:border-t-0 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-label text-[var(--ink)]">{s.device}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted)] tabular-nums">
                      {[s.location ?? "Location unknown", s.ip, s.current ? `signed in ${when(s.createdAt)}` : `last used ${when(s.lastSeenAt)}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {s.current ? <StatusChip tone="good">This device</StatusChip> : <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void endSession(s.id)}>End</Button>}
                </li>
              ))}
            </ul>
          )}
        </FormSection>
      </FormSections>

      <DangerZone>
        <DangerAction
          title="Sign out every other session"
          consequence={others.length ? `${others.length} other session${others.length === 1 ? "" : "s"} end${others.length === 1 ? "s" : ""} now. This device stays signed in.` : "No other session is open right now."}
          label="Sign out others"
          disabled={busy || !others.length}
          confirm={{ title: "Sign out every other session?", description: others.map((s) => s.device).join(", ") || undefined, confirmLabel: "Sign out others", cancelLabel: "Keep them" }}
          onConfirm={() => endSession(null)}
        />
        {twoFactor?.enabled ? (
          <DangerAction
            title="Turn off two-step verification"
            consequence="Signing in will need only your password, and your recovery codes stop working."
            label="Turn off"
            disabled={busy}
            onConfirm={() => open("disable")}
          />
        ) : null}
      </DangerZone>

      <FormDialog
        open={dialog === "email"}
        onOpenChange={(value) => { if (!value) close(); }}
        title="Change your sign-in email"
        description="It changes only when the new address confirms it. Both addresses are told."
        submitLabel="Send the confirmation link"
        busy={busy}
        disabled={!newEmail.trim() || !emailPassword}
        error={dialogError}
        onSubmit={() => void changeEmail()}
      >
        <Field label="New email" htmlFor="security-new-email"><input id="security-new-email" className={control} type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></Field>
        <Field label="Current password" htmlFor="security-email-password"><input id="security-email-password" className={control} type="password" autoComplete="current-password" required value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} /></Field>
      </FormDialog>

      <FormDialog
        open={dialog === "password"}
        onOpenChange={(value) => { if (!value) close(); }}
        title="Change your password"
        description={`At least ${PASSWORD_MIN} characters. Every other session is signed out.`}
        submitLabel="Change password"
        busy={busy}
        disabled={!current || !next || !confirm}
        error={dialogError}
        onSubmit={() => void changePassword()}
      >
        <Field label="Current password" htmlFor="security-current-password"><input id="security-current-password" className={control} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="New password" htmlFor="security-new-password"><input id="security-new-password" className={control} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Repeat it" htmlFor="security-confirm-password"><input id="security-confirm-password" className={control} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      </FormDialog>

      <FormDialog
        open={dialog === "recovery_codes" || dialog === "disable"}
        onOpenChange={(value) => { if (!value) close(); }}
        title={dialog === "disable" ? "Turn off two-step verification?" : "Make new recovery codes"}
        description={dialog === "disable" ? "Your account will be protected by your password alone." : "Your old codes stop working the moment the new ones are made."}
        submitLabel={dialog === "disable" ? "Turn off" : "Make new codes"}
        destructive={dialog === "disable"}
        busy={busy}
        disabled={!code.trim()}
        error={dialogError}
        onSubmit={() => void manageTwoFactor(dialog === "disable" ? "disable" : "recovery_codes")}
      >
        <Field label={dialog === "disable" ? "A current code, or a recovery code" : "A current code from your app"} htmlFor="security-manage-code">
          <input id="security-manage-code" className={`${control} font-mono tabular-nums`} autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      </FormDialog>
    </div>
  );
}

/**
 * History › Sign-ins and security (moved from Signing in, R4): changes to how your account signs in,
 * and bursts of failed sign-ins. Newest first, the last 50.
 */
export function SecurityLog({ timeZone }: { timeZone: string | null }) {
  const when = whenIn(timeZone);
  const [events, setEvents] = useState<SecurityEvent[] | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let live = true;
    void call<{ events: SecurityEvent[] | null }>("/api/app/profile/security-events").then((ev) => {
      if (!live) return;
      setEvents(ev.ok ? ev.data.events : null);
      setFailed(!ev.ok);
    });
    return () => { live = false; };
  }, [reloads]);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 41);
  const listed = (events ?? []).slice(0, 50);
  const paged = paginate(listed, page, pageSize);
  return (
    <section id="security-log" aria-label="Sign-ins and security" className="scroll-mt-24">
      <TableCard footer={listed.length ? <Pager page={paged.current} total={listed.length} noun={listed.length === 1 ? "event" : "events"} pageSize={pageSize} onPage={setPage} suffix="newest first" /> : undefined}>
        <div className="px-4 py-3">
          {events === undefined ? <SectionLoading rows={4} columns={3} label="Loading your sign-ins" /> : failed ? (
            <LoadFailed what="your sign-ins" onRetry={() => { setEvents(undefined); setReloads((n) => n + 1); }} />
          ) : events === null ? (
            <p className="m-0 text-sm text-[var(--muted)]">The security log is not available yet. Contact support.</p>
          ) : events.length === 0 ? (
            <p className="m-0 text-sm text-[var(--muted)]">Nothing yet. Sign-ins, password changes and two-step changes show here.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {paged.rows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--border)] py-2.5 text-sm first:border-t-0 first:pt-0 last:pb-0">
                  <span className={e.type === "failed_logins" ? "font-semibold text-[var(--warning-ink)]" : "text-[var(--ink)]"}>{e.label}</span>
                  <span className="text-xs text-[var(--muted)] tabular-nums">{when(e.at)}{e.ip ? ` · ${e.ip}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </TableCard>
    </section>
  );
}
