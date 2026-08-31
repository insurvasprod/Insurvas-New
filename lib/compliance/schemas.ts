import { z } from "zod";

import { COMPLIANCE_VENDOR_TYPES } from "./constants";

const endpoint = z.string().trim().url("Enter a valid vendor URL").refine((value) => {
  const parsed = new URL(value);
  return parsed.protocol === "https:";
}, "Vendor endpoints must use HTTPS");

export const createComplianceVendorSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(120, "Vendor name is too long"),
  vendor_type: z.enum(COMPLIANCE_VENDOR_TYPES),
  endpoint,
  credentials: z.string().max(10000, "Credentials are too long").optional().nullable(),
  is_enabled: z.boolean().default(false),
  priority: z.number().int().min(0).max(100000),
  cost_per_lookup_cents: z.number().int().min(0).max(100000000),
});

export const updateComplianceVendorSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(120, "Vendor name is too long").optional(),
  vendor_type: z.enum(COMPLIANCE_VENDOR_TYPES).optional(),
  endpoint: endpoint.optional(),
  credentials: z.string().max(10000, "Credentials are too long").nullable().optional(),
  is_enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100000).optional(),
  cost_per_lookup_cents: z.number().int().min(0).max(100000000).optional(),
  confirm_dnc_block: z.boolean().optional(),
});
