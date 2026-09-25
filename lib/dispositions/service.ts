import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import type { Disposition, DispositionFlow, DispositionNode, DispositionNodeType, DispositionOption, DispositionSettingsRow, DispositionWizard } from "./types";
import { DISPOSITION_KEY_PATTERN, DISPOSITION_NODE_TYPES, DO_NOT_CALL_DISPOSITION_KEY } from "./types";
import { isMissingSchema, SCHEMA_PENDING_MESSAGE } from "./schemaGap";
import { customerName, customerTimezone } from "@/lib/callbacks/timezone";
import { ensureDefaultPublisherDispositionMappings } from "@/lib/pipelines/service";
import { derivedNextAction, endsDialing, validateNextAction, type NextActionSetting } from "./nextAction";
import { checkCallbackInCallingWindow } from "./callbackWindow";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f<>]+$/;

export class DispositionError extends Error {
  constructor(public code: string, message = code) { super(message); }
}

function uuid(value: unknown, label: string) { if (typeof value !== "string" || !UUID.test(value)) throw new DispositionError("invalid_input", `Choose a valid ${label}.`); return value; }
function text(value: unknown, label: string, max: number) { if (typeof value !== "string" || !SAFE_TEXT.test(value) || value.trim().length < 1 || value.trim().length > max) throw new DispositionError("invalid_input", `${label} must be between 1 and ${max} characters.`); return value.trim(); }
function key(value: unknown, label = "Key") { if (typeof value !== "string" || !DISPOSITION_KEY_PATTERN.test(value)) throw new DispositionError("invalid_input", `${label} must use lowercase letters, numbers and underscores.`); return value; }
function nodeType(value: unknown): DispositionNodeType { if (!DISPOSITION_NODE_TYPES.includes(value as DispositionNodeType)) throw new DispositionError("invalid_input", "Choose a valid question type."); return value as DispositionNodeType; }
function apiError(error: { message?: string } | null | undefined, fallback: string) {
  const message = error?.message ?? fallback;
  const known: Record<string, [string, string]> = {
    DISPOSITION_OWNER_REQUIRED: ["owner_required", "Claim this transfer before recording an outcome."],
    DISPOSITION_WORK_ITEM_NOT_FOUND: ["work_item_not_found", "That transfer was not found."],
    DISPOSITION_FLOW_NOT_FOUND: ["flow_not_found", "No disposition flow is configured for this stage."],
    DISPOSITION_FLOW_CHANGED: ["flow_changed", "This flow changed. Reload the outcome wizard."],
    DISPOSITION_WALK_NOT_FOUND: ["walk_not_found", "The outcome wizard could not be found."],
    DISPOSITION_NODE_NOT_FOUND: ["node_not_found", "That question is no longer part of this flow."],
    DISPOSITION_OPTION_REQUIRED: ["option_required", "Choose an answer before continuing."],
    DISPOSITION_OPTION_NOT_FOUND: ["option_not_found", "That answer is no longer available."],
    // record_disposition_answer's own shape checks: the caller sent the wrong kind of answer.
    DISPOSITION_MULTI_SELECT_REQUIRED: ["invalid_input", "Choose one or more answers from the list."],
    DISPOSITION_TEXT_INVALID: ["invalid_input", "Answers must be text of at most 2,000 characters."],
    DISPOSITION_SEQUENCE_INVALID: ["invalid_input", "That step is out of order. Reload the outcome wizard."],
    DISPOSITION_WALK_INCOMPLETE: ["walk_incomplete", "Answer the remaining questions before ending the call."],
    DISPOSITION_NOT_FOUND: ["disposition_not_found", "Choose a valid call outcome."],
    DO_NOT_CALL_PHONE_REQUIRED: ["phone_required", "Do not call requires a valid phone number on the lead."],
    CALLBACK_SUBTYPE_INVALID: ["invalid_input", "The callback detail is too long."],
    CALLBACK_DATE_REQUIRED: ["callback_date_required", "Choose a callback date and time before ending the call."],
    CALLBACK_TIMEZONE_INVALID: ["invalid_input", "The customer's timezone could not be determined."],
    CALLBACK_DATE_PAST: ["invalid_input", "Choose a callback time in the future."],
    CALLBACK_NOTE_INVALID: ["invalid_input", "Callback notes must be between 1 and 1,000 characters."],
    CALLBACK_ASSIGNEE_INVALID: ["invalid_input", "Choose an active teammate in this tenant."],
  };
  const [code, friendly] = known[message] ?? ["disposition_unavailable", fallback];
  return new DispositionError(code, friendly);
}

const DISPOSITION_COLUMNS = "id, tenant_id, disposition_key, label, counts_as_work_completed, closes_as, is_active, sort_order, created_at, updated_at";
const DISPOSITION_COLUMNS_WITH_FLAGS = `${DISPOSITION_COLUMNS}, ends_call`;
const DISPOSITION_COLUMNS_WITH_NEXT = `${DISPOSITION_COLUMNS_WITH_FLAGS}, next_action, next_action_minutes`;
const CALLBACK_KEY = "callback_scheduled";

