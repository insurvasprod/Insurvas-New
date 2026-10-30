import "server-only";

import type { Actor } from "@/lib/applications/http";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError, type DbError } from "@/lib/applications/db";
import { leadName } from "@/lib/applications/lists";
import { SYNC_KEY_LABEL } from "@/lib/applications/stageSync";
import { bringPipelineUpToDate, pipelineSyncCheck, reconcileLeadStage, type PipelineSyncCheck } from "@/lib/applications/stageSyncService";
import type { StageSyncKey } from "./stageMap";

// The owner's two moves (move due cards, put a held card back) live here too, behind the same owner-only
// route. Kept apart from stageMap.ts on purpose: the map's route is open to producers, and this module reads
// leads across every producer (lib/agency/ag05.test.mjs follows imports). Only the owner-only
// …/stage-map/activity route imports it.

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError("Application stages");
  throw new ApplicationError("STAGE_MAP_UNAVAILABLE", `${what}: ${error?.message ?? "unknown error"}`, 500);
}

/** `application`: the attempt that moved the card (rows written since 20261030200000); null on older rows and on moves a person made. */
export type SyncMove = { at: string; leadId: string; lead: string; from: string | null; to: string; state: string | null; byPerson: boolean; application: { caseId: string; attemptNo: number } | null };
export type CheckedCard = PipelineSyncCheck["held"][number] & { lead: string };
export type ActivityCheck = Omit<PipelineSyncCheck, "held" | "due"> & { held: CheckedCard[]; due: CheckedCard[] };
export type StageMapActivity = { pipelineId: string; moved30: number; moves: SyncMove[]; check: ActivityCheck | null };

const leadNames = async (tenantId: string, ids: string[]) => {
  if (!ids.length) return new Map<string, string>();
  const q = await db().from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", [...new Set(ids)]);
  return new Map(rows<{ id: string; values: Record<string, unknown> | null }>(q.data).map((l) => [l.id, leadName(l.values)]));
};

/**
 * Settings › Application stages › Activity (owners, read only): the sync's recent moves on one pipeline, how
 * many in 30 days, and — when asked — the check of its open cases (pipelineSyncCheck), each card named.
 * Rows written since 20261030200000 (live 2026-10-30) name the attempt that moved the card, and the move
 * links to it; older rows do not, and for every row the state is read back from the stage moved to. A move from another pipeline names that pipeline and stage.
 */
