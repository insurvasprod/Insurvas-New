import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PARTNER_PIPELINE_TYPES, type DispositionCatalogEntry, type PartnerPipelineType, type Pipeline, type PipelineCounts, type PipelineStage, type PipelineStageType, type UnmappedOutcomes } from "@/lib/pipelines/types";
import { isMissingFunction, isMissingSchema, SchemaPendingError } from "@/lib/pipelines/schemaGap";
export { PARTNER_PIPELINE_TYPES } from "@/lib/pipelines/types";
export type { PartnerPipelineType, Pipeline, PipelineStage, PipelineStageType } from "@/lib/pipelines/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f<>]+$/;
const COLORS = /^#[0-9a-fA-F]{6}$/;

export function assertUuid(value: string, label: string) {
  if (!UUID.test(value)) throw new Error(`Invalid ${label}`);
}

function text(value: unknown, label: string, max = 120) {
  if (typeof value !== "string" || !SAFE_TEXT.test(value) || value.trim().length < 1 || value.trim().length > max) throw new Error(`${label} must be between 1 and ${max} characters`);
  return value.trim();
}

/** A partner type, or null for "no partner type" (sent as null or an empty string). */
function pipelineType(value: unknown): PartnerPipelineType | null {
  if (value === null || value === "") return null;
  if (!PARTNER_PIPELINE_TYPES.includes(value as PartnerPipelineType)) throw new Error("Choose a valid partner type");
  return value as PartnerPipelineType;
}

/** Before 20260924240100, partner_type is NOT NULL: a pipeline with none cannot be stored yet. */
function pipelineWriteError(error: { code?: string; message?: string } | null, fallback: string, duplicate: string): Error {
  if (error?.code === "23502" && /partner_type/.test(error.message ?? "")) return new SchemaPendingError();
  if (error?.code === "23505") return new Error(duplicate);
  return new Error(error?.message ?? fallback);
}

function stageType(value: unknown): PipelineStageType {
  if (!(["open", "won", "lost"] as const).includes(value as PipelineStageType)) throw new Error("Choose a valid stage type");
  return value as PipelineStageType;
}

/** Empty clears it; otherwise one line, at most 200 characters. */
function description(value: unknown): string | null {
  if (value === null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "string" || !SAFE_TEXT.test(value) || value.trim().length > 200) throw new Error("Stage description must be one line of at most 200 characters");
  return value.trim();
}

const STAGE_COLUMNS = "id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at";
const STAGE_COLUMNS_WITH_DESCRIPTION = `${STAGE_COLUMNS}, description`;

function color(value: unknown) {
  if (typeof value !== "string" || !COLORS.test(value)) throw new Error("Stage colour must be a six-digit hex colour");
  return value;
}

export async function listPipelines(tenantId: string): Promise<Pipeline[]> {
  return (await listPipelinesWithSchema(tenantId)).pipelines;
}

/**
 * The pipelines, and whether stage descriptions can be stored yet (20260924130000). The settings
 * screen disables the description field until they can, so a stage save never fails on it.
 */
