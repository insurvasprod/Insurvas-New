import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PARTNER_PIPELINE_TYPES, type PartnerPipelineType, type Pipeline, type PipelineStage, type PipelineStageType } from "@/lib/pipelines/types";
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

function pipelineType(value: unknown): PartnerPipelineType {
  if (!PARTNER_PIPELINE_TYPES.includes(value as PartnerPipelineType)) throw new Error("Choose a valid partner type");
  return value as PartnerPipelineType;
}

function stageType(value: unknown): PipelineStageType {
  if (!(["open", "won", "lost"] as const).includes(value as PipelineStageType)) throw new Error("Choose a valid stage type");
  return value as PipelineStageType;
}

function color(value: unknown) {
  if (typeof value !== "string" || !COLORS.test(value)) throw new Error("Stage colour must be a six-digit hex colour");
  return value;
}

export async function listPipelines(tenantId: string): Promise<Pipeline[]> {
  const supabase = getSupabaseServiceClient();
  const [pipelines, stages] = await Promise.all([
    supabase.from("pipelines").select("id, tenant_id, name, partner_type, is_default, created_at, updated_at").eq("tenant_id", tenantId).order("partner_type").order("name"),
    supabase.from("pipeline_stages").select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at").order("position").order("created_at"),
  ]);
  if (pipelines.error || stages.error) throw new Error(`Could not load pipelines: ${pipelines.error?.message ?? stages.error?.message}`);
  const grouped = new Map<string, PipelineStage[]>();
  for (const stage of stages.data ?? []) grouped.set(stage.pipeline_id, [...(grouped.get(stage.pipeline_id) ?? []), stage as PipelineStage]);
  return (pipelines.data ?? []).map((pipeline) => ({ ...pipeline, partner_type: pipeline.partner_type as PartnerPipelineType, stages: grouped.get(pipeline.id) ?? [] }));
}

async function tenantPipeline(tenantId: string, pipelineId: string) {
  assertUuid(pipelineId, "pipeline id");
  const { data, error } = await getSupabaseServiceClient().from("pipelines").select("id, tenant_id, name, partner_type, is_default, created_at, updated_at").eq("id", pipelineId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`Could not load pipeline: ${error.message}`);
  if (!data) throw new Error("Pipeline not found");
  return { ...data, partner_type: data.partner_type as PartnerPipelineType };
}

export async function createPipeline(tenantId: string, input: { name: unknown; partner_type: unknown; is_default?: unknown }) {
  const name = text(input.name, "Pipeline name");
  const partnerType = pipelineType(input.partner_type);
  const { data, error } = await getSupabaseServiceClient().from("pipelines").insert({ tenant_id: tenantId, name, partner_type: partnerType, is_default: input.is_default === true }).select("id, tenant_id, name, partner_type, is_default, created_at, updated_at").single();
  if (error || !data) throw new Error(error?.code === "23505" ? "A pipeline with that name already exists for this partner type" : error?.message ?? "Could not create pipeline");
  return data;
}

export async function updatePipeline(tenantId: string, pipelineId: string, input: { name?: unknown; partner_type?: unknown; is_default?: unknown }) {
  const current = await tenantPipeline(tenantId, pipelineId);
  const patch: { name?: string; partner_type?: PartnerPipelineType; is_default?: boolean } = {};
  if (input.name !== undefined) patch.name = text(input.name, "Pipeline name");
  if (input.partner_type !== undefined) patch.partner_type = pipelineType(input.partner_type);
  if (input.is_default !== undefined) patch.is_default = input.is_default === true;
  if (patch.partner_type && patch.partner_type !== current.partner_type) {
    const { count } = await getSupabaseServiceClient().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("pipeline_id", pipelineId);
    if ((count ?? 0) > 0) throw new Error("A pipeline with leads cannot change partner type");
  }
  const { data, error } = await getSupabaseServiceClient().from("pipelines").update(patch).eq("id", pipelineId).eq("tenant_id", tenantId).select("id, tenant_id, name, partner_type, is_default, created_at, updated_at").single();
  if (error || !data) throw new Error(error?.code === "23505" ? "A default pipeline already exists for this partner type" : error?.message ?? "Could not update pipeline");
  return data;
}

