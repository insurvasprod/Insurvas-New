import Link from "next/link";
import { Suspense } from "react";

import { StatCard, StatRow } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { DashboardRefresh } from "@/components/admin/dashboard-refresh";
import type { AdminRole } from "@/lib/adminAuth/roles";
import {
  ageWords,
  countWords,
  daysLate,
  dayLabel,
  pageLink,
  percentOf,
  trialConversion,
  wholeDollars,
} from "@/lib/adminDashboard/series";
import {
  cancellationsByPlan,
  chaseLists,
  metricsHistory,
  monthInvoiceTotals,
  planNames,
  readNow,
  snapshotFreshness,
  trialsNow,
} from "@/lib/adminDashboard/tabQueries";
import { computeChurn, formatRate } from "@/lib/metrics/churn";
import { formatCentsAsCurrency } from "@/lib/money";

import { settleCard } from "./ov-card";
import { MoneyChase, type ChaseList } from "./money-chase";
import type { DashboardAdmin } from "./types";

/**
 * Admin dashboard › Money (admin round 1, board section 3): billing ops' tab. Five figures, then what to chase
 * (overdue, don't match, past due; each row opens its record), and beside it the plans and the trials. Each
 * block streams and fails on its own. Snapshot figures (MRR, ARR, net revenue churn, by plan) are muted with
 * their age; invoices and trials are read live.
 */
