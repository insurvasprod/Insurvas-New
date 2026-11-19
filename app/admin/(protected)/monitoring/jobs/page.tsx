import { Suspense } from "react";
import { redirect } from "next/navigation";

import { JobsTable } from "@/components/admin/monitoring/jobs-table";
import { MonitoringPage } from "@/components/admin/monitoring/monitoring-page";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { healthRows } from "@/lib/adminDashboard/healthJobs";
import { fetchHealthInput } from "@/lib/adminDashboard/healthQueries";
import { jobDetails } from "@/lib/adminMonitoring/jobsView";

async function Jobs({ admin }: { admin: { id: string; role: AdminRole } }) {
  let data: Awaited<ReturnType<typeof fetchHealthInput>>;
  try {
    data = await fetchHealthInput(admin);
  } catch (error) {
    console.error("[monitoring/jobs]", error instanceof Error ? error.message : error);
    return (
      <>
        <TableCard>
          <ErrorState title="Couldn't load jobs and services" detail="The job records didn't answer just now. Nothing is shown rather than a list that looks healthy." />
        </TableCard>
      </>
    );
  }
  const rows = healthRows(data.health);
  const jobs = jobDetails(data.health, rows);

  return (
    <>
      <JobsTable jobs={jobs} role={admin.role} canRun={admin.role === "super_admin"} now={data.health.now} />
    </>
  );
}

/**
 * Admin › Monitoring › Jobs & services (admin round 1, docs/design/admin-r1/monitoring.html screen 6): the dashboard's
 * Platform health list given a home — the same reads (lib/adminDashboard/healthQueries.ts) and verdicts
 * (healthJobs.ts) — with each job's own sheet and, for a super admin, Run now on app jobs. Any staff role, as the
 * dashboard tab, which stays. The frame shows at once; the list streams in.
 */
export default async function JobsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");

  return (
    <MonitoringPage
      step="jobs"
      info="Every scheduled job and outside service the platform can see: what it does, when it last worked and how often it should. A row opens the job: its recent calls, why it fails and how to fix it."
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <Suspense
          fallback={
            <TableCard>
              <SectionLoading rows={8} columns={5} label="Loading jobs and services" />
            </TableCard>
          }
        >
          <Jobs admin={{ id: admin.id, role: admin.role }} />
        </Suspense>
      </div>
    </MonitoringPage>
  );
}
