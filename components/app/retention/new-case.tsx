"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, inputControl } from "@/components/ui/field";
import { NoteField } from "@/components/ui/note-field";
import { personName } from "@/lib/format/personName";
import { notify } from "@/lib/notify";
import { PERSON_REASONS, REASON_LABELS, type PersonReason } from "@/lib/retention/cases/ladder";
import type { PolicyMatch } from "@/lib/retention/servicingStore";
import { cn } from "@/lib/utils";

const HINTS: Record<PersonReason, string> = {
  cancellation_request: "What they said. It goes in Paperwork and stays until someone closes it, or the policy is gone.",
  payment_date_change: "The date they want, and why. It closes when a carrier file shows the new date.",
  pending_manual_action: "What the carrier or the client still needs. It stays until someone closes it.",
};

/**
 * Cases › New case (round 7, owner pick 1·A / Lapse risk 4·A, 2026-11-10; docs/la4/mockups-r7/retention.html board
 * 1·4): a dialog over the list, for what a person heard before any file shows it: a client asking to cancel, for a
 * new payment date, or paperwork the carrier wants. Recorded lapse signals became these cases ("Opened by a person").
 * Opened from the title line, or by `?new=1` (the old /app/retention/new and Lapse risk's Record a signal).
 */
export function NewCaseButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PolicyMatch[] | null>(null);
  const [picked, setPicked] = useState<PolicyMatch | null>(null);
  const [reason, setReason] = useState<PersonReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || picked) return;
    let live = true;
    const timer = setTimeout(() => {
      fetch(`/api/app/retention/servicing/policies?q=${encodeURIComponent(q)}`)
        .then(async (r) => {
          const data = (await r.json().catch(() => ({}))) as { policies?: PolicyMatch[]; error?: string };
          if (!r.ok) throw new Error(data.error ?? "The policies could not be searched.");
          if (live) setResults(data.policies ?? []);
        })
        .catch((e) => live && setError(e instanceof Error ? e.message : "The policies could not be searched."));
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [query, picked]);

  const close = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setQuery(""); setResults(null); setPicked(null); setReason(""); setNote(""); setError(null);
    if (params.get("new")) {
      const rest = new URLSearchParams(params.toString());
      rest.delete("new");
      router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
    }
  };

  async function submit() {
    if (!picked) return setError("Choose the policy.");
    if (!reason) return setError("Choose why.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/retention/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", carrier_id: picked.carrierId, policy_number: picked.policyNumber, reason, note: note.trim() || null }),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? "The case could not be opened.");
      notify.done("Case opened.");
      router.push(`/app/retention/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The case could not be opened.");
      setBusy(false);
    }
  }

  const shown = query.trim().length < 2 ? null : results;
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>New case</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>New case</DialogTitle>
            <DialogDescription>For something a person heard before the files show it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Policy" htmlFor="nc-policy" hint={picked ? undefined : "The client's name, phone or the policy number."}>
              {picked ? (
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium text-foreground">{picked.clientName ? personName(picked.clientName) : `Policy ${picked.policyNumber}`}</span><span className="text-foreground"> · {picked.carrierName} {picked.policyNumber}</span></span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setPicked(null); setResults(null); }}>Change</Button>
                </span>
              ) : (
                <input id="nc-policy" className={inputControl} value={query} autoFocus autoComplete="off" onChange={(e) => setQuery(e.target.value)} placeholder="Search your book" />
              )}
            </Field>
            {!picked && shown && (
              shown.length === 0
                ? <p className="m-0 text-sm text-muted-foreground">Nothing in your book matches &ldquo;{query.trim()}&rdquo;.</p>
                : (
                  <ul role="listbox" aria-label="Policies found" className="m-0 grid max-h-56 list-none gap-1 overflow-y-auto rounded-lg border border-border p-1">
                    {shown.map((p) => (
                      <li key={`${p.carrierId}|${p.policyNumber}`}>
                        <button type="button" role="option" aria-selected={false} onClick={() => setPicked(p)} className={cn("w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--surface-alt)]")}>
                          <span className="font-medium text-foreground">{p.clientName ? personName(p.clientName) : "No client linked"}</span>
                          <span className="text-foreground"> · {p.carrierName} {p.policyNumber}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
            )}
            <Field label="Why" htmlFor="nc-reason">
              <select id="nc-reason" className={inputControl} value={reason} onChange={(e) => setReason(e.target.value as PersonReason | "")}>
                <option value="">Choose…</option>
                {PERSON_REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
              </select>
            </Field>
            <Field label="Note" htmlFor="nc-note" hint={reason ? HINTS[reason] : undefined}>
              <NoteField id="nc-note" maxLength={2000} rows={3} value={note} onChange={setNote} placeholder="What they said" />
            </Field>
            {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={submit}>{busy ? "Opening…" : "Open the case"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
