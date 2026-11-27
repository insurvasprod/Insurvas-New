import { displayName } from "@/lib/format";

import type { TeamDraft } from "@/components/money/logic";

import type { ProducerScore } from "./types";

/**
 * Board B2 · Home for the agency owner: the rules the shared home logic does not hold. Pure, so the tests read the
 * same rules the screen uses.
 */

/** GET /api/app/agency/dashboard's producer row with the two figures the phone ranks and chips by (scorecardStore). */
export type OwnerProducer = ProducerScore & {
  /** Policies in his book the carrier charged back this period (a count, never money). */
  chargebacks?: number;
  /** Annual premium of the policies issued in the period, from the carriers' files. */
  issuedAnnualCents?: number;
};

/** What Team payouts waits on the owner to approve: the people the month pays and the total (money/logic teamDraft). */
export function approvePayouts(drafts: readonly TeamDraft[]): { count: number; cents: number } {
  return { count: drafts.length, cents: drafts.reduce((sum, d) => sum + d.payCents, 0) };
}

/** The month's chargebacks: what was clawed back and how many policies it hit. */
export function chargebackPolicies(rows: readonly OwnerProducer[]): { cents: number; policies: number } {
  return {
    cents: Math.abs(rows.reduce((sum, r) => sum + (r.chargebackCents ?? 0), 0)),
    policies: rows.reduce((sum, r) => sum + (r.chargebacks ?? 0), 0),
  };
}

export type PremiumLeader = { userId: string; rank: number; name: string; cents: number; share: number };

/** Producers by the annual premium they had issued this month (then policies issued), each bar against the leader's. */
export function premiumLeaders(rows: readonly OwnerProducer[], top = 4): PremiumLeader[] {
  const cents = (r: OwnerProducer) => r.issuedAnnualCents ?? 0;
  const sorted = [...rows].sort((a, b) => cents(b) - cents(a) || b.issued - a.issued || a.name.localeCompare(b.name));
  const best = sorted[0] ? cents(sorted[0]) : 0;
  return sorted.slice(0, top).map((r, i) => ({
    userId: r.producerUserId,
    rank: i + 1,
    name: displayName(r.name) ?? r.name,
    cents: cents(r),
    share: best ? Math.round((cents(r) / best) * 100) : 0,
  }));
}
