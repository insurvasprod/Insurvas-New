import { US_STATES } from "@/lib/signup/constants";
import type { TemplateField, TemplateFormDefinition } from "@/lib/templates/constants";

const baseFields: TemplateField[] = [
  { field_key: "full_name", label: "Full name", type: "text", is_required: true, options: [], sort_order: 0, validation: { min_length: 2, max_length: 200 } },
  { field_key: "phone", label: "Phone number", type: "phone", is_required: true, options: [], sort_order: 1 },
  { field_key: "state", label: "State", type: "single_select", is_required: true, options: US_STATES.map(([code]) => code), sort_order: 2 },
  { field_key: "product_interest", label: "Product interest", type: "single_select", is_required: true, options: [], sort_order: 3 },
  { field_key: "consent", label: "Consent to be contacted", type: "boolean", is_required: true, options: [], sort_order: 4, help_text: "I agree that the licensed agent may contact me about insurance." },
];

export function buildAffiliateTemplate(template: Awaited<ReturnType<typeof import("@/lib/agentTemplates/service").getTenantTemplateForProduct>>, products: Array<{ code: string }>): Awaited<ReturnType<typeof import("@/lib/agentTemplates/service").getTenantTemplateForProduct>> {
  const fields = baseFields.map((field) => field.field_key === "product_interest" ? { ...field, options: products.map((product) => product.code) } : { ...field });
  const form_definition: TemplateFormDefinition = { sections: [{ section_key: "affiliate_intake", label: "Tell the agent how to reach you", fields: fields.map((field) => ({ field_key: field.field_key, is_required: true, show_when: null, conditional_on: null })), sort_order: 0 }] };
  return { ...template, template: { ...template.template, fields, form_definition } };
}
