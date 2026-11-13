import { z } from "zod";

import {
  TEMPLATE_DEFINITION_FORMAT,
  TEMPLATE_RULE_OPS,
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
  help_text: z.string().trim().max(500).nullable().optional(),
  validation: z.object({
    min: z.number().finite().optional(), max: z.number().finite().optional(),
    min_length: z.number().int().min(0).max(10000).optional(), max_length: z.number().int().min(0).max(10000).optional(),
    pattern: z.string().max(200).optional(), age_min: z.number().int().min(0).max(130).optional(), age_max: z.number().int().min(0).max(130).optional(),
    digit_length: z.number().int().min(1).max(40).optional(), format_mask: z.string().max(80).optional(), placeholder: z.string().max(120).optional(),
    no_future: z.boolean().optional(), message: z.string().max(300).optional(),
  }).default({}),
});

// Form definition format 2 (lib/templates/logic.ts): rules joined by AND / OR, one level of groups.
const ruleSchema = z.object({
  field_key: key,
  op: z.enum(TEMPLATE_RULE_OPS),
  value: z.string().max(120).optional(),
  values: z.array(z.string().max(120)).max(60).optional(),
});
const logicSchema = z.object({
  match: z.enum(["all", "any"]),
  rules: z.array(z.union([ruleSchema, z.object({ match: z.enum(["all", "any"]), rules: z.array(ruleSchema).max(20) })])).max(20),
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
  conditional_on: z.object({ field_key: key, equals: z.string().trim().max(120) }).nullable().optional(),
  width: z.enum(["half", "full"]).optional(),
  logic: logicSchema.nullable().optional(),
});

const formSectionSchema = z.object({
  section_key: key,
  label: z.string().trim().min(1).max(120),
  fields: z.array(formFieldSchema).max(100),
  sort_order: z.number().int().min(0).max(9999),
  skip_when: logicSchema.nullable().optional(),
});

export const formDefinitionSchema = z.object({
  format: z.number().int().min(1).max(TEMPLATE_DEFINITION_FORMAT).optional(),
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
