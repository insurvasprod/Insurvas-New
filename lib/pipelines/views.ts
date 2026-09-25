import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isMissingFunction, isMissingSchema } from "./schemaGap";

/**
 * What the four pipeline views (Stages · Board · Table · List) need beyond the leads themselves,
 * and the one path a lead takes between stages from any of them.
 *
 * The rule the screens enforce: **a stage change is a disposition**. The disposition's stage — one
 * per outcome, agency-wide (stage_dispositions) — is where the lead goes, the outcome is stamped on
 * the work item, and the move is written to tenant_lead_stage_events. A stage with no disposition
 * mapped to it cannot be entered from these screens.
 *
 * Migration 20260925100000 adds the per-stage rules (time allowed, counts as worked), draft
 * pipelines, the history table and apply_lead_disposition_move. Until it is applied everything here
 * still answers — `schemaReady` is false, the rules are null, and a move falls back to the older
 * move_lead_to_disposition plus a separate stamp on the work item, with no history row.
 */

export type StageRule = { timeAllowedMinutes: number | null; countsAsWorked: boolean | null };
export type MappedDisposition = { key: string; label: string; nextAction: string | null; nextActionMinutes: number | null };
export type PipelineViewContext = {
  schemaReady: boolean;
  stageRules: Record<string, StageRule>;
  /** Dispositions that land on each stage, by stage id. */
  dispositionsByStage: Record<string, MappedDisposition[]>;
  /** Active dispositions with no stage: an agent can pick them, and the lead does not move. */
  unmapped: Array<{ key: string; label: string; uses: number }>;
  draftPipelineIds: string[];
  /** Leads whose stage disagrees between the lead row and its work item. Null when not checked. */
  stageDrift: number | null;
};
export type StageEvent = {
  id: string;
  fromStageId: string | null;
  toStageId: string;
  dispositionKey: string | null;
  source: string;
  actorName: string | null;
  at: string;
};
export type MoveResult = { leadId: string; fromStageId: string | null; toPipelineId: string; toStageId: string; recorded: boolean };

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  not(column: string, operator: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  update(values: Row): Query;
};
type Db = { from(table: string): Query; rpc(name: string, args: Row): PromiseLike<Result> };
const db = () => getSupabaseServiceClient() as unknown as Db;
const rows = (result: Result) => (Array.isArray(result.data) ? (result.data as Row[]) : []);
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Outcomes that cannot be applied from a board or table: they need what only the call path collects. */
export const CALL_PATH_ONLY: Record<string, string> = {
  callback: "A callback needs a time in the customer's timezone. Book it from the lead or the dialer.",
  suppress: "Do not call adds the number to the do-not-call list. Record it from the lead or the dialer, where the suppression is written.",
};