export async function listPipelinesWithSchema(tenantId: string): Promise<{ pipelines: Pipeline[]; descriptionsReady: boolean }> {
  const supabase = getSupabaseServiceClient();
  const pipelines = await supabase.from("tenant_pipelines").select("id, tenant_id, name, partner_type, is_default, created_at, updated_at").eq("tenant_id", tenantId).order("partner_type").order("name");
  if (pipelines.error) throw new Error(`Could not load pipelines: ${pipelines.error.message}`);
  const pipelineIds = (pipelines.data ?? []).map((pipeline) => pipeline.id);
  const readStages = async (columns: string) => {
    const result = await supabase.from("tenant_pipeline_stages").select(columns).in("pipeline_id", pipelineIds).order("position").order("created_at");
    return { data: result.data as unknown as PipelineStage[] | null, error: result.error };
  };
  // Read even with no pipelines (an empty id list matches nothing), so "can descriptions be
  // stored" always has a real answer.
  let stages = await readStages(STAGE_COLUMNS_WITH_DESCRIPTION);
  let descriptionsReady = true;
  // The description column arrives with 20260924130000; until then every stage simply has none.
  if (isMissingSchema(stages.error)) {
    descriptionsReady = false;
    stages = await readStages(STAGE_COLUMNS);
  }
  if (stages.error) throw new Error(`Could not load pipelines: ${stages.error.message}`);
  const grouped = new Map<string, PipelineStage[]>();
  for (const row of stages.data ?? []) grouped.set(row.pipeline_id, [...(grouped.get(row.pipeline_id) ?? []), { ...row, description: row.description ?? null }]);
  return {
    pipelines: (pipelines.data ?? []).map((pipeline) => ({ ...pipeline, partner_type: (pipeline.partner_type as PartnerPipelineType | null) ?? null, stages: grouped.get(pipeline.id) ?? [] })),
    descriptionsReady,
  };
}

async function tenantPipeline(tenantId: string, pipelineId: string) {
  assertUuid(pipelineId, "pipeline id");
  const { data, error } = await getSupabaseServiceClient().from("tenant_pipelines").select("id, tenant_id, name, partner_type, is_default, created_at, updated_at").eq("id", pipelineId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`Could not load pipeline: ${error.message}`);
  if (!data) throw new Error("Pipeline not found");
  return { ...data, partner_type: (data.partner_type as PartnerPipelineType | null) ?? null };
}

export async function createPipeline(tenantId: string, input: { name: unknown; partner_type: unknown; is_default?: unknown }) {
  const name = text(input.name, "Pipeline name");
  const partnerType = pipelineType(input.partner_type);
  // Cast: database.types.ts predates 20260924240100 and still declares partner_type non-null.
  const { data, error } = await getSupabaseServiceClient().from("tenant_pipelines").insert({ tenant_id: tenantId, name, partner_type: partnerType, is_default: input.is_default === true } as never).select("id, tenant_id, name, partner_type, is_default, created_at, updated_at").single();
  if (error || !data) throw pipelineWriteError(error, "Could not create pipeline", partnerType ? "A pipeline with that name already exists for this partner type" : "A pipeline with that name and no partner type already exists");
  return data;
}

export async function updatePipeline(tenantId: string, pipelineId: string, input: { name?: unknown; partner_type?: unknown; is_default?: unknown }) {
  const current = await tenantPipeline(tenantId, pipelineId);
  const patch: { name?: string; partner_type?: PartnerPipelineType | null; is_default?: boolean } = {};
  if (input.name !== undefined) patch.name = text(input.name, "Pipeline name");
  if (input.partner_type !== undefined) patch.partner_type = pipelineType(input.partner_type);
  if (input.is_default !== undefined) patch.is_default = input.is_default === true;
  if (patch.partner_type !== undefined && patch.partner_type !== current.partner_type) {
    const { count } = await getSupabaseServiceClient().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("pipeline_id", pipelineId);
    if ((count ?? 0) > 0) throw new Error("A pipeline with leads cannot change partner type");
  }
  const { data, error } = await getSupabaseServiceClient().from("tenant_pipelines").update(patch as never).eq("id", pipelineId).eq("tenant_id", tenantId).select("id, tenant_id, name, partner_type, is_default, created_at, updated_at").single();
  const type = patch.partner_type !== undefined ? patch.partner_type : current.partner_type;
  if (error || !data) throw pipelineWriteError(error, "Could not update pipeline", type ? "Another pipeline of this partner type already has that name, or is already its default" : "Another pipeline with no partner type already has that name, or is already the default");
  return data;
}

