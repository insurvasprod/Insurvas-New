import "server-only";

import { hasFeature, type Entitlement } from "@/lib/entitlements/types";
import { featureKillState } from "@/lib/features/killSwitch";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { getVendorScorecard } from "@/lib/vendorScorecard/service";
import type { CampaignProgress, ScrubRun } from "./constants";
import { latestScrubRuns } from "./scrubRun";

/**
 * What /app/campaigns shows beside each campaign's cost, from the Campaigns concept audit (LA-2 §5):
 * how far it has been worked, which cadence it runs, whether a re-scrub is under way, what an issued
 * policy cost, and whether it is a test batch.
 *
 * Every part is optional. A part whose migration is not applied comes back `null` and the screen
 * leaves that line out; a real fault in one part is reported in `faults` without taking the others
 * — or the campaign list — down with it.
 */

type QueryError = { message: string; code?: string } | null;
type Result<T> = { data: T | null; error: QueryError };
type Query = PromiseLike<Result<unknown>> & { select(columns: string): Query; eq(column: string, value: unknown): Query };
const db = () => getSupabaseServiceClient() as unknown as { from(table: string): Query };

export type CampaignOutcome = { applications: number; issued: number; costPerIssuedCents: number | null };

export type CampaignExtras = {
  /** tenant_campaign_progress (20260925706000). */
  progress: Record<string, CampaignProgress> | null;
  /** The latest scrub run per campaign (20260925706100). */
  scrubRuns: Record<string, ScrubRun> | null;
  /** tenant_campaigns.is_test_batch — Scorecard's column (20260925708000). */
  testBatches: Record<string, boolean> | null;
  /**
   * Issued policies and cost per issued policy, all time, from True CPA's own report — one
   * definition, never recomputed here. Null when True CPA is not on the plan (or switched off),
   * because that figure is True CPA's to show.
   */
  outcomes: Record<string, CampaignOutcome> | null;
  faults: string[];
};

async function progress(tenantId: string, faults: string[]) {
  const result = (await db()
    .from("tenant_campaign_progress")
    .select("campaign_id, leads_received, leads_dialed, leads_workable, leads_exhausted, first_import_at, last_import_at, own_cadence_rules")
    .eq("tenant_id", tenantId)) as Result<Array<CampaignProgress & { campaign_id: string }>>;
  if (result.error) {
    if (!isSchemaGap(result.error)) faults.push(`How far each campaign has been worked could not be loaded: ${result.error.message}`);
    return null;
  }
  return Object.fromEntries(
    (result.data ?? []).map((row) => [
      row.campaign_id,
      {
        leads_received: Number(row.leads_received ?? 0),
        leads_dialed: Number(row.leads_dialed ?? 0),
        leads_workable: Number(row.leads_workable ?? 0),
        leads_exhausted: Number(row.leads_exhausted ?? 0),
        first_import_at: row.first_import_at ?? null,
        last_import_at: row.last_import_at ?? null,
        own_cadence_rules: Number(row.own_cadence_rules ?? 0),
      },
    ]),
  );
}

async function testBatches(tenantId: string, faults: string[]) {
  const result = (await db().from("tenant_campaigns").select("id, is_test_batch").eq("tenant_id", tenantId)) as Result<Array<{ id: string; is_test_batch: boolean | null }>>;
  if (result.error) {
    if (!isSchemaGap(result.error)) faults.push(`Test-batch flags could not be loaded: ${result.error.message}`);
    return null;
  }
  return Object.fromEntries((result.data ?? []).map((row) => [row.id, Boolean(row.is_test_batch)]));
}

async function outcomes(tenantId: string, entitlement: Entitlement, faults: string[]) {
  if (!hasFeature(entitlement, "true_cpa")) return null;
  const kill = await featureKillState("true_cpa", tenantId).catch(() => ({ killed: true }));
  if (kill.killed) return null;
  try {
    const report = await getVendorScorecard(tenantId, {}, entitlement.access === "read_only");
    return Object.fromEntries(
      report.rows.map((row) => [
        row.campaign_id,
        {
          applications: Number(row.applications ?? 0),
          issued: Number(row.issued_policies ?? 0),
          costPerIssuedCents: row.effective_cost_per_issued_policy_cents == null ? null : Number(row.effective_cost_per_issued_policy_cents),
        },
      ]),
    );
  } catch (error) {
    faults.push(`Cost per issued policy could not be loaded: ${error instanceof Error ? error.message : "the scorecard failed"}`);
    return null;
  }
}

export async function campaignExtras(tenantId: string, entitlement: Entitlement): Promise<CampaignExtras> {
  const faults: string[] = [];
  const [progressMap, runs, tests, outcomeMap] = await Promise.all([
    progress(tenantId, faults),
    latestScrubRuns(tenantId).catch((error: unknown) => {
      faults.push(error instanceof Error ? error.message : "Scrub runs could not be loaded");
      return null;
    }),
    testBatches(tenantId, faults),
    outcomes(tenantId, entitlement, faults),
  ]);
  return {
    progress: progressMap,
    scrubRuns: runs ? Object.fromEntries(runs) : null,
    testBatches: tests,
    outcomes: outcomeMap,
    faults,
  };
}