/** The two outcomes the dialer handles in their own branch, before the ends-call flag is read. */
function endsCallFixed(key: string) { return key === DO_NOT_CALL_DISPOSITION_KEY || key === CALLBACK_KEY; }

/** The stored next action, or what the dialer does today when none is stored (before 20260924240200). */
function nextActionFor(row: Disposition): NextActionSetting | null {
  if (row.next_action) return { kind: row.next_action, minutes: row.next_action_minutes ?? null };
  return derivedNextAction(row.disposition_key, row.ends_call);
}

async function selectDispositions(tenantId: string): Promise<{ data: Disposition[] | null; error: { message: string; code?: string } | null; nextActionReady?: boolean }> {
  const supabase = getSupabaseServiceClient();
  const withNext = await supabase.from("dispositions").select(DISPOSITION_COLUMNS_WITH_NEXT).eq("tenant_id", tenantId).order("sort_order");
  if (!withNext.error) return { data: withNext.data as unknown as Disposition[], error: null, nextActionReady: true };
  if (!isMissingSchema(withNext.error)) return { data: null, error: withNext.error };
  // Before 20260924240200: no stored next action; it is derived from the key and ends_call.
  const withFlags = await supabase.from("dispositions").select(DISPOSITION_COLUMNS_WITH_FLAGS).eq("tenant_id", tenantId).order("sort_order");
  if (!withFlags.error) return { data: withFlags.data as unknown as Disposition[], error: null, nextActionReady: false };
  if (!isMissingSchema(withFlags.error)) return { data: null, error: withFlags.error };
  // Before 20260924140000: the flag is not a column yet, so it reads as "not set".
  const plain = await supabase.from("dispositions").select(DISPOSITION_COLUMNS).eq("tenant_id", tenantId).order("sort_order");
  return { data: (plain.data ?? null) as Disposition[] | null, error: plain.error, nextActionReady: false };
}

export async function listDispositionConfig(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const [dispositions, flows, pipelines, mappings] = await Promise.all([
    selectDispositions(tenantId),
    supabase.from("tenant_disposition_flows").select("id, tenant_id, stage_id, name, is_active, root_node_id, created_at, updated_at").eq("tenant_id", tenantId).order("name"),
    supabase.from("tenant_pipelines").select("id, tenant_id, name").eq("tenant_id", tenantId),
    supabase.from("stage_dispositions").select("stage_id, disposition_key").eq("tenant_id", tenantId),
  ]);
  const pipelineIds = (pipelines.data ?? []).map((pipeline) => pipeline.id);
  const stages = pipelineIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("tenant_pipeline_stages").select("id, pipeline_id, name, stage_type, is_archived").in("pipeline_id", pipelineIds).order("name");
  const flowIds = (flows.data ?? []).map((flow) => flow.id);
  const nodes = flowIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("disposition_nodes").select("id, flow_id, node_key, label, prompt, node_type, field_key, note_template, next_node_id, sort_order, created_at, updated_at").in("flow_id", flowIds).order("sort_order");
  const nodeIds = (nodes.data ?? []).map((node) => node.id);
  const options = nodeIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("disposition_options").select("id, node_id, option_key, label, next_node_id, disposition_key, note_template, sort_order, created_at, updated_at").in("node_id", nodeIds).order("sort_order");
  const failure = [dispositions, flows, pipelines, mappings, stages, nodes, options].find((result) => result.error);
  if (failure?.error) throw new DispositionError("disposition_unavailable", `Could not load disposition settings: ${failure.error.message}`);
  const stageRows = (stages.data ?? []) as { id: string; pipeline_id: string; name: string; stage_type: string; is_archived: boolean }[];
  const stageNames = new Map(stageRows.map((stage) => [stage.id, stage.name]));
  const stageById = new Map(stageRows.map((stage) => [stage.id, stage]));
  const pipelineNames = new Map((pipelines.data ?? []).map((pipeline) => [pipeline.id, pipeline.name as string]));
  // The dialer and the wizard both skip an archived stage, so a mapping to one moves nothing.
  const mappedStage = new Map<string, DispositionSettingsRow["mapped_stage"]>();
  for (const mapping of mappings.data ?? []) {
    const stage = stageById.get(mapping.stage_id);
    if (!stage || stage.is_archived) continue;
    mappedStage.set(mapping.disposition_key, { id: stage.id, name: stage.name, stage_type: stage.stage_type, pipeline_id: stage.pipeline_id, pipeline_name: pipelineNames.get(stage.pipeline_id) ?? "Pipeline" });
  }
  const optionMap = new Map<string, DispositionOption[]>();
  for (const option of (options.data ?? []) as DispositionOption[]) optionMap.set(option.node_id, [...(optionMap.get(option.node_id) ?? []), option]);
  const nodeMap = new Map<string, DispositionNode[]>();
  for (const node of (nodes.data ?? []) as DispositionNode[]) nodeMap.set(node.flow_id, [...(nodeMap.get(node.flow_id) ?? []), { ...node, options: optionMap.get(node.id) ?? [] }]);
  const rows: DispositionSettingsRow[] = (dispositions.data ?? []).map((row) => ({
    ...row,
    ends_call: row.ends_call ?? null,
    ends_call_fixed: endsCallFixed(row.disposition_key),
    next: nextActionFor(row),
    mapped_stage: mappedStage.get(row.disposition_key) ?? null,
  }));
  return {
    dispositions: rows,
    flows: (flows.data ?? []).map((flow) => ({ ...flow, stage_name: stageNames.get(flow.stage_id) ?? "Unknown stage", nodes: nodeMap.get(flow.id) ?? [] })) as DispositionFlow[],
    stages: stageRows.map((stage) => ({ id: stage.id, pipeline_id: stage.pipeline_id, name: stage.name, stage_type: stage.stage_type, is_archived: stage.is_archived, pipeline_name: pipelineNames.get(stage.pipeline_id) ?? "Pipeline" })),
    /** False until migration 20260924140000 adds dispositions.ends_call. */
    ends_call_available: rows.length === 0 || rows.some((row) => row.ends_call !== null),
    /** False until 20260924240200: retry delays and rests cannot be stored yet. */
    next_action_available: dispositions.nextActionReady === true,
    /** For the refusal that names them: an outcome must land on a stage in one of these. */
    pipelines: (pipelines.data ?? []).map((pipeline) => ({ id: pipeline.id as string, name: pipeline.name as string })),
  };
}

