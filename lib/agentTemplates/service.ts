import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import { fetchTemplateVersion } from "@/lib/templates/queries";
import type { TemplateField, TemplateRow, TemplateStage } from "@/lib/templates/constants";

const PRODUCT_CODE = "term_life";

export type AgentTemplate = {
  assignment: { id: string; template_id: string; template_version: number; product_code: string };
  template: TemplateRow;
  latest: { version: number; name: string } | null;
};

function validateValues(fields: TemplateField[], values: unknown) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "Lead values must be an object";
  const record = values as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field.field_key];
    if (field.is_required && (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))) {
      return `${field.label} is required`;
    }
    if (value === undefined || value === null || value === "") continue;
    if (["number", "currency"].includes(field.type) && (typeof value !== "number" || !Number.isFinite(value) || (field.type === "currency" && !Number.isInteger(value)))) {
      return `${field.label} must be a number`;
    }
    if (field.type === "boolean" && typeof value !== "boolean") return `${field.label} must be true or false`;
    if (["single_select"].includes(field.type) && (typeof value !== "string" || !field.options.includes(value))) return `${field.label} must use one of the listed options`;
    if (field.type === "multi_select" && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !field.options.includes(item)))) return `${field.label} contains an invalid option`;
    if (["text", "date", "phone"].includes(field.type) && typeof value !== "string") return `${field.label} must be text`;
  }
  const allowed = new Set(fields.map((field) => field.field_key));
  if (Object.keys(record).some((key) => !allowed.has(key))) return "Lead contains a field that is not in the assigned template";
  return null;
}

