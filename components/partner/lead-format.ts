import type { StatusTone } from "@/components/ui/status-chip";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { NOBODY_CLAIMED_LABEL } from "@/lib/partnerLeads/lanes";
import type { PartnerLeadDetail, PartnerLeadRow } from "@/lib/partnerLeads/types";

/**
 * The few things the list and the record page both say about a lead, in one place so they cannot
 * drift: how a date reads, what the stage is called, and what colour that stage is.
 */

/** "30 Oct, 1:50 am" — the house format (§15), not the browser's raw locale string. */
export function when(value: string) { return dateTime(value, viewerTimeZone(), { clock: "12h" }); }
export function stageLabel(row: PartnerLeadRow | PartnerLeadDetail) { return row.stageName || row.outcome || "Submitted"; }
export function stageTone(row: PartnerLeadRow | PartnerLeadDetail): StatusTone {
  if (row.stageName === NOBODY_CLAIMED_LABEL) return "warning";
  if (row.stageType === "won") return "good";
  if (row.stageType === "lost") return "danger";
  return "neutral";
}
