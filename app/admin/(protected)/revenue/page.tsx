import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { fetchMetrics, fetchFunnel, biggestDropOff } from "@/lib/metrics/queries";
import { computeChurn, formatRate } from "@/lib/metrics/churn";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCentsAsCurrency } from "@/lib/money";
import { tableHeaderRow, tableHeadCell, tableShell } from "@/components/admin/table-styles";

export default async function RevenuePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const [days, funnel] = await Promise.all([fetchMetrics(31), fetchFunnel(90)]);

  const latest = days.at(-1);
  const monthAgo = days[0];

  const churn = computeChurn({
    customersAtStart: monthAgo?.active_customers ?? 0,
    customersChurned: days.reduce((sum, d) => sum + d.churned_customers, 0),
    mrrAtStart: monthAgo?.mrr_cents ?? 0,
    churnedMrrCents: days.reduce((sum, d) => sum + d.churned_mrr_cents, 0),
    expansionMrrCents: days.reduce((sum, d) => sum + d.expansion_mrr_cents, 0),
    contractionMrrCents: days.reduce((sum, d) => sum + d.contraction_mrr_cents, 0),
  });

  const mrr = latest?.mrr_cents ?? 0;
  const mrrChange = mrr - (monthAgo?.mrr_cents ?? 0);
  const collectedThisMonth = days.reduce((sum, d) => sum + d.collected_cents, 0);
  const arpc = latest && latest.active_customers > 0 ? Math.round(mrr / latest.active_customers) : 0;

  // Contracted and collected disagreeing is the portfolio-level version of a mismatched invoice.
  // Shown rather than reconciled away, because the gap IS the finding.
  const contractedThisMonth = days.reduce((sum, d) => sum + d.new_mrr_cents, 0);
  const gap = collectedThisMonth - contractedThisMonth;

  const planRows = Object.entries(latest?.plan_breakdown ?? {});

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Revenue" subtitle="Recurring revenue, churn, and where signups fall out" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "MRR (contracted)", value: formatCentsAsCurrency(mrr) },
          { label: "ARR", value: formatCentsAsCurrency(latest?.arr_cents ?? 0) },
          {
            label: "Collected (30d)",
            value: formatCentsAsCurrency(collectedThisMonth),
            hint: "What actually landed, from recorded payments",
          },
          { label: "Avg revenue per customer", value: formatCentsAsCurrency(arpc) },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardContent>
              <p className="text-sm text-muted-foreground" title={tile.hint}>{tile.label}</p>
              <p className="mt-1 text-2xl font-bold">{tile.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {mrr === 0 && collectedThisMonth > 0 && (
        <Card className="border-[var(--color-warning)]/40">
          <CardContent className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-warning)]" />
            <div className="text-sm">
              <p className="font-medium text-[var(--color-warning)]">
                Money is being collected but no subscription is recorded
              </p>
              <p className="mt-1 text-muted-foreground">
                {formatCentsAsCurrency(collectedThisMonth)} was received in the last 30 days, and contracted
                MRR is {formatCentsAsCurrency(mrr)}. A customer who bought through provider checkout does not
                get a subscription on our side automatically, so they are invisible to every figure on this
                page except the collected one.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">MRR movement</h2>
            <dl className="space-y-1.5 text-sm">
              {[
                ["Month-over-month", `${mrrChange >= 0 ? "+" : ""}${formatCentsAsCurrency(mrrChange)}`],
                ["New", formatCentsAsCurrency(days.reduce((s, d) => s + d.new_mrr_cents, 0))],
                ["Churned", formatCentsAsCurrency(days.reduce((s, d) => s + d.churned_mrr_cents, 0))],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
              {/* Kept separate rather than netted, per the ticket — and honest that they are not
                  measured rather than showing a confident zero. */}
              {["Expansion", "Contraction"].map((label) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-xs text-muted-foreground">not measured</dd>
                </div>
              ))}
            </dl>
            {gap !== 0 && (
              <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                Collected differs from contracted by {formatCentsAsCurrency(Math.abs(gap))} over this window.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
              Customers &amp; churn
            </h2>
            <dl className="space-y-1.5 text-sm">
              {[
                ["Active customers", String(latest?.active_customers ?? 0)],
                ["New this month", String(days.reduce((s, d) => s + d.new_customers, 0))],
                ["Churned this month", String(days.reduce((s, d) => s + d.churned_customers, 0))],
                ["Trials in flight", String(latest?.trials_active ?? 0)],
                ["Logo churn", formatRate(churn.logoChurnRate)],
                ["Net revenue churn", formatRate(churn.netRevenueChurnRate)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {churn.netRevenueChurnRate < 0 && (
              <p className="text-xs text-[var(--color-success)]">
                Negative net revenue churn — expansion is outrunning churn.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Plan</TableHead>
              <TableHead className={tableHeadCell}>Customers</TableHead>
              <TableHead className={tableHeadCell}>MRR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {planRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  No subscriptions recorded, so there is no revenue to break down by plan.
                </TableCell>
              </TableRow>
            ) : (
              planRows.map(([code, stats]) => (
                <TableRow key={code}>
                  <TableCell className="font-medium">{code}</TableCell>
                  <TableCell>{stats.customers}</TableCell>
                  <TableCell>{formatCentsAsCurrency(stats.mrr_cents)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">
            Activation funnel · last 90 days
          </h2>

          <div className="space-y-1.5">
            {funnel.map((step) => (
              <div key={step.label} className="flex items-center justify-between gap-3 text-sm">
                <span className={step.measured ? "" : "text-muted-foreground"}>
                  {step.label}
                  {step.note && <span className="ml-2 text-xs text-muted-foreground">{step.note}</span>}
                </span>
                <span className={step.measured ? "font-medium" : "text-xs text-muted-foreground"}>
                  {step.measured ? step.count : "not instrumented"}
                </span>
              </div>
            ))}
          </div>

          {/* Stated in words, per the ticket — and unmeasured steps are skipped rather than counted
              as zero, which would always name them as the biggest drop and make this a lie. */}
          <p className="border-t border-border pt-2 text-sm">{biggestDropOff(funnel)}</p>
        </CardContent>
      </Card>
    </div>
  );
}
