import { z } from "zod";

import { ADDON_CODE_PATTERN, ADDON_CODE_RULE } from "./constants.ts";
import { BILLING_CYCLES } from "../money.ts";

const SQL_INTEGER_MAX = 2_147_483_647;

const meterSchema = z.object({
  meter_key: z.string().trim().min(1).max(80),
  included_qty: z.number().int().positive().max(SQL_INTEGER_MAX),
});

const sharedFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  price_cents: z.number().int().nonnegative().max(SQL_INTEGER_MAX),
  billing_cycle: z.enum(BILLING_CYCLES),
  feature_keys: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  meters: z.array(meterSchema).max(100).default([]),
  plan_ids: z.array(z.string().uuid()).max(200).default([]),
  sort_order: z.number().int().nonnegative().max(999_999).default(0),
};

function unique<T>(values: T[]) {
  return new Set(values).size === values.length;
}

export const createAddonSchema = z.object({
  code: z.string().trim().min(2).max(80).regex(ADDON_CODE_PATTERN, ADDON_CODE_RULE),
  ...sharedFields,
}).superRefine((value, ctx) => {
  if (!unique(value.feature_keys)) ctx.addIssue({ code: "custom", path: ["feature_keys"], message: "Feature keys must be unique" });
  if (!unique(value.meters.map((meter) => meter.meter_key))) ctx.addIssue({ code: "custom", path: ["meters"], message: "Meter keys must be unique" });
  if (!unique(value.plan_ids)) ctx.addIssue({ code: "custom", path: ["plan_ids"], message: "Plans must be unique" });
});

export const updateAddonSchema = z.object({
  ...sharedFields,
  is_active: z.boolean(),
}).superRefine((value, ctx) => {
  if (!unique(value.feature_keys)) ctx.addIssue({ code: "custom", path: ["feature_keys"], message: "Feature keys must be unique" });
  if (!unique(value.meters.map((meter) => meter.meter_key))) ctx.addIssue({ code: "custom", path: ["meters"], message: "Meter keys must be unique" });
  if (!unique(value.plan_ids)) ctx.addIssue({ code: "custom", path: ["plan_ids"], message: "Plans must be unique" });
});

export type CreateAddonInput = z.infer<typeof createAddonSchema>;
export type UpdateAddonInput = z.infer<typeof updateAddonSchema>;
