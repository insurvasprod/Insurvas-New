"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, textareaControl } from "@/components/ui/field";
import { notify } from "@/lib/notify";

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>;
}

/**
 * A possible claim's primary (round 7, owner pick 3·2, 2026-11-10): Mark handled, an md dialog with a note of what
 * was done (resolve_claim). Once handled the claim leaves the list, so the page goes back to Possible claims.
 * An error the person can fix stays on the dialog's error line; the success is a toast.
 */
export function WinbackClaimActions({ claimId, name, backHref }: { claimId: string; name: string; backHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/retention/winback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve_claim", id: claimId, note: note.trim() || null }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
      notify.done("Marked handled.");
      setOpen(false);
      router.push(backHref);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => { setError(null); setOpen(true); }}>Mark handled</Button>
      <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) setOpen(false); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Mark handled?</DialogTitle>
            <DialogDescription>{name}&apos;s policy lapsed after a reported death: help the family claim, or mark it handled. It is never sent to a win-back list, and the phone number is not blocked, because the household may share it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="What was done" htmlFor="claim-note">
              <textarea id="claim-note" className={textareaControl} maxLength={2000} disabled={busy} placeholder="Spoke to the daughter, claim form sent" value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} />
            </Field>
            <ErrorLine error={error} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Mark handled"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
