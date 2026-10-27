"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ProfileRow, RowPanel } from "../row";
import { call, FormError, post } from "./shared";

/**
 * The sign-in email row. Changing it takes effect only when the new address confirms it; both
 * addresses are told. The form opens under the row — already open when About you's "Change" sent
 * the reader here.
 */
export function SignInEmail({ email, onChanged, asks = 0 }: { email: string; onChanged: () => void; /** Each new ask opens the form. */ asks?: number }) {
  const [open, setOpen] = useState(asks > 0);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // About you's "Change" asked again while this tab was already mounted: open the form and go to it.
  const [seenAsks, setSeenAsks] = useState(asks);
  if (asks !== seenAsks) {
    setSeenAsks(asks);
    setOpen(true);
    setSent(null);
  }
  useEffect(() => { if (open) input.current?.focus(); }, [open, asks]);

  function close() {
    setOpen(false);
    setNewEmail("");
    setPassword("");
    setError(null);
  }

  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await call<{ newEmail: string }>("/api/app/profile/email", post({ newEmail, currentPassword: password }));
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setSent(result.data.newEmail);
    close();
    onChanged();
  }

  return (
    <ProfileRow
      id="security-email"
      label="Email"
      actions={<Button type="button" variant="ghost" aria-expanded={open} aria-controls="security-email-form" onClick={() => (open ? close() : (setOpen(true), setSent(null)))}>{open ? "Close" : "Change"}</Button>}
      below={open ? (
        <RowPanel>
          <form id="security-email-form" className="flex flex-col gap-3" onSubmit={(event) => void changeEmail(event)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5"><Label htmlFor="security-new-email">New email</Label><Input ref={input} id="security-new-email" type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="security-email-password">Your password, to prove it&apos;s you</Label><Input id="security-email-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            </div>
            <p className="m-0 text-xs text-[var(--muted)]">We send a link to the new address and tell the old one. Until the link is clicked, you keep signing in with this email.</p>
            <FormError>{error}</FormError>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !newEmail.trim() || !password}>{busy ? "Sending…" : "Send the link"}</Button>
              <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            </div>
          </form>
        </RowPanel>
      ) : null}
    >
      <p className="m-0 truncate text-sm font-semibold text-[var(--ink)]">{email}</p>
      {sent ? <p role="status" className="m-0 mt-0.5 text-xs text-[var(--body)]">Check {sent} for a link. Until it is clicked, you keep signing in with {email}.</p> : null}
    </ProfileRow>
  );
}
