/**
 * Admin tenant record › Users & seats — shapes shared by the server loader, the API routes and the
 * client island. Plain module (no server-only): the island imports it.
 */
import type { TenantRole } from "@/lib/tenantAuth/roles";
import type { SeatCounts, SeatState } from "@/lib/tenantTeam/seats";

export type AdminTenantMember = {
  id: string;
  name: string;
  email: string;
  /** users.status, verbatim — account-wide, not per tenant. */
  status: string;
  role: TenantRole;
  invitedAt: string;
  acceptedAt: string | null;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  /** The newest unaccepted invitation's expiry, for someone who has not accepted. */
  inviteExpiresAt: string | null;
  /** Null until migration 20260924346100 is applied. */
  signIns30d: number | null;
  /** Which kind of seat they hold, or null for none (the one seat rule). */
  seat: SeatState | null;
  /** Not accepted, so an owner or staff can withdraw the invitation. */
  revocable: boolean;
  /** Revocable, and its invitation has expired. */
  stale: boolean;
};

export type AdminTenantUsers = {
  members: AdminTenantMember[];
  seats: SeatCounts & { max: number | null };
  /** False until migration 20260924220400 is applied: "Last seen" is then the last sign-in. */
  presenceRecorded: boolean;
  /** False until migration 20260924346100 is applied. */
  signInsAvailable: boolean;
  /** Milliseconds since epoch the page was read at, so the island's relative times match the server. */
  readAt: number;
};

/** The body a revoke-stale request carries: the count the confirmation showed. */
export type RevokeStaleInvitesBody = { expected: number };
