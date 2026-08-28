import { redirect } from "next/navigation";
import { LogIn, CalendarRange, ShieldAlert, Radio } from "lucide-react";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewUsers } from "@/lib/users/permissions";
import { fetchLoginActivityPage, fetchLoginActivityStats } from "@/lib/loginEvents/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ActivityFeed } from "@/components/admin/activity-feed";

export default async function ActivityPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewUsers(admin.role)) redirect("/admin");

  const [stats, { events, total }] = await Promise.all([
    fetchLoginActivityStats(),
    fetchLoginActivityPage({ page: 1 }),
  ]);

  const tiles = [
    { label: "Logins today", value: stats.logins_today, icon: LogIn },
    { label: "Logins this week", value: stats.logins_this_week, icon: CalendarRange },
    { label: "Failed today", value: stats.failed_today, icon: ShieldAlert },
    // Deliberately not called "online now" — we only know when someone logged in, not whether
    // they're still using the app.
    { label: "Signed in last 15 min", value: stats.active_last_15_min, icon: Radio },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <AdminPageHeader
        title="Login activity"
        subtitle="Every sign-in attempt across the platform, for tenant users and admins alike."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold tracking-tight">{value.toLocaleString()}</p>
              </div>
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]">
                <Icon className="size-4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ActivityFeed initialEvents={events} initialTotal={total} />
    </div>
  );
}
