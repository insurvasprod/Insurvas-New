import { z } from "zod";

/**
 * The landing page's contact form (Umar, 4 Nov, A8.6): "How will people contact us? Contact form is
 * missing." One request is one email to the Insurvas inbox; nothing is stored. Plain module (no
 * `@/` imports) so the schema is testable from `node --test`.
 */

/** Limits are generous for a real message and small enough that the email stays readable. */
export const CONTACT_LIMITS = { name: 120, email: 254, agency: 160, message: 4000, messageMin: 10 } as const;

export const contactRequestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(CONTACT_LIMITS.name, "That name is too long"),
  email: z.string().trim().toLowerCase().max(CONTACT_LIMITS.email, "That email is too long").email("Enter a valid email address"),
  agency: z.string().trim().max(CONTACT_LIMITS.agency, "That name is too long").optional().transform((value) => (value ? value : null)),
  message: z.string().trim().min(CONTACT_LIMITS.messageMin, "Tell us a little more").max(CONTACT_LIMITS.message, "Keep it under 4,000 characters"),
  // The honeypot: hidden from people, filled in by scripts that fill every field.
  website: z.string().optional(),
});

export type ContactRequest = z.output<typeof contactRequestSchema>;

/** Field name → the first error message for it, for the form to show under each field. */
export function contactFieldErrors(error: z.ZodError): Partial<Record<"name" | "email" | "agency" | "message", string>> {
  const errors: Partial<Record<"name" | "email" | "agency" | "message", string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if ((field === "name" || field === "email" || field === "agency" || field === "message") && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/** A filled honeypot means a script, which is answered as if it worked and sent nowhere. */
export function isBot(input: { website?: string }): boolean {
  return Boolean(input.website?.trim());
}

/** Where requests go: a dedicated inbox if one is set, else the address the platform sends from. */
export function contactInbox(env: Record<string, string | undefined> = process.env): string | null {
  return env.CONTACT_INBOX_EMAIL?.trim() || env.SMTP_FROM_EMAIL?.trim() || null;
}
