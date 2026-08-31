import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import { getEntitlement } from "@/lib/entitlements/get";
import { fetchTemplateVersion } from "@/lib/templates/queries";
import { DEFAULT_TEMPLATE_FORM, TEMPLATE_KEY_PATTERN, TEMPLATE_FIELD_TYPES, TEMPLATE_STAGE_TYPES, type TemplateField, type TemplateFormDefinition, type TemplateRow, type TemplateStage } from "@/lib/templates/constants";

const PRODUCT_CODE = "term_life";

export type AgentTemplate = { assignment: { id: string; template_id: string; template_version: number; product_code: string }; tenant_template_id: string; template: TemplateRow; latest: { id: string; version: number; name: string } | null };
export type TemplateApplicationPreview = { fieldsToAdd: string[]; stagesToAdd: string[]; sectionsToAdd: string[]; alreadyApplied: boolean };
type TenantCopy = { id: string; tenant_id: string; template_id: string; template_version: number; product_code: string; name: string; description: string | null; created_at: string; updated_at: string; fields: TemplateField[]; stages: TemplateStage[]; form_definition: TemplateFormDefinition };

const asFields = (value: unknown) => Array.isArray(value) ? value as TemplateField[] : [];
const asStages = (value: unknown) => Array.isArray(value) ? value as TemplateStage[] : [];
const asForm = (value: unknown): TemplateFormDefinition => value && typeof value === "object" && Array.isArray((value as { sections?: unknown }).sections) ? value as TemplateFormDefinition : DEFAULT_TEMPLATE_FORM;

function mergeForm(current: TemplateFormDefinition, incoming: TemplateFormDefinition): TemplateFormDefinition {
  const sections = current.sections.map((section) => ({ ...section, fields: [...section.fields] }));
  for (const incomingSection of incoming.sections) {
    const existing = sections.find((section) => section.section_key === incomingSection.section_key);
    if (!existing) { sections.push(incomingSection); continue; }
    for (const field of incomingSection.fields) if (!existing.fields.some((item) => item.field_key === field.field_key)) existing.fields.push(field);
  }
  return { sections: sections.map((section, index) => ({ ...section, sort_order: index })) };
}

function mergeDefinitions(existing: TenantCopy | null, source: TemplateRow) {
  const fields = existing ? [...existing.fields] : [];
  for (const field of source.fields) if (!fields.some((item) => item.field_key === field.field_key)) fields.push({ ...field, sort_order: fields.length });
  const stages = existing ? [...existing.stages] : [];
  for (const stage of source.stages) if (!stages.some((item) => item.stage_key === stage.stage_key)) stages.push({ ...stage, sort_order: stages.length });
  return { fields: fields.map((item, index) => ({ ...item, sort_order: index })), stages: stages.map((item, index) => ({ ...item, sort_order: index })), form_definition: mergeForm(existing?.form_definition ?? { sections: [] }, source.form_definition) };
}

function templateRow(copy: TenantCopy, productName: string): TemplateRow {
  return { id: copy.id, name: copy.name, product_code: copy.product_code, product_name: productName, version: copy.template_version, description: copy.description, is_active: true, created_by: copy.tenant_id, created_at: copy.created_at, updated_at: copy.updated_at, fields: copy.fields, stages: copy.stages, form_definition: copy.form_definition };
}

async function loadCopy(tenantId: string, productCode?: string, id?: string): Promise<TenantCopy | null> {
  const supabase = getSupabaseServiceClient();
  let request = supabase.from("tenant_templates").select("id, tenant_id, template_id, template_version, product_code, name, description, created_at, updated_at").eq("tenant_id", tenantId);
  if (id) request = request.eq("id", id); if (productCode) request = request.eq("product_code", productCode);
  const { data, error } = await request.maybeSingle(); if (error) throw new Error(`Could not load tenant template: ${error.message}`); if (!data) return null;
  const [fields, stages, form] = await Promise.all([
    supabase.from("tenant_template_fields").select("tenant_template_id, field_key, label, type, is_required, options, sort_order").eq("tenant_template_id", data.id).order("sort_order"),
    supabase.from("tenant_template_stages").select("tenant_template_id, stage_key, label, stage_type, color, sort_order").eq("tenant_template_id", data.id).order("sort_order"),
    supabase.from("tenant_template_forms").select("tenant_template_id, form_definition").eq("tenant_template_id", data.id).maybeSingle(),
  ]);
  if (fields.error || stages.error || form.error) throw new Error(`Could not load tenant template details: ${fields.error?.message ?? stages.error?.message ?? form.error?.message}`);
  return { ...data, created_at: data.created_at ?? new Date(0).toISOString(), updated_at: data.updated_at ?? new Date(0).toISOString(), fields: asFields(fields.data), stages: asStages(stages.data), form_definition: asForm(form.data?.form_definition) };
}

