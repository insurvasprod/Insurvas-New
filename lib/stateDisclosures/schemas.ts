import { z } from "zod";

import { STATE_CODES } from "@/lib/appointments/constants";

const productCode = z
  .string()
  .trim()
  .min(1, "A product code is required")
  .max(80, "Product code is too long")
  // The dialer matches this exactly against the lead's product line, which arrives lowercased and
  // underscored. Accepting "Term Life" here would publish a row the dialer can never find.
  .regex(/^[a-z0-9_]+$/, "Use lower case letters, digits and underscores, e.g. term_life");

const requiredText = z
  .string()
  .trim()
  .min(1, "The disclosure text is required")
  .max(8000, "The disclosure text is too long");

const effectiveFrom = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That is not a real date");

export const publishStateDisclosureSchema = z.object({
  // One publish covers many states, because a disclosure is usually written once and adopted by a
  // list of states at the same time. Requiring one submission per state would mean fifty-one
  // round trips to make a product dialable nationwide, and the screen would go unused.
  states: z
    .array(z.enum(STATE_CODES as [string, ...string[]]))
    .min(1, "Choose at least one state")
    .max(51, "That is more states than exist"),
  product_code: productCode,
  required_text: requiredText,
  effective_from: effectiveFrom,
});

export const updateStateDisclosureSchema = z.object({
  required_text: requiredText.optional(),
  effective_from: effectiveFrom.optional(),
});

// ── Review workflow (migration 20260925507000) ────────────────────────────────────────────────

/** The first date a new version may take effect: tomorrow, UTC — the dialer's own calendar. */
export function earliestEffectiveDate(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString().slice(0, 10);
}

const reviewNote = z.string().trim().max(2000, "Keep the note under 2,000 characters").optional();

// The same shape the publisher takes, plus the reviewer-facing note. Not in the future is refused
// here as well as in the approval function, so a proposal nobody could ever approve is not queued.
export const proposeStateDisclosureSchema = publishStateDisclosureSchema
  .extend({ note: reviewNote })
  .refine((value) => value.effective_from >= earliestEffectiveDate(), {
    message: "A new version takes effect from tomorrow at the earliest, so it never covers a call already placed.",
    path: ["effective_from"],
  });

export const reviewProposalSchema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
  note: reviewNote,
  // Only read when the approver is also the author and the server allows self-approval
  // (no other active super_admin / platform_config admin). 10–500 characters, as the database checks.
  attestation: z
    .string()
    .trim()
    .min(10, "Write at least 10 characters saying what you checked the wording against")
    .max(500, "Keep the attestation under 500 characters")
    .optional(),
});

export const MAX_PACK_PROPOSALS = 200;

export const importPackSchema = z.object({
  file_name: z.string().trim().max(200).optional(),
  proposals: z
    .array(proposeStateDisclosureSchema)
    .min(1, "The pack has no rows to import")
    .max(MAX_PACK_PROPOSALS, `A pack can hold at most ${MAX_PACK_PROPOSALS} distinct versions`),
});
