import { redirect } from "next/navigation";

import { LockTable } from "@/components/admin/monitoring/lock-table";
import { LockTabs } from "@/components/admin/monitoring/lock-tabs";
import { MonitoringPage } from "@/components/admin/monitoring/monitoring-page";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { type LockoutEntry } from "@/lib/loginEvents/lockouts";
import { fetchLockouts } from "@/lib/loginEvents/queries";
import { getSetting } from "@/lib/settings/queries";

async function read(now: number): Promise<{ entries: LockoutEntry[]; threshold: number | null; minutes: number | null } | null> {
  try {
    const [entries, threshold, minutes] = await Promise.all([fetchLockouts(now), getSetting<number>("security.lockout_threshold"), getSetting<number>("security.lockout_minutes")]);
    return { entries, threshold, minutes };
  } catch (error) {
    console.error("[admin-lockouts]", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The request's clock, read once. */
function readNow(): number {
  return Date.now();
}

/**
 * Monitoring › Lockouts (admin round 1, docs/design/admin-r1/monitoring.html screen 3), moved from the Login
 * protection panel under Platform › Advanced, which keeps the settings and links here. Super admin only, as the
 * panel and its route are: lockouts are security state.
 */
export default async function LockoutsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (admin.role !== "super_admin") redirect("/admin/monitoring");

  const now = readNow();
  const data = await read(now);
  const entries = data?.entries ?? [];
  const locked = entries.filter((entry) => entry.unlocksAt);

  return (
    <MonitoringPage
      step="lockouts"
      info="Accounts and addresses locked after repeated failed sign-ins. Unlock lets them try again now; it is recorded in the audit log."
      tabs={<LockTabs locked={data ? locked.length : null} recorded={data ? entries.length : null} />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <LockTable entries={entries} nowIso={new Date(now).toISOString()} failed={data === null} />
      </div>
    </MonitoringPage>
  );
}
