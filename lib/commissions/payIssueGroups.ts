import type { DiscrepancyType } from "../ingestion/discrepancyEngine.ts";

/**
 * Commissions › Pay issues as groups (board 13, 2026-11-03): today's open list, one line per cause and carrier
 * ("Wrong rate · American Amicable · 702 · −$9,410"), with the difference total and what usually settles it.
 * Hundreds of issues are mostly one cause; a group says so on its first line and opens the Review page that works
 * them one at a time. Pure: the list groups what it was given, both sources alike.
 */

/** The short "usually" hint per cause: what settles most of them. */
export const PAY_ISSUE_USUALLY: Record<DiscrepancyType, string> = {
  missing: "not paid yet, or no rate to price it: check the pay lag, then a letter",
  short_paid: "a letter with the figures",
  over_paid: "may be taken back: hold it",
  mis_rated: "the rate card or the file's layout is off: fix the rate first",
  duplicate_chargeback: "dispute: one lapse, one chargeback",
  unexpected_chargeback: "dispute, unless the policy lapsed",
  missing_chargeback: "coming back: don't spend it",
  held_building_up: "ask the carrier when it releases",
  debit_balance_growing: "chargebacks outrun pay: watch the account",
  not_received: "check the bank deposit, then ask the carrier",
};

export type PayIssueInput = {
  type: DiscrepancyType;
  /** null when a hand-imported statement names a carrier the library does not know. */
  carrierId: string | null;
  carrierName: string;
  /** Positive: owed to the agency. Negative: owed to the carrier. */
  differenceCents: number;
};

export type PayIssueGroup = {
  key: string;
  type: DiscrepancyType;
  carrierId: string | null;
  carrierName: string;
  count: number;
  differenceCents: number;
  usually: string;
  /** The Review page for this group, or null when the carrier is not one Insurvas knows. */
  reviewHref: string | null;
};

/** The Review page for one cause at one carrier (the page Needs you opens, with the pay-issue answers). */
export function payIssueReviewHref(carrierId: string, type: DiscrepancyType): string {
  return `/app/needs-you/review?${new URLSearchParams({ kind: "money", carrier: carrierId, type })}`;
}

/** Groups by cause and carrier; the largest difference first, then the most issues, then the carrier's name. */
export function groupPayIssues(items: PayIssueInput[]): PayIssueGroup[] {
  const groups = new Map<string, PayIssueGroup>();
  for (const item of items) {
    const carrierKey = item.carrierId ?? `name:${item.carrierName.trim().toLowerCase()}`;
    const key = `${item.type}|${carrierKey}`;
    const group = groups.get(key) ?? {
      key, type: item.type, carrierId: item.carrierId, carrierName: item.carrierName, count: 0, differenceCents: 0,
      usually: PAY_ISSUE_USUALLY[item.type] ?? "", reviewHref: item.carrierId ? payIssueReviewHref(item.carrierId, item.type) : null,
    };
    group.count += 1;
    group.differenceCents += item.differenceCents;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.differenceCents) - Math.abs(a.differenceCents) || b.count - a.count || a.carrierName.localeCompare(b.carrierName));
}
