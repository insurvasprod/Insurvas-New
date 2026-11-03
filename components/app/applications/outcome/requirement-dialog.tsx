"use client";

/**
 * Add or update a requirement (LA-3.18): what the carrier asked for after submission. A paramed exam
 * (LA-3.25) also carries its vendor and dates — ordered, scheduled, completed, results — and only a
 * paramed exam does. Marking the last one satisfied leaves the attempt pending with the carrier.
 */

import { useState, type FormEvent } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import {
  REQUIREMENT_KINDS, REQUIREMENT_KIND_LABEL, WAITING_ON, WAITING_ON_LABEL, type RequirementKind, type WaitingOn,
} from "@/lib/applications/constants";
import type { RequirementView } from "@/lib/applications/types";
import { notify } from "@/lib/notify";

import { attemptUrl, request } from "@/components/app/applications/submit/api";
import { Overlay } from "@/components/app/applications/submit/overlay";
import { Warning } from "@/components/app/applications/submit/warning-line";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { dateInput } from "./model";

/** A counteroffer requirement is raised by recording the counteroffer, never by hand. */
const KINDS = REQUIREMENT_KINDS.filter((k) => k !== "counteroffer");
const STATUSES: { value: RequirementView["status"]; label: string }[] = [
  { value: "open", label: "Open" }, { value: "in_progress", label: "In progress" }, { value: "satisfied", label: "Satisfied" }, { value: "waived", label: "Waived" }, { value: "expired", label: "Expired" },
];

export function RequirementDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (open: boolean) => void; editing: RequirementView | null }) {
  return open ? <RequirementForm key={editing?.id ?? "new"} open={open} onOpenChange={onOpenChange} editing={editing} /> : null;
}

