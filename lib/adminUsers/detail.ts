import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tenantSessionCookieOptions } from "@/lib/tenantAuth/session";
import { partnerSessionCookieOptions } from "@/lib/partnerAuth/session";

/**
 * Reads for the admin user record (/admin/users/[id], board p-adm-user-detail). Read-only: every
 * change to a user still goes through the existing /api/admin/users/[id]/* routes.
 */

export type UserMembership = { tenantId: string; tenantName: string | null; role: string | null };

export type UserDetail = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  hasPassword: boolean;
  /** Any tenant_users row with accepted_at set. */
  acceptedMembership: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  distinctIps24h: number;
  planCode: string | null;
  /** Every agency the person belongs to. The directory view has one row per membership. */
  memberships: UserMembership[];
};

type ViewRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_role: string | null;
  plan_code: string | null;
  last_login_at: string | null;
  created_at: string | null;
  has_password: boolean | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  distinct_ips_24h: number | null;
};

/**
 * One person from the admin directory view. The view left-joins tenant_users, so somebody in two
 * agencies is two rows; the page used `.maybeSingle()`, which errors on that and would have shown a
 * failed read. Rows are folded into one person with a membership list instead.
 *
 * Throws when the read fails (a failed read must not look like a deleted user); null when absent.
 */
export async function fetchUserDetail(userId: string): Promise<UserDetail | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("admin_user_list")
    .select(
      "id, name, email, phone, status, tenant_id, tenant_name, tenant_role, plan_code, last_login_at, created_at, has_password, suspended_at, suspension_reason, distinct_ips_24h",
    )
    .eq("id", userId)
    .limit(20);

  if (error) throw new Error(`Could not load this user: ${error.message}`);
  const rows = (data ?? []) as ViewRow[];
  if (!rows.length) return null;

  // Whether they have joined any agency — with the hash, this decides reset vs invitation
  // (lib/adminUsers/credential.ts). A failed read counts as not joined: the route re-checks.
  const accepted = await supabase
    .from("tenant_users")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("accepted_at", "is", null);

  const first = rows[0];
  const memberships: UserMembership[] = [];
  for (const row of rows) {
    if (row.tenant_id && !memberships.some((m) => m.tenantId === row.tenant_id)) {
      memberships.push({ tenantId: row.tenant_id, tenantName: row.tenant_name, role: row.tenant_role });
    }
  }

  return {
    id: first.id,
    name: first.name,
    email: first.email,
    phone: first.phone,
    status: first.status ?? "",
    hasPassword: first.has_password !== false,
    acceptedMembership: !accepted.error && (accepted.count ?? 0) > 0,
    createdAt: first.created_at,
    lastLoginAt: first.last_login_at,
    suspendedAt: first.suspended_at,
    suspensionReason: first.suspension_reason,
    distinctIps24h: Number(first.distinct_ips_24h ?? 0),
    planCode: rows.find((row) => row.plan_code)?.plan_code ?? null,
    memberships,
  };
}

export type UserSuspensionRecord = { ts: string; actorName: string | null; reason: string | null };

/**
 * Who suspended this person and when: the newest `user.suspended` audit row. Null when there is
 * none or the log cannot be read — the card then falls back to the date on the user row, and the
 * reason (which lives on the user row) is still shown.
 */
export async function fetchLatestUserSuspension(userId: string): Promise<UserSuspensionRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("ts, actor_type, actor_id, reason")
    .eq("target_id", userId)
    .eq("action", "user.suspended")
    .order("ts", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;

  const row = data[0] as { ts: string; actor_type: string; actor_id: string | null; reason: string | null };
  let actorName: string | null = null;
  if (row.actor_type === "admin" && row.actor_id) {
    const admin = await supabase.from("admin_users").select("name").eq("id", row.actor_id).maybeSingle<{ name: string }>();
    actorName = admin.data?.name ?? null;
  }
  return { ts: row.ts, actorName, reason: row.reason };
}

export const USER_AUDIT_PAGE_SIZE = 25;

