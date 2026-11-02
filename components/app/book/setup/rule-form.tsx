"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { PreviewTable } from "@/components/app/book/setup/preview-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { checkboxControl, control, Field, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { EVENT_LABELS, FILL_INS, fillInsWithoutValue, noteProblems, RULE_EVENTS, type RuleEvent } from "@/lib/pipelineRules/rules";
import type { BoardPipeline, Preview } from "@/lib/pipelineRules/store";
import { notify } from "@/lib/notify";

export type RuleDraft = { name: string; event: RuleEvent; carrierIds: string[]; fromStageIds: string[]; targetPipelineId: string; targetStageId: string; noteOn: boolean; noteTemplate: string };

const ENDPOINT = "/api/app/pipeline-rules";
const apiContent = (d: RuleDraft) => ({ event: d.event, carrier_ids: d.carrierIds, from_stage_ids: d.fromStageIds, target_pipeline_id: d.targetPipelineId, target_stage_id: d.targetStageId, note_on: d.noteOn, note_template: d.noteTemplate.trim() || null });
const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/**
 * A rule's Rule tab (board BobE7): the event, which cards it may move and where, the note with
 * fill-ins. "Preview on today's data" runs the run's own checks on the form as it stands and writes
 * nothing; "Save as a new version" keeps the old version with what it recorded.
 */
export function RuleForm({ ruleId, initial, board, carriers, readOnly }: { ruleId: string | null; initial: RuleDraft; board: BoardPipeline[]; carriers: Array<{ id: string; name: string }>; readOnly: boolean }) {
  const router = useRouter();
  const scope = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [namedByHand, setNamedByHand] = useState(Boolean(ruleId) && initial.name !== EVENT_LABELS[initial.event].label);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [everyCarrier, setEveryCarrier] = useState(initial.carrierIds.length === 0);
  const note = useRef<HTMLTextAreaElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const pipeline = board.find((p) => p.id === draft.targetPipelineId) ?? null;
  const problems = useMemo(() => {
    const list = noteProblems(draft.noteOn, draft.noteTemplate);
    if (!draft.name.trim()) list.unshift("Name the rule.");
    if (!draft.targetPipelineId || !draft.targetStageId) list.unshift("Choose the pipeline and stage the card moves to.");
    if (!everyCarrier && draft.carrierIds.length === 0) list.unshift("Choose at least one carrier, or every carrier.");
    return list;
  }, [draft, everyCarrier]);
  const unfilled = draft.noteOn ? fillInsWithoutValue(draft.noteTemplate, draft.event) : [];
  const set = (patch: Partial<RuleDraft>) => setDraft((current) => ({ ...current, ...patch }));

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

  async function call(body: Record<string, unknown>) {
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "That did not work.");
    return data;
  }

  async function runPreview() {
    if (problems.length) return notify.block(problems[0]);
    setBusy("preview");
    try {
      const data = (await call({ action: "preview", rule_id: ruleId, name: draft.name, content: apiContent({ ...draft, carrierIds: everyCarrier ? [] : draft.carrierIds }) })) as unknown as Preview & { message?: string | null };
      if (!data.available) throw new Error(data.message ?? "Pipeline rules need a database update.");
      setPreview(data);
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The preview did not run.");
    } finally {
      setBusy(null);
    }
  }

  async function save(): Promise<boolean> {
    if (problems.length) { notify.block(problems[0]); return false; }
    setBusy("save");
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
      notify.block(error instanceof Error ? error.message : "The rule was not saved.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={scope} className="flex flex-col gap-4">
      <LeaveGuard dirty={!readOnly && dirty} scope={scope} onSave={save} onDiscard={() => setDraft(initial)} what="this rule" />
      <fieldset disabled={readOnly || busy !== null} className="m-0 grid min-w-0 gap-4 border-0 p-0 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>When</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Name" htmlFor="rule-name">
              <input id="rule-name" className={control} maxLength={120} value={draft.name} onChange={(e) => { setNamedByHand(true); set({ name: e.target.value }); }} />
            </Field>
            <Field label="Event" htmlFor="rule-event" hint={EVENT_LABELS[draft.event].meaning}>
              <select id="rule-event" className={control} value={draft.event} onChange={(e) => setEvent(e.target.value as RuleEvent)}>
                {RULE_EVENTS.map((event) => <option key={event} value={event}>{EVENT_LABELS[event].label}</option>)}
              </select>
            </Field>
            <Field label="Carriers" htmlFor="rule-carriers">
              <select id="rule-carriers" className={control} value={everyCarrier ? "every" : "some"} onChange={(e) => { setEveryCarrier(e.target.value === "every"); if (e.target.value === "every") set({ carrierIds: [] }); }}>
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
            <div>
              <span className="text-label text-[var(--body)]">Only when it is in</span>
              <span className="mt-1 block text-xs text-muted-foreground">{draft.fromStageIds.length ? `${draft.fromStageIds.length} ${draft.fromStageIds.length === 1 ? "stage" : "stages"} picked` : "Any stage (pick stages to narrow it)"}</span>
              <div className="mt-2 flex max-h-48 flex-col gap-2 overflow-y-auto" role="group" aria-label="From stages">
                {board.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-full text-xs text-muted-foreground">{p.name}</span>
                    {p.stages.filter((s) => !s.archived || draft.fromStageIds.includes(s.id)).map((s) => <ToggleChip key={s.id} selected={draft.fromStageIds.includes(s.id)} onClick={() => set({ fromStageIds: toggle(draft.fromStageIds, s.id) })}>{s.name}</ToggleChip>)}
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pipeline" htmlFor="rule-pipeline">
                <select id="rule-pipeline" className={control} value={draft.targetPipelineId} onChange={(e) => set({ targetPipelineId: e.target.value, targetStageId: "" })}>
                  <option value="">Choose</option>
                  {board.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Stage" htmlFor="rule-stage">
                <select id="rule-stage" className={control} value={draft.targetStageId} disabled={!pipeline} onChange={(e) => set({ targetStageId: e.target.value })}>
                  <option value="">Choose</option>
                  {pipeline?.stages.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
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
                <textarea ref={note} aria-label="Note" className={textareaControl} maxLength={2000} value={draft.noteTemplate} placeholder="First draft missed. Paid to {paid_to_date}, {days_past_due} days late. Carrier closes it in {days_left} days." onChange={(e) => set({ noteTemplate: e.target.value })} />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Fill-ins:</span>
                  {FILL_INS.map((key) => <Button key={key} type="button" variant="ghost" size="sm" className="font-mono text-xs" onClick={() => insertFill(key)}>{`{${key}}`}</Button>)}
                </div>
                {unfilled.length > 0 && <span className="text-xs text-[var(--warning-ink)]">{unfilled.map((k) => `{${k}}`).join(", ")} {unfilled.length === 1 ? "has" : "have"} no value for this event and will read “not known”.</span>}
              </>
            )}
          </CardContent>
        </Card>
      </fieldset>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {problems.length > 0 && dirty && <span className="mr-auto text-xs text-[var(--warning-ink)]">{problems[0]}</span>}
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void runPreview()}>{busy === "preview" ? "Previewing" : "Preview on today's data"}</Button>
          <Button type="button" disabled={busy !== null || (Boolean(ruleId) && !dirty)} onClick={() => void save()}>{busy === "save" ? "Saving" : ruleId ? "Save as a new version" : "Save rule"}</Button>
        </div>
      )}

      {preview && <PreviewTable lines={preview.lines} asOf={preview.asOf} title="Preview on today's data" />}
      {preview && preview.carriersWithoutGrace.length > 0 && (draft.event === "first_payment_missed" || draft.event === "later_payment_missed") && (
        <span className="text-xs text-[var(--warning-ink)]">{preview.carriersWithoutGrace.length} {preview.carriersWithoutGrace.length === 1 ? "carrier has" : "carriers have"} policies behind but no grace set, so no missed payment is counted for them. Set one in Carrier rules.</span>
      )}
    </div>
  );
}
