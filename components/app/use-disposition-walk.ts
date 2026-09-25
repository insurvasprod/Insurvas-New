"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { zonedLocalToUtc } from "@/lib/dispositions/callbackTime";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import type { DispositionNode, DispositionWizard as WizardBase } from "@/lib/dispositions/types";
import { notify } from "@/lib/notify";

/**
 * The call-outcome walk's state and logic, shared by the full page (/app/inbound/[id]/disposition)
 * and the "Record call outcome" dialog. Extracted from the page component unchanged: the same
 * server walk, the same answer/complete calls, the same idempotency key, the same deal-flow
 * redirect — the page renders exactly as before, and the dialog is a second view of one walk.
 */

/**
 * One offered outcome. Inbound (app/api/app/inbound/disposition): mapped to a live stage, described
 * by where it lands. Call mode (app/api/app/dialer/attempt/[id]/disposition): any outcome the dialer
 * records, described — `description` and `preview` — by what the DIALER does with it; `stage` is the
 * mapped stage, which the dialer only moves to for a terminal outcome, and may be null.
 */
export type OutcomeOption = {
  disposition_key: string;
  label: string;
  closes_as: "completed" | "dropped";
  description: string;
  stage: { id: string; name: string; pipeline_name: string; is_current: boolean } | null;
  application: boolean;
  needs_verification: boolean;
  adds_to_do_not_call: boolean;
  /** Call mode only: the "Next action preview" sentence for this outcome on the dialer's path. */
  preview?: string;
};
export type CallModeInfo = { attemptId: string; walkAvailable: boolean; earlierWalk: boolean };
export type WizardData = WizardBase & { outcomeOptions?: OutcomeOption[] | null; verification?: { progress: number; complete: boolean } | null; currentUserId?: string; callMode?: CallModeInfo };
export type Phase = "outcome" | "details" | "review";
export type Step = { key: string; label: string; state: "done" | "current" | "upcoming" };

/** The one outcome that creates future work, and so has its own Details (lib/dispositions/oneVocabulary.test.mjs). */
export const CALLBACK_KEY = "callback_scheduled";

export function answerLabel(step: WizardData["steps"][number], node: DispositionNode | undefined) {
  const optionLabel = (key: string) => node?.options.find((option) => option.option_key === key)?.label ?? key;
  if (step.option_key) return optionLabel(step.option_key);
  if (Array.isArray(step.answer)) return step.answer.map((value) => optionLabel(String(value))).join(", ");
  if (typeof step.answer === "string" && step.answer.trim()) return step.answer;
  return "Answered";
}

/** "Thu 26 Sep, 4:30 PM CDT" in a zone; the browser's zone, unlabelled, when none is given (the wizard renders after its data loads). */
export function when(at: Date, timeZone?: string) {
  return dateTime(at, timeZone ?? viewerTimeZone(), { weekday: true, clock: "12h", zoneLabel: Boolean(timeZone) });
}

/**
 * `onRecorded` replaces what happens after the outcome is recorded. Without it, the walk does what
 * the page always did: say so and open Daily deal flow on the lead.
 *
 * `attemptId` is CALL mode (user decision 2026-09-24, "link the walk to the call"): the walk is
 * read and answered through the dialer's disposition route, and the outcome is recorded against
 * that dial attempt by the dialer's function — closing the attempt, advancing the cadence, running
 * the verification gate — with the walked path stored with the attempt.
 */
