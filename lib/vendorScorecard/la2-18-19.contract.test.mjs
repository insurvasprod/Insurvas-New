import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const comparisonMigration = await read("supabase/migrations/20260913430000_la_2_18_campaign_comparison.sql");
const returnsMigration = await read("supabase/migrations/20260913440000_la_2_19_vendor_returns_credit_ledger.sql");
const comparisonRoute = await read("app/api/app/true-cpa/compare/route.ts");
const returnsRoute = await read("app/api/app/vendor-returns/route.ts");
const claimsRoute = await read("app/api/app/vendor-returns/claims/route.ts");
const claimRoute = await read("app/api/app/vendor-returns/claims/[id]/route.ts");
const comparisonUi = await read("components/app/campaign-comparison-workspace.tsx");
const returnsUi = await read("components/app/vendor-returns-workspace.tsx");

test("LA-2.18 compares matched periods with a selectable metric and honest confidence", () => {
  assert.match(comparisonMigration, /tenant_campaign_comparison/);
  assert.match(comparisonMigration, /periods_must_match/);
  assert.match(comparisonMigration, /weekdays_must_align/);
  assert.match(comparisonMigration, /contact_rate/);
  assert.match(comparisonMigration, /conversion_rate/);
  assert.match(comparisonMigration, /cost_per_issued/);
  assert.match(comparisonMigration, /Too few comparable observations/);
  assert.match(comparisonMigration, /size_warning/);
  assert.match(comparisonMigration, /nullif\(sqrt/);
  assert.match(comparisonUi, /Side-by-side funnel volumes/);
  // The periods are checked by the database's own rule before Compare, and the matched period is
  // offered. (The explainer sentence that used to say "no automatic winner" went with the UI
  // consistency standard, docs/design/UI-CONSISTENCY.md §3; the behaviour is what is pinned.)
  assert.match(comparisonUi, /checkComparisonPeriods\(/);
  assert.match(comparisonUi, /Matched period for B/);
});

test("LA-2.19 captures evidence, records outcomes, and feeds campaign credits", () => {
  assert.match(returnsMigration, /create table if not exists public\.lead_claims/);
  assert.match(returnsMigration, /create table if not exists public\.lead_claim_items/);
  assert.match(returnsMigration, /vendor_claimable_leads/);
  assert.match(returnsMigration, /coalesce\(sr\.outcome, l\.screening_outcome\) in \('dnc', 'tcpa_litigator', 'invalid_phone'\)/);
  assert.match(returnsMigration, /wrong_number', 'disconnected/);
  assert.match(returnsMigration, /apply_lead_claim_credit_delta/);
  assert.match(returnsMigration, /credits_received_cents = credits_received_cents \+ v_delta/);
  assert.match(returnsMigration, /vendor_return_claim_detail/);
  assert.match(returnsMigration, /update_vendor_return_claim/);
  assert.match(returnsMigration, /replacement_leads_count/);
  assert.match(returnsMigration, /No claim is submitted automatically|prepared evidence package/);
  assert.match(returnsUi, /Create draft claim/);
  assert.match(returnsUi, /Evidence CSV/);
  assert.match(returnsUi, /Record outcome/);
});

test("LA-2.18/2.19 routes use the existing tenant feature and role boundary", () => {
  for (const source of [comparisonRoute, returnsRoute, claimsRoute, claimRoute]) assert.match(source, /requireFeatureRole\("true_cpa", \["owner", "producer", "bookkeeper"\]/);
  assert.match(claimRoute, /params: Promise/);
});
