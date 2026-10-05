"use client";

/**
 * "Close the case as lost" (LA-3.16): the only way a case is lost — explicitly, with a reason. Only
 * once no attempt for either insured is live. Nothing on the case is deleted.
 */

import { useState, type FormEvent } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { OUTCOME_REASONS } from "@/lib/applications/constants";
import { notify } from "@/lib/notify";

import { Overlay } from "@/components/app/applications/submit/overlay";
import { useWorkspace } from "@/components/app/applications/workspace/context";

export function CloseCaseDialog({ open, onOpenChange, defaultReason }: { open: boolean; onOpenChange: (open: boolean) => void; defaultReason: string | null }) {
  return open ? <CloseCaseForm open={open} onOpenChange={onOpenChange} defaultReason={defaultReason} /> : null;
}

function CloseCaseForm({ open, onOpenChange, defaultReason }: { open: boolean; onOpenChange: (open: boolean) => void; defaultReason: string | null }) {
  const { caseView, sample, actions, goTo } = useWorkspace();
  const [reason, setReason] = useState(defaultReason && OUTCOME_REASONS.some((r) => r.code === defaultReason) ? defaultReason : "");
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const reasonError = !reason ? "Choose why the case is lost." : undefined;
  const textError = reason === "other" && !text.trim() ? "Say what the reason was." : undefined;

  async function save(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (reasonError || textError || saving) return;
    if (sample) { notify.done("Sample data — the case was not closed."); onOpenChange(false); return; }
    setSaving(true);
    try {
      const ok = await actions.closeCase(reason, text.trim() || null);
      if (!ok) return;
      notify.done("Case closed as lost", { detail: "Every attempt stays on the timeline." });
      onOpenChange(false);
      goTo("timeline");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay
      open={open}
      onOpenChange={(o) => { if (!saving) onOpenChange(o); }}
      width={720}
      title="Close the case as lost"
      subtitle={caseView.clientName}
      onSubmit={save}
      footerNote="A lost case is final. Every attempt, submission and counteroffer stays on the record."
      actions={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} title={saving ? "Saving…" : undefined}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={saving} title={saving ? "Saving…" : undefined}>{saving ? "Closing…" : "Close as lost"}</Button>
      </>}
    >
      <Field label="Reason" htmlFor="close-case-reason" required error={tried ? reasonError : undefined}>
        <select id="close-case-reason" className={control} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
          <option value="">Choose a reason</option>
          {OUTCOME_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Details" htmlFor="close-case-text" required={reason === "other"} error={tried ? textError : undefined}>
        <textarea id="close-case-text" rows={3} className={`${control} h-auto py-2`} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Overlay>
  );
}