export function useDispositionWalk({ workItemId, readOnly, enabled = true, onRecorded, attemptId }: { workItemId: string; readOnly: boolean; enabled?: boolean; onRecorded?: (result: { leadId: string | null }) => void; attemptId?: string }) {
  const router = useRouter();
  const [wizard, setWizard] = useState<WizardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<unknown>("");
  const [editingSequence, setEditingSequence] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("outcome");
  const [dispositionKey, setDispositionKey] = useState("");
  const [callbackSubtype, setCallbackSubtype] = useState("");
  const [callbackLocal, setCallbackLocal] = useState("");
  const [callbackAssignee, setCallbackAssignee] = useState("");
  // One key per outcome attempt, kept across retries: a retry after a lost response must find the
  // callback the first attempt booked rather than book a second one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const url = attemptId ? `/api/app/dialer/attempt/${encodeURIComponent(attemptId)}/disposition` : `/api/app/inbound/disposition?work_item_id=${encodeURIComponent(workItemId)}`;
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    // A walk finished on an earlier call suggested that call's outcome; this call chooses its own.
    if (!response.ok) setError(body?.error ?? "Could not load the call outcome wizard."); else { setWizard(body); setDispositionKey(body.callMode?.earlierWalk ? "" : body.walk.final_disposition_key ?? ""); }
    setLoading(false);
  }, [workItemId, attemptId]);
  // The server walk is the resume point after a dropped call or handoff. The dialog loads it only
  // once it is opened, so a closed dialog never starts a walk.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (enabled) void load(); }, [load, enabled]);

  function beginEdit(sequence: number) {
    // Answers from an earlier call belong to that call; they are shown, not re-opened.
    if (readOnly || !wizard || wizard.callMode?.earlierWalk) return;
    const step = wizard.steps.find((item) => item.sequence === sequence);
    const node = step ? wizard.flow.nodes.find((item) => item.id === step.node_id) : null;
    if (!step || !node) return;
    setEditingSequence(sequence); setAnswer(node.node_type === "multi_select" ? (Array.isArray(step.answer) ? step.answer : []) : step.option_key ?? step.answer ?? ""); setError("");
  }

  function cancelEdit() { setEditingSequence(null); setAnswer(""); }

  // Where the walk posts: the inbound route, or — in call mode — the dialer's disposition route.
  const postUrl = attemptId ? `/api/app/dialer/attempt/${encodeURIComponent(attemptId)}/disposition` : "/api/app/inbound/disposition";

  async function send(payload: Record<string, unknown>, kind: "answer" | "complete" = payload.action === "complete" ? "complete" : "answer") {
    setSaving(true); setError("");
    const response = await fetch(postUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) { const message = body?.error ?? "Could not save the call outcome."; setError(message); notify.block(message); return false; }
    if (body.wizard) { setWizard(body.wizard); setEditingSequence(null); setAnswer(""); if (body.wizard.walk.final_disposition_key) setDispositionKey(body.wizard.walk.final_disposition_key); }
    if (kind === "complete") {
      const leadId = typeof body.result?.lead_id === "string" ? body.result.lead_id : attemptId ? wizard?.lead.id ?? null : null;
      if (onRecorded) onRecorded({ leadId });
      else {
        notify.done("Call outcome recorded — opening Daily deal flow");
        if (leadId) router.push(`/app/deal-flow?focus_lead_id=${encodeURIComponent(leadId)}`);
      }
    } else notify.done("Answer saved");
    return true;
  }

  async function saveAnswer(node: DispositionNode, sequence: number) {
    // Call mode names the attempt in the URL; the server finds its work item.
    const payload: Record<string, unknown> = attemptId ? { action: "answer", walk_id: wizard?.walk.id, node_id: node.id, sequence } : { action: "answer", work_item_id: workItemId, walk_id: wizard?.walk.id, node_id: node.id, sequence };
    if (node.node_type === "choice") payload.option_key = answer;
    else payload.answer = answer;
    await send(payload);
  }

  // Everything below reads the loaded walk; null until it has loaded.
  const view = wizard ? derive(wizard, { editingSequence, answer, dispositionKey, callbackAssignee, callbackLocal, phase }) : null;

  function next() {
    setError("");
    if (phase === "outcome") setPhase(view?.isCallback ? "details" : "review");
    else if (phase === "details") setPhase("review");
  }
  function back() {
    setError("");
    if (phase === "review") setPhase(view?.isCallback ? "details" : "outcome");
    else if (phase === "details") setPhase("outcome");
  }
  function record() {
    const isCallback = dispositionKey === CALLBACK_KEY;
    if (attemptId) {
      // The dialer's own request: the callback details ride along whenever the outcome books one,
      // and the walk is named so its answers are stored with this attempt. Retries are safe: the
      // callback path keys on the attempt (dial:<attempt>:callback), and the attempt records once.
      void send({
        disposition: dispositionKey,
        ...(wizard?.walk.id && wizard.steps.length && !wizard.callMode?.earlierWalk ? { walk_id: wizard.walk.id } : {}),
        ...(isCallback ? {
          callback_local: callbackLocal,
          customer_timezone: wizard?.customerTimezone,
          ...(callbackSubtype.trim() ? { callback_note: callbackSubtype.trim() } : {}),
          ...(callbackAssignee ? { assigned_to: callbackAssignee } : {}),
        } : {}),
      }, "complete");
      return;
    }
    void send({
      action: "complete",
      work_item_id: workItemId,
      walk_id: wizard?.walk.id,
      disposition_key: dispositionKey,
      callback_subtype: isCallback && callbackSubtype ? callbackSubtype : undefined,
      callback_local: isCallback ? callbackLocal : undefined,
      callback_assigned_to: isCallback && callbackAssignee ? callbackAssignee : undefined,
      callback_idempotency_key: isCallback ? idempotencyKey : undefined,
    });
  }

  return {
    wizard, loading, saving, error, answer, setAnswer, editingSequence, phase,
    dispositionKey, setDispositionKey, callbackSubtype, setCallbackSubtype, callbackLocal, setCallbackLocal, callbackAssignee, setCallbackAssignee,
    load, beginEdit, cancelEdit, saveAnswer, next, back, record, view,
  };
}

