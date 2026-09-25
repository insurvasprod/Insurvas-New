import { z } from "zod";
import { PARTNER_ROLES } from "./roles";

export const partnerLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1),
  // "Keep me signed in on this device". Absent means keep, so a caller that predates the box
  // behaves exactly as before.
  remember: z.boolean().optional().default(true),
});

export const partnerUserInviteSchema = z.object({
  name: z.string().trim().min(1, "Enter the user's name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: z.enum(PARTNER_ROLES, { message: "Choose a valid partner role" }),
});

export const partnerExistingInviteSchema = z.object({
  token: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: z.string().min(1),
  remember: z.boolean().optional().default(true),
});

// The initial partner_admin invitation is issued from the agent workspace. Once inside the
// partner portal, an admin may add people to this partner, but cannot create another admin role
// or extend access beyond the partner account they already own.
export const partnerAdminUserInviteSchema = z.object({
  name: z.string().trim().min(1, "Enter the user's name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: z.literal("partner_user", { message: "Partner admins can invite partner users only" }),
});

export const partnerUserActionSchema = z.object({
  action: z.enum(["deactivate", "reactivate"], { message: "Choose deactivate or reactivate" }),
});
