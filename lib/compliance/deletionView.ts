import type { DeletionStatus } from "./dataSubject";
import { formatPhone } from "./evidenceGaps";

/**
 * What the Deletions list and a request's page both draw (foundation pass 2026-11-03). A plain module,
 * because a server page cannot call a "use client" export.
 */
export const DELETION_TONE: Record<DeletionStatus, "info" | "warning" | "good" | "neutral"> = { received: "info", verifying: "info", verified: "info", scheduled: "warning", completed: "good", rejected: "neutral", cancelled: "neutral" };

/** Who is to be deleted, as the request names them: "Dana Ruiz · (555) 123-4567 · dana@…". */
export const deletionWho = (r: { requesterName: string | null; phoneDigits: string | null; email: string | null }) =>
  [r.requesterName, r.phoneDigits ? formatPhone(r.phoneDigits) : null, r.email].filter(Boolean).join(" · ") || "A client record";
