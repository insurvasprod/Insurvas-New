import { z } from "zod";
import { TENANT_ROLES } from "@/lib/tenantAuth/roles";
import { STATE_CODES } from "@/lib/appointments/constants";

export const inviteTeamMemberSchema = z.object({
  name: z.string().trim().min(1, "Enter the teammate's name").max(120, "Name must be 120 characters or fewer"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: z.enum(TENANT_ROLES, { message: "Choose a valid role" }),
});

export const updateTeamRoleSchema = z.object({
  role: z.enum(TENANT_ROLES, { message: "Choose a valid role" }),
});

// Plain module: STATE_CODES lives in lib/appointments/constants, which has no server-only import.
export const licensedStatesSchema = z.object({
  states: z
    .array(z.string().trim().toUpperCase().refine((value) => (STATE_CODES as readonly string[]).includes(value), "Choose valid US states"))
    .max(STATE_CODES.length, "Too many states"),
  // The day each personal licence lapses (20260925702000), keyed by state; absent or null = none
  // recorded. It counts through that day and stops the day after.
  expiries: z
    .record(z.string().trim().toUpperCase(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter licence expiry dates as dates").nullable())
    .optional(),
});
