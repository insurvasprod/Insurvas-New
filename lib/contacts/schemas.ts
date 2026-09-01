import { z } from "zod";

const state = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a two-letter state code").nullable().optional();
const date = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), z.literal("")]).nullable().optional().transform((value) => value || null);
const phone = z.object({ phone: z.string().trim().regex(/^[0-9 ()+.-]{7,40}$/, "Enter a valid phone number"), type: z.enum(["mobile", "landline", "other"]), is_primary: z.boolean() });
const email = z.object({ email: z.string().trim().email("Enter a valid email"), is_primary: z.boolean() });
const customFields = z.record(z.string().regex(/^[a-z][a-z0-9_]{1,59}$/), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.array(z.string().max(120)).max(50)]));

export const contactSchema = z.object({
  first_name: z.string().trim().min(1, "Enter a first name").max(120, "First name is too long"),
  last_name: z.string().trim().min(1, "Enter a last name").max(120, "Last name is too long"),
  dob: date,
  primary_phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email("Enter a valid email").nullable().optional().or(z.literal("")),
  state,
  address_line1: z.string().trim().max(240).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  postal_code: z.string().trim().max(20).nullable().optional(),
  custom_fields: customFields.default({}),
  phones: z.array(phone).max(20).default([]),
  emails: z.array(email).max(20).default([]),
}).strict();

export const fieldSchema = z.object({
  entity: z.enum(["contact", "lead", "policy", "application"]).default("contact"),
  field_key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,59}$/, "Use lowercase letters, numbers and underscores"),
  label: z.string().trim().min(1, "Enter a field label").max(120, "Field label is too long"),
  type: z.enum(["text", "number", "date", "single_select", "multi_select", "boolean", "currency", "phone"]),
  options: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  is_required: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(9999).default(0),
}).strict();

export const mergeSchema = z.object({
  kept_id: z.string().uuid("Choose a valid kept contact"),
  merged_id: z.string().uuid("Choose a valid merged contact"),
  field_choices: z.record(z.string(), z.enum(["kept", "merged"])),
}).strict().refine((value) => value.kept_id !== value.merged_id, { message: "Choose two different contacts" });
