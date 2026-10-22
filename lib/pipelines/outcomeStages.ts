import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isMissingSchema, SchemaPendingError } from "./schemaGap";
import { resolveOutcomeStages, type OutcomeStageRow, type PipelineOutcomeRow } from "./outcomeResolution";

/**
 * An outcome's stage inside one pipeline (pipeline_disposition_stages, 20261022200000). Marketing and
 * affiliate pipelines are seeded with their own, so a recorded outcome keeps their leads in them; any
 * pipeline may have rows. A pipeline with no row for an outcome uses the agency-wide stage, as before.
 *
 * The code ships ahead of the migration: reads answer "none" until the table exists, writes refuse
 * with SchemaPendingError.
 */

export type PipelineOutcomeStage = PipelineOutcomeRow & { id: string };

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  upsert(values: Record<string, unknown>, options: { onConflict: string }): Query;
  delete(): Query;
  maybeSingle(): PromiseLike<Result>;
  single(): PromiseLike<Result>;
};
const table = () => (getSupabaseServiceClient() as unknown as { from(name: string): Query }).from("pipeline_disposition_stages");
const KEY = /^[a-z][a-z0-9_]{1,79}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listPipelineOutcomeStages(tenantId: string): Promise<{ ready: boolean; rows: PipelineOutcomeStage[] }> {
  const result = await table().select("id, pipeline_id, stage_id, disposition_key").eq("tenant_id", tenantId);
  if (isMissingSchema(result.error)) return { ready: false, rows: [] };
  if (result.error) throw new Error(`Could not load pipeline outcome stages: ${result.error.message}`);
  return { ready: true, rows: (result.data ?? []) as PipelineOutcomeStage[] };
}

/** Set (or replace) the stage an outcome sends a lead to inside one pipeline. The trigger refuses a stage from another pipeline. */
export async function setPipelineOutcomeStage(tenantId: string, input: { pipeline_id: unknown; stage_id: unknown; disposition_key: unknown }): Promise<PipelineOutcomeStage> {
  const pipelineId = String(input.pipeline_id ?? "");
  const stageId = String(input.stage_id ?? "");
  const key = String(input.disposition_key ?? "").trim().toLowerCase();
  if (!UUID.test(pipelineId) || !UUID.test(stageId)) throw new Error("Choose a pipeline and one of its stages.");
  if (!KEY.test(key)) throw new Error("Disposition key must use lowercase letters, numbers and underscores");
  const result = await table()
    .upsert({ tenant_id: tenantId, pipeline_id: pipelineId, stage_id: stageId, disposition_key: key }, { onConflict: "tenant_id,pipeline_id,disposition_key" })
    .select("id, pipeline_id, stage_id, disposition_key")
    .single();
  if (isMissingSchema(result.error)) throw new SchemaPendingError();
  if (result.error) throw new Error(/stage_not_in_pipeline/.test(result.error.message) ? "Choose a stage from that pipeline." : `Could not save the outcome's stage: ${result.error.message}`);
  return result.data as PipelineOutcomeStage;
}

/** Remove a pipeline's own stage for an outcome: the agency-wide stage applies to its leads again. */
export async function removePipelineOutcomeStage(tenantId: string, id: string) {
  if (!UUID.test(id)) throw new Error("Choose a rule to remove.");
  const result = await table().delete().eq("tenant_id", tenantId).eq("id", id);
  if (isMissingSchema(result.error)) throw new SchemaPendingError();
  if (result.error) throw new Error(`Could not remove the outcome's stage: ${result.error.message}`);
}

/** The pipeline a lead is in now (agent_leads.pipeline_id, which the database's lookup reads). */
export async function leadPipelineId(tenantId: string, leadId: string | null | undefined): Promise<string | null> {
  if (!leadId) return null;
  const { data } = await getSupabaseServiceClient().from("agent_leads").select("pipeline_id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  return (data?.pipeline_id as string | null | undefined) ?? null;
}

/** The pipeline of the lead behind a work item. */
export async function workItemPipelineId(tenantId: string, workItemId: string): Promise<string | null> {
  const { data } = await getSupabaseServiceClient().from("lead_queue").select("lead_id").eq("tenant_id", tenantId).eq("id", workItemId).maybeSingle();
  return leadPipelineId(tenantId, (data?.lead_id as string | undefined) ?? null);
}

/**
 * Each outcome's stage id for a lead in `pipelineId`, from rows already read: that pipeline's own row
 * first, then the agency-wide one. Reads the pipeline rows itself.
 */
export async function outcomeStageIdsFor(tenantId: string, pipelineId: string | null, agencyWide: readonly OutcomeStageRow[], isLive?: (stageId: string) => boolean): Promise<Map<string, string>> {
  const own = pipelineId ? (await listPipelineOutcomeStages(tenantId)).rows : [];
  return resolveOutcomeStages(agencyWide, own, pipelineId, isLive);
}
