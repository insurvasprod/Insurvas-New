// LA-3.1 / 3.4 / 3.7 · Zod for sales_templates definitions. Client-safe and pure (the builder shows
// the same messages the server refuses with). The definition is exactly LA-1.4's
// {fields, form_definition} shape (lib/templates/constants.ts, lib/templates/schemas.ts), with the
// LA-3 additions the seeds in 20260926100100_la_3_1_sales_templates.sql already carry: knockout
// metadata (`is_knockout`, `knockout_when`, `knockout_note`) on a form field beside `show_when`, the
// `persistency` flag on a field, `medication_list` as a type, `age_basis` for a quotation template,
// and `required` / `optional` for an application field set.

import { z } from "zod";

import { CANONICAL_GROUPS, PAYMENT_FIELD_KEYS } from "../applications/constants.ts";
import { feedOfQuestionKey } from "../applications/prefill.ts";
import { TEMPLATE_KEY_PATTERN, TEMPLATE_KEY_RULE } from "../templates/constants.ts";

export const SALES_TEMPLATE_KINDS = ["underwriting", "quotation", "application_field_set"] as const;
export type SalesTemplateKind = (typeof SALES_TEMPLATE_KINDS)[number];
export type SalesTemplateStatus = "draft" | "published" | "retired";

/** The five "does the policy survive" questions every underwriting template carries (LA-3.1). */
export const PERSISTENCY_KEYS = ["ss_deposit_day", "deposit_account", "decision_maker", "existing_coverage", "can_receive_text"] as const;

export const UW_FIELD_TYPES = ["boolean", "single_select", "multi_select", "number", "date", "text", "long_text", "medication_list", "currency"] as const;
export type UwFieldType = (typeof UW_FIELD_TYPES)[number];

export const QUOTE_FIELD_TYPES = ["date", "single_select", "multi_select", "boolean", "currency", "number", "text"] as const;
export const QUOTE_VALID_DAYS = [14, 30, 60] as const;

/** Every key an application field set may name: the canonical groups plus the typed payment keys. */
export const FIELD_SET_KEYS: readonly string[] = [...CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => f.key)), ...PAYMENT_FIELD_KEYS];

const key = z.string().trim().min(2, "A question key needs at least two characters").max(60).regex(TEMPLATE_KEY_PATTERN, TEMPLATE_KEY_RULE);
const options = z.array(z.string().trim().min(1, "A choice cannot be blank").max(120)).max(100, "Keep a question to 100 choices").default([]);
const condition = z.object({ field_key: key, equals: z.string().trim().min(1).max(120) }).strict();

const fieldBase = {
  field_key: key,
  label: z.string().trim().min(1, "Every question needs its text").max(300, "Keep a question under 300 characters"),
  is_required: z.boolean().default(false),
  options,
  sort_order: z.number().int().min(0).max(9999),
  help_text: z.string().trim().max(500).nullable().optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
};

const uwFieldSchema = z.object({ ...fieldBase, type: z.enum(UW_FIELD_TYPES), persistency: z.boolean().optional() }).strict();
const quoteFieldSchema = z.object({ ...fieldBase, type: z.enum(QUOTE_FIELD_TYPES) }).strict();

export const APPLIES_TO = ["all", "age_50_plus", "age_under_50", "tobacco"] as const;

const formFieldSchema = z.object({
  field_key: key,
  is_required: z.boolean().default(false),
  show_when: condition.nullable().default(null),
  is_knockout: z.boolean().optional(),
  knockout_when: z.object({ equals: z.string().trim().min(1).max(120) }).strict().nullable().optional(),
  knockout_note: z.string().trim().max(300).nullable().optional(),
  applies_to: z.enum(APPLIES_TO).optional(),
}).strict();

const sectionSchema = z.object({
  section_key: key,
  label: z.string().trim().min(1, "Every section needs a name").max(120),
  sort_order: z.number().int().min(0).max(9999),
  fields: z.array(formFieldSchema).max(150),
}).strict();

const formDefinitionSchema = z.object({ sections: z.array(sectionSchema).min(1, "Add at least one section").max(50) }).strict();

type Ctx = z.RefinementCtx;
type AnyField = { field_key: string; type: string; options: string[]; label?: string };

/** A question as the owner knows it — its text, not the key the builder generated (`new_question_2`). */
const named = (byKey: Map<string, AnyField>, key: string) => `“${byKey.get(key)?.label || key}”`;
type Form = z.infer<typeof formDefinitionSchema>;

