import { z } from "zod";

import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_KEY_PATTERN,
  TEMPLATE_KEY_RULE,
  TEMPLATE_STAGE_TYPES,
} from "./constants";

const key = z.string().trim().min(2).max(60).regex(TEMPLATE_KEY_PATTERN, TEMPLATE_KEY_RULE);
const options = z.array(z.string().trim().min(1).max(120)).max(50).default([]);

export const templateFieldSchema = z.object({
  field_key: key,
  label: z.string().trim().min(1).max(120),
  type: z.enum(TEMPLATE_FIELD_TYPES),
  is_required: z.boolean().default(false),
  options,
  sort_order: z.number().int().min(0).max(9999),
});

export const templateStageSchema = z.object({
  stage_key: key,
  label: z.string().trim().min(1).max(120),
  stage_type: z.enum(TEMPLATE_STAGE_TYPES),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Choose a six-digit hex colour"),
  sort_order: z.number().int().min(0).max(9999),
});

const formFieldSchema = z.object({
  field_key: key,
  is_required: z.boolean().default(false),
  show_when: z
    .object({ field_key: key, equals: z.string().trim().max(120) })
    .nullable()
    .default(null),
});

const formSectionSchema = z.object({
  section_key: key,
  label: z.string().trim().min(1).max(120),
  fields: z.array(formFieldSchema).max(100),
  sort_order: z.number().int().min(0).max(9999),
});

export const formDefinitionSchema = z.object({
  sections: z.array(formSectionSchema).max(50),
});

const contentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  product_code: z.string().trim().min(2).max(60),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  fields: z.array(templateFieldSchema).max(100),
  stages: z.array(templateStageSchema).max(50),
  form_definition: formDefinitionSchema,
});

function uniqueKeys(values: string[]) {
  return new Set(values).size === values.length;
}

export const createTemplateSchema = contentSchema.superRefine((value, context) => {
  if (!uniqueKeys(value.fields.map((field) => field.field_key))) {
    context.addIssue({ code: "custom", path: ["fields"], message: "Lead field keys must be unique" });
  }
  if (!uniqueKeys(value.stages.map((stage) => stage.stage_key))) {
    context.addIssue({ code: "custom", path: ["stages"], message: "Pipeline stage keys must be unique" });
  }
  if (!uniqueKeys(value.form_definition.sections.map((section) => section.section_key))) {
    context.addIssue({ code: "custom", path: ["form_definition"], message: "Form section keys must be unique" });
  }
  const fieldKeys = new Set(value.fields.map((field) => field.field_key));
  for (const section of value.form_definition.sections) {
    for (const formField of section.fields) {
      if (!fieldKeys.has(formField.field_key)) {
        context.addIssue({ code: "custom", path: ["form_definition"], message: `Form field ${formField.field_key} is not defined in lead fields` });
      }
      if (formField.show_when && !fieldKeys.has(formField.show_when.field_key)) {
        context.addIssue({ code: "custom", path: ["form_definition"], message: `Condition field ${formField.show_when.field_key} is not defined` });
      }
    }
  }
});

export const updateTemplateSchema = createTemplateSchema;