export type DispositionWalk = ReturnType<typeof useDispositionWalk>;
export type WalkView = NonNullable<DispositionWalk["view"]>;

function derive(wizard: WizardData, s: { editingSequence: number | null; answer: unknown; dispositionKey: string; callbackAssignee: string; callbackLocal: string; phase: Phase }) {
  const nodesById = new Map(wizard.flow.nodes.map((node) => [node.id, node]));
  const node = s.editingSequence === null ? wizard.currentNode : nodesById.get(wizard.steps.find((step) => step.sequence === s.editingSequence)?.node_id ?? "") ?? null;
  const multi = node?.node_type === "multi_select";
  const selected = Array.isArray(s.answer) ? s.answer as string[] : [];
  // Call mode records against an open attempt (the route refuses a finished one), so the walk being
  // complete from an earlier call does not make THIS call's outcome recorded.
  const completed = !wizard.callMode && wizard.walk.status === "completed" && s.editingSequence === null;
  const options = wizard.outcomeOptions ?? null;
  const chosen = options?.find((item) => item.disposition_key === s.dispositionKey) ?? null;
  const isCallback = s.dispositionKey === CALLBACK_KEY;
  const customerName = wizard.customerName || String(wizard.lead.values.full_name ?? wizard.lead.values.name ?? "Customer");
  const myName = wizard.assignees.find((person) => person.id === wizard.currentUserId)?.name ?? "You";
  const assigneeName = s.callbackAssignee ? wizard.assignees.find((person) => person.id === s.callbackAssignee)?.name ?? "The assignee" : null;
  const orderedSteps = [...wizard.steps].sort((x, y) => x.sequence - y.sequence);
  const firstSequence = orderedSteps.length ? Math.min(...orderedSteps.map((step) => step.sequence)) : null;
  const callbackAt = isCallback && s.callbackLocal ? zonedLocalToUtc(s.callbackLocal, wizard.customerTimezone) : null;

  // The stepper is the walk as it happened, then the three fixed steps. No "N of 5": a configured
  // flow has as many questions as the tenant gave it.
  const walking = !completed && node !== null;
  const tail: Array<[Phase, string]> = [["outcome", "Outcome"], ["details", "Details"], ["review", "Review"]];
  const phaseIndex = tail.findIndex(([key]) => key === s.phase);
  const steps: Step[] = [
    ...orderedSteps.map((step) => ({ key: step.id, label: nodesById.get(step.node_id)?.label ?? step.node_label, state: (s.editingSequence === step.sequence ? "current" : "done") as Step["state"] })),
    ...(walking && s.editingSequence === null && node ? [{ key: `node:${node.id}`, label: node.label, state: "current" as const }] : []),
    ...tail.map(([key, label], index) => ({
      key,
      label,
      state: (completed ? "done" : walking ? "upcoming" : index < phaseIndex ? "done" : index === phaseIndex ? "current" : "upcoming") as Step["state"],
    })),
  ];
  return { nodesById, node, multi, selected, completed, options, chosen, isCallback, customerName, myName, assigneeName, orderedSteps, firstSequence, callbackAt, walking, steps };
}