export async function pipelineViewContext(tenantId: string): Promise<PipelineViewContext> {
  const client = db();
  const [stagesWithRules, pipelines, mappings, dispositions, queueStages] = await Promise.all([
    client.from("tenant_pipeline_stages").select("id, pipeline_id, time_allowed_minutes, counts_as_worked, tenant_pipelines!inner(tenant_id)").eq("tenant_pipelines.tenant_id", tenantId),
    client.from("tenant_pipelines").select("id, status").eq("tenant_id", tenantId),
    client.from("stage_dispositions").select("stage_id, disposition_key").eq("tenant_id", tenantId),
    client.from("dispositions").select("disposition_key, label, is_active, next_action, next_action_minutes, sort_order").eq("tenant_id", tenantId).order("sort_order"),
    client.from("lead_queue").select("lead_id, stage_id").eq("tenant_id", tenantId).limit(5000),
  ]);
  const schemaReady = !isMissingSchema(stagesWithRules.error) && !isMissingSchema(pipelines.error);

  const stageRules: Record<string, StageRule> = {};
  if (schemaReady && !stagesWithRules.error) {
    for (const row of rows(stagesWithRules)) {
      stageRules[text(row.id)] = {
        timeAllowedMinutes: row.time_allowed_minutes == null ? null : Number(row.time_allowed_minutes),
        countsAsWorked: typeof row.counts_as_worked === "boolean" ? row.counts_as_worked : null,
      };
    }
  }

  // next_action arrives with 20260924240200; read without it when it is not there yet.
  let dispositionRows = rows(dispositions);
  if (isMissingSchema(dispositions.error)) {
    dispositionRows = rows(await client.from("dispositions").select("disposition_key, label, is_active, sort_order").eq("tenant_id", tenantId).order("sort_order"));
  } else if (dispositions.error) {
    throw new Error(`Could not load dispositions: ${dispositions.error.message}`);
  }
  if (mappings.error) throw new Error(`Could not load disposition mappings: ${mappings.error.message}`);

  const active = new Map(dispositionRows.filter((row) => row.is_active !== false).map((row) => [text(row.disposition_key), row]));
  const dispositionsByStage: Record<string, MappedDisposition[]> = {};
  const mappedKeys = new Set<string>();
  for (const mapping of rows(mappings)) {
    const key = text(mapping.disposition_key);
    const row = active.get(key);
    if (!row) continue;
    mappedKeys.add(key);
    const stageId = text(mapping.stage_id);
    (dispositionsByStage[stageId] ??= []).push({
      key,
      label: text(row.label) || key,
      nextAction: row.next_action == null ? null : text(row.next_action),
      nextActionMinutes: row.next_action_minutes == null ? null : Number(row.next_action_minutes),
    });
  }

  // How often each unmapped outcome was recorded, off the work item both the dialer and the
  // outcome wizard stamp. Counted only for the unmapped ones, so the read stays small.
  const unmappedKeys = [...active.keys()].filter((key) => !mappedKeys.has(key));
  const uses = await Promise.all(
    unmappedKeys.map(async (key) => {
      const result = await client.from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("disposition", key);
      return [key, (result as unknown as { count: number | null }).count ?? 0] as const;
    }),
  );
  const useCount = new Map(uses);

  // Drift: a lead's stage is stored on its own row and on its work item; count the disagreements.
  let stageDrift: number | null = null;
  const queueRows = rows(queueStages);
  if (!queueStages.error && queueRows.length > 0 && queueRows.length < 5000) {
    const ids = queueRows.map((row) => text(row.lead_id));
    const leadStage = new Map<string, string>();
    for (let start = 0; start < ids.length; start += 150) {
      const page = await client.from("agent_leads").select("id, stage_id").eq("tenant_id", tenantId).in("id", ids.slice(start, start + 150));
      for (const row of rows(page)) leadStage.set(text(row.id), text(row.stage_id));
    }
    stageDrift = queueRows.filter((row) => leadStage.has(text(row.lead_id)) && leadStage.get(text(row.lead_id)) !== text(row.stage_id)).length;
  }

  return {
    schemaReady,
    stageRules,
    dispositionsByStage,
    unmapped: unmappedKeys.map((key) => ({ key, label: text(active.get(key)?.label) || key, uses: useCount.get(key) ?? 0 })).sort((a, b) => b.uses - a.uses),
    draftPipelineIds: schemaReady ? rows(pipelines).filter((row) => row.status === "draft").map((row) => text(row.id)) : [],
    stageDrift,
  };
}

export type LibraryEntry = {
  key: string;
  label: string;
  retired: boolean;
  nextAction: string | null;
  nextActionMinutes: number | null;
  /** The one stage the outcome sends a lead to, agency-wide; null when it lands nowhere. */
  stageId: string | null;
  /** Leads whose latest outcome is this one (off the work item), in total and in the last 30 days. */
  carrying: number;
  recent: number;
};

/**
 * The disposition library: every outcome, retired ones included, with what it does, where it lands
 * and how much it is used. Counted per key with head-only counts, so nothing but the numbers is read.
 */
export async function dispositionLibrary(tenantId: string): Promise<LibraryEntry[]> {
  const client = db();
  let catalogue = await client.from("dispositions").select("disposition_key, label, is_active, next_action, next_action_minutes, sort_order").eq("tenant_id", tenantId).order("sort_order");
  if (isMissingSchema(catalogue.error)) catalogue = await client.from("dispositions").select("disposition_key, label, is_active, sort_order").eq("tenant_id", tenantId).order("sort_order") as typeof catalogue;
  if (catalogue.error) throw new Error(`Could not load dispositions: ${catalogue.error.message}`);
  const mappings = await client.from("stage_dispositions").select("stage_id, disposition_key").eq("tenant_id", tenantId);
  if (mappings.error) throw new Error(`Could not load disposition mappings: ${mappings.error.message}`);
  const stageOf = new Map(rows(mappings).map((row) => [text(row.disposition_key), text(row.stage_id)]));
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return Promise.all(rows(catalogue).map(async (row) => {
    const key = text(row.disposition_key);
    const count = (result: unknown) => (result as { count: number | null }).count ?? 0;
    const [carrying, recent] = await Promise.all([
      client.from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("disposition", key),
      client.from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("disposition", key).gte("disposition_at", since),
    ]);
    return {
      key,
      label: text(row.label) || key,
      retired: row.is_active === false,
      nextAction: row.next_action == null ? null : text(row.next_action),
      nextActionMinutes: row.next_action_minutes == null ? null : Number(row.next_action_minutes),
      stageId: stageOf.get(key) ?? null,
      carrying: count(carrying),
      recent: count(recent),
    };
  }));
}

