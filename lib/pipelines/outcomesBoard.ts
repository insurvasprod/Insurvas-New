// Settings › Pipelines & outcomes (owner pick "V2, round 2", 2026-10-27): the screen's draft, where each
// outcome sends a lead, and the requests a Save makes. Plain module, client-safe; node --test pins it.
//
// One page replaces Settings › Pipelines and Settings › Dispositions. Nothing is written until Save; a
// Save runs the same per-row endpoints those two screens used, in an order that lets a new stage or a
// new outcome be referred to before it exists.

import { resolveOutcomeStages, sameName, type OutcomeStageRow, type PipelineOutcomeRow } from "./outcomeResolution.ts";
import type { NextActionKind } from "../dispositions/nextAction.ts";

export type StageType = "open" | "won" | "lost";
export type BoardStage = {
  id: string;
  name: string;
  stage_type: StageType;
  color: string;
  description: string;
  /** Stage rules (20260925100000): null = no limit. */
  timeAllowedMinutes: number | null;
  countsAsWorked: boolean | null;
  archived: boolean;
  isNew: boolean;
};
export type BoardPipeline = { id: string; name: string; partner_type: string | null; is_default: boolean; stages: BoardStage[] };
export type BoardOutcome = {
  id: string;
  key: string;
  label: string;
  worked: boolean;
  closesAs: "completed" | "dropped";
  active: boolean;
  next: { kind: NextActionKind; minutes: number | null } | null;
  isNew: boolean;
};
/** own[pipelineId][outcomeKey]: that pipeline's own choice — a stage id, or null for "stays where it is". */
export type BoardDoc = { pipelines: BoardPipeline[]; outcomes: BoardOutcome[]; own: Record<string, Record<string, string | null>> };

export type Destination = { kind: "stage"; stageId: string } | { kind: "elsewhere"; stageId: string; pipelineId: string } | { kind: "stays" };

/** The 8 stage colours the lead board draws with (the old stage editor's swatches). */
export const STAGE_SWATCHES = ["#0a8769", "#4457c7", "#e04e00", "#0091a8", "#b02a9b", "#59606b", "#c62828", "#b35c00"] as const;
export const NEW_STAGE_COLOR: Record<StageType, string> = { open: "#4457c7", won: "#0a8769", lost: "#c62828" };

export const NEW_PREFIX = "new:";
export const isTemp = (id: string) => id.startsWith(NEW_PREFIX);

export const liveStages = (pipeline: BoardPipeline) => pipeline.stages.filter((stage) => !stage.archived);

/**
 * Where each outcome sends a lead in one pipeline, in the database's order (outcomeResolution.ts), and
 * whether that is the default (no choice of the pipeline's own).
 */
export function destinations(doc: BoardDoc, pipelineId: string, agency: Readonly<Record<string, string>>): Map<string, { dest: Destination; isDefault: boolean }> {
  const stageInfo = new Map<string, { pipelineId: string; archived: boolean }>();
  for (const pipeline of doc.pipelines) for (const stage of pipeline.stages) stageInfo.set(stage.id, { pipelineId: pipeline.id, archived: stage.archived });
  const pipeline = doc.pipelines.find((item) => item.id === pipelineId);
  const live = pipeline ? liveStages(pipeline) : [];
  const labelOf = new Map(doc.outcomes.map((outcome) => [outcome.key, outcome.label]));
  const ownRows: PipelineOutcomeRow[] = Object.entries(doc.own[pipelineId] ?? {}).map(([key, stageId]) => ({ pipeline_id: pipelineId, disposition_key: key, stage_id: stageId }));
  const agencyRows: OutcomeStageRow[] = Object.entries(agency).map(([key, stageId]) => ({ disposition_key: key, stage_id: stageId }));
  const resolved = resolveOutcomeStages(agencyRows, ownRows, pipelineId, (id) => stageInfo.has(id) && !stageInfo.get(id)!.archived, {
    pipelineOfStage: (id) => stageInfo.get(id)?.pipelineId,
    stageNamedLike: (key) => live.find((stage) => sameName(stage.name, labelOf.get(key) ?? "\u0000"))?.id,
    keys: doc.outcomes.map((outcome) => outcome.key),
  });
  const out = new Map<string, { dest: Destination; isDefault: boolean }>();
  for (const outcome of doc.outcomes) {
    const stageId = resolved.get(outcome.key);
    const owner = stageId ? stageInfo.get(stageId)?.pipelineId : undefined;
    const dest: Destination = !stageId ? { kind: "stays" } : owner === pipelineId ? { kind: "stage", stageId } : { kind: "elsewhere", stageId, pipelineId: owner ?? "" };
    out.set(outcome.key, { dest, isDefault: !(outcome.key in (doc.own[pipelineId] ?? {})) });
  }
  return out;
}

