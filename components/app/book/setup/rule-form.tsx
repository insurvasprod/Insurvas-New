"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { PreviewDialog } from "@/components/app/book/setup/preview-table";
import { StagePicker } from "@/components/app/book/setup/stage-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { checkboxControl, control, Field, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { EVENT_LABELS, FILL_INS, fillInsWithoutValue, noteProblems, RULE_EVENTS, type RuleEvent } from "@/lib/pipelineRules/rules";
import type { BoardPipeline } from "@/lib/pipelineRules/store";
import { notify } from "@/lib/notify";

export type RuleDraft = { name: string; event: RuleEvent; carrierIds: string[]; fromStageIds: string[]; targetPipelineId: string; targetStageId: string; noteOn: boolean; noteTemplate: string };

const ENDPOINT = "/api/app/pipeline-rules";
const apiContent = (d: RuleDraft) => ({ event: d.event, carrier_ids: d.carrierIds, from_stage_ids: d.fromStageIds, target_pipeline_id: d.targetPipelineId, target_stage_id: d.targetStageId, note_on: d.noteOn, note_template: d.noteTemplate.trim() || null });
const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const GRACE_EVENTS: RuleEvent[] = ["first_payment_missed", "later_payment_missed"];

// ─── the title line's buttons (mockup r7 2·3: save on the title line) ─────────────────────────────────────────────
// The form is in the page, its buttons on the frame's title line; this small store joins the two.

