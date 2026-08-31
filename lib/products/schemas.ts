import { z } from "zod";

import { PRODUCT_CATEGORIES, PRODUCT_CODE_PATTERN, PRODUCT_CODE_RULE } from "./constants";

export const createProductSchema = z.object({
  code: z.string().trim().min(2).max(60).regex(PRODUCT_CODE_PATTERN, PRODUCT_CODE_RULE),
  name: z.string().trim().min(1).max(120),
  category: z.enum(PRODUCT_CATEGORIES),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
});

// Codes become references in templates, forms, reports and agent settings. Renaming one would
// silently break those consumers, so archive the old code and create a replacement instead.
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    category: z.enum(PRODUCT_CATEGORIES).optional(),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    is_active: z.boolean().optional(),
    sort_order: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Nothing to update",
  });
