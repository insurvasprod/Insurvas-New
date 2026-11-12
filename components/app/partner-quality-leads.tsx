"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { BarList, ChartHeading, LineSeries, type BarListRow } from "@/components/ui/chart";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { notify } from "@/lib/notify";
import { ReportsSlot, useReportsTitle } from "@/components/app/reports/reports-slot";
import { count, dateText, dispositionText, downloadCsv, metricLabel, periodText, productText, type Period } from "@/components/app/partner-quality-parts";
import type { PartnerQualityLead, PartnerQualityLeadResult, PartnerQualityMetric } from "@/lib/partnerQuality/types";
import { leadsBy, leadsOverTime } from "@/lib/partnerQuality/leadsChart";
import { showHref, type ShowMode } from "@/lib/reports/show";
import { cn } from "@/lib/utils";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

/** The leads behind a figure, as the app's cache keys them (lib/client/resource-cache.ts). */
function leadsKey(partnerId: string, metric: PartnerQualityMetric, period: Period, disposition: string | null, member: string | null, page: number, pageSize: number) {
  const params = new URLSearchParams({ ...period, partner_id: partnerId, metric, page: String(member ? 1 : page), page_size: String(member ? 1000 : pageSize) });
  if (disposition) params.set("disposition", disposition);
  if (member) params.set("partner_user_id", member);
  return `/api/app/partner-quality/leads?${params}`;
}

/**
 * Reports › Partner quality › a partner › the leads behind a figure (LA-1.18: any cell opens exactly the
 * leads it counted). It was a side drawer over the report; it is a page now (foundation pass 2026-11-03),
 * with the figure as the title and the period and count as the facts line. Read-only.
 *
 * A partner user's leads are filtered after the page is read on the server, so for one member every row
 * comes at once and is paged here; otherwise the server pages them.
 */
type LeadsProps = { partnerId: string; metric: PartnerQualityMetric; period: Period; label: string; disposition: string | null; member: string | null };

/**
 * The page's two views (owner 2026-11-12: the Table · Chart switch on every Reports sub-page, opening on Table here
 * because the rows are the work). `show` and `base` (this page's address) come from the server page.
 */
export function PartnerQualityLeads({ show, base, ...props }: LeadsProps & { show: ShowMode; base: string }) {
  return show === "chart" ? <PartnerQualityLeadsChart {...props} base={base} /> : <PartnerQualityLeadsTable {...props} />;
}