type Bridge = { busy: "save" | "preview" | null; dirty: boolean; isNew: boolean; save: () => void; preview: () => void };
let bridge: Bridge | null = null;
const listeners = new Set<() => void>();
const publish = (next: Bridge | null) => { bridge = next; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** "Preview on today's data" and "Save rule" / "Save as a new version" (disabled until something changed), on the title line. */
export function RuleFormActions({ readOnly = false, reason }: { readOnly?: boolean; reason?: string }) {
  const state = useSyncExternalStore(subscribe, () => bridge, () => null);
  if (readOnly) return <Button type="button" disabled title={reason}>Save rule</Button>;
  const busy = state?.busy ?? null;
  return (
    <>
      <Button type="button" variant="outline" disabled={!state || busy !== null} onClick={() => state?.preview()}>{busy === "preview" ? "Previewing" : "Preview on today's data"}</Button>
      <Button type="button" disabled={!state || busy !== null || (!state.isNew && !state.dirty)} onClick={() => state?.save()}>{busy === "save" ? "Saving" : state && !state.isNew ? "Save as a new version" : "Save rule"}</Button>
    </>
  );
}

type Problem = { field: "name" | "carriers" | "target" | "note"; text: string };

/**
 * New rule (/new) and a rule's Rule tab (mockup r7 2·3, own page): the event, which cards it may move and where, the
 * note with fill-ins. Save and Preview sit on the title line (RuleFormActions). The form's first problem shows as the
 * error line by its field, not a toast. "Preview on today's data" runs the run's own checks on the form as it stands
 * in the preview dialog and writes nothing; "Save as a new version" keeps the old version with what it recorded.
 */
export function RuleForm({ ruleId, initial, board, carriers, readOnly, focusName = false }: { ruleId: string | null; initial: RuleDraft; board: BoardPipeline[]; carriers: Array<{ id: string; name: string }>; readOnly: boolean; focusName?: boolean }) {
  const router = useRouter();
  const scope = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [namedByHand, setNamedByHand] = useState(Boolean(ruleId) && initial.name !== EVENT_LABELS[initial.event].label);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [previewBody, setPreviewBody] = useState<Record<string, unknown> | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [everyCarrier, setEveryCarrier] = useState(initial.carrierIds.length === 0);
  const [tried, setTried] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const pipeline = board.find((p) => p.id === draft.targetPipelineId) ?? null;
  const problems = useMemo(() => {
    const list: Problem[] = [];
    if (!draft.name.trim()) list.push({ field: "name", text: "Name the rule." });
    if (!everyCarrier && draft.carrierIds.length === 0) list.push({ field: "carriers", text: "Choose at least one carrier, or every carrier." });
    if (!draft.targetPipelineId || !draft.targetStageId) list.push({ field: "target", text: "Choose the pipeline and stage the card moves to." });
    for (const text of noteProblems(draft.noteOn, draft.noteTemplate)) list.push({ field: "note", text });
    return list;
  }, [draft, everyCarrier]);
  // The first problem only, by its field, once a save or preview was tried.
  const first = tried ? problems[0] ?? null : null;
  const errorFor = (field: Problem["field"]) => (first?.field === field ? first.text : undefined);
  const unfilled = draft.noteOn ? fillInsWithoutValue(draft.noteTemplate, draft.event) : [];
  const set = (patch: Partial<RuleDraft>) => { setFailed(null); setDraft((current) => ({ ...current, ...patch })); };

  useEffect(() => {
    if (focusName && !readOnly) nameField.current?.focus();
  }, [focusName, readOnly]);

  function setEvent(event: RuleEvent) {
    set({ event, ...(namedByHand ? {} : { name: EVENT_LABELS[event].label }) });
  }

  function insertFill(key: string) {
    const area = note.current;
    const token = `{${key}}`;
    if (!area) return set({ noteTemplate: `${draft.noteTemplate}${token}` });
    const start = area.selectionStart ?? draft.noteTemplate.length;
    const end = area.selectionEnd ?? start;
    set({ noteTemplate: `${draft.noteTemplate.slice(0, start)}${token}${draft.noteTemplate.slice(end)}` });
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start + token.length, start + token.length); });
  }

  function focusProblem(problem: Problem) {
    const id = { name: "rule-name", carriers: "rule-carriers", target: draft.targetPipelineId ? "rule-stage" : "rule-pipeline", note: "rule-note" }[problem.field];
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function call(body: Record<string, unknown>) {
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "That did not work.");
    return data;
  }

  function runPreview() {
    setTried(true);
    if (problems.length) return focusProblem(problems[0]);
    setPreviewBody({ action: "preview", rule_id: ruleId, name: draft.name, content: apiContent({ ...draft, carrierIds: everyCarrier ? [] : draft.carrierIds }) });
    setPreviewOpen(true);
  }

  async function save(): Promise<boolean> {
    setTried(true);
    if (problems.length) { focusProblem(problems[0]); return false; }
    setBusy("save");
    setFailed(null);
    const content = apiContent({ ...draft, carrierIds: everyCarrier ? [] : draft.carrierIds });
    try {
      if (ruleId) {
        const data = await call({ action: "save_version", rule_id: ruleId, name: draft.name.trim(), content });
        notify.done(`Saved as version ${data.version}.`);
        router.refresh();
      } else {
        const data = await call({ action: "create", name: draft.name.trim(), content });
        notify.done("Rule saved. It starts in forecast: it records what it would do and moves nothing.");
        setDraft(initial);
        router.push(`/app/book-setup/pipeline-rules/${data.id}`);
      }
      return true;
    } catch (error) {
      // A refusal the person can fix is shown by the form, where the fix is (UI-CONSISTENCY §11).
      setFailed(error instanceof Error ? error.message : "The rule was not saved.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  // Hand the title line its buttons' state and handlers.
  const saveRef = useRef(save);
  const previewRef = useRef(runPreview);
  useEffect(() => { saveRef.current = save; previewRef.current = runPreview; });
  useEffect(() => {
    if (readOnly) return;
    publish({ busy, dirty, isNew: !ruleId, save: () => void saveRef.current(), preview: () => previewRef.current() });
  }, [busy, dirty, ruleId, readOnly]);
  useEffect(() => () => publish(null), []);

  return (
    <div ref={scope} className="flex flex-col gap-4">
      <LeaveGuard dirty={!readOnly && dirty} scope={scope} onSave={save} onDiscard={() => setDraft(initial)} what="this rule" />
      <fieldset disabled={readOnly || busy !== null} className="m-0 grid min-w-0 gap-4 border-0 p-0 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>When</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Name" htmlFor="rule-name" error={errorFor("name")}>
              <input ref={nameField} id="rule-name" className={control} maxLength={120} value={draft.name} aria-invalid={Boolean(errorFor("name"))} onChange={(e) => { setNamedByHand(true); set({ name: e.target.value }); }} />
            </Field>
            <Field label="Event" htmlFor="rule-event" hint={EVENT_LABELS[draft.event].meaning}>
              <select id="rule-event" className={control} value={draft.event} onChange={(e) => setEvent(e.target.value as RuleEvent)}>
                {RULE_EVENTS.map((event) => <option key={event} value={event}>{EVENT_LABELS[event].label}</option>)}
              </select>
            </Field>
            <Field label="Carriers" htmlFor="rule-carriers" error={errorFor("carriers")}>
              <select id="rule-carriers" className={control} value={everyCarrier ? "every" : "some"} aria-invalid={Boolean(errorFor("carriers"))} onChange={(e) => { setEveryCarrier(e.target.value === "every"); if (e.target.value === "every") set({ carrierIds: [] }); }}>
                <option value="every">Every carrier</option>
                <option value="some">Only the carriers I pick</option>
              </select>
            </Field>
            {!everyCarrier && (
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto" role="group" aria-label="Carriers">
                {carriers.map((c) => <ToggleChip key={c.id} selected={draft.carrierIds.includes(c.id)} onClick={() => set({ carrierIds: toggle(draft.carrierIds, c.id) })}>{c.name}</ToggleChip>)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Move the card</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* Round 6 (owner 2026-11-06): one control that says the answer, not every stage as a chip on the page. */}
            <Field label="Only when the card is in" htmlFor="rule-from">
              <StagePicker board={board} value={draft.fromStageIds} onChange={(next) => set({ fromStageIds: next })} disabled={readOnly || busy !== null} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pipeline" htmlFor="rule-pipeline">
                <select id="rule-pipeline" className={control} value={draft.targetPipelineId} aria-invalid={Boolean(errorFor("target")) && !draft.targetPipelineId} onChange={(e) => set({ targetPipelineId: e.target.value, targetStageId: "" })}>
                  <option value="">Choose</option>
                  {board.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Stage" htmlFor="rule-stage">
                <select id="rule-stage" className={control} value={draft.targetStageId} disabled={!pipeline} aria-invalid={Boolean(errorFor("target")) && !draft.targetStageId} onChange={(e) => set({ targetStageId: e.target.value })}>
                  <option value="">Choose</option>
                  {pipeline?.stages.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            {errorFor("target") && <span role="alert" className="-mt-2.5 text-xs text-[var(--error-ink)]">{errorFor("target")}</span>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Note on the lead</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--body)]">
              <input type="checkbox" className={checkboxControl} checked={draft.noteOn} onChange={(e) => set({ noteOn: e.target.checked })} />
              Add a note
            </label>
            {draft.noteOn && (
              <>
                <textarea ref={note} id="rule-note" aria-label="Note" aria-invalid={Boolean(errorFor("note"))} className={textareaControl} maxLength={2000} value={draft.noteTemplate} placeholder="First draft missed. Paid to {paid_to_date}, {days_past_due} days late. Carrier closes it in {days_left} days." onChange={(e) => set({ noteTemplate: e.target.value })} />
                {errorFor("note") && <span role="alert" className="text-xs text-[var(--error-ink)]">{errorFor("note")}</span>}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Fill-ins:</span>
                  {FILL_INS.map((key) => <Button key={key} type="button" variant="ghost" size="sm" className="font-mono text-xs" onClick={() => insertFill(key)}>{`{${key}}`}</Button>)}
                </div>
                {unfilled.length > 0 && <span className="text-xs text-[var(--warning-ink)]">{unfilled.map((k) => `{${k}}`).join(", ")} {unfilled.length === 1 ? "has" : "have"} no value for this event and will read “not known”.</span>}
              </>
            )}
            {failed && <span role="alert" className="text-xs text-[var(--error-ink)]">{failed}</span>}
            {/* Round 7 (2·3): what used to sit beside the New rule title is the form's last line. */}
            <span className="border-t border-border pt-3 text-xs text-muted-foreground">
              {ruleId ? "Saving makes a new version; the old one keeps what it recorded. The rule's mode does not change." : "Saving makes version 1, in forecast: it records what it would do and moves nothing."}
            </span>
          </CardContent>
        </Card>
      </fieldset>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} body={previewOpen ? previewBody : null} graceEvent={GRACE_EVENTS.includes(draft.event)} />
    </div>
  );
}
