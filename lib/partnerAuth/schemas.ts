import { z } from "zod";
import { PARTNER_ROLES } from "./roles";

export const partnerLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1),
});

export const partnerUserInviteSchema = z.object({
  name: z.string().trim().min(1, "Enter the user's name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: z.enum(PARTNER_ROLES, { message: "Choose a valid partner role" }),
});

export const partnerUserActionSchema = z.object({
  action: z.enum(["deactivate", "reactivate"], { message: "Choose deactivate or reactivate" }),
});
