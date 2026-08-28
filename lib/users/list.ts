import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { USERS_PAGE_SIZE } from "./constants";
import type { UserStatus } from "./constants";
import type { UsersQuery } from "./query";
import type { Database } from "@/lib/supabase/database.types";

export type UserListRow = {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_role: Database["public"]["Enums"]["tenant_user_role"] | null;
  plan_code: string | null;
  last_login_at: string | null;
  created_at: string;
  /** False = invited but hasn't set a password yet, so Resend invitation applies (SA-1.2). */
  has_password: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  /** Distinct IPs with a successful login in the last 24h — the shared-account signal (SA-1.5). */
  distinct_ips_24h: number | null;
};

export type UserStats = {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  signed_up_this_month: number;
};

/**
 * PostgREST's `or=` filter is a comma/paren-delimited mini-language, so a raw search term
 * containing those characters would corrupt the filter. Quoting the value neutralises them;
 * the backslash and double-quote escapes keep the quoting itself intact.
 */
function escapeForOrFilter(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function fetchUsersPage(
  query: UsersQuery,
): Promise<{ users: UserListRow[]; total: number }> {
  const supabase = getSupabaseServiceClient();

  let request = supabase
    .from("admin_user_list")
    .select(
      "id, name, email, status, tenant_id, tenant_name, tenant_role, plan_code, last_login_at, created_at, has_password, suspended_at, suspension_reason, distinct_ips_24h",
      { count: "exact" },
    )
    // 'deleted' never appears on this screen — the ticket's status filter is
    // active/inactive/suspended, and deleted-user handling belongs to SA-1.4.
    .neq("status", "deleted");

  if (query.q) {
    const term = escapeForOrFilter(query.q);
    request = request.or(`name.ilike."%${term}%",email.ilike."%${term}%"`);
  }
  if (query.status) request = request.eq("status", query.status);
  if (query.plan) request = request.eq("plan_code", query.plan);
  if (query.signupFrom) request = request.gte("created_at", `${query.signupFrom}T00:00:00Z`);
  if (query.signupTo) request = request.lte("created_at", `${query.signupTo}T23:59:59.999Z`);
  if (query.lastLoginFrom) request = request.gte("last_login_at", `${query.lastLoginFrom}T00:00:00Z`);
  if (query.lastLoginTo) request = request.lte("last_login_at", `${query.lastLoginTo}T23:59:59.999Z`);

  const from = (query.page - 1) * USERS_PAGE_SIZE;

  const { data, error, count } = await request
    .order(query.sort, { ascending: query.dir === "asc", nullsFirst: false })
    // Without a unique tiebreaker, rows with equal sort values can shuffle between pages.
    .order("id", { ascending: true })
    .range(from, from + USERS_PAGE_SIZE - 1);

  if (error) throw new Error(`Could not load users: ${error.message}`);

  return { users: (data ?? []) as UserListRow[], total: count ?? 0 };
}

export async function fetchUserStats(): Promise<UserStats> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("admin_user_stats");

  if (error) throw new Error(`Could not load user stats: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? { total: 0, active: 0, inactive: 0, suspended: 0, signed_up_this_month: 0 }) as UserStats;
}

/** Distinct plan codes actually in use, for the plan filter's options. Empty until SA-2 ships plans. */
export async function fetchPlanCodes(): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("tenants").select("plan_code").not("plan_code", "is", null);

  const codes = new Set((data ?? []).map((row) => row.plan_code).filter((c): c is string => Boolean(c)));
  return [...codes].sort();
}
