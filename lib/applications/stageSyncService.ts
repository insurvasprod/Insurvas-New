import "server-only";

import { db, isMissingSchema, rows } from "./db";
import { currentSyncKey, HUMAN_STAGE_SOURCES, shouldMove, SYNC_KEY_LABEL, SYNC_KEYS, targetSyncKey, type SyncAttempt, type SyncKey } from "./stageSync";
import type { ApplicationOutcome, ApplicationStatus, InsuredRole } from "./constants";

/**
 * Pipeline stage sync (LA-3.23). The lead's card follows its case's most advanced live attempt,
 * through the tenant's tenant_application_stage_map. The rules are pure (stageSync.ts); this reads
 * what they need and, when they say move, moves the lead the way lib/pipelines/views.ts does — the
 * lead, its queue row and its deal row together — and writes one tenant_lead_stage_events row with
 * source `application_sync`, actor null, disposition null (STATUS-MODEL §6, Q3).
 *
 * One direction only: nothing here, and nothing on the board, ever writes an application.
 * A failed sync never fails the write that triggered it — the result says what happened.
 */

export type SyncOutcome =
  | { moved: true; leadId: string; fromStageId: string | null; toStageId: string; key: SyncKey; recorded: boolean }
  | { moved: false; leadId: string | null; reason: "no_case" | "no_target" | "unmapped" | "schema_pending" | "manual_override" | "backwards" | "already_there" | "stage_unavailable" | "raced" | "error"; key?: SyncKey | null; detail?: string };

export type LeadStageState = {
  caseId: string;
  leadId: string;
  target: SyncKey | null;
  targetStageId: string | null;
  targetStageName: string | null;
  boardStageId: string | null;
  boardStageName: string | null;
  /** Why the card stays put: `unmapped` when no stage on the board stands for where the application is. */
  decision: { move: boolean; reason: ReturnType<typeof shouldMove>["reason"] | "unmapped" } | null;
  /** The board and the application disagree because a person moved the card since the last sync. */
  needsReconcile: boolean;
  applicationLabel: string | null;
};

type CaseRow = { id: string; lead_id: string; status: string; opened_at: string | null };

const iso = (value: string | null | undefined) => (value ? new Date(value).toISOString() : null);

