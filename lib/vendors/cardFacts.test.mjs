/**
 * The Vendors roster's facts (LA-2 §5 concept board, user decisions 2026-09-25).
 *
 * The thresholds are the user's: a drop-recommendation line when cost per policy is at least 2× the
 * best RANKED vendor, or undialable share is at least 25%, or claimed-certificate coverage is under
 * 50%. Facts only. A trialling vendor is never ranked and never flagged. Claimable dollars are
 * Returns' per-campaign figures summed by vendor, with the soonest-closing days left.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { buildVendorCards, claimableByVendor, oneMoreSaleMoves, parseCostRows } from "./cardFacts.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

const vendors = [
  { id: "a", name: "Apex Data", status: "active" },
  { id: "d", name: "DirectMail Co", status: "active" },
  { id: "l", name: "LeadCo", status: "under_review" },
  { id: "b", name: "Beacon Lists", status: "active" },
  { id: "x", name: "Old Vendor", status: "inactive" },
];
const card = (vendor_id, campaign_count, lead_count, extra = {}) => ({
  vendor_id, status: "active", category: null, renews_on: null, campaign_count, lead_count, trial_lead_threshold: 200,
  trialling: campaign_count >= 1 && (campaign_count === 1 || lead_count < 200), ...extra,
});
const cost = (vendor_id, cpp, rank, extra = {}) => ({ vendor_id, vendor_name: vendor_id, net_spend_cents: cpp === null ? 0 : cpp * 4, issued_policies: cpp === null ? 0 : 4, cost_per_policy_cents: cpp, cost_rank: rank, is_test_batch: false, ...extra });

const base = {
  vendors,
  cards: [card("a", 3, 900), card("d", 2, 300), card("l", 2, 400, { renews_on: "2026-10-14" }), card("b", 1, 500), card("x", 4, 2000)],
  costs: [cost("a", 6250, 2), cost("d", 5625, 1), cost("l", 21818, 3), cost("b", 1000, null, { net_spend_cents: 30000, issued_policies: 2 }), cost("x", 900, 4)],
  claimable: [],
  undialable: [],
  consent: [],
};

test("the best vendor is the cheapest RANKED one — trialling and inactive vendors are left out", () => {
  const { best } = buildVendorCards(base);
  // Beacon ($10) is on trial and Old Vendor ($9) is inactive; neither can be "the best".
  assert.deepEqual(best, { vendor_id: "d", vendor_name: "DirectMail Co", cost_per_policy_cents: 5625 });
});

test("cost per policy at 2× the best ranked vendor states the numbers and the renewal date", () => {
  const { cards } = buildVendorCards(base);
  const leadco = cards.find((row) => row.vendor_id === "l");
  assert.equal(leadco.drop.reasons.length, 1);
  assert.equal(leadco.drop.reasons[0].key, "cost");
  assert.match(leadco.drop.reasons[0].text, /\$218\.18 per issued policy, 3\.9× DirectMail Co's \$56\.25/);
  assert.equal(leadco.drop.renews_on, "2026-10-14");
  // Apex at 1.1× is not flagged.
  assert.equal(cards.find((row) => row.vendor_id === "a").drop, null);
});

test("undialable at 25% and certificates under 50% flag on their own, with the figures", () => {
  const { cards } = buildVendorCards({
    ...base,
    undialable: [{ vendor_id: "a", undialable_percent: 25 }, { vendor_id: "d", undialable_percent: 24.9 }],
    consent: [{ vendor_id: "a", leads: 900, claimed_coverage_pct: 49.9 }, { vendor_id: "d", leads: 300, claimed_coverage_pct: 50 }],
  });
  const apex = cards.find((row) => row.vendor_id === "a");
  assert.deepEqual(apex.drop.reasons.map((reason) => reason.key), ["undialable", "certificates"]);
  assert.match(apex.drop.reasons[0].text, /25% of the records bought could never be dialed/);
  assert.match(apex.drop.reasons[1].text, /only 49\.9% of its leads/);
  assert.equal(cards.find((row) => row.vendor_id === "d").drop, null, "24.9% and exactly 50% are under the lines");
});

test("a trialling vendor is never flagged or ranked, whatever its figures", () => {
  const { cards } = buildVendorCards({ ...base, undialable: [{ vendor_id: "b", undialable_percent: 90 }], consent: [{ vendor_id: "b", leads: 500, claimed_coverage_pct: 1 }] });
  const beacon = cards.find((row) => row.vendor_id === "b");
  assert.equal(beacon.trialling, true);
  assert.equal(beacon.ranked, false);
  assert.equal(beacon.drop, null);
  // $300 over 2 policies: one more sale moves $150 → $100.
  assert.equal(beacon.one_more_sale_moves_cents, 5000);
});

test("an inactive vendor has already been dropped and gets no drop line", () => {
  const { cards } = buildVendorCards({ ...base, undialable: [{ vendor_id: "x", undialable_percent: 80 }] });
  assert.equal(cards.find((row) => row.vendor_id === "x").drop, null);
});

test("until tenant_vendor_card is applied, trialling is unknown and nobody is ranked or cost-flagged", () => {
  const { cards, best } = buildVendorCards({ ...base, cards: null });
  assert.equal(best, null);
  assert.ok(cards.every((row) => row.trialling === null && row.ranked === false && row.drop === null));
});

test("without Scorecard's vendor_rows there is no cost per policy — never a figure summed here", () => {
  const { cards, best } = buildVendorCards({ ...base, costs: null });
  assert.equal(best, null);
  assert.ok(cards.every((row) => row.cost_per_policy_cents === null && row.issued_policies === null));
  assert.deepEqual(parseCostRows(undefined), []);
});

test("claimable dollars sum per vendor, and days left is the soonest-closing campaign with rows", () => {
  const rows = claimableByVendor([
    { vendor_id: "a", campaign_id: "1", claimable_rows: 40, claimable_cents: 14400, days_left: 9 },
    { vendor_id: "a", campaign_id: "2", claimable_rows: 24, claimable_cents: 8700, days_left: 3 },
    { vendor_id: "a", campaign_id: "3", claimable_rows: 0, claimable_cents: 0, days_left: 1 },
    { vendor_id: "d", campaign_id: "4", claimable_rows: 0, claimable_cents: 0, days_left: null },
  ]);
  assert.deepEqual(rows, [{ vendor_id: "a", claimable_cents: 23100, claimable_rows: 64, days_left: 3 }]);
  const { cards } = buildVendorCards({ ...base, claimable: rows });
  assert.deepEqual(cards.find((row) => row.vendor_id === "a").claimable, { cents: 23100, rows: 64, days_left: 3 });
  assert.equal(cards.find((row) => row.vendor_id === "d").claimable, null);
});

test("one more sale: net/n − net/(n+1), and the whole spend when there is no policy yet", () => {
  assert.equal(oneMoreSaleMoves(30000, 2), 5000);
  assert.equal(oneMoreSaleMoves(30000, 0), 30000);
  assert.equal(oneMoreSaleMoves(null, 2), null);
  assert.equal(oneMoreSaleMoves(0, 0), null);
});

test("the roster reads each figure from its one owner", () => {
  const service = read("lib", "vendors", "service.ts");
  assert.match(service, /getVendorCostPerPolicy\(/, "cost per policy comes from Scorecard");
  assert.match(service, /result\?\.available/, "nothing is shown until Scorecard says the figure exists");
  assert.match(service, /rpc\("vendor_returns_candidates_summary"/, "claimable dollars come from Returns");
  assert.match(service, /rpc\("vendor_undialable_rates"/, "undialable share comes from Returns");
  assert.match(service, /rpc\("tenant_vendor_card"/);
  assert.match(service, /hasFeature|trueCpa/);
  // Not a blended score, anywhere.
  for (const file of ["lib/vendors/cardFacts.ts", "lib/vendors/service.ts", "components/app/vendor-roster.tsx"])
    assert.doesNotMatch(read(file), /dispute[ _]rate/i, `${file} must not call the undialable share a dispute rate`);
});

test("trialling is derived from the comparison's 200-lead rule, never stored", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const card = readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith("20260925707100"))), "utf8");
  assert.match(card, /lead_count, 0\) < 200/);
  const status = readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith("20260925707000"))), "utf8");
  assert.match(status, /check \(status in \('active', 'under_review', 'inactive'\)\)/);
  assert.doesNotMatch(status.replace(/--[^\n]*/g, ""), /'trialling'/);
});

test("the drop line never pauses anything", () => {
  const roster = read("components", "app", "vendor-roster.tsx");
  assert.match(roster, /nothing is paused automatically/);
  const service = read("lib", "vendors", "service.ts");
  assert.doesNotMatch(service, /\.update\(|\.insert\(|status: "inactive"/);
});
