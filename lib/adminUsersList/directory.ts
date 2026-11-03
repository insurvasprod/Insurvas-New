import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { isPendingSchema } from "@/lib/appointments/pendingSchema";
import { USERS_PAGE_SIZE } from "@/lib/users/constants";
import { LIFECYCLE_STATUSES, STALE_INVITE_DAYS, lifecycleOf, type UserLifecycle } from "./lifecycle";
import type { UsersListQuery } from "./query";
import type { UsersListPage, UsersListRow, UsersListStats } from "./types";

/**
 * Admin › Users list reads.
 *
 * Primary path: public.admin_user_directory and admin_user_directory_stats (migration
 * 20260925500000), which carry the lifecycle per row so the state filter pages in the database.
 *
 * Until that migration is applied: public.admin_user_list (today's view) plus tenant_users read
 * here, with the lifecycle worked out by lib/adminUsersList/lifecycle.ts. Suspended and Deactivated
 * are pure status filters and still page in the database; Active and Invited depend on
 * tenant_users.accepted_at, so for those two the fallback reads every candidate row, filters, and
 * slices the page itself — correct, and slower, until the view exists.
 */

// Untyped: admin_user_directory is not in database.types.ts (never edited by hand).
const db = () => getSupabaseServiceClient() as unknown as SupabaseClient;
type Filterable = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

const LIST_COLUMNS =
  "id, name, email, phone, status, tenant_id, tenant_name, tenant_role, plan_code, last_login_at, created_at, has_password, suspended_at, suspension_reason, distinct_ips_24h";
const CHUNK = 1000;

/** PostgREST's or= is a mini-language; quoting keeps a search term from corrupting it. */
function escapeForOrFilter(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Every filter except the lifecycle state, which the two paths apply differently. */
function applyCommonFilters(request: Filterable, query: UsersListQuery): Filterable {
  // Deleted people are not on the platform, and the tiles exclude them too.
  let r = request.neq("status", "deleted");
  if (query.q) {
    const term = escapeForOrFilter(query.q);
    r = r.or(`name.ilike."%${term}%",email.ilike."%${term}%"`);
  }
  if (query.status) r = r.eq("status", query.status);
  if (query.plan) r = r.eq("plan_code", query.plan);
  if (query.tenant === "none") r = r.is("tenant_id", null);
  else if (query.tenant) r = r.eq("tenant_id", query.tenant);
  if (query.role) r = r.eq("tenant_role", query.role);
  if (query.signupFrom) r = r.gte("created_at", `${query.signupFrom}T00:00:00Z`);
  if (query.signupTo) r = r.lte("created_at", `${query.signupTo}T23:59:59.999Z`);
  if (query.lastLoginFrom) r = r.gte("last_login_at", `${query.lastLoginFrom}T00:00:00Z`);
  if (query.lastLoginTo) r = r.lte("last_login_at", `${query.lastLoginTo}T23:59:59.999Z`);
  return r;
}

function ordered(request: Filterable, query: UsersListQuery): Filterable {
  return (
    request
      .order(query.sort, { ascending: query.dir === "asc", nullsFirst: false })
      // A unique tiebreaker, so rows with equal sort values cannot shuffle between pages.
      .order("id", { ascending: true })
      .order("tenant_id", { ascending: true, nullsFirst: true })
  );
}

type RawRow = Omit<UsersListRow, "lifecycle" | "accepted_at" | "invited_at"> &
  Partial<Pick<UsersListRow, "accepted_at" | "invited_at">> & { lifecycle?: string | null };

function toRow(raw: RawRow): UsersListRow {
  const accepted_at = raw.accepted_at ?? null;
  return {
    ...raw,
    accepted_at,
    invited_at: raw.invited_at ?? null,
    lifecycle: lifecycleOf({ status: raw.status, tenantId: raw.tenant_id, acceptedAt: accepted_at }),
  };
}

/** Membership dates for these people, keyed "user|tenant". */
async function memberships(userIds: string[]): Promise<Map<string, { accepted_at: string | null; invited_at: string | null }>> {
  const map = new Map<string, { accepted_at: string | null; invited_at: string | null }>();
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db()
      .from("tenant_users")
      .select("user_id, tenant_id, accepted_at, invited_at")
      .in("user_id", ids.slice(i, i + 150));
    if (error) throw new Error(`Could not load memberships: ${error.message}`);
    for (const row of (data ?? []) as Array<{ user_id: string; tenant_id: string; accepted_at: string | null; invited_at: string | null }>) {
      map.set(`${row.user_id}|${row.tenant_id}`, { accepted_at: row.accepted_at, invited_at: row.invited_at });
    }
  }
  return map;
}

async function annotate(rows: RawRow[]): Promise<UsersListRow[]> {
  const withTenant = rows.filter((row) => row.tenant_id).map((row) => row.id);
  const dates = withTenant.length ? await memberships(withTenant) : new Map();
  return rows.map((row) => toRow({ ...row, ...(row.tenant_id ? dates.get(`${row.id}|${row.tenant_id}`) : {}) }));
}

async function pageFromView(query: UsersListQuery): Promise<UsersListPage | null> {
  const from = (query.page - 1) * USERS_PAGE_SIZE;
  let request = applyCommonFilters(
    db().from("admin_user_directory").select(`${LIST_COLUMNS}, accepted_at, invited_at, lifecycle`, { count: "exact" }),
    query,
  );
  if (query.state) request = request.eq("lifecycle", query.state);
  const { data, error, count } = await ordered(request, query).range(from, from + USERS_PAGE_SIZE - 1);
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`Could not load users: ${error.message}`);
  }
  return { users: ((data ?? []) as RawRow[]).map(toRow), total: count ?? 0 };
}

