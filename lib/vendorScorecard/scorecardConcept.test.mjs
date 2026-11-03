// Run with: npm test
//
// The Scorecard concept (LA-2 §14, "which vendor should I buy from again"): spend split by records
// received, a vendor roll-up with one cost-per-policy definition, test batches out of the ranking,
// persistency, and the first writer of tenant_issued_policies (Mark issued / Mark lapsed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const { normalizeScorecard, rankByCostPerIssued } = await import("./normalize.ts");
const { scorecardCsv } = await import("./format.ts");
const { issuedPolicyErrorText } = await import("../issuedPolicies/types.ts");

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const migration = (name) => read("supabase", "migrations", name);

const report = read("supabase", "migrations", "20260925708200_vendor_scorecard_ranks_vendors_by_cost_per_policy.sql");
const comparison = migration("20260913430000_la_2_18_campaign_comparison.sql");

test("the scorecard splits spend exactly the way the campaign comparison does", () => {
  const formula = "greatest(c.total_spend_cents - c.credits_received_cents, 0)::numeric";
  assert.ok(report.includes(formula), "the scorecard no longer uses the allocation formula");
  assert.ok(comparison.includes("greatest(sp.total_spend_cents - sp.credits_received_cents, 0)::numeric"), "the comparison changed its formula; change both together");
  assert.match(report, /\* count\(l\.id\) \/ nullif\(c\.records_purchased, 0\)/);
  assert.match(comparison, /\* count\(r\.id\) \/ nullif\(sp\.records_purchased, 0\)/);
});

test("the report is re-created with the new signature and stays service-role only", () => {
  assert.match(report, /drop function if exists public\.tenant_vendor_scorecard_report\(uuid, date, date, uuid, uuid, text\);/);
  assert.match(report, /p_persist_days integer default null/);
  assert.match(report, /grant execute on function public\.tenant_vendor_scorecard_report\(uuid, date, date, uuid, uuid, text, integer\) to service_role/);
  assert.doesNotMatch(report, /to tenant_app/);
  assert.match(report, /'vendor_rows'/);
  assert.match(report, /share_of_contacts_percent/);
  assert.match(report, /current_date - 89/, "the default period is 90 days");
  // Persistency counts a policy that lapsed only on or after day N.
  assert.match(report, /p\.lapsed_at >= p\.issued_at \+ make_interval\(days => v_persist\)/);
  // Speed and consent are read from the views Campaigns reads, not recomputed.
  assert.match(report, /left join tenant_vendor_speed_to_lead s/);
  assert.match(report, /left join tenant_vendor_consent_coverage cc/);
});

test("consent coverage counts each lead once", () => {
  const fix = migration("20260925708100_consent_coverage_counts_each_lead_once.sql");
  assert.match(fix, /count\(distinct l\.id\)::integer as leads/);
  assert.match(fix, /count\(distinct l\.id\) filter \(where a\.capture_status = 'claimed'\)/);
  assert.match(fix, /security_invoker = on/);
});

