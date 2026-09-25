import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewUsers } from "@/lib/users/permissions";
import {
  fetchActiveLockoutEmails,
  fetchLoginActivityPage,
  fetchLoginActivityStats,
} from "@/lib/loginEvents/queries";
import { DEFAULT_ACTIVITY_FILTERS, weekOverWeek } from "@/lib/loginEvents/present";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { ActivityFeed } from "@/components/admin/activity-feed";
import { Callout } from "@/components/app/settings/primitives";

/** Lockouts are security state: only super_admin reads them, as on /admin/advanced. */
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

export default async function ActivityPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewUsers(admin.role)) redirect("/admin");

  const [stats, initial, lockouts] = await Promise.all([
    fetchLoginActivityStats(),
    fetchLoginActivityPage({ page: 1, filters: DEFAULT_ACTIVITY_FILTERS }),
    lockoutFootnote(admin.role === "super_admin"),
  ]);

  return (
    <div className="m-stagger flex w-full min-w-0 flex-1 flex-col gap-6">
      <AdminPageHeader
        title="Login activity"
        subtitle="Every sign-in attempt across the platform, tenant users and admins alike."
      />

      <BoardStatGrid>
        <BoardStatTile
          label="Logins today"
          value={stats.logins_today.toLocaleString("en-US")}
          footnote="all tenants and staff, UTC day"
        />
        <BoardStatTile
          label="Logins this week"
          value={stats.logins_this_week.toLocaleString("en-US")}
          footnote={weekOverWeek(stats.logins_this_week, stats.logins_last_week_to_date) ?? "since Monday, UTC"}
        />
        <BoardStatTile
          label="Failed today"
          value={stats.failed_today.toLocaleString("en-US")}
          tone={stats.failed_today > 0 ? "warning" : "default"}
          footnote={lockouts ?? "failed and blocked attempts"}
        />
        {/* Deliberately not called "online now" — we only know when someone logged in, not whether
            they're still using the app. Live definition counts distinct tenant users (user_id). */}
        <BoardStatTile
          label="Signed in last 15 min"
          value={stats.active_last_15_min.toLocaleString("en-US")}
          footnote="tenant users; logged in recently, not necessarily still here"
        />
      </BoardStatGrid>

      <ActivityFeed initial={initial} />

      <Callout tone="info" title="“Signed in last 15 min” is not “online now”">
        It counts tenant users with a successful sign-in in the last 15 minutes; staff sign-ins are not
        in it. We record when someone signs in, not whether they are still using the app. Failed and
        blocked attempts are marked with a red edge rather than a red row, and repeated blocked
        attempts from one email and IP are logged at most once a minute.
      </Callout>
    </div>
  );
}
