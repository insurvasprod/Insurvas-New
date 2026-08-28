import { z } from "zod";

import { TENANT_ROLES } from "@/lib/tenantAuth/roles";

// Either an existing tenant is chosen, or a new one is named — never both, never neither.
// No password field anywhere: SA-1.2 is explicit that admins never see or type a customer
// password; the invite link is the only path to one.
export const createUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    tenantId: z.string().uuid().optional(),
    newTenantName: z.string().trim().max(160).optional().or(z.literal("")),
    role: z.enum(TENANT_ROLES),
  })
  .refine((data) => Boolean(data.tenantId) !== Boolean(data.newTenantName?.trim()), {
    message: "Choose an existing tenant or name a new one, not both",
    path: ["tenantId"],
  });

export const setPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

// Email is handled separately from name/phone/role: it can't be changed outright, only
// *requested*, because the new address has to be confirmed first (SA-1.3).
export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  role: z.enum(TENANT_ROLES),
  email: z.string().trim().toLowerCase().email(),
});

export const confirmEmailSchema = z.object({
  token: z.string().min(1),
});

// SA-1.4: suspension is disciplinary or non-payment, so it always needs a stated reason —
// enforced server-side, not just as a required field in the form.
export const suspendUserSchema = z.object({
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
});
