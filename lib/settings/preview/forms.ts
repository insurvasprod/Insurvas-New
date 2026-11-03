/**
 * Sample answers for Settings › Form templates in the preview (settings-redesign R2): a Final Expense
 * form with the agency's own copy of the platform template. Nothing reaches a real API.
 */
import type { TemplateField, TemplateFormDefinition, TemplateStage } from "@/lib/templates/constants";

type Answer = { status: number; body: unknown };
type State = "loaded" | "empty" | "error" | "readonly";
const ok = (body: unknown): Answer => ({ status: 200, body });

const field = (field_key: string, label: string, type: TemplateField["type"], sort_order: number, is_required = true, options: string[] = [], help_text: string | null = null): TemplateField => ({
  field_key, label, type, is_required, options, sort_order, help_text, validation: {},
});

const fields: TemplateField[] = [
  field("first_name", "First name", "text", 0),
  field("last_name", "Last name", "text", 1),
  field("phone", "Phone", "phone", 2),
  field("email", "Email", "email", 3, false),
  field("date_of_birth", "Date of birth", "date", 4),
  field("state", "State", "single_select", 5, true, ["AL", "FL", "GA", "TN", "TX"]),
  field("tobacco", "Uses tobacco", "single_select", 6, true, ["Yes", "No"]),
  field("face_amount", "Coverage wanted", "currency", 7, false, [], "What the client asked for, if they said."),
  field("existing_coverage", "Has life insurance now", "single_select", 8, false, ["Yes", "No"]),
  field("beneficiary_name", "Beneficiary", "text", 9, false),
  field("best_time", "Best time to call", "single_select", 10, false, ["Morning", "Afternoon", "Evening"]),
];

const stages: TemplateStage[] = [
  { stage_key: "new", label: "New", stage_type: "open", color: "#64748b", sort_order: 0 },
  { stage_key: "quoted", label: "Quoted", stage_type: "open", color: "#8b5cf6", sort_order: 1 },
  { stage_key: "sold", label: "Sold", stage_type: "won", color: "#10b981", sort_order: 2 },
  { stage_key: "lost", label: "Lost", stage_type: "lost", color: "#ef4444", sort_order: 3 },
] as TemplateStage[];

const placed = (keys: string[], required: string[] = []) => keys.map((field_key) => ({ field_key, is_required: required.includes(field_key), show_when: null }));

const form: TemplateFormDefinition = {
  sections: [
    { section_key: "personal", label: "About the client", sort_order: 0, fields: placed(["first_name", "last_name", "phone", "email", "date_of_birth", "state"], ["first_name", "last_name", "phone", "date_of_birth", "state"]) },
    { section_key: "insurance", label: "Coverage", sort_order: 1, fields: [...placed(["tobacco", "face_amount", "existing_coverage"], ["tobacco"]), { field_key: "beneficiary_name", is_required: false, show_when: { field_key: "existing_coverage", equals: "No" } }] },
    { section_key: "contact", label: "Follow-up", sort_order: 2, fields: placed(["best_time"]) },
  ],
  section_availability: { banking: false, signature: false },
};

const current = {
  tenant_template_id: "tt-fe",
  assignment: { template_id: "tpl-fe", template_version: 3, definition_version: 2, product_code: "final_expense" },
  template: { name: "Final Expense — lead form", description: "What partners send for a final expense lead.", product_name: "Final Expense", version: 3, definition_version: 2, fields, stages, form_definition: form },
  latest: { id: "tpl-fe", version: 4, name: "Final Expense — lead form" },
};

const templates = [
  { id: "tpl-fe", name: "Final Expense — lead form", product_code: "final_expense", product_name: "Final Expense", version: 4, description: "Insurvas default for final expense." },
  { id: "tpl-term", name: "Term Life — lead form", product_code: "term_life", product_name: "Term Life", version: 2, description: "Insurvas default for term life." },
  { id: "tpl-ma", name: "Medicare Advantage — lead form", product_code: "medicare_advantage", product_name: "Medicare Advantage", version: 1, description: null },
];

const products = [{ code: "final_expense", name: "Final Expense" }, { code: "term_life", name: "Term Life" }, { code: "medicare_advantage", name: "Medicare Advantage" }];

export const FORM_HANDLERS: Record<string, (state: State, body: unknown) => Answer> = {
  "GET /api/app/templates": (state) => (state === "error"
    ? { status: 500, body: { error: "Your form templates didn’t load. (Sample error.)" } }
    : ok({ current: state === "empty" ? null : current, templates, products, agencyName: "Unlimited Insurance" })),
  "POST /api/app/templates/preview": () => ok({ preview: { fieldsToAdd: ["beneficiary_relationship"], stagesToAdd: [], sectionsToAdd: [], alreadyApplied: false } }),
  "POST /api/app/templates": () => ok({ current }),
  "PATCH /api/app/templates/tt-fe": () => ok({ current }),
  "PUT /api/app/templates/tt-fe": () => ok({ current }),
};
