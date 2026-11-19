import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { InfoTip } from "@/components/ui/info-tip";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { DashboardRefresh } from "@/components/admin/dashboard-refresh";
import { cn } from "@/lib/utils";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { HEALTH_CHIP, healthRows, healthSummary } from "@/lib/adminDashboard/healthJobs";
import { fetchHealthInput } from "@/lib/adminDashboard/healthQueries";
import type { DashboardAdmin } from "./types";

const TITLE = "Jobs and services";
const INFO = "Every scheduled job and outside service the platform can see: what it does, when it last worked and how often it should. A row opens the page that deals with it.";

const MAINTENANCE: Record<string, string> = {
  off: "maintenance mode off",
  banner_only: "a maintenance banner is showing",
  read_only: "maintenance mode on (read only)",
  locked: "maintenance mode on (locked)",
};

async function HealthTable({ admin }: { admin: DashboardAdmin }) {
  let data: Awaited<ReturnType<typeof fetchHealthInput>>;
  try {
    data = await fetchHealthInput(admin);
  } catch (error) {
    console.error("[admin-health]", error instanceof Error ? error.message : error);
    return (
      <TableCard title={TITLE} info={INFO}>
        <ErrorState title="Couldn't load platform health" detail="The job records didn't answer just now. The rest of the page is current." action={<DashboardRefresh />} />
      </TableCard>
    );
  }
  const rows = healthRows(data.health);
  const summary = [
    healthSummary(rows),
    data.maintenance ? MAINTENANCE[data.maintenance] ?? `maintenance: ${data.maintenance}` : null,
    data.featuresOff === null ? null : data.featuresOff === 0 ? "no feature switched off" : `${data.featuresOff} feature${data.featuresOff === 1 ? "" : "s"} switched off for everyone`,
  ].filter(Boolean);

  return (
    <TableCard title={TITLE} info={INFO} description={summary.join(" · ")} action={<DashboardRefresh />}>
      <Table>
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
          {rows.map((row) => {
            const href = row.href && canOpenAdminHref(admin.role, row.href) ? row.href : null;
            const chip = HEALTH_CHIP[row.status];
            return (
              <TableRow key={row.key} className={cn(href && "relative")}>
                <TableCell className="pl-4 font-medium text-foreground">
                  <span className="inline-flex items-center gap-1">
                    {href ? (
                      <Link href={href} className="outline-none after:absolute after:inset-0 hover:underline focus-visible:underline">
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                    {/* Above the row's link, so the reason opens without leaving the page. */}
                    <span className="relative z-[1]">
                      <InfoTip label={`Why: ${row.name}`}>{row.reason}</InfoTip>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="max-w-[280px] truncate">{row.does}</TableCell>
                <TableCell className="tabular-nums">{row.lastWorked}</TableCell>
                <TableCell>{row.shouldRun}</TableCell>
                <TableCell>
                  <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                </TableCell>
                <TableCell className="pr-4 text-muted-foreground">{href ? <ChevronRight className="size-4" aria-hidden="true" /> : null}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
}

/**
 * Admin dashboard › Platform health (admin round 1, docs/design/admin-r1/dashboard-combined.html §5): one line
 * per scheduled job and outside service the platform already watches — the metrics snapshot, the billing
 * heartbeat, payment events, compliance sources, the email log, the transfer ladder, every /api/cron route the
 * database calls (app_cron_status) — and the database's own jobs once 20261117310000 is applied (until then
 * one honest "not watched yet" line). The (i) beside a name says why it has the status it has.
 */
export async function HealthTab({ admin }: { admin: DashboardAdmin }) {
  return (
    <Suspense
      fallback={
        <TableCard title={TITLE} info={INFO}>
          <SectionLoading rows={8} columns={5} label="Loading platform health" />
        </TableCard>
      }
    >
      <HealthTable admin={admin} />
    </Suspense>
  );
}
