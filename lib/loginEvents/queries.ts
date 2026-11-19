import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getSetting } from "@/lib/settings/queries";
import { activeLockoutEmails, type LockoutRow } from "@/lib/adminDashboard/figures";
import { ACTIVITY_PAGE_SIZE, type LoginEventRow } from "./constants";
import {
  DEFAULT_ACTIVITY_FILTERS,
  REPEATED_FAILURE_MIN,
  ilikeContains,
  rangeStart,
  repeatedFailures,
  type ActivityFilters,
  type ActivityLens,
} from "./present";
import { lockoutEntry, sortLockouts, type LockoutEntry } from "./lockouts";

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
 *
 * `includeStaff` decides whether staff (actor_type = 'admin') sign-ins are in it at all. They carry
 * staff email addresses and IPs, which are security data: only super_admin sees them. Every other
 * role reading this page (support_agent, billing_admin) gets tenant-user sign-ins only, and the
 * counts — "of N" included — are taken over the same rows, so nothing about staff leaks through a
 * total either. Callers pass `staffLoginsVisibleTo(role)`.
 */
export async function fetchLoginActivityPage(options: {
  page: number;
  filters: ActivityFilters;
  includeStaff: boolean;
  /** "repeated" keeps only failures from an address that failed REPEATED_FAILURE_MIN times in the range. */
  lens?: ActivityLens;
  now?: number;
}): Promise<LoginActivityPage> {
  const supabase = getSupabaseServiceClient();
  const { filters } = options;
  const now = options.now ?? Date.now();
  const since = rangeStart(filters.range, now);

  let inRange = supabase.from("login_events").select("id", { count: "exact", head: true });
  if (!options.includeStaff) {
    inRange = inRange.eq("actor_type", "user");
  }
  if (since) {
    inRange = inRange.gte("ts", since.toISOString());
  }

  const ips = options.lens === "repeated" ? await repeatedFailureIps(filters, options.includeStaff, now) : null;
  if (ips && ips.length === 0) {
    const range = await inRange;
    if (range.error) throw new Error(`Could not count login activity: ${range.error.message}`);
    return { events: [], total: 0, rangeTotal: range.count ?? 0 };
  }

  const request = feedQuery(filters, options.includeStaff, now, ips, true);
  const from = (Math.max(1, options.page) - 1) * ACTIVITY_PAGE_SIZE;
  const [page, range] = await Promise.all([request.range(from, from + ACTIVITY_PAGE_SIZE - 1), inRange]);
  // A broken query must not render as a platform where nobody has ever logged in.
  if (page.error) throw new Error(`Could not load login activity: ${page.error.message}`);
  if (range.error) throw new Error(`Could not count login activity: ${range.error.message}`);

  return { events: (page.data ?? []) as LoginEventRow[], total: page.count ?? 0, rangeTotal: range.count ?? 0 };
}

/**
 * The feed's filtered query, newest first. `ips` narrows it to failures from those addresses (the Repeated failures
 * lens). The staff rule is applied here, so the page, the export and the counts all read the same rows.
 */
function feedQuery(filters: ActivityFilters, includeStaff: boolean, now: number, ips: string[] | null, counted: boolean) {
  const since = rangeStart(filters.range, now);
  let request = getSupabaseServiceClient()
    .from("login_events")
    .select(LOGIN_EVENT_COLUMNS, counted ? { count: "exact" } : undefined)
    .order("ts", { ascending: false })
    .order("id", { ascending: false });
  if (!includeStaff) request = request.eq("actor_type", "user");
  if (since) request = request.gte("ts", since.toISOString());
  if (filters.outcome === "success") request = request.eq("success", true);
  if (filters.outcome === "failure") request = request.eq("success", false);
  if (filters.actor !== "all") request = request.eq("actor_type", filters.actor);
  if (filters.q) {
    const pattern = ilikeContains(filters.q);
    request = request.or(`email.ilike."${pattern}",ip.ilike."${pattern}"`);
  }
  if (ips) request = request.eq("success", false).in("ip", ips);
  return request;
}

const FAILURE_PAGE = 1000;
const FAILURE_CAP = 10_000;

export type FailedAttempt = { ip: string | null; email: string; success: boolean; ts: string };

