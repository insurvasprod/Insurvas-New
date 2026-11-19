import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { BarList } from "@/components/ui/chart";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { DashboardRefresh } from "@/components/admin/dashboard-refresh";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { funnelView, pageLink, type DashPeriod } from "@/lib/adminDashboard/series";
import { lastSevenDays, seatLimited, signupFunnel } from "@/lib/adminDashboard/tabQueries";

import { settleCard } from "./ov-card";
import { ByPeriod, PeriodSwitch } from "./ov-period";
import type { DashboardAdmin } from "./types";

/**
 * Admin dashboard › Customers (admin round 1, board section 4): where new agencies stop, and who needs a
 * hand. The sign-up funnel (30 or 90 days, in the address) with its biggest drop said in words; the customers
 * at their seat limit (one line each, opening the customer); and the last seven days. Each block streams and
 * fails on its own.
 */

const PERIODS = ["30d", "90d"] as const satisfies readonly DashPeriod[];
const FALLBACK = "90d";
const DAYS = { "30d": 30, "90d": 90 } as const;
const SEATS_SHOWN = 6;

export async function CustomersTab({ admin }: { admin: DashboardAdmin }) {
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Suspense fallback={<TableCard title="Sign-up funnel"><SectionLoading rows={6} columns={3} label="Loading the sign-up funnel" /></TableCard>}>
        <FunnelCard role={admin.role} />
      </Suspense>
      <div className="flex min-w-0 flex-col gap-3">
        <Suspense fallback={<TableCard title="At their seat limit"><SectionLoading rows={3} columns={2} label="Loading seat limits" /></TableCard>}>
          <SeatLimitCard role={admin.role} />
        </Suspense>
        <Suspense fallback={<TableCard title="Last 7 days"><SectionLoading rows={4} columns={2} label="Loading the last 7 days" /></TableCard>}>
          <LastSevenDaysCard role={admin.role} />
        </Suspense>
      </div>
    </div>
  );
}

function CouldNotLoad({ title }: { title: string }) {
  return (
    <TableCard title={title}>
      <EmptyState title="Couldn't load this" hint="Its figures didn't answer. The rest of the page is current." action={<DashboardRefresh />} />
    </TableCard>
  );
}

async function FunnelCard({ role }: { role: AdminRole }) {
  const data = await settleCard("sign-up funnel", async () => {
    const [d30, d90] = await Promise.all([signupFunnel(30), signupFunnel(90)]);
    return { "30d": d30, "90d": d90 };
  });
  if (!data) return <CouldNotLoad title="Sign-up funnel" />;
  const tenants = pageLink(role, "/admin/tenants");

  const views: Partial<Record<DashPeriod, ReactNode>> = {};
  for (const period of PERIODS) {
    const view = funnelView(data[period]);
    const signedUp = view.rows[0]?.count ?? 0;
    views[period] = (
      <TableCard
        title="Sign-up funnel"
        description={signedUp > 0 ? view.dropWords ?? "No step loses anyone yet." : undefined}
        action={<PeriodSwitch periods={PERIODS} fallback={FALLBACK} label="Funnel period" />}
        footer={tenants ? <div className="px-4 py-3 text-xs text-muted-foreground"><Link href={tenants} className="text-foreground hover:underline">Open Customers</Link> to see who is at each step.</div> : undefined}
      >
        <div className="px-4 pb-4">
          {signedUp > 0 ? (
            <BarList
              rows={view.rows.map((row) => ({
                key: row.label,
                label: row.label,
                value: row.count ?? 0,
                figure: row.measured && row.count !== null ? row.count.toLocaleString("en-US") : "—",
                caption: row.measured && row.share !== null ? `${row.share}%` : row.note,
                tone: row.drop ? "warning" : undefined,
              }))}
              summary={`Sign-up funnel over the last ${DAYS[period]} days${view.dropWords ? `. ${view.dropWords}` : ""}`}
              unit="customers"
              labelWidth="10rem"
            />
          ) : (
            <EmptyState title="No sign-ups yet" hint={`Nobody signed up in the last ${DAYS[period]} days.`} />
          )}
        </div>
      </TableCard>
    );
  }
  return <ByPeriod views={views} periods={PERIODS} fallback={FALLBACK} />;
}

async function SeatLimitCard({ role }: { role: AdminRole }) {
  const rows = await settleCard("seat limits", () => seatLimited());
  if (!rows) return <CouldNotLoad title="At their seat limit" />;
  const rest = rows.length - Math.min(rows.length, SEATS_SHOWN);
  const tenants = pageLink(role, "/admin/tenants");

  return (
    <TableCard
      title="At their seat limit"
      action={<StatusChip>{rows.length.toLocaleString("en-US")}</StatusChip>}
      footer={rest > 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          and {rest.toLocaleString("en-US")} more{tenants && <> · <Link href={tenants} className="text-foreground hover:underline">Open Customers</Link></>}
        </div>
      ) : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState title="Nobody is at their limit" hint="No customer has used every seat their plan includes." />
      ) : (
        <Table>
          <TableBody>
            {rows.slice(0, SEATS_SHOWN).map((row) => {
              const href = pageLink(role, `/admin/tenants/${row.tenantId}`);
              return (
                <TableRow key={row.tenantId}>
                  <TableCell className="max-w-[18rem] truncate font-medium">
                    {href ? <Link href={href} className="hover:underline">{row.tenantName}</Link> : row.tenantName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.used.toLocaleString("en-US")} of {row.max.toLocaleString("en-US")}</TableCell>
                  <TableCell className="w-6 text-right text-muted-foreground" aria-hidden="true">{href ? "›" : ""}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

async function LastSevenDaysCard({ role }: { role: AdminRole }) {
  const data = await settleCard("last 7 days", () => lastSevenDays());
  if (!data) return <CouldNotLoad title="Last 7 days" />;
  const tenants = pageLink(role, "/admin/tenants");
  const users = pageLink(role, "/admin/users");
  const subscriptions = pageLink(role, "/admin/subscriptions");
  const rows: { label: string; value: number; href: string | null; isNew?: boolean }[] = [
    { label: "New sign-ups", value: data.signups, href: tenants, isNew: true },
    { label: "Cancellations", value: data.cancellations, href: subscriptions },
    { label: "Invitations unanswered after 7 days", value: data.staleInvitations, href: users },
    { label: "Suspended now", value: data.suspended, href: tenants },
  ];

  return (
    <TableCard title="Last 7 days">
      <Table>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.href ? <Link href={row.href} className="hover:underline">{row.label}</Link> : row.label}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.isNew && row.value > 0 ? (
                  // Gold is for counts of new things (the brand's third colour, never a status).
                  <span className="inline-flex h-[22px] items-center rounded-badge bg-[var(--highlight-soft)] px-2 text-xs font-semibold text-[var(--highlight-ink)]">{row.value.toLocaleString("en-US")}</span>
                ) : (
                  row.value.toLocaleString("en-US")
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
