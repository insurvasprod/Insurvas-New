import type { PartnerLane } from "./lanes.ts";
import { PARTNER_BOARD_COLUMNS, laneOf } from "./view.ts";

/**
 * Where a window of submissions ended up, for the Overview's share bar.
 *
 * Pure, and in its own module, because the rule worth holding is that these are the Pipeline's
 * lanes, spelled the Pipeline's way. A partner who reads "Converted 3" on one page and a different
 * three on the other stops trusting both.
 */

type LaneRow = { lane?: PartnerLane | null };

/** Every lane, Closed included, in board order — the vocabulary `PARTNER_BOARD_COLUMNS` sets. */
export const OVERVIEW_LANES: ReadonlyArray<{ key: PartnerLane; label: string }> = [
  ...PARTNER_BOARD_COLUMNS.map((column) => ({ key: column.key as PartnerLane, label: column.label })),
  { key: "closed", label: "Closed" },
];

export type LaneShare = { key: PartnerLane; label: string; count: number };

/**
 * Where a window's submissions ended up. Every lane is listed, including the empty ones: "nothing
 * converted" is the answer to the question, not a missing row.
 */
export function laneShares(rows: readonly LaneRow[]): LaneShare[] {
  const counts = new Map<PartnerLane, number>();
  for (const row of rows) {
    const lane = laneOf(row);
    counts.set(lane, (counts.get(lane) ?? 0) + 1);
  }
  return OVERVIEW_LANES.map((lane) => ({ ...lane, count: counts.get(lane.key) ?? 0 }));
}
