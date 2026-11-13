"use client";

import { csvCell } from "@/lib/csv/cell";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { ReportsSlot, useReportsTitle } from "@/components/app/reports/reports-slot";
import type { VendorScorecardLead, VendorScorecardLeadResult } from "@/lib/vendorScorecard/types";
import { reportPeriod } from "@/lib/reports/periodText";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";
import { notify } from "@/lib/notify";

/** The leads behind a figure, as the app's cache keys them (lib/client/resource-cache.ts). */
const trueCpaLeadsKey = (params: Record<string, string>, page: number, pageSize: number) => `/api/app/true-cpa/leads?${new URLSearchParams({ ...params, offset: String((page - 1) * pageSize), limit: String(pageSize) })}`;

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** "Sep 25, 2026" for the RPC's YYYY-MM-DD, by hand so the server and the browser print the same. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function leadDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : value;
}

/** The row's one chip (board 7·7): Issued (green) on a lead that issued, otherwise its attribution. */
function attribution(lead: VendorScorecardLead) {
  if (lead.issued_policies > 0) return <StatusChip tone="good">Issued</StatusChip>;
  return lead.attribution_status === "linked" ? <StatusChip tone="neutral">Linked</StatusChip> : <StatusChip tone="warning">Review</StatusChip>;
}

/**
 * Reports › True CPA › the leads behind a figure (LA-2.17-7; round 7 board 7·7). A page with the figure as its
 * title ("Applied · 115 leads"), the selection's sums on the toolbar line, and the leads one line each, six
 * columns, paged on the server. Operational fields only: no phone, SSN or health details. Read-only. A row opens
 * the lead.
 */
export function TrueCpaLeads({ params, title }: { params: Record<string, string>; title: string }) {
  const router = useRouter();
  const pageSize = useFittingPageSize(330, 45);
  const [page, setPage] = useState(1);
  const key = trueCpaLeadsKey(params, page, pageSize);
  const [result, setResult] = useState<VendorScorecardLeadResult | null>(() => seed<VendorScorecardLeadResult>(key)?.data ?? null);
  const [loading, setLoading] = useState(() => !seed(key)?.data);
  const [error, setError] = useState("");

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setError("");
    try {
      const body = await (fresh ? loadResource<VendorScorecardLeadResult>(key) : readResource<VendorScorecardLeadResult>(key));
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the leads behind this figure");
    } finally {
      setLoading(false);
    }
  }, [key]);
  useEffect(() => {
    const kept = peek<VendorScorecardLeadResult>(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.data) setResult((current) => current ?? kept.data ?? null);
    void load();
  }, [key, load]);

  useReportsTitle(result?.total != null ? `${title} · ${plural(result.total, "lead")}` : title);

  // The whole selection's sums, so the rows reconcile with the figure that was clicked: the toolbar's line (7·7).
  const sums = result?.sums;
  const period = reportPeriod(params.from, params.to);
  const line = sums
    ? `${period} · ${plural(sums.attempts, "attempt")} · ${sums.contacted_leads.toLocaleString()} contacted · ${sums.issued_policies.toLocaleString()} issued`
    : `${period} · in this report's period and filters`;
  const foot = `Operational fields only: no phone, SSN or health details${result && !result.drillReady ? ` · until a database update is applied, attempts and contacts are all time${result.has_more ? " and only the newest 500 leads are listed" : ""}` : ""}`;

  return (
    <TableCard
      toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load(true)} refreshing={loading} />}><span className="text-sm text-muted-foreground">{line}</span></DataToolbar>}
      footer={result && result.total != null && result.total > pageSize
        ? <Pager page={page} total={result.total} noun="leads" pageSize={pageSize} disabled={loading} onPage={setPage} suffix={foot} />
        : <span>{foot}</span>}
    >
      {error && !result ? <ErrorState title="The leads did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />
        : loading && !result ? <SectionLoading rows={8} columns={6} />
        : !result || result.rows.length === 0 ? <EmptyState title="No leads behind this figure" hint="Widen the period on True CPA to see more." />
        : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Lead date</th><th>Campaign</th><th className="text-right">Attempts</th><th className="text-right">Contacts</th><th className="text-right">Issued</th><th>Attribution</th></tr></thead>
            <tbody className="m-seq">
              {result.rows.map((lead) => {
                const href = `/app/leads/${lead.lead_id}`;
                return (
                  <tr key={lead.lead_id} className="m-row cursor-pointer" onClick={() => router.push(href)}>
                    <td className="whitespace-nowrap font-medium tabular-nums text-foreground"><Link href={href} className="hover:underline" onClick={(event) => event.stopPropagation()}>{leadDay(lead.lead_date)}</Link></td>
                    <td className="max-w-[320px] truncate whitespace-nowrap" title={`${lead.campaign_name} · ${lead.vendor_name}`}>{lead.campaign_name}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{lead.attempts.toLocaleString()}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{lead.contacts.toLocaleString()}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{lead.issued_policies.toLocaleString()}</td>
                    <td className="whitespace-nowrap">{attribution(lead)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </TableCard>
  );
}

const CSV_PAGE = 500;
const CSV_MAX = 10_000;
const cell = (value: unknown) => csvCell(value);

/**
 * Download CSV on the title line (board 7·7): every lead behind the figure (up to 10,000), operational fields only,
 * read page by page from the same route the table reads.
 */
export function TrueCpaLeadsDownload({ params, title }: { params: Record<string, string>; title: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const rows: VendorScorecardLead[] = [];
      for (let offset = 0; offset < CSV_MAX; offset += CSV_PAGE) {
        const response = await fetch(`/api/app/true-cpa/leads?${new URLSearchParams({ ...params, offset: String(offset), limit: String(CSV_PAGE) })}`, { cache: "no-store" });
        const body = await response.json().catch(() => null) as VendorScorecardLeadResult | { error?: string } | null;
        if (!response.ok || !body || !("rows" in body)) throw new Error((body as { error?: string } | null)?.error ?? "Could not read the leads");
        rows.push(...body.rows);
        if (!body.has_more || body.rows.length < CSV_PAGE) break;
      }
      const header = ["lead_date", "campaign", "vendor", "product", "attempts", "contacts", "applications", "issued_policies", "attribution"];
      const csv = [header.map(cell).join(","), ...rows.map((lead) => [lead.lead_date, lead.campaign_name, lead.vendor_name, lead.product_line, lead.attempts, lead.contacts, lead.applications, lead.issued_policies, lead.attribution_status].map(cell).join(","))].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const name = `True CPA · ${title} · ${reportPeriod(params.from, params.to)}.csv`;
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify.done(`Exported ${plural(rows.length, "lead")}.`, { detail: name });
    } catch (cause) {
      notify.fail("The leads did not export.", { detail: cause instanceof Error ? cause.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }
  return <ReportsSlot slot="corner"><Button type="button" variant="outline" disabled={busy} onClick={() => void download()}><Download aria-hidden="true" />{busy ? "Preparing…" : "Download CSV"}</Button></ReportsSlot>;
}
