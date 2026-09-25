import { z } from "zod";

import { PARTNER_PAYOUT_MODELS, PARTNER_TYPES } from "./constants";

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

export const partnerSchema = z.object({
  name: z.string().trim().min(1, "Partner name is required").max(200, "Partner name must be 200 characters or fewer"),
  partner_type: z.enum(PARTNER_TYPES),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/, "Use a two-letter country code").transform((value) => value.toUpperCase()),
  contact_name: optionalText(200),
  contact_email: z.union([z.literal(""), z.string().trim().email("Enter a valid contact email").max(320)]).default(""),
  timezone: z.string().trim().min(1, "Timezone is required").max(100, "Timezone must be 100 characters or fewer"),
  notes: optionalText(5000),
});

export const partnerTermSchema = z.object({
  payout_model: z.enum(PARTNER_PAYOUT_MODELS),
  rate_cents: z.number().int().nonnegative("Rate cannot be negative").nullable().optional(),
  rate_pct_bp: z.number().int().min(1, "Revenue share must be at least 0.01%").max(10000, "Revenue share cannot exceed 100%").nullable().optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD for the effective date"),
}).superRefine((value, context) => {
  if (value.payout_model === "revenue_share") {
    if (value.rate_pct_bp == null) context.addIssue({ code: "custom", path: ["rate_pct_bp"], message: "Revenue share percentage is required" });
    if (value.rate_cents != null) context.addIssue({ code: "custom", path: ["rate_cents"], message: "Revenue share uses a percentage, not cents" });
  } else if (value.rate_cents == null) {
    context.addIssue({ code: "custom", path: ["rate_cents"], message: "A rate in cents is required" });
  } else if (value.rate_pct_bp != null) {
    context.addIssue({ code: "custom", path: ["rate_pct_bp"], message: "This payout model uses cents, not a percentage" });
  }
});

export const partnerActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), ...partnerSchema.shape }),
  z.object({ action: z.literal("transition"), next_status: z.enum(["active", "paused", "offboarded"]), reason: z.string().trim().min(5, "Tell us why this status is changing").max(500, "Reason must be 500 characters or fewer"), confirmation: z.string().optional() }),
  z.object({ action: z.literal("add_term"), ...partnerTermSchema.shape }),
]);
