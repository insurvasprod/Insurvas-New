import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { fetchLoginActivityStats } from "@/lib/loginEvents/queries";
import { getSetting } from "@/lib/settings/queries";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { canViewTenants } from "@/lib/tenants/permissions";
import { canViewUsers } from "@/lib/users/permissions";
import { activeLockoutEmails, startOfUtcWeek, type LockoutRow } from "./figures";

/**
 * The staff dashboard's four tiles (p-adm-home), each read from the table the page that owns the
 * number reads, and each only for a role that may open that page:
 *
 *   Tenants              /admin/tenants        canViewTenants
 *   Active subscriptions /admin/subscriptions  canManageSubscriptions
 *   Failed logins today  /admin/activity       canViewUsers   (lockouts: super_admin, as /admin/advanced)
 *   Mismatched invoices  /admin/invoices       canViewInvoices
 *
 * A tile the role may not see is null, never 0 — the page leaves it out. Every figure is a head
 * count in the database rather than rows counted here, so the dashboard does not read the whole
 * invoice or subscription table to print one number.
 *
 * Errors throw. A failed count rendered as 0 reads as "nothing wrong", which on the tile for
 * mismatched invoices is precisely the wrong message; the route's error boundary offers Try again.
 */
export type DashboardFigures = {
  tenants: { total: number; suspended: number } | null;
  subscriptions: { active: number; startedThisWeek: number } | null;
  logins: { failedToday: number; lockedEmails: number | null } | null;
  mismatchedInvoices: number | null;
};

type CountResult = { count: number | null; error: { message: string } | null };

function counted(result: CountResult, label: string): number {
  if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
  return result.count ?? 0;
}

async function tenantCounts() {
  const db = getSupabaseServiceClient();
  const [total, suspended] = await Promise.all([
    db.from("tenants").select("id", { count: "exact", head: true }),
    db.from("tenants").select("id", { count: "exact", head: true }).eq("status", "suspended"),
  ]);
  return { total: counted(total, "tenant count"), suspended: counted(suspended, "suspended tenant count") };
}

async function subscriptionCounts(now: number) {
  const db = getSupabaseServiceClient();
  const [active, started] = await Promise.all([
    db.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    // Active subscriptions whose start falls in this week. Not a net change — nothing records
    // when a subscription stopped being active, so "+N" would be a figure we cannot compute.
    db
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gte("started_at", startOfUtcWeek(now).toISOString()),
  ]);
  return {
    active: counted(active, "active subscription count"),
    startedThisWeek: counted(started, "subscriptions started this week"),
  };
}

/** Distinct emails locked out right now, by the same settings and rule sign-in applies. */
async function lockedEmails(now: number) {
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

async function loginFigures(role: AdminRole, now: number) {
  const [stats, locked] = await Promise.all([
    fetchLoginActivityStats(),
    role === "super_admin" ? lockedEmails(now) : Promise.resolve(null),
  ]);
  return { failedToday: stats.failed_today, lockedEmails: locked };
}

async function mismatchedInvoiceCount() {
  const result = await getSupabaseServiceClient()
    .from("platform_invoices")
    .select("id", { count: "exact", head: true })
    .eq("reconciliation", "mismatched");
  return counted(result, "mismatched invoice count");
}

export async function fetchDashboardFigures(role: AdminRole): Promise<DashboardFigures> {
  const now = Date.now();
  const [tenants, subscriptions, logins, mismatchedInvoices] = await Promise.all([
    canViewTenants(role) ? tenantCounts() : null,
    canManageSubscriptions(role) ? subscriptionCounts(now) : null,
    canViewUsers(role) ? loginFigures(role, now) : null,
    canViewInvoices(role) ? mismatchedInvoiceCount() : null,
  ]);
  return { tenants, subscriptions, logins, mismatchedInvoices };
}
