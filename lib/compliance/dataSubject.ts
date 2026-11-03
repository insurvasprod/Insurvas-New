/**
 * LA-6.5 (Notion sprint, Module 6 — Compliance) · consumer deletion: the request's rules, pure.
 *
 * Verify first (deleting the wrong person is itself a data incident, and irreversible), then a short
 * cancellable hold, then the purge. A request that cannot be verified is rejected with a reason —
 * rejecting is a legitimate outcome; silently doing nothing is not.
 */

export const DELETION_VIA = ["phone", "email", "letter", "web_form"] as const;
export const VIA_LABELS: Record<(typeof DELETION_VIA)[number], string> = { phone: "Phone", email: "Email", letter: "Letter", web_form: "Web form" };
export const VERIFICATION_METHODS = ["known_customer", "phone_match", "email_match", "document"] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export const METHOD_LABELS: Record<VerificationMethod, string> = {
  known_customer: "Known customer (we hold their client record), and they contacted us from a number or email we hold — or a note of how you confirmed it",
  phone_match: "They contacted us from a number we hold for them",
  email_match: "They wrote from an email we hold for them",
  document: "Showed a document establishing identity (describe it)",
};
export const DELETION_STATUSES = ["received", "verifying", "verified", "scheduled", "completed", "rejected", "cancelled"] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];
export const STATUS_LABELS: Record<DeletionStatus, string> = {
  received: "Received",
  verifying: "Verifying identity",
  verified: "Verified",
  scheduled: "On hold before deletion",
  completed: "Deleted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const PLATFORM_HOLD_FLOOR_DAYS = 3;
export const DEFAULT_HOLD_DAYS = 7;
/** A written verification (a document, or how a known customer was confirmed) is at least this long. */
export const EVIDENCE_NOTE_MIN = 20;

export type Discovery = { phones: string[]; emails: string[]; contact_ids: string[]; lead_ids: string[] };

/**
 * The request as verification sees it. `phoneDigits` / `email` / `contactId` say WHO is to be deleted;
 * `requesterPhone` / `requesterEmail` record the channel the request actually came from (caller ID, the
 * sender's address). Identity is established by the channel matching what we hold for that person —
 * the number asked about being one we hold proves nothing, since anyone can name a number.
 */
export type VerificationRequest = { phoneDigits: string | null; email: string | null; contactId: string | null; requesterPhone: string | null; requesterEmail: string | null };

/**
 * Whether the chosen method establishes identity, from what we hold. Returns null when it does,
 * else the reason (which is also what to tell the requester would satisfy us). Never satisfied by
 * the staffer's say-so alone: a channel match, or a written account of the evidence.
 */
export function verificationProblem(method: VerificationMethod, request: VerificationRequest, found: Discovery, note: string | null): string | null {
  const holdsAnyone = found.contact_ids.length > 0 || found.lead_ids.length > 0;
  const phoneMatches = Boolean(request.requesterPhone && found.phones.includes(request.requesterPhone));
  const emailMatches = Boolean(request.requesterEmail && found.emails.includes(request.requesterEmail.toLowerCase()));
  const written = Boolean(note && note.trim().length >= EVIDENCE_NOTE_MIN);
  if (method === "phone_match") {
    if (!request.requesterPhone) return "Record the number they contacted us from (the caller ID), not only the number they asked about.";
    if (!holdsAnyone) return "We hold no client or lead for this request. Ask for the number we called, or another way to establish who they are.";
    return phoneMatches ? null : "They contacted us from a number we do not hold for this person. Ask them to call from the number we have, or verify another way.";
  }
  if (method === "email_match") {
    if (!request.requesterEmail) return "Record the address they wrote from, not only the address they asked about.";
    if (!holdsAnyone) return "We hold no client or lead for this request. Ask for the address we have on file, or a document.";
    return emailMatches ? null : "They wrote from an address we do not hold for this person. Ask them to write from the address we have, or send a document.";
  }
  if (method === "known_customer") {
    if (!(request.contactId && found.contact_ids.includes(request.contactId))) return "Choose the client record this person is, from the client's own page.";
    return phoneMatches || emailMatches || written ? null : `Choosing the client is not proof it is them. Record the number or email they contacted us from (one we hold), or write how you confirmed it (at least ${EVIDENCE_NOTE_MIN} characters).`;
  }
  return written ? null : `Say which document was shown and what it established (at least ${EVIDENCE_NOTE_MIN} characters).`;
}

/** When the purge may run: the hold starts at verification. Never shorter than the platform floor. */
export function purgeDate(verifiedAt: Date, holdDays: number): Date {
  const days = Math.max(PLATFORM_HOLD_FLOOR_DAYS, Math.floor(holdDays));
  return new Date(verifiedAt.getTime() + days * 86_400_000);
}

export function holdRemaining(scheduledPurgeAt: string | null, now: Date): { due: boolean; label: string } {
  if (!scheduledPurgeAt) return { due: false, label: "Not scheduled" };
  const ms = Date.parse(scheduledPurgeAt) - now.getTime();
  if (ms <= 0) return { due: true, label: "Hold over — ready to delete" };
  const days = Math.ceil(ms / 86_400_000);
  return { due: false, label: `Deletable in ${days} day${days === 1 ? "" : "s"}; can be cancelled until then` };
}
