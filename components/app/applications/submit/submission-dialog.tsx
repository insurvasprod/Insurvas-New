"use client";

/**
 * "Record the submission" (LA-3.15, board l3-ov-capture): what the carrier's confirmation screen
 * said, captured while it is still on screen. The reference is checked against the carrier's
 * pattern and against every other submission in the agency — both are warnings, never blocks, and
 * an empty reference still saves (it waits on the Missing reference list). The QA verdict is frozen
 * onto the submission by the server at this moment. A pasted screenshot uploads to private storage.
 *
 * In "existing" mode it adds the reference (or the screenshot) to a submission already recorded,
 * without touching anything else on it.
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { Callout, Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import type { SubmissionView } from "@/lib/applications/types";

import { QaVerdictChip, shortDate } from "@/components/app/applications/parts";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { attemptUrl, request } from "./api";
import { AttachedFile, PasteBox, useAttachment, useFilePicker, type Attachment } from "./attachment-field";
import { REFERENCE_KIND_LABEL, SUBMITTED_VIA_LABEL } from "./labels";
import { Overlay } from "./overlay";
import { useReferenceCheck } from "./reference-check";
import { Warning } from "./warning-line";

/** `YYYY-MM-DDTHH:mm` in local time, for a datetime-local input. */
export function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type CaptureSeed = { reference: string; submittedAt: string; attachment: Attachment | null };

/** Upload one confirmation to a recorded submission. Returns the error line, or null. */
export async function uploadConfirmation(attemptId: string, submissionId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const r = await request<{ attached: boolean }>(attemptUrl(attemptId, `/submissions/${submissionId}/confirmation`), { method: "POST", form });
  return r.ok ? null : r.error;
}

export function SubmissionDialog({ open, onOpenChange, existing, extensionDetected, seed }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Adding the reference or screenshot to a submission already recorded, rather than recording a new one. */
  existing?: SubmissionView | null;
  extensionDetected: boolean;
  /** What the inline card already holds (the reference typed there, the pasted screenshot). */
  seed?: CaptureSeed | null;
}) {
  // Remounted on every open, so a cancelled capture never leaks into the next one.
  return open ? <CaptureForm key={existing?.id ?? "new"} open={open} onOpenChange={onOpenChange} existing={existing ?? null} extensionDetected={extensionDetected} seed={seed ?? null} /> : null;
}

