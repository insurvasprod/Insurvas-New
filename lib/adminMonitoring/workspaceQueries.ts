import "server-only";

import { cache } from "react";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { AUDIT_ACTION_LABELS } from "@/lib/audit/actions";
import { isMoneyAction } from "@/lib/audit/moneyActions";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { healthRows, type HealthRow } from "@/lib/adminDashboard/healthJobs";
import { fetchHealthInput } from "@/lib/adminDashboard/healthQueries";
import { initials, STAFF_SIGN_IN_ACTIONS } from "@/lib/adminDashboard/security";
import { lockedAccounts, type LockoutEntry } from "@/lib/loginEvents/lockouts";
import { staffLoginsVisibleTo } from "@/lib/loginEvents/present";
import { fetchFailedAttempts, fetchLockouts, type FailedAttempt } from "@/lib/loginEvents/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isNightUtc, rangeWindow, worthALook, type NightChange, type WorkspaceRange, type WorthItem } from "./workspace";

/**
 * The reads behind Monitoring › Workspace (monitoring.html screen 1) and the rail's badges. Read-only; each throws
 * on a database error so its card says it could not load instead of drawing a zero.
 *
 * The pages' own rules hold here:
 *   - sign-ins only for a role that can open Login activity, staff sign-ins only for super admin
 *     (lib/loginEvents/present.ts staffLoginsVisibleTo);
 *   - staff actions by the audit log's per-actor rule: a super admin sees everyone's, anyone else only their own;
 *   - lockouts and staff sessions are super admin only — asked by role, not canOpenAdminHref, whose prefix rule
 *     would let any role with the Workspace (/admin/monitoring) "open" /admin/monitoring/lockouts.
 */

const db = () => getSupabaseServiceClient();

export type MonitoringViewer = { id: string; role: AdminRole };

export function canSeeSignIns(role: AdminRole): boolean {
  return canOpenAdminHref(role, "/admin/activity");
}

export function canSeeLockouts(role: AdminRole): boolean {
  return role === "super_admin";
}

/* ── Sign-ins ────────────────────────────────────────────────────────────── */

async function countAttempts(sinceIso: string, untilIso: string | null, success: boolean, includeStaff: boolean): Promise<number> {
  let query = db().from("login_events").select("id", { count: "exact", head: true }).eq("success", success).gte("ts", sinceIso);
  if (untilIso) query = query.lt("ts", untilIso);
  if (!includeStaff) query = query.eq("actor_type", "user");
  const { count, error } = await query;
  if (error) throw new Error(`Could not count sign-ins: ${error.message}`);
  return count ?? 0;
}

export type SignInFigures = { succeeded: number; failed: number; previousSucceeded: number; previousFailed: number; includeStaff: boolean };

/** Sign-ins and failed attempts in the range, and in the same window one period earlier. */
export const signInFigures = cache(async (role: AdminRole, range: WorkspaceRange, now: number): Promise<SignInFigures> => {
  const includeStaff = staffLoginsVisibleTo(role);
  const window = rangeWindow(range, now);
  const since = new Date(window.since).toISOString();
  const previousSince = new Date(window.previousSince).toISOString();
  const previousUntil = new Date(window.previousUntil).toISOString();
  const [succeeded, failed, previousSucceeded, previousFailed] = await Promise.all([
    countAttempts(since, null, true, includeStaff),
    countAttempts(since, null, false, includeStaff),
    countAttempts(previousSince, previousUntil, true, includeStaff),
    countAttempts(previousSince, previousUntil, false, includeStaff),
  ]);
  return { succeeded, failed, previousSucceeded, previousFailed, includeStaff };
});

/** Failed attempts in the range with their address and account, for the Repeated failures rule. */
export const rangeFailures = cache(async (role: AdminRole, range: WorkspaceRange, now: number): Promise<FailedAttempt[]> => {
  return fetchFailedAttempts(new Date(rangeWindow(range, now).since).toISOString(), staffLoginsVisibleTo(role));
});

export const currentLockouts = cache(async (now: number): Promise<LockoutEntry[]> => fetchLockouts(now));

/* ── Staff actions ───────────────────────────────────────────────────────── */

export type StaffAction = { id: string; ts: string; who: string; initials: string; what: string; targetId: string | null };

export type StaffActions = {
  total: number;
  money: number;
  /** Newest first, at most LATEST_SHOWN. */
  latest: StaffAction[];
  night: NightChange[];
  /** Only the viewer's own actions are counted (the audit log's rule for anyone but a super admin). */
  ownOnly: boolean;
};

const LATEST_SHOWN = 5;
const ACTION_ROWS = 2000;

