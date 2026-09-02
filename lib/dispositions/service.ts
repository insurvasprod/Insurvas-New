import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import type { Disposition, DispositionFlow, DispositionNode, DispositionNodeType, DispositionOption, DispositionWizard } from "./types";
import { DISPOSITION_KEY_PATTERN, DISPOSITION_NODE_TYPES } from "./types";
import { customerName, customerTimezone } from "@/lib/callbacks/timezone";

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

export async function listDispositionConfig(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const [dispositions, flows, pipelines] = await Promise.all([
    supabase.from("dispositions").select("id, tenant_id, disposition_key, label, counts_as_work_completed, closes_as, is_active, sort_order, created_at, updated_at").eq("tenant_id", tenantId).order("sort_order"),
    supabase.from("disposition_flows").select("id, tenant_id, stage_id, name, is_active, root_node_id, created_at, updated_at").eq("tenant_id", tenantId).order("name"),
    supabase.from("pipelines").select("id, tenant_id").eq("tenant_id", tenantId),
  ]);
  const pipelineIds = (pipelines.data ?? []).map((pipeline) => pipeline.id);
  const stages = pipelineIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("pipeline_stages").select("id, pipeline_id, name").in("pipeline_id", pipelineIds).order("name");
  const flowIds = (flows.data ?? []).map((flow) => flow.id);
  const nodes = flowIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("disposition_nodes").select("id, flow_id, node_key, label, prompt, node_type, field_key, note_template, next_node_id, sort_order, created_at, updated_at").in("flow_id", flowIds).order("sort_order");
  const nodeIds = (nodes.data ?? []).map((node) => node.id);
  const options = nodeIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("disposition_options").select("id, node_id, option_key, label, next_node_id, disposition_key, note_template, sort_order, created_at, updated_at").in("node_id", nodeIds).order("sort_order");
  const failure = [dispositions, flows, pipelines, stages, nodes, options].find((result) => result.error);
  if (failure?.error) throw new DispositionError("disposition_unavailable", `Could not load disposition settings: ${failure.error.message}`);
  const stageNames = new Map((stages.data ?? []).map((stage) => [stage.id, stage.name]));
  const optionMap = new Map<string, DispositionOption[]>();
  for (const option of (options.data ?? []) as DispositionOption[]) optionMap.set(option.node_id, [...(optionMap.get(option.node_id) ?? []), option]);
  const nodeMap = new Map<string, DispositionNode[]>();
  for (const node of (nodes.data ?? []) as DispositionNode[]) nodeMap.set(node.flow_id, [...(nodeMap.get(node.flow_id) ?? []), { ...node, options: optionMap.get(node.id) ?? [] }]);
  return {
    dispositions: (dispositions.data ?? []) as Disposition[],
    flows: (flows.data ?? []).map((flow) => ({ ...flow, stage_name: stageNames.get(flow.stage_id) ?? "Unknown stage", nodes: nodeMap.get(flow.id) ?? [] })) as DispositionFlow[],
    stages: (stages.data ?? []).map((stage) => ({ id: stage.id, pipeline_id: stage.pipeline_id, name: stage.name })),
  };
}

export async function updateDisposition(tenantId: string, dispositionId: string, input: { label: unknown; counts_as_work_completed: unknown; closes_as: unknown; is_active?: unknown }) {
  const patch = {
    label: text(input.label, "Disposition label", 120),
    counts_as_work_completed: input.counts_as_work_completed === true,
    closes_as: input.closes_as === "dropped" ? "dropped" : "completed",
    ...(input.is_active === undefined ? {} : { is_active: input.is_active === true }),
  };
  const { data, error } = await getSupabaseServiceClient().from("dispositions").update(patch).eq("tenant_id", tenantId).eq("id", uuid(dispositionId, "disposition id")).select("id, tenant_id, disposition_key, label, counts_as_work_completed, closes_as, is_active, sort_order, created_at, updated_at").single();
  if (error || !data) throw new DispositionError("disposition_unavailable", error?.message ?? "Could not update disposition.");
  return data as Disposition;
}