async function productName(code: string) { const { data } = await getSupabaseServiceClient().from("products").select("name").eq("code", code).maybeSingle(); return data?.name ?? code; }
async function allowedProductCodes(tenantId: string) {
  const entitlement = await getEntitlement(tenantId); if (!entitlement.plan_code) return [];
  const supabase = getSupabaseServiceClient(); const { data: plan } = await supabase.from("plans").select("id").eq("code", entitlement.plan_code).eq("version", entitlement.plan_version ?? 1).maybeSingle(); if (!plan) return [];
  const { data, error } = await supabase.from("plan_product_access").select("product_code").eq("plan_id", plan.id); if (error) throw new Error(`Could not load product access: ${error.message}`); return (data ?? []).map((row) => row.product_code);
}
async function assertAllowedProduct(tenantId: string, productCode: string) { if (!(await allowedProductCodes(tenantId)).includes(productCode)) throw new Error(`Your plan does not include the ${productCode} product`); }

async function loadLatestTemplate(productCode = PRODUCT_CODE) {
  const { data, error } = await getSupabaseServiceClient().from("templates").select("id, name, product_code, version, description, is_active, created_by, created_at, updated_at").eq("product_code", productCode).eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle(); if (error) throw new Error(`Could not load active template: ${error.message}`); return data;
}
async function resolveSource(templateId: string, version: number) { const source = await fetchTemplateVersion(templateId, version); if (!source || !source.is_active) throw new Error("That template version is no longer available"); return source; }

export async function getAgentTemplate(tenantId: string, userId: string): Promise<AgentTemplate> {
  let copy = await loadCopy(tenantId, PRODUCT_CODE);
  if (!copy) { const source = await loadLatestTemplate(); if (!source) throw new Error("No active Term Life template is available"); await assertAllowedProduct(tenantId, source.product_code); await applyTemplate(tenantId, userId, source.id, source.version); copy = await loadCopy(tenantId, PRODUCT_CODE); if (!copy) throw new Error("Could not resolve the tenant template copy"); }
  const latest = await loadLatestTemplate(copy.product_code);
  return { tenant_template_id: copy.id, assignment: { id: copy.id, template_id: copy.template_id, template_version: copy.template_version, product_code: copy.product_code }, template: templateRow(copy, await productName(copy.product_code)), latest: latest && latest.version > copy.template_version ? { id: latest.id, version: latest.version, name: latest.name } : null };
}

export async function listAvailableTemplates(tenantId: string, userId: string) {
  const current = await getAgentTemplate(tenantId, userId); const allowed = await allowedProductCodes(tenantId); const supabase = getSupabaseServiceClient();
  const { data: sources, error } = allowed.length ? await supabase.from("templates").select("id, name, product_code, version, description, is_active, created_by, created_at, updated_at").eq("is_active", true).in("product_code", allowed).order("updated_at", { ascending: false }) : { data: [], error: null };
  if (error) throw new Error(`Could not load available templates: ${error.message}`);
  return { current, templates: (sources ?? []).map((source) => ({ id: source.id, name: source.name, product_code: source.product_code, version: source.version, description: source.description, product_name: source.product_code === current.template.product_code ? current.template.product_name : source.product_code })) };
}

export async function previewTemplateApplication(tenantId: string, templateId: string, version: number): Promise<TemplateApplicationPreview> {
  const source = await resolveSource(templateId, version); await assertAllowedProduct(tenantId, source.product_code); const existing = await loadCopy(tenantId, source.product_code); const merged = mergeDefinitions(existing, source);
  return { fieldsToAdd: merged.fields.filter((field) => !existing?.fields.some((item) => item.field_key === field.field_key)).map((field) => field.label), stagesToAdd: merged.stages.filter((stage) => !existing?.stages.some((item) => item.stage_key === stage.stage_key)).map((stage) => stage.label), sectionsToAdd: merged.form_definition.sections.filter((section) => !existing?.form_definition.sections.some((item) => item.section_key === section.section_key)).map((section) => section.label), alreadyApplied: Boolean(existing?.template_id === templateId && existing.template_version === version) };
}

