import { isDisposableEmail } from "disposable-email-domains-js";
import { z } from "zod";

import { BILLING_CYCLES } from "../money.ts";
import { LEAD_SOURCE_OPTIONS, PRODUCT_OPTIONS, US_STATES, VOLUME_OPTIONS } from "./constants.ts";

const workEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid work email")
  .refine((email) => !isDisposableEmail(email), "Disposable email addresses are not allowed");

export const publicSignupSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  email: workEmail,
  password: z.string().min(12, "Password must be at least 12 characters").max(200),
  phone: z.string().trim().min(7, "Enter a valid mobile phone").max(40),
  planCode: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Choose a valid plan"),
  billingCycle: z.enum(BILLING_CYCLES),
});

export const verificationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resend") }),
  z.object({ action: z.literal("change_email"), email: workEmail }),
]);

const productValues = PRODUCT_OPTIONS.map((option) => option.value);
const volumeValues = VOLUME_OPTIONS.map((option) => option.value);
const leadValues = LEAD_SOURCE_OPTIONS.map((option) => option.value);
const stateValues = new Set<string>(US_STATES.map(([code]) => code));

export const businessProfileSchema = z
  .object({
    businessName: z.string().trim().min(2, "Enter your business name").max(160),
    npn: z.string().trim().regex(/^\d{1,10}$/, "NPN must contain up to 10 digits"),
    primaryState: z.string().trim().toUpperCase().refine((value) => stateValues.has(value), "Choose a state"),
    productsSold: z.array(z.string()).min(1, "Select at least one product"),
    monthlyVolumeRange: z.string(),
    leadSources: z.array(z.string()).min(1, "Select at least one lead source"),
    leadSourceOther: z.string().trim().max(120).optional().or(z.literal("")),
  })
  .superRefine((data, context) => {
    if (data.productsSold.some((value) => !productValues.includes(value as never))) {
      context.addIssue({ code: "custom", path: ["productsSold"], message: "Choose valid products" });
    }
    if (!volumeValues.includes(data.monthlyVolumeRange as never)) {
      context.addIssue({ code: "custom", path: ["monthlyVolumeRange"], message: "Choose monthly volume" });
    }
    if (data.leadSources.some((value) => !leadValues.includes(value as never))) {
      context.addIssue({ code: "custom", path: ["leadSources"], message: "Choose valid lead sources" });
    }
    if (data.leadSources.includes("other") && !data.leadSourceOther) {
      context.addIssue({ code: "custom", path: ["leadSourceOther"], message: "Describe the other source" });
    }
  });
