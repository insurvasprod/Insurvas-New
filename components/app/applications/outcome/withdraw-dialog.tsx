"use client";

/**
 * Withdraw an application that never reached the carrier (LA-3.16): the client walked away before
 * it was submitted. The outcome card only opens once an attempt is submitted, so without this a
 * draft or ready attempt could never be closed — and a case whose last attempt is still live cannot
 * be closed as lost. It moves through the same transition (`closed`, outcome `withdrawn`) with a
 * structured reason, like every other outcome.
 */

import { useState, type FormEvent } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { OUTCOME_REASONS } from "@/lib/applications/constants";
import { notify } from "@/lib/notify";

import { useWorkspace } from "@/components/app/applications/workspace/context";
import { Overlay } from "@/components/app/applications/submit/overlay";

const REASONS = OUTCOME_REASONS.filter((r) => (r.outcomes as readonly string[]).includes("withdrawn"));

export function WithdrawDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Remounted on every open, so a cancelled withdrawal never leaks into the next one.
  return open ? <WithdrawForm onOpenChange={onOpenChange} /> : null;
}

function WithdrawForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { attempt, caseView, sample, actions, updateAttempt } = useWorkspace();
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const reasonError = !reason ? "Choose why it is being withdrawn." : undefined;
  const textError = reason === "other" && !text.trim() ? "Say what the reason was." : undefined;

  async function save(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (reasonError || textError || saving) return;
    if (sample) {
      updateAttempt({ status: "closed", outcome: "withdrawn", outcomeReasonCode: reason as never, outcomeReasonText: text.trim() || null, closedAt: new Date().toISOString() });
      notify.done("Withdrawn", { detail: "Sample data — nothing was saved." });
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const r = await actions.transition("closed", { outcome: "withdrawn", reasonCode: reason, reasonText: text.trim() || null });
      if (!r) return;
      notify.done(`Attempt ${attempt.attemptNo} withdrawn`, { detail: "Close the case as lost from its outcome, or start again from the lead." });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay
      open
      onOpenChange={(o) => { if (!saving) onOpenChange(o); }}
      width={720}
      title="Withdraw this application?"
      subtitle={[attempt.carrierName, `attempt ${attempt.attemptNo}`, caseView.clientName].filter(Boolean).join(" · ")}
      footerNote="It was never submitted. The attempt closes for good; its record stays on the case."
      onSubmit={save}
      actions={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} title={saving ? "Saving…" : undefined}>Keep it open</Button>
        <Button type="submit" disabled={saving} title={saving ? "Saving…" : undefined}>{saving ? "Withdrawing…" : "Withdraw"}</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reason" htmlFor="withdraw-reason" required error={tried ? reasonError : undefined}>
          <select id="withdraw-reason" className={control} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
            <option value="">Choose a reason</option>
            {REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Details" htmlFor="withdraw-reason-text" required={reason === "other"} error={tried ? textError : undefined} className="sm:col-span-2">
          <textarea id="withdraw-reason-text" rows={2} className={`${control} h-auto py-2`} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Overlay>
  );
}
