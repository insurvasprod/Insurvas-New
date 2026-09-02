import "server-only";

import type { TemplateField, TemplateFormField } from "@/lib/templates/constants";
import { getTenantTemplateForProductVersion, validateSingleTemplateValue } from "@/lib/agentTemplates/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getClientIp } from "@/lib/request/clientInfo";
import { fieldVisible, formFieldEntries, requiredVisibleKeys, verificationProgress, visibleKeys, type VerificationState } from "./progress";

type Session = { id: string; tenant_id: string; work_item_id: string; lead_id: string; user_id: string; agent_role: string; status: string; started_at: string; completed_at: string | null; progress_percentage: number; last_actor_id: string | null };
type Queue = { id: string; tenant_id: string; lead_id: string; status: string; owner_user_id: string | null; product_line: string };
type Lead = { id: string; product_line: string; definition_version: number; values: Record<string, unknown> };
type StoredField = { session_id: string; field_key: string; state: VerificationState; is_required: boolean; is_visible: boolean; old_value: unknown; new_value: unknown; confirmed_at: string | null; actor_id: string | null };

export class VerificationError extends Error {
  constructor(public code: string, message = code) { super(message); }
}

function jsonRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

async function loadContext(tenantId: string, userId: string, workItemId: string) {
  const supabase = getSupabaseServiceClient();
  const queue = await supabase.from("lead_queue").select("id, tenant_id, lead_id, status, owner_user_id, product_line").eq("id", workItemId).eq("tenant_id", tenantId).maybeSingle<Queue>();
  if (queue.error) throw new VerificationError("verification_unavailable", queue.error.message);
  if (!queue.data) throw new VerificationError("work_item_not_found", "That transfer could not be found.");
  if (!["claimed", "buffer_active", "la_active"].includes(queue.data.status) || queue.data.owner_user_id !== userId) throw new VerificationError("verification_owner_required", "Claim this transfer before opening verification.");

  const session = await supabase.from("verification_sessions").select("id, tenant_id, work_item_id, lead_id, user_id, agent_role, status, started_at, completed_at, progress_percentage, last_actor_id").eq("tenant_id", tenantId).eq("work_item_id", workItemId).is("ended_at", null).maybeSingle<Session>();
  if (session.error) throw new VerificationError("verification_unavailable", session.error.message);
  if (!session.data || session.data.user_id !== userId) throw new VerificationError("verification_owner_required", "This verification session belongs to another agent.");

  const lead = await supabase.from("agent_leads").select("id, product_line, definition_version, values").eq("id", queue.data.lead_id).eq("tenant_id", tenantId).maybeSingle<Lead>();
  if (lead.error) throw new VerificationError("verification_unavailable", lead.error.message);
  if (!lead.data) throw new VerificationError("lead_not_found", "The lead for this transfer could not be found.");
  const templateResult = await getTenantTemplateForProductVersion(tenantId, lead.data.product_line, lead.data.definition_version);
  return { supabase, queue: queue.data, session: session.data, lead: { ...lead.data, values: jsonRecord(lead.data.values) }, template: templateResult.template };
}

