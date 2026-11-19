import "server-only";

import { fetchMetrics, fetchFunnel, fetchSnapshotFreshness, biggestDropOff, type MetricsDay } from "@/lib/metrics/queries";
import { computeChurn, formatRate } from "@/lib/metrics/churn";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { RevExportButton } from "@/components/admin/billing/rev-export-button";
import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { Card } from "@/components/ui/card";
import { ChartHeading } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { PeriodMenu } from "@/components/ui/period-menu";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { formatCentsAsCurrency } from "@/lib/money";
import { COHORT_OFFSETS, REVENUE_PERIODS, cohortTable, type CohortSubscription, type RevenuePeriod } from "@/lib/revenue/present";
import { cn } from "@/lib/utils";

const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
// Hand-built: this Node's ICU prints "Sept" for September.
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT = { format: (d: Date) => `${NAMES[d.getUTCMonth()]} ${d.getUTCDate()}` };
const MONTH = { format: (d: Date) => `${NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${formatCentsAsCurrency(Math.abs(cents))}`;
const pct = (share: number | null) => (share === null ? "" : `${Math.round(share * 100)}%`);

/** Gross revenue churn over one run of snapshot days: what was lost ÷ MRR on the first day. */
function grossChurn(window: MetricsDay[]) {
  const base = window[0]?.mrr_cents ?? 0;
  return computeChurn({
    customersAtStart: window[0]?.active_customers ?? 0,
    customersChurned: window.reduce((s, d) => s + d.churned_customers, 0),
    mrrAtStart: base,
    churnedMrrCents: window.reduce((s, d) => s + d.churned_mrr_cents, 0),
    expansionMrrCents: window.reduce((s, d) => s + d.expansion_mrr_cents, 0),
    contractionMrrCents: window.reduce((s, d) => s + d.contraction_mrr_cents, 0),
  });
}

/**
 * The revenue board (admin round 1, billing-r2 screen 11), for an admin the page has already checked. Everything the
 * old board had — the four tiles, MRR movement with Unexplained and Net, the activation funnel, plan mix with share,
 * customers & churn — over the period in the URL (30 days, 90 days, 12 months; a filter button on the title line, owner
 * 2026-11-18), a cohort table from the subscriptions' own start and end dates, and Export CSV. No status line over the
 * cards (owner 2026-11-18) except when no metrics exist yet, so absent figures never read as zero.
 */
export async function RevenueView({ periodKey }: { periodKey: RevenuePeriod }) {
  const period = REVENUE_PERIODS.find((p) => p.key === periodKey) ?? REVENUE_PERIODS[0];
  const renderedAt = new Date();
  const windowStart = new Date(renderedAt.getTime() - period.days * 86_400_000);
  const db = getSupabaseServiceClient();
  const [history, funnel, freshness, invoicedResult, subscriptionsResult] = await Promise.all([
    // The longer history feeds the 6-month churn mean, whatever the period.
    fetchMetrics(Math.max(183, period.days + 1)),
    fetchFunnel(period.days),
    fetchSnapshotFreshness(),
    db.from("platform_invoices").select("total_cents").neq("status", "void").gte("created_at", windowStart.toISOString()),
    db.from("subscriptions").select("started_at, cancelled_at, status"),
  ]);
  if (invoicedResult.error) throw new Error(`Could not read invoices: ${invoicedResult.error.message}`);
  if (subscriptionsResult.error) throw new Error(`Could not read subscriptions: ${subscriptionsResult.error.message}`);

  // The period's snapshot days (one more than its length, so the first day is the base).
  const cutoff = new Date(renderedAt.getTime() - (period.days + 1) * 86_400_000).toISOString().slice(0, 10);
  const days = history.filter((d) => d.date >= cutoff);
  const latest = days.at(-1);
  const first = days[0];

  const churn = grossChurn(days);
  // Six consecutive 30-day windows, newest first; only windows that started with revenue count.
  const windows: MetricsDay[][] = [];
  for (let end = history.length; end > 0 && windows.length < 6; end -= 30) windows.push(history.slice(Math.max(0, end - 30), end));
  const measured = windows.filter((w) => w.length >= 20 && (w[0]?.mrr_cents ?? 0) > 0).map((w) => grossChurn(w).grossRevenueChurnRate);
  const sixMonthMean = measured.length >= 2 ? measured.reduce((a, b) => a + b, 0) / measured.length : null;

  const mrr = latest?.mrr_cents ?? 0;
  const base = first?.mrr_cents ?? 0;
  const collected = days.reduce((sum, d) => sum + d.collected_cents, 0);
  const invoiced = (invoicedResult.data ?? []).reduce((sum, row) => sum + (row.total_cents as number), 0);
  const arpc = latest && latest.active_customers > 0 ? Math.round(mrr / latest.active_customers) : 0;
  const newCustomers = days.reduce((s, d) => s + d.new_customers, 0);
  const churnedCustomers = days.reduce((s, d) => s + d.churned_customers, 0);

  const newMrr = days.reduce((s, d) => s + d.new_mrr_cents, 0);
  const churned = days.reduce((s, d) => s + d.churned_mrr_cents, 0);
  const expansion = days.reduce((s, d) => s + d.expansion_mrr_cents, 0);
  const contraction = days.reduce((s, d) => s + d.contraction_mrr_cents, 0);
  // Expansion and contraction are columns the snapshot has but nothing records yet: shown as "not measured", never
  // as a confident zero bar, and the unexplained remainder is shown rather than letting the waterfall not add up.
  const movementMeasured = expansion !== 0 || contraction !== 0;
  const net = mrr - base;
  const unexplained = net - (newMrr + expansion - contraction - churned);
  const bars = [
    { label: "New", cents: newMrr, measured: true, tone: "bg-[var(--primary)]" },
    { label: "Expansion", cents: expansion, measured: movementMeasured, tone: "bg-[var(--highlight)]" },
    { label: "Contraction", cents: -contraction, measured: movementMeasured, tone: "bg-[var(--border-strong)]" },
    { label: "Churn", cents: -churned, measured: true, tone: "bg-[var(--warning)]" },
    { label: "Unexplained", cents: unexplained, measured: true, tone: "bg-[var(--surface-alt)] border border-dashed border-[var(--border-strong)]" },
    { label: "Net", cents: net, measured: true, tone: "bg-[var(--accent-ink)]" },
  ];
  const tallest = Math.max(1, ...bars.filter((b) => b.measured).map((b) => Math.abs(b.cents)));

  const planRows = Object.entries(latest?.plan_breakdown ?? {}).sort((a, b) => b[1].mrr_cents - a[1].mrr_cents);
  const signups = funnel[0]?.measured ? funnel[0].count ?? 0 : null;
  const cohorts = cohortTable((subscriptionsResult.data ?? []) as CohortSubscription[], renderedAt);

  // Every figure here is read from a nightly snapshot, and a page that cannot say how old its numbers are will
  // present stale ones as current (fetchSnapshotFreshness).
  const { date: snapshotDate, ageDays: snapshotAgeDays, isStale: snapshotIsStale } = freshness;
  const snapshotLabel = snapshotDate ? SHORT.format(new Date(`${snapshotDate}T00:00:00Z`)) : null;
  const stale = (text: string) => (snapshotIsStale ? <span className="text-muted-foreground">{text}</span> : text);
  const staleNote = snapshotIsStale && snapshotAgeDays !== null ? `${snapshotAgeDays} days old` : null;

  const customersRows: Array<[string, string]> = [
    ["Active customers", (latest?.active_customers ?? 0).toLocaleString("en-US")],
    ["Average revenue per customer", formatCentsAsCurrency(arpc)],
    [`New in ${period.short}`, newCustomers.toLocaleString("en-US")],
    [`Churned in ${period.short}`, churnedCustomers.toLocaleString("en-US")],
    ["Trials in flight", (latest?.trials_active ?? 0).toLocaleString("en-US")],
    ["Logo churn", (first?.active_customers ?? 0) > 0 ? formatRate(churn.logoChurnRate) : "— (no customers at the start)"],
    ["Net revenue churn", base > 0 ? formatRate(churn.netRevenueChurnRate) : "— (no MRR at the start)"],
  ];

  const csv: Array<Array<string | number | null>> = [
    ["Revenue", `last ${period.label}`, snapshotDate ? `snapshot ${snapshotDate}` : "no snapshot"],
    [],
    ["Figure", "Value"],
    ["MRR (cents)", mrr],
    ["ARR (cents)", latest?.arr_cents ?? 0],
    [`Collected in ${period.short} (cents)`, collected],
    [`Invoiced in ${period.short} (cents)`, invoiced],
    ["Gross churn", base > 0 ? formatRate(churn.grossRevenueChurnRate) : null],
    ["Gross churn, 6-month mean", sixMonthMean === null ? null : formatRate(sixMonthMean)],
    [],
    ["MRR movement", "Cents"],
    ...bars.map((b) => [b.label, b.measured ? b.cents : null]),
    [],
    ["Plan", "Customers", "MRR (cents)", "Share"],
    ...planRows.map(([code, stats]) => [code, stats.customers, stats.mrr_cents, mrr > 0 ? `${((stats.mrr_cents / mrr) * 100).toFixed(1)}%` : null]),
    [],
    ["Funnel step", "Count"],
    ...funnel.map((step) => [step.label, step.measured ? step.count : null]),
    [],
    ["Customers & churn", "Value"],
    ...customersRows,
    [],
    ["Cohort started", "Subscriptions", ...COHORT_OFFSETS.map((o) => `After ${o} mo`)],
    ...cohorts.map((row) => [row.month, row.started, ...row.retained.map(pct)]),
  ];

  return (
    <BillingPage
      step="revenue"
      info="Monthly recurring revenue, what moved it, who is paying and who left, read from the nightly metrics snapshot."
      actions={
        <>
          <PeriodMenu value={period.key} options={REVENUE_PERIODS.map((p) => ({ key: p.key, label: p.label, href: p.key === "30" ? "/admin/revenue" : `/admin/revenue?period=${p.key}` }))} />
          <RevExportButton rows={csv} fileName={`revenue-${period.key}-${renderedAt.toISOString().slice(0, 10)}.csv`} />
        </>
      }
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {snapshotDate === null && (
          <BillingStatusLine tone="warn" lead={{ text: "No metrics have been computed yet" }} parts={["the figures are absent, not zero", "run npm run metrics:build"]} />
        )}

        <StatStrip label="Revenue at a glance">
          <StatTile label="MRR" value={stale(formatCentsAsCurrency(mrr))} footnote={staleNote ?? (snapshotLabel ? `contracted, ${snapshotLabel}` : "contracted")} />
          <StatTile label="ARR" value={stale(formatCentsAsCurrency(latest?.arr_cents ?? 0))} footnote={staleNote ?? "MRR × 12"} />
          <StatTile
            label={`Collected · ${period.short}`}
            value={formatCentsAsCurrency(collected)}
            footnote={invoiced > 0 ? `${((collected / invoiced) * 100).toFixed(1)}% of invoiced` : "nothing invoiced in the window"}
            labelTitle={`Recorded payments in the snapshot window, against non-void invoices raised in the last ${period.short}.`}
          />
          {/* A rate needs MRR at the start of the window. With none, safeRate returns 0 — which would read as "nobody
              churned" even when revenue was lost — so the tile says there is no rate. */}
          {base > 0 ? (
            <StatTile label={`Gross churn · ${period.short}`} value={formatRate(churn.grossRevenueChurnRate)} valueTone={churn.grossRevenueChurnRate > 0.05 ? "warning" : undefined} footnote={sixMonthMean === null ? `last ${period.short}` : `6-month mean ${formatRate(sixMonthMean)}`} />
          ) : (
            <StatTile label={`Gross churn · ${period.short}`} value="—" footnote={`no MRR at the start, so no rate${churned > 0 ? ` · ${formatCentsAsCurrency(churned)} churned` : ""}`} />
          )}
        </StatStrip>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_480px] xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="min-w-0 gap-3 p-5">
              <ChartHeading
                title="How MRR moved"
                period={first && latest ? `${LONG.format(new Date(`${first.date}T00:00:00Z`))} – ${LONG.format(new Date(`${latest.date}T00:00:00Z`))} · base ${formatCentsAsCurrency(base)}` : "No snapshot days in the window yet."}
              />
              <div className="mt-2 flex h-[170px] items-end gap-3 sm:gap-5" role="list" aria-label="MRR movement">
                {bars.map((bar) => (
                  <div key={bar.label} role="listitem" className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <span className={cn("text-sm font-semibold tabular-nums whitespace-nowrap", bar.measured ? "text-foreground" : "text-muted-foreground")}>{bar.measured ? signed(bar.cents) : "—"}</span>
                    {bar.measured
                      ? <span className={cn("w-full rounded-t-[6px]", bar.tone)} style={{ height: `${Math.max(4, Math.round((Math.abs(bar.cents) / tallest) * 124))}px` }} aria-hidden />
                      : <span className="w-full rounded-t-[6px] border border-dashed border-[var(--border-strong)]" style={{ height: "24px" }} aria-hidden />}
                    <span className="text-center text-xs text-muted-foreground">{bar.label}{!bar.measured && <span className="block">not measured</span>}</span>
                  </div>
                ))}
              </div>
            </Card>

            <TableCard className="min-w-0" title="Cohorts: still paying after" info="Notion §12 cohort retention, from each subscription's own start and cancel dates. A subscription still in its trial joins no cohort; a point not reached yet is blank.">
              {cohorts.every((row) => row.started === 0) ? (
                <EmptyState title="No paying subscription started in the last six months" hint="Each month's starters show here, with how many are still paying 1, 2, 3 and 6 months on." />
              ) : (
                <Table className="min-w-[480px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead className="text-right">Subscriptions</TableHead>
                      {COHORT_OFFSETS.map((o) => <TableHead key={o} className="text-right">{o} mo</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cohorts.map((row) => (
                      <TableRow key={row.month}>
                        <TableCell className="whitespace-nowrap font-medium">{MONTH.format(new Date(`${row.month}-01T00:00:00Z`))}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.started.toLocaleString("en-US")}</TableCell>
                        {row.retained.map((share, i) => (
                          <TableCell key={COHORT_OFFSETS[i]} className={cn("text-right tabular-nums", share === null && "text-muted-foreground")}>{share === null ? "—" : pct(share)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TableCard>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <PagedTableCard total={planRows.length} noun="plans" className="min-w-0" title={`Plan mix${snapshotLabel ? ` · ${snapshotLabel}` : ""}`}>
              {planRows.length === 0 ? (
                <EmptyState title="No revenue to break down yet" hint="It fills in once a subscription has billed at least once." />
              ) : (
                <Table className="min-w-[380px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">Customers</TableHead>
                      <TableHead className="text-right">MRR</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <PagedBody>
                    {planRows.map(([code, stats]) => (
                      <TableRow key={code}>
                        <TableCell className="font-medium">{code}</TableCell>
                        <TableCell className="text-right tabular-nums">{stats.customers.toLocaleString("en-US")}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCentsAsCurrency(stats.mrr_cents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{mrr > 0 ? `${((stats.mrr_cents / mrr) * 100).toFixed(1)}%` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </PagedBody>
                </Table>
              )}
            </PagedTableCard>

            <Card className="min-w-0 gap-2 p-5">
              <ChartHeading title="Activation funnel" period={`Last ${period.short}${signups !== null ? ` · ${signups.toLocaleString("en-US")} signups` : ""}`} />
              <ol className="m-0 list-none p-0">
                {funnel.map((step) => {
                  const share = signups && step.measured && step.count !== null ? step.count / signups : null;
                  return (
                    <li key={step.label} className="border-t border-border py-2.5 first:border-t-0">
                      <div className="flex justify-between gap-3">
                        <span className={cn("text-sm", step.measured ? "text-foreground" : "text-muted-foreground")}>{step.label}</span>
                        <span className={cn("text-sm tabular-nums", step.measured ? "font-semibold text-foreground" : "text-xs text-muted-foreground")}>
                          {step.measured && step.count !== null ? `${step.count.toLocaleString("en-US")}${share !== null ? ` · ${Math.round(share * 100)}%` : ""}` : "not instrumented"}
                        </span>
                      </div>
                      {step.measured && share !== null && (
                        <span role="meter" aria-label={step.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                          <span className="block h-1.5 rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, share * 100)}%` }} />
                        </span>
                      )}
                      {step.note && <span className="mt-1 block text-xs text-muted-foreground">{step.note}</span>}
                    </li>
                  );
                })}
              </ol>
              {/* Stated in words — and unmeasured steps are skipped rather than counted as zero, which would always name them as the biggest drop. */}
              <p className="m-0 border-t border-border pt-2.5 text-sm text-foreground">{biggestDropOff(funnel)}</p>
            </Card>

            <Card className="min-w-0 gap-2 p-5">
              <ChartHeading title="Customers & churn" period={`Last ${period.short}`} />
              <dl className="m-0">
                {customersRows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-t border-border py-2 first:border-t-0">
                    <dt className="text-sm text-foreground">{label}</dt>
                    <dd className="m-0 text-sm font-semibold tabular-nums text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </BillingPage>
  );
}
