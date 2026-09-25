import "server-only";

import { fetchMetrics, fetchFunnel, fetchSnapshotFreshness, biggestDropOff, type MetricsDay } from "@/lib/metrics/queries";
import { computeChurn, formatRate } from "@/lib/metrics/churn";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BillingTabs } from "@/components/admin/billing-tabs";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { EmptyState } from "@/components/ui/page-states";
import { formatCentsAsCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

const card = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6";
const h2 = "text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";
const sub = "mt-1 text-[14px] text-[var(--muted)]";
const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${formatCentsAsCurrency(Math.abs(cents))}`;

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5">
      <p className="text-[14px] font-semibold text-[var(--warning-ink)]">{title}</p>
      <p className="mt-1.5 text-[14px] leading-normal text-[var(--body)]">{children}</p>
    </div>
  );
}

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

/** The revenue board (p-adm-revenue), for an admin the page has already checked. */
export async function RevenueView() {
  const renderedAt = new Date();
  const windowStart = new Date(renderedAt.getTime() - 30 * 86_400_000);
  const [history, funnel, freshness, invoicedResult] = await Promise.all([
    fetchMetrics(183),
    fetchFunnel(90),
    fetchSnapshotFreshness(),
    getSupabaseServiceClient().from("platform_invoices").select("total_cents").neq("status", "void").gte("created_at", windowStart.toISOString()),
  ]);

  // The last 31 snapshot days are this page's window; the longer history only feeds the 6-month mean.
  const cutoff = new Date(renderedAt.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
  const days = history.filter((d) => d.date >= cutoff);
  const latest = days.at(-1);
  const monthAgo = days[0];

  const churn = grossChurn(days);
  // Six consecutive 30-day windows, newest first; only windows that started with revenue count.
  const windows: MetricsDay[][] = [];
  for (let end = history.length; end > 0 && windows.length < 6; end -= 30) windows.push(history.slice(Math.max(0, end - 30), end));
  const measured = windows.filter((w) => w.length >= 20 && (w[0]?.mrr_cents ?? 0) > 0).map((w) => grossChurn(w).grossRevenueChurnRate);
  const sixMonthMean = measured.length >= 2 ? measured.reduce((a, b) => a + b, 0) / measured.length : null;

  const mrr = latest?.mrr_cents ?? 0;
  const base = monthAgo?.mrr_cents ?? 0;
  const collected = days.reduce((sum, d) => sum + d.collected_cents, 0);
  const invoiced = (invoicedResult.data ?? []).reduce((sum, row) => sum + (row.total_cents as number), 0);
  const arpc = latest && latest.active_customers > 0 ? Math.round(mrr / latest.active_customers) : 0;

  const newMrr = days.reduce((s, d) => s + d.new_mrr_cents, 0);
  const churned = days.reduce((s, d) => s + d.churned_mrr_cents, 0);
  const expansion = days.reduce((s, d) => s + d.expansion_mrr_cents, 0);
  const contraction = days.reduce((s, d) => s + d.contraction_mrr_cents, 0);
  // Expansion and contraction are columns the snapshot has but nothing records yet: shown as "not
  // measured", never as a confident zero bar, and the unexplained remainder is shown rather than
  // letting the waterfall silently not add up.
  const movementMeasured = expansion !== 0 || contraction !== 0;
  const net = mrr - base;
  const unexplained = net - (newMrr + expansion - contraction - churned);
  const bars = [
    { label: "New", cents: newMrr, measured: true, tone: "bg-[var(--success)]", ink: "text-[var(--success-ink)]" },
    { label: "Expansion", cents: expansion, measured: movementMeasured, tone: "bg-[var(--success)]", ink: "text-[var(--success-ink)]" },
    { label: "Contraction", cents: -contraction, measured: movementMeasured, tone: "bg-[var(--warning)]", ink: "text-[var(--warning-ink)]" },
    { label: "Churn", cents: -churned, measured: true, tone: "bg-[var(--error)]", ink: "text-[var(--error-ink)]" },
    ...(unexplained !== 0 ? [{ label: "Unexplained", cents: unexplained, measured: true, tone: "bg-[var(--border-strong)]", ink: "text-[var(--body)]" }] : []),
    { label: "Net", cents: net, measured: true, tone: "bg-[var(--info)]", ink: "text-[var(--info-ink)]" },
  ];
  const tallest = Math.max(1, ...bars.filter((b) => b.measured).map((b) => Math.abs(b.cents)));

  const planRows = Object.entries(latest?.plan_breakdown ?? {}).sort((a, b) => b[1].mrr_cents - a[1].mrr_cents);
  const signups = funnel[0]?.measured ? funnel[0].count ?? 0 : null;

  // See fetchSnapshotFreshness: every figure here is read from a nightly snapshot, and a page that
  // cannot say how old its numbers are will present stale ones as current.
  const { date: snapshotDate, ageDays: snapshotAgeDays, isStale: snapshotIsStale } = freshness;
  const snapshotLabel = snapshotDate ? SHORT.format(new Date(`${snapshotDate}T00:00:00Z`)) : null;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader title="Revenue" subtitle="Contracted revenue, collections, churn and plan mix. Every figure is derived from real data." />
      <BillingTabs />

      {snapshotDate === null ? (
        <Callout title="No metrics have been computed yet">
          Every figure on this page reads the nightly snapshot, and it is empty — so the numbers below are absent, not zero. Run <code className="font-mono text-[14px]">npm run metrics:build</code> to populate it.
        </Callout>
      ) : snapshotIsStale ? (
        <Callout title={`These figures are ${snapshotAgeDays} days old`}>
          The last snapshot is from {snapshotDate}. The nightly job has not run since, so nothing below reflects the last {snapshotAgeDays} days of signups, cancellations or payments. Run <code className="font-mono text-[14px]">npm run metrics:build</code> to catch up.
        </Callout>
      ) : null}

      <BoardStatGrid>
        <BoardStatTile label="MRR" value={formatCentsAsCurrency(mrr)} footnote={snapshotLabel ? `contracted, ${snapshotLabel}` : "contracted"} />
        <BoardStatTile label="ARR" value={formatCentsAsCurrency(latest?.arr_cents ?? 0)} footnote="MRR × 12" />
        <BoardStatTile label="Collected, 30 days" value={formatCentsAsCurrency(collected)} footnote={invoiced > 0 ? `${((collected / invoiced) * 100).toFixed(1)}% of invoiced` : "nothing invoiced in the window"} title="Recorded payments in the snapshot window, against non-void invoices raised in the last 30 days." />
        {/* A rate needs MRR at the start of the window. With none, safeRate returns 0 — which would
            read as "nobody churned" even when revenue was lost — so the tile says there is no rate. */}
        {base > 0 ? (
          <BoardStatTile label="Gross churn" value={formatRate(churn.grossRevenueChurnRate)} footnote={sixMonthMean === null ? "last 30 days" : `last 30 days, 6-month mean ${formatRate(sixMonthMean)}`} tone={churn.grossRevenueChurnRate > 0.05 ? "warning" : "default"} />
        ) : (
          <BoardStatTile label="Gross churn" value="—" footnote={`no MRR at the start of the window, so no rate${churned > 0 ? ` · ${formatCentsAsCurrency(churned)} churned` : ""}`} />
        )}
      </BoardStatGrid>

      {mrr === 0 && collected > 0 && (
        <Callout title="Money is being collected but no subscription is recorded">
          {formatCentsAsCurrency(collected)} was received in the last 30 days, and contracted MRR is {formatCentsAsCurrency(mrr)}. A customer who bought through provider checkout does not get a subscription on our side automatically, so they are invisible to every figure on this page except the collected one.
        </Callout>
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_520px] xl:items-start">
        <section className={card} aria-labelledby="mrr-movement">
          <h2 id="mrr-movement" className={h2}>MRR movement</h2>
          <p className={sub}>{monthAgo && latest ? `${LONG.format(new Date(`${monthAgo.date}T00:00:00Z`))} – ${LONG.format(new Date(`${latest.date}T00:00:00Z`))}. Base ${formatCentsAsCurrency(base)} at ${SHORT.format(new Date(`${monthAgo.date}T00:00:00Z`))}.` : "No snapshot days in the window yet."}</p>
          <div className="mt-5 flex h-[170px] items-end gap-3 sm:gap-5" role="list" aria-label="MRR movement">
            {bars.map((bar) => (
              <div key={bar.label} role="listitem" className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <span className={cn("text-[14px] font-semibold tabular-nums whitespace-nowrap", bar.measured ? bar.ink : "text-[var(--muted)]")}>{bar.measured ? signed(bar.cents) : "—"}</span>
                {bar.measured
                  ? <span className={cn("w-full rounded-t-[6px]", bar.tone)} style={{ height: `${Math.max(4, Math.round((Math.abs(bar.cents) / tallest) * 124))}px` }} aria-hidden />
                  : <span className="w-full rounded-t-[6px] border border-dashed border-[var(--border-strong)]" style={{ height: "24px" }} aria-hidden />}
                <span className="text-center text-[12px] text-[var(--muted)]">{bar.label}{!bar.measured && <span className="block">not measured</span>}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12px] leading-normal text-[var(--muted)]">
            A single MRR number without its movement is not management information.{" "}
            {!movementMeasured && "Expansion and contraction are not recorded yet, so plan changes land in the unexplained remainder rather than disappearing. "}
            {collected !== newMrr && `Collected differs from new contracted revenue by ${formatCentsAsCurrency(Math.abs(collected - newMrr))} over this window.`}
          </p>
        </section>

        <section className={card} aria-labelledby="activation-funnel">
          <h2 id="activation-funnel" className={h2}>Activation funnel</h2>
          <p className={sub}>Last 90 days{signups !== null ? ` · ${signups.toLocaleString()} signups` : ""}. Each stage&rsquo;s definition is stated.</p>
          <ol className="mt-2">
            {funnel.map((step) => {
              const share = signups && step.measured && step.count !== null ? step.count / signups : null;
              return (
                <li key={step.label} className="border-t border-[var(--border)] py-2.5">
                  <div className="flex justify-between gap-3">
                    <span className={cn("text-[14px]", step.measured ? "text-[var(--body)]" : "text-[var(--muted)]")}>{step.label}</span>
                    <span className={cn("text-[14px] tabular-nums", step.measured ? "font-semibold text-[var(--ink)]" : "text-[12px] text-[var(--muted)]")}>
                      {step.measured && step.count !== null ? `${step.count.toLocaleString()}${share !== null ? ` · ${Math.round(share * 100)}%` : ""}` : "not instrumented"}
                    </span>
                  </div>
                  {step.measured && share !== null && (
                    <span role="meter" aria-label={step.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                      <span className="block h-1.5 rounded-full bg-[var(--info)]" style={{ width: `${Math.min(100, share * 100)}%` }} />
                    </span>
                  )}
                  {step.note && <span className="mt-1 block text-[12px] text-[var(--muted)]">{step.note}</span>}
                </li>
              );
            })}
          </ol>
          {/* Stated in words — and unmeasured steps are skipped rather than counted as zero, which would always name them as the biggest drop. */}
          <p className="border-t border-[var(--border)] pt-2.5 text-[14px] text-[var(--body)]">{biggestDropOff(funnel)}</p>
        </section>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_520px] xl:items-start">
        <section className="min-w-0 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]" aria-labelledby="plan-mix">
          <div className="border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3"><h2 id="plan-mix" className="text-[14px] font-semibold text-[var(--ink)]">Plan mix{snapshotLabel ? ` · ${snapshotLabel}` : ""}</h2></div>
          {planRows.length === 0 ? (
            <EmptyState title="No revenue to break down yet" hint="This table splits recognised revenue by plan. It fills in once a subscription has billed at least once." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse">
                <thead><tr className="bg-[var(--surface-alt)]"><th scope="col" className={th}>Plan</th><th scope="col" className={cn(th, "text-right")}>Customers</th><th scope="col" className={cn(th, "text-right")}>MRR</th><th scope="col" className={cn(th, "text-right")}>Share</th></tr></thead>
                <tbody>
                  {planRows.map(([code, stats]) => (
                    <tr key={code}>
                      <td className={cn(td, "font-semibold text-[var(--ink)]")}>{code}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{stats.customers.toLocaleString()}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{formatCentsAsCurrency(stats.mrr_cents)}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{mrr > 0 ? `${((stats.mrr_cents / mrr) * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={card} aria-labelledby="customers-churn">
          <h2 id="customers-churn" className={h2}>Customers &amp; churn</h2>
          <dl className="m-0 mt-3">
            {[
              ["Active customers", (latest?.active_customers ?? 0).toLocaleString()],
              ["Average revenue per customer", formatCentsAsCurrency(arpc)],
              ["New in 30 days", days.reduce((s, d) => s + d.new_customers, 0).toLocaleString()],
              ["Churned in 30 days", days.reduce((s, d) => s + d.churned_customers, 0).toLocaleString()],
              ["Trials in flight", (latest?.trials_active ?? 0).toLocaleString()],
              ["Logo churn", (monthAgo?.active_customers ?? 0) > 0 ? formatRate(churn.logoChurnRate) : "— (no customers at the start)"],
              ["Net revenue churn", base > 0 ? formatRate(churn.netRevenueChurnRate) : "— (no MRR at the start)"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-t border-[var(--border)] py-2 first:border-t-0">
                <dt className="text-[14px] text-[var(--body)]">{label}</dt>
                <dd className="m-0 text-[14px] font-semibold tabular-nums text-[var(--ink)]">{value}</dd>
              </div>
            ))}
          </dl>
          {churn.netRevenueChurnRate < 0 && <p className="mt-2 text-[12px] text-[var(--success-ink)]">Negative net revenue churn — expansion is outrunning churn.</p>}
        </section>
      </div>
    </div>
  );
}