function PartnerQualityLeadsTable({ partnerId, metric, period, label, disposition, member }: LeadsProps) {
  const router = useRouter();
  const pageSize = useFittingPageSize(360, 45);
  const [page, setPage] = useState(1);
  const key = leadsKey(partnerId, metric, period, disposition, member, page, pageSize);
  const [data, setData] = useState<PartnerQualityLeadResult | null>(() => seed<PartnerQualityLeadResult>(key)?.data ?? null);
  const [loading, setLoading] = useState(() => !seed(key)?.data);
  const [error, setError] = useState("");

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setError("");
    try {
      const body = await (fresh ? loadResource<PartnerQualityLeadResult>(key) : readResource<PartnerQualityLeadResult>(key));
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load these leads");
    } finally {
      setLoading(false);
    }
  }, [key]);
  useEffect(() => {
    const kept = peek<PartnerQualityLeadResult>(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.data) setData((current) => current ?? kept.data ?? null);
    void load();
  }, [key, load]);
  // A failed reload with rows still on screen is a toast (8·6), never a notice on the page.
  useEffect(() => { if (error && data) notify.fail("These leads did not reload", { detail: "The rows shown are from the last load." }); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = data?.total ?? 0;
  useReportsTitle(label, `${periodText(period)} · ${data ? `${total.toLocaleString()} ${total === 1 ? "lead" : "leads"}` : "counting the leads"}`);
  const rows = data ? (data.rows.length > pageSize ? data.rows.slice((page - 1) * pageSize, page * pageSize) : data.rows) : [];

  function exportCsv() {
    if (!data) return;
    downloadCsv(`${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${period.from}-to-${period.to}.csv`, ["Received", "Customer", "Phone", "State", "Product", "Disposition"],
      data.rows.map((lead) => [lead.date, lead.full_name, lead.phone ?? null, lead.state ?? null, productText(lead.product), lead.disposition ? dispositionText(lead.disposition) : lead.submitted ? "Submitted" : null]));
    notify.done(`Exported ${data.rows.length.toLocaleString()} leads`, { detail: `${label} · ${periodText(period)}.csv` });
  }

  return (
    <>
      <ReportsSlot slot="corner"><Button type="button" variant="outline" onClick={exportCsv} disabled={!data?.rows.length}><Download aria-hidden="true" />Export</Button></ReportsSlot>
      <TableCard
        toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load(true)} refreshing={loading} />} />}
        footer={total > pageSize ? <Pager page={page} total={total} pageSize={pageSize} noun="leads" disabled={loading} onPage={setPage} /> : undefined}
      >
        {error && !data ? <ErrorState title="These leads did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />
          : loading && !data ? <SectionLoading rows={8} columns={6} label="Loading leads" />
          : rows.length === 0 ? <EmptyState title="No leads" hint="Nothing matches this figure in the selected period." />
          : (
            <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
              <thead><tr><th>Received</th><th>Lead</th><th>Phone</th><th>State</th><th>Product</th><th>Disposition</th></tr></thead>
              {/* One line a lead (8·6); the row opens the lead, the Disposition is its one chip. */}
              <tbody className="m-seq">{rows.map((lead) => (
                <tr key={lead.lead_id} className="m-row cursor-pointer" onClick={() => router.push(`/app/leads/${lead.lead_id}`)}>
                  <td className="whitespace-nowrap tabular-nums">{dateText(lead.date)}</td>
                  <td className="max-w-[240px] truncate whitespace-nowrap"><Link href={`/app/leads/${lead.lead_id}`} title={lead.full_name} onClick={(event) => event.stopPropagation()} className="font-medium text-foreground underline-offset-4 hover:underline">{lead.full_name}</Link></td>
                  <td className="whitespace-nowrap tabular-nums">{lead.phone ?? "—"}</td>
                  <td className="whitespace-nowrap">{lead.state ?? "—"}</td>
                  <td className="whitespace-nowrap">{productText(lead.product)}</td>
                  <td className="whitespace-nowrap">{lead.disposition || lead.submitted ? <StatusChip tone={lead.submitted ? "good" : "neutral"}>{lead.disposition ? dispositionText(lead.disposition) : "Submitted"}</StatusChip> : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </TableCard>
    </>
  );
}

/** The server pages at most 1,000 leads a request; the chart reads every page, up to this many. */
const CHART_PAGE_SIZE = 1000;
const CHART_MAX_PAGES = 50;

/**
 * The chart view: the leads behind this figure received by day (a period up to 45 days) or by week, and the same
 * leads by last disposition (by state on a disposition's own leads). Counted from every row the table's own query
 * returns, so the figures add up to the table's count.
 *
 * Every point opens the table for that day or week (the query's own from/to). A disposition row opens the table of
 * exactly those leads when the query can say so: on Sent, every lead in the period is behind the figure, so
 * "Sent with disposition X" is the query's disposition figure. Elsewhere the query has no disposition-within-metric
 * filter (partner_quality_leads), and it never filters by state, so those rows open the unfiltered table.
 */
function PartnerQualityLeadsChart({ partnerId, metric, period, label, disposition, member, base }: LeadsProps & { base: string }) {
  const firstKey = leadsKey(partnerId, metric, period, disposition, member, 1, CHART_PAGE_SIZE);
  const [data, setData] = useState<PartnerQualityLeadResult | null>(() => {
    const kept = seed<PartnerQualityLeadResult>(firstKey)?.data;
    return kept && (member || kept.rows.length >= kept.total) ? kept : null;
  });
  const [loading, setLoading] = useState(() => data === null);
  const [error, setError] = useState("");

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setError("");
    try {
      const read = (key: string) => fresh ? loadResource<PartnerQualityLeadResult>(key) : readResource<PartnerQualityLeadResult>(key);
      const first = await read(firstKey);
      const rows: PartnerQualityLead[] = [...first.rows];
      // A partner user's leads come at once (the filter runs after the server's page); otherwise read every page.
      for (let page = 2; !member && rows.length < first.total && page <= CHART_MAX_PAGES; page += 1) {
        const next = await read(leadsKey(partnerId, metric, period, disposition, member, page, CHART_PAGE_SIZE));
        if (!next.rows.length) break;
        rows.push(...next.rows);
      }
      setData({ ...first, rows });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load these leads");
    } finally {
      setLoading(false);
    }
  }, [firstKey, partnerId, metric, period, disposition, member]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the first read: load() marks itself loading before it fetches
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (error && data) notify.fail("These leads did not reload", { detail: "The chart shown is from the last load." }); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = data?.total ?? 0;
  useReportsTitle(label, `${periodText(period)} · ${data ? `${total.toLocaleString()} ${total === 1 ? "lead" : "leads"}` : "counting the leads"}`);

  const rows = data?.rows ?? [];
  const table = (extra: Record<string, string | null> = {}) => showHref(base, "table", extra);
  const over = leadsOverTime(rows, period.from, period.to);
  const byState = metric === "disposition";
  const groups = leadsBy(rows, byState ? (lead) => lead.state?.toUpperCase() ?? null : (lead) => lead.disposition);
  // "Partner · Sent" becomes "Partner · Callback": the drill's title names what it holds.
  const prefix = label.includes(" · ") ? label.slice(0, label.lastIndexOf(" · ")) : null;
  const groupHref = (key: string | null) => {
    if (byState || metric !== "sent" || !key || !/^[a-z][a-z0-9_]{1,79}$/.test(key)) return table();
    return table({ metric: "disposition", disposition: key, label: `${prefix ? `${prefix} · ` : ""}${dispositionText(key)}` });
  };
  const groupLabel = (key: string | null) => byState ? key ?? "No state" : key ? dispositionText(key) : "No outcome yet";
  const barRows: BarListRow[] = groups.map((group) => ({
    key: group.key ?? "none", label: groupLabel(group.key), value: group.value, inner: group.submitted || undefined,
    caption: `${count(group.submitted)} submitted`, tone: group.key ? undefined : "quiet", href: groupHref(group.key),
  }));
  const shown = rows.length;
  const partial = !member && shown < total;

  return (
    <>
      <section aria-label="Leads received" className={cn(cardSurface, "flex min-w-0 flex-col gap-4 p-4")}>
        <DataToolbar actions={<RefreshButton onClick={() => void load(true)} refreshing={loading} />} />
        {error && !data ? <ErrorState title="These leads did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />
          : loading && !data ? <SectionLoading rows={4} columns={4} label="Loading leads" />
          : shown === 0 ? <EmptyState title="No leads" hint="Nothing matches this figure in the selected period." />
          : (
            <>
              <ChartHeading
                title={`Leads received, by ${over.unit}`}
                period={`${periodText(period)} · ${count(shown)} ${shown === 1 ? "lead" : "leads"}${partial ? ` of ${count(total)}` : ""}`}
                action={<Link href={table()} className="whitespace-nowrap text-sm font-medium text-foreground underline-offset-4 hover:underline">{`Open the ${count(total)} leads ›`}</Link>}
              />
              <LineSeries
                points={over.points}
                summary={`${label}: leads received each ${over.unit}, ${periodText(period)}.`}
                unit="leads"
                minHeight={220}
                legend={{ label: metricLabel(metric), figure: count(shown), href: table() }}
                hrefFor={(point) => { const at = over.points.find((entry) => entry.key === point.key); return at ? table({ from: at.from, to: at.to }) : null; }}
              />
            </>
          )}
      </section>
      {shown > 0 && (
        <section aria-label={byState ? "By state" : "By last disposition"} className={cn(cardSurface, "flex min-w-0 flex-col gap-4 p-4")}>
          <ChartHeading title={byState ? "By state" : "By last disposition"} period={`${count(shown)} ${shown === 1 ? "lead" : "leads"} · submitted solid inside`} />
          <BarList rows={barRows} summary={`${label}: leads by ${byState ? "state" : "last disposition"}, with the submitted inside, ${periodText(period)}.`} unit="leads" labelWidth="14rem" />
        </section>
      )}
    </>
  );
}