/**
 * "Every outcome maps to a stage. Saving an outcome with no stage is refused, with the pipeline
 * named." An active outcome must be mapped (stage_dispositions) — either already, or by the stage
 * chosen in this save. An archived outcome may be saved without one: archiving is how an outcome
 * leaves the mapping.
 */
async function assertOutcomeHasStage(tenantId: string, dispositionKey: string, label: string, stageId: string | null) {
  if (stageId) return;
  const supabase = getSupabaseServiceClient();
  // A mapping to an archived stage moves nothing (the dialer and the wizard both skip it), so it
  // does not count as landing somewhere.
  const mapped = await supabase.from("stage_dispositions").select("stage_id").eq("tenant_id", tenantId).eq("disposition_key", dispositionKey);
  const stageIds = (mapped.data ?? []).map((row) => row.stage_id);
  if (stageIds.length > 0) {
    const live = await supabase.from("tenant_pipeline_stages").select("id").in("id", stageIds).eq("is_archived", false).limit(1);
    if (!live.error && (live.data ?? []).length > 0) return;
  }
  const pipelines = await supabase.from("tenant_pipelines").select("name").eq("tenant_id", tenantId).order("name");
  const names = (pipelines.data ?? []).map((pipeline) => pipeline.name as string);
  throw new DispositionError(
    "invalid_input",
    `“${label}” has no stage, so recording it would leave the lead where it is. Choose the stage it moves the lead to${names.length ? ` — in ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`}` : ""} — before saving.`,
  );
}

/** Map the outcome to the chosen stage (set_stage_disposition checks the stage is the tenant's). */
async function mapOutcomeToStage(tenantId: string, dispositionKey: string, stageId: string | null) {
  if (!stageId) return;
  const { error } = await getSupabaseServiceClient().rpc("set_stage_disposition", { p_tenant_id: tenantId, p_stage_id: stageId, p_disposition_key: dispositionKey });
  if (error) throw new DispositionError(error.message.includes("stage_not_found") ? "invalid_input" : "disposition_unavailable", error.message.includes("stage_not_found") ? "Choose a stage that is still in one of your pipelines." : `Could not map the outcome to that stage: ${error.message}`);
}

/** The next-action columns for a write, or nothing when the caller did not change it. */
function nextActionPatch(dispositionKey: string, kind: unknown, minutes: unknown): { setting: NextActionSetting; patch: Record<string, unknown> } | null {
  if (kind === undefined || kind === null) return null;
  let setting: NextActionSetting;
  try { setting = validateNextAction(dispositionKey, kind, minutes); } catch (error) { throw new DispositionError("invalid_input", error instanceof Error ? error.message : "Choose what happens after this outcome."); }
  const patch: Record<string, unknown> = { next_action: setting.kind, next_action_minutes: setting.minutes };
  // ends_call follows the next action (the trigger in 20260924240200 does the same); the two fixed
  // outcomes keep theirs.
  if (!endsCallFixed(dispositionKey)) patch.ends_call = endsDialing(setting.kind);
  return { setting, patch };
}

function endsCallInput(dispositionKey: string, value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new DispositionError("invalid_input", "Choose whether this outcome ends dialing.");
  if (endsCallFixed(dispositionKey) && value === false) throw new DispositionError("invalid_input", "This outcome always ends dialing; the dialer handles it in its own step.");
  return value;
}

export async function updateDisposition(tenantId: string, dispositionId: string, input: { label: unknown; counts_as_work_completed: unknown; closes_as: unknown; is_active?: unknown; ends_call?: unknown; next_action?: unknown; next_action_minutes?: unknown; stage_id?: unknown }) {
  const id = uuid(dispositionId, "disposition id");
  const supabase = getSupabaseServiceClient();
  const current = await supabase.from("dispositions").select("disposition_key, is_active").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (current.error || !current.data) throw new DispositionError("disposition_not_found", "That call outcome was not found.");
  const dispositionKey = current.data.disposition_key;
  const label = text(input.label, "Disposition label", 120);
  const stageId = input.stage_id == null || input.stage_id === "" ? null : uuid(input.stage_id, "stage");
  const active = input.is_active === undefined ? current.data.is_active : input.is_active === true;
  if (active) await assertOutcomeHasStage(tenantId, dispositionKey, label, stageId);
  const next = nextActionPatch(dispositionKey, input.next_action, input.next_action_minutes);
  const endsCall = next ? undefined : endsCallInput(dispositionKey, input.ends_call);
  const patch = {
    label,
    counts_as_work_completed: input.counts_as_work_completed === true,
    closes_as: input.closes_as === "dropped" ? "dropped" : "completed",
    ...(input.is_active === undefined ? {} : { is_active: input.is_active === true }),
    ...(endsCall === undefined ? {} : { ends_call: endsCall }),
    ...(next ? next.patch : {}),
  };
  await mapOutcomeToStage(tenantId, dispositionKey, stageId);
  // ends_call and next_action are typed locally: database.types.ts predates both migrations.
  const { data, error } = await supabase.from("dispositions").update(patch as never).eq("tenant_id", tenantId).eq("id", id).select(DISPOSITION_COLUMNS).single();
  if (isMissingSchema(error)) throw new DispositionError("schema_pending", SCHEMA_PENDING_MESSAGE);
  if (error || !data) throw new DispositionError("disposition_unavailable", error?.message ?? "Could not update disposition.");
  return data as unknown as Disposition;
}

/** A new tenant outcome. Keys are permanent — a past call stores the key — so there is no delete. */
export async function createDisposition(tenantId: string, input: { disposition_key: unknown; label: unknown; counts_as_work_completed: unknown; closes_as: unknown; ends_call?: unknown; next_action?: unknown; next_action_minutes?: unknown; stage_id?: unknown }) {
  const dispositionKey = key(input.disposition_key, "Outcome key");
  const label = text(input.label, "Outcome label", 120);
  // A new outcome is active, so it needs its stage now.
  const stageId = input.stage_id == null || input.stage_id === "" ? null : uuid(input.stage_id, "stage");
  await assertOutcomeHasStage(tenantId, dispositionKey, label, stageId);
  const next = nextActionPatch(dispositionKey, input.next_action, input.next_action_minutes);
  const endsCall = next ? undefined : endsCallInput(dispositionKey, input.ends_call);
  const supabase = getSupabaseServiceClient();
  const { data: last } = await supabase.from("dispositions").select("sort_order").eq("tenant_id", tenantId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const row = {
    tenant_id: tenantId,
    disposition_key: dispositionKey,
    label,
    counts_as_work_completed: input.counts_as_work_completed === true,
    closes_as: input.closes_as === "dropped" ? "dropped" : "completed",
    sort_order: (last?.sort_order ?? 0) + 10,
    ...(endsCall === undefined ? {} : { ends_call: endsCall }),
    ...(next ? next.patch : {}),
  };
  const { data, error } = await supabase.from("dispositions").insert(row as never).select(DISPOSITION_COLUMNS).single();
  if (isMissingSchema(error)) throw new DispositionError("schema_pending", SCHEMA_PENDING_MESSAGE);
  if (error?.code === "23505") throw new DispositionError("duplicate", "An outcome with that key already exists. Archived outcomes keep their key: restore that one instead.");
  if (error || !data) throw new DispositionError("disposition_unavailable", error?.message ?? "Could not create the outcome.");
  // After the row exists, so a refused insert leaves no mapping behind for a key that is not an outcome.
  await mapOutcomeToStage(tenantId, dispositionKey, stageId);
  return data as unknown as Disposition;
}

export async function createDispositionNode(tenantId: string, input: { flow_id: unknown; node_key: unknown; label: unknown; prompt: unknown; node_type: unknown; note_template?: unknown }) {
  const flowId = uuid(input.flow_id, "flow id");
  const flow = await getSupabaseServiceClient().from("tenant_disposition_flows").select("id").eq("id", flowId).eq("tenant_id", tenantId).maybeSingle();
  if (flow.error || !flow.data) throw new DispositionError("flow_not_found", "That disposition flow was not found.");
  const { data: last } = await getSupabaseServiceClient().from("disposition_nodes").select("sort_order").eq("flow_id", flowId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await getSupabaseServiceClient().from("disposition_nodes").insert({ flow_id: flowId, node_key: key(input.node_key, "Node key"), label: text(input.label, "Question label", 160), prompt: text(input.prompt, "Question prompt", 2000), node_type: nodeType(input.node_type), note_template: input.note_template == null ? null : text(input.note_template, "Note template", 2000), sort_order: (last?.sort_order ?? -1) + 1 }).select("id, flow_id, node_key, label, prompt, node_type, field_key, note_template, next_node_id, sort_order, created_at, updated_at").single();
  if (error || !data) throw new DispositionError("disposition_unavailable", error?.message ?? "Could not create question.");
  return data as DispositionNode;
}

export async function updateDispositionNode(tenantId: string, nodeId: string, input: { label: unknown; prompt: unknown; node_type: unknown; note_template?: unknown; next_node_id?: unknown }) {
  const id = uuid(nodeId, "node id");
  const node = await getSupabaseServiceClient().from("disposition_nodes").select("id, flow_id").eq("id", id).maybeSingle();
  if (node.error || !node.data) throw new DispositionError("node_not_found", "That disposition question was not found.");
  const flow = await getSupabaseServiceClient().from("tenant_disposition_flows").select("id").eq("id", node.data.flow_id).eq("tenant_id", tenantId).maybeSingle();
  if (flow.error || !flow.data) throw new DispositionError("node_not_found", "That disposition question was not found.");
  const next = input.next_node_id == null || input.next_node_id === "" ? null : uuid(input.next_node_id, "next question");
  const { data, error } = await getSupabaseServiceClient().from("disposition_nodes").update({ label: text(input.label, "Question label", 160), prompt: text(input.prompt, "Question prompt", 2000), node_type: nodeType(input.node_type), note_template: input.note_template == null ? null : text(input.note_template, "Note template", 2000), next_node_id: next }).eq("id", id).select("id, flow_id, node_key, label, prompt, node_type, field_key, note_template, next_node_id, sort_order, created_at, updated_at").single();
  if (error || !data) throw new DispositionError("disposition_unavailable", error?.message ?? "Could not update question.");
  return data as DispositionNode;
}

export async function createDispositionOption(tenantId: string, input: { node_id: unknown; option_key: unknown; label: unknown; next_node_id?: unknown; disposition_key?: unknown; note_template?: unknown }) {
  const nodeId = uuid(input.node_id, "node id");
  const node = await getSupabaseServiceClient().from("disposition_nodes").select("id, flow_id").eq("id", nodeId).maybeSingle();
  if (node.error || !node.data) throw new DispositionError("node_not_found", "That disposition question was not found.");
  const flow = await getSupabaseServiceClient().from("tenant_disposition_flows").select("id").eq("id", node.data.flow_id).eq("tenant_id", tenantId).maybeSingle();
  if (flow.error || !flow.data) throw new DispositionError("node_not_found", "That disposition question was not found.");
  const { data: last } = await getSupabaseServiceClient().from("disposition_options").select("sort_order").eq("node_id", nodeId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const dispositionKey = input.disposition_key == null || input.disposition_key === "" ? null : key(input.disposition_key, "Disposition key");
  const next = input.next_node_id == null || input.next_node_id === "" ? null : uuid(input.next_node_id, "next question");
  const { data, error } = await getSupabaseServiceClient().from("disposition_options").insert({ node_id: nodeId, option_key: key(input.option_key, "Option key"), label: text(input.label, "Option label", 160), next_node_id: next, disposition_key: dispositionKey, note_template: input.note_template == null ? null : text(input.note_template, "Note template", 2000), sort_order: (last?.sort_order ?? -1) + 1 }).select("id, node_id, option_key, label, next_node_id, disposition_key, note_template, sort_order, created_at, updated_at").single();
  if (error || !data) throw new DispositionError("disposition_unavailable", error?.message ?? "Could not create answer.");
  return data as DispositionOption;
}

export async function updateDispositionOption(tenantId: string, optionId: string, input: { label: unknown; next_node_id?: unknown; disposition_key?: unknown; note_template?: unknown }) {
  const id = uuid(optionId, "option id");
  const option = await getSupabaseServiceClient().from("disposition_options").select("id, node_id").eq("id", id).maybeSingle();
  if (option.error || !option.data) throw new DispositionError("option_not_found", "That disposition answer was not found.");
  const node = await getSupabaseServiceClient().from("disposition_nodes").select("flow_id").eq("id", option.data.node_id).maybeSingle();
  const flow = node.data ? await getSupabaseServiceClient().from("tenant_disposition_flows").select("id").eq("id", node.data.flow_id).eq("tenant_id", tenantId).maybeSingle() : { data: null, error: null };
  if (node.error || flow.error || !flow.data) throw new DispositionError("option_not_found", "That disposition answer was not found.");
  const next = input.next_node_id == null || input.next_node_id === "" ? null : uuid(input.next_node_id, "next question");
  const dispositionKey = input.disposition_key == null || input.disposition_key === "" ? null : key(input.disposition_key, "Disposition key");
  const { data, error } = await getSupabaseServiceClient().from("disposition_options").update({ label: text(input.label, "Option label", 160), next_node_id: next, disposition_key: dispositionKey, note_template: input.note_template == null ? null : text(input.note_template, "Note template", 2000) }).eq("id", id).select("id, node_id, option_key, label, next_node_id, disposition_key, note_template, sort_order, created_at, updated_at").single();
  if (error || !data) throw new DispositionError("disposition_unavailable", error?.message ?? "Could not update answer.");
  return data as DispositionOption;
}

export async function getDispositionWizard(tenantId: string, userId: string, workItemId: string): Promise<DispositionWizard> {
  const workId = uuid(workItemId, "work item");
  const supabase = getSupabaseServiceClient();
  // Tenant scope is resolved BEFORE the walk is started. The other order leaks existence: a work
  // item belonging to another tenant is unclaimed by this user, so start_disposition_walk raises
  // owner_required and the route answers 403, while an id that exists nowhere answers 404. A caller
  // could tell real work-item ids from invented ones by the status code alone. Looking the row up
  // under the session tenant first means both cases answer 404, and the walk is never started for a
  // work item the caller cannot see.
  // Once an outcome moves the lead, the queue's current stage no longer matches the completed
  // walk's original stage flow. Reuse that completed walk for audit/edit views instead of asking
  // the starter RPC to resolve a new flow and incorrectly reporting FLOW_CHANGED.
  // Both reads are tenant-scoped and side-effect free, so they share one round trip; the queue
  // result is still checked first, before anything about the walk is used or returned.
  const [queue, existingWalk] = await Promise.all([
    supabase.from("lead_queue").select("id, product_line, lead_id, owner_user_id").eq("id", workId).eq("tenant_id", tenantId).single(),
    supabase
      .from("disposition_walks")
      .select("id, flow_id, status")
      .eq("tenant_id", tenantId)
      .eq("work_item_id", workId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (queue.error || !queue.data) throw new DispositionError("work_item_not_found", "That transfer was not found.");
  if (existingWalk.error) throw new DispositionError("disposition_unavailable", `Could not load the disposition walk: ${existingWalk.error.message}`);
  if (existingWalk.data && queue.data.owner_user_id !== userId) throw new DispositionError("owner_required", "Claim this transfer before recording an outcome.");
  const started = existingWalk.data
    ? { data: { walk_id: existingWalk.data.id, flow_id: existingWalk.data.flow_id }, error: null }
    : await supabase.rpc("start_disposition_walk", { p_tenant_id: tenantId, p_work_item_id: workId, p_user_id: userId });
  if (started.error || !started.data) throw apiError(started.error, "Could not start the disposition wizard.");
  const walkId = (started.data as { walk_id?: string }).walk_id;
  if (!walkId) throw new DispositionError("walk_not_found", "The disposition wizard could not be started.");
  const startedFlowId = (started.data as { flow_id: string }).flow_id;
  // The wizard is refetched after every answer, so everything left loads in one round trip: the
  // stage name and each node's options ride along as embeds (FKs tenant_disposition_flows_stage_id_fkey
  // and disposition_options_node_id_fkey) and the assignee list joins the batch.
  const [walk, flow, nodes, steps, dispositions, lead, assigneeRows] = await Promise.all([
    supabase.from("disposition_walks").select("id, flow_id, status, current_node_id, final_disposition_key, composed_note").eq("id", walkId).eq("tenant_id", tenantId).single(),
    supabase.from("tenant_disposition_flows").select("id, tenant_id, stage_id, name, is_active, root_node_id, created_at, updated_at, tenant_pipeline_stages!tenant_disposition_flows_stage_id_fkey(name)").eq("id", startedFlowId).eq("tenant_id", tenantId).single(),
    supabase.from("disposition_nodes").select("id, flow_id, node_key, label, prompt, node_type, field_key, note_template, next_node_id, sort_order, created_at, updated_at, disposition_options!disposition_options_node_id_fkey(id, node_id, option_key, label, next_node_id, disposition_key, note_template, sort_order, created_at, updated_at)").eq("flow_id", startedFlowId).order("sort_order").order("sort_order", { referencedTable: "disposition_options" }),
    supabase.from("disposition_walk_steps").select("id, sequence, node_id, answer, option_key, note_fragment").eq("walk_id", walkId).order("sequence"),
    supabase.from("dispositions").select("id, tenant_id, disposition_key, label, counts_as_work_completed, closes_as, is_active, sort_order, created_at, updated_at").eq("tenant_id", tenantId).eq("is_active", true).order("sort_order"),
    supabase.from("agent_leads").select("id, values").eq("tenant_id", tenantId).eq("id", queue.data.lead_id).single(),
    supabase.from("tenant_users").select("user_id, role, users!inner(id, name, status)").eq("tenant_id", tenantId).in("role", ["owner", "producer", "assistant"]).not("accepted_at", "is", null),
  ]);
  const failure = [walk, flow, nodes, steps, dispositions, lead].find((result) => result.error);
  if (failure?.error) throw new DispositionError("disposition_unavailable", `Could not load the disposition wizard: ${failure.error.message}`);
  if (!lead.data) throw new DispositionError("lead_not_found", "That lead was not found.");
  type EmbeddedNode = Omit<DispositionNode, "options"> & { disposition_options?: DispositionOption[] | null };
  const mappedNodes = ((nodes.data ?? []) as unknown as EmbeddedNode[]).map(({ disposition_options: options, ...node }) => ({ ...node, options: options ?? [] })) as DispositionNode[];
  const { tenant_pipeline_stages: stage, ...flowRow } = flow.data as unknown as Record<string, unknown> & { tenant_pipeline_stages?: { name: string } | { name: string }[] | null };
  const stageName = (Array.isArray(stage) ? stage[0]?.name : stage?.name) ?? "Unknown stage";
  const mappedFlow = { ...flowRow, stage_name: stageName, nodes: mappedNodes } as unknown as DispositionFlow;
  const stepNodeLabels = new Map(mappedNodes.map((node) => [node.id, node.label]));
  const values = (lead.data.values && typeof lead.data.values === "object" && !Array.isArray(lead.data.values) ? lead.data.values : {}) as Record<string, unknown>;
  const assignees = (assigneeRows.data ?? []).filter((row) => {
    const user = row.users as unknown as { id: string; name: string; status: string };
    return user?.status === "active";
  }).map((row) => {
    const user = row.users as unknown as { id: string; name: string; status: string };
    return { id: user.id, name: user.name, role: row.role };
  });
  if (assigneeRows.error) throw new DispositionError("disposition_unavailable", `Could not load callback assignees: ${assigneeRows.error.message}`);
  return { walk: walk.data as DispositionWizard["walk"], flow: mappedFlow, currentNode: mappedNodes.find((node) => node.id === (walk.data as { current_node_id: string | null }).current_node_id) ?? null, steps: (steps.data ?? []).map((step) => ({ ...step, node_label: stepNodeLabels.get(step.node_id) ?? "Question" })), dispositions: dispositions.data as Disposition[], lead: { id: lead.data.id, values }, workItem: { id: queue.data.id, productLine: queue.data.product_line }, customerTimezone: customerTimezone(values), customerName: customerName(values), assignees };
}

export async function answerDisposition(tenantId: string, userId: string, input: { work_item_id: unknown; walk_id: unknown; node_id: unknown; sequence: unknown; answer?: unknown; option_key?: unknown }) {
  const sequence = Number(input.sequence);
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 100) throw new DispositionError("invalid_input", "Choose a valid question step.");
  const result = await getSupabaseServiceClient().rpc("record_disposition_answer", { p_tenant_id: tenantId, p_work_item_id: uuid(input.work_item_id, "work item"), p_user_id: userId, p_walk_id: uuid(input.walk_id, "walk"), p_node_id: uuid(input.node_id, "question"), p_sequence: sequence, p_answer: (input.answer ?? null) as Json, p_option_key: input.option_key == null || input.option_key === "" ? null : key(input.option_key, "Option key") });
  if (result.error) throw apiError(result.error, "Could not save this answer.");
  return result.data;
}

export async function completeDisposition(tenantId: string, userId: string, input: { work_item_id: unknown; walk_id: unknown; disposition_key: unknown; callback_subtype?: unknown; callback_local?: unknown; callback_assigned_to?: unknown; callback_idempotency_key?: unknown }) {
  const subtype = input.callback_subtype == null || input.callback_subtype === "" ? null : text(input.callback_subtype, "Callback detail", 120);
  const dispositionKey = key(input.disposition_key, "Disposition key");
  const supabase = getSupabaseServiceClient();
  const result = await (dispositionKey === "callback_scheduled"
    ? await (async () => {
      if (typeof input.callback_local !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.callback_local)) throw new DispositionError("callback_date_required", "Choose a callback date and time before ending the call.");
      const local = input.callback_local;
      const assigned = input.callback_assigned_to == null || input.callback_assigned_to === "" ? null : uuid(input.callback_assigned_to, "callback assignee");
      const callbackKey = input.callback_idempotency_key == null ? crypto.randomUUID() : text(input.callback_idempotency_key, "request key", 120);
      const queue = await supabase.from("lead_queue").select("lead_id, pipeline_id").eq("tenant_id", tenantId).eq("id", uuid(input.work_item_id, "work item")).single();
      if (queue.error || !queue.data) throw new DispositionError("work_item_not_found", "That transfer was not found.");
      // Independent of each other: seed the pipeline defaults while the lead's timezone is read.
      const [, lead] = await Promise.all([
        ensureDefaultPublisherDispositionMappings(tenantId, queue.data.pipeline_id),
        supabase.from("agent_leads").select("values").eq("tenant_id", tenantId).eq("id", queue.data.lead_id).single(),
      ]);
      if (lead.error || !lead.data) throw new DispositionError("lead_not_found", "That lead was not found.");
      // Checked against the customer's calling window before anything is written.
      const window = await checkCallbackInCallingWindow({ tenantId, leadId: queue.data.lead_id, callbackLocal: local, timezone: customerTimezone((lead.data.values ?? {}) as Record<string, unknown>), actorId: userId });
      if (!window.ok) throw new DispositionError(window.status === 503 ? "disposition_unavailable" : "callback_outside_window", window.message);
      return supabase.rpc("complete_disposition_with_callback", { p_tenant_id: tenantId, p_work_item_id: uuid(input.work_item_id, "work item"), p_user_id: userId, p_walk_id: uuid(input.walk_id, "walk"), p_callback_local: local, p_customer_timezone: customerTimezone((lead.data.values ?? {}) as Record<string, unknown>), p_assigned_to: assigned, p_callback_note: subtype, p_idempotency_key: callbackKey });
    })()
    : await (async () => {
      const queue = await supabase.from("lead_queue").select("pipeline_id").eq("tenant_id", tenantId).eq("id", uuid(input.work_item_id, "work item")).single();
      if (queue.error || !queue.data) throw new DispositionError("work_item_not_found", "That transfer was not found.");
      await ensureDefaultPublisherDispositionMappings(tenantId, queue.data.pipeline_id);
      return supabase.rpc("complete_disposition", { p_tenant_id: tenantId, p_work_item_id: uuid(input.work_item_id, "work item"), p_user_id: userId, p_walk_id: uuid(input.walk_id, "walk"), p_disposition_key: dispositionKey, p_callback_subtype: subtype });
    })());
  if (result.error) throw apiError(result.error, "Could not record the call outcome.");
  return result.data;
}

/**
 * The active outcomes that land somewhere: each with the live (unarchived) stage it is mapped to in
 * stage_dispositions. An active outcome with no live stage is left out — recording it would move
 * nothing (complete_disposition falls back to the current stage), which is what the outcome wizard
 * promises not to offer. Added for the inbound wizard; listDispositionConfig is unchanged.
 */
export async function listMappedOutcomes(tenantId: string): Promise<Array<Disposition & { mapped_stage: NonNullable<DispositionSettingsRow["mapped_stage"]> }>> {
  const supabase = getSupabaseServiceClient();
  const [dispositions, mappings] = await Promise.all([
    selectDispositions(tenantId),
    supabase.from("stage_dispositions").select("stage_id, disposition_key").eq("tenant_id", tenantId),
  ]);
  if (dispositions.error) throw new DispositionError("disposition_unavailable", `Could not load call outcomes: ${dispositions.error.message}`);
  if (mappings.error) throw new DispositionError("disposition_unavailable", `Could not load outcome stages: ${mappings.error.message}`);
  const stageIds = [...new Set((mappings.data ?? []).map((mapping) => mapping.stage_id))];
  if (stageIds.length === 0) return [];
  const stages = await supabase.from("tenant_pipeline_stages").select("id, pipeline_id, name, stage_type, is_archived").in("id", stageIds).eq("is_archived", false);
  if (stages.error) throw new DispositionError("disposition_unavailable", `Could not load outcome stages: ${stages.error.message}`);
  const pipelineIds = [...new Set((stages.data ?? []).map((stage) => stage.pipeline_id))];
  const pipelines = pipelineIds.length === 0 ? { data: [], error: null } : await supabase.from("tenant_pipelines").select("id, name").eq("tenant_id", tenantId).in("id", pipelineIds);
  if (pipelines.error) throw new DispositionError("disposition_unavailable", `Could not load outcome pipelines: ${pipelines.error.message}`);
  // Only stages in this tenant's pipelines count; a stage id from elsewhere is ignored.
  const pipelineNames = new Map((pipelines.data ?? []).map((pipeline) => [pipeline.id as string, pipeline.name as string]));
  const stageById = new Map((stages.data ?? []).filter((stage) => pipelineNames.has(stage.pipeline_id)).map((stage) => [stage.id, stage]));
  const stageByKey = new Map<string, NonNullable<DispositionSettingsRow["mapped_stage"]>>();
  for (const mapping of mappings.data ?? []) {
    const stage = stageById.get(mapping.stage_id);
    if (!stage) continue;
    stageByKey.set(mapping.disposition_key, { id: stage.id, name: stage.name, stage_type: stage.stage_type, pipeline_id: stage.pipeline_id, pipeline_name: pipelineNames.get(stage.pipeline_id) ?? "Pipeline" });
  }
  return (dispositions.data ?? [])
    .filter((row) => row.is_active && stageByKey.has(row.disposition_key))
    .map((row) => ({ ...row, mapped_stage: stageByKey.get(row.disposition_key)! }));
}
