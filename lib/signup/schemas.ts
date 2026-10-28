import { isDisposableEmail } from "disposable-email-domains-js";
import { z } from "zod";

import { BILLING_CYCLES } from "../money.ts";
import { checkInternationalPhone } from "./phone.ts";
import { LEAD_SOURCE_OPTIONS, PRODUCT_OPTIONS, US_STATES, VOLUME_OPTIONS } from "./constants.ts";

const workEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .refine((email) => !isDisposableEmail(email), "Disposable email addresses are not allowed");

/** A phone number checked against its country's rules (lib/signup/phone.ts) and kept in E.164. */
export const phoneField = z.string().trim().min(7, "Enter a valid phone number").max(40).transform((value, ctx) => {
  const checked = checkInternationalPhone(value);
  if (!checked.ok) { ctx.addIssue({ code: "custom", message: checked.error }); return z.NEVER; }
  return checked.e164;
});

/**
 * Until step 3 (About you) asks for the real name, the account carries one made from the address:
 * "jane.doe@agency.com" → "Jane Doe". It greets them in the verification email and names the workspace.
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.split(/[._\-+\d]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  const name = words.join(" ").trim();
  return name.length >= 2 ? name.slice(0, 120) : "New agent";
}

export const publicSignupSchema = z.object({
  // Step 1 asks only for email and password (manager review, 2026-10-28). Name and phone are asked on
  // step 3; an older client that still sends them is still checked.
  fullName: z.string().trim().min(2, "Enter your full name").max(120).optional(),
  email: workEmail,
  password: z.string().min(12, "Password must be at least 12 characters").max(200),
  phone: phoneField.optional(),
  // Optional since the plan has its own step (owner, 2026-10-26: Step 4 of 5). A plan picked on the
  // pricing page still arrives here; without one the server starts from the default plan.
  planCode: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Choose a valid plan").optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
  // SA-5.4: the ids of the document versions the box was ticked for. Ids, not a boolean — a
  // boolean records that someone agreed to *something*, which is worth nothing in a dispute.
  // The server checks these against what is published right now rather than trusting them.
  acceptedDocumentIds: z.array(z.string().uuid()).max(5).default([]),
});

/** Step 4 of 5, Your plan. The rules (seat bands, add-ons on the plan) are checked in lib/signup/planChoice.ts. */
export const planChoiceSchema = z.object({
  planCode: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, "Choose a plan"),
  billingCycle: z.enum(BILLING_CYCLES),
  seats: z.number().int().min(1, "Choose at least one seat").max(100000),
  addonCodes: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
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
    // About you (manager review, 2026-10-28): the name and phone moved here from step 1. Optional in the
    // schema so a profile corrected from checkout without them keeps what is saved.
    firstName: z.string().trim().min(1, "Enter your first name").max(60).optional(),
    lastName: z.string().trim().min(1, "Enter your last name").max(60).optional(),
    phone: phoneField.optional(),
    businessName: z.string().trim().min(2, "Enter your business name").max(160),
    // Sign-up no longer asks for it (owner, 2026-10-26); it is set later in Settings › Agency profile.
    // One that is sent is still checked.
    npn: z.string().trim().regex(/^\d{1,10}$/, "NPN must contain up to 10 digits").nullish(),
    primaryState: z.string().trim().toUpperCase().refine((value) => stateValues.has(value), "Choose a state"),
    productsSold: z.array(z.string()).min(1, "Select at least one product"),
    monthlyVolumeRange: z.string(),
    leadSources: z.array(z.string()).min(1, "Select at least one lead source"),
    // Nullable, not merely optional. The field is rendered only when "other" is ticked, so
    // FormData.get returns null the rest of the time and the form posts a literal null — which an
    // `.optional()` string rejects, failing EVERY onboarding that does not pick "other" with a
    // generic "Invalid input". Found by driving signup in a browser; no script had posted this
    // shape. The server tolerating null is the right fix: absent is absent, however it is spelled.
    leadSourceOther: z.string().trim().max(120).nullish(),
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
