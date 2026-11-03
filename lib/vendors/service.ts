import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { getVendorCostPerPolicy } from "@/lib/vendorScorecard/service";
import {
  buildVendorCards,
  claimableByVendor,
  parseCardRows,
  parseConsentRows,
  parseCostRows,
  parseUndialableRows,
  type CardRow,
  type ClaimableRow,
  type ConsentRow,
  type CostRow,
  type UndialableRow,
} from "./cardFacts";
import type { VendorCardsResponse } from "./types";

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result> & { select(columns: string): Query; eq(column: string, value: unknown): Query; order(column: string): Query };
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): PromiseLike<Result> };

/** "This function is not deployed yet" — the RPC counterpart of isSchemaGap. */
function isMissingFunction(error: { message: string; code?: string } | null) {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return /could not find the function|function .* does not exist/i.test(error.message);
}

/** The roster reads a vendor's cost over its whole relationship with the agency, not a period. */
const ALL_TIME_FROM = "2000-01-01";

/**
 * Every fact the Vendors roster shows beyond the base vendor rows, each from its one definition,
 * each degrading on its own. A source that is not deployed yet leaves its figures null and says so
 * once in `pending`; it never takes the other figures down with it.
 *
 * `trueCpa`: cost per policy, claimable returns and undialable share are True CPA's figures and
 * are read only when the tenant has that feature — the same boundary /app/true-cpa and
 * /app/vendor-returns enforce.
 */
export async function getVendorCards(tenantId: string, trueCpa: boolean): Promise<VendorCardsResponse> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const pending: VendorCardsResponse["pending"] = [];

  const [vendorResult, cardResult, consentResult] = await Promise.all([
    db.from("tenant_lead_vendors").select("id, name, status").eq("tenant_id", tenantId).order("name"),
    db.rpc("tenant_vendor_card", { p_tenant_id: tenantId }),
    db.from("tenant_vendor_consent_coverage").select("vendor_id, leads, claimed_coverage_pct").eq("tenant_id", tenantId),
  ]);
  if (vendorResult.error) throw new Error(`Could not load vendors: ${vendorResult.error.message}`);
  const vendors = ((vendorResult.data as Array<{ id: string; name: string; status: string }> | null) ?? []);

  let cards: CardRow[] | null = null;
  if (!cardResult.error) cards = parseCardRows(cardResult.data);
  else if (isMissingFunction(cardResult.error) || isSchemaGap(cardResult.error))
    pending.push({ missing: ["trialling", "renews_on", "category"], detail: "Whether a vendor is still trialling, and its renewal date, need a database update that has not been applied yet." });
  else throw new Error(`Could not load vendor cards: ${cardResult.error.message}`);

  let consent: ConsentRow[] | null = null;
  if (!consentResult.error) consent = parseConsentRows(consentResult.data);
  else if (isSchemaGap(consentResult.error)) consent = null;
  else throw new Error(`Could not load consent coverage: ${consentResult.error.message}`);

  let costs: CostRow[] | null = null;
  let claimable: ClaimableRow[] | null = null;
  let undialable: UndialableRow[] | null = null;

  if (trueCpa) {
    const today = new Date().toISOString().slice(0, 10);
    const [scorecard, summary, rates] = await Promise.all([
      getVendorCostPerPolicy(tenantId, { from: ALL_TIME_FROM, to: today }).then((result) => ({ result, error: null as string | null }), (cause: unknown) => ({ result: null, error: cause instanceof Error ? cause.message : "Could not load the scorecard" })),
      db.rpc("vendor_returns_candidates_summary", { p_tenant_id: tenantId }),
      db.rpc("vendor_undialable_rates", { p_tenant_id: tenantId }),
    ]);

    // Scorecard's getVendorCostPerPolicy (vendor_rows) is THE per-vendor cost per policy. Until
    // 20260925708200 is applied it says `available: false`, and a per-vendor figure summed here
    // would be a second definition — so the column stays "—". cost_rank null (a test batch, or no
    // policy) is unranked, which buildVendorCards already requires.
    if (scorecard.result?.available) costs = parseCostRows(scorecard.result.rows);
    else if (scorecard.error) pending.push({ missing: ["cost_per_policy"], detail: `Cost per issued policy could not be read: ${scorecard.error}` });
    else pending.push({ missing: ["cost_per_policy"], detail: "Cost per issued policy per vendor needs a scorecard update that has not been applied yet." });

    if (!summary.error) claimable = claimableByVendor(summary.data);
    else if (isMissingFunction(summary.error)) pending.push({ missing: ["claimable"], detail: "Claimable returns per vendor need a database update that has not been applied yet." });
    else pending.push({ missing: ["claimable"], detail: `Claimable returns could not be read: ${summary.error.message}` });

    if (!rates.error) undialable = parseUndialableRows(rates.data);
    else if (isMissingFunction(rates.error)) pending.push({ missing: ["undialable_percent"], detail: "The undialable share per vendor needs a database update that has not been applied yet." });
    else pending.push({ missing: ["undialable_percent"], detail: `The undialable share could not be read: ${rates.error.message}` });
  }

  const built = buildVendorCards({ vendors, cards, costs, claimable, undialable, consent });
  return { ...built, true_cpa: trueCpa, pending };
}
