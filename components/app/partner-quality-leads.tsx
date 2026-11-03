"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Callout } from "@/components/app/settings/primitives";
import { ReportsSlot, useReportsTitle } from "@/components/app/reports/reports-slot";
import { dateText, dispositionText, downloadCsv, periodText, productText, type Period } from "@/components/app/partner-quality-parts";
import type { PartnerQualityLeadResult, PartnerQualityMetric } from "@/lib/partnerQuality/types";

/**
 * Reports › Partner quality › a partner › the leads behind a figure (LA-1.18: any cell opens exactly the
 * leads it counted). It was a side drawer over the report; it is a page now (foundation pass 2026-11-03),
 * with the figure as the title and the period and count as the facts line. Read-only.
 *
 * A partner user's leads are filtered after the page is read on the server, so for one member every row
 * comes at once and is paged here; otherwise the server pages them.
 */
export function PartnerQualityLeads({ partnerId, metric, period, label, disposition, member }: { partnerId: string; metric: PartnerQualityMetric; period: Period; label: string; disposition: string | null; member: string | null }) {
  const pageSize = useFittingPageSize(360, 45);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PartnerQualityLeadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ ...period, partner_id: partnerId, metric, page: String(member ? 1 : page), page_size: String(member ? 1000 : pageSize) });
    if (disposition) params.set("disposition", disposition);
    if (member) params.set("partner_user_id", member);
    try {
      const response = await fetch(`/api/app/partner-quality/leads?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load these leads");
      setData(body as PartnerQualityLeadResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load these leads");
    } finally {
      setLoading(false);
    }
  }, [partnerId, metric, period, disposition, member, page, pageSize]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const total = data?.total ?? 0;
  useReportsTitle(label, `${periodText(period)} · ${data ? `${total.toLocaleString()} ${total === 1 ? "lead" : "leads"}` : "counting the leads"}`);
  const rows = data ? (data.rows.length > pageSize ? data.rows.slice((page - 1) * pageSize, page * pageSize) : data.rows) : [];

  function exportCsv() {
    if (!data) return;
    downloadCsv(`${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${period.from}-to-${period.to}.csv`, ["Received", "Customer", "Phone", "State", "Product", "Disposition"],
      data.rows.map((lead) => [lead.date, lead.full_name, lead.phone ?? null, lead.state ?? null, productText(lead.product), lead.disposition ? dispositionText(lead.disposition) : lead.submitted ? "Submitted" : null]));
  }

  return (
    <>
      <ReportsSlot slot="corner"><Button type="button" variant="outline" onClick={exportCsv} disabled={!data?.rows.length}><Download aria-hidden="true" />Export</Button></ReportsSlot>
      {error && data && <Callout tone="error" title="These leads did not reload">{error}</Callout>}
      <TableCard
        toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} />} />}
        footer={total > pageSize ? <Pager page={page} total={total} pageSize={pageSize} noun="leads" disabled={loading} onPage={setPage} /> : undefined}
      >
        {error && !data ? <ErrorState title="These leads did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />
          : loading && !data ? <SectionLoading rows={8} columns={6} label="Loading leads" />
          : rows.length === 0 ? <EmptyState title="No leads" hint="Nothing matches this figure in the selected period." />
          : (
            <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
              <thead><tr><th>Received</th><th>Customer</th><th>Phone</th><th>State</th><th>Product</th><th>Disposition</th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
              <tbody className="m-seq">{rows.map((lead) => (
                <tr key={lead.lead_id} className="m-row">
                  <td className="whitespace-nowrap tabular-nums">{dateText(lead.date)}</td>
                  <td className="max-w-[240px]"><span className="block truncate font-semibold" title={lead.full_name}>{lead.full_name}</span></td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{lead.phone ?? "No phone"}</td>
                  <td>{lead.state ?? "—"}</td>
                  <td className="whitespace-nowrap">{productText(lead.product)}</td>
                  <td>{lead.disposition ? dispositionText(lead.disposition) : lead.submitted ? "Submitted" : "—"}</td>
                  <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={`/app/leads/${lead.lead_id}`} aria-label={`Open ${lead.full_name}`}>Open</Link></Button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </TableCard>
    </>
  );
}
