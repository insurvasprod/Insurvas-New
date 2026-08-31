import { z } from "zod";

import { BILLING_CYCLES } from "@/lib/money";
import { COUPON_DURATIONS, DISCOUNT_TYPES } from "@/lib/coupons/constants";
import { PLAN_TYPES } from "@/lib/plans/constants";

const date = z.string().datetime({ offset: true }).nullable().optional();

const offerFields = z.object({
    name: z.string().trim().min(1, "Give the offer a name").max(120),
    discount_type: z.enum(DISCOUNT_TYPES),
    percent_off: z.number().int().min(1).max(100).nullable().optional(),
    amount_off: z.string().trim().nullable().optional(),
    duration: z.enum(COUPON_DURATIONS),
    duration_periods: z.number().int().min(1).max(60).nullable().optional(),
    starts_at: date,
    ends_at: date,
    max_redemptions: z.number().int().min(1).nullable().optional(),
    auto_apply: z.boolean().default(false),
    eligible_plan_types: z.array(z.enum(PLAN_TYPES)).default([]),
    eligible_plan_ids: z.array(z.string().uuid()).default([]),
    new_customers_only: z.boolean().default(false),
    existing_customers_only: z.boolean().default(false),
    eligible_cycles: z.array(z.enum(BILLING_CYCLES)).default([]),
    is_active: z.boolean().optional(),
});

function validateOfferRelationships(value: z.infer<typeof offerFields>, context: z.RefinementCtx) {
    if (value.discount_type === "percent" && !value.percent_off) {
      context.addIssue({ code: "custom", path: ["percent_off"], message: "Enter a percentage between 1 and 100" });
    }
    if (value.discount_type === "fixed" && !value.amount_off) {
      context.addIssue({ code: "custom", path: ["amount_off"], message: "Enter a fixed amount" });
    }
    if (value.duration === "n_periods" && !value.duration_periods) {
      context.addIssue({ code: "custom", path: ["duration_periods"], message: "Give the number of billing periods" });
    }
    if (value.starts_at && value.ends_at && new Date(value.ends_at) <= new Date(value.starts_at)) {
      context.addIssue({ code: "custom", path: ["ends_at"], message: "End date must be after the start date" });
    }
    if (value.new_customers_only && value.existing_customers_only) {
      context.addIssue({ code: "custom", path: ["existing_customers_only"], message: "Choose new or existing customers, not both" });
    }
}

export const offerInputSchema = offerFields.superRefine(validateOfferRelationships);

export const offerUpdateSchema = offerFields.partial().omit({
  discount_type: true,
  percent_off: true,
  amount_off: true,
  duration: true,
  duration_periods: true,
}).superRefine((value, context) => {
  if (value.starts_at && value.ends_at && new Date(value.ends_at) <= new Date(value.starts_at)) {
    context.addIssue({ code: "custom", path: ["ends_at"], message: "End date must be after the start date" });
  }
  if (value.new_customers_only && value.existing_customers_only) {
    context.addIssue({ code: "custom", path: ["existing_customers_only"], message: "Choose new or existing customers, not both" });
  }
});