export async function getStageMapActivity(actor: Actor, pipelineId: string, check: boolean): Promise<StageMapActivity> {
  const client = db();
  const stagesQ = await client.from("tenant_pipeline_stages").select("id, name, tenant_pipelines!inner(id, tenant_id)").eq("pipeline_id", pipelineId).eq("tenant_pipelines.tenant_id", actor.tenantId);
  if (stagesQ.error) fail(stagesQ.error, "Could not load the pipeline's stages");
  const stages = new Map(rows<{ id: string; name: string }>(stagesQ.data).map((s) => [s.id, s.name]));
  if (!stages.size) return { pipelineId, moved30: 0, moves: [], check: check ? { checked: 0, capped: false, held: [], due: [], unmapped: {} } : null };
  const ids = [...stages.keys()];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  // Along (tenant_id, to_stage_id, created_at desc): one short index range per stage of this pipeline.
  const [recentQ, countQ, mapQ, checked] = await Promise.all([
    client.from("tenant_lead_stage_events").select("lead_id, from_pipeline_id, from_stage_id, to_stage_id, actor_user_id, application_id, created_at").eq("tenant_id", actor.tenantId).eq("source", "application_sync").in("to_stage_id", ids).order("created_at", { ascending: false }).limit(25),
    client.from("tenant_lead_stage_events").select("id", { count: "exact", head: true }).eq("tenant_id", actor.tenantId).eq("source", "application_sync").in("to_stage_id", ids).gte("created_at", since),
    client.from("tenant_application_stage_map").select("sync_key, stage_id").eq("tenant_id", actor.tenantId).in("stage_id", ids),
    check ? pipelineSyncCheck(actor.tenantId, pipelineId) : Promise.resolve(null),
  ]);
  if (recentQ.error) fail(recentQ.error, "Could not load the recent card moves");
  const recent = rows<{ lead_id: string; from_pipeline_id: string | null; from_stage_id: string | null; to_stage_id: string; actor_user_id: string | null; application_id: string | null; created_at: string }>(recentQ.data);
  const appIds = [...new Set(recent.map((r) => r.application_id).filter((id): id is string => Boolean(id)))];
  const appsQ = appIds.length ? await client.from("tenant_applications").select("id, case_id, attempt_no").eq("tenant_id", actor.tenantId).in("id", appIds) : { data: [] };
  const apps = new Map(rows<{ id: string; case_id: string; attempt_no: number }>(appsQ.data).map((a) => [a.id, { caseId: a.case_id, attemptNo: a.attempt_no }]));
  // Stages a card came from in another pipeline (moves made before 20261029100000): name them, not "another pipeline".
  const foreign = [...new Set(recent.map((r) => r.from_stage_id).filter((id): id is string => Boolean(id && !stages.has(id))))];
  const foreignQ = foreign.length ? await client.from("tenant_pipeline_stages").select("id, name, tenant_pipelines!inner(name, tenant_id)").in("id", foreign).eq("tenant_pipelines.tenant_id", actor.tenantId) : { data: [] };
  const foreignName = new Map(rows<{ id: string; name: string; tenant_pipelines: { name: string } | { name: string }[] | null }>(foreignQ.data).map((s) => {
    const p = Array.isArray(s.tenant_pipelines) ? s.tenant_pipelines[0] : s.tenant_pipelines;
    return [s.id, p?.name ? `${p.name} · ${s.name}` : s.name];
  }));
  const names = await leadNames(actor.tenantId, [...recent.map((r) => r.lead_id), ...(checked ? [...checked.held, ...checked.due].map((c) => c.leadId) : [])]);
  const named = (list: PipelineSyncCheck["held"]) => list.map((c) => ({ ...c, lead: names.get(c.leadId) ?? "Unnamed client" }));
  const stateOf = new Map<string, string>();
  for (const row of rows<{ sync_key: StageSyncKey; stage_id: string }>(mapQ.data)) if (!stateOf.has(row.stage_id)) stateOf.set(row.stage_id, SYNC_KEY_LABEL[row.sync_key]);
  return {
    pipelineId,
    moved30: countQ.error ? recent.filter((r) => r.created_at >= since).length : countQ.count ?? 0,
    moves: recent.map((r) => ({
      at: r.created_at,
      leadId: r.lead_id,
      lead: names.get(r.lead_id) ?? "A lead no longer here",
      from: r.from_stage_id ? stages.get(r.from_stage_id) ?? foreignName.get(r.from_stage_id) ?? "A stage that was archived" : null,
      to: stages.get(r.to_stage_id) ?? "A stage that was archived",
      state: stateOf.get(r.to_stage_id) ?? null,
      byPerson: Boolean(r.actor_user_id),
      application: r.application_id ? apps.get(r.application_id) ?? null : null,
    })),
    check: checked ? { ...checked, held: named(checked.held), due: named(checked.due) } : null,
  };
}

/** "Move cards now": every due card on the pipeline goes where its application says (bringPipelineUpToDate). */
export async function moveDueCards(actor: Actor, pipelineId: string) {
  await assertPipeline(actor, pipelineId);
  return bringPipelineUpToDate(actor.tenantId, pipelineId, actor.userId);
}

/** "Put it back": one held card goes where its application says, on the owner's say-so (reconcileLeadStage). */
export async function putCardBack(actor: Actor, leadId: string) {
  return reconcileLeadStage(actor.tenantId, leadId, actor.userId);
}

async function assertPipeline(actor: Actor, pipelineId: string) {
  const q = await db().from("tenant_pipelines").select("id").eq("tenant_id", actor.tenantId).eq("id", pipelineId).maybeSingle();
  if (q.error) fail(q.error, "Could not read the pipeline");
  if (!q.data) throw new ApplicationError("PIPELINE_NOT_FOUND", "Choose one of your pipelines.", 404);
}
