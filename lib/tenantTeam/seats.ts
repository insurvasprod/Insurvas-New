/**
 * The one seat rule (user decision, admin tenant record › Users & seats).
 *
 * A seat is held by a membership whose person is active, suspended, or invited and not accepted yet.
 * Inactive / deactivated (two spellings of one state, migration 20260912340000) and deleted people do
 * not hold one. The database applies the same rule through `public.user_status_holds_seat` and
 * `public.tenant_seats_used` (migration 20260924346000); keep the two lists identical.
 *
 * Plain module, no `server-only`: the admin record's frame chip, the tab and the agent app's team
 * screen all count with it, on either side of the client boundary.
 */

/** users.status values that hold a seat. `pending_verification` is this app's spelling of "invited". */
export const SEAT_HOLDING_STATUSES = ["active", "suspended", "invited", "pending_verification"] as const;

const HOLDING = new Set<string>(SEAT_HOLDING_STATUSES);
const INVITED_STATUSES = new Set(["invited", "pending_verification"]);

export function statusHoldsSeat(status: string | null | undefined): boolean {
  return typeof status === "string" && HOLDING.has(status);
}

/** The fields the rule needs. `acceptedAt` is tenant_users.accepted_at (null = never accepted). */
export type SeatMember = { status: string | null | undefined; acceptedAt?: string | null };

export function heldSeat(member: SeatMember): boolean {
  return statusHoldsSeat(member.status);
}

export type SeatState = "active" | "suspended" | "invited";

/**
 * Which kind of seat a member holds, or null when they hold none. Invited means not accepted yet:
 * an invited status, or a membership that was never accepted.
 */
export function seatState(member: SeatMember): SeatState | null {
  if (!heldSeat(member)) return null;
  if (member.status === "suspended") return "suspended";
  if (INVITED_STATUSES.has(member.status ?? "") || !member.acceptedAt) return "invited";
  return "active";
}

export type SeatCounts = { held: number; active: number; suspended: number; invited: number };

export function seatCounts(members: readonly SeatMember[]): SeatCounts {
  const counts: SeatCounts = { held: 0, active: 0, suspended: 0, invited: 0 };
  for (const member of members) {
    const state = seatState(member);
    if (!state) continue;
    counts.held += 1;
    counts[state] += 1;
  }
  return counts;
}

/**
 * The seat limit a plan implies. An individual plan with no explicit `max_seats` is one seat — the
 * same fallback the entitlement engine applies (refresh_tenant_entitlement, 20260913330000). Null is
 * "no limit".
 */
export function seatLimitFor(maxSeats: number | null | undefined, planType: string | null | undefined): number | null {
  if (typeof maxSeats === "number") return maxSeats;
  return planType === "individual" ? 1 : null;
}

/** "12 of 12 seats", "3 seats · no limit". */
export function seatsLabel(held: number, max: number | null): string {
  return max === null ? `${held} seat${held === 1 ? "" : "s"} · no limit` : `${held} of ${max} seats`;
}