function RequirementForm({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (open: boolean) => void; editing: RequirementView | null }) {
  const { caseView, attempt, sample, actions, updateAttempt } = useWorkspace();
  const [today] = useState(() => dateInput(Date.now()));
  const [kind, setKind] = useState<RequirementKind>(editing?.kind ?? "phone_interview");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [waitingOn, setWaitingOn] = useState<WaitingOn>(editing?.waitingOn ?? "client");
  const [status, setStatus] = useState<RequirementView["status"]>(editing?.status ?? "open");
  const [raised, setRaised] = useState(editing?.raisedAt?.slice(0, 10) ?? today);
  const [due, setDue] = useState(editing?.dueAt ?? "");
  const [vendor, setVendor] = useState(editing?.exam?.vendor ?? "");
  const [ordered, setOrdered] = useState(editing?.exam?.orderedOn ?? "");
  const [scheduled, setScheduled] = useState(editing?.exam?.scheduledOn ?? "");
  const [completed, setCompleted] = useState(editing?.exam?.completedOn ?? "");
  const [results, setResults] = useState(editing?.exam?.resultsOn ?? "");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const exam = kind === "paramed_exam";
  const isCounteroffer = editing?.kind === "counteroffer";

  const descriptionError = !description.trim() ? "Say what the carrier asked for." : undefined;
  const raisedError = !raised ? "Enter the date the carrier raised it." : raised > today ? "The raised date can't be in the future." : undefined;
  const dueError = due && raised && due < raised ? "The due date is before the date it was raised." : undefined;

  async function save(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (descriptionError || raisedError || dueError || saving) return;
    const examBody = exam ? { exam_vendor: vendor.trim() || null, exam_ordered_on: ordered || null, exam_scheduled_on: scheduled || null, exam_completed_on: completed || null, exam_results_on: results || null } : {};
    if (sample) {
      const row: RequirementView = {
        id: editing?.id ?? `req-${Date.now()}`, applicationId: attempt.id, caseId: attempt.caseId, clientName: caseView.clientName, carrierName: attempt.carrierName, monthlyPremiumCents: null,
        kind, description: description.trim(), waitingOn, status, raisedAt: raised, dueAt: due || null, lastChasedAt: editing?.lastChasedAt ?? null, chaseCount: editing?.chaseCount ?? 0,
        exam: exam ? { vendor: vendor || null, orderedOn: ordered || null, scheduledOn: scheduled || null, completedOn: completed || null, resultsOn: results || null } : null,
      };
      updateAttempt({ requirements: editing ? attempt.requirements.map((r) => (r.id === editing.id ? row : r)) : [...attempt.requirements, row], status: attempt.status === "submitted" ? "pending_carrier" : attempt.status });
      notify.done("Sample data — nothing was saved");
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const r = editing
        ? await request(attemptUrl(attempt.id, `/requirements/${editing.id}`), { method: "PATCH", body: { ...(isCounteroffer ? {} : { status }), description: description.trim(), waiting_on: waitingOn, due_at: due || null, ...examBody } })
        : await request<{ status: string }>(attemptUrl(attempt.id, "/requirements"), { method: "POST", body: { kind, description: description.trim(), waiting_on: waitingOn, raised_at: raised, due_at: due || null, ...examBody } });
      if (!r.ok) { notify.block(r.error, { detail: "What you typed is still in the form." }); return; }
      await actions.refresh();
      notify.done(editing ? `${REQUIREMENT_KIND_LABEL[kind]} updated` : `${REQUIREMENT_KIND_LABEL[kind]} added`, { detail: !editing && attempt.status === "submitted" ? "The application is now pending with the carrier." : undefined });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay
      open={open}
      onOpenChange={(o) => { if (!saving) onOpenChange(o); }}
      width={720}
      title={editing ? "Update requirement" : "Add requirement"}
      subtitle={[caseView.clientName, attempt.carrierName, `attempt ${attempt.attemptNo}`].filter(Boolean).join(" · ")}
      onSubmit={save}
      actions={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} title={saving ? "Saving…" : undefined}>Cancel</Button>
        <Button type="submit" disabled={saving} title={saving ? "Saving…" : undefined}>{saving ? "Saving…" : editing ? "Save" : "Add requirement"}</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind" htmlFor="requirement-kind">
          <select id="requirement-kind" className={control} value={kind} onChange={(e) => setKind(e.target.value as RequirementKind)} disabled={Boolean(editing)}>
            {(isCounteroffer ? REQUIREMENT_KINDS : KINDS).map((k) => <option key={k} value={k}>{REQUIREMENT_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Waiting on" htmlFor="requirement-waiting-on" hint={waitingOn === "client" ? "The client is the one you can chase." : undefined}>
          <select id="requirement-waiting-on" className={control} value={waitingOn} onChange={(e) => setWaitingOn(e.target.value as WaitingOn)}>
            {WAITING_ON.map((w) => <option key={w} value={w}>{WAITING_ON_LABEL[w]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description" htmlFor="requirement-description" required error={tried ? descriptionError : undefined}>
        <input id="requirement-description" className={control} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the carrier's notice asks for" autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Raised" htmlFor="requirement-raised" error={tried ? raisedError : undefined}>
          <input id="requirement-raised" type="date" className={control} value={raised} max={today} onChange={(e) => setRaised(e.target.value)} disabled={Boolean(editing)} />
        </Field>
        <Field label="Due" htmlFor="requirement-due" hint="Optional." error={tried ? dueError : undefined}>
          <input id="requirement-due" type="date" className={control} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        {editing && (
          <Field label="Status" htmlFor="requirement-status" hint={isCounteroffer ? "Answer the counteroffer to close this." : undefined}>
            <select id="requirement-status" className={control} value={status} onChange={(e) => setStatus(e.target.value as RequirementView["status"])} disabled={isCounteroffer}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        )}
      </div>
      {dueError && !tried && <Warning>{dueError}</Warning>}
      {exam && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Exam vendor" htmlFor="requirement-exam-vendor" hint="e.g. the paramedical company the carrier uses.">
            <input id="requirement-exam-vendor" className={control} value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </Field>
          <Field label="Ordered" htmlFor="requirement-exam-ordered">
            <input id="requirement-exam-ordered" type="date" className={control} value={ordered} onChange={(e) => setOrdered(e.target.value)} />
          </Field>
          <Field label="Scheduled for" htmlFor="requirement-exam-scheduled">
            <input id="requirement-exam-scheduled" type="date" className={control} value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
          </Field>
          <Field label="Completed" htmlFor="requirement-exam-completed">
            <input id="requirement-exam-completed" type="date" className={control} value={completed} onChange={(e) => setCompleted(e.target.value)} />
          </Field>
          <Field label="Results received" htmlFor="requirement-exam-results">
            <input id="requirement-exam-results" type="date" className={control} value={results} onChange={(e) => setResults(e.target.value)} />
          </Field>
        </div>
      )}
    </Overlay>
  );
}