export async function deletePipeline(tenantId: string, pipelineId: string) {
  const current = await tenantPipeline(tenantId, pipelineId);
  if (current.is_default) throw new Error("Default pipelines cannot be deleted; create another pipeline first");
  const { error } = await getSupabaseServiceClient().from("pipelines").delete().eq("id", pipelineId).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message.includes("violates foreign key") ? "A pipeline with leads cannot be deleted" : error.message);
}

export async function createStage(tenantId: string, pipelineId: string, input: { name: unknown; stage_type: unknown; color: unknown }) {
  await tenantPipeline(tenantId, pipelineId);
  const supabase = getSupabaseServiceClient();
  const { data: last } = await supabase.from("pipeline_stages").select("position").eq("pipeline_id", pipelineId).eq("is_archived", false).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase.from("pipeline_stages").insert({ pipeline_id: pipelineId, name: text(input.name, "Stage name"), position: (last?.position ?? -1) + 1, stage_type: stageType(input.stage_type), color: color(input.color) }).select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at").single();
  if (error || !data) throw new Error(error?.code === "23505" ? "A stage with that name already exists" : error?.message ?? "Could not create stage");
  return data as PipelineStage;
}

export async function updateStage(tenantId: string, pipelineId: string, stageId: string, input: { name?: unknown; stage_type?: unknown; color?: unknown }) {
  await tenantPipeline(tenantId, pipelineId); assertUuid(stageId, "stage id");
  const patch: { name?: string; stage_type?: PipelineStageType; color?: string } = {};
  if (input.name !== undefined) patch.name = text(input.name, "Stage name");
  if (input.stage_type !== undefined) patch.stage_type = stageType(input.stage_type);
  if (input.color !== undefined) patch.color = color(input.color);
  const { data, error } = await getSupabaseServiceClient().from("pipeline_stages").update(patch).eq("id", stageId).eq("pipeline_id", pipelineId).select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at").single();
  if (error || !data) throw new Error(error?.code === "23505" ? "A stage with that name already exists" : error?.message ?? "Stage not found");
  return data as PipelineStage;
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

export async function removeDispositionMapping(tenantId: string, mappingId: string) {
  assertUuid(mappingId, "mapping id");
  const { error } = await getSupabaseServiceClient().from("stage_dispositions").delete().eq("tenant_id", tenantId).eq("id", mappingId);
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
    contacted: { publisher: "Incomplete Transfer", marketing: "Call Lead", affiliate: "Contacted" },
    quoted: { publisher: "Pending Approval", marketing: "Qualified - Needs Conversion", affiliate: "Qualified" },
    application_sent: { publisher: "Pending Approval", marketing: "Converted", affiliate: "Submitted" },
    submitted: { publisher: "Submitted", marketing: "Converted", affiliate: "Submitted" },
    issued: { publisher: "Submitted", marketing: "Converted", affiliate: "Submitted" },
    lost: { publisher: "Did Not Qualify", marketing: "Disqualified - Do Not Call", affiliate: "Not Interested" },
  };
  return names[stageKey]?.[type] ?? "Form Lead";
};

export async function resolveRuntimeStage(tenantId: string, stageKey: string, partnerType: PartnerPipelineType = "marketing") {
  const supabase = getSupabaseServiceClient();
  const { data: pipeline, error: pipelineError } = await supabase.from("pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", partnerType).eq("is_default", true).maybeSingle();
  if (pipelineError || !pipeline) throw new Error("No default pipeline is configured for this partner type");
  const name = legacyStageName(stageKey, partnerType);
  const { data: stage, error } = await supabase.from("pipeline_stages").select("id, pipeline_id, name, position, stage_type, color, is_archived, created_at, updated_at").eq("pipeline_id", pipeline.id).eq("name", name).eq("is_archived", false).maybeSingle();
  if (error || !stage) throw new Error("No starting pipeline stage is configured");
  return { pipelineId: pipeline.id, stage: stage as PipelineStage };
}

export async function partnerTypeForLead(tenantId: string, partnerId: string | null | undefined): Promise<PartnerPipelineType> {
  if (!partnerId) return "marketing";
  const { data } = await getSupabaseServiceClient().from("partners").select("partner_type").eq("id", partnerId).eq("tenant_id", tenantId).maybeSingle();
  return (data?.partner_type as PartnerPipelineType | undefined) ?? "marketing";
}