/** The LA-1.4 rules both question-bearing kinds share: keys unique, every field placed once, conditions point back. */
function checkForm(fields: AnyField[], form: Form, ctx: Ctx) {
  const byKey = new Map<string, AnyField>();
  for (const f of fields) {
    if (byKey.has(f.field_key)) ctx.addIssue({ code: "custom", path: ["fields"], message: `Two questions use the key ${f.field_key}` });
    byKey.set(f.field_key, f);
    if ((f.type === "single_select" || f.type === "multi_select") && f.options.length < 2) {
      ctx.addIssue({ code: "custom", path: ["fields"], message: `${named(byKey, f.field_key)} needs at least two choices` });
    }
  }
  const sectionKeys = new Set<string>();
  const placed = new Map<string, number>();
  let position = 0;
  for (const s of form.sections) {
    if (sectionKeys.has(s.section_key)) ctx.addIssue({ code: "custom", path: ["form_definition"], message: `Two sections use the key ${s.section_key}` });
    sectionKeys.add(s.section_key);
    for (const ref of s.fields) {
      if (!byKey.has(ref.field_key)) ctx.addIssue({ code: "custom", path: ["form_definition"], message: `The form places ${ref.field_key}, which is not a question` });
      if (placed.has(ref.field_key)) ctx.addIssue({ code: "custom", path: ["form_definition"], message: `${named(byKey, ref.field_key)} is placed twice` });
      placed.set(ref.field_key, position++);
    }
  }
  for (const f of fields) {
    if (!placed.has(f.field_key)) ctx.addIssue({ code: "custom", path: ["form_definition"], message: `${named(byKey, f.field_key)} is not in any section` });
  }
  const sorted = [...form.sections].sort((a, b) => a.sort_order - b.sort_order);
  let order = 0;
  const orderOf = new Map<string, number>();
  for (const s of sorted) for (const ref of s.fields) orderOf.set(ref.field_key, order++);
  for (const s of form.sections) {
    for (const ref of s.fields) {
      if (!ref.show_when) continue;
      const parent = byKey.get(ref.show_when.field_key);
      if (!parent) {
        ctx.addIssue({ code: "custom", path: ["form_definition"], message: `${named(byKey, ref.field_key)} follows ${ref.show_when.field_key}, which is not a question` });
        continue;
      }
      if ((orderOf.get(ref.show_when.field_key) ?? Infinity) >= (orderOf.get(ref.field_key) ?? -1)) {
        ctx.addIssue({ code: "custom", path: ["form_definition"], message: `${named(byKey, ref.field_key)} is a follow-up, so it has to come after ${named(byKey, ref.show_when.field_key)}` });
      }
      const allowed = parent.type === "boolean" ? ["true", "false"] : parent.type === "single_select" ? parent.options : null;
      if (!allowed) ctx.addIssue({ code: "custom", path: ["form_definition"], message: `${named(byKey, ref.field_key)} can only follow a yes / no or a one-choice question` });
      else if (!allowed.includes(ref.show_when.equals)) ctx.addIssue({ code: "custom", path: ["form_definition"], message: `${named(byKey, ref.field_key)} waits for an answer ${named(byKey, ref.show_when.field_key)} cannot give` });
    }
  }
  return { byKey };
}

export const underwritingDefinitionSchema = z.object({
  fields: z.array(uwFieldSchema).min(1).max(150),
  form_definition: formDefinitionSchema,
}).strict().superRefine((def, ctx) => {
  const { byKey } = checkForm(def.fields, def.form_definition, ctx);
  for (const s of def.form_definition.sections) {
    for (const ref of s.fields) {
      if (!ref.is_knockout) continue;
      const f = byKey.get(ref.field_key);
      if (f && f.type !== "boolean") ctx.addIssue({ code: "custom", path: ["form_definition"], message: `Only a yes / no question can carry a knockout (${named(byKey, ref.field_key)})` });
      if (!ref.knockout_when || !["true", "false"].includes(ref.knockout_when.equals)) ctx.addIssue({ code: "custom", path: ["form_definition"], message: `Say which answer to ${named(byKey, ref.field_key)} is the knockout` });
      if (!ref.knockout_note?.trim()) ctx.addIssue({ code: "custom", path: ["form_definition"], message: `Write the note the agent sees when ${named(byKey, ref.field_key)} knocks a carrier out` });
    }
  }
  // A question that fills an application field must answer in a shape that field can take.
  for (const f of def.fields) {
    const feed = feedOfQuestionKey(f.field_key);
    if (feed && !(feed.types as readonly string[]).includes(f.type)) {
      ctx.addIssue({ code: "custom", path: ["fields"], message: `${named(byKey, f.field_key)} fills ${feed.label} on the application, so its answer type has to be ${(feed.types as readonly string[]).includes("number") ? "a number" : "Yes / No"}` });
    }
  }
  for (const k of PERSISTENCY_KEYS) {
    const f = def.fields.find((x) => x.field_key === k);
    if (!f || f.persistency !== true) ctx.addIssue({ code: "custom", path: ["fields"], message: `The persistency question ${k} cannot be removed from a template` });
  }
});

