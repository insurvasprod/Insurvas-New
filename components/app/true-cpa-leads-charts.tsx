import { BarList, BarSeries, ChartHeading } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { showHref } from "@/lib/reports/show";
import { TRUE_CPA_LEADS_PATH } from "@/lib/reports/trueCpaLeads";
import type { LeadsBreakdown } from "@/lib/vendorScorecard/series";

/**
 * The leads behind a True CPA figure, as pictures (board 7·7, chart view; server-rendered): where they came from,
 * a bar a vendor (a campaign when the figure is one vendor's already), and when they arrived, a bar a month. The
 * board drew a donut for the first; the owner's round 7 rule is no donuts, so it is a BarList. A bar opens this
 * list's table filtered to its rows.
 */
export function TrueCpaLeadsCharts({ params, breakdown, total, noun }: { params: Record<string, string>; breakdown: LeadsBreakdown; total: number | null; noun: string }) {
  const base = `${TRUE_CPA_LEADS_PATH}?${new URLSearchParams(params)}`;
  const shown = breakdown.sources.slice(0, 8);
  const rest = breakdown.sources.slice(8);
  const restCount = rest.reduce((sum, row) => sum + row.count, 0);
  const all = breakdown.sources.reduce((sum, row) => sum + row.count, 0) || 1;
  const pct = (count: number) => `${Math.round((count / all) * 100)}%`;
  const sampled = breakdown.sampled != null ? ` · counted from the first ${breakdown.sampled.toLocaleString()} leads` : "";
  return (
    <TableCard>
      <div className="grid gap-8 p-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <ChartHeading title="Where these leads came from" period={`by ${breakdown.by}${sampled}`} />
          {shown.length
            ? <BarList
                rows={[
                  ...shown.map((row) => ({
                    key: row.key, label: row.label, value: row.count, caption: pct(row.count),
                    href: row.campaignId ? showHref(base, "table", { vendor_id: row.vendorId, campaign_id: row.campaignId }) : row.vendorId ? showHref(base, "table", { vendor_id: row.vendorId }) : undefined,
                  })),
                  ...(rest.length ? [{ key: "others", label: `${rest.length} others`, value: restCount, caption: pct(restCount), tone: "quiet" as const }] : []),
                ]}
                summary={`The ${noun} by ${breakdown.by}`}
                unit={noun}
                total={total != null ? { label: `All ${noun}`, figure: total.toLocaleString(), href: showHref(base, "table") } : undefined}
              />
            : <EmptyState title="No leads behind this figure" hint="Widen the period on True CPA to see more." />}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <ChartHeading title="When they arrived" period={`by lead date, a bar a month${sampled}`} />
          {breakdown.months.some((month) => month.count > 0)
            ? <BarSeries
                bars={breakdown.months.map((month) => ({ key: month.key, label: month.label, value: month.count }))}
                summary={`The ${noun} by the month they arrived`}
                unit={noun}
                labels="all"
                hrefFor={(bar) => {
                  const month = breakdown.months.find((item) => item.key === bar.key);
                  return month ? showHref(base, "table", { from: month.from, to: month.to }) : null;
                }}
              />
            : <EmptyState title="No arrivals in this period" hint="Widen the period on True CPA to see more." />}
        </div>
      </div>
    </TableCard>
  );
}
