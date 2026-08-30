import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TemplateFormDefinition, TemplateField, TemplateStage } from "./constants";

type TemplateContent = {
  name: string;
  product_code: string;
  description?: string;
  fields: TemplateField[];
  stages: TemplateStage[];
  form_definition: TemplateFormDefinition;
};

export async function saveTemplate(templateId: string | null, content: TemplateContent, actorId: string) {
  const { data, error } = await getSupabaseServiceClient().rpc("admin_save_template", {
    p_template_id: templateId,
    p_name: content.name,
    p_product_code: content.product_code,
    p_description: content.description ?? "",
    p_is_active: true,
    p_fields: content.fields,
    p_stages: content.stages,
    p_form_definition: content.form_definition,
    p_created_by: actorId,
  });
  if (error) {
    if (error.message.includes("template_not_found")) throw new Error("template_not_found");
    if (error.code === "23503") throw new Error("product_not_found");
    throw new Error(error.message);
  }
  const result = Array.isArray(data) ? data[0] : data;
  return { id: result.template_id as string, version: result.version as number };
}

export async function duplicateTemplate(templateId: string, name: string, actorId: string) {
  const { data, error } = await getSupabaseServiceClient().rpc("admin_duplicate_template", {
    p_template_id: templateId,
    p_name: name,
    p_created_by: actorId,
  });
  if (error) {
    if (error.message.includes("template_not_found")) throw new Error("template_not_found");
    throw new Error(error.message);
  }
  const result = Array.isArray(data) ? data[0] : data;
  return { id: result.template_id as string, version: result.version as number };
}
