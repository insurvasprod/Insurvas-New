import "server-only";

import { getTenantTemplateForProductVersion } from "@/lib/agentTemplates/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listLicensedAgents, listPendingBufferHandoffs } from "@/lib/bufferHandoff/service";
import { listLeadNotes, listTeammates } from "@/lib/leadNotes/service";
import type { TemplateRow } from "@/lib/templates/constants";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import type { PreflightResult } from "@/lib/existingCustomerPreflight/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LeadRow = { id: string; tenant_id: string; values: unknown; created_by: string | null; created_at: string; updated_at: string; product_line: string; definition_version: number; pipeline_id: string; stage_id: string; screening_outcome: string | null; screening_warning: string | null; screening_checked_at: string | null; preflight_status: string; preflight_checked_at: string | null; preflight_result: unknown };
type QueueRow = { id: string; lead_id: string; partner_id: string | null; status: string; claimed_by: string | null; owner_user_id: string | null; owner_role: string | null; claimed_at: string | null; queued_at: string; disposition: string | null; disposition_at: string | null; disposition_by: string | null; pipeline_id: string; stage_id: string; updated_at: string };
type VerificationSession = { id: string; work_item_id: string; user_id: string; agent_role: string; status: string; started_at: string; completed_at: string | null; progress_percentage: number; last_actor_id: string | null };
type VerificationField = { session_id: string; field_key: string; state: string; is_required: boolean; is_visible: boolean; old_value: unknown; new_value: unknown; confirmed_at: string | null; actor_id: string | null };
type FieldChange = { id: string; field_key: string; old_value: unknown; new_value: unknown; actor_id: string | null; created_at: string };
type AuditRow = { id: string; ts: string; actor_type: string; actor_id: string | null; action: string; target_type: string; target_id: string; reason: string | null; metadata: unknown };
type MessageRow = { id: string; message: string; message_kind: string; created_by: string | null; created_at: string };
type CallbackHistoryRow = { id: string; callback_id: string; actor_user_id: string; action: string; old_scheduled_at_utc: string | null; new_scheduled_at_utc: string | null; created_at: string };

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function display(value: unknown) { return Array.isArray(value) ? value.join(", ") : value === null || value === undefined || value === "" ? "Not provided" : String(value); }
function label(action: string) { return action.replace(/^(tenant\.|admin\.)/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

/**
 * `immutable` means "this entry is backed by a store the application's own role cannot rewrite in
 * place", not "this looks like history". It was a hardcoded `true` on every event, which made it a
 * constant rather than a fact -- and made any assertion on it a tautology.
 *
 * True for audit_log, verification_field_changes and callback_history: audit_log is granted only
 * INSERT and SELECT, and the other two had UPDATE and TRUNCATE revoked in 20260913150000.
 *
 * False for note and partner-message entries, which are genuinely rewritten in place --
 * lib/leadNotes/service.ts edits a shared note's row rather than appending a revision.
 */
export type LeadWorkspaceEvent = { id: string; label: string; at: string; actor: string; detail: string | null; immutable: boolean };

export async function getLeadWorkspace(tenantId: string, userId: string, role: TenantRole, leadId: string) {
  if (!UUID.test(leadId)) throw new Error("Choose a valid lead");
  const db = getSupabaseServiceClient();
  // Both reads are keyed only by tenant + lead id, so they share one round trip. Nothing is returned
  // until the setter check below has passed.
  const [leadResult, queueResult] = await Promise.all([
    db.from("agent_leads").select("id, tenant_id, values, created_by, created_at, updated_at, product_line, definition_version, pipeline_id, stage_id, screening_outcome, screening_warning, screening_checked_at, preflight_status, preflight_checked_at, preflight_result").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle<LeadRow>(),
    db.from("lead_queue").select("id, lead_id, partner_id, status, claimed_by, owner_user_id, owner_role, claimed_at, queued_at, disposition, disposition_at, disposition_by, pipeline_id, stage_id, updated_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("queued_at", { ascending: false }).limit(1).maybeSingle<QueueRow>(),
  ]);
  if (leadResult.error) throw new Error(`Could not load lead: ${leadResult.error.message}`);
  if (!leadResult.data) throw new Error("Lead not found");
  const lead = leadResult.data;
  if (queueResult.error) throw new Error(`Could not load lead work item: ${queueResult.error.message}`);
  const queue = queueResult.data;

  // LA-2.12 criterion 2: "A setter cannot see another setter's leads."
  //
  // The check is the work item's owner, not the lead's creator: a setter's claim on a lead is
  // recorded on lead_queue by serve_next_lead, and the lead row itself has no owner. A setter who
  // has not been served this lead — including one nobody has claimed — gets the same "Lead not
  // found" the route already returns for a lead in another tenant, because confirming that a lead
  // exists is itself a leak of another setter's work.
  if (role === "setter" && queue?.owner_user_id !== userId) {
    throw new Error("Lead not found");
  }

  const loadAttemptHistory = async (): Promise<{ data: unknown; error: { message: string } | null }> => {
    let attemptHistoryResult: { data: unknown; error: { message: string } | null };
    try {
      attemptHistoryResult = await (db as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> }).rpc("lead_attempt_history", { p_tenant_id: tenantId, p_lead_id: leadId });
    } catch (error) {
      // The attempt-history RPC belongs to the later recycling module. A tenant may be running the
      // LA-1 workspace before that additive migration has been applied, so an absent optional
      // history provider must not make the core lead workspace unusable. Other database failures
      // remain visible to the operator instead of being swallowed.
      const message = error instanceof Error ? error.message : String(error);
      if (/lead_attempt_history|schema cache|could not find the function/i.test(message)) return { data: [], error: null };
      throw error;
    }
    if (attemptHistoryResult.error) {
      if (/lead_attempt_history|schema cache|could not find the function/i.test(attemptHistoryResult.error.message)) return { data: [], error: null };
      throw new Error(`Could not load lead attempt history: ${attemptHistoryResult.error.message}`);
    }
    return attemptHistoryResult;
  };

  // Everything here depends only on the lead and queue rows, so notes, teammates, attempt history
  // and the handoff lists ride in the same round trip instead of trailing it one by one.
  const [templateResult, stageResult, stagesResult, partnerResult, usersResult, verificationResult, changesResult, auditResult, messagesResult, dispositionsResult, callbackHistoryResult, notes, teammates, attemptHistoryResult, licensedAgents, pendingHandoffs] = await Promise.all([
    getTenantTemplateForProductVersion(tenantId, lead.product_line, lead.definition_version),
    db.from("tenant_pipeline_stages").select("id, pipeline_id, name, stage_type, color, position, is_archived").eq("id", lead.stage_id).maybeSingle(),
    db.from("tenant_pipeline_stages").select("id, pipeline_id, name, stage_type, color, position, is_archived").eq("pipeline_id", lead.pipeline_id).eq("is_archived", false).order("position"),
    queue?.partner_id ? db.from("partners").select("id, name, partner_type").eq("tenant_id", tenantId).eq("id", queue.partner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("users").select("id, name").eq("id", lead.created_by ?? "00000000-0000-0000-0000-000000000000"),
    queue ? db.from("tenant_verification_sessions").select("id, work_item_id, user_id, agent_role, status, started_at, completed_at, progress_percentage, last_actor_id").eq("tenant_id", tenantId).eq("lead_id", leadId).order("started_at", { ascending: false }).limit(1).maybeSingle<VerificationSession>() : Promise.resolve({ data: null, error: null }),
    db.from("verification_field_changes").select("id, field_key, old_value, new_value, actor_id, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: true }).returns<FieldChange[]>(),
    db.from("audit_log").select("id, ts, actor_type, actor_id, action, target_type, target_id, reason, metadata").in("target_id", [leadId, ...(queue ? [queue.id] : [])]).order("ts", { ascending: true }).returns<AuditRow[]>(),
    queue ? db.from("partner_messages").select("id, message, message_kind, created_by, created_at").eq("tenant_id", tenantId).eq("work_item_id", queue.id).order("created_at", { ascending: true }).returns<MessageRow[]>() : Promise.resolve({ data: [], error: null }),
    queue?.disposition ? db.from("dispositions").select("disposition_key, label").eq("tenant_id", tenantId).eq("disposition_key", queue.disposition).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("callback_history").select("id, callback_id, actor_user_id, action, old_scheduled_at_utc, new_scheduled_at_utc, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: true }).returns<CallbackHistoryRow[]>(),
    listLeadNotes(tenantId, leadId),
    listTeammates(tenantId),
    loadAttemptHistory(),
    role === "assistant" && queue ? listLicensedAgents(tenantId, userId) : Promise.resolve([]),
    (role === "owner" || role === "producer") && queue ? listPendingBufferHandoffs(tenantId, userId) : Promise.resolve(null),
  ]);
  const failure = [stageResult, stagesResult, partnerResult, usersResult, verificationResult, changesResult, auditResult, messagesResult, dispositionsResult, callbackHistoryResult].find((result) => result.error);
  if (failure?.error) throw new Error(`Could not load lead workspace: ${failure.error.message}`);
  const actorIds = new Set<string>();
  for (const id of [lead.created_by, queue?.claimed_by, queue?.owner_user_id, queue?.disposition_by, verificationResult.data?.user_id, verificationResult.data?.last_actor_id, ...(changesResult.data ?? []).map((change) => change.actor_id), ...(auditResult.data ?? []).map((event) => event.actor_id), ...(messagesResult.data ?? []).map((message) => message.created_by), ...(callbackHistoryResult.data ?? []).map((event) => event.actor_user_id)]) if (id) actorIds.add(id);
  // Both need only the results above, so they share a round trip. The open call and the quoted
  // premium (LeadWorkspace concept board) ride along; either failing leaves its fact empty.
  const [actors, verificationFields, openCall, quote] = await Promise.all([
    actorIds.size ? db.from("users").select("id, name").in("id", [...actorIds]) : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    verificationResult.data ? db.from("verification_fields").select("session_id, field_key, state, is_required, is_visible, old_value, new_value, confirmed_at, actor_id").eq("session_id", verificationResult.data.id).order("field_key").returns<VerificationField[]>() : Promise.resolve({ data: [] as VerificationField[], error: null }),
    db.from("active_calls").select("started_at, user_id").eq("tenant_id", tenantId).eq("lead_id", leadId).is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("deal_flow").select("monthly_premium_cents").eq("tenant_id", tenantId).eq("lead_id", leadId).maybeSingle(),
  ]);
  if (actors.error) throw new Error(`Could not load lead actors: ${actors.error.message}`);
  const actorNames = new Map((actors.data ?? []).map((actor) => [actor.id, actor.name]));
  if (verificationFields.error) throw new Error(`Could not load verification fields: ${verificationFields.error.message}`);
  const verification = verificationResult.data ? { session: verificationResult.data, fields: verificationFields.data ?? [], changes: changesResult.data ?? [] } : null;
  const events: LeadWorkspaceEvent[] = [];
  const addEvent = (id: string, at: string, action: string, actorId: string | null, detail: string | null, immutable = true) => events.push({ id, at, label: label(action), actor: actorId ? actorNames.get(actorId) ?? "Unknown actor" : "System", detail, immutable });
  addEvent(`created:${lead.id}`, lead.created_at, "lead submitted", lead.created_by, `Product: ${lead.product_line}`);
  // Screening is stored on the lead, not as an audit row, so the timeline read it from there.
  if (lead.screening_checked_at && lead.screening_outcome) addEvent(`screening:${lead.id}`, lead.screening_checked_at, lead.screening_outcome === "clear" ? "screening cleared" : `screening ${lead.screening_outcome.replaceAll("_", " ")}`, null, lead.screening_warning ?? (lead.screening_outcome === "clear" ? "No litigator, DNC or duplicate match" : null));
  for (const event of auditResult.data ?? []) addEvent(`audit:${event.id}`, event.ts, event.action, event.actor_id, event.reason ?? (record(event.metadata).stageId ? `Stage: ${record(event.metadata).stageId}` : null));
  for (const change of changesResult.data ?? []) addEvent(`correction:${change.id}`, change.created_at, "verification correction", change.actor_id, `${change.field_key}: ${display(change.old_value)} → ${display(change.new_value)}`);
  // A note is one event whose timestamp and body move when it is edited, rather than an original
  // followed by a revision -- so this entry does not preserve what it replaced. Flagged accordingly.
  for (const note of notes) addEvent(`note:${note.id}`, note.deletedAt ?? note.editedAt ?? note.createdAt, note.deletedAt ? "lead note deleted" : note.editedAt ? "lead note edited" : "lead note added", note.author.id, note.deletedAt ? "Note deleted (tombstone retained)" : `${note.visibility === "shared" ? "Shared" : "Internal"} note: ${note.body}`, false);
  for (const message of messagesResult.data ?? []) addEvent(`message:${message.id}`, message.created_at, message.message_kind === "system_card" ? "partner channel update" : "note/message", message.created_by, message.message, false);
  for (const event of callbackHistoryResult.data ?? []) addEvent(`callback:${event.id}`, event.created_at, `callback ${event.action}`, event.actor_user_id, event.new_scheduled_at_utc ? `Scheduled at ${event.new_scheduled_at_utc}` : null);
  events.sort((a, b) => a.at.localeCompare(b.at));
  const pendingHandoff = pendingHandoffs && queue ? pendingHandoffs.find((handoff) => handoff.workItemId === queue.id) ?? null : null;
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
    activeCall: !openCall.error && openCall.data ? { startedAt: openCall.data.started_at, agentName: actorNames.get(openCall.data.user_id) ?? null } : null,
    quotedMonthlyCents: !quote.error ? quote.data?.monthly_premium_cents ?? null : null,
    attemptHistory: Array.isArray(attemptHistoryResult.data) ? attemptHistoryResult.data : [],
    preflight: {
      ...(record(lead.preflight_result) as unknown as PreflightResult),
      status: lead.preflight_status,
      checkedAt: lead.preflight_checked_at,
      policyMatchingIncluded: false,
      policyMatchingNote:
        typeof record(lead.preflight_result).policyMatchingNote === "string"
          ? record(lead.preflight_result).policyMatchingNote
          : "Policy matching is not included yet; this check covers prior leads and contacts only.",
    },
    disposition: dispositionsResult.data,
    verification,
    corrections: changesResult.data ?? [],
    notes,
    teammates: teammates.map((user) => ({ id: user.id, name: user.name, role: user.role })),
    timeline: events,
    role,
    currentUserId: userId,
    licensedAgents,
    pendingHandoff,
    actions: { canClaim: Boolean(queue && queue.status === "unclaimed"), canHandoff: Boolean(queue && role === "assistant" && currentOwner && ["claimed", "buffer_active"].includes(queue.status)), canAcceptHandoff: Boolean(pendingHandoff), canDisposition: Boolean(queue && currentOwner && ["owner", "producer"].includes(role)), canChangeStage: ["owner", "producer", "assistant"].includes(role) },
  };
}