export async function deletePipeline(tenantId: string, pipelineId: string) {
  assertUuid(pipelineId, "pipeline id");
  const { error } = await getSupabaseServiceClient().rpc("delete_tenant_pipeline", { p_tenant_id: tenantId, p_pipeline_id: pipelineId });
  if (!error) return;
  if (error.message.includes("pipeline_not_found")) throw new Error("Pipeline not found");
  if (error.message.includes("default_pipeline")) throw new Error("Default pipelines cannot be deleted; create another pipeline first");
  if (error.message.includes("pipeline_in_use")) throw new Error("A pipeline with leads or disposition history cannot be deleted");
  throw new Error(error.message);
}

export async function createStage(tenantId: string, pipelineId: string, input: { name: unknown; stage_type: unknown; color: unknown; description?: unknown }) {
  await tenantPipeline(tenantId, pipelineId);
  const supabase = getSupabaseServiceClient();
  const { data: last } = await supabase.from("tenant_pipeline_stages").select("position").eq("pipeline_id", pipelineId).eq("is_archived", false).order("position", { ascending: false }).limit(1).maybeSingle();
  const stageDescription = input.description === undefined ? null : description(input.description);
  const { data, error } = await supabase
    .from("tenant_pipeline_stages")
    .insert({ pipeline_id: pipelineId, name: text(input.name, "Stage name"), position: (last?.position ?? -1) + 1, stage_type: stageType(input.stage_type), color: color(input.color), ...(stageDescription ? { description: stageDescription } : {}) } as never)
    .select(stageDescription ? STAGE_COLUMNS_WITH_DESCRIPTION : STAGE_COLUMNS)
    .single();
  if (isMissingSchema(error)) throw new SchemaPendingError();
  if (error || !data) throw new Error(error?.code === "23505" ? "A stage with that name already exists" : error?.message ?? "Could not create stage");
  return data as unknown as PipelineStage;
}

export async function updateStage(tenantId: string, pipelineId: string, stageId: string, input: { name?: unknown; stage_type?: unknown; color?: unknown; description?: unknown }) {
  await tenantPipeline(tenantId, pipelineId); assertUuid(stageId, "stage id");
  const patch: { name?: string; stage_type?: PipelineStageType; color?: string; description?: string | null } = {};
  if (input.description !== undefined) patch.description = description(input.description);
  if (input.name !== undefined) patch.name = text(input.name, "Stage name");
  if (input.stage_type !== undefined) patch.stage_type = stageType(input.stage_type);
  if (input.color !== undefined) patch.color = color(input.color);
  const run = async (columns: string) => {
    const result = await getSupabaseServiceClient().from("tenant_pipeline_stages").update(patch as never).eq("id", stageId).eq("pipeline_id", pipelineId).select(columns).single();
    return { data: result.data as unknown as PipelineStage | null, error: result.error };
  };
  let result = await run(STAGE_COLUMNS_WITH_DESCRIPTION);
  if (isMissingSchema(result.error)) {
    // Writing a description needs the column; any other edit can go ahead without reading it back.
    if (patch.description !== undefined) throw new SchemaPendingError();
    result = await run(STAGE_COLUMNS);
  }
  const { data, error } = result;
  if (error || !data) throw new Error(error?.code === "23505" ? "A stage with that name already exists" : error?.message ?? "Stage not found");
  return data;
}

export async function archiveStage(tenantId: string, pipelineId: string, stageId: string) {
  await tenantPipeline(tenantId, pipelineId); assertUuid(stageId, "stage id");
  const { data, error } = await getSupabaseServiceClient().rpc("archive_pipeline_stage", { p_tenant_id: tenantId, p_stage_id: stageId });
  if (error || !data) throw new Error(error?.message ?? "Could not archive stage");
  return data as PipelineStage;
}

