import { z } from "zod";
import { ADMIN_ROLES } from "./roles";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const verify2faSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const createAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ADMIN_ROLES),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

export const updateAdminSchema = z
  .object({
    role: z.enum(ADMIN_ROLES).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => data.role !== undefined || data.is_active !== undefined, {
    message: "Nothing to update",
  });