function CaptureForm({ open, onOpenChange, existing, extensionDetected, seed }: {
  open: boolean; onOpenChange: (open: boolean) => void; existing: SubmissionView | null; extensionDetected: boolean; seed: CaptureSeed | null;
}) {
  const { caseView, attempt, qa, sample, actions, updateAttempt, goTo } = useWorkspace();
  const [kind, setKind] = useState<NonNullable<SubmissionView["referenceKind"]>>(existing?.referenceKind ?? "application_no");
  const [reference, setReference] = useState(existing?.carrierReference ?? seed?.reference ?? "");
  const [at, setAt] = useState(() => (existing ? toLocalInput(new Date(existing.submittedAt)) : seed?.submittedAt || toLocalInput(new Date())));
  const [via, setVia] = useState<SubmissionView["submittedVia"]>(existing?.submittedVia ?? (extensionDetected ? "extension" : "copy_assist"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useAttachment(existing?.hasConfirmation ? null : seed?.attachment ?? null);
  const picker = useFilePicker((f) => confirmation.set(f, "chosen"));

  const [openedAt] = useState(() => Date.now());
  const ref = reference.trim();
  const check = useReferenceCheck(attempt.id, ref, sample);
  const atValid = Boolean(at) && !Number.isNaN(new Date(at).getTime()) && new Date(at).getTime() <= openedAt + 10 * 60_000;
  const verdict = existing?.qaVerdict ?? qa.verdict;
  const canAttach = !existing?.hasConfirmation;
  const subtitle = [attempt.carrierName, `attempt ${attempt.attemptNo}`, caseView.clientName].filter(Boolean).join(" · ");
  const hint = check.example ? `${check.carrierName ?? attempt.carrierName ?? "This carrier"} uses ${check.example}.` : "Copy it from the carrier's confirmation screen.";

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!atValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const file = confirmation.value?.file ?? null;
      if (existing) {
        if (sample) {
          updateAttempt({ submissions: attempt.submissions.map((s) => (s.id === existing.id ? { ...s, carrierReference: ref || null, referenceKind: ref ? kind : null, hasConfirmation: s.hasConfirmation || Boolean(file) } : s)) });
          notify.done("Sample data — nothing was saved");
          onOpenChange(false);
          return;
        }
        if (ref !== (existing.carrierReference ?? "")) {
          const okRef = await actions.setReference(existing.id, { reference: ref || null, ...(kind === "policy_no" && ref ? { policyNumber: ref } : {}) });
          if (!okRef) { setError("The reference wasn't saved — it is still in the box. Try again."); return; }
        }
        if (file && canAttach) {
          const problem = await uploadConfirmation(attempt.id, existing.id, file);
          if (problem) { setError(problem); return; }
        }
        await actions.refresh();
        notify.done(ref ? `Reference ${ref} saved` : "Submission updated");
        onOpenChange(false);
        return;
      }

      const recorded = await actions.recordSubmission({ reference: ref || null, referenceKind: kind, submittedAt: new Date(at).toISOString(), submittedVia: via });
      if (!recorded) { setError("The submission wasn't recorded — everything you typed is still here. Try again."); return; }
      if (sample) {
        updateAttempt({ status: "submitted", submittedAt: new Date(at).toISOString(), submissions: [...attempt.submissions, { id: recorded.submissionId, attemptNo: attempt.attemptNo, carrierReference: ref || null, referenceKind: ref ? kind : null, policyNumber: null, submittedAt: new Date(at).toISOString(), submittedVia: via, hasConfirmation: Boolean(file), qaVerdict: verdict }] });
        notify.done("Sample data — nothing was saved");
        onOpenChange(false);
        goTo("after");
        return;
      }
      let uploadProblem: string | null = null;
      if (file) uploadProblem = await uploadConfirmation(attempt.id, recorded.submissionId, file);
      // Submitting makes the welcome pack (LA-3.20); the server sends it once, if auto-send is on.
      const pack = await request<{ delivery: { status: string; note: string | null } | null }>(attemptUrl(attempt.id, "/welcome-pack"), { method: "POST", body: { action: "submit" } });
      await actions.refresh();
      notify.done(ref ? `Submission recorded · ${ref}` : "Submission recorded", {
        detail: uploadProblem
          ? `The screenshot didn't upload (${uploadProblem}) — attach it from the Submit step.`
          : !ref ? "It stays on the Missing reference list until you add the reference."
          : pack.ok && pack.data.delivery?.status === "sent" ? "Welcome pack sent." : pack.ok ? pack.data.delivery?.note ?? undefined : "The welcome pack wasn't made — open After submit to retry.",
      });
      if (recorded.duplicate) notify.warn("That reference is already on another application", { detail: "Check you copied the right one." });
      onOpenChange(false);
      goTo("after");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay
      open={open}
      onOpenChange={(o) => { if (!saving) onOpenChange(o); }}
      width={760}
      title={existing ? "Add the carrier reference" : "Record the submission"}
      subtitle={subtitle}
      onSubmit={save}
      onPaste={canAttach ? (e) => confirmation.onPaste(e) : undefined}
      actions={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} title={saving ? "Saving…" : undefined}>Cancel</Button>
        <Button type="submit" disabled={!atValid || saving} title={!atValid ? "Enter when it was submitted" : saving ? "Saving…" : undefined}>
          {saving ? "Saving…" : existing ? "Save" : "Record submission"}
        </Button>
      </>}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <Field label="Carrier reference number" htmlFor="submission-reference" hint={hint}>
            <input id="submission-reference" className={`${control} font-mono uppercase`} value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
          </Field>
        </div>
        <div className="pb-7">
          {ref && check.format === "match" && <StatusChip tone="good">Format matches</StatusChip>}
          {ref && check.format === "mismatch" && <StatusChip tone="warning">Format doesn&apos;t match</StatusChip>}
        </div>
      </div>
      {!ref && <Warning>Without a reference it stays on the Missing reference list until you add it.</Warning>}
      {ref && check.format === "mismatch" && <Warning>{check.example ? `${check.carrierName ?? "This carrier"}'s references look like ${check.example}. Check it against the confirmation — it still saves.` : "Check it against the confirmation — it still saves."}</Warning>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Submitted at" htmlFor="submission-at" error={atValid ? undefined : "Enter when it was submitted — not in the future."}>
          <input id="submission-at" type="datetime-local" className={control} value={at} onChange={(e) => setAt(e.target.value)} disabled={Boolean(existing)} />
        </Field>
        <Field label="Submitted by" htmlFor="submission-by">
          <input id="submission-by" className={control} value="You" readOnly disabled title="The signed-in agent is recorded" />
        </Field>
        <Field label="Reference type" htmlFor="submission-kind" hint="The policy number usually comes later, at issue.">
          <select id="submission-kind" className={control} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {Object.entries(REFERENCE_KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Submitted via" htmlFor="submission-via">
          <select id="submission-via" className={control} value={via} onChange={(e) => setVia(e.target.value as typeof via)} disabled={Boolean(existing)}>
            {Object.entries(SUBMITTED_VIA_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-[var(--body)]">Confirmation screenshot</span>
        {!canAttach ? (
          <p className="text-sm text-[var(--muted)]">Attached, and kept exactly as it was.</p>
        ) : confirmation.value ? (
          <AttachedFile value={confirmation.value} onReplace={picker.open} onRemove={() => confirmation.set(null)} disabled={saving} />
        ) : (
          <PasteBox id="submission-confirmation" onFile={(f, how) => confirmation.set(f, how)} disabled={saving} />
        )}
        {picker.node}
      </div>

      {check.duplicate && ref && (
        <Callout tone="warning" title={`${ref.toUpperCase()} was used on another application`}>
          <Link href={`/app/applications/${check.duplicate.caseId}?attempt=${check.duplicate.attemptNo}&step=submit`} target="_blank" className="font-semibold underline underline-offset-2">
            {check.duplicate.sameCase ? `Attempt ${check.duplicate.attemptNo} of this case` : check.duplicate.clientName}
          </Link>
          , {shortDate(check.duplicate.submittedAt)}. Two applications cannot share a carrier reference — check you copied the right one.
        </Callout>
      )}

      <div className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--surface-alt)] px-3 py-2 text-sm">
        <span className="text-[var(--muted)]" title="Frozen with the submission and never changed afterwards">{existing ? "Check at submission" : "Check it will be frozen with"}</span>
        <QaVerdictChip verdict={verdict} />
      </div>
      {error && <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p>}
    </Overlay>
  );
}
