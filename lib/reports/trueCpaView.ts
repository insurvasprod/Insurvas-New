/**
 * True CPA's address and its series (Reports round 7, owner pick 7·A on every tab, 2026-11-11). A plain
 * module (no React, no "use client", no server-only import), so the server page, the series route and the
 * client workspace read the same scope from the same address and cut the same weeks.
 *
 * The scope lives in the address (`?from&to&vendor_id&campaign_id&product_code&persist_days&by`), so a
 * chart's bar can open the table filtered to its rows (`?show=table&vendor_id=…`) and a reload keeps it.
 */

import type { ScorecardStage } from "@/lib/vendorScorecard/types";

/** The persistency toggle's window. User decision: 60 days. Mirrors SCORECARD_PERSIST_DAYS on the server. */
export const TRUE_CPA_PERSIST_DAYS = 60;

export type TrueCpaScope = { from: string; to: string; vendorId: string; campaignId: string; productCode: string; persist: boolean };
export type TrueCpaGrain = "vendor" | "campaign";

type ParamsLike = URLSearchParams | { get(name: string): string | null } | Record<string, string | string[] | undefined> | null | undefined;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT = /^[a-z][a-z0-9_\-]{0,79}$/;

function raw(params: ParamsLike, name: string): string {
  if (!params) return "";
  if (typeof (params as { get?: unknown }).get === "function") return (params as { get(name: string): string | null }).get(name) ?? "";
  const value = (params as Record<string, string | string[] | undefined>)[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The scope an address asks for; a value that is not well formed is left out rather than sent to the RPC. */
export function scopeFromParams(params: ParamsLike, fallback: { from: string; to: string }): TrueCpaScope {
  let from = raw(params, "from");
  let to = raw(params, "to");
  if (!DAY.test(from) || !DAY.test(to) || from > to) { from = fallback.from; to = fallback.to; }
  const vendorId = raw(params, "vendor_id");
  const campaignId = raw(params, "campaign_id");
  const productCode = raw(params, "product_code");
  return {
    from,
    to,
    vendorId: UUID.test(vendorId) ? vendorId : "",
    campaignId: UUID.test(campaignId) ? campaignId : "",
    productCode: PRODUCT.test(productCode) ? productCode : "",
    persist: raw(params, "persist_days") !== "",
  };
}

/** By vendor or by campaign (`?by=campaign`); vendor is the default. */
export function grainFromParams(params: ParamsLike): TrueCpaGrain {
  return raw(params, "by") === "campaign" ? "campaign" : "vendor";
}

/** The scope as the API's query string (and the cache's key). */
export function scopeQuery(scope: TrueCpaScope): string {
  const params = new URLSearchParams({ from: scope.from, to: scope.to });
  if (scope.vendorId) params.set("vendor_id", scope.vendorId);
  if (scope.campaignId) params.set("campaign_id", scope.campaignId);
  if (scope.productCode) params.set("product_code", scope.productCode);
  if (scope.persist) params.set("persist_days", String(TRUE_CPA_PERSIST_DAYS));
  return params.toString();
}

/** The scope as address parameters to set in place; an empty value removes its parameter. */
export function scopeParams(scope: TrueCpaScope): Record<string, string | null> {
  return {
    from: scope.from,
    to: scope.to,
    vendor_id: scope.vendorId || null,
    campaign_id: scope.campaignId || null,
    product_code: scope.productCode || null,
    persist_days: scope.persist ? String(TRUE_CPA_PERSIST_DAYS) : null,
  };
}

/** The scope a report was computed for, as the same query string: a server-rendered report is reused when it matches. */
export function reportScopeQuery(report: { from: string; to: string; persist_days: number | null; filters: { vendor_id: string | null; campaign_id: string | null; product_code: string | null } }): string {
  return scopeQuery({ from: report.from, to: report.to, vendorId: report.filters?.vendor_id ?? "", campaignId: report.filters?.campaign_id ?? "", productCode: report.filters?.product_code ?? "", persist: report.persist_days != null });
}

/* ── Series ─────────────────────────────────────────────────────────────────────────────────────── */

export type SeriesGrain = "week" | "month";
export type SeriesBucket = { key: string; label: string; from: string; to: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const isoOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** At most this many buckets a series: each is one report read, so a long period gets wider weeks, not more reads. */
export const SERIES_MAX_BUCKETS = 13;

/**
 * The period cut into buckets that cover it exactly, oldest first. Weeks start on the period's first day
 * (a period longer than 13 weeks gets buckets of more than seven days); months are calendar months,
 * clipped to the period.
 */
export function seriesBuckets(from: string, to: string, grain: SeriesGrain = "week"): SeriesBucket[] {
  if (!DAY.test(from) || !DAY.test(to) || from > to) return [];
  const first = dayNumber(from);
  const last = dayNumber(to);
  const out: SeriesBucket[] = [];
  if (grain === "month") {
    let cursor = from;
    while (cursor <= to && out.length < 24) {
      const y = Number(cursor.slice(0, 4));
      const m = Number(cursor.slice(5, 7));
      const monthEnd = isoOf(dayNumber(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`) - 1);
      const end = monthEnd < to ? monthEnd : to;
      out.push({ key: cursor.slice(0, 7), label: MONTH_NAMES[m - 1], from: cursor, to: end });
      cursor = isoOf(dayNumber(end) + 1);
    }
    return out;
  }
  const span = last - first + 1;
  const width = Math.max(7, Math.ceil(span / SERIES_MAX_BUCKETS));
  for (let start = first; start <= last; start += width) {
    const end = Math.min(last, start + width - 1);
    out.push({ key: isoOf(start), label: short(isoOf(start)), from: isoOf(start), to: isoOf(end) });
  }
  return out;
}

/** One bucket's totals, as much of the report's totals as the cards and charts read. */
export type SeriesPoint = SeriesBucket & {
  net_spend_cents: number;
  leads_received: number;
  dialable_leads: number;
  undialable_leads: number;
  dialed_leads: number | null;
  contacted_leads: number;
  quoted_leads: number | null;
  applied_leads: number | null;
  applications: number;
  issued_policies: number;
};
export type TrueCpaSeries = { grain: SeriesGrain; points: SeriesPoint[] };

/** Stage counts on a report line (a vendor, a campaign, a bucket's totals). */
type StageCounts = { leads_received: number; dialable_leads: number; undialable_leads: number; dialed_leads: number | null; contacted_leads: number; quoted_leads: number | null; applied_leads: number | null; applications: number; issued_policies: number };

/** How many leads a line counts at a funnel stage: the figure a drill of that stage lists. */
export function stageCount(line: StageCounts, stage: ScorecardStage): number {
  switch (stage) {
    case "received": return line.leads_received ?? 0;
    case "dialable": return line.dialable_leads ?? 0;
    case "undialable": return line.undialable_leads ?? 0;
    case "dialed": return line.dialed_leads ?? 0;
    case "contacted": return line.contacted_leads ?? 0;
    case "quoted": return line.quoted_leads ?? 0;
    case "applied": return line.applied_leads ?? line.applications ?? 0;
    case "issued": return line.issued_policies ?? 0;
  }
}

/**
 * True CPA to date, a point a bucket: running net spend ÷ running issued policies. It starts at the first
 * bucket with an issued policy (before it there is no True CPA, never $0), so it can be shorter than the
 * period, or empty.
 */
export function cumulativeCpa(points: readonly Pick<SeriesPoint, "net_spend_cents" | "issued_policies">[]): number[] {
  let spend = 0;
  let issued = 0;
  const out: number[] = [];
  for (const point of points) {
    spend += point.net_spend_cents ?? 0;
    issued += point.issued_policies ?? 0;
    if (issued > 0) out.push(Math.round(spend / issued) / 100);
  }
  return out;
}

/* ── Labels ─────────────────────────────────────────────────────────────────────────────────────── */

/** A drill's short name: the title line reads "Applied · 115 leads" (board 7·7). */
export const STAGE_TITLE: Record<ScorecardStage, string> = {
  received: "Received", dialable: "Dialable", undialable: "Undialable", dialed: "Dialled",
  contacted: "Contacted", quoted: "Quoted", applied: "Applied", issued: "Issued",
};

/** "early_morning" → "Early morning". */
export function slotLabel(slot: string): string {
  const text = slot.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The bars' short names under the axis: "Early am", "Late pm" (board 7·5). */
export function slotShort(slot: string): string {
  const map: Record<string, string> = { early_morning: "Early am", late_morning: "Late am", afternoon: "Afternoon", early_evening: "Early pm", late_evening: "Late pm", weekend: "Weekend" };
  return map[slot] ?? slotLabel(slot);
}

/** The time-of-day slots in the day's order, then any the report adds. */
export const SLOT_ORDER = ["early_morning", "late_morning", "afternoon", "early_evening", "late_evening", "weekend"];
export function bySlotOrder<T extends { slot: string }>(items: readonly T[]): T[] {
  const at = (slot: string) => { const index = SLOT_ORDER.indexOf(slot); return index < 0 ? SLOT_ORDER.length : index; };
  return [...items].sort((a, b) => at(a.slot) - at(b.slot) || a.slot.localeCompare(b.slot));
}