/**
 * Every failed attempt since `sinceIso` (address, account, time), paged under PostgREST's row cap, for the
 * Repeated failures rule. Staff failures only for a role that may see staff sign-ins.
 */
export async function fetchFailedAttempts(sinceIso: string | null, includeStaff: boolean, actor: ActivityFilters["actor"] = "all"): Promise<FailedAttempt[]> {
  const out: FailedAttempt[] = [];
  for (let from = 0; from < FAILURE_CAP; from += FAILURE_PAGE) {
    let query = getSupabaseServiceClient().from("login_events").select("ip, email, ts").eq("success", false);
    if (!includeStaff) query = query.eq("actor_type", "user");
    if (actor !== "all") query = query.eq("actor_type", actor);
    if (sinceIso) query = query.gte("ts", sinceIso);
    const { data, error } = await query.order("ts", { ascending: false }).order("id", { ascending: false }).range(from, from + FAILURE_PAGE - 1);
    if (error) throw new Error(`Could not load failed sign-ins: ${error.message}`);
    const rows = (data ?? []) as { ip: string | null; email: string; ts: string }[];
    for (const row of rows) out.push({ ip: row.ip, email: row.email, ts: row.ts, success: false });
    if (rows.length < FAILURE_PAGE) break;
  }
  return out;
}

/** The addresses the Repeated failures lens keeps, for the range and actor on screen. */
async function repeatedFailureIps(filters: ActivityFilters, includeStaff: boolean, now: number): Promise<string[]> {
  const since = rangeStart(filters.range, now);
  const failures = await fetchFailedAttempts(since ? since.toISOString() : null, includeStaff, filters.actor);
  return repeatedFailures(failures, REPEATED_FAILURE_MIN).map((entry) => entry.ip);
}

/** How many addresses the Repeated failures lens holds for this range: the tab's count. */
export async function countRepeatedFailureIps(range: ActivityFilters["range"], includeStaff: boolean, now = Date.now()): Promise<number> {
  return (await repeatedFailureIps({ ...DEFAULT_ACTIVITY_FILTERS, range }, includeStaff, now)).length;
}

/** Failed attempts in the range (the Failed tab's count), with the staff rule applied. */
export async function countFailedAttempts(range: ActivityFilters["range"], includeStaff: boolean, now = Date.now()): Promise<number> {
  const { count, error } = await feedQuery({ ...DEFAULT_ACTIVITY_FILTERS, range, outcome: "failure" }, includeStaff, now, null, true).limit(1);
  if (error) throw new Error(`Could not count failed sign-ins: ${error.message}`);
  return count ?? 0;
}

export const EXPORT_CAP = 5000;

/** The rows Export CSV writes: every filter on screen, newest first, at most EXPORT_CAP. */
export async function fetchLoginActivityExport(options: { filters: ActivityFilters; lens: ActivityLens; includeStaff: boolean; now?: number }): Promise<{ events: LoginEventRow[]; capped: boolean }> {
  const now = options.now ?? Date.now();
  const ips = options.lens === "repeated" ? await repeatedFailureIps(options.filters, options.includeStaff, now) : null;
  if (ips && ips.length === 0) return { events: [], capped: false };
  const events: LoginEventRow[] = [];
  for (let from = 0; from < EXPORT_CAP; from += FAILURE_PAGE) {
    const { data, error } = await feedQuery(options.filters, options.includeStaff, now, ips, false).range(from, Math.min(from + FAILURE_PAGE, EXPORT_CAP) - 1);
    if (error) throw new Error(`Could not export login activity: ${error.message}`);
    const rows = (data ?? []) as LoginEventRow[];
    events.push(...rows);
    if (rows.length < FAILURE_PAGE) return { events, capped: false };
  }
  return { events, capped: true };
}

/* ── One attempt (the sheet) ─────────────────────────────────────────────── */

export type AttemptDetail = {
  event: LoginEventRow;
  /** Attempts from the same address in the 24 hours up to this one (and after it, up to now), newest first. */
  sameIp: LoginEventRow[];
  /** Attempts on the same account in the same 24 hours. */
  sameAccount: LoginEventRow[];
  /** The customer's workspace name, for "Account". */
  tenantName: string | null;
};