/** Staff changes (not sign-ins) in the range: the count, the money ones, the latest few and the ones made at night. */
export const staffActions = cache(async (viewer: MonitoringViewer, range: WorkspaceRange, now: number): Promise<StaffActions> => {
  const ownOnly = viewer.role !== "super_admin";
  let query = db()
    .from("audit_log")
    .select("id, ts, actor_id, action, target_type, target_id", { count: "exact" })
    .eq("actor_type", "admin")
    .gte("ts", new Date(rangeWindow(range, now).since).toISOString())
    .not("action", "in", `(${STAFF_SIGN_IN_ACTIONS.join(",")})`);
  if (ownOnly) query = query.eq("actor_id", viewer.id);
  const { data, error, count } = await query.order("ts", { ascending: false }).limit(ACTION_ROWS);
  if (error) throw new Error(`Could not load staff actions: ${error.message}`);
  const rows = (data ?? []) as { id: string; ts: string; actor_id: string | null; action: string; target_type: string | null; target_id: string | null }[];

  const nightRows = rows.filter((row) => isNightUtc(row.ts));
  const named = [...rows.slice(0, LATEST_SHOWN), ...nightRows.slice(0, 3)];
  const actorIds = [...new Set(named.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const tenantIds = [...new Set(named.filter((row) => row.target_type === "tenant" && row.target_id).map((row) => row.target_id as string))];
  const [staff, tenants] = await Promise.all([
    actorIds.length ? db().from("admin_users").select("id, name, email").in("id", actorIds) : Promise.resolve({ data: [], error: null }),
    tenantIds.length ? db().from("tenants").select("id, name").in("id", tenantIds) : Promise.resolve({ data: [], error: null }),
  ]);
  // A missing name is not a reason to hide the change: the row says "A staff member" instead.
  const staffById = new Map(((staff.data ?? []) as { id: string; name: string | null; email: string }[]).map((row) => [row.id, row.name?.trim() || row.email]));
  const tenantById = new Map(((tenants.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const labels = AUDIT_ACTION_LABELS as Record<string, string>;
  const describe = (row: (typeof rows)[number]): StaffAction => {
    const who = (row.actor_id && staffById.get(row.actor_id)) || "A staff member";
    const target = row.target_type === "tenant" && row.target_id ? tenantById.get(row.target_id) : null;
    return { id: row.id, ts: row.ts, who, initials: initials(who), what: `${labels[row.action] ?? row.action}${target ? ` · ${target}` : ""}`, targetId: row.target_id };
  };

  return {
    total: count ?? rows.length,
    money: rows.filter((row) => isMoneyAction(row.action)).length,
    latest: rows.slice(0, LATEST_SHOWN).map(describe),
    night: nightRows.slice(0, 3).map((row) => {
      const action = describe(row);
      return { id: action.id, ts: action.ts, who: action.who, what: action.what, targetId: action.targetId };
    }),
    ownOnly,
  };
});

/* ── Jobs ────────────────────────────────────────────────────────────────── */

export type JobsFigure = { failing: HealthRow[]; watched: number; rows: HealthRow[] };

/** Platform health, as the dashboard reads it: the failing jobs first. */
export const jobsHealth = cache(async (viewer: MonitoringViewer): Promise<JobsFigure> => {
  const data = await fetchHealthInput(viewer);
  const rows = healthRows(data.health);
  return { rows, failing: rows.filter((row) => row.status === "failing"), watched: rows.filter((row) => row.status !== "not_watched").length };
});

/* ── Worth a look ────────────────────────────────────────────────────────── */

async function settled<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`[admin-monitoring] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Worth a look for the viewer and the range. A source the role may not see is left out; a source whose read
 * failed is left out too, and `incomplete` says so (the card says some checks could not run, never "all clear").
 */
export const worthItems = cache(async (viewer: MonitoringViewer, range: WorkspaceRange, now: number): Promise<{ items: WorthItem[]; incomplete: boolean }> => {
  const signIns = canSeeSignIns(viewer.role);
  const locks = canSeeLockouts(viewer.role);
  const [failures, lockouts, actions] = await Promise.all([
    signIns ? settled("failures", () => rangeFailures(viewer.role, range, now)) : Promise.resolve(null),
    locks ? settled("lockouts", () => currentLockouts(now)) : Promise.resolve(null),
    settled("staff actions", () => staffActions(viewer, range, now)),
  ]);
  const incomplete = (signIns && failures === null) || (locks && lockouts === null) || actions === null;
  return { items: worthALook({ range, failures, lockouts, nightChanges: actions?.night ?? null }), incomplete };
});

/* ── The rail's badges ───────────────────────────────────────────────────── */

/**
 * GET /api/admin/monitoring/steps: only the steps the role may open; a count whose read failed is left out,
 * never sent as 0. Workspace counts today's Worth a look items, Login activity today's failed attempts, Lockouts
 * the accounts locked now, Jobs & services the failing jobs.
 */
export async function monitoringStepCounts(viewer: MonitoringViewer, steps: ReadonlySet<string>, now = Date.now()): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const [worth, figures, lockouts, jobs] = await Promise.all([
    steps.has("workspace") ? settled("worth", () => worthItems(viewer, "today", now)) : Promise.resolve(null),
    steps.has("logins") && canSeeSignIns(viewer.role) ? settled("sign-ins", () => signInFigures(viewer.role, "today", now)) : Promise.resolve(null),
    steps.has("lockouts") && canSeeLockouts(viewer.role) ? settled("lockouts", () => currentLockouts(now)) : Promise.resolve(null),
    steps.has("jobs") ? settled("jobs", () => jobsHealth(viewer)) : Promise.resolve(null),
  ]);
  if (worth && !worth.incomplete) counts.workspace = worth.items.length;
  if (figures) counts.logins = figures.failed;
  if (lockouts) counts.lockouts = lockedAccounts(lockouts);
  if (jobs) counts.jobs = jobs.failing.length;
  return counts;
}
