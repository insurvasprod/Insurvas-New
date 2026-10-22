import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { fetchAuditSummary } from "@/lib/audit/logQuery";
import { fetchAllSwitches } from "@/lib/features/killSwitch";
import { switchCounts } from "@/lib/features/killSwitchRules";
import { fetchLoginActivityStats } from "@/lib/loginEvents/queries";
import { fetchMetrics, fetchSnapshotFreshness } from "@/lib/metrics/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { announcementState } from "@/lib/system/adminFormat";
import { getMaintenanceStatus, listAnnouncements } from "@/lib/system/service";
import { fetchUsersListStats } from "@/lib/adminUsersList/directory";
import { TRIAL_WEEK_DAYS } from "@/lib/subscriptionsList/model";
import {
  homeFigureSet,
  platformTiles,
  revenueTiles,
  summariseSnapshot,
  supportTiles,
  tilesFor,
  type HomeTile,
} from "./compose";

/**
 * The admin home's figures (dashboards pass, 2026-10-13), one set per role (lib/adminDashboard/
 * compose.ts decides which). Only the reads for the role's own set run — a platform_config request
 * never touches invoices or tenants — and every read in a set runs in one Promise.all. Head counts
 * in the database wherever a count is all the tile prints, so the home never reads a whole table to
 * print one number.
 *
 * Errors throw. A failed count rendered as 0 reads as "nothing wrong", which on the tile for
 * mismatched invoices is precisely the wrong message; the route's error boundary offers Try again.
 */

type CountResult = { count: number | null; error: { message: string } | null };

function counted(result: CountResult, label: string): number {
  if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
  return result.count ?? 0;
}

function startOfUtcMonth(now: number): string {
  const day = new Date(now);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)).toISOString();
}

/** SA-3.9's headline figures, plus the invoice and trial counts their pages list. */
async function revenueFigures(now: number): Promise<HomeTile[]> {
  const db = getSupabaseServiceClient();
  const weekEnd = new Date(now + TRIAL_WEEK_DAYS * 86_400_000).toISOString();
  const [days, freshness, monthInvoices, mismatched, overdue, trialing, trialsEnding] = await Promise.all([
    // 62 days: the newest snapshot, the base 30 days before it, and this calendar month.
    fetchMetrics(62),
    fetchSnapshotFreshness(),
    db.from("platform_invoices").select("status, total_cents").gte("created_at", startOfUtcMonth(now)),
    db.from("platform_invoices").select("id", { count: "exact", head: true }).eq("reconciliation", "mismatched"),
    db.from("platform_invoices").select("id", { count: "exact", head: true }).eq("status", "overdue"),
    db.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "trialing"),
    // The Subscriptions board's "ending this week" (lib/subscriptionsList/model.ts figuresFor): the
    // trial end, else the period end, within TRIAL_WEEK_DAYS — overdue ones included.
    db
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "trialing")
      .or(`trial_ends_at.lte.${weekEnd},and(trial_ends_at.is.null,current_period_end.lte.${weekEnd})`),
  ]);
  if (monthInvoices.error) throw new Error(`Could not load this month's invoices: ${monthInvoices.error.message}`);

  // The invoices page's definitions (lib/invoices/queries.ts computeInvoiceTotals): a void invoice
  // is not money we invoiced, and only a paid one is collected.
  const rows = (monthInvoices.data ?? []) as { status: string; total_cents: number }[];
  const invoiced = rows.filter((row) => row.status !== "void").reduce((sum, row) => sum + row.total_cents, 0);
  const collected = rows.filter((row) => row.status === "paid").reduce((sum, row) => sum + row.total_cents, 0);

  return revenueTiles({
    ...summariseSnapshot(days, now),
    snapshotDate: freshness.date,
    snapshotAgeDays: freshness.ageDays,
    invoicedThisMonthCents: invoiced,
    collectedThisMonthCents: collected,
    mismatchedInvoices: counted(mismatched, "mismatched invoice count"),
    overdueInvoices: counted(overdue, "overdue invoice count"),
    trialsInFlight: counted(trialing, "trial count"),
    trialsEndingThisWeek: counted(trialsEnding, "trials ending this week"),
  });
}

async function supportFigures(admin: { id: string; role: AdminRole }): Promise<HomeTile[]> {
  const db = getSupabaseServiceClient();
  const [total, suspended, logins, users, audit] = await Promise.all([
    db.from("tenants").select("id", { count: "exact", head: true }),
    db.from("tenants").select("id", { count: "exact", head: true }).eq("status", "suspended"),
    fetchLoginActivityStats(),
    fetchUsersListStats(),
    // Scoped as /admin/audit-log scopes it: everyone's for a super_admin, the viewer's own otherwise.
    fetchAuditSummary({ id: admin.id, role: admin.role }),
  ]);
  return supportTiles({
    tenants: counted(total, "tenant count"),
    suspendedTenants: counted(suspended, "suspended tenant count"),
    signedInLast15Min: logins.active_last_15_min,
    signInsToday: logins.logins_today,
    failedSignInsToday: logins.failed_today,
    invitedUsers: users.invited,
    invitedStale: users.invitedStale,
    auditToday: audit.todayCount,
    auditWeek: audit.weekCount,
    auditIsOwn: admin.role !== "super_admin",
  });
}

async function platformFigures(now: number): Promise<HomeTile[]> {
  const [status, announcements, switches, sources] = await Promise.all([
    getMaintenanceStatus(),
    // As /admin/system: an unreadable announcement list is "—", not zero announcements.
    listAnnouncements().catch(() => null),
    fetchAllSwitches(),
    getSupabaseServiceClient().from("compliance_vendors").select("failure_count_24h").eq("is_enabled", true),
  ]);
  if (sources.error) throw new Error(`Could not load compliance sources: ${sources.error.message}`);
  const states = announcements?.map((item) => announcementState(item, now)) ?? null;
  const counts = switchCounts(switches.values());
  const enabled = (sources.data ?? []) as { failure_count_24h: number | null }[];
  return platformTiles({
    maintenanceLevel: status.level,
    // A window that has not started yet shows as a banner now, with its own level to come.
    maintenanceScheduled: status.configuredLevel && status.scheduledStart && Date.parse(status.scheduledStart) > now ? status.configuredLevel : null,
    announcementsLive: states ? states.filter((state) => state === "live").length : null,
    announcementsScheduled: states ? states.filter((state) => state === "scheduled").length : null,
    featuresOff: counts.off,
    featuresBeta: counts.beta,
    complianceSources: enabled.length,
    complianceSourcesFailing: enabled.filter((row) => (row.failure_count_24h ?? 0) > 0).length,
  });
}

/** The role's strip: its figure set, each tile linking to a page the role can open. */
export async function fetchHomeTiles(admin: { id: string; role: AdminRole }): Promise<HomeTile[]> {
  const now = Date.now();
  const set = homeFigureSet(admin.role);
  const tiles = set === "revenue" ? await revenueFigures(now) : set === "support" ? await supportFigures(admin) : await platformFigures(now);
  return tilesFor(admin.role, tiles);
}
