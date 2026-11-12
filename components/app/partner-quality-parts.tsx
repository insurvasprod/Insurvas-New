"use client";

import { useCallback, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Pager as SharedPager, paginate as sharedPaginate } from "@/components/ui/pager";
import { PeriodPicker } from "@/components/app/reports/period-picker";
import { PARTNER_TYPE_LABELS, type PartnerType } from "@/lib/partners/constants";
import { productLineLabel } from "@/lib/format/productLine";
import { csvCellMinimal } from "@/lib/csv/cell";
import { validPartnerQualityPeriod } from "@/lib/partnerQuality/metrics";
import { reportPeriod } from "@/lib/reports/periodText";
import type { PartnerQualityMetric } from "@/lib/partnerQuality/types";

// Pieces shared by the Partner quality list (/app/partner-quality) and a partner's own page
// (/app/partner-quality/[partnerId]): formatting, the "prev" figure, the period inputs, the pager and
// the way into the exact leads behind a number (their own page since the foundation pass, 2026-11-03).

export type Period = { from: string; to: string };

export const validPeriod = validPartnerQualityPeriod;

export function periodQuery(period: Period) { return new URLSearchParams({ from: period.from, to: period.to }).toString(); }

/**
 * Put the period into the address in place, keeping every other parameter (`?show=`, the tab, the sort), so a
 * partner's page, the way back and a reload use the same one.
 */
export function replacePeriodInUrl(period: Period) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("from", period.from);
    url.searchParams.set("to", period.to);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch { /* not fatal */ }
}

/** Set (or, with null, remove) address parameters in place; Next's useSearchParams follows. */
export function replaceParams(values: Record<string, string | null>) {
  try {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(values)) {
      if (value == null || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch { /* not fatal */ }
}
export function percent(value: number | null | undefined) { return value == null ? "—" : `${value.toFixed(1)}%`; }
export function count(value: number) { return value.toLocaleString(); }
export function dateText(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
export function periodText(period: Period) { return reportPeriod(period.from, period.to); }
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

/**
 * A figure in a one-line row that opens the leads behind it (the row itself opens its record, so the click
 * stops here). Plain figure, one text colour: the underline shows on hover.
 */
export function FigureLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return <Link href={href} aria-label={label} onClick={(event: MouseEvent) => event.stopPropagation()} className="tabular-nums text-[var(--body)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">{children}</Link>;
}

export function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className="font-semibold [letter-spacing:inherit] [text-transform:inherit] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" onClick={onClick}>{label}{active ? " ↕" : ""}</button>;
}

/** From – To, as two toolbar-height date inputs. Applies as soon as both dates form a valid range. */
/** Tooltip on the period inputs: the reporting calendar (PARTNER_QUALITY_TIME_ZONE, Etc/GMT+5). */
export const REPORTING_CALENDAR_HINT = "Days run on a fixed EST (UTC−5) calendar all year, whoever is reading.";
/** Tooltip on the conversion figures: this report has no cost data. */
export const NO_COST_HINT = "Quality and conversion only. Cost data is not included yet; spend and CPA come from accounting.";

/** The Reports period control (components/app/reports/period-picker.tsx) on this report's EST calendar. */
export function PeriodInputs({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <span className="inline-flex" title={REPORTING_CALENDAR_HINT}>
      <PeriodPicker value={value} onChange={(next) => { const valid = validPeriod(next.from, next.to); if (valid) onChange(valid); }} />
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
  // csvCell neutralises text a spreadsheet would run as a formula (CSV injection); numbers pass as is.
  const cell = (value: string | number | null) => csvCellMinimal(value);
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

/**
 * ‹ › on a partner's page (Reports round 7, 8·4): the partners either side in the list's order, each button naming
 * the partner it opens. Small and truncated, so the tabs, these, the switch and ⋯ keep one line at 1600px with the
 * rail open; the full name is the button's title.
 */
export function PartnerStepper({ previous, next }: { previous?: { href: string; label: string } | null; next?: { href: string; label: string } | null }) {
  if (!previous && !next) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 self-center">
      {previous && <Link href={previous.href} className={buttonVariants({ variant: "outline", size: "sm" })} title={`Previous partner: ${previous.label}`}><ChevronLeft aria-hidden="true" /><span className="max-w-24 truncate">{previous.label}</span></Link>}
      {next && <Link href={next.href} className={buttonVariants({ variant: "outline", size: "sm" })} title={`Next partner: ${next.label}`}><span className="max-w-24 truncate">{next.label}</span><ChevronRight aria-hidden="true" /></Link>}
    </span>
  );
}

// ── Drill-down ────────────────────────────────────────────────────────────────────────────────

export type DrilldownRequest = { label: string; partnerId: string; metric: PartnerQualityMetric; period: Period; disposition?: string; partnerUserId?: string };

/** The page of leads behind a figure: /app/partner-quality/[partnerId]/leads, keeping the period and the figure's name. */
export function drilldownHref(request: DrilldownRequest) {
  const params = new URLSearchParams({ ...request.period, metric: request.metric, label: request.label });
  if (request.disposition) params.set("disposition", request.disposition);
  if (request.partnerUserId) params.set("member", request.partnerUserId);
  return `/app/partner-quality/${request.partnerId}/leads?${params}`;
}

/**
 * Opens the exact leads behind a figure (LA-1.18: any cell opens exactly the leads it counted). It was a
 * side drawer; it is a page now (foundation pass 2026-11-03, docs/reports/FOUNDATION-PASS.md: no side
 * panels), under Reports › Partner quality › the partner, also from a partner record's Quality tab.
 */
export function useDrilldown() {
  const router = useRouter();
  const open = useCallback((next: DrilldownRequest) => { router.push(drilldownHref(next)); }, [router]);
  return { open };
}
