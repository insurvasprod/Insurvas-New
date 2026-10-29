import { z } from "zod";

import { TENANT_BILLING_CHOICES, TRIAL_DAYS_MAX } from "./createOptions.ts";

// No ownerPassword.
//
// SA-1.2 says it in its own out-of-scope line: "admins never see or type a customer password". The
// field was here anyway, which gave the platform two contradictory onboarding paths — a tenant
// owner got a password typed for them by an administrator, while every other user got an invite
// link. The owner is now invited like everybody else (backlog 1), and the credential lives only in
// Supabase Auth where the owner sets it themselves (backlog 193).
//
// Plan, billing and trial (doc 2 §5.3): "Plan [Advanced ▾] · Billing (•) Card ( ) Manual invoice
// ( ) Comped — no charge [reason] · Trial [14] days or [ ] start billing now". A comped tenant
// must give its reason, and has no trial — there is nothing to convert.
export const createTenantSchema = z
  .object({
    tenantName: z.string().trim().min(1).max(160),
    ownerName: z.string().trim().min(1).max(120),
    ownerEmail: z.string().trim().toLowerCase().email(),
    planId: z.string().uuid("Choose a plan"),
    billing: z.enum(TENANT_BILLING_CHOICES),
    compReason: z.string().trim().max(500).optional().or(z.literal("")),
    /** null/absent = the plan's own trial; 0 = start billing now. */
    trialDays: z.number().int().min(0).max(TRIAL_DAYS_MAX).nullable().optional(),
  })
  .refine((data) => data.billing !== "comped" || (data.compReason ?? "").length >= 5, {
    message: "Give the reason this tenant is comped (at least 5 characters)",
    path: ["compReason"],
  })
  .refine((data) => data.billing === "comped" || !data.compReason, {
    message: "A reason is only recorded for a comped tenant",
    path: ["compReason"],
  })
  .refine((data) => data.billing !== "comped" || !data.trialDays, {
    message: "A comped tenant has no trial",
    path: ["trialDays"],
  });

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