async function pageFromFallback(query: UsersListQuery): Promise<UsersListPage> {
  const from = (query.page - 1) * USERS_PAGE_SIZE;
  const state: UserLifecycle | undefined = query.state;
  const base = () => applyCommonFilters(db().from("admin_user_list").select(LIST_COLUMNS, { count: "exact" }), query);

  // No state, or a state that is only a status: the database pages it.
  if (!state || state === "suspended" || state === "deactivated") {
    let request = base();
    if (state) request = request.in("status", [...LIFECYCLE_STATUSES[state]]);
    const { data, error, count } = await ordered(request, query).range(from, from + USERS_PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load users: ${error.message}`);
    return { users: await annotate((data ?? []) as RawRow[]), total: count ?? 0 };
  }

  // Active or Invited: depends on accepted_at. Read the candidates in order, decide, then slice.
  const statuses = state === "active" ? ["active"] : ["active", ...LIFECYCLE_STATUSES.invited];
  const matching: UsersListRow[] = [];
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await ordered(base().in("status", statuses), query).range(offset, offset + CHUNK - 1);
    if (error) throw new Error(`Could not load users: ${error.message}`);
    const rows = (data ?? []) as RawRow[];
    for (const row of await annotate(rows)) if (row.lifecycle === state) matching.push(row);
    if (rows.length < CHUNK) break;
  }
  return { users: matching.slice(from, from + USERS_PAGE_SIZE), total: matching.length };
}

export async function fetchUsersListPage(query: UsersListQuery): Promise<UsersListPage> {
  return (await pageFromView(query)) ?? (await pageFromFallback(query));
}

/* ── the tiles ─────────────────────────────────────────────────────────────────────────────── */

type StatsRow = {
  rows_total: number;
  tenants: number;
  tenantless: number;
  active: number;
  invited: number;
  invited_stale: number;
  suspended: number;
  suspended_no_reason: number;
  deactivated: number;
};

/** Every row, 1,000 at a time, in a unique order so no row is skipped or read twice between pages. */
async function readAll<T>(table: string, columns: string, orderBy: string[], filter?: (r: Filterable) => Filterable): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += CHUNK) {
    // Widened: a column list held in a variable makes the builder's row type unparseable.
    let request = db().from(table).select(columns) as unknown as Filterable;
    if (filter) request = filter(request);
    for (const column of orderBy) request = request.order(column, { ascending: true });
    const { data, error } = await request.range(offset, offset + CHUNK - 1);
    if (error) throw new Error(`Could not load ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < CHUNK) break;
  }
  return out;
}

/**
 * The same counts computed here, from users and tenant_users, until admin_user_directory_stats
 * exists. Rows are built the way the view builds them: one per membership, one per person with none.
 */
async function statsFallback(): Promise<UsersListStats> {
  const [users, members] = await Promise.all([
    readAll<{ id: string; status: string; created_at: string; suspension_reason: string | null }>(
      "users",
      "id, status, created_at, suspension_reason",
      ["id"],
      (r) => r.neq("status", "deleted"),
    ),
    readAll<{ user_id: string; tenant_id: string; accepted_at: string | null; invited_at: string | null }>(
      "tenant_users",
      "user_id, tenant_id, accepted_at, invited_at",
      ["user_id", "tenant_id"],
    ),
  ]);
  const byUser = new Map<string, typeof members>();
  for (const m of members) {
    const list = byUser.get(m.user_id) ?? [];
    list.push(m);
    byUser.set(m.user_id, list);
  }

  const staleBefore = Date.now() - STALE_INVITE_DAYS * 86_400_000;
  const stats: UsersListStats = { rows: 0, tenants: 0, tenantless: 0, active: 0, invited: 0, invitedStale: 0, suspended: 0, suspendedNoReason: 0, deactivated: 0 };
  const tenants = new Set<string>();

  for (const user of users) {
    const own = byUser.get(user.id);
    const rows = own?.length ? own : [null];
    for (const m of rows) {
      stats.rows += 1;
      if (m) tenants.add(m.tenant_id);
      else stats.tenantless += 1;
      const state = lifecycleOf({ status: user.status, tenantId: m?.tenant_id ?? null, acceptedAt: m?.accepted_at ?? null });
      if (!state) continue;
      stats[state] += 1;
      if (state === "invited" && new Date(m?.invited_at ?? user.created_at).getTime() < staleBefore) stats.invitedStale += 1;
      if (state === "suspended" && !user.suspension_reason?.trim()) stats.suspendedNoReason += 1;
    }
  }
  stats.tenants = tenants.size;
  return stats;
}

export async function fetchUsersListStats(): Promise<UsersListStats> {
  const { data, error } = await db().rpc("admin_user_directory_stats");
  if (error) {
    if (isPendingSchema(error)) return statsFallback();
    throw new Error(`Could not load user counts: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as StatsRow | null;
  if (!row) return statsFallback();
  return {
    rows: row.rows_total,
    tenants: row.tenants,
    tenantless: row.tenantless,
    active: row.active,
    invited: row.invited,
    invitedStale: row.invited_stale,
    suspended: row.suspended,
    suspendedNoReason: row.suspended_no_reason,
    deactivated: row.deactivated,
  };
}

/**
 * Tenants for the picker and the Create user dialog, by name. Paged: a single read stops at the
 * API's row cap, and past it the last tenants would silently disappear from both lists.
 */
export async function fetchTenantOptions(): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await db().from("tenants").select("id, name").order("name").order("id").range(offset, offset + CHUNK - 1);
    if (error) throw new Error(`Could not load tenants: ${error.message}`);
    out.push(...((data ?? []) as Array<{ id: string; name: string }>));
    if ((data ?? []).length < CHUNK) break;
  }
  return out;
}
