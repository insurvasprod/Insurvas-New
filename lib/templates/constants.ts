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
  // LA-1.4-6: stored as digit strings; routing numbers pass the ABA checksum (lib/templates/formats).
  "bank_routing",
  "bank_account",
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
  bank_routing: "Bank routing number",
  bank_account: "Bank account number",
  // The form templates board calls a pick-one field a "Choice". Only the labels changed: the stored
  // type values (boolean, single_select, multi_select) are untouched.
  boolean: "Yes / no choice",
  single_select: "Choice",
  multi_select: "Multiple choice",
};

/**
 * The Type column of Settings → Application forms, in the board's words: a yes/no question is a choice
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
  /** A date answer may not be later than today (Settings r8 board A4). */
  no_future?: boolean;
  /** What a person reads when the answer fails a rule; `{age}` is filled in for date answers. */
  message?: string;
};

/**
 * Form definition format 2 (Settings r8, Application forms A): several rules per question joined by
 * AND / OR, groups of rules, and page skips. Stored inside form_definition, so it needs no schema
 * change; a format-1 reader still sees `show_when` whenever the logic is one plain "is" rule.
 */
export const TEMPLATE_DEFINITION_FORMAT = 2;
export const TEMPLATE_RULE_OPS = ["is", "is_not", "one_of", "filled", "empty", "at_least", "at_most", "age_at_least", "age_at_most"] as const;
export type TemplateRuleOp = (typeof TEMPLATE_RULE_OPS)[number];
export type TemplateRule = { field_key: string; op: TemplateRuleOp; value?: string; values?: string[] };
export type TemplateRuleGroup = { match: "all" | "any"; rules: TemplateRule[] };
export type TemplateLogic = { match: "all" | "any"; rules: Array<TemplateRule | TemplateRuleGroup> };

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
  /** Half or the full row of the partner form's two columns. Missing: automatic (placementWidth.ts). */
  width?: "half" | "full";
  /** Format 2: when the question shows. Wins over `show_when`, which is kept as its format-1 shadow. */
  logic?: TemplateLogic | null;
  /**
   * Set by effectiveTemplateForm, never stored: the page's skip rule, so a reader that only sees the
   * question (templateFormFieldVisible) still hides it while its page is skipped.
   */
  page_skip?: TemplateLogic | null;
};

export type TemplateFormSection = {
  section_key: string;
  label: string;
  fields: TemplateFormField[];
  sort_order: number;
  /** Format 2: the whole page (section) is skipped while this is true. */
  skip_when?: TemplateLogic | null;
};

/**
 * LA-1.4-3: which of the six application-form section groups this product's form offers. A missing
 * key means available. Sections are matched to a group by their key or label (sectionAvailability.ts).
 */
export const TEMPLATE_SECTION_GROUPS = ["personal", "medical", "insurance", "beneficiary", "banking", "signature"] as const;
export type TemplateSectionGroup = (typeof TEMPLATE_SECTION_GROUPS)[number];
export type TemplateSectionAvailability = Partial<Record<TemplateSectionGroup, boolean>>;

export type TemplateFormDefinition = {
  /** 2 once the form uses format-2 logic; absent on older forms (read as 1). */
  format?: number;
  sections: TemplateFormSection[];
  section_availability?: TemplateSectionAvailability;
  /**
   * Format 2: the question rules server intake's validation list does not take yet (`no_future`,
   * `message`), keyed by question. The builder reads them back into each field's `validation`
   * (lib/templates/fieldRulesStore.ts); stored here so saving needs no schema or intake change.
   */
  field_rules?: Record<string, Pick<TemplateValidation, "no_future" | "message">>;
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
