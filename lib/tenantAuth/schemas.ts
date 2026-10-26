import { z } from "zod";

/**
 * The agent sign-in: a password, or (2026-10-24) the token from an emailed sign-in link. Either way
 * the rest of the sign-in is the same route and the same checks. `remember` is the "Keep me signed in
 * on this device" box, ticked by default.
 */
export const tenantLoginSchema = z.union([
  z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1),
    remember: z.boolean().optional().default(true),
  }),
  z.object({
    link: z.string().min(20).max(2000),
    remember: z.boolean().optional(),
  }),
]);

/** "Email me a sign-in link". */
export const tenantSignInLinkRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  remember: z.boolean().optional().default(true),
});
