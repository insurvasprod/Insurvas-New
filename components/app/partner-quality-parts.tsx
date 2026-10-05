"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pager as SharedPager, paginate as sharedPaginate } from "@/components/ui/pager";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { PARTNER_TYPE_LABELS, type PartnerType } from "@/lib/partners/constants";
import { productLineLabel } from "@/lib/format/productLine";
import { cn } from "@/lib/utils";
import { validPartnerQualityPeriod } from "@/lib/partnerQuality/metrics";
import type { PartnerQualityLeadResult, PartnerQualityMetric } from "@/lib/partnerQuality/types";

// Pieces shared by the Partner quality list (/app/partner-quality) and a partner's own page
// (/app/partner-quality/[partnerId]): formatting, the "prev" figure, the period inputs, the pager and
// the drill-down drawer that lists the exact leads behind a number.

export type Period = { from: string; to: string };

export const validPeriod = validPartnerQualityPeriod;

export function periodQuery(period: Period) { return new URLSearchParams({ from: period.from, to: period.to }).toString(); }
export function percent(value: number | null | undefined) { return value == null ? "—" : `${value.toFixed(1)}%`; }
export function count(value: number) { return value.toLocaleString(); }
export function dateText(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
export function periodText(period: Period) { return `${dateText(period.from)} – ${dateText(period.to)}`; }
export function partnerTypeLabel(type: string | null | undefined) { return type && type in PARTNER_TYPE_LABELS ? PARTNER_TYPE_LABELS[type as PartnerType] : "Partner"; }
export function humanize(value: string | null | undefined) { return value ? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : "—"; }
export function dispositionText(key: string | null | undefined, labels: Record<string, string> = {}) { return key ? labels[key] ?? humanize(key) : "—"; }
export function productText(value: string | null | undefined) { return value ? productLineLabel(value) : "—"; }

export function metricLabel(metric: PartnerQualityMetric) {
  return ({ sent: "Sent", claimed: "Claimed", worked: "Worked", submitted: "Submitted", disqualified: "Disqualified", tcpa: "TCPA blocked", dnc: "DNC flagged", invalid: "Invalid phone", duplicate: "Duplicates", disposition: "Disposition" })[metric];
}

/** The same figure for the prior period, under the current one (LA-1.18 "against previous period"). */
export function Prior({ value, label }: { value: string; label: string }) {
  return <span className="block text-xs leading-tight text-muted-foreground tabular-nums" aria-label={`${label} in the prior period: ${value}`}>prev {value}</span>;
}

/** A figure in a table cell that opens the leads behind it. */
export function MetricCell({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className="rounded px-1 font-normal tabular-nums text-[var(--body)]! underline-offset-4 hover:bg-transparent! hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" aria-label={label} onClick={onClick}>{children}</button>;
}

export function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className="font-semibold [letter-spacing:inherit] [text-transform:inherit] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" onClick={onClick}>{label}{active ? " ↕" : ""}</button>;
}

/** From – To, as two toolbar-height date inputs. Applies as soon as both dates form a valid range. */
/** Tooltip on the period inputs: the reporting calendar (PARTNER_QUALITY_TIME_ZONE, Etc/GMT+5). */
export const REPORTING_CALENDAR_HINT = "Days run on a fixed EST (UTC−5) calendar all year, whoever is reading.";
/** Tooltip on the conversion figures: this report has no cost data. */
export const NO_COST_HINT = "Quality and conversion only. Cost data is not included yet; spend and CPA come from accounting.";

export function PeriodInputs({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  const [draft, setDraft] = useState(value);
  // Follow an outside change (e.g. the parent resetting the period) without fighting the user's typing.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(value); }, [value]);
  const update = (next: Period) => { setDraft(next); const valid = validPeriod(next.from, next.to); if (valid) onChange(valid); };
  const invalid = !validPeriod(draft.from, draft.to);
  return (
    <span className="inline-flex items-center gap-1.5" title={REPORTING_CALENDAR_HINT}>
      <input type="date" aria-label="From date" value={draft.from} max={draft.to || undefined} onChange={(event) => update({ ...draft, from: event.target.value })} className={cn(toolbarControl, invalid && "border-destructive")} />
      <span className="text-sm text-muted-foreground" aria-hidden="true">–</span>
      <input type="date" aria-label="To date" value={draft.to} min={draft.from || undefined} onChange={(event) => update({ ...draft, to: event.target.value })} className={cn(toolbarControl, invalid && "border-destructive")} />
    </span>
  );
}

export const PAGE_SIZE = 10;

/** The shared pager and slicer (components/ui/pager.tsx), at this report's ten rows a page. */
export function Pager(props: ComponentProps<typeof SharedPager>) {
  return <SharedPager pageSize={PAGE_SIZE} {...props} />;
}

export function paginate<T>(rows: T[], page: number, pageSize = PAGE_SIZE) {
  return sharedPaginate(rows, page, pageSize);
}

/** Download rows as a CSV file, built in the browser from what the table already holds. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => { const text = value == null ? "" : String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

// ── Drill-down ────────────────────────────────────────────────────────────────────────────────

export type DrilldownRequest = { label: string; partnerId: string; metric: PartnerQualityMetric; period: Period; disposition?: string; partnerUserId?: string };

const DRAWER_PAGE_SIZE = 50;

/** Opens the exact leads behind a figure in a side drawer. Returns the opener and the drawer to render. */
export function useDrilldown(labels: Record<string, string> = {}) {
  const [request, setRequest] = useState<DrilldownRequest | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PartnerQualityLeadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (next: DrilldownRequest, nextPage: number) => {
    setLoading(true); setError("");
    try {
      // A partner user's leads are filtered after the page is read, so read them in one page.
      const params = new URLSearchParams({ ...next.period, partner_id: next.partnerId, metric: next.metric, page: String(next.partnerUserId ? 1 : nextPage), page_size: String(next.partnerUserId ? 1000 : DRAWER_PAGE_SIZE) });
      if (next.disposition) params.set("disposition", next.disposition);
      if (next.partnerUserId) params.set("partner_user_id", next.partnerUserId);
      const response = await fetch(`/api/app/partner-quality/leads?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error ?? "Could not load these leads"); else setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load these leads");
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback((next: DrilldownRequest) => { setRequest(next); setPage(1); setData(null); void load(next, 1); }, [load]);
  const close = useCallback(() => { setRequest(null); setData(null); setError(""); }, []);
  const turn = (nextPage: number) => { if (!request) return; setPage(nextPage); void load(request, nextPage); };

  const drawer = request ? <PartnerQualityDrawer label={request.label} data={data} loading={loading} error={error} labels={labels} page={page} pageSize={request.partnerUserId ? 1000 : DRAWER_PAGE_SIZE} onPage={turn} onClose={close} /> : null;
  return { open, drawer };
}

function PartnerQualityDrawer({ label, data, loading, error, labels, page, pageSize, onPage, onClose }: { label: string; data: PartnerQualityLeadResult | null; loading: boolean; error: string; labels: Record<string, string>; page: number; pageSize: number; onPage: (page: number) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const drawer = (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="flex h-full w-full max-w-[960px] flex-col border-l border-border bg-card shadow-xl" role="dialog" aria-modal="true" aria-labelledby="quality-drawer-title">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="quality-drawer-title" className="truncate text-lg font-semibold tracking-[-0.015em]">{label}</h2>
            {data && <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">{data.total.toLocaleString()} lead{data.total === 1 ? "" : "s"}</p>}
          </div>
          <Button ref={closeRef} type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <p role="alert" className="m-5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {loading && <SectionLoading rows={8} columns={5} label="Loading leads" />}
          {data && !loading && (data.rows.length === 0
            ? <EmptyState title="No leads" hint="Nothing matches this figure in the selected period." />
            : <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
                <thead><tr><th>Received</th><th>Customer</th><th>State</th><th>Product</th><th>Disposition</th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>{data.rows.map((lead) => (
                  <tr key={lead.lead_id}>
                    <td className="tabular-nums">{dateText(lead.date)}</td>
                    <td><span className="block font-semibold">{lead.full_name}</span><span className="block text-xs text-muted-foreground tabular-nums">{lead.phone ?? "No phone"}</span></td>
                    <td>{lead.state ?? "—"}</td>
                    <td>{productText(lead.product)}</td>
                    <td>{lead.disposition ? dispositionText(lead.disposition, labels) : lead.submitted ? "Submitted" : "—"}</td>
                    <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={`/app/leads/${lead.lead_id}`} aria-label={`Open ${lead.full_name}`}>Open</Link></Button></td>
                  </tr>
                ))}</tbody>
              </table>)}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-border bg-[var(--canvas)] px-5 py-3 text-xs text-muted-foreground">
          <span className="flex flex-wrap items-center gap-3">{data && data.total > pageSize && <Pager page={page} total={data.total} pageSize={pageSize} noun="leads" onPage={onPage} />}</span>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </footer>
      </aside>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(drawer, document.body);
}
