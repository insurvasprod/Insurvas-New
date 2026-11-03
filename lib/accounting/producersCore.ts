/**
 * LA-7.5 (Notion sprint, Module 7 — Accounting) · producer splits, with no database.
 *
 * A producer sees their own balance and why — the chargebacks that caused it — before the
 * conversation happens. They see their share, never what the agency grossed on their policy: the
 * producer's view (producerView) carries no commission amount and no percentage to work it back from.
 */

export const PRODUCER_ENTRY_LABELS: Record<string, string> = {
  split_advance: "Share of an advance",
  split_earned: "Share of earned commission",
  split_chargeback: "Share of a chargeback",
  split_paid: "Paid to you",
  adjustment: "Adjustment",
};

export const BASIS_LABELS = { advance: "Share of the advance", earned: "Share of earned commission", both: "Advance and earned" } as const;
export const PAYS_ON_LABELS = { advance_received: "When the advance arrives", first_draft: "After the first premium is paid", issue: "When the policy issues" } as const;
export const NEGATIVE_POLICY_LABELS = { carry_forward: "Carry forward — nothing paid until it clears", cap: "Cap the recovery — withhold a share of each payout", write_off: "Write off — the agency absorbs it, with a reason" } as const;

export type Basis = keyof typeof BASIS_LABELS;
export type PaysOn = keyof typeof PAYS_ON_LABELS;
export type NegativePolicy = keyof typeof NEGATIVE_POLICY_LABELS;

export type ProducerEntry = { id: string; entryType: string; policyNumber: string | null; carrierId: string | null; commissionEntryId: string | null; splitPctBpApplied: number | null; amountCents: number; occurredOn: string; payoutRunId: string | null; reason: string | null };
export type ProducerRun = { id: string; periodStart: string; periodEnd: string; status: "draft" | "published" | "paid" | "void"; negativePolicy: NegativePolicy; balanceBeforeCents: number; earnedCents: number; clawedBackCents: number; withheldCents: number; netCents: number; balanceAfterCents: number; paidOn: string | null };

/** "60%" from basis points, by string handling (no float). */
export function percent(bp: number): string {
  const digits = String(bp).padStart(3, "0");
  const whole = digits.slice(0, -2);
  const rest = digits.slice(-2).replace(/0+$/, "");
  return rest ? `${whole}.${rest}%` : `${whole}%`;
}

/** What a producer may read about themselves: share amounts, dates, policy numbers and the reason for each — no commission figure. */
export function producerView(input: { balanceCents: number; entries: ProducerEntry[]; runs: ProducerRun[] }) {
  return {
    balanceCents: input.balanceCents,
    owesAgency: input.balanceCents < 0,
    entries: input.entries.map((e) => ({ id: e.id, label: PRODUCER_ENTRY_LABELS[e.entryType] ?? e.entryType, policyNumber: e.policyNumber, amountCents: e.amountCents, occurredOn: e.occurredOn, reason: e.reason })),
    runs: input.runs.filter((r) => r.status === "published" || r.status === "paid").map((r) => ({
      id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status, earnedCents: r.earnedCents, clawedBackCents: r.clawedBackCents,
      withheldCents: r.withheldCents, netCents: r.netCents, balanceAfterCents: r.balanceAfterCents, paidOn: r.paidOn,
    })),
  };
}

export type ProducerView = ReturnType<typeof producerView>;
