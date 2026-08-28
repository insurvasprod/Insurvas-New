import { z } from "zod";

import { PLAN_CODE_PATTERN, PLAN_CODE_RULE, PLAN_TYPES } from "./constants";

export const createPlanSchema = z.object({
  code: z.string().trim().min(2).max(60).regex(PLAN_CODE_PATTERN, PLAN_CODE_RULE),
  name: z.string().trim().min(1).max(120),
  plan_type: z.enum(PLAN_TYPES),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  is_public: z.boolean().default(false),
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
});

// plan_type is absent on purpose: it decides which features are even offered and whether seats
// apply, so changing it on a live plan would silently reinterpret everything attached to it.
// Create a new plan instead.
export const updatePlanSchema = z.object({
  code: z.string().trim().min(2).max(60).regex(PLAN_CODE_PATTERN, PLAN_CODE_RULE),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  is_public: z.boolean(),
  is_archived: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(9999),
});
