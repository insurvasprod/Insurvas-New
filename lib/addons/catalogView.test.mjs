import test from "node:test";
import assert from "node:assert/strict";

const { attachableTo, computeCatalogStats, formatShare, latestPlanIds, mergePlanAvailability, monthlyEquivalent } = await import("./catalogView.ts");

const plans = [
  { id: "growth-1", code: "growth", name: "Growth", version: 1, is_archived: false },
  { id: "growth-2", code: "growth", name: "Growth", version: 2, is_archived: false },
  { id: "scale-1", code: "scale", name: "Scale", version: 1, is_archived: false },
  { id: "legacy-1", code: "legacy", name: "Legacy", version: 1, is_archived: true },
  { id: "legacy-2", code: "legacy", name: "Legacy", version: 2, is_archived: true },
];

test("the latest version of each plan code is what the editor lists", () => {
  assert.deepEqual([...latestPlanIds(plans)].sort(), ["growth-2", "legacy-2", "scale-1"]);
});

test("a save keeps availability on older plan versions the editor never showed", () => {
  // Offered on Growth v1 and v2 and Legacy v1; the admin unticks Growth and ticks Scale.
  const merged = mergePlanAvailability(["scale-1"], ["growth-1", "growth-2", "legacy-1"], plans);
  assert.deepEqual(merged.sort(), ["growth-1", "legacy-1", "scale-1"]);
});

test("a save still follows the admin's ticks for latest versions, and drops unknown ids", () => {
  assert.deepEqual(mergePlanAvailability([], ["growth-2", "gone"], plans), []);
  assert.deepEqual(mergePlanAvailability(["growth-2", "growth-2"], [], plans), ["growth-2"]);
});

test("Attachable to lists each plan code once and flags an older-version-only offer", () => {
  assert.deepEqual(attachableTo(["growth-1", "growth-2", "legacy-1"], plans), [
    { code: "growth", label: "Growth", olderOnly: false },
    { code: "legacy", label: "Legacy", olderOnly: true },
  ]);
  assert.deepEqual(attachableTo([], plans), []);
});

test("monthly equivalents round per item like monthly_equivalent_cents", () => {
  assert.equal(monthlyEquivalent(6000, "monthly"), 6000);
  assert.equal(monthlyEquivalent(10000, "quarterly"), 3333);
  assert.equal(monthlyEquivalent(12001, "yearly"), 1000);
});

test("catalog figures: revenue statuses only, cycle mismatches are not revenue, the lock counts every billed status", () => {
  const addons = [
    { id: "pub", price_cents: 6000, billing_cycle: "monthly" },
    { id: "yr", price_cents: 12000, billing_cycle: "yearly" },
  ];
  const stats = computeCatalogStats({
    addons,
    attachments: [
      { addon_id: "pub", tenant_id: "t1", status: "active", billing_cycle: "monthly" },
      { addon_id: "pub", tenant_id: "t1", status: "past_due", billing_cycle: "monthly" },
      { addon_id: "pub", tenant_id: "t2", status: "trialing", billing_cycle: "monthly" },
      { addon_id: "pub", tenant_id: "t3", status: "cancelled", billing_cycle: "monthly" },
      // Invoice skips a cycle mismatch, so it is attached but earns nothing.
      { addon_id: "yr", tenant_id: "t4", status: "cancelling", billing_cycle: "monthly" },
    ],
    subscriptions: [
      { plan_id: "growth-2", billing_cycle: "monthly" },
      { plan_id: "scale-1", billing_cycle: "yearly" },
      { plan_id: "missing", billing_cycle: "monthly" },
    ],
    planPrices: [
      { plan_id: "growth-2", price_monthly_cents: 20000, price_quarterly_cents: null, price_yearly_cents: null },
      { plan_id: "scale-1", price_monthly_cents: null, price_quarterly_cents: null, price_yearly_cents: 120000 },
    ],
  });
  assert.equal(stats.attached, 3);
  assert.equal(stats.tenants, 2);
  assert.equal(stats.addonMrrCents, 12000);
  assert.equal(stats.planMrrCents, 30000);
  assert.equal(stats.shareOfTotal, 12000 / 42000);
  // trialing counts towards the lock (it will be billed), cancelled does not.
  assert.deepEqual(stats.billedByAddon, { pub: 3, yr: 1 });
});

test("no MRR at all is a null share, not a confident 0%", () => {
  const stats = computeCatalogStats({ addons: [], attachments: [], subscriptions: [], planPrices: [] });
  assert.equal(stats.shareOfTotal, null);
});

test("share formatting", () => {
  assert.equal(formatShare(0.076), "7.6%");
  assert.equal(formatShare(0), "0.0%");
  assert.equal(formatShare(0.0004), "<0.1%");
});