export async function reorderStages(tenantId: string, pipelineId: string, stageIds: unknown) {
  await tenantPipeline(tenantId, pipelineId);
  if (!Array.isArray(stageIds) || stageIds.length < 1 || stageIds.some((id) => typeof id !== "string" || !UUID.test(id))) throw new Error("Stage order must contain valid stage ids");
  if (new Set(stageIds).size !== stageIds.length) throw new Error("Stage order cannot contain duplicates");
  const { data, error } = await getSupabaseServiceClient().rpc("reorder_pipeline_stages", { p_tenant_id: tenantId, p_pipeline_id: pipelineId, p_stage_ids: stageIds as string[] });
  if (error || !data) throw new Error(error?.message ?? "Could not reorder stages");
  return data as PipelineStage[];
}

/**
 * Leads where they sit today: per pipeline, and per stage. Counted with the
 * (tenant_id, pipeline_id, stage_id, …) index rather than read, because agent_leads is large.
 */
export async function pipelineCounts(tenantId: string, pipelines: Pipeline[]): Promise<PipelineCounts> {
  const supabase = getSupabaseServiceClient();
  // One grouped statement (20260924240100). Falls back to counting per stage until it exists.
  // Cast: database.types.ts predates the function. Bound, because rpc reads `this` (the client).
  const grouped = await (supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>)("tenant_pipeline_lead_counts", { p_tenant_id: tenantId });
  if (!grouped.error) {
    const out: PipelineCounts = { pipelines: {}, stages: {} };
    for (const pipeline of pipelines) {
      out.pipelines[pipeline.id] = 0;
      for (const stage of pipeline.stages) out.stages[stage.id] = 0;
    }
    for (const row of (Array.isArray(grouped.data) ? grouped.data : []) as { pipeline_id: string | null; stage_id: string | null; leads: number | string }[]) {
      const n = Number(row.leads) || 0;
      if (row.pipeline_id && row.pipeline_id in out.pipelines) out.pipelines[row.pipeline_id] += n;
      if (row.stage_id && row.stage_id in out.stages) out.stages[row.stage_id] += n;
    }
    return out;
  }
  if (!isMissingFunction(grouped.error)) throw new Error(`Could not count leads: ${grouped.error.message}`);
  const counted = async (query: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count, error } = await query;
    if (error) throw new Error(`Could not count leads: ${error.message}`);
    return count ?? 0;
  };
  const leads = () => supabase.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [byPipeline, byStage] = await Promise.all([
    Promise.all(pipelines.map(async (pipeline) => [pipeline.id, await counted(leads().eq("pipeline_id", pipeline.id))] as const)),
    Promise.all(pipelines.flatMap((pipeline) => pipeline.stages.map(async (stage) => [stage.id, await counted(leads().eq("pipeline_id", pipeline.id).eq("stage_id", stage.id))] as const))),
  ]);
  return { pipelines: Object.fromEntries(byPipeline), stages: Object.fromEntries(byStage) };
}

/** The tenant's outcome catalogue, for labels. Read here rather than through lib/dispositions, which owns editing it. */
export async function listDispositionCatalog(tenantId: string): Promise<DispositionCatalogEntry[]> {
  const { data, error } = await getSupabaseServiceClient().from("dispositions").select("disposition_key, label, is_active, sort_order").eq("tenant_id", tenantId).order("sort_order");
  if (error) throw new Error(`Could not load dispositions: ${error.message}`);
  return (data ?? []).map((row) => ({ key: row.disposition_key, label: row.label, isActive: row.is_active }));
}

/**
 * Outcomes ever recorded whose disposition has no stage mapped today: the board's "N outcomes were
 * recorded against leads that never moved".
 *
 * Read off the work item (`lead_queue.disposition`, `disposition_at`), which both the dialer and
 * the outcome wizard stamp. An unmapped disposition leaves the lead's stage as it was — both
 * functions fall back to the current stage — so each of these is a lead the outcome did not move.
 * Judged against today's mappings: an outcome recorded before its mapping was added is counted.
 */
