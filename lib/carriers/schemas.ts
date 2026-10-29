import { z } from "zod";

import { CARRIER_CODE_PATTERN, CARRIER_CODE_RULE } from "./constants";
import { OVERRIDE_REASON_MAX, OVERRIDE_REASON_MIN } from "./usage";

export const createCarrierSchema = z.object({
  code: z.string().trim().min(2).max(60).regex(CARRIER_CODE_PATTERN, CARRIER_CODE_RULE),
  name: z.string().trim().min(1, "Enter a carrier name").max(160),
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
});
export const updateCarrierSchema = z.object({
  name: z.string().trim().min(1, "Enter a carrier name").max(160).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(9999).optional(),
  /** Super admin only: deactivate although tenants use the carrier (migration 20260924357000). */
  override_reason: z
    .string()
    .trim()
    .min(OVERRIDE_REASON_MIN, `Give a reason of at least ${OVERRIDE_REASON_MIN} characters`)
    .max(OVERRIDE_REASON_MAX)
    .optional(),
}).refine((data) => data.name !== undefined || data.is_active !== undefined || data.sort_order !== undefined, "Nothing to update");

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid effective date");
const bpSchema = z.coerce.number().int().min(0).max(100000);

export const tenantCarrierSchema = z.object({
  carrier_id: z.string().uuid("Choose a valid carrier"),
  contract_level_bp: bpSchema,
  writing_number: z.string().trim().min(1, "Enter the writing number").max(120),
  effective_from: dateSchema,
});

export const commissionScheduleSchema = z.object({
  carrier_id: z.string().uuid("Choose a valid carrier"),
  product_code: z.string().trim().min(1).max(80),
  contract_level_bp: bpSchema,
  policy_year: z.coerce.number().int().min(1).max(100),
  rate_bp: bpSchema,
  effective_from: dateSchema,
  /** "Year N+": this rate also covers every later policy year that has no row of its own. */
  applies_onward: z.boolean().optional(),
});

export const advanceRuleSchema = z.object({
  carrier_id: z.string().uuid("Choose a valid carrier"),
  product_code: z.string().trim().min(1).max(80),
  advance_months: z.coerce.number().int().min(0).max(120),
  advance_pct_bp: bpSchema,
  clawback_months: z.coerce.number().int().min(0).max(240),
  clawback_type: z.enum(["full", "prorated"]),
  effective_from: dateSchema,
});