/** A permanent key for a new outcome, from its name: "Left a message" → left_a_message (unique). */
export function keyFor(label: string, taken: ReadonlySet<string>) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70);
  const start = /^[a-z]/.test(base) ? base : base ? `outcome_${base}` : "outcome";
  let key = start;
  for (let n = 2; taken.has(key); n += 1) key = `${start}_${n}`;
  return key;
}

/** What is wrong with the draft before it can be saved; empty when it can be. */
export function draftProblems(doc: BoardDoc): string[] {
  const problems: string[] = [];
  for (const pipeline of doc.pipelines) {
    const live = liveStages(pipeline);
    if (!pipeline.name.trim()) problems.push("A pipeline has no name.");
    if (live.length === 0) problems.push(`${pipeline.name || "A pipeline"} needs at least one stage.`);
    const seen = new Set<string>();
    for (const stage of live) {
      const name = stage.name.trim().toLowerCase();
      if (!name) problems.push(`A stage in ${pipeline.name} has no name.`);
      else if (seen.has(name)) problems.push(`${pipeline.name} has two stages called “${stage.name.trim()}”.`);
      seen.add(name);
    }
  }
  for (const outcome of doc.outcomes) if (!outcome.label.trim()) problems.push("An outcome has no name.");
  return [...new Set(problems)];
}

export type SaveOp =
  | { op: "patchPipeline"; pipelineId: string; body: Record<string, unknown> }
  | { op: "archiveStage"; pipelineId: string; stageId: string }
  | { op: "createStage"; pipelineId: string; tempId: string; body: { name: string; stage_type: StageType; color: string; description?: string } }
  | { op: "patchStage"; pipelineId: string; stageId: string; body: Record<string, unknown> }
  | { op: "stageRules"; stageId: string; time_allowed_minutes: number | null; counts_as_worked: boolean }
  | { op: "reorder"; pipelineId: string; stageIds: string[] }
  | { op: "createOutcome"; key: string; body: Record<string, unknown> }
  | { op: "patchOutcome"; id: string; body: Record<string, unknown> }
  | { op: "setRow"; pipelineId: string; key: string; stageId: string | null }
  | { op: "removeRow"; rowId: string };

/**
 * The requests a Save makes, in order: pipelines, then each pipeline's stages (archive, create, edit,
 * rules, order), then outcomes, then each pipeline's own choices. A new stage is referred to by its
 * temporary id (the caller swaps in the real one once created); a new outcome already has its final key.
 */
