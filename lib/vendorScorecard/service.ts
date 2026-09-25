import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { scorecardCsv } from "./format";
import { vendorReturnCsv, type EvidenceContext } from "./returnFormat";
import { normalizeScorecard } from "./normalize";
import { checkComparisonPeriods, comparisonErrorText, type ComparisonPeriod, type PeriodProblem } from "./comparePeriods";

/** Two periods the comparison would refuse, with the matched period B could use instead. */
export class ComparisonPeriodError extends Error {
  constructor(readonly problem: PeriodProblem, message: string, readonly suggestion: ComparisonPeriod | null) {
    super(message);
    this.name = "ComparisonPeriodError";
  }
}
import { SCORECARD_STAGES } from "./types";
import type { CampaignComparison, ScorecardStage, VendorReturnClaimDetail, VendorReturnClaim, VendorReturnsReport, VendorScorecardLead, VendorScorecardLeadResult, VendorScorecardReport, VendorScorecardVendorRow } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertScorecardDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !DATE.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a real calendar date`);
  return value;
}

export function optionalScorecardUuid(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function optionalProduct(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^[a-z][a-z0-9_\-]{0,79}$/.test(value)) throw new Error("Invalid product code");
  return value;
}

function dates(filters: { from?: unknown; to?: unknown }) {
  const from = filters.from == null || filters.from === "" ? null : assertScorecardDate(filters.from, "From date");
  const to = filters.to == null || filters.to === "" ? null : assertScorecardDate(filters.to, "To date");
  if (from && to && from > to) throw new Error("From date must be on or before To date");
  return { from, to };
}

type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
function rpcClient() { return getSupabaseServiceClient() as unknown as RpcClient; }

function scorecardMetrics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The vendor return metrics were invalid");
  const rows = Array.isArray((value as { rows?: unknown }).rows) ? (value as { rows: unknown[] }).rows : [];
  return new Map(rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)).map((row) => [String(row.campaign_id), row]));
}

/** "The function you named does not exist with these arguments": the report migration is not applied. */
function isMissingFunction(error: { message: string; code?: string } | null) {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|function .* does not exist/i.test(error.message);
}

/** The persistency window the page's toggle sends. User decision: 60 days. */
export const SCORECARD_PERSIST_DAYS = 60;

function isoDay(date: Date) { return date.toISOString().slice(0, 10); }
/** The default period, 90 days ending today — the same default the SQL applies. */
export function defaultScorecardPeriod(today = new Date()) {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 89));
  return { from: isoDay(from), to: isoDay(today) };
}

export async function getVendorScorecard(tenantId: string, filters: { from?: unknown; to?: unknown; vendorId?: unknown; campaignId?: unknown; productCode?: unknown; persistDays?: unknown }, readOnly: boolean): Promise<VendorScorecardReport> {
  const parsed = dates(filters);
  const fallback = defaultScorecardPeriod();
  const from = parsed.from ?? fallback.from;
  const to = parsed.to ?? fallback.to;
  if (from > to) throw new Error("From date must be on or before To date");
  const vendorId = optionalScorecardUuid(filters.vendorId, "vendor");
  const campaignId = optionalScorecardUuid(filters.campaignId, "campaign");
  const productCode = optionalProduct(filters.productCode);
  const persistDays = filters.persistDays == null || filters.persistDays === "" ? null : Number(filters.persistDays);
  if (persistDays !== null && (!Number.isInteger(persistDays) || persistDays < 1 || persistDays > 730)) throw new Error("Persistency must be a whole number of days from 1 to 730");
  const client = rpcClient();
  const args = { p_tenant_id: tenantId, p_from_date: from, p_to_date: to, p_vendor_id: vendorId, p_campaign_id: campaignId, p_product_code: productCode };
  // Since 20260925709800 the report carries the undialable and claim figures itself, and the second
  // RPC beside it (1.8 s for twelve months) is not made at all. Until this process has seen that,
  // both run in parallel as before, so a page before the migration is no slower than it was.
  const metricsCall = reportCarriesReturns ? Promise.resolve(null) : client.rpc("vendor_return_metrics", args);
  const [first, metricsFirst] = await Promise.all([
    client.rpc("tenant_vendor_scorecard_report", { ...args, p_persist_days: persistDays }),
    metricsCall,
  ]);
  // Before 20260925708200 the report has six arguments. Fall back to it and say so on the page;
  // persistency, test batches and the vendor roll-up need the new one.
  let reportResult = first;
  let upgraded = true;
  if (isMissingFunction(first.error as { message: string; code?: string } | null)) {
    upgraded = false;
    reportResult = await client.rpc("tenant_vendor_scorecard_report", args);
  }
  if (reportResult.error) throw new Error(`Could not load vendor scorecard: ${reportResult.error.message}`);
  const carries = Boolean(reportResult.data && typeof reportResult.data === "object" && (reportResult.data as { returns_included?: unknown }).returns_included === true);
  reportCarriesReturns = carries;
  if (carries) return normalizeScorecard(reportResult.data, new Map(), readOnly, upgraded);
  const metricsResult = metricsFirst ?? await client.rpc("vendor_return_metrics", args);
  if (metricsResult.error) throw new Error(`Could not load vendor return metrics: ${metricsResult.error.message}`);
  return normalizeScorecard(reportResult.data, scorecardMetrics(metricsResult.data), readOnly, upgraded);
}

/** Whether the live report already includes the returns figures (20260925709800), as last seen. */
let reportCarriesReturns = false;

/**
 * THE per-vendor cost per issued policy, for /app/vendors. One definition: the scorecard report's
 * vendor_rows (20260925708200). `available` is false until that migration is applied — the caller
 * shows "—" rather than computing a second, different figure. Never throws for a missing report;
 * any other failure is thrown for the caller to handle.
 */
export async function getVendorCostPerPolicy(tenantId: string, filters: { from?: unknown; to?: unknown; vendorId?: unknown; persistDays?: unknown } = {}): Promise<{ available: boolean; from: string; to: string; persistDays: number | null; rows: VendorScorecardVendorRow[] }> {
  const report = await getVendorScorecard(tenantId, filters, true);
  return { available: report.upgraded, from: report.from, to: report.to, persistDays: report.persist_days, rows: report.vendor_rows };
}

export const DRILL_PAGE_SIZE = 100;
const SLOT = /^[a-z][a-z_]{0,39}$/;

/**
 * The rows behind any scorecard figure (LA-2.17-7): a stage of any scope — all campaigns, a vendor
 * or a campaign — or one attempt number or slot of the curves, paged, with the total and the sums
 * of the whole selection so the rows reconcile with the figure clicked. tenant_vendor_scorecard_drill
 * (20260925709800) counts exactly what the report counts.
 *
 * Before that migration: the old drill, which only answers a vendor's (or campaign's) leads, at most
 * 500, and cannot filter by stage. It is asked for one row more than it returns so the page can say
 * the list is cut off, rather than showing 500 rows as if they were all.
 */
export async function getVendorScorecardLeads(tenantId: string, filters: { from: unknown; to: unknown; vendorId?: unknown; campaignId?: unknown; productCode?: unknown; stage?: unknown; attemptNumber?: unknown; slot?: unknown; persistDays?: unknown; offset?: unknown; limit?: unknown }): Promise<VendorScorecardLeadResult> {
  const from = assertScorecardDate(filters.from, "From date");
  const to = assertScorecardDate(filters.to, "To date");
  if (from > to) throw new Error("From date must be on or before To date");
  const vendorId = optionalScorecardUuid(filters.vendorId, "vendor");
  const campaignId = optionalScorecardUuid(filters.campaignId, "campaign");
  const productCode = optionalProduct(filters.productCode);
  const stage = filters.stage == null || filters.stage === "" ? "received" : String(filters.stage);
  if (!(SCORECARD_STAGES as readonly string[]).includes(stage)) throw new Error("Choose a figure to open");
  const attemptNumber = filters.attemptNumber == null || filters.attemptNumber === "" ? null : Number(filters.attemptNumber);
  if (attemptNumber !== null && (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 100)) throw new Error("Invalid attempt number");
  const slot = filters.slot == null || filters.slot === "" ? null : String(filters.slot);
  if (slot !== null && !SLOT.test(slot)) throw new Error("Invalid slot");
  const persistDays = filters.persistDays == null || filters.persistDays === "" ? null : Number(filters.persistDays);
  if (persistDays !== null && (!Number.isInteger(persistDays) || persistDays < 1 || persistDays > 730)) throw new Error("Persistency must be a whole number of days from 1 to 730");
  const offset = filters.offset == null || filters.offset === "" ? 0 : Number(filters.offset);
  if (!Number.isInteger(offset) || offset < 0) throw new Error("Invalid page");
  const limit = filters.limit == null || filters.limit === "" ? DRILL_PAGE_SIZE : Number(filters.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid page size");

  const client = rpcClient();
  const { data, error } = await client.rpc("tenant_vendor_scorecard_drill", {
    p_tenant_id: tenantId, p_from_date: from, p_to_date: to, p_vendor_id: vendorId, p_campaign_id: campaignId, p_product_code: productCode,
    p_stage: stage, p_attempt_number: attemptNumber, p_slot: slot, p_persist_days: persistDays, p_limit: limit, p_offset: offset,
  });
  if (!error) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The scorecard drill-down was invalid");
    const body = data as Record<string, unknown>;
    return {
      rows: (Array.isArray(body.rows) ? body.rows : []) as VendorScorecardLead[],
      stage: stage as ScorecardStage,
      total: Number(body.total ?? 0),
      offset: Number(body.offset ?? offset),
      limit: Number(body.limit ?? limit),
      has_more: body.has_more === true,
      sums: (body.sums ?? null) as VendorScorecardLeadResult["sums"],
      drillReady: true,
    };
  }
  if (!isMissingFunction(error as { message: string; code?: string })) throw new Error(`Could not load scorecard leads: ${error.message}`);

  // Before 20260925709800.
  if (stage !== "received" || attemptNumber !== null || slot !== null || offset > 0) throw new Error("Opening this figure needs a database update that has not been applied yet.");
  if (!vendorId) throw new Error("Opening every campaign's leads at once needs a database update that has not been applied yet. Open one vendor or campaign.");
  const old = await client.rpc("tenant_vendor_scorecard_leads", { p_tenant_id: tenantId, p_from_date: from, p_to_date: to, p_vendor_id: vendorId, p_campaign_id: campaignId, p_product_code: productCode, p_limit: 500 });
  if (old.error) throw new Error(`Could not load scorecard leads: ${old.error.message}`);
  const rows = ((old.data as { rows?: unknown } | null)?.rows ?? []) as VendorScorecardLead[];
  return { rows, stage: "received", total: null, offset: 0, limit: 500, has_more: rows.length >= 500, sums: null, drillReady: false };
}

export async function getCampaignComparison(tenantId: string, filters: { campaignAId: unknown; campaignBId: unknown; fromA: unknown; toA: unknown; fromB: unknown; toB: unknown; metric: unknown }) {
  const campaignAId = optionalScorecardUuid(filters.campaignAId, "campaign A");
  const campaignBId = optionalScorecardUuid(filters.campaignBId, "campaign B");
  if (!campaignAId || !campaignBId) throw new Error("Choose two campaigns to compare");
  const fromA = assertScorecardDate(filters.fromA, "Campaign A from date");
  const toA = assertScorecardDate(filters.toA, "Campaign A to date");
  const fromB = assertScorecardDate(filters.fromB, "Campaign B from date");
  const toB = assertScorecardDate(filters.toB, "Campaign B to date");
  // The database's matched-period rules, checked first so the refusal is a sentence with the
  // matched period offered, not a raw code (LA-2.18-2).
  const periods = checkComparisonPeriods({ from: fromA, to: toA }, { from: fromB, to: toB }, isoDay(new Date()));
  if (!periods.ok) throw new ComparisonPeriodError(periods.problem, periods.message, periods.suggestion);
  const metric = filters.metric === "conversion_rate" || filters.metric === "cost_per_issued" || filters.metric === "contact_rate" ? filters.metric : null;
  if (!metric) throw new Error("Choose what to compare: contact rate, issued conversion or cost per issued policy.");
  const { data, error } = await rpcClient().rpc("tenant_campaign_comparison", { p_tenant_id: tenantId, p_campaign_a_id: campaignAId, p_campaign_b_id: campaignBId, p_from_a: fromA, p_to_a: toA, p_from_b: fromB, p_to_b: toB, p_metric: metric });
  if (error) throw new Error(comparisonErrorText(error.message) ?? `Could not compare campaigns: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The campaign comparison was invalid");
  return data as CampaignComparison;
}