export async function createDispositionNode(tenantId: string, input: { flow_id: unknown; node_key: unknown; label: unknown; prompt: unknown; node_type: unknown; note_template?: unknown }) {
  const flowId = uuid(input.flow_id, "flow id");
  const flow = await getSupabaseServiceClient().from("disposition_flows").select("id").eq("id", flowId).eq("tenant_id", tenantId).maybeSingle();
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
  const flow = await getSupabaseServiceClient().from("disposition_flows").select("id").eq("id", node.data.flow_id).eq("tenant_id", tenantId).maybeSingle();
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
  const flow = await getSupabaseServiceClient().from("disposition_flows").select("id").eq("id", node.data.flow_id).eq("tenant_id", tenantId).maybeSingle();
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
  const flow = node.data ? await getSupabaseServiceClient().from("disposition_flows").select("id").eq("id", node.data.flow_id).eq("tenant_id", tenantId).maybeSingle() : { data: null, error: null };
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
  const started = await supabase.rpc("start_disposition_walk", { p_tenant_id: tenantId, p_work_item_id: workId, p_user_id: userId });
  if (started.error || !started.data) throw apiError(started.error, "Could not start the disposition wizard.");
  const walkId = (started.data as { walk_id?: string }).walk_id;
  if (!walkId) throw new DispositionError("walk_not_found", "The disposition wizard could not be started.");
  const queue = await supabase.from("lead_queue").select("id, product_line, lead_id").eq("id", workId).eq("tenant_id", tenantId).single();
  if (queue.error || !queue.data) throw new DispositionError("work_item_not_found", "That transfer was not found.");
  const startedFlowId = (started.data as { flow_id: string }).flow_id;
  const [walk, flow, nodes, steps, dispositions, lead] = await Promise.all([
    supabase.from("disposition_walks").select("id, flow_id, status, current_node_id, final_disposition_key, composed_note").eq("id", walkId).eq("tenant_id", tenantId).single(),
    supabase.from("disposition_flows").select("id, tenant_id, stage_id, name, is_active, root_node_id, created_at, updated_at").eq("id", startedFlowId).eq("tenant_id", tenantId).single(),
    supabase.from("disposition_nodes").select("id, flow_id, node_key, label, prompt, node_type, field_key, note_template, next_node_id, sort_order, created_at, updated_at").eq("flow_id", startedFlowId).order("sort_order"),
    supabase.from("disposition_walk_steps").select("id, sequence, node_id, answer, option_key, note_fragment").eq("walk_id", walkId).order("sequence"),
    supabase.from("dispositions").select("id, tenant_id, disposition_key, label, counts_as_work_completed, closes_as, is_active, sort_order, created_at, updated_at").eq("tenant_id", tenantId).eq("is_active", true).order("sort_order"),
    supabase.from("agent_leads").select("id, values").eq("tenant_id", tenantId).eq("id", queue.data.lead_id).single(),
  ]);
  const nodeIds = (nodes.data ?? []).map((node) => node.id);
  const options = nodeIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("disposition_options").select("id, node_id, option_key, label, next_node_id, disposition_key, note_template, sort_order, created_at, updated_at").in("node_id", nodeIds).order("sort_order");
  const failure = [walk, flow, nodes, options, steps, dispositions, lead].find((result) => result.error);
  if (failure?.error) throw new DispositionError("disposition_unavailable", `Could not load the disposition wizard: ${failure.error.message}`);
  if (!lead.data) throw new DispositionError("lead_not_found", "That lead was not found.");
  const optionMap = new Map<string, DispositionOption[]>();
  for (const option of (options.data ?? []) as DispositionOption[]) optionMap.set(option.node_id, [...(optionMap.get(option.node_id) ?? []), option]);
  const mappedNodes = (nodes.data ?? []).map((node) => ({ ...node, options: optionMap.get(node.id) ?? [] })) as DispositionNode[];
  const stage = await supabase.from("pipeline_stages").select("name").eq("id", (flow.data as { stage_id: string }).stage_id).maybeSingle();
  const assigneeRows = await supabase.from("tenant_users").select("user_id, role, users!inner(id, name, status)").eq("tenant_id", tenantId).in("role", ["owner", "producer", "assistant"]).not("accepted_at", "is", null);
  const mappedFlow = { ...flow.data, stage_name: stage.data?.name ?? "Unknown stage", nodes: mappedNodes } as DispositionFlow;
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
      const queue = await supabase.from("lead_queue").select("lead_id").eq("tenant_id", tenantId).eq("id", uuid(input.work_item_id, "work item")).single();
      if (queue.error || !queue.data) throw new DispositionError("work_item_not_found", "That transfer was not found.");
      const lead = await supabase.from("agent_leads").select("values").eq("tenant_id", tenantId).eq("id", queue.data.lead_id).single();
      if (lead.error || !lead.data) throw new DispositionError("lead_not_found", "That lead was not found.");
      return supabase.rpc("complete_disposition_with_callback", { p_tenant_id: tenantId, p_work_item_id: uuid(input.work_item_id, "work item"), p_user_id: userId, p_walk_id: uuid(input.walk_id, "walk"), p_callback_local: local, p_customer_timezone: customerTimezone((lead.data.values ?? {}) as Record<string, unknown>), p_assigned_to: assigned, p_callback_note: subtype, p_idempotency_key: callbackKey });
    })()
    : supabase.rpc("complete_disposition", { p_tenant_id: tenantId, p_work_item_id: uuid(input.work_item_id, "work item"), p_user_id: userId, p_walk_id: uuid(input.walk_id, "walk"), p_disposition_key: dispositionKey, p_callback_subtype: subtype }));
  if (result.error) throw apiError(result.error, "Could not record the call outcome.");
  return result.data;
}