async function loadLatestTemplate(productCode = PRODUCT_CODE) {
  const { data, error } = await getSupabaseServiceClient()
    .from("templates")
    .select("id, name, product_code, version, description, is_active, created_by, created_at, updated_at")
    .eq("product_code", productCode)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load active template: ${error.message}`);
  return data;
}

export async function getAgentTemplate(tenantId: string, userId: string): Promise<AgentTemplate> {
  const supabase = getSupabaseServiceClient();
  const { data: initialAssignment, error } = await supabase
    .from("tenant_template_assignments")
    .select("id, template_id, template_version, product_code")
    .eq("tenant_id", tenantId)
    .eq("product_code", PRODUCT_CODE)
    .maybeSingle();
  if (error) throw new Error(`Could not load template assignment: ${error.message}`);

  let assignment = initialAssignment;

  if (!assignment) {
    const latest = await loadLatestTemplate();
    if (!latest) throw new Error("No active Term Life template is available");
    const inserted = await supabase.from("tenant_template_assignments").insert({
      tenant_id: tenantId,
      product_code: PRODUCT_CODE,
      template_id: latest.id,
      template_version: latest.version,
      assigned_by: userId,
    }).select("id, template_id, template_version, product_code").maybeSingle();
    if (inserted.error && inserted.error.code !== "23505") throw new Error(`Could not assign template: ${inserted.error.message}`);
    assignment = inserted.data;
    if (!assignment) {
      const retried = await supabase.from("tenant_template_assignments").select("id, template_id, template_version, product_code").eq("tenant_id", tenantId).eq("product_code", PRODUCT_CODE).single();
      if (retried.error || !retried.data) throw new Error("Could not resolve the tenant template assignment");
      assignment = retried.data;
    }
  }

  const template = await fetchTemplateVersion(assignment.template_id, assignment.template_version);
  if (!template) throw new Error("The assigned template version is missing");
  const latest = await loadLatestTemplate();
  return {
    assignment,
    template,
    latest: latest && latest.version > assignment.template_version ? { version: latest.version, name: latest.name } : null,
  };
}

export async function updateAgentTemplate(tenantId: string, userId: string) {
  const latest = await loadLatestTemplate();
  if (!latest) throw new Error("No active Term Life template is available");
  const { data, error } = await getSupabaseServiceClient().from("tenant_template_assignments").upsert({
    tenant_id: tenantId,
    product_code: PRODUCT_CODE,
    template_id: latest.id,
    template_version: latest.version,
    assigned_by: userId,
  }, { onConflict: "tenant_id,product_code" }).select("id, template_id, template_version, product_code").single();
  if (error || !data) throw new Error(error?.message ?? "Could not update template");
  return getAgentTemplate(tenantId, userId);
}

export async function listAgentLeads(tenantId: string, template: AgentTemplate, search: string, filterField: string, filterValue: string, sortField: string, direction: "asc" | "desc") {
  const allowedFields = new Set(template.template.fields.map((field) => field.field_key));
  const safeFilterField = allowedFields.has(filterField) ? filterField : "";
  const safeSortField = allowedFields.has(sortField) ? sortField : "";
  const request = getSupabaseServiceClient().from("agent_leads")
    .select("id, stage_key, values, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("template_id", template.assignment.template_id)
    .eq("template_version", template.assignment.template_version)
    .order("created_at", { ascending: false });
  const { data, error } = await request;
  if (error) throw new Error(`Could not load leads: ${error.message}`);
  const normalizedSearch = search.toLocaleLowerCase();
  const normalizedFilter = filterValue.toLocaleLowerCase();
  const leads = (data ?? [])
    .map((lead) => ({ ...lead, values: (lead.values ?? {}) as Record<string, unknown> }))
    .filter((lead) => !normalizedSearch || Object.values(lead.values).some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedSearch)))
    .filter((lead) => !safeFilterField || !normalizedFilter || String(lead.values[safeFilterField] ?? "").toLocaleLowerCase().includes(normalizedFilter));
  if (safeSortField) {
    leads.sort((a, b) => String(a.values[safeSortField] ?? "").localeCompare(String(b.values[safeSortField] ?? ""), undefined, { numeric: true }) * (direction === "desc" ? -1 : 1));
  }
  return leads;
}

export async function createAgentLead(tenantId: string, userId: string, template: AgentTemplate, values: unknown, stageKey?: string) {
  const validation = validateValues(template.template.fields, values);
  if (validation) throw new Error(validation);
  const stage = stageKey ?? template.template.stages[0]?.stage_key;
  if (!stage || !template.template.stages.some((item) => item.stage_key === stage)) throw new Error("Choose a valid pipeline stage");
  const { data, error } = await getSupabaseServiceClient().from("agent_leads").insert({
    tenant_id: tenantId,
    template_id: template.assignment.template_id,
    template_version: template.assignment.template_version,
    stage_key: stage,
    values: values as Json,
    created_by: userId,
  }).select("id, stage_key, values, created_at, updated_at").single();
  if (error || !data) throw new Error(error?.message ?? "Could not create lead");
  return data;
}

export async function updateAgentLead(tenantId: string, leadId: string, template: AgentTemplate, values: unknown, stageKey: string) {
  const validation = validateValues(template.template.fields, values);
  if (validation) throw new Error(validation);
  if (!template.template.stages.some((stage) => stage.stage_key === stageKey)) throw new Error("Choose a valid pipeline stage");
  const { data, error } = await getSupabaseServiceClient().from("agent_leads").update({ values: values as Json, stage_key: stageKey }).eq("id", leadId).eq("tenant_id", tenantId).eq("template_id", template.assignment.template_id).eq("template_version", template.assignment.template_version).select("id, stage_key, values, created_at, updated_at").single();
  if (error || !data) throw new Error(error?.message ?? "Lead not found");
  return data;
}

export function csvForLeads(fields: TemplateField[], stages: TemplateStage[], leads: Array<{ stage_key: string; values: Record<string, unknown> }>) {
  const escape = (value: unknown) => {
    const text = Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [
    ["stage", ...fields.map((field) => field.label)].map(escape).join(","),
    ...leads.map((lead) => [stages.find((stage) => stage.stage_key === lead.stage_key)?.label ?? lead.stage_key, ...fields.map((field) => lead.values[field.field_key])].map(escape).join(",")),
  ].join("\r\n") + "\r\n";
}

export { PRODUCT_CODE, validateValues };