export type UserAuditRow = {
  id: string;
  ts: string;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  reason: string | null;
};

/**
 * What has been done to this person, newest first: audit rows whose target is this user — staff
 * actions (suspend, reset link, role edit…) and agency-side ones (an owner inviting them or changing
 * their role). Everyone who can open the user sees it, matching the tenant record's Activity tab.
 * Throws when the log cannot be read.
 */
export async function fetchUserAuditPage(
  userId: string,
  page: number,
): Promise<{ rows: UserAuditRow[]; total: number }> {
  const supabase = getSupabaseServiceClient();
  const from = (page - 1) * USER_AUDIT_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("audit_log")
    .select("id, ts, actor_type, actor_id, action, reason", { count: "exact" })
    .eq("target_type", "user")
    .eq("target_id", userId)
    .order("ts", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + USER_AUDIT_PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load this user's audit trail: ${error.message}`);

  const raw = (data ?? []) as {
    id: string;
    ts: string;
    actor_type: string;
    actor_id: string | null;
    action: string;
    reason: string | null;
  }[];

  // Names for the actors on this page only: staff from admin_users, agency people from users.
  const adminIds = [...new Set(raw.filter((r) => r.actor_type === "admin" && r.actor_id).map((r) => r.actor_id!))];
  const personIds = [...new Set(raw.filter((r) => r.actor_type === "tenant" && r.actor_id).map((r) => r.actor_id!))];
  const [admins, people] = await Promise.all([
    adminIds.length ? supabase.from("admin_users").select("id, name").in("id", adminIds) : null,
    personIds.length ? supabase.from("users").select("id, name").in("id", personIds) : null,
  ]);
  const names = new Map<string, string>();
  for (const row of ((admins?.data ?? []) as { id: string; name: string | null }[])) if (row.name) names.set(`admin:${row.id}`, row.name);
  for (const row of ((people?.data ?? []) as { id: string; name: string | null }[])) if (row.name) names.set(`tenant:${row.id}`, row.name);

  return {
    rows: raw.map((row) => ({
      id: row.id,
      ts: row.ts,
      actorType: row.actor_type,
      actorId: row.actor_id,
      actorName: row.actor_id ? (names.get(`${row.actor_type}:${row.actor_id}`) ?? null) : null,
      action: row.action,
      reason: row.reason,
    })),
    total: count ?? 0,
  };
}

/**
 * How long a sign-in lasts. Agent and partner sessions are both signed cookies with a fixed expiry
 * (12 hours today); read from the cookie options so this cannot drift from what the login routes set.
 */
export const SESSION_WINDOW_SECONDS = Math.max(
  tenantSessionCookieOptions.maxAge,
  partnerSessionCookieOptions.maxAge,
);

export type RecentSignIn = { id: string; ts: string; ip: string | null; userAgent: string | null; expiresAt: string };

/**
 * Successful sign-ins recent enough that the session they started may not have expired yet.
 *
 * The product keeps no list of open sessions: a session is a signed cookie, signing out only clears
 * it in that browser, and a status or role change ends every one of them at once. So this is the
 * honest answer to "could this person still be signed in somewhere?" — not a live session list.
 */
export async function fetchRecentSignIns(userId: string, now: Date): Promise<RecentSignIn[]> {
  const supabase = getSupabaseServiceClient();
  const cutoff = new Date(now.getTime() - SESSION_WINDOW_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from("login_events")
    .select("id, ts, ip, user_agent")
    .eq("user_id", userId)
    .eq("actor_type", "user")
    .eq("success", true)
    .gte("ts", cutoff)
    .order("ts", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not load recent sign-ins: ${error.message}`);

  return ((data ?? []) as { id: string; ts: string; ip: string | null; user_agent: string | null }[]).map((row) => ({
    id: row.id,
    ts: row.ts,
    ip: row.ip,
    userAgent: row.user_agent,
    expiresAt: new Date(new Date(row.ts).getTime() + SESSION_WINDOW_SECONDS * 1000).toISOString(),
  }));
}
