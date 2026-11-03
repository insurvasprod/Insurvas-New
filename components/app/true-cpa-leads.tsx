"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Callout } from "@/components/app/settings/primitives";
import { useReportsTitle } from "@/components/app/reports/reports-slot";
import type { VendorScorecardLeadResult } from "@/lib/vendorScorecard/types";

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * Reports › True CPA › the leads behind a figure (LA-2.17-7). It was a wide side panel over the report;
 * it is a page now (foundation pass 2026-11-03), with the figure as the title, the selection's sums as the
 * facts line, and the leads in a table paged on the server. Operational fields only: no phone, SSN or
 * health details. Read-only.
 */
export function TrueCpaLeads({ params, title }: { params: Record<string, string>; title: string }) {
  const pageSize = useFittingPageSize(360, 45);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<VendorScorecardLeadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const query = new URLSearchParams({ ...params, offset: String((page - 1) * pageSize), limit: String(pageSize) });
    try {
      const response = await fetch(`/api/app/true-cpa/leads?${query}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load the leads behind this figure");
      setResult(body as VendorScorecardLeadResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the leads behind this figure");
    } finally {
      setLoading(false);
    }
  }, [params, page, pageSize]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // The whole selection's sums, so the rows reconcile with the figure that was clicked.
  const sums = result?.sums;
  const facts = sums
    ? `${params.from ?? ""} – ${params.to ?? ""} · ${plural(sums.leads, "lead")} · ${plural(sums.attempts, "attempt")} · ${sums.contacted_leads.toLocaleString()} contacted · ${plural(sums.applications, "application")} · ${plural(sums.issued_policies, "issued policy", "issued policies")}`
    : `${params.from ?? ""} – ${params.to ?? ""} · in this report's period and filters`;
  useReportsTitle(result?.total != null ? `${title} · ${plural(result.total, "lead")}` : title, facts);

  return (
    <>
      {result && !result.drillReady && <Callout tone="warning" title="A database update is pending">{result.has_more ? "Only the newest 500 leads are listed. " : ""}Attempts and contacts are all time until it is applied.</Callout>}
      <TableCard
        toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} />} />}
        footer={result && result.total != null && result.total > pageSize
          ? <Pager page={page} total={result.total} noun="leads" pageSize={pageSize} disabled={loading} onPage={setPage} suffix="operational fields only: no phone, SSN or health details" />
          : <span>Operational fields only: no phone, SSN or health details</span>}
      >
        {error && !result ? <ErrorState title="The leads did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />
          : loading && !result ? <SectionLoading rows={8} columns={8} />
          : !result || result.rows.length === 0 ? <EmptyState title="No leads behind this figure" hint="Widen the period on True CPA to see more." />
          : (
            <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
              <thead><tr><th>Lead date</th><th>Dialable</th><th>Campaign</th><th>Product</th><th className="text-right">Attempts</th><th className="text-right">Contacts</th>{result.drillReady && <th>Quoted</th>}<th className="text-right">Applications</th><th className="text-right">Issued</th><th>Attribution</th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
              <tbody className="m-seq">
                {result.rows.map((lead) => (
                  <tr key={lead.lead_id} className="m-row">
                    <td className="whitespace-nowrap tabular-nums">{lead.lead_date}</td>
                    <td className="whitespace-nowrap">{result.drillReady && lead.dialable === false ? <StatusChip tone="neutral" dot={false}>Undialable</StatusChip> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="max-w-[240px] truncate" title={lead.campaign_name}>{lead.campaign_name}</td>
                    <td className="whitespace-nowrap">{lead.product_line.replaceAll("_", " ")}</td>
                    <td className="text-right tabular-nums">{lead.attempts}</td>
                    <td className="text-right tabular-nums">{lead.contacts}</td>
                    {result.drillReady && <td>{lead.quoted ? "Yes" : "—"}</td>}
                    <td className="text-right tabular-nums">{lead.applications}</td>
                    <td className="text-right tabular-nums">{lead.issued_policies}</td>
                    <td>{lead.attribution_status === "linked" ? <StatusChip tone="good">Linked</StatusChip> : <StatusChip tone="warning">Review</StatusChip>}</td>
                    <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={`/app/leads/${lead.lead_id}`}>Open</Link></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </TableCard>
    </>
  );
}