export async function getVerificationPanel(tenantId: string, userId: string, workItemId: string) {
  const context = await loadContext(tenantId, userId, workItemId);
  const values = context.lead.values;
  const entries = formFieldEntries(context.template.form_definition, context.template.fields, values);
  const requiredKeys = requiredVisibleKeys(context.template.form_definition, context.template.fields, values);
  const visibleFieldKeys = visibleKeys(context.template.form_definition, context.template.fields, values);
  const fields = new Map(context.template.fields.map((field) => [field.field_key, field]));
  const definitions = [...new Map(context.template.form_definition.sections.flatMap((section) => section.fields.map((field) => ({ field, definition: fields.get(field.field_key) })).filter((item): item is { field: TemplateFormField; definition: TemplateField } => Boolean(item.definition))).map((item) => [item.definition.field_key, item] as const)).values()];
  const initialRows = definitions.map(({ field, definition }) => ({
    session_id: context.session.id,
    field_key: definition.field_key,
    state: "outstanding",
    is_required: field.is_required || definition.is_required,
    is_visible: fieldVisible(field, values),
  }));
  if (initialRows.length) {
    const { error } = await context.supabase.from("verification_fields").upsert(initialRows, { onConflict: "session_id,field_key", ignoreDuplicates: true });
    if (error) throw new VerificationError("verification_unavailable", error.message);
  }
  const stored = await context.supabase.from("verification_fields").select("session_id, field_key, state, is_required, is_visible, old_value, new_value, confirmed_at, actor_id").eq("session_id", context.session.id).order("field_key").returns<StoredField[]>();
  if (stored.error) throw new VerificationError("verification_unavailable", stored.error.message);
  const storedByKey = new Map((stored.data ?? []).map((field) => [field.field_key, field]));
  const progress = verificationProgress(stored.data ?? [], requiredKeys, visibleFieldKeys);
  return {
    session: { ...context.session, progress_percentage: progress },
    workItem: { id: context.queue.id, leadId: context.queue.lead_id, productLine: context.queue.product_line },
    lead: { id: context.lead.id, values },
    template: context.template,
    sections: entries.map((section) => ({
      section_key: section.section_key,
      label: section.label,
      sort_order: section.sort_order,
      fields: section.fields.map(({ formField, field }) => ({
        ...field,
        is_required: formField.is_required || field.is_required,
        state: storedByKey.get(field.field_key)?.state ?? "outstanding",
        old_value: storedByKey.get(field.field_key)?.old_value ?? null,
        new_value: storedByKey.get(field.field_key)?.new_value ?? null,
        confirmed_at: storedByKey.get(field.field_key)?.confirmed_at ?? null,
      })),
    })),
    requiredCount: requiredKeys.length,
    visibleCount: visibleFieldKeys.length,
  };
}

export async function updateVerificationField(params: { tenantId: string; userId: string; workItemId: string; fieldKey: string; state: VerificationState; value?: unknown; request: Request }) {
  const current = await getVerificationPanel(params.tenantId, params.userId, params.workItemId);
  const definition = current.template.fields.find((field) => field.field_key === params.fieldKey);
  const formField = current.template.form_definition.sections.flatMap((section) => section.fields).find((field) => field.field_key === params.fieldKey);
  if (!definition || !formField) throw new VerificationError("verification_field_not_found", "That verification field does not exist.");
  const values = { ...current.lead.values };
  let newValue: unknown = null;
  if (params.state === "corrected") {
    const validation = validateSingleTemplateValue(definition, params.value, formField.is_required || definition.is_required);
    if (validation) throw new VerificationError("invalid_verification_value", validation);
    newValue = params.value;
    values[params.fieldKey] = params.value;
  } else if (params.state === "confirmed") {
    if (!fieldVisible(formField, values)) throw new VerificationError("field_not_visible", "This field is not currently visible.");
    newValue = values[params.fieldKey] ?? null;
    const validation = validateSingleTemplateValue(definition, newValue, formField.is_required || definition.is_required);
    if (validation) throw new VerificationError("invalid_verification_value", validation);
  } else if (fieldVisible(formField, values)) {
    newValue = null;
  }
  const requiredKeys = requiredVisibleKeys(current.template.form_definition, current.template.fields, values);
  const visibleFieldKeys = visibleKeys(current.template.form_definition, current.template.fields, values);
  const { data, error } = await getSupabaseServiceClient().rpc("update_verification_field", {
    p_tenant_id: params.tenantId,
    p_session_id: current.session.id,
    p_work_item_id: params.workItemId,
    p_user_id: params.userId,
    p_field_key: params.fieldKey,
    p_state: params.state,
    p_new_value: newValue as never,
    p_required_keys: requiredKeys,
    p_visible_keys: visibleFieldKeys,
    p_ip: getClientIp(params.request),
    p_user_agent: params.request.headers.get("user-agent"),
  });
  if (error) {
    if (["VERIFICATION_OWNER_REQUIRED", "VERIFICATION_SESSION_NOT_FOUND"].includes(error.message)) throw new VerificationError(error.message.toLowerCase(), "This verification session is no longer active.");
    if (error.message === "VERIFICATION_FIELD_NOT_FOUND") throw new VerificationError("verification_field_not_found", "That verification field does not exist.");
    throw new VerificationError("verification_update_failed", error.message);
  }
  return { result: data, panel: await getVerificationPanel(params.tenantId, params.userId, params.workItemId) };
}
