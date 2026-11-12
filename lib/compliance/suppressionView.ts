/**
 * TCPA / DNC r7 (2026-11-11, docs/la4/mockups-r7/compliance.html §2·A): how a suppression row reads in one line.
 *
 * A plain module (no "use client", no server-only) so the list screen and the store both read it. "How you
 * learned" is words, never an id: a complaint reads "Complaint · {complainant}" and opens the complaint; a QA note
 * or a stray id keeps its words in the tooltip and shows where the number came from instead.
 */

import type { SuppressionEntry, SuppressionListType } from "@/lib/suppression/constants";

/** Where a number came from, as the suppression form and the list name it. */
export const SOURCE_LABELS: Record<string, string> = {
  disposition: "Agent on a call",
  complaint: "Complaint received",
  manual: "Added by hand",
  vendor: "Compliance vendor",
  import: "Found during an import",
};

/** The reasons the app's own paths write, said the short way the board says them. */
const KNOWN_REASONS: Record<string, string> = {
  "agent recorded do not call on the dialer": "Do not call on the dialer",
  "recorded do not call from the pipeline": "Do not call from the pipeline",
  "caller asked never to be contacted": "Asked on a call",
  "recycle screening blocked this number": "Recycle screening",
  "campaign re-scrub": "Campaign re-scrub",
  "known litigator": "Litigator feed",
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** QA and build codes ("LA15 …", "QA-3 …", "self-check") are notes for us, not for the reader. */
const CODE = /\b(?:LA|QA)[-\s]?\d|\bself-check\b|\bE2E\b/i;

/** `open_complaint` writes "Complaint {uuid}: asked not to be called"; its id, so the row can open it. */
export function complaintIdOf(reason: string | null | undefined): string | null {
  const match = /^Complaint ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec((reason ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

export type HowYouLearned = { label: string; title?: string; href?: string };

/** The "How you learned" cell: short words, a link for a complaint, the full reason in the tooltip. */
export function howYouLearned(entry: Pick<SuppressionEntry, "reason" | "source" | "listType"> & { complaintId?: string | null; complaintName?: string | null }): HowYouLearned {
  const reason = (entry.reason ?? "").trim();
  const complaintId = entry.complaintId ?? complaintIdOf(reason);
  if (complaintId) {
    return { label: entry.complaintName ? `Complaint · ${entry.complaintName}` : "Complaint", href: `/app/complaints/${complaintId}`, title: reason.replace(UUID, "").replace(/\s+:/, ":").trim() || undefined };
  }
  const known = KNOWN_REASONS[reason.toLowerCase().replace(/[.\s]+$/, "")];
  if (known) return { label: known, title: reason };
  if (!reason || UUID.test(reason) || CODE.test(reason)) {
    const fallback = entry.source ? SOURCE_LABELS[entry.source] ?? entry.source : entry.listType === "tcpa_litigator" ? "Litigator feed" : null;
    return { label: fallback ?? "—", title: reason || undefined };
  }
  return { label: reason, title: reason };
}

/** One chip a row: a litigator is the one that is wrong to dial at all; every other list is neutral. */
export const listTone = (list: SuppressionListType | string): "danger" | "neutral" => (list === "tcpa_litigator" ? "danger" : "neutral");
