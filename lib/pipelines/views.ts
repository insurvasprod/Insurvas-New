import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isMissingFunction, isMissingSchema } from "./schemaGap";
import { scopeQuery, type ProducerScope } from "@/lib/agency/visibility";
import { outcomesByStage } from "./outcomeResolution";
import { listPipelineOutcomeStages } from "./outcomeStages";
import { SYNC_KEYS, SYNC_KEY_LABEL, type SyncKey } from "@/lib/applications/stageSync";
import { DEFAULT_STAGE_NAME } from "@/lib/salesSettings/stageMapChecks";
import { EVENT_LABELS, type RuleEvent } from "@/lib/pipelineRules/rules";

/**
 * What the four pipeline views (Stages · Board · Table · List) need beyond the leads themselves,
 * and the one path a lead takes between stages from any of them.
 *
 * The rule the screens enforce: **a stage change is a disposition**. The disposition's stage — the
 * lead's pipeline's own stage for it (pipeline_disposition_stages, 20261022200000), else the one
 * agency-wide stage (stage_dispositions) — is where the lead goes, the outcome is stamped on
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
/** Besides a call outcome, what else sends a lead to a stage on its own (the stage title's (i)). */
export type StageArrival = {
  /** Application states that move the card here (LA-3.23): the pipeline's saved map, else the stage-name default. */
  applicationStates: string[];
  /** Pipeline rules (LA-4) whose stage this is: what the carrier's file or statement shows, and whether the rule moves cards yet. */
  rules: Array<{ name: string; event: string; mode: "forecast" | "live" }>;
};
export type PipelineViewContext = {
  schemaReady: boolean;
  stageRules: Record<string, StageRule>;
  /** Dispositions that land on each stage, by stage id. */
  dispositionsByStage: Record<string, MappedDisposition[]>;
  /** The application states and pipeline rules that move leads to each stage, by stage id. */
  arrivals: Record<string, StageArrival>;
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
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };
type Query = PromiseLike<Result> & {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  not(column: string, operator: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  range(from: number, to: number): Query;
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

/**
 * `scope` (AG-0.5, from scopeFor(auth.context)): a narrowed agency session counts only its producers' work
 * items (lead_queue.owner_user_id) in the unmapped-outcome uses and the stage drift. Null — the default —
 * counts the whole agency, as before. Stages, rules and mappings are the agency's configuration, not rows.
 */
const DRIFT_SAMPLE = 5000;
const DRIFT_PAGE = 1000;

/**
 * Every work item's (lead, stage) for the drift count, or `tooMany` past DRIFT_SAMPLE. The API answers at most
 * 1,000 rows a request (a .limit(5000) used to stop at 1,000 and count drift on a fifth of the queue), so the
 * first page also asks for the total and the rest are read in parallel, ordered along
 * lead_queue_tenant_status_queued_idx with lead_id (unique) as the tail so pages neither overlap nor skip.
 */
async function queueStageRows(client: Db, tenantId: string, scope: ProducerScope): Promise<Result & { tooMany: boolean }> {
  const page = (from: number) =>
    scopeQuery(client.from("lead_queue").select("lead_id, stage_id, disposition", from === 0 ? { count: "exact" } : undefined).eq("tenant_id", tenantId), "owner_user_id", scope)
      .order("status").order("queued_at").order("lead_id").range(from, from + DRIFT_PAGE - 1);
  const first = await page(0);
  if (first.error) return { ...first, tooMany: false };
  const total = first.count ?? rows(first).length;
  if (total >= DRIFT_SAMPLE) return { data: [], error: null, tooMany: true };
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(total / DRIFT_PAGE) - 1) }, (_, i) => page((i + 1) * DRIFT_PAGE)));
  const failed = rest.find((r) => r.error);
  if (failed) return { ...failed, tooMany: false };
  return { data: [first, ...rest].flatMap(rows), error: null, tooMany: false };
}

