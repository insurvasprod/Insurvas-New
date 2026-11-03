/**
 * Admin › Users list: shapes shared by the loader, GET /api/admin/users and the client island.
 * Plain module (no server-only).
 */
import type { UserLifecycle } from "./lifecycle.ts";

export type UsersListRow = {
  id: string;
  name: string;
  email: string;
  /** Seeds the Edit user dialog, whose save sends the whole form. */
  phone: string | null;
  /** users.status, verbatim — account-wide, not per tenant. */
  status: string;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_role: string | null;
  plan_code: string | null;
  last_login_at: string | null;
  created_at: string;
  /** users.password_hash is set. With accepted_at this decides reset vs invitation (lib/adminUsers/credential.ts). */
  has_password: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  /** Distinct IPs with a successful login in the last 24h — the shared-account signal. */
  distinct_ips_24h: number | null;
  /** tenant_users.accepted_at for this row's tenant. */
  accepted_at: string | null;
  invited_at: string | null;
  /** By the one seat rule; null for a status this screen does not model. */
  lifecycle: UserLifecycle | null;
};

export type UsersListStats = {
  /** Rows the list shows with no filter: one per person per tenant, one per person in no tenant. */
  rows: number;
  /** Distinct tenants those rows belong to. */
  tenants: number;
  /** Rows for people who belong to no tenant. */
  tenantless: number;
  active: number;
  invited: number;
  /** Invited rows whose invitation is older than STALE_INVITE_DAYS. */
  invitedStale: number;
  suspended: number;
  /** Suspended rows with no recorded reason. */
  suspendedNoReason: number;
  deactivated: number;
};

export type UsersListPage = { users: UsersListRow[]; total: number };
