import { z } from "zod";

export const createTenantSchema = z.object({
  tenantName: z.string().trim().min(1).max(160),
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().toLowerCase().email(),
  ownerPassword: z.string().min(12, "Password must be at least 12 characters"),
});
