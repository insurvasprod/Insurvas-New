import { Suspense } from "react";
import { redirect } from "next/navigation";

import { ActivityFeed } from "@/components/admin/activity-feed";
import { GraphCardLoading } from "@/components/admin/dashboard/ov-card";
import { LoginChart } from "@/components/admin/monitoring/login-chart";
import { LoginExportButton } from "@/components/admin/monitoring/login-export-button";
import { LoginLensTabs } from "@/components/admin/monitoring/login-lens-tabs";
import { MonitoringPage } from "@/components/admin/monitoring/monitoring-page";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewUsers } from "@/lib/users/permissions";
import {
  countFailedAttempts,
  countRepeatedFailureIps,
  fetchActiveLockoutEmails,
  fetchLoginActivityPage,
  fetchLoginActivityStats,
  type LoginActivityPage,
  type LoginActivityStats,
} from "@/lib/loginEvents/queries";
import { parseActivityFilters, parseActivityLens, staffLoginsVisibleTo, weekOverWeek } from "@/lib/loginEvents/present";

/** Lockouts are security state: only super_admin reads them, as on Lockouts. */
async function lockoutFootnote(isSuperAdmin: boolean): Promise<string | null> {
  if (!isSuperAdmin) return null;
  try {
    const count = await fetchActiveLockoutEmails();
    return `${count.toLocaleString("en-US")} sign-in ${count === 1 ? "lockout" : "lockouts"} active`;
  } catch {
    // The failure count above is still right; say that the lockout half is missing, not "0".
    return "sign-in lockouts could not be read";
  }
}

async function settle<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`[admin-activity] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** The request's clock, read once. */
function readNow(): number {
  return Date.now();
}

const n = (value: number) => value.toLocaleString("en-US");

/**
 * Monitoring › Login activity (admin round 1, docs/design/admin-r1/monitoring.html screen 2). Everything it had is
 * kept: the four tiles (week over week, and the lockout count for a super admin), the table's columns, search,
 * Outcome / Actor / Range, the count line, clear, refresh and paging, and staff sign-ins for super admin only. New:
 * every filter, the lens, the page and the open attempt in the address; a 14-day chart; the "Repeated failures"
 * lens; the Device column; an attempt as a right sheet; Export CSV.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewUsers(admin.role)) redirect("/admin");

  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const filters = parseActivityFilters(query);
  const lens = parseActivityLens(query);
  const page = Math.min(10_000, Math.max(1, Math.floor(Number(query.get("page"))) || 1));
  const includeStaff = staffLoginsVisibleTo(admin.role);
  const now = readNow();

  const [stats, initial, lockouts, failedCount, repeatedCount] = await Promise.all([
    settle<LoginActivityStats>("stats", () => fetchLoginActivityStats()),
    settle<LoginActivityPage>("feed", () => fetchLoginActivityPage({ page, filters, lens, includeStaff: staffLoginsVisibleTo(admin.role), now })),
    lockoutFootnote(admin.role === "super_admin"),
    settle("failed count", () => countFailedAttempts(filters.range, includeStaff, now)),
    settle("repeated count", () => countRepeatedFailureIps(filters.range, includeStaff, now)),
  ]);

  return (
    <MonitoringPage
      step="logins"
      info="Every sign-in attempt on the platform, newest first: who, from where, on what device and whether it worked. An attempt opens with everything else from the same address and account. Times are UTC."
      tabs={<LoginLensTabs failed={failedCount} repeated={repeatedCount} />}
      actions={<LoginExportButton />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Login activity at a glance">
          <StatTile
            label="Logins today"
            value={stats ? n(stats.logins_today) : "—"}
            footnote={stats ? "all customers and staff, UTC day" : "Could not be read"}
            href="/admin/activity?outcome=success"
          />
          <StatTile
            label="Logins this week"
            value={stats ? n(stats.logins_this_week) : "—"}
            footnote={stats ? weekOverWeek(stats.logins_this_week, stats.logins_last_week_to_date) ?? "since Monday, UTC" : "Could not be read"}
            href="/admin/activity?outcome=success&range=7d"
          />
          <StatTile
            label="Failed today"
            value={stats ? n(stats.failed_today) : "—"}
            valueTone={stats && stats.failed_today > 0 ? "warning" : undefined}
            footnote={stats ? lockouts ?? "failed and blocked attempts" : "Could not be read"}
            href="/admin/activity?outcome=failure"
          />
          {/* Deliberately not called "online now" — we only know when someone logged in, not whether
              they're still using the app. Live definition counts distinct tenant users (user_id). */}
          <StatTile
            label="Signed in last 15 min"
            value={stats ? n(stats.active_last_15_min) : "—"}
            footnote={stats ? "customers, recent sign-ins" : "Could not be read"}
            labelTitle="Tenant users with a successful sign-in in the last 15 minutes. Staff are not counted, and a sign-in does not mean they are still using the app."
          />
        </StatStrip>

        <Suspense fallback={<GraphCardLoading title="Sign-ins · 14 days" />}>
          <LoginChart includeStaff={includeStaff} now={now} />
        </Suspense>

        <ActivityFeed
          initial={initial ?? { events: [], total: 0, rangeTotal: 0 }}
          filters={filters}
          lens={lens}
          page={page}
          failed={initial === null}
          viewerRole={admin.role}
        />
      </div>
    </MonitoringPage>
  );
}
