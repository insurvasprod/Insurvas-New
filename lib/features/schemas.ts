import { z } from "zod";

import { FEATURE_KEY_PATTERN, FEATURE_KEY_RULE } from "./constants";

export const createFeatureSchema = z.object({
  feature_key: z.string().trim().min(2).max(60).regex(FEATURE_KEY_PATTERN, FEATURE_KEY_RULE),
  label: z.string().trim().min(1).max(120),
  module: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

// feature_key is deliberately absent: it's referenced by `requireFeature()` guards, menu nodes
// and any plan already built on it, so renaming one is a code change, not an admin action.
// Archive the old key and add a new one instead.
export const updateFeatureSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    is_archived: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "Nothing to update",
  });