export const quotationDefinitionSchema = z.object({
  age_basis: z.enum(["nearest", "last"]),
  valid_days: z.union([z.literal(14), z.literal(30), z.literal(60)]).optional(),
  fields: z.array(quoteFieldSchema).min(1, "Switch on at least one input").max(40),
  form_definition: formDefinitionSchema,
}).strict().superRefine((def, ctx) => {
  checkForm(def.fields, def.form_definition, ctx);
  // The Quote step cannot save a quote without either: a premium is read per $1,000 of face, and the
  // age it is priced at comes from the date of birth. Switching them off left "Add quote" doing nothing.
  for (const [k, label] of [["face_amount", "Face amount"], ["dob", "Date of birth"]] as const) {
    if (!def.fields.some((f) => f.field_key === k)) ctx.addIssue({ code: "custom", path: ["fields"], message: `${label} is always asked — a quote cannot be saved without it` });
  }
});

export const fieldSetDefinitionSchema = z.object({
  required: z.array(z.string()).max(200),
  optional: z.array(z.string()).max(200),
  labels: z.record(z.string(), z.string().trim().min(1).max(160)).optional(),
}).strict().superRefine((def, ctx) => {
  const known = new Set(FIELD_SET_KEYS);
  const seen = new Set<string>();
  for (const k of [...def.required, ...def.optional]) {
    if (!known.has(k)) ctx.addIssue({ code: "custom", path: ["required"], message: `${k} is not an application field` });
    if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["required"], message: `${k} is listed twice` });
    seen.add(k);
  }
  if (def.required.length === 0) ctx.addIssue({ code: "custom", path: ["required"], message: "Mark at least one field required" });
  for (const k of Object.keys(def.labels ?? {})) {
    if (!seen.has(k)) ctx.addIssue({ code: "custom", path: ["labels"], message: `${k} has a label but is not in the set` });
  }
});

export type UnderwritingDefinition = z.infer<typeof underwritingDefinitionSchema>;
export type QuotationDefinition = z.infer<typeof quotationDefinitionSchema>;
export type FieldSetDefinition = z.infer<typeof fieldSetDefinitionSchema>;

export function definitionSchemaFor(kind: SalesTemplateKind) {
  if (kind === "underwriting") return underwritingDefinitionSchema;
  if (kind === "quotation") return quotationDefinitionSchema;
  return fieldSetDefinitionSchema;
}

/** The first problem with a definition, in words — or null when it is valid. */
export function definitionProblem(kind: SalesTemplateKind, definition: unknown): string | null {
  const parsed = definitionSchemaFor(kind).safeParse(definition);
  if (parsed.success) return null;
  return parsed.error.issues[0]?.message ?? "The template is not valid.";
}

// ── request bodies ─────────────────────────────────────────────────────────

/** Any 8-4-4-4-12 hex id (zod 4's uuid() also demands an RFC version nibble, which seeded ids may lack). */
export const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "That id is not valid");
const uuid = idSchema;
const productCode = z.string().trim().min(2).max(60).regex(/^[a-z][a-z0-9_]*$/);
const name = z.string().trim().min(1, "Give the template a name").max(160);

export const createSalesTemplateSchema = z.object({
  kind: z.enum(SALES_TEMPLATE_KINDS),
  product_code: productCode,
  carrier_id: uuid.nullable().default(null),
  name,
  /** Validated by kind in the service (definitionSchemaFor). */
  definition: z.record(z.string(), z.unknown()),
}).strict();

export const saveSalesTemplateSchema = z.object({
  name: name.optional(),
  definition: z.record(z.string(), z.unknown()),
}).strict();

export const publishSalesTemplateSchema = z.object({
  /** Accepted from older clients and ignored: publishing always retires the versions it replaces. */
  retire_previous: z.boolean().default(false),
}).strict();

export const copySalesTemplateSchema = z.object({
  /** Omitted: the copy keeps the source's product and carrier ("Copy to my agency"). */
  product_code: productCode.optional(),
  carrier_id: uuid.nullable().optional(),
  name: name.optional(),
}).strict();
