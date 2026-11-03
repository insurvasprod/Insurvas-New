import { z } from "zod";

export const productCodeSchema = z.string().trim().min(2).max(60).regex(/^[a-z][a-z0-9_]*$/, "Use a valid product code");

export const tenantProductActionSchema = z.object({
  is_enabled: z.boolean(),
});

export const partnerProductActionSchema = z.object({
  product_code: productCodeSchema,
  approved: z.boolean(),
});
