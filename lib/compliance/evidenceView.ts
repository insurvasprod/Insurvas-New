import type { GapSeverity } from "./evidenceGaps";

/**
 * What the Evidence step's server page and its client views both use (foundation pass 2026-11-03). A plain
 * module, because a server page cannot call a "use client" export.
 */
export type EvidenceQuery = { phone: string; from: string; to: string; lead: string; contact: string };
/** A report's tabs; Gaps first, as LA-6.3 orders the report. */
export type EvidenceView = "gaps" | "consent" | "leads" | "timeline";
export const EVIDENCE_VIEWS: readonly EvidenceView[] = ["gaps", "consent", "leads", "timeline"];

export const SEVERITY_TONE: Record<GapSeverity, "danger" | "warning" | "neutral"> = { critical: "danger", high: "warning", medium: "neutral" };
export const SEVERITY_LABEL: Record<GapSeverity, string> = { critical: "Fix today", high: "High", medium: "Medium" };

/** The query string for a scope (and a tab or a finding), leaving out what is empty. */
export function evidenceQuery(query: EvidenceQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...extra })) if (value) params.set(key, value);
  return params.toString();
}
