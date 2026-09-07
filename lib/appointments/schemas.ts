import { z } from "zod";

import { STATE_CODES } from "./constants";

const state = z.string().trim().toUpperCase().refine((value) => (STATE_CODES as readonly string[]).includes(value), "Choose a valid US state");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD");
const positiveCents = z.coerce.number().int().min(0).max(9_000_000_000_000, "Coverage amount is too large");

export const appointmentRowSchema = z.object({
  carrier_id: z.string().uuid("Choose a valid carrier"),
  state,
  status: z.enum(["active", "terminated"]),
  effective_from: date,
  terminated_at: date.nullable().optional(),
}).superRefine((value, context) => {
  if (value.status === "terminated" && !value.terminated_at) context.addIssue({ code: "custom", path: ["terminated_at"], message: "Enter the termination date" });
  if (value.terminated_at && value.terminated_at < value.effective_from) context.addIssue({ code: "custom", path: ["terminated_at"], message: "Termination cannot be before the effective date" });
});

export const appointmentsBatchSchema = z.object({ appointments: z.array(appointmentRowSchema).min(1, "Select at least one appointment").max(500, "Save 500 appointments or fewer at a time") });
export const licenseSchema = z.object({ state, license_number: z.string().trim().min(1, "Enter a licence number").max(120, "Licence number is too long"), expires_at: date });
export const eoPolicySchema = z.object({ carrier: z.string().trim().min(1, "Enter the E&O carrier").max(160, "E&O carrier is too long"), policy_number: z.string().trim().min(1, "Enter the E&O policy number").max(120, "E&O policy number is too long"), expires_at: date, coverage_amount_cents: positiveCents });
export const ceSchema = z.object({ state, credits_required: z.coerce.number().int().min(0).max(10000), credits_completed: z.coerce.number().int().min(0).max(10000), deadline: date }).superRefine((value, context) => { if (value.credits_completed > value.credits_required) context.addIssue({ code: "custom", path: ["credits_completed"], message: "Completed credits cannot exceed required credits" }); });
