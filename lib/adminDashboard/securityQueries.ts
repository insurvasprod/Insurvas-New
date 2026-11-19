import "server-only";

import { cache } from "react";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { AUDIT_ACTION_LABELS } from "@/lib/audit/actions";
import { staffLoginsVisibleTo } from "@/lib/loginEvents/present";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { initials, signInDays, STAFF_SIGN_IN_ACTIONS, utcClock, type SignInDay } from "./security";

/**
 * The reads behind Security & staff (admin round 1 §6), and the staff changes Needs you shows for its
 * "Staff changes today" check. Read-only; each throws on a database error, so its card says it could not
 * load instead of drawing an empty list ("nobody changed anything") or a zero.
 *
 * The rules the pages behind them apply hold here too:
 *   - the audit log's per-actor rule (lib/audit/logQuery.ts): a super admin sees every staff member's
 *     changes, anyone else only their own;
 *   - the sign-in list's staff rule (lib/loginEvents/present.ts): staff sign-ins are counted only for a
 *     role that may see them, so a total never leaks what the list hides.
 */

const db = () => getSupabaseServiceClient();

/**
 * Sign-ins per UTC day for the last `days` days, ending today, counted by the database: one head count per day and
 * outcome, all at once, instead of paging every row across (which took ~11 s for 30 days and capped at 20,000 rows;
 * admin round 1, 2026-11-17). Same shape `signInDays` builds, so the charts draw it unchanged. Throws on any failed count,
 * so the card says it could not load rather than drawing a dip.
 */
export const signInDayCounts = cache(async (days: number, includeStaff: boolean, now: number): Promise<SignInDay[]> => {
  const series = signInDays([], now, days);
  const count = async (dayKey: string, success: boolean) => {
    const start = `${dayKey}T00:00:00.000Z`;
    const end = new Date(Date.parse(start) + 86_400_000).toISOString();
    let query = db().from("login_events").select("id", { count: "exact", head: true }).eq("success", success).gte("ts", start).lt("ts", end);
    if (!includeStaff) query = query.eq("actor_type", "user");
    const { count: total, error } = await query;
    if (error) throw new Error(`Could not count sign-ins: ${error.message}`);
    return total ?? 0;
  };
  await Promise.all(series.map(async (day) => {
    const [succeeded, failed] = await Promise.all([count(day.key, true), count(day.key, false)]);
    day.succeeded = succeeded;
    day.failed = failed;
  }));
  return series;
});

export function signInScope(role: AdminRole): { includeStaff: boolean } {
  return { includeStaff: staffLoginsVisibleTo(role) };
}

export type StaffChange = { id: string; who: string; initials: string; what: string; time: string };

const CHANGES_SHOWN = 8;

function startOfUtcDay(now: number): string {
  const day = new Date(now);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString();
}

/** Today's staff changes (not sign-ins), newest first, scoped by the audit log's per-actor rule. */
export const staffChangesToday = cache(async (adminId: string, role: AdminRole): Promise<{ rows: StaffChange[]; total: number }> => {
  let query = db()
    .from("audit_log")
    .select("id, ts, actor_id, action, target_type, target_id", { count: "exact" })
    .eq("actor_type", "admin")
    .gte("ts", startOfUtcDay(Date.now()))
    .not("action", "in", `(${STAFF_SIGN_IN_ACTIONS.join(",")})`);
  if (role !== "super_admin") query = query.eq("actor_id", adminId);
  const { data, error, count } = await query.order("ts", { ascending: false }).limit(CHANGES_SHOWN);
  if (error) throw new Error(`Could not load today's staff changes: ${error.message}`);
  const rows = (data ?? []) as { id: string; ts: string; actor_id: string | null; action: string; target_type: string | null; target_id: string | null }[];

  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const tenantIds = [...new Set(rows.filter((row) => row.target_type === "tenant" && row.target_id).map((row) => row.target_id as string))];
  const [staff, tenants] = await Promise.all([
    actorIds.length ? db().from("admin_users").select("id, name, email").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
    tenantIds.length ? db().from("tenants").select("id, name").in("id", tenantIds) : Promise.resolve({ data: [], error: null }),
  ]);
  // A missing name is not a reason to hide the change: the row says "A staff member" instead.
  const staffById = new Map(((staff.data ?? []) as { id: string; name: string | null; email: string }[]).map((row) => [row.id, row.name?.trim() || row.email]));
  const tenantById = new Map(((tenants.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const labels = AUDIT_ACTION_LABELS as Record<string, string>;

  return {
    total: count ?? rows.length,
    rows: rows.map((row) => {
      const who = (row.actor_id && staffById.get(row.actor_id)) || "A staff member";
      const target = row.target_type === "tenant" && row.target_id ? tenantById.get(row.target_id) : null;
      return { id: row.id, who, initials: initials(who), what: `${labels[row.action] ?? row.action}${target ? ` · ${target}` : ""}`, time: utcClock(row.ts) };
    }),
  };
});

/** Every admin's role and whether the account is active: the "Admins" card. */
export const adminAccounts = cache(async (): Promise<{ role: AdminRole; is_active: boolean }[]> => {
  const { data, error } = await db().from("admin_users").select("role, is_active");
  if (error) throw new Error(`Could not load admin counts: ${error.message}`);
  return (data ?? []) as { role: AdminRole; is_active: boolean }[];
});
