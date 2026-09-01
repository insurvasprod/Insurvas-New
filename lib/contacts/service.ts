import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import type { TemplateField } from "@/lib/templates/constants";
import { getAgentTemplate } from "@/lib/agentTemplates/service";
import { addressHash, addressSearch, nameSearch, normalizeContactInput } from "./normalization";
import type { ContactInput, ContactRow, DuplicateMatch, FieldSchemaRow, ContactWorkspace } from "./types";

const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function fieldSchemaForTenant(tenantId: string, userId?: string): Promise<FieldSchemaRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("field_schema").select("id, tenant_id, entity, field_key, label, type, options, is_required, sort_order, created_at, updated_at").eq("tenant_id", tenantId).order("sort_order").order("field_key");
  if (error) throw new Error(`Could not load contact field schema: ${error.message}`);
  const rows = (data ?? []) as unknown as FieldSchemaRow[];
  if (rows.some((row) => row.entity === "contact") || !userId) return rows;

  // SA-4.7 is the source of the initial lead-field vocabulary. We expose it as the initial
  // contact vocabulary until the agent saves a customized field schema of their own.
  let template;
  try { template = await getAgentTemplate(tenantId, userId); } catch { return rows; }
  const createdAt = new Date(0).toISOString();
  const templateFields = template.template.fields.map((field: TemplateField, index) => ({ id: `template:${template.tenant_template_id}:${field.field_key}`, tenant_id: tenantId, entity: "contact" as const, field_key: field.field_key, label: field.label, type: field.type, options: field.options, is_required: field.is_required, sort_order: index, created_at: createdAt, updated_at: createdAt }));
  return [...templateFields, ...rows.filter((row) => row.entity !== "contact")];
}

async function validateCustomFields(tenantId: string, fields: Record<string, unknown>, userId?: string) {
  const schema = await fieldSchemaForTenant(tenantId, userId);
  const allowed = new Map(schema.filter((row) => row.entity === "contact").map((row) => [row.field_key, row]));
  for (const [key, value] of Object.entries(fields)) {
    const definition = allowed.get(key);
    if (!definition) throw new Error(`Custom field ${key} is not defined`);
    if (definition.type === "number" || definition.type === "currency") {
      if (typeof value !== "number" || !Number.isFinite(value) || (definition.type === "currency" && !Number.isInteger(value))) throw new Error(`${definition.label} must be a valid number`);
    } else if (definition.type === "boolean" && typeof value !== "boolean") throw new Error(`${definition.label} must be true or false`);
    else if (definition.type === "multi_select" && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !definition.options.includes(item)))) throw new Error(`${definition.label} contains an invalid option`);
    else if (definition.type === "single_select" && (typeof value !== "string" || !definition.options.includes(value))) throw new Error(`${definition.label} must use one of the listed options`);
    else if (definition.type === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) throw new Error(`${definition.label} must use YYYY-MM-DD`);
    else if (definition.type === "phone" && (typeof value !== "string" || !/^[0-9 ()+.-]{7,40}$/.test(value))) throw new Error(`${definition.label} must be a valid phone number`);
    else if (typeof value !== "string") throw new Error(`${definition.label} has an invalid value`);
  }
  for (const definition of allowed.values()) if (definition.is_required && (fields[definition.field_key] === undefined || fields[definition.field_key] === "")) throw new Error(`${definition.label} is required`);
}

function normalizedPayload(input: ContactInput) {
  const value = normalizeContactInput(input);
  return { value, p_dob: value.dob || null, p_phone: value.primary_phone || null, p_name_search: nameSearch(value), p_address_hash: addressHash(value), p_address_search: addressSearch(value) || null };
}