export function planSave(saved: BoardDoc, draft: BoardDoc, rowIds: Readonly<Record<string, string>>, ready: { rules: boolean; nextAction: boolean }): SaveOp[] {
  const ops: SaveOp[] = [];
  for (const pipeline of draft.pipelines) {
    const before = saved.pipelines.find((item) => item.id === pipeline.id);
    if (!before) continue;
    const body: Record<string, unknown> = {};
    if (pipeline.name.trim() !== before.name) body.name = pipeline.name.trim();
    if (pipeline.partner_type !== before.partner_type) body.partner_type = pipeline.partner_type;
    if (pipeline.is_default !== before.is_default) body.is_default = pipeline.is_default;
    if (Object.keys(body).length) ops.push({ op: "patchPipeline", pipelineId: pipeline.id, body });
  }
  for (const pipeline of draft.pipelines) {
    const before = saved.pipelines.find((item) => item.id === pipeline.id);
    const beforeStages = new Map((before?.stages ?? []).map((stage) => [stage.id, stage]));
    for (const stage of pipeline.stages) if (stage.archived && !stage.isNew && beforeStages.get(stage.id) && !beforeStages.get(stage.id)!.archived) ops.push({ op: "archiveStage", pipelineId: pipeline.id, stageId: stage.id });
    for (const stage of liveStages(pipeline)) {
      const old = beforeStages.get(stage.id);
      if (stage.isNew) {
        ops.push({ op: "createStage", pipelineId: pipeline.id, tempId: stage.id, body: { name: stage.name.trim(), stage_type: stage.stage_type, color: stage.color, ...(stage.description.trim() ? { description: stage.description.trim() } : {}) } });
      } else if (old) {
        const body: Record<string, unknown> = {};
        if (stage.name.trim() !== old.name) body.name = stage.name.trim();
        if (stage.stage_type !== old.stage_type) body.stage_type = stage.stage_type;
        if (stage.color !== old.color) body.color = stage.color;
        if (stage.description.trim() !== old.description) body.description = stage.description.trim();
        if (Object.keys(body).length) ops.push({ op: "patchStage", pipelineId: pipeline.id, stageId: stage.id, body });
      }
      const rulesChanged = stage.isNew ? stage.timeAllowedMinutes !== null || stage.countsAsWorked === true : old && (stage.timeAllowedMinutes !== old.timeAllowedMinutes || (stage.countsAsWorked ?? false) !== (old.countsAsWorked ?? false));
      if (ready.rules && rulesChanged) ops.push({ op: "stageRules", stageId: stage.id, time_allowed_minutes: stage.timeAllowedMinutes, counts_as_worked: stage.countsAsWorked === true });
    }
    const order = liveStages(pipeline).map((stage) => stage.id);
    const oldOrder = (before ? liveStages(before) : []).map((stage) => stage.id).filter((id) => order.includes(id));
    const keptOrder = order.filter((id) => !isTemp(id));
    const appendedOnly = order.slice(0, keptOrder.length).every((id, index) => id === keptOrder[index]);
    if (keptOrder.join() !== oldOrder.join() || !appendedOnly) ops.push({ op: "reorder", pipelineId: pipeline.id, stageIds: order });
  }
  for (const outcome of draft.outcomes) {
    const next = ready.nextAction && outcome.next ? { next_action: outcome.next.kind, next_action_minutes: outcome.next.minutes } : {};
    const core = { label: outcome.label.trim(), counts_as_work_completed: outcome.worked, closes_as: outcome.closesAs };
    if (outcome.isNew) { ops.push({ op: "createOutcome", key: outcome.key, body: { kind: "disposition", disposition_key: outcome.key, ...core, ...next } }); continue; }
    const old = saved.outcomes.find((item) => item.id === outcome.id);
    if (!old) continue;
    const changed = core.label !== old.label || outcome.worked !== old.worked || outcome.closesAs !== old.closesAs || outcome.active !== old.active || JSON.stringify(outcome.next) !== JSON.stringify(old.next);
    if (changed) ops.push({ op: "patchOutcome", id: outcome.id, body: { kind: "disposition", id: outcome.id, ...core, is_active: outcome.active, ...next } });
  }
  for (const pipeline of draft.pipelines) {
    const now = draft.own[pipeline.id] ?? {};
    const was = saved.own[pipeline.id] ?? {};
    for (const [key, stageId] of Object.entries(now)) if (!(key in was) || was[key] !== stageId) ops.push({ op: "setRow", pipelineId: pipeline.id, key, stageId });
    for (const key of Object.keys(was)) if (!(key in now) && rowIds[`${pipeline.id}:${key}`]) ops.push({ op: "removeRow", rowId: rowIds[`${pipeline.id}:${key}`] });
  }
  return ops;
}

