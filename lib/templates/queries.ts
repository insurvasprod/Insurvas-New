import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ProductRow } from "@/lib/products/constants";
import { DEFAULT_TEMPLATE_FORM, type TemplateField, type TemplateFormDefinition, type TemplateRow, type TemplateStage } from "./constants";

const TEMPLATE_COLUMNS = "id, name, product_code, version, description, is_active, created_by, created_at, updated_at";

export async function fetchTemplates(options: { includeArchived: boolean } = { includeArchived: true }): Promise<TemplateRow[]> {
  const supabase = getSupabaseServiceClient();
  let request = supabase.from("templates").select(TEMPLATE_COLUMNS).order("updated_at", { ascending: false });
  if (!options.includeArchived) request = request.eq("is_active", true);
  const [{ data: templates, error }, { data: products }, { data: fields }, { data: stages }, { data: forms }] = await Promise.all([
    request,
    supabase.from("products").select("code, name"),
    supabase.from("template_fields").select("template_id, version, field_key, label, type, is_required, options, sort_order").order("sort_order"),
    supabase.from("template_stages").select("template_id, version, stage_key, label, stage_type, color, sort_order").order("sort_order"),
    supabase.from("template_forms").select("template_id, version, form_definition"),
  ]);
  if (error) throw new Error(`Could not load templates: ${error.message}`);

  const productNames = new Map(((products ?? []) as Pick<ProductRow, "code" | "name">[]).map((product) => [product.code, product.name]));
  return ((templates ?? []) as Omit<TemplateRow, "product_name" | "fields" | "stages" | "form_definition">[]).map((template) => ({
    ...template,
    product_name: productNames.get(template.product_code) ?? template.product_code,
    fields: ((fields ?? []) as (TemplateField & { template_id: string; version: number })[]).filter((field) => field.template_id === template.id && field.version === template.version),
    stages: ((stages ?? []) as (TemplateStage & { template_id: string; version: number })[]).filter((stage) => stage.template_id === template.id && stage.version === template.version),
    form_definition: ((forms ?? []) as { template_id: string; version: number; form_definition: TemplateFormDefinition }[]).find((form) => form.template_id === template.id && form.version === template.version)?.form_definition ?? DEFAULT_TEMPLATE_FORM,
  }));
}

export function fetchTemplatesForPicker(): Promise<TemplateRow[]> {
  return fetchTemplates({ includeArchived: false });
}

/** Load an immutable template version for a tenant-side assignment. */
export async function fetchTemplateVersion(templateId: string, version: number): Promise<TemplateRow | null> {
  const supabase = getSupabaseServiceClient();
  const [{ data: template, error }, { data: product }, { data: fields }, { data: stages }, { data: form }] = await Promise.all([
    supabase.from("templates").select(TEMPLATE_COLUMNS).eq("id", templateId).maybeSingle(),
    supabase.from("products").select("code, name"),
    supabase.from("template_fields").select("template_id, version, field_key, label, type, is_required, options, sort_order").eq("template_id", templateId).eq("version", version).order("sort_order"),
    supabase.from("template_stages").select("template_id, version, stage_key, label, stage_type, color, sort_order").eq("template_id", templateId).eq("version", version).order("sort_order"),
    supabase.from("template_forms").select("template_id, version, form_definition").eq("template_id", templateId).eq("version", version).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load template version: ${error.message}`);
  if (!template) return null;
  const base = template as Omit<TemplateRow, "product_name" | "fields" | "stages" | "form_definition">;
  return {
    ...base,
    version,
    product_name: ((product ?? []) as Pick<ProductRow, "code" | "name">[]).find((item) => item.code === base.product_code)?.name ?? base.product_code,
    fields: (fields ?? []) as TemplateField[],
    stages: (stages ?? []) as TemplateStage[],
    form_definition: (form?.form_definition as TemplateFormDefinition | undefined) ?? DEFAULT_TEMPLATE_FORM,
  };
}