export async function unmappedOutcomes(tenantId: string, mappedKeys: string[]): Promise<UnmappedOutcomes> {
  let query = getSupabaseServiceClient().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).not("disposition", "is", null);
  // Keys are [a-z0-9_] by construction (set_stage_disposition's validation), so the list is safe to inline.
  const safe = mappedKeys.filter((key) => /^[a-z][a-z0-9_]{1,79}$/.test(key));
  if (safe.length > 0) query = query.not("disposition", "in", `(${safe.join(",")})`);
  const { count, error } = await query;
  if (error) throw new Error(`Could not count unmapped outcomes: ${error.message}`);
  return { outcomes: count ?? 0 };
}

export async function listDispositionMappings(tenantId: string) {
  const { data, error } = await getSupabaseServiceClient().from("stage_dispositions").select("id, tenant_id, stage_id, disposition_key, created_at, updated_at").eq("tenant_id", tenantId).order("disposition_key");
  if (error) throw new Error(`Could not load disposition mappings: ${error.message}`);
  return data ?? [];
}

export async function setDispositionMapping(tenantId: string, input: { stage_id: unknown; disposition_key: unknown }) {
  assertUuid(String(input.stage_id), "stage id");
  const key = text(input.disposition_key, "Disposition key", 80).toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(key)) throw new Error("Disposition key must use lowercase letters, numbers and underscores");
  const { data, error } = await getSupabaseServiceClient().rpc("set_stage_disposition", { p_tenant_id: tenantId, p_stage_id: String(input.stage_id), p_disposition_key: key });
  if (error || !data) throw new Error(error?.message ?? "Could not save disposition mapping");
  return data;
}

/**
 * "Every row in the mapping must land somewhere": an ACTIVE outcome cannot be left with no stage.
 * Point it at another stage instead (set_stage_disposition replaces the mapping), or archive the
 * outcome in Dispositions first. A key that is not an active outcome can be unmapped freely.
 */
export async function removeDispositionMapping(tenantId: string, mappingId: string) {
  assertUuid(mappingId, "mapping id");
  const supabase = getSupabaseServiceClient();
  const mapping = await supabase.from("stage_dispositions").select("disposition_key").eq("tenant_id", tenantId).eq("id", mappingId).maybeSingle();
  if (mapping.error) throw new Error(mapping.error.message);
  if (!mapping.data) throw new Error("Mapping not found");
  const outcome = await supabase.from("dispositions").select("label, is_active").eq("tenant_id", tenantId).eq("disposition_key", mapping.data.disposition_key).maybeSingle();
  if (outcome.error) throw new Error(outcome.error.message);
  if (outcome.data?.is_active) throw new Error(`“${outcome.data.label}” is an active outcome, and every active outcome must land on a stage. Choose another stage for it, or archive it in Dispositions first.`);
  const { error } = await supabase.from("stage_dispositions").delete().eq("tenant_id", tenantId).eq("id", mappingId);
  if (error) throw new Error(error.message);
}

export async function moveLeadByDisposition(tenantId: string, leadId: string, dispositionKey: unknown) {
  assertUuid(leadId, "lead id");
  const key = text(dispositionKey, "Disposition key", 80).toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(key)) throw new Error("Disposition key must use lowercase letters, numbers and underscores");
  const { data, error } = await getSupabaseServiceClient().rpc("move_lead_to_disposition", { p_tenant_id: tenantId, p_lead_id: leadId, p_disposition_key: key });
  if (error || !data?.[0]) throw new Error(error?.message ?? "Could not move lead");
  return data[0];
}

const legacyStageName = (stageKey: string, type: PartnerPipelineType) => {
  const names: Record<string, Record<PartnerPipelineType, string>> = {
    new: { publisher: "New Transfer", marketing: "Form Lead", affiliate: "Referred" },
    partner_submitted: { publisher: "Partner Submitted", marketing: "Form Lead", affiliate: "Referred" },
    contacted: { publisher: "Incomplete Transfer", marketing: "Call Lead", affiliate: "Contacted" },
    quoted: { publisher: "Pending Approval", marketing: "Qualified - Needs Conversion", affiliate: "Qualified" },
    application_sent: { publisher: "Pending Approval", marketing: "Converted", affiliate: "Submitted" },
    submitted: { publisher: "Submitted", marketing: "Converted", affiliate: "Submitted" },
    issued: { publisher: "Submitted", marketing: "Converted", affiliate: "Submitted" },
    lost: { publisher: "Did Not Qualify", marketing: "Disqualified - Do Not Call", affiliate: "Not Interested" },
  };
  return names[stageKey]?.[type] ?? "Form Lead";
};