const RELATED_SHOWN = 20;

/**
 * One attempt with what else came from its address and its account in the 24 hours before it. Null when it does
 * not exist or is a staff sign-in the role may not see — the same answer, so the route cannot confirm a staff row.
 */
export async function fetchAttemptDetail(id: string, includeStaff: boolean): Promise<AttemptDetail | null> {
  const supabase = getSupabaseServiceClient();
  let lookup = supabase.from("login_events").select(LOGIN_EVENT_COLUMNS).eq("id", id);
  if (!includeStaff) lookup = lookup.eq("actor_type", "user");
  const { data, error } = await lookup.maybeSingle();
  if (error) throw new Error(`Could not load the attempt: ${error.message}`);
  if (!data) return null;
  const event = data as LoginEventRow;

  const from = new Date(Date.parse(event.ts) - 24 * 60 * 60 * 1000).toISOString();
  const related = (column: "ip" | "email", value: string) => {
    let query = supabase.from("login_events").select(LOGIN_EVENT_COLUMNS).eq(column, value).gte("ts", from).neq("id", event.id);
    if (!includeStaff) query = query.eq("actor_type", "user");
    return query.order("ts", { ascending: false }).limit(RELATED_SHOWN);
  };
  const [byIp, byAccount, member] = await Promise.all([
    event.ip ? related("ip", event.ip) : Promise.resolve({ data: [], error: null }),
    related("email", event.email),
    event.user_id
      ? supabase.from("tenant_users").select("tenants(name)").eq("user_id", event.user_id).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (byIp.error) throw new Error(`Could not load attempts from the same address: ${byIp.error.message}`);
  if (byAccount.error) throw new Error(`Could not load attempts on the same account: ${byAccount.error.message}`);
  const tenant = (member.data as { tenants?: { name?: string } | { name?: string }[] | null } | null)?.tenants;
  const tenantName = Array.isArray(tenant) ? tenant[0]?.name ?? null : tenant?.name ?? null;
  return { event, sameIp: (byIp.data ?? []) as LoginEventRow[], sameAccount: (byAccount.data ?? []) as LoginEventRow[], tenantName };
}

/* ── Lockouts and staff sign-ins (super admin) ───────────────────────────── */

/**
 * Every sign-in lockout key in the rate-limit store, in words, locked first — the rows the Lockouts page lists and
 * GET /api/admin/security/rate-limits returns. Security state: callers are super admin only.
 */
export async function fetchLockouts(now = Date.now()): Promise<LockoutEntry[]> {
  const [threshold, minutes] = await Promise.all([
    getSetting<number>("security.lockout_threshold"),
    getSetting<number>("security.lockout_minutes"),
  ]);
  const { data, error } = await getSupabaseServiceClient()
    .from("rate_limits")
    .select("bucket_key, hits, window_start")
    .like("bucket_key", "login_lockout:%")
    .order("window_start", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load sign-in lockouts: ${error.message}`);
  const entries = ((data ?? []) as { bucket_key: string; hits: number; window_start: string }[])
    .map((row) => lockoutEntry(row, { threshold, minutes, now }))
    .filter((entry): entry is LockoutEntry => entry !== null);
  return sortLockouts(entries);
}

export type StaffSignIn = { ts: string; ip: string | null; userAgent: string | null };

/** Each staff member's last successful sign-in from the login events. Security data: super admin only. */
export async function fetchStaffLastSignIns(adminIds: readonly string[]): Promise<Map<string, StaffSignIn>> {
  const supabase = getSupabaseServiceClient();
  const reads = await Promise.all(
    adminIds.map((id) =>
      supabase
        .from("login_events")
        .select("ts, ip, user_agent")
        .eq("actor_type", "admin")
        .eq("admin_id", id)
        .eq("success", true)
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  );
  const out = new Map<string, StaffSignIn>();
  reads.forEach((read, index) => {
    if (read.error) throw new Error(`Could not load staff sign-ins: ${read.error.message}`);
    const row = read.data as { ts: string; ip: string | null; user_agent: string | null } | null;
    if (row) out.set(adminIds[index], { ts: row.ts, ip: row.ip, userAgent: row.user_agent });
  });
  return out;
}
