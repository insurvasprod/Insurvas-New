import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { readPlatformState } from "@/lib/adminAlerts/service";
import { fetchAuditSummary } from "@/lib/audit/logQuery";
import { fetchAllSwitches } from "@/lib/features/killSwitch";
import { switchCounts } from "@/lib/features/killSwitchRules";
import { fetchLoginActivityStats } from "@/lib/loginEvents/queries";
import { fetchSnapshotFreshness } from "@/lib/metrics/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchUsersListStats } from "@/lib/adminUsersList/directory";
import { TRIAL_CHASE_DAYS, type DailyCheckInput } from "./dailyChecks";

/**
 * The reads behind the admin home's daily checks (lib/adminDashboard/dailyChecks.ts decides what
 * they mean). The platform state — webhooks, billing run, past due, seat limits, trials,
 * compliance sources, maintenance — is the staff alerts' own minute-cached read, so the home and the
 * bell can never disagree. The rest are head counts.
 *
 * Every read settles on its own: one failing query shows its check as "Couldn't check" and leaves
 * the others standing, rather than throwing the whole home away.
 */
async function settle<T>(promise: PromiseLike<T>, label: string): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[admin-daily] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

type CountResult = { count: number | null; error: { message: string } | null };

function headCount(query: PromiseLike<CountResult>, label: string) {
  return settle(
    Promise.resolve(query).then((result) => {
      if (result.error) throw new Error(result.error.message);
      return result.count ?? 0;
    }),
    label,
  );
}

export async function fetchDailyCheckInput(admin: { id: string; role: AdminRole }): Promise<DailyCheckInput> {
  const now = Date.now();
  const db = getSupabaseServiceClient();
  const dayAgo = new Date(now - 86_400_000).toISOString();

  const [state, overdue, mismatched, signups, cancellations, suspended, logins, users, snapshot, switches, audit] = await Promise.all([
    settle(readPlatformState(now), "platform state"),
    headCount(db.from("platform_invoices").select("id", { count: "exact", head: true }).eq("status", "overdue"), "overdue invoices"),
    headCount(db.from("platform_invoices").select("id", { count: "exact", head: true }).eq("reconciliation", "mismatched"), "mismatched invoices"),
    headCount(db.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", dayAgo), "new sign-ups"),
    headCount(db.from("subscriptions").select("id", { count: "exact", head: true }).gte("cancelled_at", dayAgo), "cancellations"),
    headCount(db.from("tenants").select("id", { count: "exact", head: true }).eq("status", "suspended"), "suspended customers"),
    settle(fetchLoginActivityStats(), "sign-ins"),
    settle(fetchUsersListStats(), "invitations"),
    settle(fetchSnapshotFreshness(), "metrics snapshot"),
    settle(fetchAllSwitches(), "feature switches"),
    // Scoped as /admin/audit-log scopes it: everyone's for a super_admin, the viewer's own otherwise.
    settle(fetchAuditSummary({ id: admin.id, role: admin.role }), "audit log"),
  ]);

  const trials = state?.trials ?? null;
  return {
    now,
    stuckWebhooks: state?.stuckWebhooks ?? null,
    billingRun: state?.billingRun ?? null,
    pastDue: state?.pastDueCount ?? null,
    overdueInvoices: overdue,
    mismatchedInvoices: mismatched,
    trialsEnding: trials
      ? trials
          .filter((trial) => typeof trial.daysRemaining === "number" && trial.daysRemaining <= TRIAL_CHASE_DAYS)
          .map((trial) => ({ tenantName: trial.tenantName ?? "A customer", daysRemaining: trial.daysRemaining ?? 0, hasPaymentMethod: Boolean(trial.hasPaymentMethod) }))
      : null,
    newSignups24h: signups,
    cancellations24h: cancellations,
    seatLimited: state?.seatLimited ?? null,
    suspendedTenants: suspended,
    signIns: logins ? { today: logins.logins_today, failedToday: logins.failed_today } : null,
    staleInvitations: users ? users.invitedStale : null,
    failingSources: state?.failingSources ?? null,
    snapshot: snapshot ? { date: snapshot.date, ageDays: snapshot.ageDays } : null,
    maintenance: state?.maintenance ? { level: state.maintenance.level } : null,
    featuresOff: switches ? switchCounts(switches.values()).off : null,
    staffChangesToday: audit ? audit.todayCount : null,
  };
}
