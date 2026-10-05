// Request schemas for the LA-3 API. Strict: an unknown key is a 400, which is how a stray `cvv`
// sent by a careless client is refused rather than silently dropped.

import { z } from "zod";

import { APPLICATION_OUTCOMES, BENEFICIARY_RELATIONSHIPS, INCOME_TYPES, INSURED_ROLES, PAYMENT_METHODS } from "./constants";

const uuid = z.string().uuid();
const fieldKey = z.string().regex(/^[a-z]+\.[a-z0-9_]+$/, "Choose a valid field");
const cents = z.number().int().nonnegative().max(1_000_000_000_00);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const startApplicationSchema = z.object({ work_item_id: uuid, product_line: z.string().trim().min(1).max(120).optional() }).strict();

export const patchValuesSchema = z.object({
  values: z.array(z.object({ key: fieldKey, value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]) }).strict()).max(200).default([]),
  reviewed: z.array(fieldKey).max(200).default([]),
}).strict();

export const putSensitiveSchema = z.object({ field_key: z.literal("insured.ssn"), value: z.string().min(9).max(20) }).strict();

export const revealSchema = z.object({ field_key: fieldKey, surface: z.enum(["web", "copy_assist"]).default("web") }).strict();

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  routing: z.string().max(20).nullish(),
  account: z.string().max(25).nullish(),
  account_type: z.enum(["checking", "savings"]).nullish(),
  bank_name: z.string().max(120).nullish(),
  name_on_account: z.string().max(160).nullish(),
  card: z.string().max(25).nullish(),
  card_exp_month: z.number().int().min(1).max(12).nullish(),
  card_exp_year: z.number().int().min(2000).max(2100).nullish(),
  name_on_card: z.string().max(160).nullish(),
  billing_frequency: z.enum(["monthly", "quarterly", "semiannual", "annual"]).nullish(),
  billing_address_same_as_insured: z.boolean().nullish(),
}).strict();

export const draftDaySchema = z.object({
  day: z.number().int().min(1).max(28).nullable(),
  income_type: z.enum(INCOME_TYPES).nullable(),
  income_inputs: z.object({
    birthDay: z.number().int().min(1).max(31).nullish(),
    before1997: z.boolean().nullish(),
    pensionDay: z.number().int().min(1).max(31).nullish(),
    payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]).nullish(),
    payAnchor: isoDate.nullish(),
    buffer: z.number().int().min(2).max(4).nullish(),
  }).strict().default({}),
  override_reason: z.string().max(500).nullish(),
}).strict();

export const beneficiariesSchema = z.object({
  beneficiaries: z.array(z.object({
    id: z.string().max(64),
    tier: z.enum(["primary", "contingent"]),
    first_name: z.string().trim().max(80),
    last_name: z.string().trim().min(1).max(160),
    relationship: z.enum(BENEFICIARY_RELATIONSHIPS),
    relationship_other: z.string().max(80).nullish(),
    dob: isoDate.nullish(),
    share_bp: z.number().int().min(1).max(10_000),
    phone: z.string().max(30).nullish(),
  }).strict().refine(
    // An estate, a trust or a funeral home has one name; a person needs a first name too.
    (b) => ["estate", "trust", "funeral_home"].includes(b.relationship) || b.first_name.length > 0,
    { message: "A beneficiary who is a person needs a first name.", path: ["first_name"] },
  )).max(20),
}).strict();

export const disclosureSchema = z.object({
  status: z.enum(["acknowledged", "not_applicable"]),
  method: z.enum(["read_aloud", "emailed", "mailed"]).nullish(),
  note: z.string().max(1000).nullish(),
}).strict();

export const transitionSchema = z.object({
  to: z.enum(["ready", "draft", "pending_carrier", "counteroffer_pending", "closed"]),
  outcome: z.enum(APPLICATION_OUTCOMES).nullish(),
  reason_code: z.string().max(60).nullish(),
  reason_text: z.string().max(2000).nullish(),
  policy_number: z.string().max(120).nullish(),
  issued_on: isoDate.nullish(),
}).strict();

export const submissionSchema = z.object({
  reference: z.string().max(120).nullish(),
  reference_kind: z.enum(["application_no", "policy_no"]).default("application_no"),
  submitted_at: z.string().datetime({ offset: true }).nullish(),
  submitted_via: z.enum(["extension", "copy_assist", "carrier_portal_manual"]),
  notes: z.string().max(2000).nullish(),
}).strict();

export const submissionReferenceSchema = z.object({ reference: z.string().max(120).nullish(), policy_number: z.string().max(120).nullish() }).strict();

export const closeCaseSchema = z.object({ reason_code: z.string().min(1).max(60), reason_text: z.string().max(2000).nullish() }).strict();

export const interviewAnswersSchema = z.object({
  insured_role: z.enum(INSURED_ROLES).default("primary"),
  answers: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), value: z.unknown(), notes: z.string().max(2000).nullish() }).strict()).max(200).default([]),
  hidden: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(200).default([]),
}).strict();

export const medicationsSchema = z.object({
  insured_role: z.enum(INSURED_ROLES).default("primary"),
  medications: z.array(z.object({
    name: z.string().max(120),
    dose: z.string().max(60).optional(),
    since: z.string().max(30).optional(),
    prescribedFor: z.string().max(200).optional(),
    prescribedForUnknown: z.boolean().optional(),
    notes: z.string().max(500).optional(),
  }).strip()).max(60),
}).strict();

export const quoteSchema = z.object({
  insured_role: z.enum(INSURED_ROLES).default("primary"),
  carrier_id: uuid,
  carrier_product_id: uuid.nullish(),
  product_code: z.string().min(1).max(60),
  tier: z.string().min(1).max(40),
  face_amount_cents: cents.positive(),
  monthly_premium_cents: cents.positive(),
  annual_premium_cents: cents.nullish(),
  term_length: z.number().int().min(5).max(40).nullish(),
  assumed_health_class: z.string().max(40).nullish(),
  riders: z.array(z.object({ name: z.string().min(1).max(80), monthlyPremiumCents: cents }).strict()).max(10).default([]),
  rating_inputs: z.record(z.string(), z.unknown()).default({}),
  quotation_template_id: uuid.nullish(),
  template_version: z.number().int().positive().nullish(),
  dob: isoDate.nullish(),
  age_basis: z.enum(["nearest", "last"]).default("nearest"),
}).strict();

export const recommendSchema = z.object({
  income_type: z.enum(INCOME_TYPES),
  birthDay: z.number().int().min(1).max(31).nullish(),
  before1997: z.boolean().nullish(),
  pensionDay: z.number().int().min(1).max(31).nullish(),
  payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]).nullish(),
  payAnchor: isoDate.nullish(),
  buffer: z.number().int().min(2).max(4).nullish(),
}).strict();