async function evaluate(tenantId: string, kase: CaseRow): Promise<(LeadStageState & { boardPipelineId: string | null; targetPipelineId: string | null; unmapped?: boolean; schemaPending?: boolean; targetUsable?: boolean }) > {
  const client = db();
  const [attemptsQ, quotesQ, mapQ, leadQ, eventsQ] = await Promise.all([
    client.from("tenant_applications").select("id, insured_role, attempt_no, status, outcome, quote_id, created_at").eq("tenant_id", tenantId).eq("case_id", kase.id),
    client.from("tenant_quotes").select("id, insured_role, application_id, created_at").eq("tenant_id", tenantId).eq("case_id", kase.id),
    client.from("tenant_application_stage_map").select("sync_key, stage_id").eq("tenant_id", tenantId),
    client.from("agent_leads").select("id, pipeline_id, stage_id").eq("tenant_id", tenantId).eq("id", kase.lead_id).maybeSingle(),
    client.from("tenant_lead_stage_events").select("source, created_at").eq("tenant_id", tenantId).eq("lead_id", kase.lead_id).order("created_at", { ascending: false }).limit(100),
  ]);
  const base = { caseId: kase.id, leadId: kase.lead_id, boardStageId: (leadQ.data?.stage_id as string | null) ?? null, boardPipelineId: (leadQ.data?.pipeline_id as string | null) ?? null };
  const empty = { ...base, target: null, targetStageId: null, targetStageName: null, targetPipelineId: null, boardStageName: null, decision: null, needsReconcile: false, applicationLabel: null };
  if (isMissingSchema(attemptsQ.error) || isMissingSchema(mapQ.error)) return { ...empty, schemaPending: true };
  if (attemptsQ.error || mapQ.error || leadQ.error) throw new Error(attemptsQ.error?.message ?? mapQ.error?.message ?? leadQ.error?.message ?? "Could not read the case");

  type A = { id: string; insured_role: InsuredRole; attempt_no: number; status: ApplicationStatus; outcome: ApplicationOutcome | null; quote_id: string | null; created_at: string };
  const attempts = rows<A>(attemptsQ.data);
  const quotes = quotesQ.error ? [] : rows<{ id: string; insured_role: InsuredRole; application_id: string | null; created_at: string }>(quotesQ.data);
  // A quote belongs to an attempt when it was selected on it, or — unselected — when it was saved for
  // that insured while the attempt was the live one (same rule as the workspace's quote list).
  const syncAttempts: SyncAttempt[] = attempts.map((a) => ({
    attemptNo: a.attempt_no, status: a.status, outcome: a.outcome,
    hasQuote: Boolean(a.quote_id) || quotes.some((q) => q.application_id === a.id || (q.application_id === null && q.insured_role === a.insured_role && a.status !== "closed" && q.created_at >= a.created_at)),
  }));
  const caseStatus = kase.status === "won" ? "won" : kase.status === "lost" ? "lost" : "open";
  const target = targetSyncKey({ caseStatus, attempts: syncAttempts });

  const map: Partial<Record<SyncKey, string>> = {};
  for (const row of rows<{ sync_key: SyncKey; stage_id: string }>(mapQ.data)) if ((SYNC_KEYS as readonly string[]).includes(row.sync_key)) map[row.sync_key] = row.stage_id;
  const targetStageId = target ? map[target] ?? null : null;

  const stageIds = [...new Set([targetStageId, base.boardStageId].filter((x): x is string => Boolean(x)))];
  const stagesQ = stageIds.length
    ? await client.from("tenant_pipeline_stages").select("id, name, pipeline_id, is_archived, tenant_pipelines!inner(tenant_id)").in("id", stageIds).eq("tenant_pipelines.tenant_id", tenantId)
    : { data: [], error: null };
  const stages = new Map(rows<{ id: string; name: string; pipeline_id: string; is_archived: boolean }>(stagesQ.data).map((s) => [s.id, s]));

  const events = eventsQ.error ? [] : rows<{ source: string; created_at: string }>(eventsQ.data);
  const lastHuman = events.find((e) => (HUMAN_STAGE_SOURCES as readonly string[]).includes(e.source))?.created_at ?? null;
  const lastSync = events.find((e) => e.source === "application_sync")?.created_at ?? null;
  const currentKey = currentSyncKey(base.boardStageId, map, target);
  const decision = target ? shouldMove({ target, currentKey, lastHumanMoveAt: iso(lastHuman), lastSyncAt: iso(lastSync), caseOpenedAt: iso(kase.opened_at) }) : null;
  const targetStage = targetStageId ? stages.get(targetStageId) : undefined;
  const differs = Boolean(targetStageId && targetStageId !== base.boardStageId);
  return {
    ...base,
    target, targetStageId, targetStageName: targetStage?.name ?? null, targetPipelineId: targetStage?.pipeline_id ?? null,
    boardStageName: base.boardStageId ? stages.get(base.boardStageId)?.name ?? null : null,
    decision: differs ? decision : decision && { move: false, reason: targetStageId ? "already_there" : "unmapped" },
    needsReconcile: differs && decision?.reason === "manual_override" && Boolean(targetStage && !targetStage.is_archived),
    applicationLabel: targetStage?.name ?? (target ? SYNC_KEY_LABEL[target] : null),
    unmapped: Boolean(target && !targetStageId),
    targetUsable: Boolean(targetStage && !targetStage.is_archived),
  };
}