export class MoveError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "MoveError";
  }
}

const MOVE_MESSAGES: Record<string, string> = {
  disposition_not_active: "That disposition is retired. Pick one that is still in use.",
  disposition_not_mapped: "That disposition has no stage to move the lead to. Map it to a stage first.",
  lead_not_found: "That lead is not in your workspace.",
  invalid_move_source: "That is not a screen a lead can be moved from.",
};

/**
 * Move one lead by applying a disposition. The caller has already checked the role; this checks
 * that the outcome can be applied here at all (not a callback or do-not-call, which need the call
 * path) and then makes the move in one write.
 */
export async function moveLeadWithDisposition(input: { tenantId: string; leadId: string; dispositionKey: string; actorId: string; source: "board" | "table" | "list" | "lead_detail" }): Promise<MoveResult> {
  const client = db();
  const disposition = await client.from("dispositions").select("disposition_key, is_active, next_action").eq("tenant_id", input.tenantId).eq("disposition_key", input.dispositionKey).limit(1);
  const row = isMissingSchema(disposition.error)
    ? rows(await client.from("dispositions").select("disposition_key, is_active").eq("tenant_id", input.tenantId).eq("disposition_key", input.dispositionKey).limit(1))[0]
    : rows(disposition)[0];
  if (!row) throw new MoveError("disposition_not_found", "That disposition does not exist in your workspace.");
  const nextAction = text(row.next_action) || (input.dispositionKey === "do_not_call" ? "suppress" : input.dispositionKey === "callback_scheduled" ? "callback" : "");
  if (CALL_PATH_ONLY[nextAction]) throw new MoveError("call_path_only", CALL_PATH_ONLY[nextAction]);

  const moved = await client.rpc("apply_lead_disposition_move", { p_tenant_id: input.tenantId, p_lead_id: input.leadId, p_disposition_key: input.dispositionKey, p_actor: input.actorId, p_source: input.source });
  if (!moved.error) {
    const result = rows(moved)[0] ?? (moved.data as Row);
    return { leadId: input.leadId, fromStageId: text(result?.from_stage_id) || null, toPipelineId: text(result?.to_pipeline_id), toStageId: text(result?.to_stage_id), recorded: true };
  }
  if (!isMissingFunction(moved.error)) {
    const code = Object.keys(MOVE_MESSAGES).find((key) => moved.error?.message.includes(key));
    throw new MoveError(code ?? "move_failed", code ? MOVE_MESSAGES[code] : `Could not move the lead: ${moved.error.message}`);
  }

  // Before 20260925100000: the older function moves the stage on all three rows in one write; the
  // outcome is then stamped on the work item. No history row exists to write to yet.
  const before = rows(await client.from("agent_leads").select("stage_id").eq("tenant_id", input.tenantId).eq("id", input.leadId).limit(1))[0];
  const fallback = await client.rpc("move_lead_to_disposition", { p_tenant_id: input.tenantId, p_lead_id: input.leadId, p_disposition_key: input.dispositionKey });
  if (fallback.error) {
    const code = Object.keys(MOVE_MESSAGES).find((key) => fallback.error?.message.includes(key));
    throw new MoveError(code ?? "move_failed", code ? MOVE_MESSAGES[code] : `Could not move the lead: ${fallback.error.message}`);
  }
  const result = rows(fallback)[0] ?? (fallback.data as Row);
  await client.from("lead_queue").update({ disposition: input.dispositionKey, disposition_at: new Date().toISOString(), disposition_by: input.actorId }).eq("tenant_id", input.tenantId).eq("lead_id", input.leadId);
  return { leadId: input.leadId, fromStageId: text(before?.stage_id) || null, toPipelineId: text(result?.pipeline_id), toStageId: text(result?.stage_id), recorded: false };
}

