import type { EvidenceFilter, EvidenceLevel } from "@/lib/consent/evidence";

/**
 * What the Consent list and a consent record both draw (Compliance round 7, board 3·A, owner 2026-11-11). A plain
 * module, because a server page cannot call a "use client" export.
 *
 * One chip a row: Full is done (good); anything short of the words, the time and the address is waiting on
 * proof (warning). The long label stays in the chip's tooltip.
 */
export const EVIDENCE_CHIP: Record<EvidenceLevel, string> = {
  full: "Full",
  no_ip: "No IP",
  link_only: "Link only",
  attested: "Attested",
  lost: "Link lost",
  none: "No proof",
};
export const evidenceChipTone = (level: EvidenceLevel): "good" | "warning" => (level === "full" ? "good" : "warning");

/** A lead with the words (and the address) needs nothing; any other needs proof attached. */
export const needsProof = (level: EvidenceLevel) => level !== "full" && level !== "no_ip";

/** The lead's consent record: its best certificate when it has one, else the lead itself (a "no proof" record). */
export const consentRecordHref = (row: { leadId: string; artefactId: string | null }, evidence?: EvidenceFilter | null) =>
  `/app/consent/${row.artefactId ?? row.leadId}${evidence && evidence !== "every" ? `?evidence=${evidence}` : ""}`;

/** "8 Oct 2026" from evidenceTime's "8 Oct 2026, 14:02 UTC"; null when nothing is recorded. */
export const consentDay = (formatted: string) => (formatted === "Not recorded" ? null : formatted.replace(/, .*$/, ""));
