"use client";

import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/notify";
import { PASSWORD_MIN } from "@/lib/tenantAuth/securityRules";
import { cn } from "@/lib/utils";

import { ProfileRow, RowPanel } from "../row";
import { call, FormError, post } from "./shared";

/** A rule the new password meets or does not, said as it is typed. */
function Rule({ met, children }: { met: boolean; children: string }) {
  return (
    <li className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", met ? "text-[var(--success-ink)]" : "text-[var(--muted)]")}>
      {met ? <Check aria-hidden="true" className="size-3.5" /> : <X aria-hidden="true" className="size-3.5" />}
      <span>{children}<span className="sr-only">{met ? ": done" : ": not yet"}</span></span>
    </li>
  );
}

/**
 * The password row: closed until asked for. The two rules are checked as you type, so the button
 * only wakes when the change can work. Changing it signs out every other session.
 */
export function PasswordChange({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const longEnough = next.length >= PASSWORD_MIN;
  const matches = next.length > 0 && next === confirm;

  function close() {
    setOpen(false);
    setCurrent(""); setNext(""); setConfirm("");
    setShow(false);
    setError(null);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!longEnough) { setError(`Use at least ${PASSWORD_MIN} characters.`); return; }
    if (!matches) { setError("The new passwords do not match."); return; }
    setBusy(true);
    const result = await call<{ otherSessionsEnded: number }>("/api/app/profile/password", post({ current, next }));
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    close();
    notify.done(result.data.otherSessionsEnded ? `Password changed — ${result.data.otherSessionsEnded} other device${result.data.otherSessionsEnded === 1 ? "" : "s"} signed out` : "Password changed");
    onChanged();
  }

  const type = show ? "text" : "password";
  return (
    <ProfileRow
      id="security-password"
      label="Password"
      actions={<Button type="button" variant="ghost" aria-expanded={open} aria-controls="security-password-form" onClick={() => (open ? close() : setOpen(true))}>{open ? "Close" : "Change"}</Button>}
      below={open ? (
        <RowPanel>
          <form id="security-password-form" className="flex flex-col gap-3" onSubmit={(event) => void changePassword(event)}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5"><Label htmlFor="security-current-password">Current password</Label><Input id="security-current-password" type={type} autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="security-new-password">New password</Label><Input id="security-new-password" type={type} autoComplete="new-password" aria-describedby="security-password-rules" value={next} onChange={(e) => setNext(e.target.value)} /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="security-confirm-password">Type it again</Label><Input id="security-confirm-password" type={type} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
            </div>
            <ul id="security-password-rules" aria-live="polite" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
              <Rule met={longEnough}>{`${PASSWORD_MIN} characters or more`}</Rule>
              <Rule met={matches}>The two match</Rule>
            </ul>
            <p className="m-0 text-xs text-[var(--muted)]">Changing it signs you out everywhere else. You stay signed in here.</p>
            <FormError>{error}</FormError>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !current || !longEnough || !matches}>{busy ? "Changing…" : "Change password"}</Button>
              <Button type="button" variant="ghost" aria-pressed={show} onClick={() => setShow((value) => !value)}>{show ? "Hide passwords" : "Show passwords"}</Button>
              <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            </div>
          </form>
        </RowPanel>
      ) : null}
    >
      <p className="m-0 text-sm font-semibold tracking-[0.15em] text-[var(--ink)]"><span aria-hidden="true">••••••••••</span><span className="sr-only">Your password is set.</span></p>
    </ProfileRow>
  );
}
