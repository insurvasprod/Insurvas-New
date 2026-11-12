import "server-only";

import { getVendorScorecard, getVendorScorecardLeads } from "./service";
import type { ScorecardStage, VendorScorecardLead } from "./types";
import { seriesBuckets, stageCount, type SeriesGrain, type SeriesPoint, type TrueCpaSeries } from "@/lib/reports/trueCpaView";

/**
 * True CPA over time (Reports round 7: the cards keep a small chart, 0·C). No new SQL: the period is cut into
 * at most 13 buckets (lib/reports/trueCpaView.ts) and the one report, tenant_vendor_scorecard_report, is read
 * for each, so a week's net spend, leads and policies are counted exactly as the period's are. Four reads at a
 * time, so a long period does not land thirteen report reads on the database at once.
 */
type Scope = { from: string; to: string; vendorId?: string | null; campaignId?: string | null; productCode?: string | null; persistDays?: number | null };

async function inBatches<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size) out.push(...await Promise.all(items.slice(start, start + size).map(work)));
  return out;
}

export async function getScorecardSeries(tenantId: string, scope: Scope, grain: SeriesGrain = "week"): Promise<TrueCpaSeries> {
  const buckets = seriesBuckets(scope.from, scope.to, grain);
  const points = await inBatches(buckets, 4, async (bucket): Promise<SeriesPoint> => {
    const report = await getVendorScorecard(tenantId, { from: bucket.from, to: bucket.to, vendorId: scope.vendorId, campaignId: scope.campaignId, productCode: scope.productCode, persistDays: scope.persistDays }, true);
    const t = report.totals;
    return {
      ...bucket,
      net_spend_cents: Number(t.net_spend_cents ?? 0),
      leads_received: t.leads_received,
      dialable_leads: t.dialable_leads,
      undialable_leads: t.undialable_leads,
      dialed_leads: t.dialed_leads,
      contacted_leads: t.contacted_leads,
      quoted_leads: t.quoted_leads,
      applied_leads: t.applied_leads,
      applications: t.applications,
      issued_policies: t.issued_policies,
    };
  });
  return { grain, points };
}

/** One bar of "Where these leads came from": a vendor, or a campaign when the drill is one vendor already. */
export type LeadsSourceRow = { key: string; label: string; count: number; vendorId: string | null; campaignId: string | null };
export type LeadsBreakdown = {
  /** "vendor" or "campaign": what the source bars are. */
  by: "vendor" | "campaign";
  sources: LeadsSourceRow[];
  months: Array<{ key: string; label: string; from: string; to: string; count: number }>;
  /** When the cut (a slot or an attempt) is not in the report, the bars are counted from the drill's rows: at most this many. */
  sampled: number | null;
};

const SAMPLE_PAGES = 10;
const SAMPLE_PAGE = 500;

/**
 * The leads behind a figure, as two pictures (board 7·7, chart view): where they came from and when they
 * arrived. A stage of a scope is in the report itself (its vendor and campaign lines, and the report per
 * month); a slot or an attempt number is not, so those count the drill's own rows, up to 5,000.
 */
export async function getLeadsBreakdown(tenantId: string, scope: Scope & { stage: ScorecardStage; slot?: string | null; attemptNumber?: string | null }): Promise<LeadsBreakdown> {
  const by = scope.vendorId ? "campaign" : "vendor";
  if (!scope.slot && !scope.attemptNumber) {
    const [report, series] = await Promise.all([
      getVendorScorecard(tenantId, { from: scope.from, to: scope.to, vendorId: scope.vendorId, campaignId: scope.campaignId, productCode: scope.productCode, persistDays: scope.persistDays }, true),
      getScorecardSeries(tenantId, scope, "month"),
    ]);
    const sources: LeadsSourceRow[] = by === "vendor"
      ? report.vendor_rows.map((row) => ({ key: row.vendor_id, label: row.vendor_name, count: stageCount(row, scope.stage), vendorId: row.vendor_id, campaignId: null }))
      : report.rows.map((row) => ({ key: row.campaign_id, label: row.campaign_name, count: stageCount(row, scope.stage), vendorId: row.vendor_id, campaignId: row.campaign_id }));
    return {
      by,
      sources: sources.filter((row) => row.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      months: series.points.map((point) => ({ key: point.key, label: point.label, from: point.from, to: point.to, count: stageCount(point, scope.stage) })),
      sampled: null,
    };
  }
  const rows: VendorScorecardLead[] = [];
  let more = false;
  for (let page = 0; page < SAMPLE_PAGES; page += 1) {
    const result = await getVendorScorecardLeads(tenantId, { from: scope.from, to: scope.to, vendorId: scope.vendorId, campaignId: scope.campaignId, productCode: scope.productCode, stage: scope.stage, slot: scope.slot, attemptNumber: scope.attemptNumber, persistDays: scope.persistDays, offset: page * SAMPLE_PAGE, limit: SAMPLE_PAGE });
    rows.push(...result.rows);
    more = result.has_more;
    if (!result.has_more) break;
  }
  const sourceCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  for (const row of rows) {
    const name = by === "vendor" ? row.vendor_name : row.campaign_name;
    sourceCounts.set(name, (sourceCounts.get(name) ?? 0) + 1);
    const month = String(row.lead_date).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }
  return {
    by,
    sources: [...sourceCounts.entries()].map(([label, count]) => ({ key: label, label, count, vendorId: null, campaignId: null })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    months: seriesBuckets(scope.from, scope.to, "month").map((bucket) => ({ key: bucket.key, label: bucket.label, from: bucket.from, to: bucket.to, count: monthCounts.get(bucket.key) ?? 0 })),
    sampled: more ? rows.length : null,
  };
}
