import { z } from "zod";

import { STATE_CODES } from "./constants.ts";

const state = z.string().trim().toUpperCase().refine((value) => (STATE_CODES as readonly string[]).includes(value), "Choose a valid US state");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD");

// `id` edits that exact row (its dates included) instead of upserting on carrier + state + effective
// date. `pending` and `expires_at` arrive with migration 20260924310000; an omitted expires_at keeps
// what is stored, and a null clears it.
export const appointmentRowSchema = z.object({
  id: z.string().uuid("Choose a valid appointment").optional(),
  carrier_id: z.string().uuid("Choose a valid carrier"),
  state,
  status: z.enum(["pending", "active", "terminated"], { message: "Choose pending, active or ended" }),
  effective_from: date,
  terminated_at: date.nullable().optional(),
  expires_at: date.nullable().optional(),
}).superRefine((value, context) => {
  if (value.status === "terminated" && !value.terminated_at) context.addIssue({ code: "custom", path: ["terminated_at"], message: "Enter the termination date" });
  if (value.terminated_at && value.terminated_at < value.effective_from) context.addIssue({ code: "custom", path: ["terminated_at"], message: "Termination cannot be before the effective date" });
  if (value.expires_at && value.expires_at < value.effective_from) context.addIssue({ code: "custom", path: ["expires_at"], message: "An appointment cannot expire before it takes effect" });
});

export const appointmentsBatchSchema = z.object({ appointments: z.array(appointmentRowSchema).min(1, "Select at least one appointment").max(500, "Save 500 appointments or fewer at a time") });

// licence_type and lines_of_authority arrive with migration 20260924110000. They are optional here so
// every older caller keeps working; an omitted field is left untouched, and a null clears it.
export const licenseSchema = z.object({
  state,
  license_number: z.string().trim().min(1, "Enter a licence number").max(120, "Licence number is too long"),
  expires_at: date,
  licence_type: z.enum(["resident", "non_resident"], { message: "Choose resident or non-resident" }).nullable().optional(),
  lines_of_authority: z.array(z.string().trim().min(1).max(40, "A line of authority is too long")).max(12, "Choose 12 lines or fewer").optional(),
});

// Carrier-specific trainings (migration 20260924310100): add one, mark it done (or not), remove it.
export const carrierTrainingSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    carrier_id: z.string().uuid("Choose a carrier"),
    title: z.string().trim().min(1, "Name the training").max(160, "Training name is too long"),
    due_on: date,
  }).strict(),
  z.object({ action: z.literal("complete"), id: z.string().uuid("Choose a training"), completed_on: date.nullable() }).strict(),
]);
export const carrierTrainingIdSchema = z.string().uuid("Choose a training");
