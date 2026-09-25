import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createVendorReturnClaim, describeClaims, optionalScorecardUuid } from "./service";
import { CLAIM_REASONS, isClaimReason } from "./returnModel";
import type { CampaignCandidateSummary, CampaignCostPerPolicy, CandidateReasonRow, ClaimReason, ReturnCandidateRow, VendorReturnsPageData, VendorUndialableRate } from "./returnModel";
import type { VendorReturnCandidate, VendorReturnClaim, VendorReturnsReport } from "./types";

/**
 * Vendor returns (/app/vendor-returns): the page's reads and the combined claim. Every read runs
 * before its migration is applied and falls back to today's behaviour:
 *
 *   vendor_returns_candidates_summary (20260925707500)  -> the lead-only list from
 *     vendor_returns_report, priced here at the same purchased rate.
 *   vendor_undialable_rates (20260925707800)            -> no undialable card.
 *   create_combined_vendor_return_claim (707500)        -> create_vendor_return_claim when every
 *     reason is on (today's one-click draft); a toggled preview answers 503.
 */

export const PENDING_SCHEMA_MESSAGE = "This setting needs a database update that has not been applied yet.";

export class ReturnsRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type DbError = { message: string; code?: string } | null;
type Result = { data: unknown; error: DbError };
type Query = PromiseLike<Result> & {
  eq(column: string, value: unknown): Query;
  in(column: string, values: string[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
  limit(count: number): Query;
};
type Db = { rpc(name: string, args: Record<string, unknown>): Query; from(table: string): { select(columns: string): Query } };
const db = () => getSupabaseServiceClient() as unknown as Db;

function isMissingSchema(error: DbError) {
  if (!error) return false;
  return ["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")
    || /does not exist|could not find the function|schema cache/i.test(error.message);
}

const num = (value: unknown) => (value == null || value === "" ? 0 : Number(value));
const nullableNum = (value: unknown) => (value == null || value === "" ? null : Number(value));
const text = (value: unknown) => (value == null ? "" : String(value));

const PAGE = 1000;
async function allClaims(tenantId: string): Promise<VendorReturnClaim[]> {
  const out: VendorReturnClaim[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await db().from("lead_claims").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).range(start, start + PAGE - 1);
    if (error) throw new Error(`Could not load vendor return claims: ${error.message}`);
    const rows = (data ?? []) as VendorReturnClaim[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function normalizeReasons(value: unknown): CandidateReasonRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .filter((row) => isClaimReason(row.reason))
    .map((row) => ({
      reason: row.reason as ClaimReason,
      source: row.source === "import" ? "import" : "lead",
      claimable_rows: num(row.claimable_rows),
      claimable_cents: num(row.claimable_cents),
      expired_rows: num(row.expired_rows),
      expired_cents: num(row.expired_cents),
      soonest_closes_at: (row.soonest_closes_at as string | null) ?? null,
    }));
}

function normalizeSummary(value: unknown): CampaignCandidateSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map((row: Record<string, unknown>) => ({
    campaign_id: text(row.campaign_id),
    campaign_name: text(row.campaign_name),
    vendor_id: text(row.vendor_id),
    vendor_name: text(row.vendor_name),
    return_window_days: num(row.return_window_days),
    first_import_at: (row.first_import_at as string | null) ?? null,
    unit_cost_cents: nullableNum(row.unit_cost_cents),
    claimable_rows: num(row.claimable_rows),
    claimable_cents: num(row.claimable_cents),
    expired_rows: num(row.expired_rows),
    expired_cents: num(row.expired_cents),
    soonest_closes_at: (row.soonest_closes_at as string | null) ?? null,
    days_left: nullableNum(row.days_left),
    reasons: normalizeReasons(row.reasons),
  }));
}

/**
 * Before 20260925707500: today's lead-only candidates, grouped and priced exactly as the summary
 * would (rows x spend / records purchased, rounded once). No import removals and no first-import
 * date — those are the migration's to add.
 */
async function fallbackSummary(tenantId: string): Promise<CampaignCandidateSummary[]> {
  const { data, error } = await db().rpc("vendor_returns_report", { p_tenant_id: tenantId, p_campaign_id: null });
  if (error) throw new Error(`Could not load vendor returns: ${error.message}`);
  const claimable = ((data as VendorReturnsReport | null)?.claimable ?? []) as VendorReturnCandidate[];
  if (!claimable.length) return [];
  const campaignIds = [...new Set(claimable.map((row) => row.campaign_id))];
  const vendorIds = [...new Set(claimable.map((row) => row.vendor_id))];
  const [campaigns, vendors] = await Promise.all([
    db().from("tenant_campaigns").select("id, total_spend_cents, records_purchased").eq("tenant_id", tenantId).in("id", campaignIds),
    db().from("tenant_lead_vendors").select("id, return_window_days").eq("tenant_id", tenantId).in("id", vendorIds),
  ]);
  const rate = new Map(((campaigns.error ? [] : campaigns.data ?? []) as Array<Record<string, unknown>>).map((row) => [text(row.id), num(row.records_purchased) > 0 ? num(row.total_spend_cents) / num(row.records_purchased) : null]));
  const windowDays = new Map(((vendors.error ? [] : vendors.data ?? []) as Array<Record<string, unknown>>).map((row) => [text(row.id), num(row.return_window_days)]));
  const byCampaign = new Map<string, VendorReturnCandidate[]>();
  for (const row of claimable) byCampaign.set(row.campaign_id, [...(byCampaign.get(row.campaign_id) ?? []), row]);
  const out: CampaignCandidateSummary[] = [];
  for (const [campaignId, rows] of byCampaign) {
    const unit = rate.get(campaignId) ?? null;
    const days = windowDays.get(rows[0].vendor_id) ?? 0;
    const price = (count: number) => (unit == null ? 0 : Math.round(count * unit));
    const reasons: CandidateReasonRow[] = [];
    for (const reason of CLAIM_REASONS) {
      const mine = rows.filter((row) => row.reason === reason);
      if (!mine.length) continue;
      const open = mine.filter((row) => row.claimable);
      const expired = days > 0 ? mine.length - open.length : 0;
      reasons.push({ reason, source: "lead", claimable_rows: open.length, claimable_cents: price(open.length), expired_rows: expired, expired_cents: price(expired), soonest_closes_at: open.map((row) => row.claimable_until).sort()[0] ?? null });
    }
    const open = rows.filter((row) => row.claimable);
    const expired = days > 0 ? rows.length - open.length : 0;
    if (!open.length && !expired) continue;
    out.push({
      campaign_id: campaignId,
      campaign_name: rows[0].campaign_name,
      vendor_id: rows[0].vendor_id,
      vendor_name: rows[0].vendor_name,
      return_window_days: days,
      first_import_at: null,
      unit_cost_cents: unit,
      claimable_rows: open.length,
      claimable_cents: price(open.length),
      expired_rows: expired,
      expired_cents: price(expired),
      soonest_closes_at: open.map((row) => row.claimable_until).sort()[0] ?? null,
      days_left: open.length ? Math.min(...open.map((row) => row.days_remaining)) : null,
      reasons,
    });
  }
  return out.sort((a, b) => (a.soonest_closes_at ?? "9999").localeCompare(b.soonest_closes_at ?? "9999"));
}

function normalizeUndialable(value: unknown): VendorUndialableRate[] {
  if (!Array.isArray(value)) return [];
  return value.map((row: Record<string, unknown>) => ({
    vendor_id: text(row.vendor_id),
    vendor_name: text(row.vendor_name),
    records_purchased: num(row.records_purchased),
    removed_at_import: num(row.removed_at_import),
    undialable_leads: num(row.undialable_leads),
    undialable_rows: num(row.undialable_rows),
    undialable_percent: nullableNum(row.undialable_percent),
    undialable_cents: num(row.undialable_cents),
  }));
}

/** Claimable dollars and days left per campaign — the ONE definition (Vendors reads it by vendor). */
export async function getReturnCandidatesSummary(tenantId: string, vendorId?: string | null): Promise<{ rows: CampaignCandidateSummary[]; fallback: boolean }> {
  const { data, error } = await db().rpc("vendor_returns_candidates_summary", { p_tenant_id: tenantId, p_vendor_id: vendorId ?? null, p_campaign_id: null });
  if (!error) return { rows: normalizeSummary(data), fallback: false };
  if (!isMissingSchema(error)) throw new Error(`Could not load what is claimable: ${error.message}`);
  const rows = await fallbackSummary(tenantId);
  return { rows: vendorId ? rows.filter((row) => row.vendor_id === vendorId) : rows, fallback: true };
}

/** The undialable share per vendor, or null before 20260925707800. Never the claim acceptance rate. */
export async function getVendorUndialableRates(tenantId: string, vendorId?: string | null): Promise<VendorUndialableRate[] | null> {
  const { data, error } = await db().rpc("vendor_undialable_rates", { p_tenant_id: tenantId, p_vendor_id: vendorId ?? null });
  if (!error) return normalizeUndialable(data);
  if (!isMissingSchema(error)) console.error(`[vendor-returns] undialable rates: ${error.message}`);
  return null;
}

export async function getVendorReturnsPage(tenantId: string): Promise<VendorReturnsPageData> {
  const [summary, undialable, claims] = await Promise.all([
    getReturnCandidatesSummary(tenantId),
    getVendorUndialableRates(tenantId),
    allClaims(tenantId),
  ]);
  return { claims: await describeClaims(tenantId, claims), summary: summary.rows, summaryFallback: summary.fallback, undialable };
}

export const CANDIDATE_ROW_LIMIT = 500;

/** The rows behind one campaign's summary line, soonest window first, at most CANDIDATE_ROW_LIMIT. */
export async function getCampaignCandidateRows(tenantId: string, campaignId: unknown): Promise<ReturnCandidateRow[]> {
  const parsed = optionalScorecardUuid(campaignId, "campaign");
  if (!parsed) throw new ReturnsRequestError("Choose a campaign", 400);
  const { data, error } = await db().rpc("vendor_return_candidates", { p_tenant_id: tenantId, p_campaign_id: parsed }).limit(CANDIDATE_ROW_LIMIT);
  if (!error) {
    return ((data ?? []) as Array<Record<string, unknown>>).filter((row) => isClaimReason(row.reason)).map((row) => ({
      source: row.source === "import" ? "import" : "lead",
      lead_id: (row.lead_id as string | null) ?? null,
      scrub_rejection_id: (row.scrub_rejection_id as string | null) ?? null,
      reason: row.reason as ClaimReason,
      evidence: (row.evidence as Record<string, unknown> | null) ?? {},
      claimable_until: text(row.claimable_until),
      days_remaining: num(row.days_remaining),
      claimable: row.claimable === true,
    }));
  }
  if (!isMissingSchema(error)) throw new Error(`Could not load the claimable rows: ${error.message}`);
  const report = await db().rpc("vendor_returns_report", { p_tenant_id: tenantId, p_campaign_id: parsed });
  if (report.error) throw new Error(`Could not load the claimable rows: ${report.error.message}`);
  return (((report.data as VendorReturnsReport | null)?.claimable ?? []) as VendorReturnCandidate[]).slice(0, CANDIDATE_ROW_LIMIT).map((row) => ({
    source: "lead",
    lead_id: row.lead_id,
    scrub_rejection_id: null,
    reason: row.reason,
    evidence: row.evidence ?? {},
    claimable_until: row.claimable_until,
    days_remaining: row.days_remaining,
    claimable: row.claimable,
  }));
}

export type CombinedClaimResult = { claimId: string; rows: number | null; amountClaimedCents: number | null; leadRows: number | null; removalRows: number | null };

/**
 * One draft claim for the campaign from every claimable row of the chosen reasons (null = all), at
 * the purchased rate. create_combined_vendor_return_claim writes the audit row itself, in the same
 * transaction (tenant.vendor_claim_drafted).
 */
export async function createCombinedVendorReturnClaim(tenantId: string, campaignId: unknown, userId: string, reasons: ClaimReason[] | null): Promise<CombinedClaimResult> {
  const parsed = optionalScorecardUuid(campaignId, "campaign");
  if (!parsed) throw new ReturnsRequestError("Choose a campaign for the claim", 400);
  const { data, error } = await db().rpc("create_combined_vendor_return_claim", { p_tenant_id: tenantId, p_campaign_id: parsed, p_created_by: userId, p_reasons: reasons });
  if (error) {
    const message = error.message ?? "";
    if (isMissingSchema(error)) {
      // Before 20260925707500: every reason on is exactly today's one-click draft.
      if (reasons == null) {
        const claimId = await createVendorReturnClaim(tenantId, parsed, userId);
        return { claimId, rows: null, amountClaimedCents: null, leadRows: null, removalRows: null };
      }
      throw new ReturnsRequestError(PENDING_SCHEMA_MESSAGE, 503);
    }
    if (/LEAD_CLAIM_CAMPAIGN_NOT_FOUND/.test(message)) throw new ReturnsRequestError("That campaign does not exist.", 404);
    if (/LEAD_CLAIM_NO_CLAIMABLE_LEADS/.test(message)) throw new ReturnsRequestError("Nothing of those reasons can be claimed now: every row is already on a claim or past the vendor's return window.", 409);
    if (/LEAD_CLAIM_CAMPAIGN_HAS_NO_UNIT_COST/.test(message)) throw new ReturnsRequestError("This campaign has no cost per record, so a claim would have no amount. Enter its spend and records purchased on Vendors & campaigns.", 400);
    if (/LEAD_CLAIM_NO_REASON_CHOSEN/.test(message)) throw new ReturnsRequestError("Turn on at least one reason to claim.", 400);
    if (/LEAD_CLAIM_REASON_INVALID/.test(message)) throw new ReturnsRequestError("Unknown claim reason.", 400);
    if (/lead_claim_items_scrub_rejection_key|duplicate key/i.test(message)) throw new ReturnsRequestError("Some of these rows were claimed a moment ago. Refresh the page to see them.", 409);
    throw new Error(message || "Could not draft the claim");
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return { claimId: text(row.claim_id), rows: num(row.rows), amountClaimedCents: num(row.amount_claimed_cents), leadRows: num(row.lead_rows), removalRows: num(row.removal_rows) };
}

/**
 * The campaign's cost per issued policy over its whole life, from the scorecard report — the one
 * definition of that number. Null when the report cannot answer (the line is then not drawn).
 */
export async function getCampaignCostPerPolicy(tenantId: string, campaignId: unknown): Promise<CampaignCostPerPolicy | null> {
  const parsed = optionalScorecardUuid(campaignId, "campaign");
  if (!parsed) throw new ReturnsRequestError("Choose a campaign", 400);
  const { data, error } = await db().rpc("tenant_vendor_scorecard_report", {
    p_tenant_id: tenantId,
    p_from_date: "2000-01-01",
    p_to_date: new Date().toISOString().slice(0, 10),
    p_vendor_id: null,
    p_campaign_id: parsed,
    p_product_code: null,
  });
  if (error) {
    console.error(`[vendor-returns] cost per policy for ${parsed}: ${error.message}`);
    return null;
  }
  const rows = (data as { rows?: Array<Record<string, unknown>> } | null)?.rows ?? [];
  const row = rows.find((candidate) => candidate.campaign_id === parsed);
  if (!row) return null;
  return { issued_policies: num(row.issued_policies), cost_per_issued_cents: nullableNum(row.effective_cost_per_issued_policy_cents) };
}

export function parseClaimReasons(value: unknown): ClaimReason[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || !value.every(isClaimReason)) throw new ReturnsRequestError("Unknown claim reason.", 400);
  if (!value.length) throw new ReturnsRequestError("Turn on at least one reason to claim.", 400);
  return [...new Set(value)] as ClaimReason[];
}
