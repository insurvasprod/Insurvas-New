import { z } from "zod";

// No ownerPassword.
//
// SA-1.2 says it in its own out-of-scope line: "admins never see or type a customer password". The
// field was here anyway, which gave the platform two contradictory onboarding paths — a tenant
// owner got a password typed for them by an administrator, while every other user got an invite
// link. The owner is now invited like everybody else (backlog 1), and the credential lives only in
// Supabase Auth where the owner sets it themselves (backlog 193).
export const createTenantSchema = z.object({
  tenantName: z.string().trim().min(1).max(160),
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().toLowerCase().email(),
});
