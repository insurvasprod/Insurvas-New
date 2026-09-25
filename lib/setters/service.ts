import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import type { TenantRole } from "@/lib/tenantAuth/roles";

export type ScorecardRow = {
  userId: string;
  name: string;
  day: string;
  dials: number;
  contacts: number;
  booked: number;
  showed: number;
  noShow: number;
  /** Past, with no activity to infer a show from, still waiting for a human. Never a no-show. */
  pending: number;
  /** Pending for more than three days. Dropped out of the rate entirely; counted so the gap shows. */
  neverClosedOut: number;
  sold: number;
  showRatePct: number | null;
  /**
   * LA-2.12, decision 12. The show rate alone is unreadable: 62% of 31 is a pay decision, 62% of 8
   * is not, and the reader cannot tell them apart. Coverage travels with the rate for that reason,
   * and any screen showing one must show the other.
   */
  closedOut: number;
  closeable: number;
  coveragePct: number | null;
  bookPerContactPct: number | null;
};

export type RosterRow = {
  userId: string;
  name: string;
  role: string;
  timezone: string;
  localLabel: string;
  onShiftNow: boolean;
};

type ViewRow = {
  user_id: string;
  day: string;
  dials: number;
  contacts: number;
  booked: number;
  showed: number;
  no_show: number;
  pending: number;
  never_closed_out: number;
  sold: number;
  show_rate_pct: number | null;
  closed_out: number;
  closeable: number;
  coverage_pct: number | null;
  book_per_contact_pct: number | null;
};

type RosterViewRow = {
  user_id: string;
  role: string;
  timezone: string;
  local_label: string;
  on_shift_now: boolean;
};

/**
 * LA-2.12. Per setter, per day: dials · contacts · booked · showed · sold.
 *
 * The scope is decided here from the caller's role and never from a parameter. `scorecard.view.all`
 * sees the team; everyone else sees their own rows and nothing else, which is criterion 2's second
 * half — "cannot see another setter's ... scorecard". Passing a user id in and trusting it would
 * make the whole team's numbers one query-string edit away.
 */
export async function getScorecard(
  tenantId: string,
  userId: string,
  role: TenantRole,
  sinceDays = 30,
): Promise<{ rows: ScorecardRow[]; scope: "team" | "own" }> {
  const db = getSupabaseServiceClient();
  const seesEveryone = hasTenantPermission(role, "scorecard.view.all");
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  let query = db
    .from("tenant_setter_scorecard")
    .select("user_id, day, dials, contacts, booked, showed, no_show, pending, never_closed_out, sold, show_rate_pct, closed_out, closeable, coverage_pct, book_per_contact_pct")
    .eq("tenant_id", tenantId)
    .gte("day", since)
    .order("day", { ascending: false });
  if (!seesEveryone) query = query.eq("user_id", userId);

  const { data, error } = await query.returns<ViewRow[]>();
  if (error) throw new Error(`Could not load the scorecard: ${error.message}`);

  const names = await namesFor(tenantId, (data ?? []).map((row) => row.user_id));
  return {
    scope: seesEveryone ? "team" : "own",
    rows: (data ?? []).map((row) => ({
      userId: row.user_id,
      name: names.get(row.user_id) ?? "Unknown member",
      day: row.day,
      dials: row.dials,
      contacts: row.contacts,
      booked: row.booked,
      showed: row.showed,
      noShow: row.no_show,
      pending: row.pending,
      neverClosedOut: row.never_closed_out,
      sold: row.sold,
      showRatePct: row.show_rate_pct,
      closedOut: row.closed_out,
      closeable: row.closeable,
      coveragePct: row.coverage_pct,
      bookPerContactPct: row.book_per_contact_pct,
    })),
  };
}

/**
 * "Setters are often in another timezone entirely. Show their local time in the roster, and let Ray
 * see who is on shift now."
 *
 * The local time comes from the view rather than being computed here, so the roster and the booking
 * rules that use the same availability row can never disagree about what time it is for that
 * member.
 */
export async function getRoster(tenantId: string): Promise<RosterRow[]> {
  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from("tenant_member_roster")
    .select("user_id, role, timezone, local_label, on_shift_now")
    .eq("tenant_id", tenantId)
    .returns<RosterViewRow[]>();
  if (error) throw new Error(`Could not load the roster: ${error.message}`);

  const names = await namesFor(tenantId, (data ?? []).map((row) => row.user_id));
  // One row per member: the view has a row per weekday of availability, and only the day that is
  // current in that member's own zone can be the one they are on shift for.
  const byUser = new Map<string, RosterRow>();
  for (const row of data ?? []) {
    const existing = byUser.get(row.user_id);
    if (existing && !row.on_shift_now) continue;
    byUser.set(row.user_id, {
      userId: row.user_id,
      name: names.get(row.user_id) ?? "Unknown member",
      role: row.role,
      timezone: row.timezone,
      localLabel: row.local_label,
      onShiftNow: row.on_shift_now,
    });
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function namesFor(tenantId: string, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const { data, error } = await getSupabaseServiceClient()
    .from("users")
    .select("id, name")
    .in("id", unique)
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`Could not load member names: ${error.message}`);
  void tenantId;
  return new Map((data ?? []).map((user) => [user.id, user.name]));
}

export type AgentSetterRow = {
  userId: string;
  name: string;
  dials: number;
  contacts: number;
  booked: number;
  showed: number;
  noShow: number;
  pending: number;
  sold: number;
};

/**
 * The setters who booked into ONE agent's calendar (20260925704300), decided 2026-09-25: the
 * scorecard on Appointments & setters covers only them and a producer sees it too. The agent is the
 * signed-in owner or producer, never a parameter from a request.
 *
 * Null when the function is not in the database yet — the page then falls back to the agency-wide
 * scorecard and says so, rather than showing an empty table as if nobody booked.
 */
export async function getAgentSetterScorecard(tenantId: string, agentUserId: string, sinceDays = 30): Promise<AgentSetterRow[] | null> {
  const db = getSupabaseServiceClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  };
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await db.rpc("setter_scorecard_for_agent", { p_tenant_id: tenantId, p_agent_user_id: agentUserId, p_since: since });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message)) return null;
    throw new Error(`Could not load the setter scorecard: ${error.message}`);
  }
  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  const names = await namesFor(tenantId, rows.map((row) => String(row.user_id ?? "")).filter(Boolean));
  const n = (value: unknown) => Number(value ?? 0) || 0;
  return rows.map((row) => ({
    userId: String(row.user_id),
    name: names.get(String(row.user_id)) ?? "Unknown member",
    dials: n(row.dials),
    contacts: n(row.contacts),
    booked: n(row.booked),
    showed: n(row.showed),
    noShow: n(row.no_show),
    pending: n(row.pending),
    sold: n(row.sold),
  }));
}
