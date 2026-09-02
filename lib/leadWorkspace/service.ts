import "server-only";

import { getTenantTemplateForProductVersion } from "@/lib/agentTemplates/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listLicensedAgents, listPendingBufferHandoffs } from "@/lib/bufferHandoff/service";
import type { TemplateRow } from "@/lib/templates/constants";
import type { TenantRole } from "@/lib/tenantAuth/roles";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LeadRow = { id: string; tenant_id: string; values: unknown; created_by: string | null; created_at: string; updated_at: string; product_line: string; definition_version: number; pipeline_id: string; stage_id: string; screening_outcome: string | null; screening_warning: string | null; screening_checked_at: string | null };
type QueueRow = { id: string; lead_id: string; partner_id: string | null; status: string; claimed_by: string | null; owner_user_id: string | null; owner_role: string | null; claimed_at: string | null; queued_at: string; disposition: string | null; disposition_at: string | null; disposition_by: string | null; pipeline_id: string; stage_id: string; updated_at: string };
type VerificationSession = { id: string; work_item_id: string; user_id: string; agent_role: string; status: string; started_at: string; completed_at: string | null; progress_percentage: number; last_actor_id: string | null };
type VerificationField = { session_id: string; field_key: string; state: string; is_required: boolean; is_visible: boolean; old_value: unknown; new_value: unknown; confirmed_at: string | null; actor_id: string | null };
type FieldChange = { id: string; field_key: string; old_value: unknown; new_value: unknown; actor_id: string | null; created_at: string };
type AuditRow = { id: string; ts: string; actor_type: string; actor_id: string | null; action: string; target_type: string; target_id: string; reason: string | null; metadata: unknown };
type MessageRow = { id: string; message: string; message_kind: string; created_by: string | null; created_at: string };

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function display(value: unknown) { return Array.isArray(value) ? value.join(", ") : value === null || value === undefined || value === "" ? "Not provided" : String(value); }
function label(action: string) { return action.replace(/^(tenant\.|admin\.)/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export type LeadWorkspaceEvent = { id: string; label: string; at: string; actor: string; detail: string | null; immutable: true };

export async function getLeadWorkspace(tenantId: string, userId: string, role: TenantRole, leadId: string) {
  if (!UUID.test(leadId)) throw new Error("Choose a valid lead");
  const db = getSupabaseServiceClient();
  const leadResult = await db.from("agent_leads").select("id, tenant_id, values, created_by, created_at, updated_at, product_line, definition_version, pipeline_id, stage_id, screening_outcome, screening_warning, screening_checked_at").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle<LeadRow>();
  if (leadResult.error) throw new Error(`Could not load lead: ${leadResult.error.message}`);
  if (!leadResult.data) throw new Error("Lead not found");
  const lead = leadResult.data;
  const queueResult = await db.from("lead_queue").select("id, lead_id, partner_id, status, claimed_by, owner_user_id, owner_role, claimed_at, queued_at, disposition, disposition_at, disposition_by, pipeline_id, stage_id, updated_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("queued_at", { ascending: false }).limit(1).maybeSingle<QueueRow>();
  if (queueResult.error) throw new Error(`Could not load lead work item: ${queueResult.error.message}`);
  const queue = queueResult.data;
  const [templateResult, stageResult, stagesResult, partnerResult, usersResult, verificationResult, changesResult, auditResult, messagesResult, dispositionsResult] = await Promise.all([
    getTenantTemplateForProductVersion(tenantId, lead.product_line, lead.definition_version),
    db.from("pipeline_stages").select("id, pipeline_id, name, stage_type, color, position, is_archived").eq("id", lead.stage_id).maybeSingle(),
    db.from("pipeline_stages").select("id, pipeline_id, name, stage_type, color, position, is_archived").eq("pipeline_id", lead.pipeline_id).eq("is_archived", false).order("position"),
    queue?.partner_id ? db.from("partners").select("id, name, partner_type").eq("tenant_id", tenantId).eq("id", queue.partner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("users").select("id, name").eq("id", lead.created_by ?? "00000000-0000-0000-0000-000000000000"),
    queue ? db.from("verification_sessions").select("id, work_item_id, user_id, agent_role, status, started_at, completed_at, progress_percentage, last_actor_id").eq("tenant_id", tenantId).eq("lead_id", leadId).order("started_at", { ascending: false }).limit(1).maybeSingle<VerificationSession>() : Promise.resolve({ data: null, error: null }),
    db.from("verification_field_changes").select("id, field_key, old_value, new_value, actor_id, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: true }).returns<FieldChange[]>(),
    db.from("audit_log").select("id, ts, actor_type, actor_id, action, target_type, target_id, reason, metadata").in("target_id", [leadId, ...(queue ? [queue.id] : [])]).order("ts", { ascending: true }).returns<AuditRow[]>(),
    queue ? db.from("partner_messages").select("id, message, message_kind, created_by, created_at").eq("tenant_id", tenantId).eq("work_item_id", queue.id).order("created_at", { ascending: true }).returns<MessageRow[]>() : Promise.resolve({ data: [], error: null }),
    queue?.disposition ? db.from("dispositions").select("disposition_key, label").eq("tenant_id", tenantId).eq("disposition_key", queue.disposition).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const failure = [stageResult, stagesResult, partnerResult, usersResult, verificationResult, changesResult, auditResult, messagesResult, dispositionsResult].find((result) => result.error);
  if (failure?.error) throw new Error(`Could not load lead workspace: ${failure.error.message}`);
  const actorIds = new Set<string>();
  for (const id of [lead.created_by, queue?.claimed_by, queue?.owner_user_id, queue?.disposition_by, verificationResult.data?.user_id, verificationResult.data?.last_actor_id, ...(changesResult.data ?? []).map((change) => change.actor_id), ...(auditResult.data ?? []).map((event) => event.actor_id), ...(messagesResult.data ?? []).map((message) => message.created_by)]) if (id) actorIds.add(id);
  const actors = actorIds.size ? await db.from("users").select("id, name").in("id", [...actorIds]) : { data: [], error: null };
  if (actors.error) throw new Error(`Could not load lead actors: ${actors.error.message}`);
  const actorNames = new Map((actors.data ?? []).map((actor) => [actor.id, actor.name]));
  const verificationFields = verificationResult.data ? await db.from("verification_fields").select("session_id, field_key, state, is_required, is_visible, old_value, new_value, confirmed_at, actor_id").eq("session_id", verificationResult.data.id).order("field_key").returns<VerificationField[]>() : { data: [], error: null };
  if (verificationFields.error) throw new Error(`Could not load verification fields: ${verificationFields.error.message}`);
  const verification = verificationResult.data ? { session: verificationResult.data, fields: verificationFields.data ?? [], changes: changesResult.data ?? [] } : null;
  const events: LeadWorkspaceEvent[] = [];
  const addEvent = (id: string, at: string, action: string, actorId: string | null, detail: string | null) => events.push({ id, at, label: label(action), actor: actorId ? actorNames.get(actorId) ?? "Unknown actor" : "System", detail, immutable: true });
  addEvent(`created:${lead.id}`, lead.created_at, "lead submitted", lead.created_by, `Product: ${lead.product_line}`);
  for (const event of auditResult.data ?? []) addEvent(`audit:${event.id}`, event.ts, event.action, event.actor_id, event.reason ?? (record(event.metadata).stageId ? `Stage: ${record(event.metadata).stageId}` : null));
  for (const change of changesResult.data ?? []) addEvent(`correction:${change.id}`, change.created_at, "verification correction", change.actor_id, `${change.field_key}: ${display(change.old_value)} → ${display(change.new_value)}`);
  for (const message of messagesResult.data ?? []) addEvent(`message:${message.id}`, message.created_at, message.message_kind === "system_card" ? "partner channel update" : "note/message", message.created_by, message.message);
  events.sort((a, b) => a.at.localeCompare(b.at));
  const licensedAgents = role === "assistant" && queue ? await listLicensedAgents(tenantId, userId) : [];
  const pendingHandoff = (role === "owner" || role === "producer") && queue ? (await listPendingBufferHandoffs(tenantId, userId)).find((handoff) => handoff.workItemId === queue.id) ?? null : null;
  const currentOwner = queue?.owner_user_id === userId;
  return {
    lead: { ...lead, values: record(lead.values) },
    template: templateResult.template as TemplateRow,
    queue,
    partner: partnerResult.data,
    stage: stageResult.data,
    stages: stagesResult.data ?? [],
    submitter: lead.created_by ? { id: lead.created_by, name: actorNames.get(lead.created_by) ?? "Unknown user" } : null,
    owner: queue?.owner_user_id ? { id: queue.owner_user_id, name: actorNames.get(queue.owner_user_id) ?? "Unknown user" } : null,
    screening: { outcome: lead.screening_outcome, warning: lead.screening_warning, checkedAt: lead.screening_checked_at },
    disposition: dispositionsResult.data,
    verification,
    corrections: changesResult.data ?? [],
    timeline: events,
    role,
    currentUserId: userId,
    licensedAgents,
    pendingHandoff,
    actions: { canClaim: Boolean(queue && queue.status === "unclaimed"), canHandoff: Boolean(queue && role === "assistant" && currentOwner && ["claimed", "buffer_active"].includes(queue.status)), canAcceptHandoff: Boolean(pendingHandoff), canDisposition: Boolean(queue && currentOwner && ["owner", "producer"].includes(role)), canChangeStage: ["owner", "producer", "assistant"].includes(role) },
  };
}