async function latestCaseForLead(tenantId: string, leadId: string): Promise<CaseRow | null> {
  const q = await db().from("tenant_application_cases").select("id, lead_id, status, opened_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("opened_at", { ascending: false }).limit(10);
  if (q.error) return null;
  const list = rows<CaseRow>(q.data);
  return list.find((c) => c.status === "open") ?? list[0] ?? null;
}

async function caseById(tenantId: string, caseId: string): Promise<CaseRow | null> {
  const q = await db().from("tenant_application_cases").select("id, lead_id, status, opened_at").eq("tenant_id", tenantId).eq("id", caseId).maybeSingle();
  return q.error ? null : ((q.data as CaseRow | null) ?? null);
}

/** Move the lead to a stage: lead, queue row and deal row, then one history row. Only if the lead is still where we read it. */
async function moveLead(tenantId: string, input: { leadId: string; fromPipelineId: string | null; fromStageId: string | null; toPipelineId: string; toStageId: string; actorUserId: string | null }) {
  const client = db();
  const now = new Date().toISOString();
  let update = client.from("agent_leads").update({ pipeline_id: input.toPipelineId, stage_id: input.toStageId, updated_at: now }).eq("tenant_id", tenantId).eq("id", input.leadId);
  update = input.fromStageId ? update.eq("stage_id", input.fromStageId) : update.is("stage_id", null);
  const moved = await update.select("id");
  if (moved.error) throw new Error(moved.error.message);
  if (!rows(moved.data).length) return { moved: false as const, recorded: false };
  await Promise.all([
    client.from("lead_queue").update({ pipeline_id: input.toPipelineId, stage_id: input.toStageId, updated_at: now }).eq("tenant_id", tenantId).eq("lead_id", input.leadId),
    client.from("deal_flow").update({ pipeline_id: input.toPipelineId, stage_id: input.toStageId, updated_at: now }).eq("tenant_id", tenantId).eq("lead_id", input.leadId),
  ]);
  const event = await client.from("tenant_lead_stage_events").insert({
    tenant_id: tenantId, lead_id: input.leadId, from_pipeline_id: input.fromPipelineId, from_stage_id: input.fromStageId,
    to_pipeline_id: input.toPipelineId, to_stage_id: input.toStageId, disposition_key: null, source: "application_sync", actor_user_id: input.actorUserId,
  });
  if (event.error) console.error("[stage-sync] history row not written", input.leadId, event.error.message);
  return { moved: true as const, recorded: !event.error };
}

/**
 * Evaluate the case and move its lead when the rules say so. Call after every application change
 * (transition, submission, quote saved/selected, next attempt, case closed). Never throws.
 */
export async function syncLeadStage(tenantId: string, caseId: string): Promise<SyncOutcome> {
  try {
    const kase = await caseById(tenantId, caseId);
    if (!kase) return { moved: false, leadId: null, reason: "no_case" };
    const state = await evaluate(tenantId, kase);
    if (state.schemaPending) return { moved: false, leadId: kase.lead_id, reason: "schema_pending" };
    if (!state.target) return { moved: false, leadId: kase.lead_id, reason: "no_target", key: null };
    if (state.unmapped || !state.targetStageId || !state.targetPipelineId) return { moved: false, leadId: kase.lead_id, reason: "unmapped", key: state.target };
    if (!state.targetUsable) return { moved: false, leadId: kase.lead_id, reason: "stage_unavailable", key: state.target };
    if (!state.decision?.move) return { moved: false, leadId: kase.lead_id, reason: state.decision?.reason ?? "already_there", key: state.target };
    const result = await moveLead(tenantId, { leadId: kase.lead_id, fromPipelineId: state.boardPipelineId, fromStageId: state.boardStageId, toPipelineId: state.targetPipelineId, toStageId: state.targetStageId, actorUserId: null });
    if (!result.moved) return { moved: false, leadId: kase.lead_id, reason: "raced", key: state.target };
    return { moved: true, leadId: kase.lead_id, fromStageId: state.boardStageId, toStageId: state.targetStageId, key: state.target, recorded: result.recorded };
  } catch (error) {
    console.error("[stage-sync]", caseId, error);
    return { moved: false, leadId: null, reason: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

/** The same, from an attempt id (the mutations know the attempt, not always the case). */
export async function syncLeadStageForApplication(tenantId: string, applicationId: string): Promise<SyncOutcome> {
  const q = await db().from("tenant_applications").select("case_id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (q.error || !q.data) return { moved: false, leadId: null, reason: "no_case" };
  return syncLeadStage(tenantId, q.data.case_id as string);
}

/** For the leads board's hint: where the application says the card belongs, and whether a person overrode it. */
export async function leadStageState(tenantId: string, leadId: string): Promise<LeadStageState | null> {
  const kase = await latestCaseForLead(tenantId, leadId);
  if (!kase) return null;
  const state = await evaluate(tenantId, kase);
  if (state.schemaPending) return null;
  return {
    caseId: state.caseId, leadId: state.leadId, target: state.target, targetStageId: state.targetStageId, targetStageName: state.targetStageName,
    boardStageId: state.boardStageId, boardStageName: state.boardStageName, decision: state.decision, needsReconcile: state.needsReconcile, applicationLabel: state.applicationLabel,
  };
}

/**
 * Reconcile: put the card where the application says, on a person's say-so. Writes the history row
 * as `application_sync` (so automatic sync resumes after it) with that person as the actor.
 */
export async function reconcileLeadStage(tenantId: string, leadId: string, actorUserId: string): Promise<{ moved: boolean; toStageId: string | null; toStageName: string | null; reason?: string }> {
  const kase = await latestCaseForLead(tenantId, leadId);
  if (!kase) return { moved: false, toStageId: null, toStageName: null, reason: "no_case" };
  const state = await evaluate(tenantId, kase);
  if (!state.targetStageId || !state.targetPipelineId) return { moved: false, toStageId: null, toStageName: null, reason: state.target ? "unmapped" : "no_target" };
  if (!state.targetUsable) return { moved: false, toStageId: null, toStageName: null, reason: "stage_unavailable" };
  if (state.targetStageId === state.boardStageId) return { moved: false, toStageId: state.targetStageId, toStageName: state.targetStageName, reason: "already_there" };
  const result = await moveLead(tenantId, { leadId, fromPipelineId: state.boardPipelineId, fromStageId: state.boardStageId, toPipelineId: state.targetPipelineId, toStageId: state.targetStageId, actorUserId });
  return { moved: result.moved, toStageId: state.targetStageId, toStageName: state.targetStageName, reason: result.moved ? undefined : "raced" };
}
