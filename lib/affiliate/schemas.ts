import { z } from "zod";

export const affiliateLinkSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,79}$/, "Use 3–80 lowercase letters, numbers or hyphens").optional(),
  campaign: z.union([z.literal(""), z.string().trim().max(200, "Campaign must be 200 characters or fewer")]).optional().default(""),
});

export const affiliateLinkUpdateSchema = z.object({ is_active: z.boolean() });