export async function applyTemplate(tenantId: string, userId: string, templateId: string, version: number) {
  const source = await resolveSource(templateId, version); await assertAllowedProduct(tenantId, source.product_code); const existing = await loadCopy(tenantId, source.product_code); const merged = mergeDefinitions(existing, source);
  const { data, error } = await getSupabaseServiceClient().rpc("admin_apply_tenant_template", { p_tenant_id: tenantId, p_template_id: source.id, p_template_version: source.version, p_product_code: source.product_code, p_name: existing?.name ?? source.name, p_description: existing?.description ?? source.description, p_applied_by: userId, p_fields: merged.fields as unknown as Json, p_stages: merged.stages as unknown as Json, p_form_definition: merged.form_definition as unknown as Json });
  if (error || !data) throw new Error(error?.message ?? "Could not apply template"); return { tenant_template_id: data, preview: await previewTemplateApplication(tenantId, source.id, source.version) };
}

export async function updateAgentTemplate(tenantId: string, userId: string) { const current = await getAgentTemplate(tenantId, userId); if (!current.latest) return current; await applyTemplate(tenantId, userId, current.latest.id, current.latest.version); return getAgentTemplate(tenantId, userId); }

function validateCopy(fields: TemplateField[], stages: TemplateStage[], form: TemplateFormDefinition) {
  const text = (value: unknown, label: string, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? null : `${label} must be between 1 and ${max} characters`;
  if (!Array.isArray(fields) || !fields.length || !Array.isArray(stages) || !stages.length || !form || !Array.isArray(form.sections) || !form.sections.length) return "A template copy needs fields, pipeline stages and a form";
  const keys = new Set<string>();
  for (const field of fields) { if (!field || !TEMPLATE_KEY_PATTERN.test(field.field_key) || keys.has(field.field_key)) return "Field keys must be unique lowercase names"; const labelError = text(field.label, "Field labels", 120); if (labelError) return labelError; if (!TEMPLATE_FIELD_TYPES.includes(field.type)) return `Unsupported field type for ${field.label}`; if (!Array.isArray(field.options) || field.options.some((option) => typeof option !== "string" || option.trim().length > 120)) return `Options for ${field.label} are invalid`; keys.add(field.field_key); }
  const stageKeys = new Set<string>();
  for (const stage of stages) { if (!stage || !TEMPLATE_KEY_PATTERN.test(stage.stage_key) || stageKeys.has(stage.stage_key)) return "Stage keys must be unique lowercase names"; const labelError = text(stage.label, "Stage labels", 120); if (labelError) return labelError; if (!TEMPLATE_STAGE_TYPES.includes(stage.stage_type) || !/^#[0-9a-fA-F]{6}$/.test(stage.color)) return `Invalid stage ${stage.label}`; stageKeys.add(stage.stage_key); }
  for (const section of form.sections) { const labelError = text(section.label, "Form section labels", 120); if (labelError) return labelError; if (!Array.isArray(section.fields)) return "Form sections must contain fields"; for (const field of section.fields) { if (!field || !TEMPLATE_KEY_PATTERN.test(field.field_key) || !keys.has(field.field_key)) return "Form fields must reference a lead field"; if (field.show_when && (!TEMPLATE_KEY_PATTERN.test(field.show_when.field_key) || typeof field.show_when.equals !== "string" || field.show_when.equals.length > 120)) return "Form conditional rules are invalid"; } }
  return null;
}

export async function updateTenantTemplateCopy(tenantId: string, id: string, input: { name: string; description: string | null; fields: TemplateField[]; stages: TemplateStage[]; form_definition: TemplateFormDefinition }) {
  const validation = validateCopy(input.fields, input.stages, input.form_definition); if (validation) throw new Error(validation); if (!input.name.trim() || input.name.trim().length > 120) throw new Error("Template name must be between 1 and 120 characters"); if (input.description && input.description.trim().length > 2000) throw new Error("Template description cannot exceed 2000 characters");
  const { data, error } = await getSupabaseServiceClient().rpc("admin_update_tenant_template", { p_tenant_template_id: id, p_tenant_id: tenantId, p_name: input.name.trim(), p_description: input.description?.trim() || null, p_fields: input.fields as unknown as Json, p_stages: input.stages as unknown as Json, p_form_definition: input.form_definition as unknown as Json }); if (error || !data) throw new Error(error?.message ?? "Could not save template copy"); return loadCopy(tenantId, undefined, id);
}

export async function listAgentLeads(tenantId: string, template: AgentTemplate, search: string, filterField: string, filterValue: string, sortField: string, direction: "asc" | "desc") {
  const allowedFields = new Set(template.template.fields.map((field) => field.field_key)); const safeFilterField = allowedFields.has(filterField) ? filterField : ""; const safeSortField = allowedFields.has(sortField) ? sortField : "";
  const { data, error } = await getSupabaseServiceClient().from("agent_leads").select("id, stage_key, values, created_at, updated_at").eq("tenant_id", tenantId).eq("tenant_template_id", template.tenant_template_id).order("created_at", { ascending: false }); if (error) throw new Error(`Could not load leads: ${error.message}`);
  const normalizedSearch = search.toLocaleLowerCase(); const normalizedFilter = filterValue.toLocaleLowerCase(); const leads = (data ?? []).map((lead) => ({ ...lead, values: (lead.values ?? {}) as Record<string, unknown> })).filter((lead) => !normalizedSearch || Object.values(lead.values).some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedSearch))).filter((lead) => !safeFilterField || !normalizedFilter || String(lead.values[safeFilterField] ?? "").toLocaleLowerCase().includes(normalizedFilter)); if (safeSortField) leads.sort((a, b) => String(a.values[safeSortField] ?? "").localeCompare(String(b.values[safeSortField] ?? ""), undefined, { numeric: true }) * (direction === "desc" ? -1 : 1)); return leads;
}

export async function createAgentLead(tenantId: string, userId: string, template: AgentTemplate, values: unknown, stageKey?: string) {
  const validation = validateValues(template.template.fields, values); if (validation) throw new Error(validation); const stage = stageKey ?? template.template.stages[0]?.stage_key; if (!stage || !template.template.stages.some((item) => item.stage_key === stage)) throw new Error("Choose a valid pipeline stage");
  const { data, error } = await getSupabaseServiceClient().from("agent_leads").insert({ tenant_id: tenantId, tenant_template_id: template.tenant_template_id, template_id: template.assignment.template_id, template_version: template.assignment.template_version, stage_key: stage, values: values as Json, created_by: userId }).select("id, stage_key, values, created_at, updated_at").single(); if (error || !data) throw new Error(error?.message ?? "Could not create lead"); return data;
}
export async function updateAgentLead(tenantId: string, leadId: string, template: AgentTemplate, values: unknown, stageKey: string) {
  const validation = validateValues(template.template.fields, values); if (validation) throw new Error(validation); if (!template.template.stages.some((stage) => stage.stage_key === stageKey)) throw new Error("Choose a valid pipeline stage"); const { data, error } = await getSupabaseServiceClient().from("agent_leads").update({ values: values as Json, stage_key: stageKey }).eq("id", leadId).eq("tenant_id", tenantId).eq("tenant_template_id", template.tenant_template_id).select("id, stage_key, values, created_at, updated_at").single(); if (error || !data) throw new Error(error?.message ?? "Lead not found"); return data;
}

function validateValues(fields: TemplateField[], values: unknown) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "Lead values must be an object"; const record = values as Record<string, unknown>;
  for (const field of fields) { const value = record[field.field_key]; if (field.is_required && (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))) return `${field.label} is required`; if (value === undefined || value === null || value === "") continue; if (["number", "currency"].includes(field.type) && (typeof value !== "number" || !Number.isFinite(value) || (field.type === "currency" && !Number.isInteger(value)))) return `${field.label} must be a number`; if (field.type === "boolean" && typeof value !== "boolean") return `${field.label} must be true or false`; if (field.type === "single_select" && (typeof value !== "string" || !field.options.includes(value))) return `${field.label} must use one of the listed options`; if (field.type === "multi_select" && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !field.options.includes(item)))) return `${field.label} contains an invalid option`; if (["text", "date", "phone"].includes(field.type) && typeof value !== "string") return `${field.label} must be text`; } const allowed = new Set(fields.map((field) => field.field_key)); if (Object.keys(record).some((key) => !allowed.has(key))) return "Lead contains a field that is not in the assigned template"; return null;
}
export function csvForLeads(fields: TemplateField[], stages: TemplateStage[], leads: Array<{ stage_key: string; values: Record<string, unknown> }>) { const escape = (value: unknown) => { const text = Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value); const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; }; return [["stage", ...fields.map((field) => field.label)].map(escape).join(","), ...leads.map((lead) => [stages.find((stage) => stage.stage_key === lead.stage_key)?.label ?? lead.stage_key, ...fields.map((field) => lead.values[field.field_key])].map(escape).join(","))].join("\r\n") + "\r\n"; }

export { PRODUCT_CODE, validateValues };
