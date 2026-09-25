import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getSetting } from "@/lib/settings/queries";
import { activeLockoutEmails, type LockoutRow } from "@/lib/adminDashboard/figures";
import { ACTIVITY_PAGE_SIZE, type LoginEventRow } from "./constants";
import { ilikeContains, rangeStart, type ActivityFilters } from "./present";

// Re-exported for server-side callers' convenience. Client components must import these from
// ./constants directly — importing them from here would drag `server-only` into the browser
// bundle and fail the build.
export { ACTIVITY_PAGE_SIZE, type LoginEventRow };

export type LoginActivityStats = {
  logins_today: number;
  logins_this_week: number;
  failed_today: number;
  active_last_15_min: number;
  /**
   * Successful sign-ins from the start of last week up to this moment a week ago. Null until
   * 20260924351000 (admin_login_activity_stats_v2) is applied — the tile then says "since Monday".
   */
  logins_last_week_to_date: number | null;
};

const LOGIN_EVENT_COLUMNS = "id, actor_type, user_id, admin_id, email, ts, ip, user_agent, success, failure_reason";

/** A function this code expects but the database does not have yet (migration not applied). */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ["42883", "PGRST202"].includes(error.code ?? "") || /could not find the function/i.test(error.message ?? "");
}

/**
 * PostgREST's `or=` filter is a comma/paren-delimited mini-language, so an unquoted value
 * containing those characters would corrupt the filter. Same guard as the users list.
 */
function escapeForOrFilter(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Last N attempts for one tenant user — successes and failures both (SA-1.5).
 *
 * Matches on the email as well as the id, and that is the whole point. A wrong-password attempt is
 * rejected by Supabase Auth **before** the route learns which user was meant, so it is recorded
 * with `email` set and `user_id` NULL — 175 of 374 rows on 2026-09-21, 145 of them failures.
 * Filtering on `user_id` alone therefore hid every failed password attempt from the one screen an
 * admin opens to ask "is somebody trying to get into this account?", which is SA-1.5's stated
 * purpose. The criterion asks for failures to be recorded **and visible**; they were only recorded.
 */
export async function fetchUserLoginEvents(
  userId: string,
  email: string | null,
  limit = 50,
): Promise<LoginEventRow[]> {
  const supabase = getSupabaseServiceClient();
  let request = supabase
    .from("login_events")
    .select("id, actor_type, user_id, admin_id, email, ts, ip, user_agent, success, failure_reason");

  request = email
    ? request.or(`user_id.eq.${userId},email.eq."${escapeForOrFilter(email)}"`)
    : request.eq("user_id", userId);

  const { data, error } = await request.order("ts", { ascending: false }).limit(limit);

  // An empty list on this tab means "never signed in", which is a real and useful answer. A failed
  // query must not borrow it.
  if (error) throw new Error(`Could not load login activity: ${error.message}`);

  return (data ?? []) as LoginEventRow[];
}

const ZERO_STATS: LoginActivityStats = {
  logins_today: 0,
  logins_this_week: 0,
  failed_today: 0,
  active_last_15_min: 0,
  logins_last_week_to_date: null,
};

/**
 * The Login activity tiles. v2 (20260924351000) adds last week's figure for the comparison; until
 * it is applied this reads v1, whose four figures are the same, and the comparison is left out.
 *
 * `active_last_15_min` counts distinct tenant USERS only — v1 as it is live and v2 both count
 * `user_id`, so staff sign-ins are not in it (checked against the live definition 2026-09-24).
 */
export async function fetchLoginActivityStats(): Promise<LoginActivityStats> {
  const supabase = getSupabaseServiceClient();

  const v2 = await supabase.rpc("admin_login_activity_stats_v2" as never);
  if (!v2.error) {
    const row = (Array.isArray(v2.data) ? v2.data[0] : v2.data) as LoginActivityStats | null;
    return row ?? ZERO_STATS;
  }
  if (!isMissingFunction(v2.error)) throw new Error(`Could not load login activity stats: ${v2.error.message}`);

  const { data, error } = await supabase.rpc("admin_login_activity_stats");
  if (error) throw new Error(`Could not load login activity stats: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Omit<LoginActivityStats, "logins_last_week_to_date"> | null;
  return row ? { ...row, logins_last_week_to_date: null } : ZERO_STATS;
}

/**
 * Distinct email addresses locked out of signing in right now — the rule sign-in applies
 * (lib/authProtection) and the dashboard counts the same way (lib/adminDashboard/figures).
 * Security-sensitive: callers show it to super_admin only.
 */
export async function fetchActiveLockoutEmails(now = Date.now()): Promise<number> {
  const [threshold, lockoutMinutes] = await Promise.all([
    getSetting<number>("security.lockout_threshold"),
    getSetting<number>("security.lockout_minutes"),
  ]);
  const { data, error } = await getSupabaseServiceClient()
    .from("rate_limits")
    .select("bucket_key, hits, window_start")
    .like("bucket_key", "login_lockout:%")
    .gte("hits", threshold)
    .gt("window_start", new Date(now - lockoutMinutes * 60_000).toISOString());
  if (error) throw new Error(`Could not load sign-in lockouts: ${error.message}`);
  return activeLockoutEmails((data ?? []) as LockoutRow[], threshold, lockoutMinutes, now);
}

export type LoginActivityPage = {
  events: LoginEventRow[];
  /** Attempts matching every filter. */
  total: number;
  /** Every attempt in the selected range, whatever the other filters say — the count line's "of N". */
  rangeTotal: number;
};

/**
 * Platform-wide feed. Always paginated — this table is the fastest-growing one in the schema.
 * Newest first, with the id as a tie-break so two attempts in the same instant cannot swap pages.
 */
export async function fetchLoginActivityPage(options: {
  page: number;
  filters: ActivityFilters;
  now?: number;
}): Promise<LoginActivityPage> {
  const supabase = getSupabaseServiceClient();
  const { filters } = options;
  const since = rangeStart(filters.range, options.now ?? Date.now());

  let request = supabase
    .from("login_events")
    .select(LOGIN_EVENT_COLUMNS, { count: "exact" })
    .order("ts", { ascending: false })
    .order("id", { ascending: false });
  let inRange = supabase.from("login_events").select("id", { count: "exact", head: true });

  if (since) {
    request = request.gte("ts", since.toISOString());
    inRange = inRange.gte("ts", since.toISOString());
  }
  if (filters.outcome === "success") request = request.eq("success", true);
  if (filters.outcome === "failure") request = request.eq("success", false);
  if (filters.actor !== "all") request = request.eq("actor_type", filters.actor);
  if (filters.q) {
    const pattern = ilikeContains(filters.q);
    request = request.or(`email.ilike."${pattern}",ip.ilike."${pattern}"`);
  }

  const from = (Math.max(1, options.page) - 1) * ACTIVITY_PAGE_SIZE;
  const [page, range] = await Promise.all([request.range(from, from + ACTIVITY_PAGE_SIZE - 1), inRange]);
  // A broken query must not render as a platform where nobody has ever logged in.
  if (page.error) throw new Error(`Could not load login activity: ${page.error.message}`);
  if (range.error) throw new Error(`Could not count login activity: ${range.error.message}`);

  return { events: (page.data ?? []) as LoginEventRow[], total: page.count ?? 0, rangeTotal: range.count ?? 0 };
}
