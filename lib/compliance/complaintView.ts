import { CATEGORY_LABELS, type ComplaintCategory, type CountdownTone } from "./complaints";

/**
 * What the Complaints list and a complaint's page both draw (foundation pass 2026-11-03). A plain module,
 * because a server page cannot call a "use client" export.
 */
export type ComplaintChipTone = "danger" | "warning" | "neutral";

/** The countdown chip: overdue and red are danger, amber and a missing deadline need action. */
export const COMPLAINT_TONE: Record<CountdownTone, ComplaintChipTone> = { overdue: "danger", red: "danger", amber: "warning", no_deadline: "warning", calm: "neutral", none: "neutral" };

/** "Unwanted calls complaint", the record's title. */
export const complaintTitle = (c: { category: string }) => `${CATEGORY_LABELS[c.category as ComplaintCategory] ?? c.category} complaint`;
