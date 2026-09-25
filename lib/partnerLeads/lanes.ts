/**
 * The partner's four lanes: New, Claimed, Verification, Converted — the columns and the four
 * figures the partner pipeline board draws.
 *
 * They are not the agency's pipeline stages (a tenant may have one stage called "Submitted"); they
 * are where a submission is in its life, read from the queue item and its verification session,
 * which is the one vocabulary every tenant shares:
 *
 *   New           the queue item is unclaimed — "not yet claimed"
 *   Claimed       a closer holds it (claimed, buffer, handed, or the licensed agent has it)
 *   Verification  a verification session is open on it — "on a call"
 *   Converted     completed with a sale outcome in the last 30 days
 *
 * Anything else (dropped, expired, completed without a sale, or a sale older than 30 days) is
 * closed: still listed in the table, not on the board.
 */
export type PartnerLane = "new" | "claimed" | "verification" | "converted" | "closed";

export const PARTNER_LANES: ReadonlyArray<{ key: Exclude<PartnerLane, "closed">; label: string; footnote: string }> = [
  { key: "new", label: "New", footnote: "not yet claimed" },
  { key: "claimed", label: "Claimed", footnote: "with a closer" },
  { key: "verification", label: "Verification", footnote: "on a call" },
  { key: "converted", label: "Converted", footnote: "last 30 days" },
];

/** Queue statuses in which a closer is holding the lead. */
export const HELD_STATUSES = ["claimed", "buffer_active", "handed_pending", "la_active"] as const;

/** Disposition keys that mean the lead became business. */
export const SALE_DISPOSITIONS = ["application_submitted", "sold", "issued", "converted"] as const;

export const CONVERTED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function partnerLane(
  row: { status: string; disposition: string | null; workItemId: string; updatedAt: string },
  onCall: ReadonlySet<string>,
  now: number,
): PartnerLane {
  if (row.status === "unclaimed") return "new";
  if ((HELD_STATUSES as readonly string[]).includes(row.status)) return onCall.has(row.workItemId) ? "verification" : "claimed";
  const sold = row.status === "completed" && row.disposition !== null && (SALE_DISPOSITIONS as readonly string[]).includes(row.disposition);
  if (sold && now - new Date(row.updatedAt).getTime() <= CONVERTED_WINDOW_MS) return "converted";
  return "closed";
}

export type PartnerLaneCounts = Record<Exclude<PartnerLane, "closed">, number>;

/**
 * Queue & SLA's partner rung — "Their pipeline row says nobody claimed it". Once the ladder has
 * told the partner (`sla_partner_notified_at`), a submission nobody claimed says so in its stage
 * column instead of the agency's stage name, for as long as it stays unclaimed or expired.
 */
export const NOBODY_CLAIMED_LABEL = "Nobody claimed it";

export function nobodyClaimed(row: { status: string; slaPartnerNotifiedAt: string | null | undefined }): boolean {
  return Boolean(row.slaPartnerNotifiedAt) && (row.status === "unclaimed" || row.status === "expired");
}