export async function MoneyTab({ admin }: { admin: DashboardAdmin }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Suspense fallback={<SectionLoading rows={1} columns={5} label="Loading the money figures" />}>
        <MoneyFigures role={admin.role} />
      </Suspense>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Suspense fallback={<TableCard title="Invoices to chase"><SectionLoading rows={4} columns={5} label="Loading invoices to chase" /></TableCard>}>
          <ChaseCard role={admin.role} />
        </Suspense>
        <div className="flex min-w-0 flex-col gap-3">
          <Suspense fallback={<TableCard title="By plan"><SectionLoading rows={3} columns={4} label="Loading plans" /></TableCard>}>
            <ByPlanCard />
          </Suspense>
          <Suspense fallback={<TableCard title="Trials"><SectionLoading rows={3} columns={2} label="Loading trials" /></TableCard>}>
            <TrialsCard role={admin.role} />
          </Suspense>
        </div>
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

const muted = (text: string, stale: boolean) => (stale ? <span className="text-muted-foreground">{text}</span> : text);

async function MoneyFigures({ role }: { role: AdminRole }) {
  const data = await settleCard("money figures", async () => {
    const [days, fresh, month, chase] = await Promise.all([metricsHistory(), snapshotFreshness(), monthInvoiceTotals(), chaseLists()]);
    return { days, fresh, month, chase };
  });
  if (!data) return <CouldNotLoad title="Money figures" />;
  const { days, fresh, month, chase } = data;
  const latest = days.at(-1);
  const age = fresh.isStale ? ageWords(fresh.ageDays) : null;
  // Net revenue churn over the 30 snapshot days ending on the newest one (the Revenue page's window).
  const cutoff = latest ? new Date(Date.parse(`${latest.date}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10) : "";
  const month30 = days.filter((day) => day.date > cutoff);
  const base = month30[0]?.mrr_cents ?? 0;
  const churn = computeChurn({
    customersAtStart: month30[0]?.active_customers ?? 0,
    customersChurned: month30.reduce((sum, day) => sum + day.churned_customers, 0),
    mrrAtStart: base,
    churnedMrrCents: month30.reduce((sum, day) => sum + day.churned_mrr_cents, 0),
    expansionMrrCents: month30.reduce((sum, day) => sum + day.expansion_mrr_cents, 0),
    contractionMrrCents: month30.reduce((sum, day) => sum + day.contraction_mrr_cents, 0),
  });
  const revenue = pageLink(role, "/admin/revenue") ?? undefined;
  const invoices = pageLink(role, "/admin/invoices") ?? undefined;
  const collectedShare = percentOf(month.collectedCents, month.invoicedCents);

  return (
    <StatRow label="Money figures">
      <StatCard label="MRR" value={latest ? muted(wholeDollars(latest.mrr_cents), fresh.isStale) : "—"} period={age ?? (latest ? "contracted" : "no figures yet")} href={revenue} />
      <StatCard label="ARR" value={latest ? muted(wholeDollars(latest.arr_cents), fresh.isStale) : "—"} period={age ?? "MRR × 12"} href={revenue} />
      <StatCard label="Collected this month" value={wholeDollars(month.collectedCents)} period={collectedShare !== null ? `${collectedShare}% of invoiced` : "nothing invoiced yet"} href={invoices} />
      <StatCard
        label="Overdue"
        value={chase.overdueCount.toLocaleString("en-US")}
        period={`${chase.overdueCount === 1 ? "invoice" : "invoices"} · ${wholeDollars(chase.overdueCents)}`}
        tone={chase.overdueCount > 0 ? "warn" : "default"}
        href={invoices}
      />
      <StatCard
        label="Net revenue churn"
        value={base > 0 ? muted(formatRate(churn.netRevenueChurnRate), fresh.isStale) : "—"}
        period={base > 0 ? (age ? `30 days to ${dayLabel(latest!.date)} · ${age}` : "last 30 days") : "no MRR at the start, so no rate"}
        href={revenue}
      />
    </StatRow>
  );
}

async function ChaseCard({ role }: { role: AdminRole }) {
  const data = await settleCard("invoices to chase", async () => ({ chase: await chaseLists(), now: readNow() }));
  if (!data) return <CouldNotLoad title="Invoices to chase" />;
  const { chase, now } = data;
  const invoiceHref = (id: string) => pageLink(role, `/admin/invoices/${id}`);
  const date = (iso: string | null) => (iso ? dayLabel(iso.slice(0, 10)) : "—");
  const invoicesMore = pageLink(role, "/admin/invoices");
  const subscriptionsMore = pageLink(role, "/admin/subscriptions");

  const lists: ChaseList[] = [
    {
      key: "overdue",
      label: "Overdue",
      count: chase.overdueCount,
      firstLabel: "Invoice",
      amountLabel: "Amount",
      dateLabel: "Due",
      more: invoicesMore ? { href: invoicesMore, label: "Open in Invoices" } : null,
      rows: chase.overdue.map((invoice) => {
        const late = daysLate(invoice.dueAt, now);
        return {
          key: invoice.id,
          name: invoice.number,
          customer: invoice.tenantName,
          amount: formatCentsAsCurrency(invoice.totalCents),
          date: date(invoice.dueAt),
          chip: { label: late > 0 ? `${countWords(late, "day", "days")} late` : "Overdue", tone: "warning" },
          href: invoiceHref(invoice.id),
        };
      }),
    },
    {
      key: "mismatched",
      label: "Don't match",
      count: chase.mismatchedCount,
      firstLabel: "Invoice",
      amountLabel: "Billed",
      dateLabel: "Due",
      more: invoicesMore ? { href: invoicesMore, label: "Open in Invoices" } : null,
      rows: chase.mismatched.map((invoice) => ({
        key: invoice.id,
        name: invoice.number,
        customer: invoice.tenantName,
        amount: formatCentsAsCurrency(invoice.totalCents),
        date: date(invoice.dueAt),
        chip: { label: invoice.providerTotalCents !== null ? `Charged ${formatCentsAsCurrency(invoice.providerTotalCents)}` : "Doesn't match", tone: "danger" },
        href: invoiceHref(invoice.id),
      })),
    },
    {
      key: "pastDue",
      label: "Past due",
      count: chase.pastDueCount,
      firstLabel: "Customer",
      amountLabel: "",
      dateLabel: "Period ended",
      more: subscriptionsMore ? { href: subscriptionsMore, label: "Open in Subscriptions" } : null,
      rows: chase.pastDue.map((subscription) => ({
        key: subscription.id,
        name: subscription.tenantName,
        customer: subscription.planName ?? "—",
        amount: "",
        date: date(subscription.periodEnd),
        chip: { label: "Past due", tone: "warning" },
        href: pageLink(role, `/admin/tenants/${subscription.tenantId}`),
      })),
    },
  ];

  return <MoneyChase lists={lists} />;
}

async function ByPlanCard() {
  const data = await settleCard("by plan", async () => {
    const [days, fresh, names, cancelled] = await Promise.all([metricsHistory(), snapshotFreshness(), planNames(), cancellationsByPlan()]);
    return { days, fresh, names, cancelled };
  });
  if (!data) return <CouldNotLoad title="By plan" />;
  const { days, fresh, names, cancelled } = data;
  const latest = days.at(-1);
  const rows = Object.entries(latest?.plan_breakdown ?? {}).sort((a, b) => b[1].mrr_cents - a[1].mrr_cents);
  const age = fresh.isStale ? ageWords(fresh.ageDays) : null;

  return (
    <TableCard title="By plan" description={`${age ? `Customers and MRR are ${age}. ` : ""}Cancelled: the last 30 days, live.`}>
      {rows.length === 0 ? (
        <EmptyState title="No revenue to split yet" hint="It fills in once a subscription has billed at least once." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Customers</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead className="text-right">Cancelled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([code, stats]) => (
              <TableRow key={code}>
                <TableCell className="font-medium">{names.get(code) ?? code}</TableCell>
                <TableCell className="text-right tabular-nums">{stats.customers.toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right tabular-nums">{wholeDollars(stats.mrr_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">{(cancelled.get(code) ?? 0).toLocaleString("en-US")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

async function TrialsCard({ role }: { role: AdminRole }) {
  const data = await settleCard("trials", () => trialsNow());
  if (!data) return <CouldNotLoad title="Trials" />;
  const conversion = trialConversion(data.endedLast30);
  const trials = pageLink(role, "/admin/trials");
  const rows: [string, string][] = [
    ["In flight", data.inFlight.toLocaleString("en-US")],
    ["Ending within 2 days", data.endingWithinTwoDays.toLocaleString("en-US")],
    ["Became paid · 30 days", conversion.ended ? `${conversion.converted.toLocaleString("en-US")} of ${conversion.ended.toLocaleString("en-US")}` : "none ended"],
  ];
  return (
    <TableCard title="Trials" action={trials ? <Link href={trials} className="text-xs text-muted-foreground hover:text-foreground">Trials ›</Link> : undefined}>
      <Table>
        <TableBody>
          {rows.map(([label, value]) => (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              <TableCell className="text-right tabular-nums">{value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
