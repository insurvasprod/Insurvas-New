/**
 * The Publishers concept board's drop-rate insight: the one active partner whose transfers drop
 * most often this month, what share ended as completed work, and, when their payout is per
 * transfer, what the dropped calls cost. Pure, so the thresholds are tested rather than guessed.
 */

export type DropInsightInput = {
  id: string;
  name: string;
  status: string;
  transfers_this_month: number;
  completed_this_month: number;
  dropped_this_month: number;
  active_term: { payout_model: string; rate_cents: number | null } | null;
};

export type DropInsight = {
  partnerId: string;
  name: string;
  transfers: number;
  dropped: number;
  dropRate: number;
  completedRate: number;
  /** Dropped × per-transfer rate; null when the partner is not paid per transfer. */
  droppedCostCents: number | null;
  rateCents: number | null;
};

/** Below this many transfers a rate is noise. */
export const DROP_INSIGHT_MIN_TRANSFERS = 10;
/** A drop rate at or above this is worth a conversation. */
export const DROP_INSIGHT_MIN_RATE = 0.15;

export function worstDropRate(partners: DropInsightInput[]): DropInsight | null {
  const candidates = partners
    .filter((partner) => partner.status === "active" && partner.transfers_this_month >= DROP_INSIGHT_MIN_TRANSFERS)
    .map((partner) => ({ partner, rate: partner.dropped_this_month / partner.transfers_this_month }))
    .filter((entry) => entry.rate >= DROP_INSIGHT_MIN_RATE)
    .sort((a, b) => b.rate - a.rate || b.partner.dropped_this_month - a.partner.dropped_this_month);
  const top = candidates[0];
  if (!top) return null;
  const { partner } = top;
  const perTransfer = partner.active_term?.payout_model === "per_transfer" && partner.active_term.rate_cents != null ? partner.active_term.rate_cents : null;
  return {
    partnerId: partner.id,
    name: partner.name,
    transfers: partner.transfers_this_month,
    dropped: partner.dropped_this_month,
    dropRate: top.rate,
    completedRate: partner.completed_this_month / partner.transfers_this_month,
    droppedCostCents: perTransfer == null ? null : perTransfer * partner.dropped_this_month,
    rateCents: perTransfer,
  };
}