/**
 * Where a lead with no partner enters: the first open stage of the default pipeline with no partner
 * type, when the tenant has one (20260924240100); otherwise the default marketing pipeline's entry
 * stage, which is where every such lead went before a pipeline could have no partner type.
 */
export async function resolveUnpartneredEntry(tenantId: string): Promise<{ pipelineId: string; stage: PipelineStage }> {
  const supabase = getSupabaseServiceClient();
  const general = await supabase.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).is("partner_type", null).eq("is_default", true).maybeSingle();
  if (!general.error && general.data) {
    const { data: stage } = await supabase.from("tenant_pipeline_stages").select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at").eq("pipeline_id", general.data.id).eq("is_archived", false).eq("stage_type", "open").order("position").limit(1).maybeSingle();
    if (stage) return { pipelineId: general.data.id, stage: stage as PipelineStage };
  }
  return resolveRuntimeStage(tenantId, "new", "marketing");
}

export async function resolveRuntimeStage(tenantId: string, stageKey: string, partnerType: PartnerPipelineType = "marketing") {
  const supabase = getSupabaseServiceClient();
  const { data: pipeline, error: pipelineError } = await supabase.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", partnerType).eq("is_default", true).maybeSingle();
  if (pipelineError || !pipeline) throw new Error("No default pipeline is configured for this partner type");
  const name = legacyStageName(stageKey, partnerType);
  const { data: stage, error } = await supabase.from("tenant_pipeline_stages").select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at").eq("pipeline_id", pipeline.id).eq("name", name).eq("is_archived", false).maybeSingle();
  if (error || !stage) throw new Error("No starting pipeline stage is configured");
  return { pipelineId: pipeline.id, stage: stage as PipelineStage };
}

/**
 * Partner submissions have a distinct origin stage. The migration seeds it for new tenants, but
 * this idempotent guard also repairs tenants created while an older migration bundle is deployed.
 */