export async function getVendorReturns(tenantId: string, campaignId?: unknown) {
  const parsedCampaign = optionalScorecardUuid(campaignId, "campaign");
  const { data, error } = await rpcClient().rpc("vendor_returns_report", { p_tenant_id: tenantId, p_campaign_id: parsedCampaign });
  if (error) throw new Error(`Could not load vendor returns: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The vendor return report was invalid");
  const report = data as VendorReturnsReport;
  return { ...report, claims: await describeClaims(tenantId, report.claims ?? []) };
}

type Loose = { from(table: string): { select(columns: string): LooseQuery } };
type LooseQuery = PromiseLike<{ data: unknown; error: { message: string } | null }> & { eq(column: string, value: unknown): LooseQuery; in(column: string, values: string[]): LooseQuery; order(column: string, options?: { ascending?: boolean }): LooseQuery; range(from: number, to: number): LooseQuery };

const ITEM_PAGE = 1000;
type PeriodItem = { claim_id: string; rejected_at?: string | null; lead: { created_at: string } | Array<{ created_at: string }> | null };

/**
 * Names and a period for each claim, which the report RPC returns only as ids. Additive and best
 * effort: a claim whose names cannot be read still shows, with its ids' place taken by "—", rather
 * than the whole list failing over a label. The period is when the claimed rows arrived — the
 * window a vendor's contract measures a return against: a lead's created_at, or, for a row the
 * scrub removed at import (no lead, 20260925703200), the rejected_at its evidence carries. The lead
 * join is a LEFT join so a removal item is not dropped, and the items are read page by page so a
 * claim of more than a thousand rows still gets its whole period.
 */
export async function describeClaims(tenantId: string, claims: VendorReturnClaim[]): Promise<VendorReturnClaim[]> {
  if (!claims.length) return claims;
  const db = getSupabaseServiceClient() as unknown as Loose;
  const campaignIds = [...new Set(claims.map((claim) => claim.campaign_id))];
  const vendorIds = [...new Set(claims.map((claim) => claim.vendor_id))];
  const claimIds = claims.map((claim) => claim.id);
  async function items(): Promise<PeriodItem[]> {
    const out: PeriodItem[] = [];
    for (let start = 0; ; start += ITEM_PAGE) {
      const page = await db.from("lead_claim_items").select("claim_id, rejected_at:evidence->>rejected_at, lead:agent_leads(created_at)").eq("tenant_id", tenantId).in("claim_id", claimIds).order("id", { ascending: true }).range(start, start + ITEM_PAGE - 1);
      if (page.error) return out;
      const rows = (page.data ?? []) as PeriodItem[];
      out.push(...rows);
      if (rows.length < ITEM_PAGE) return out;
    }
  }
  const [campaigns, vendors, itemRows] = await Promise.all([
    db.from("tenant_campaigns").select("id, name").eq("tenant_id", tenantId).in("id", campaignIds),
    db.from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId).in("id", vendorIds),
    items().catch(() => [] as PeriodItem[]),
  ]);
  const name = (result: { data: unknown; error: unknown }) => new Map(((result.error ? [] : result.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const campaignName = name(campaigns);
  const vendorName = name(vendors);
  const period = new Map<string, { from: string; to: string }>();
  for (const row of itemRows) {
    const lead = Array.isArray(row.lead) ? row.lead[0] : row.lead;
    const at = lead?.created_at ?? row.rejected_at ?? null;
    if (!at) continue;
    const current = period.get(row.claim_id);
    period.set(row.claim_id, current ? { from: at < current.from ? at : current.from, to: at > current.to ? at : current.to } : { from: at, to: at });
  }
  return claims.map((claim) => ({ ...claim, campaign_name: campaignName.get(claim.campaign_id) ?? null, vendor_name: vendorName.get(claim.vendor_id) ?? null, period_from: period.get(claim.id)?.from ?? null, period_to: period.get(claim.id)?.to ?? null }));
}

export async function createVendorReturnClaim(tenantId: string, campaignId: unknown, createdBy: string) {
  const parsedCampaign = optionalScorecardUuid(campaignId, "campaign");
  if (!parsedCampaign) throw new Error("Choose a campaign for the claim");
  const { data, error } = await rpcClient().rpc("create_vendor_return_claim", { p_tenant_id: tenantId, p_campaign_id: parsedCampaign, p_created_by: createdBy });
  if (error) throw new Error(`Could not create vendor return claim: ${error.message}`);
  if (typeof data !== "string") throw new Error("The vendor return claim did not return an id");
  return data;
}

export async function updateVendorReturnClaim(tenantId: string, claimId: unknown, input: { action: "submit" | "resolve"; status?: string; amountCreditedCents?: number; replacementLeadsCount?: number; rejectionReason?: string; notes?: string }) {
  const parsedClaim = optionalScorecardUuid(claimId, "claim");
  if (!parsedClaim) throw new Error("Invalid claim");
  const { data, error } = await rpcClient().rpc("update_vendor_return_claim", { p_tenant_id: tenantId, p_claim_id: parsedClaim, p_action: input.action, p_status: input.status ?? null, p_amount_credited_cents: input.amountCreditedCents ?? 0, p_replacement_leads_count: input.replacementLeadsCount ?? 0, p_rejection_reason: input.rejectionReason ?? null, p_notes: input.notes ?? null });
  if (error) throw new Error(`Could not update vendor return claim: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The updated claim was invalid");
  return data as VendorReturnClaim;
}

export async function getVendorReturnClaimDetail(tenantId: string, claimId: unknown) {
  const parsedClaim = optionalScorecardUuid(claimId, "claim");
  if (!parsedClaim) throw new Error("Invalid claim");
  const { data, error } = await rpcClient().rpc("vendor_return_claim_detail", { p_tenant_id: tenantId, p_claim_id: parsedClaim });
  if (error) throw new Error(`Could not load claim evidence: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data) || !(data as { claim?: unknown }).claim) throw new Error("The claim evidence was invalid");
  return data as VendorReturnClaimDetail;
}

/**
 * The evidence summary's context: the claim's campaign and vendor by name and its period (from
 * describeClaims, the page's own definition), and the unit price each row is claimed at — the
 * campaign's purchased rate, spend ÷ records purchased, which create_combined_vendor_return_claim
 * prices rows at. Best effort: a label that cannot be read is left blank rather than failing the export.
 */
export async function vendorReturnEvidenceContext(tenantId: string, claim: VendorReturnClaim): Promise<EvidenceContext> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const first = (result: { data: unknown; error: unknown }) => (result.error ? null : ((result.data as Array<Record<string, unknown>> | null) ?? [])[0] ?? null);
  const [described, campaign, vendor] = await Promise.all([
    describeClaims(tenantId, [claim]).then((rows) => rows[0] ?? claim, () => claim),
    Promise.resolve(db.from("tenant_campaigns").select("total_spend_cents, records_purchased").eq("tenant_id", tenantId).eq("id", claim.campaign_id)).then(first, () => null),
    Promise.resolve(db.from("tenant_lead_vendors").select("return_window_days").eq("tenant_id", tenantId).eq("id", claim.vendor_id)).then(first, () => null),
  ]);
  const spend = Number(campaign?.total_spend_cents ?? 0);
  const records = Number(campaign?.records_purchased ?? 0);
  const windowDays = vendor?.return_window_days == null ? null : Number(vendor.return_window_days);
  return {
    campaignName: described.campaign_name ?? null,
    vendorName: described.vendor_name ?? null,
    unitPriceCents: records > 0 ? spend / records : null,
    periodFrom: described.period_from ?? null,
    periodTo: described.period_to ?? null,
    returnWindowDays: windowDays ?? null,
  };
}

export { scorecardCsv, vendorReturnCsv };
