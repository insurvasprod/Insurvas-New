// Client-safe template shapes. Database access and write services live in ./queries and ./service.

export const TEMPLATE_FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "date",
  "currency",
  "phone",
  "email",
  "ssn",
  "boolean",
  "single_select",
  "multi_select",
] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

export const TEMPLATE_FIELD_TYPE_LABELS: Record<TemplateFieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  currency: "Currency",
  phone: "Phone",
  email: "Email",
  ssn: "SSN",
  // The form templates board calls a pick-one field a "Choice". Only the labels changed: the stored
  // type values (boolean, single_select, multi_select) are untouched.
  boolean: "Yes / no choice",
  single_select: "Choice",
  multi_select: "Multiple choice",
};

/**
 * The Type column of Settings → Form templates, in the board's words: a yes/no question is a choice
 * too ("Tobacco in 12 months · Choice"). The pickers keep the longer labels above, so the two kinds
 * of choice can still be told apart when one is being picked.
 */
export const TEMPLATE_FIELD_TYPE_TABLE_LABELS: Record<TemplateFieldType, string> = {
  ...TEMPLATE_FIELD_TYPE_LABELS,
  boolean: "Choice",
};

export const TEMPLATE_STAGE_TYPES = ["open", "won", "lost"] as const;
export type TemplateStageType = (typeof TEMPLATE_STAGE_TYPES)[number];

export const TEMPLATE_STAGE_TYPE_LABELS: Record<TemplateStageType, string> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
};

export type TemplateField = {
  field_key: string;
  label: string;
  type: TemplateFieldType;
  is_required: boolean;
  options: string[];
  sort_order: number;
  help_text?: string | null;
  validation?: TemplateValidation;
};

/**
 * Phone is a governed screening field. Older tenant template revisions may have
 * retained the canonical `phone` key while carrying the legacy text type, so
 * callers must recognize the key as well as the current catalog type.
 */
export function isPhoneTemplateField(
  field: Pick<TemplateField, "field_key" | "type">,
) {
  return field.type === "phone" || ["phone", "phone_number"].includes(field.field_key);
}

export type TemplateValidation = {
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
  pattern?: string;
  age_min?: number;
  age_max?: number;
  digit_length?: number;
  format_mask?: string;
  placeholder?: string;
};

export type TemplateStage = {
  stage_key: string;
  label: string;
  stage_type: TemplateStageType;
  color: string;
  sort_order: number;
};

export type TemplateFormField = {
  field_key: string;
  is_required: boolean;
  show_when: { field_key: string; equals: string } | null;
  conditional_on?: { field_key: string; equals: string } | null;
};

export type TemplateFormSection = {
  section_key: string;
  label: string;
  fields: TemplateFormField[];
  sort_order: number;
};

export type TemplateFormDefinition = {
  sections: TemplateFormSection[];
};

export type TemplateRow = {
  id: string;
  name: string;
  product_code: string;
  product_name: string;
  version: number;
  definition_version?: number;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  fields: TemplateField[];
  stages: TemplateStage[];
  form_definition: TemplateFormDefinition;
};

export const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
export const TEMPLATE_KEY_RULE = "Lowercase letters, digits and underscores only, starting with a letter";

export const DEFAULT_TEMPLATE_FORM: TemplateFormDefinition = {
  sections: [{ section_key: "application", label: "Application", fields: [], sort_order: 0 }],
};
