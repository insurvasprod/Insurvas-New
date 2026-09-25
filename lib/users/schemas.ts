import { z } from "zod";

import { TENANT_ROLES } from "../tenantAuth/roles.ts";

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
    // A new tenant must start on an explicit sellable plan. Existing-tenant user invites do not
    // change the tenant's subscription and therefore omit this field.
    planId: z.string().uuid().optional(),
    role: z.enum(TENANT_ROLES),
  })
  .refine((data) => Boolean(data.tenantId) !== Boolean(data.newTenantName?.trim()), {
    message: "Choose an existing tenant or name a new one, not both",
    path: ["tenantId"],
  })
  .refine((data) => !data.newTenantName?.trim() || Boolean(data.planId), {
    message: "Choose a plan for the new tenant",
    path: ["planId"],
  })
  .refine((data) => !data.tenantId || !data.planId, {
    message: "A plan can only be selected when creating a new tenant",
    path: ["planId"],
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

/**
 * SA-1.4: delete needs a typed confirmation, not a checkbox.
 *
 * `confirm` must be the user's own email address. Doc 2 §5.4 asks for typed confirmation because
 * deletion is the one user action with a permanent end state — an accidental click on a row you
 * misread costs somebody their account, and a second button is not a second thought.
 */
export const deleteUserSchema = z.object({
  confirm: z.string().trim().min(1, "Type the user's email address to confirm"),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});
