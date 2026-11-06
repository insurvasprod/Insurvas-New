"use client";

import { NoteField } from "@/components/ui/note-field";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { PolicyPicker, type PickedPolicy } from "@/components/app/retention/policy-picker";
import { notify } from "@/lib/notify";

/**
 * Retention › New case (walk 2026-11-05: the API could open one, no page did). The only case a person opens: a
 * client asking for a new payment date, which no carrier file carries. Every other case comes from the files.
 * 1 find the policy, 2 what the client asked for, then Open the case, which lands on the case's own page.
 */
export function NewCase() {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedPolicy | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/retention/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", carrier_id: picked.carrierId, policy_number: picked.policyNumber, reason: "payment_date_change", note: note.trim() || null }),
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

  return (
    <div className="flex flex-col gap-4">
      <PolicyPicker picked={picked} onPick={setPicked} />
      {picked && (
        <section className={`${cardSurface} flex flex-col gap-4 p-5`} aria-labelledby="new-case-what">
          <div className="flex flex-col gap-1">
            <h2 id="new-case-what" className="m-0 text-base font-semibold text-foreground">2 · What the client asked for</h2>
            <p className="m-0 text-sm text-muted-foreground">A new payment date. It goes in Paperwork, beside the ladder, and closes when a carrier file shows the new date. Missed payments, lapses and chargebacks open on their own from the files.</p>
          </div>
          <Field label="The date they want, and why" htmlFor="new-case-note" hint="Kept on the case, for whoever sends the change to the carrier.">
            <NoteField id="new-case-note"  maxLength={2000} value={note} onChange={setNote} placeholder="e.g. the 3rd instead of the 28th: paid on the 1st" />
          </Field>
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.push("/app/retention")}>Back to Cases</Button>
            <Button type="button" disabled={busy} onClick={open}>{busy ? "Opening…" : "Open the case"}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