/** Why you would pick each choice: the (i) beside every button (owner, 2026-10-27). */
export const WHY_NEXT: Record<NextActionKind, string> = {
  cadence: "Back on your dialing cadence: the next scheduled attempt calls them. Pick it when the call just did not connect and the normal rhythm should carry on.",
  retry: "Calls again after the time you choose, ahead of the cadence. Good when you will probably reach them soon, like a busy line or a voicemail.",
  rest: "Stops calling for a while, then the lead comes back. Use it when they said not now, so you do not wear the lead out.",
  close: "No more calls. Use it when the lead is finished: sold, submitted, a wrong number or not a fit.",
  callback: "Asks the agent for a day and time and books it; the lead is called back then.",
  suppress: "Adds the number to your do-not-call list and never calls it again. Required when someone asks not to be called.",
};
export const WHY_KIND: Record<StageType | "stay" | "elsewhere", string> = {
  open: "Open stage: the lead is still being worked. Pick it when there is a next step with this person.",
  won: "Won stage: it became business. Pick it when the sale or the application went through.",
  lost: "Lost stage: the lead is closed. Pick it when there is nothing more to do with it.",
  stay: "Keeps the lead in the stage it is in now. Pick it for calls that did not reach anyone, so the lead does not move.",
  elsewhere: "This outcome moves the lead into a stage of another pipeline (its agency-wide stage). Pick a stage here to keep the lead in this pipeline.",
};
export const WHY_WORKED = "Worked: the call counts toward the agent's worked leads, because they had a real conversation. Not worked: it does not count, like a no answer or a busy line.";
export const WHY_CLOSES = "When this outcome ends the work on a lead: Completed counts it as finished work, Dropped as work given up. It only matters for outcomes that stop calling.";

/** Preset times, in minutes: retry soon, rest for a while, and how long a lead may sit in a stage. */
export const RETRY_PRESETS = [15, 120, 1440];
export const REST_PRESETS = [43200, 129600];
export const TIME_ALLOWED_PRESETS = [15, 120, 1440, 4320];

/** "15 min", "2 h", "1 day", "30 days". */
export function shortDuration(minutes: number | null | undefined) {
  if (!minutes) return "";
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** Which icon an outcome shows, read from its name (outcomes store no icon). */
export type OutcomeIcon = "noAnswer" | "voicemail" | "busy" | "wrong" | "callback" | "quote" | "application" | "sold" | "notInterested" | "notQualified" | "doNotCall" | "other";
export function iconFor(label: string, key: string): OutcomeIcon {
  const text = `${label} ${key}`.toLowerCase();
  if (/do.?not.?call|dnc/.test(text)) return "doNotCall";
  if (/no.?answer|no.?pick/.test(text)) return "noAnswer";
  if (/voicemail|message/.test(text)) return "voicemail";
  if (/busy/.test(text)) return "busy";
  if (/wrong|disconnect|bad.?number/.test(text)) return "wrong";
  if (/call.?back|callback/.test(text)) return "callback";
  if (/quot/.test(text)) return "quote";
  if (/submit|application|underwrit/.test(text)) return "application";
  if (/sold|sale|won|convert/.test(text)) return "sold";
  if (/not.?interest|declin/.test(text)) return "notInterested";
  if (/qualif|dq/.test(text)) return "notQualified";
  return "other";
}

/** Outcomes that reached someone draw in green; the rest in grey (the board's colour split). */
export const reachedSomeone = (next: BoardOutcome["next"]) => !next || !(next.kind === "cadence" || next.kind === "retry");
