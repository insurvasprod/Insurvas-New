"use client";

import { Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkboxControl, control, Field } from "@/components/ui/field";
import { ChoiceCard, CopyField, copyText, maskedAddress, NeedsUpdate } from "./shared";

/**
 * Rotate and revoke (board A10), and the new key shown once. Rotate can keep the old key working for
 * a 24-hour grace window (needs 20261112100100); revoke asks for the vendor's name.
 */
export function RotateDialog({ vendorName, r8Ready, busy, onCancel, onRotate }: { vendorName: string; r8Ready: boolean; busy: boolean; onCancel: () => void; onRotate: (input: { graceHours: number; emailInstructions: boolean }) => void }) {
  const [grace, setGrace] = useState(false);
  const [email, setEmail] = useState(true);
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Rotate {vendorName}&rsquo;s key?</DialogTitle>
          <DialogDescription>A new key is made and shown once. Send it to {vendorName}; we can open an email with updated instructions.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <ChoiceCard name="rotate-grace" selected={!grace} onSelect={() => setGrace(false)} title="Old key stops now" sub="Use this if the key may have leaked" />
          <ChoiceCard name="rotate-grace" selected={grace} disabled={!r8Ready} onSelect={() => setGrace(true)} title={<>Old key works for 24 more hours{!r8Ready && <NeedsUpdate />}</>} sub="Gives them time to switch" />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--body)]">
          <input type="checkbox" className={checkboxControl} checked={email} onChange={(event) => setEmail(event.target.checked)} />
          Email {vendorName} the new instructions
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => onRotate({ graceHours: grace ? 24 : 0, emailInstructions: email })}>{busy ? "Rotating…" : "Rotate key"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeDialog({ vendorName, busy, onCancel, onRevoke }: { vendorName: string; busy: boolean; onCancel: () => void; onRevoke: () => void }) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === vendorName.trim().toLowerCase();
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Revoke {vendorName}&rsquo;s key?</DialogTitle>
          <DialogDescription>Every post with this key is refused from now on. Their leads and history stay. You can connect them again later with a new key.</DialogDescription>
        </DialogHeader>
        <Field label={<>Type <b>{vendorName}</b> to confirm</>} htmlFor="revoke-name">
          <input id="revoke-name" className={control} autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && matches) { event.preventDefault(); onRevoke(); } }} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={!matches || busy} onClick={onRevoke}>{busy ? "Revoking…" : "Revoke key"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The key, shown once, with the posting address beside it. */
export function KeyBox({ value, postingUrl }: { value: string; postingUrl: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-4 text-center">
        <span className="text-xs text-[var(--muted)]">Posting key</span>
        <code className="break-all font-mono text-base text-[var(--ink)]">{value}</code>
        <Button type="button" onClick={() => void copyText(value, "Key copied.")}><Copy aria-hidden="true" />Copy key</Button>
      </div>
      <p className="m-0 text-center text-xs text-[var(--muted)]">This is the only time the full key is shown. We keep a fingerprint, never the key. If it is lost, rotate it.</p>
      <Field label="Posting address" hint="The same address for every vendor; the key tells us who is posting.">
        <div className="mt-1.5"><CopyField label="Posting address" value={postingUrl} shown={maskedAddress(postingUrl)} /></div>
      </Field>
    </div>
  );
}

export function RevealDialog({ vendorName, value, postingUrl, graceUntil, onDone }: { vendorName: string; value: string; postingUrl: string; graceUntil: string | null; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(next) => { if (!next && copied) onDone(); }}>
      <DialogContent size="md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{vendorName}&rsquo;s new key</DialogTitle>
          <DialogDescription>{graceUntil ? `Their old key keeps working until ${new Date(graceUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Their old key has stopped working."}</DialogDescription>
        </DialogHeader>
        <KeyBox value={value} postingUrl={postingUrl} />
        <label className="flex items-center gap-2 text-sm text-[var(--body)]">
          <input type="checkbox" className={checkboxControl} checked={copied} onChange={(event) => setCopied(event.target.checked)} />
          I&rsquo;ve copied the key somewhere safe
        </label>
        <DialogFooter>
          <Button type="button" disabled={!copied} onClick={onDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