export async function findDuplicates(tenantId: string, input: ContactInput): Promise<DuplicateMatch[]> {
  const { p_dob, p_phone, p_name_search, p_address_hash, p_address_search } = normalizedPayload(input);
  const { data, error } = await getSupabaseServiceClient().rpc("find_contact_duplicates", { p_tenant_id: tenantId, p_name_search, p_dob, p_phone, p_address_search, p_address_hash, p_limit: 20 });
  if (error) throw new Error(`Could not find duplicates: ${error.message}`);
  return ((data ?? []) as unknown as Array<DuplicateMatch & { custom_fields: Json }>).map((row) => ({ ...row, score: Number(row.score), confidence: row.confidence as DuplicateMatch["confidence"], custom_fields: asObject(row.custom_fields), matched_on: Array.isArray(row.matched_on) ? row.matched_on : [] }));
}

async function loadContact(tenantId: string, id: string): Promise<ContactRow> {
  const supabase = getSupabaseServiceClient();
  const { data: contact, error } = await supabase.from("contacts").select("id, tenant_id, household_id, first_name, last_name, dob, primary_phone, state, custom_fields, merged_into_id, created_at, updated_at").eq("tenant_id", tenantId).eq("id", id).single();
  if (error || !contact) throw new Error(error?.message ?? "Contact not found");
  const [household, phones, emails] = await Promise.all([
    contact.household_id ? supabase.from("households").select("address_line1, city, postal_code").eq("tenant_id", tenantId).eq("id", contact.household_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from("contact_phones").select("phone, type, is_primary").eq("tenant_id", tenantId).eq("contact_id", id).order("is_primary", { ascending: false }),
    supabase.from("contact_emails").select("email, is_primary").eq("tenant_id", tenantId).eq("contact_id", id).order("is_primary", { ascending: false }),
  ]);
  if (phones.error || emails.error || household.error) throw new Error(phones.error?.message ?? emails.error?.message ?? household.error?.message ?? "Could not load contact details");
  return { ...contact, custom_fields: asObject(contact.custom_fields), phones: phones.data ?? [], emails: emails.data ?? [], address_line1: household.data?.address_line1 ?? null, city: household.data?.city ?? null, postal_code: household.data?.postal_code ?? null } as unknown as ContactRow;
}

export async function getContactWorkspace(tenantId: string, userId?: string): Promise<ContactWorkspace> {
  const supabase = getSupabaseServiceClient();
  const { data: contacts, error } = await supabase.from("contacts").select("id, tenant_id, household_id, first_name, last_name, dob, primary_phone, state, custom_fields, merged_into_id, created_at, updated_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not load contacts: ${error.message}`);
  const ids = (contacts ?? []).map((row) => row.id);
  const householdIds = [...new Set((contacts ?? []).map((row) => row.household_id).filter(Boolean))] as string[];
  const [households, phones, emails, schema, merges] = await Promise.all([
    householdIds.length ? supabase.from("households").select("id, address_line1, city, postal_code").eq("tenant_id", tenantId).in("id", householdIds) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("contact_phones").select("contact_id, phone, type, is_primary").eq("tenant_id", tenantId).in("contact_id", ids) : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from("contact_emails").select("contact_id, email, is_primary").eq("tenant_id", tenantId).in("contact_id", ids) : Promise.resolve({ data: [], error: null }),
    fieldSchemaForTenant(tenantId, userId),
    supabase.from("merge_log").select("id, kept_id, merged_id, merged_at, reversed_at").eq("tenant_id", tenantId).order("merged_at", { ascending: false }).limit(20),
  ]);
  const errorMessage = [households.error, phones.error, emails.error, merges.error].find(Boolean)?.message;
  if (errorMessage) throw new Error(`Could not load contact workspace: ${errorMessage}`);
  const householdMap = new Map((households.data ?? []).map((row) => [row.id, row]));
  const phoneMap = new Map<string, ContactRow["phones"]>(); for (const row of phones.data ?? []) phoneMap.set(row.contact_id, [...(phoneMap.get(row.contact_id) ?? []), { phone: row.phone, type: row.type as ContactRow["phones"][number]["type"], is_primary: row.is_primary }]);
  const emailMap = new Map<string, ContactRow["emails"]>(); for (const row of emails.data ?? []) emailMap.set(row.contact_id, [...(emailMap.get(row.contact_id) ?? []), { email: row.email, is_primary: row.is_primary }]);
  return { contacts: (contacts ?? []).map((row) => ({ ...row, custom_fields: asObject(row.custom_fields), phones: phoneMap.get(row.id) ?? [], emails: emailMap.get(row.id) ?? [], address_line1: householdMap.get(row.household_id ?? "")?.address_line1 ?? null, city: householdMap.get(row.household_id ?? "")?.city ?? null, postal_code: householdMap.get(row.household_id ?? "")?.postal_code ?? null })) as unknown as ContactRow[], fieldSchema: schema, merges: (merges.data ?? []) as unknown as ContactWorkspace["merges"] };
}

export async function createContact(tenantId: string, userId: string, input: ContactInput) {
  const normalized = normalizedPayload(input); await validateCustomFields(tenantId, normalized.value.custom_fields ?? {}, userId);
  const duplicates = await findDuplicates(tenantId, normalized.value);
  const supabase = getSupabaseServiceClient();
  const { data: id, error } = await supabase.rpc("save_contact", { p_tenant_id: tenantId, p_first_name: normalized.value.first_name, p_last_name: normalized.value.last_name, p_dob: normalized.p_dob, p_primary_phone: normalized.p_phone, p_state: normalized.value.state ?? null, p_name_search: normalized.p_name_search, p_custom_fields: (normalized.value.custom_fields ?? {}) as Json, p_address_hash: normalized.p_address_hash, p_address_search: normalized.p_address_search, p_address_line1: normalized.value.address_line1 ?? null, p_city: normalized.value.city ?? null, p_postal_code: normalized.value.postal_code ?? null, p_phones: (normalized.value.phones ?? []) as unknown as Json, p_emails: (normalized.value.emails ?? []) as unknown as Json });
  if (error || !id) throw new Error(error?.message ?? "Could not save contact");
  const contact = await loadContact(tenantId, id as string);
  const top = duplicates[0];
  if (top?.confidence === "high") {
    const mergeId = await mergeContacts(tenantId, userId, { kept_id: top.contact_id, merged_id: contact.id, field_choices: {} });
    return { contact: await loadContact(tenantId, top.contact_id), duplicates, outcome: "auto_merged" as const, mergeId };
  }
  return { contact, duplicates, outcome: top?.confidence === "medium" ? "review" as const : "created" as const, mergeId: null };
}

export async function mergeContacts(tenantId: string, userId: string, input: { kept_id: string; merged_id: string; field_choices: Record<string, "kept" | "merged"> }) {
  const { data, error } = await getSupabaseServiceClient().rpc("merge_contacts", { p_tenant_id: tenantId, p_kept_id: input.kept_id, p_merged_id: input.merged_id, p_field_choices: input.field_choices as Json, p_merged_by: userId });
  if (error || !data) throw new Error(error?.message ?? "Could not merge contacts"); return data as string;
}

export async function undoContactMerge(tenantId: string, mergeId: string) {
  const { data, error } = await getSupabaseServiceClient().rpc("undo_contact_merge", { p_tenant_id: tenantId, p_merge_id: mergeId });
  if (error || !data) throw new Error(error?.message ?? "Could not undo merge"); return data as string;
}

export async function saveFieldSchema(tenantId: string, input: { entity: string; field_key: string; label: string; type: string; options: string[]; is_required: boolean; sort_order: number }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_field_schema", { p_tenant_id: tenantId, p_entity: input.entity, p_field_key: input.field_key, p_label: input.label, p_type: input.type, p_options: input.options as unknown as Json, p_is_required: input.is_required, p_sort_order: input.sort_order }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save field schema"); return data as unknown as FieldSchemaRow;
}