test("Mark issued and Mark lapsed are service-role functions behind the deal-flow roles", () => {
  const writers = migration("20260925708300_mark_policy_issued_and_lapsed.sql");
  assert.match(writers, /revoke all on function public\.mark_deal_policy_issued\(uuid, uuid, text, text, date\) from public, anon, authenticated, tenant_app/);
  assert.match(writers, /ISSUED_POLICY_ALREADY_ISSUED/);
  assert.match(writers, /for update/);
  for (const route of [["app", "api", "app", "policies", "issued", "route.ts"], ["app", "api", "app", "policies", "issued", "[id]", "route.ts"]]) {
    const source = read(...route);
    assert.match(source, /requireFeatureRole\("daily_deal_flow", \["owner", "producer"\]/);
    assert.match(source, /status: 503/);
    assert.match(source, /tenant\.policy_marked_(issued|lapsed)/);
    assert.doesNotMatch(source, /policy_number: policy\.policy_number/, "the policy number went into the audit metadata");
  }
  const columns = migration("20260925708000_scorecard_test_batch_and_policy_lapse.sql");
  assert.match(columns, /add column if not exists is_test_batch boolean not null default false/);
  assert.match(columns, /check \(lapsed_at is null or lapsed_at >= issued_at\)/);
});

test("refusals from the writers become sentences", () => {
  assert.match(issuedPolicyErrorText("ERROR: ISSUED_POLICY_ALREADY_ISSUED") ?? "", /already has a policy in force/);
  assert.match(issuedPolicyErrorText('duplicate key value violates unique constraint "tenant_issued_policies_tenant_id_carrier_policy_number_key"') ?? "", /already has a policy with this number/);
  assert.equal(issuedPolicyErrorText("something else"), null);
});

const oldReport = {
  from: "2026-07-01", to: "2026-09-25", generated_at: "2026-09-25T00:00:00Z", live: true, snapshot: false,
  totals: { campaigns: 3, net_spend_cents: 485000, leads_received: 600, applications: 20, issued_policies: 12 },
  rows: [
    { campaign_id: "c1", vendor_id: "v1", vendor_name: "DirectMail", campaign_name: "A", total_spend_cents: 90000, records_purchased: 300, credits_received_cents: 0, net_spend_cents: 90000, leads_received: 300, issued_policies: 16, effective_cost_per_issued_policy_cents: 5625 },
    { campaign_id: "c2", vendor_id: "v2", vendor_name: "LeadCo", campaign_name: "B", total_spend_cents: 240000, records_purchased: 3000, credits_received_cents: 0, net_spend_cents: 240000, leads_received: 200, issued_policies: 11, effective_cost_per_issued_policy_cents: 21818 },
    { campaign_id: "c3", vendor_id: "v3", vendor_name: "Beacon", campaign_name: "C", total_spend_cents: 27500, records_purchased: 500, credits_received_cents: 0, net_spend_cents: 27500, leads_received: 100, issued_policies: 2, effective_cost_per_issued_policy_cents: 13750 },
  ],
  contact_rate_by_slot: [],
  attempts_to_contact: [{ attempt_number: 1, attempts: 100, contacts: 30 }, { attempt_number: 2, attempts: 70, contacts: 10 }],
};

test("an old report still renders: ranked, dialable, shares of contacts, flagged not upgraded", () => {
  const metrics = new Map([["c1", { undialable_leads: 9 }], ["c2", { undialable_leads: 810 }]]);
  const result = normalizeScorecard(oldReport, metrics, false, false);
  assert.equal(result.upgraded, false);
  assert.deepEqual(result.vendor_rows, []);
  assert.equal(result.persist_days, null);
  const [a, b, c] = result.rows;
  assert.equal(a.cost_rank, 1);
  assert.equal(c.cost_rank, 2);
  assert.equal(b.cost_rank, 3);
  assert.equal(c.small_sample, true, "two policies is a small sample");
  assert.equal(a.small_sample, false);
  assert.equal(a.dialable_leads, 291);
  assert.equal(b.dialable_leads, 0, "dialable never goes below zero");
  assert.equal(a.cost_per_record_cents, 300);
  assert.equal(a.lifetime_net_spend_cents, 90000);
  assert.deepEqual(result.attempts_to_contact.map((item) => item.share_of_contacts_percent), [75, 25]);
});

test("test batches are never ranked, and ties share a rank", () => {
  const rows = [
    { key: "a", is_test_batch: false, effective_cost_per_issued_policy_cents: 100 },
    { key: "b", is_test_batch: true, effective_cost_per_issued_policy_cents: 50 },
    { key: "c", is_test_batch: false, effective_cost_per_issued_policy_cents: 100 },
    { key: "d", is_test_batch: false, effective_cost_per_issued_policy_cents: null },
  ];
  const ranks = rankByCostPerIssued(rows);
  assert.equal(ranks.get(rows[0]), 1);
  assert.equal(ranks.get(rows[2]), 1);
  assert.equal(ranks.has(rows[1]), false);
  assert.equal(ranks.has(rows[3]), false);
});

test("a vendor row takes undialable and claims from the same campaigns its figures cover", () => {
  const upgraded = {
    ...oldReport,
    persist_days: 60,
    rows: [
      { ...oldReport.rows[0], is_test_batch: false, cost_rank: 1, small_sample: false },
      { ...oldReport.rows[0], campaign_id: "c4", campaign_name: "Trial", is_test_batch: true, cost_rank: null, small_sample: false },
    ],
    vendor_rows: [{ vendor_id: "v1", vendor_name: "DirectMail", is_test_batch: false, campaigns: 1, test_batch_campaigns: 1, leads_received: 300, issued_policies: 16, effective_cost_per_issued_policy_cents: 5625, cost_rank: 1, speed_median_seconds: 48, consent_claimed_pct: 100 }],
  };
  const metrics = new Map([["c1", { undialable_leads: 9, amount_claimed_cents: 100, amount_credited_cents: 50 }], ["c4", { undialable_leads: 400 }]]);
  const result = normalizeScorecard(upgraded, metrics, true, true);
  const vendor = result.vendor_rows[0];
  assert.equal(result.persist_days, 60);
  assert.equal(vendor.undialable_leads, 9, "the test batch's undialables leaked into the committed roll-up");
  assert.equal(vendor.dialable_leads, 291);
  assert.equal(vendor.claim_acceptance_rate_percent, 50);
  assert.equal(vendor.speed_median_seconds, 48);
  assert.equal(result.rows[1].is_test_batch, true);
});

test("the CSV carries the period spend and the lifetime spend side by side", () => {
  const [row] = normalizeScorecard({ ...oldReport, rows: [{ ...oldReport.rows[0], net_spend_cents: null }] }, new Map(), false, false).rows;
  const csv = scorecardCsv([row]);
  assert.match(csv.split("\r\n")[0], /"net_spend","lifetime_net_spend"/);
  assert.match(csv.split("\r\n")[1], /"","900"/, "an unsplittable spend must export empty, not 0");
});

test("True CPA shows the concept's pieces from real data", () => {
  const page = read("components", "app", "true-cpa-workspace.tsx");
  for (const piece of [/By vendor/, /By campaign/, /Cheapest policy first/, /Test batch/, /Small sample/, /Speed to lead/, /Consent certificates/, /Only policies still in force after \{PERSIST_DAYS\} days/, /% of contacts/]) {
    assert.match(page, piece);
  }
  // UI consistency standard (docs/design/UI-CONSISTENCY.md §3, 2026-09-28): the computed "reading of
  // the table" insight banners were removed; the table's own tint and chips carry the ranking.
  assert.doesNotMatch(page, /unitPriceInsight|sampleInsight|Unit price is not the decision/, "an insight banner is back on True CPA");
  assert.match(page, /<StatStrip/, "True CPA's figures are one StatStrip");
  assert.match(page, /<DataToolbar/, "True CPA's filters live in the table's DataToolbar");
  assert.doesNotMatch(page, /\b(DirectMail|Apex Data|LeadCo|Beacon Lists)\b/, "board sample names are on the page");
});
