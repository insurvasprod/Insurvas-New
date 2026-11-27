import { floorRows, type FloorRow } from "./logic";
import type { FloorMember } from "./types";

/**
 * Board B8 · the manager's "Right now" rows in the board's order: on a call, then wrapping up, then away, then
 * ready (people busy first, the ones free to take the next transfer last). The rows themselves (meta, chip) are the
 * shared floorRows; only the order is B8's.
 *
 * "Wrapping up · outcome screen" has no rank filled: GET /api/app/agent-floor cannot tell it. Without telephony an
 * active_calls row opens at claim and closes at disposition (migration 20260922210000), so a person on the outcome
 * step still reads "On a call"; the step itself lives only in the web address (?phase=finish), never on the server.
 */
const RANK: Record<string, number> = { "On a call": 0, "Wrapping up": 1, Away: 2, Ready: 3 };

export function managerRows(members: readonly FloorMember[], selfId: string | null | undefined, now: number): FloorRow[] {
  return floorRows(members, selfId, now).sort((a, b) => (RANK[a.chip.label] ?? 2) - (RANK[b.chip.label] ?? 2) || a.name.localeCompare(b.name));
}
