import { z } from "zod";

/**
 * Why someone revealed an SSN or a bank / card number (audit 2026-10-16).
 *
 * Every full-value reveal already wrote an access record (who, when, which field) but not why, so
 * an owner reviewing the log could not tell a read-back to the customer from browsing. Each reveal
 * now carries a short typed reason, kept on tenant_sensitive_access_log.reason (20261016300000)
 * and in the audit row's metadata. Shared by the routes and the dialog that asks for it.
 */
export const REVEAL_REASON_MIN = 4;
export const REVEAL_REASON_MAX = 200;
/** Owner 2026-10-28: the screens no longer ask; every reveal from them carries this reason. */
export const REVEAL_REASON_ON_SCREEN = "Revealed on screen by the agent";
export const REVEAL_REASON_REQUIRED ="Say why you need the full value (a few words), then reveal it.";

export const revealReasonField = z
  .string({ error: REVEAL_REASON_REQUIRED })
  .trim()
  .min(REVEAL_REASON_MIN, REVEAL_REASON_REQUIRED)
  .max(REVEAL_REASON_MAX, `Keep the reason under ${REVEAL_REASON_MAX} characters.`);

/** The trimmed reason, or null when it is missing or too short / long to accept. */
export function normaliseRevealReason(value: unknown): string | null {
  const parsed = revealReasonField.safeParse(value);
  return parsed.success ? parsed.data : null;
}
