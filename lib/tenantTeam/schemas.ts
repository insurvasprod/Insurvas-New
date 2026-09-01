import { z } from "zod";
import { TENANT_ROLES } from "@/lib/tenantAuth/roles";

export const inviteTeamMemberSchema = z.object({
  name: z.string().trim().min(1, "Enter the teammate's name").max(120, "Name must be 120 characters or fewer"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: z.enum(TENANT_ROLES, { message: "Choose a valid role" }),
});

export const updateTeamRoleSchema = z.object({
  role: z.enum(TENANT_ROLES, { message: "Choose a valid role" }),
});