/** Write an owner's direct stage correction to the history, when the history exists. */
export async function recordOwnerStageFix(input: { tenantId: string; leadId: string; fromPipelineId: string | null; fromStageId: string | null; toPipelineId: string; toStageId: string; actorId: string }) {
  const client = getSupabaseServiceClient() as unknown as { from(table: string): { insert(values: Row): PromiseLike<Result> } };
  const result = await client.from("tenant_lead_stage_events").insert({
    tenant_id: input.tenantId, lead_id: input.leadId, from_pipeline_id: input.fromPipelineId, from_stage_id: input.fromStageId,
    to_pipeline_id: input.toPipelineId, to_stage_id: input.toStageId, disposition_key: null, source: "owner_fix", actor_user_id: input.actorId,
  });
  if (result.error && !isMissingSchema(result.error)) throw new Error(`Could not record the stage change: ${result.error.message}`);
}

/** A lead's stage history, newest first. Empty until the history table exists. */
export async function leadStageHistory(tenantId: string, leadId: string): Promise<StageEvent[]> {
  const client = db();
  const result = await client.from("tenant_lead_stage_events").select("id, from_stage_id, to_stage_id, disposition_key, source, actor_user_id, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(50);
  if (isMissingSchema(result.error)) return [];
  if (result.error) throw new Error(`Could not load the stage history: ${result.error.message}`);
  const events = rows(result);
  const actorIds = [...new Set(events.map((row) => text(row.actor_user_id)).filter(Boolean))];
  const actors = actorIds.length ? rows(await client.from("users").select("id, name").in("id", actorIds)) : [];
  const names = new Map(actors.map((row) => [text(row.id), text(row.name)]));
  return events.map((row) => ({
    id: text(row.id),
    fromStageId: text(row.from_stage_id) || null,
    toStageId: text(row.to_stage_id),
    dispositionKey: text(row.disposition_key) || null,
    source: text(row.source),
    actorName: names.get(text(row.actor_user_id)) ?? null,
    at: text(row.created_at),
  }));
}

/**
 * A stage's rules: how long a lead may sit in it and whether reaching it counts as worked. Owner
 * only (the route checks). Needs 20260925100000; before it, a clear "not yet" rather than a failure.
 */
export async function updateStageRules(tenantId: string, stageId: string, input: { timeAllowedMinutes?: number | null; countsAsWorked?: boolean }) {
  const client = getSupabaseServiceClient() as unknown as { from(table: string): { select(columns: string): Query; update(values: Row): Query } };
  const owned = rows(await (client.from("tenant_pipeline_stages").select("id, tenant_pipelines!inner(tenant_id)") as Query).eq("id", stageId).eq("tenant_pipelines.tenant_id", tenantId).limit(1));
  if (!owned.length) throw new MoveError("stage_not_found", "That stage is not in your workspace.");
  const patch: Row = { updated_at: new Date().toISOString() };
  if (input.timeAllowedMinutes !== undefined) {
    const minutes = input.timeAllowedMinutes;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600)) throw new MoveError("invalid_time_allowed", "Time allowed must be between 1 minute and 365 days.");
    patch.time_allowed_minutes = minutes;
  }
  if (input.countsAsWorked !== undefined) patch.counts_as_worked = input.countsAsWorked;
  const result = await client.from("tenant_pipeline_stages").update(patch).eq("id", stageId);
  if (isMissingSchema(result.error)) throw new MoveError("schema_pending", "Stage rules need a database update (20260925100000) that has not been applied yet.");
  if (result.error) throw new Error(`Could not save the stage rules: ${result.error.message}`);
}

/** Draft or live. A draft is never a default, so no lead is routed into it until it goes live. */
export async function setPipelineStatus(tenantId: string, pipelineId: string, status: "draft" | "live") {
  const client = getSupabaseServiceClient() as unknown as { from(table: string): { update(values: Row): Query } };
  const patch: Row = { status, updated_at: new Date().toISOString() };
  if (status === "draft") patch.is_default = false;
  const result = await client.from("tenant_pipelines").update(patch).eq("tenant_id", tenantId).eq("id", pipelineId);
  if (isMissingSchema(result.error)) throw new MoveError("schema_pending", "Draft pipelines need a database update (20260925100000) that has not been applied yet.");
  if (result.error) throw new Error(`Could not change the pipeline: ${result.error.message}`);
}
