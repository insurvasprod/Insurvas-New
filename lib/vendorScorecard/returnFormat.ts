import type { VendorReturnClaimDetail } from "./types";
import { csvCell } from "./format.ts";

/**
 * A claim item as vendor_return_claim_detail returns it. Since 20260925703200 an item is either a
 * lead (lead_id) or a row the scrub removed at import (scrub_rejection_id, lead_id null).
 */
type EvidenceItem = Omit<VendorReturnClaimDetail["items"][number], "lead_id"> & { lead_id: string | null; scrub_rejection_id?: string | null };
type EvidenceDetail = { claim: VendorReturnClaimDetail["claim"]; items: EvidenceItem[] };

/**
 * The evidence columns. The first eleven are the original export's, in their original order, so a
 * sheet built on it keeps working; the rest were added for import removals and call attempts.
 * Never the agent: a call is evidenced by its attempt number and time.
 */
export const EVIDENCE_COLUMNS = [
  "lead_id", "reason", "source", "phone", "state", "screening_outcome", "screening_checked_at", "attempt_id", "attempted_at", "disposition", "lead_created_at",
  "scrub_rejection_id", "outcome", "detail", "source_row", "occurrence", "rejected_at", "attempt_number", "screening_result_id",
] as const;

function evidenceRow(item: EvidenceItem): unknown[] {
  const evidence = item.evidence ?? {};
  const sourceRow = typeof evidence.source_row === "string" ? evidence.source_row.replace(/^csv:/, "") : evidence.source_row;
  return [
    item.lead_id, item.reason, evidence.source, evidence.phone, evidence.state, evidence.screening_outcome, evidence.screening_checked_at,
    evidence.attempt_id, evidence.attempted_at, evidence.disposition, evidence.lead_created_at,
    item.scrub_rejection_id ?? evidence.scrub_rejection_id, evidence.outcome, evidence.detail, sourceRow, evidence.occurrence, evidence.rejected_at,
    evidence.attempt_number, evidence.screening_result_id,
  ];
}

export function vendorReturnCsv(detail: EvidenceDetail): string {
  const summary = [
    ["claim_id", detail.claim.id],
    ["status", detail.claim.status],
    ["campaign_id", detail.claim.campaign_id],
    ["vendor_id", detail.claim.vendor_id],
    ["reason", detail.claim.reason],
    ["lead_count", detail.claim.lead_count],
    ["amount_claimed", detail.claim.amount_claimed_cents / 100],
    ["amount_credited", detail.claim.amount_credited_cents / 100],
    ["replacement_leads", detail.claim.replacement_leads_count],
    ["submitted_at", detail.claim.submitted_at],
    ["resolved_at", detail.claim.resolved_at],
    ["notes", detail.claim.notes],
  ].map((row) => row.map(csvCell).join(","));
  const header = EVIDENCE_COLUMNS.map(csvCell).join(",");
  const rows = detail.items.map((item) => evidenceRow(item).map(csvCell).join(","));
  return [...summary, "", ["evidence"].map(csvCell).join(","), header, ...rows].join("\r\n") + "\r\n";
}
