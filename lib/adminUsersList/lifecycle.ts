/**
 * Admin › Users: the four lifecycle states a row can be in, by the one seat rule.
 *
 * Plain module (no server-only): the list's client island, its API route and the server loader all
 * use it, so the chip, the filter and the tiles say the same thing.
 *
 * A row is one person in one tenant (or one person in no tenant). With a membership, the state is
 * the seat they hold there — `seatState` from lib/tenantTeam/seats.ts, the same call the tenant
 * record's Users & seats tab makes — so an active person whose membership was never accepted is
 * Invited here too. Without a membership there is no seat, and the account-wide status decides.
 * Inactive and deactivated (two spellings of one state) are Deactivated. Deleted people are not
 * listed at all.
 *
 * Mirrored in SQL by the `lifecycle` column of public.admin_user_directory (20260925500000).
 */
import { seatState } from "../tenantTeam/seats.ts";

export const USER_LIFECYCLES = ["active", "invited", "suspended", "deactivated"] as const;
export type UserLifecycle = (typeof USER_LIFECYCLES)[number];

export const USER_LIFECYCLE_LABELS: Record<UserLifecycle, string> = {
  active: "Active",
  invited: "Invited",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

/** users.status values behind each state, for filtering rows that have no membership. */
export const LIFECYCLE_STATUSES: Record<UserLifecycle, readonly string[]> = {
  active: ["active"],
  invited: ["invited", "pending_verification"],
  suspended: ["suspended"],
  deactivated: ["inactive", "deactivated"],
};

export type LifecycleInput = {
  status: string | null | undefined;
  /** Null when the person belongs to no tenant. */
  tenantId: string | null | undefined;
  /** tenant_users.accepted_at for this row's tenant (null = never accepted). */
  acceptedAt: string | null | undefined;
};

/** The row's state, or null for a status this screen does not model (deleted, or unknown). */
export function lifecycleOf(row: LifecycleInput): UserLifecycle | null {
  const status = row.status ?? "";
  if (LIFECYCLE_STATUSES.deactivated.includes(status)) return "deactivated";
  if (row.tenantId) {
    const seat = seatState({ status, acceptedAt: row.acceptedAt ?? null });
    if (seat) return seat;
    return null;
  }
  if (LIFECYCLE_STATUSES.suspended.includes(status)) return "suspended";
  if (LIFECYCLE_STATUSES.invited.includes(status)) return "invited";
  if (LIFECYCLE_STATUSES.active.includes(status)) return "active";
  return null;
}

export function isUserLifecycle(value: unknown): value is UserLifecycle {
  return typeof value === "string" && (USER_LIFECYCLES as readonly string[]).includes(value);
}

/**
 * Four states, four visibly different chips: green, teal, red, grey. Deactivated is grey rather
 * than red because nothing is wrong with it — access was ended on purpose.
 */
export type LifecycleTone = "success" | "info" | "error" | "neutral";
export const LIFECYCLE_TONES: Record<UserLifecycle, LifecycleTone> = {
  active: "success",
  invited: "info",
  suspended: "error",
  deactivated: "neutral",
};

/** An invitation older than this is called out in the Invited tile. */
export const STALE_INVITE_DAYS = 7;