export async function pipelineViewContext(tenantId: string, scope: ProducerScope = null): Promise<PipelineViewContext> {
  const client = db();
  // The arrivals need none of the reads below, so they start with them rather than after.
  const arrivalsRead = stageArrivals(client, tenantId);
  // Awaited below; this only keeps an early throw from leaving it unobserved.
  arrivalsRead.catch(() => undefined);
  const [stagesWithRules, pipelines, mappings, dispositions, queueStages, own] = await Promise.all([
    client.from("tenant_pipeline_stages").select("id, pipeline_id, time_allowed_minutes, counts_as_worked, tenant_pipelines!inner(tenant_id)").eq("tenant_pipelines.tenant_id", tenantId),
    client.from("tenant_pipelines").select("id, status").eq("tenant_id", tenantId),
    client.from("stage_dispositions").select("stage_id, disposition_key").eq("tenant_id", tenantId),
    client.from("dispositions").select("disposition_key, label, is_active, next_action, next_action_minutes, sort_order").eq("tenant_id", tenantId).order("sort_order"),
    queueStageRows(client, tenantId, scope),
    listPipelineOutcomeStages(tenantId),
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
  // A stage offers its pipeline's own outcomes (20261022200000) and the agency-wide ones that pipeline
  // has not replaced: recording any of them from that stage's board lands the lead on it.
  const pipelineOfStage = new Map(rows(stagesWithRules).map((row) => [text(row.id), text(row.pipeline_id)]));
  const agencyWide = rows(mappings).map((row) => ({ stage_id: text(row.stage_id), disposition_key: text(row.disposition_key) }));
  for (const [stageId, keys] of outcomesByStage(agencyWide, own.rows, (id) => pipelineOfStage.get(id))) {
    for (const key of keys) {
      const row = active.get(key);
      if (!row) continue;
      mappedKeys.add(key);
      (dispositionsByStage[stageId] ??= []).push({
        key,
        label: text(row.label) || key,
        nextAction: row.next_action == null ? null : text(row.next_action),
        nextActionMinutes: row.next_action_minutes == null ? null : Number(row.next_action_minutes),
      });
    }
  }

  // How often each unmapped outcome was recorded, off the work item both the dialer and the
  // outcome wizard stamp. Counted only for the unmapped ones, so the read stays small.
  const unmappedKeys = [...active.keys()].filter((key) => !mappedKeys.has(key));
  // When the drift read already holds every work item in scope (the same tenant and scope filter),
  // the uses are counted from those rows: one head count per outcome is a round trip each.
  const queueRows = rows(queueStages);
  const wholeQueue = !queueStages.error && !queueStages.tooMany;
  const usesRead = wholeQueue
    ? Promise.resolve(unmappedKeys.map((key) => [key, queueRows.filter((row) => row.disposition === key).length] as const))
    : Promise.all(
    unmappedKeys.map(async (key) => {
      const result = await scopeQuery(client.from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("disposition", key), "owner_user_id", scope);
      return [key, (result as unknown as { count: number | null }).count ?? 0] as const;
    }),
  );

  // Drift: a lead's stage is stored on its own row and on its work item; count the disagreements.
  // The lead pages are read side by side, and beside the use counts above: none needs another's answer.
  // (They were one after another — up to seven round trips for a 1,000-row queue.)
  const driftRead = (async (): Promise<number | null> => {
    if (queueStages.error || queueStages.tooMany || queueRows.length === 0) return null;
    const ids = queueRows.map((row) => text(row.lead_id));
    const leadStage = new Map<string, string>();
    const pages: string[][] = [];
    for (let start = 0; start < ids.length; start += 150) pages.push(ids.slice(start, start + 150));
    for (const page of await Promise.all(pages.map((chunk) => client.from("agent_leads").select("id, stage_id").eq("tenant_id", tenantId).in("id", chunk)))) {
      for (const row of rows(page)) leadStage.set(text(row.id), text(row.stage_id));
    }
    return queueRows.filter((row) => leadStage.has(text(row.lead_id)) && leadStage.get(text(row.lead_id)) !== text(row.stage_id)).length;
  })();
  const [uses, stageDrift, arrivals] = await Promise.all([usesRead, driftRead, arrivalsRead]);
  const useCount = new Map(uses);

  return {
    schemaReady,
    stageRules,
    dispositionsByStage,
    arrivals,
    unmapped: unmappedKeys.map((key) => ({ key, label: text(active.get(key)?.label) || key, uses: useCount.get(key) ?? 0 })).sort((a, b) => b.uses - a.uses),
    draftPipelineIds: schemaReady ? rows(pipelines).filter((row) => row.status === "draft").map((row) => text(row.id)) : [],
    stageDrift,
  };
}

/**
 * What moves a lead to each stage besides a call outcome, read the way the movers read it: the application
 * stage map per pipeline (a pipeline with no saved map follows the stage that carries the state's default
 * name, as lib/applications/stageSyncService.ts does), and every pipeline rule switched on, by its current
 * version's stage. A table that is not there yet answers nothing rather than failing the board.
 */
async function stageArrivals(client: Db, tenantId: string): Promise<Record<string, StageArrival>> {
  const [stagesQ, mapQ, rulesQ] = await Promise.all([
    client.from("tenant_pipeline_stages").select("id, pipeline_id, name, is_archived, tenant_pipelines!inner(tenant_id)").eq("tenant_pipelines.tenant_id", tenantId),
    client.from("tenant_application_stage_map").select("sync_key, stage_id, pipeline_id").eq("tenant_id", tenantId),
    client.from("pipeline_rule").select("id, name, mode, enabled, current_version").eq("tenant_id", tenantId).eq("enabled", true).in("mode", ["forecast", "live"]),
  ]);
  const out: Record<string, StageArrival> = {};
  const at = (stageId: string) => (out[stageId] ??= { applicationStates: [], rules: [] });
  const stages = stagesQ.error ? [] : rows(stagesQ).filter((row) => row.is_archived !== true);

  if (!mapQ.error) {
    const saved = rows(mapQ);
    const mapped = new Set(saved.map((row) => text(row.pipeline_id)));
    for (const row of saved) if ((SYNC_KEYS as readonly string[]).includes(text(row.sync_key))) at(text(row.stage_id)).applicationStates.push(SYNC_KEY_LABEL[text(row.sync_key) as SyncKey]);
    for (const pipelineId of new Set(stages.map((row) => text(row.pipeline_id)))) {
      if (mapped.has(pipelineId)) continue;
      for (const key of SYNC_KEYS) {
        const hit = stages.find((row) => text(row.pipeline_id) === pipelineId && text(row.name).trim().toLowerCase() === DEFAULT_STAGE_NAME[key].trim().toLowerCase());
        if (hit) at(text(hit.id)).applicationStates.push(SYNC_KEY_LABEL[key]);
      }
    }
  }

  const rules = rulesQ.error ? [] : rows(rulesQ);
  if (rules.length) {
    const versions = await client.from("pipeline_rule_version").select("rule_id, version, event, target_stage_id").eq("tenant_id", tenantId).in("rule_id", rules.map((row) => text(row.id)));
    if (!versions.error) {
      for (const rule of rules) {
        const current = rows(versions).find((v) => text(v.rule_id) === text(rule.id) && Number(v.version) === Number(rule.current_version));
        if (!current) continue;
        at(text(current.target_stage_id)).rules.push({
          name: text(rule.name),
          event: EVENT_LABELS[text(current.event) as RuleEvent]?.label ?? text(current.event),
          mode: rule.mode === "live" ? "live" : "forecast",
        });
      }
    }
  }
  return out;
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
  // 20260925711300 · the database's own guard behind CALL_PATH_ONLY.callback.
  callback_needs_time: "A callback needs a time in the customer's timezone. Book it from the lead or the dialer.",
};

/**
 * Move one lead by applying a disposition. The caller has already checked the role; this checks
 * that the outcome can be applied here at all (not a callback or do-not-call, which need the call
 * path) and then makes the move in one write. Since 20260925711300 that write also applies the
 * outcome's effect to an outbound lead — closed, rested, or back on the cadence — exactly as the
 * dialer would, so a board "Not interested" takes the lead out of the queue (LA-1.9, move =
 * disposition). Inbound partner leads keep Module 1's behaviour.
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
