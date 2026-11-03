import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TemplateField, TemplateFormDefinition, TemplateStage } from "./constants";

type TemplateContent = {
  name: string;
  product_code: string;
  description?: string;
  fields: TemplateField[];
  stages: TemplateStage[];
  form_definition: TemplateFormDefinition;
};

/**
 * Create a template that tenants cannot pick yet. Same RPC as saveTemplate (service.ts), with
 * p_is_active false: admin_save_template honours it on insert only, so this is for new templates.
 * Callers must check templateDraftsSupported() first — without templates.published_at an inactive
 * template is indistinguishable from an archived one.
 */
export async function createDraftTemplate(content: TemplateContent, actorId: string) {
  const { data, error } = await getSupabaseServiceClient().rpc("admin_save_template", {
    p_template_id: null,
    p_name: content.name,
    p_product_code: content.product_code,
    p_description: content.description ?? "",
    p_is_active: false,
    p_fields: content.fields,
    p_stages: content.stages,
    p_form_definition: content.form_definition,
    p_created_by: actorId,
  });
  if (error) {
    if (error.code === "23503") throw new Error("product_not_found");
    throw new Error(error.message);
  }
  const result = Array.isArray(data) ? data[0] : data;
  return { id: result.template_id as string, version: result.version as number };
}