export async function resolvePartnerSubmissionStage(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const { data: pipeline, error: pipelineError } = await supabase
    .from("tenant_pipelines")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("partner_type", "publisher")
    .eq("is_default", true)
    .maybeSingle();
  if (pipelineError || !pipeline) throw new Error("No default pipeline is configured for this partner type");
  const existing = await supabase
    .from("tenant_pipeline_stages")
    .select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at")
    .eq("pipeline_id", pipeline.id)
    .eq("name", "Partner Submitted")
    .eq("is_archived", false)
    .maybeSingle();
  if (existing.error) throw new Error(`Could not load partner submission stage: ${existing.error.message}`);
  if (existing.data) return { pipelineId: pipeline.id, stage: existing.data as PipelineStage };
  const { data: last } = await supabase
    .from("tenant_pipeline_stages")
    .select("position")
    .eq("pipeline_id", pipeline.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const created = await supabase
    .from("tenant_pipeline_stages")
    .insert({ pipeline_id: pipeline.id, name: "Partner Submitted", position: (last?.position ?? -1) + 1, stage_type: "open", color: "#0ea5e9" })
    .select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at")
    .maybeSingle();
  if (created.data) return { pipelineId: pipeline.id, stage: created.data as PipelineStage };
  if (created.error?.code === "23505") {
    const repaired = await supabase
      .from("tenant_pipeline_stages")
      .select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at")
      .eq("pipeline_id", pipeline.id)
      .eq("name", "Partner Submitted")
      .eq("is_archived", false)
      .single();
    if (repaired.data) return { pipelineId: pipeline.id, stage: repaired.data as PipelineStage };
  }
  throw new Error(created.error?.message ?? "Could not create the partner submission stage");
}

const DEFAULT_PUBLISHER_DISPOSITION_STAGES = [
  ["Incomplete Transfer", "call_dropped"],
  ["Returned to Partner - DQ", "did_not_qualify"],
  ["Previously Sold", "not_interested"],
  ["Did Not Qualify", "do_not_call"],
  ["Needs Callback", "callback_scheduled"],
  ["Pending Approval", "sent_to_underwriting"],
  ["Submitted", "application_submitted"],
  ["Application Withdrawn", "no_payment_method"],
] as const;

/** Repair-safe defaults for tenants created before the pipeline mapping migration was deployed. */
export async function ensureDefaultPublisherDispositionMappings(tenantId: string, pipelineId: string) {
  const supabase = getSupabaseServiceClient();
  // This runs on every disposition, so all three reads go out together (1 round trip). Stage and
  // mapping rows are only used after the tenant-scoped pipeline check below passes.
  const [pipeline, stages, mappings] = await Promise.all([
    supabase.from("tenant_pipelines").select("id, partner_type").eq("id", pipelineId).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("tenant_pipeline_stages").select("id, name").eq("pipeline_id", pipelineId).eq("is_archived", false),
    supabase.from("stage_dispositions").select("stage_id, disposition_key").eq("tenant_id", tenantId),
  ]);
  if (pipeline.error) throw new Error(`Could not load lead pipeline: ${pipeline.error.message}`);
  if (!pipeline.data || pipeline.data.partner_type !== "publisher") return;
  if (stages.error || mappings.error) throw new Error(`Could not load pipeline defaults: ${stages.error?.message ?? mappings.error?.message}`);
  const stageByName = new Map((stages.data ?? []).map((stage) => [stage.name, stage.id]));
  const mappedKeys = new Set((mappings.data ?? []).map((mapping) => mapping.disposition_key));
  const mappedStages = new Set((mappings.data ?? []).map((mapping) => mapping.stage_id));
  const rows: { tenant_id: string; stage_id: string; disposition_key: string }[] = [];
  for (const [stageName, dispositionKey] of DEFAULT_PUBLISHER_DISPOSITION_STAGES) {
    const stageId = stageByName.get(stageName);
    if (!stageId || mappedKeys.has(dispositionKey) || mappedStages.has(stageId)) continue;
    rows.push({ tenant_id: tenantId, stage_id: stageId, disposition_key: dispositionKey });
    mappedKeys.add(dispositionKey);
    mappedStages.add(stageId);
  }
  if (rows.length === 0) return;
  // One bulk insert. The table has two unique keys, (tenant_id, disposition_key) and
  // (tenant_id, stage_id), and PostgREST's ignore-duplicates only targets one conflict key, so a
  // concurrent seeder's 23505 falls back to the row-at-a-time path, which skips duplicates per row.
  const bulk = await supabase.from("stage_dispositions").insert(rows);
  if (!bulk.error) return;
  if (bulk.error.code !== "23505") throw new Error(`Could not seed pipeline defaults: ${bulk.error.message}`);
  for (const row of rows) {
    const inserted = await supabase.from("stage_dispositions").insert(row);
    if (inserted.error && inserted.error.code !== "23505") throw new Error(`Could not seed pipeline defaults: ${inserted.error.message}`);
  }
}

export async function partnerTypeForLead(tenantId: string, partnerId: string | null | undefined): Promise<PartnerPipelineType> {
  if (!partnerId) return "marketing";
  const { data } = await getSupabaseServiceClient().from("partners").select("partner_type").eq("id", partnerId).eq("tenant_id", tenantId).maybeSingle();
  return (data?.partner_type as PartnerPipelineType | undefined) ?? "marketing";
}
