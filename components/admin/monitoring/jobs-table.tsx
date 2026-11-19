"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { JobsSheet } from "@/components/admin/monitoring/jobs-sheet";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { InfoTip } from "@/components/ui/info-tip";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { HEALTH_CHIP } from "@/lib/adminDashboard/healthJobs";
import type { JobDetail } from "@/lib/adminMonitoring/jobsView";

/**
 * The Jobs & services list (admin round 1, monitoring.html screen 6): the dashboard's Platform health rows — every job
 * and outside service, what it does, when it last worked, how often it should run, its status, failing first, the
 * "not watched yet" line for the database's own jobs — one line each. A row opens its sheet (`?job=` in the address).
 */
export function JobsTable({ jobs, role, canRun, now }: { jobs: JobDetail[]; role: AdminRole; canRun: boolean; now: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const openKey = params.get("job");
  const open = openKey ? jobs.find((job) => job.key === openKey) ?? null : null;
  const select = (key: string) => setParamsInPlace({ job: key });

  return (
    <>
      <TableCard
        className="min-w-0"
        toolbar={<DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />} />}
      >
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Job or service</TableHead>
              <TableHead>What it does</TableHead>
              <TableHead>Last worked</TableHead>
              <TableHead>Should run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10 pr-4"><span className="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const chip = HEALTH_CHIP[job.status];
              return (
                <TableRow
                  key={job.key}
                  tabIndex={0}
                  className="cursor-pointer outline-none focus-visible:bg-[var(--hover-wash)]"
                  aria-selected={openKey === job.key}
                  aria-label={`${job.name}: ${chip.label}. Open details.`}
                  onClick={() => select(job.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      select(job.key);
                    }
                  }}
                >
                  <TableCell className="pl-4 font-medium text-foreground">
                    <span className="inline-flex items-center gap-1">
                      {job.name}
                      {/* The reason opens without opening the sheet, as on the dashboard tab. */}
                      <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <InfoTip label={`Why: ${job.name}`}>{job.reason}</InfoTip>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate">{job.does}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{job.lastWorked}</TableCell>
                  <TableCell className="whitespace-nowrap">{job.shouldRun}</TableCell>
                  <TableCell><StatusChip tone={chip.tone} dot>{chip.label}</StatusChip></TableCell>
                  <TableCell className="pr-4 text-right text-muted-foreground" aria-hidden="true">›</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableCard>

      {open && <JobsSheet key={open.key} job={open} role={role} canRun={canRun} now={now} onClose={() => setParamsInPlace({ job: null })} />}
    </>
  );
}
