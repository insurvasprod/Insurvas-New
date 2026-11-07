// Run with: node --experimental-strip-types --test lib/dashboard/views/leads.test.mjs
//
// Dashboard › Leads (owner 2026-11-06): the pure shaping behind the view — the month's days, the two
// daily series, sources, needs order and links, the funnel, the vendors table's money gate, speed to lead.
import { test } from "node:test";
import assert from "node:assert/strict";

import { dailySeries, dayOf, dollars, durationLabel, funnelSteps, leadName, leadNeeds, MAX_SLICES, monthSoFar, seesLeadMoney, sourceHref, sourceSlices, speedItems, vendorTable } from "./leads.ts";

test("the month so far is read in the agency's zone", () => {
  // 2026-11-01 03:00 UTC is still October 31 in New York.
  const now = Date.parse("2026-11-01T03:00:00Z");
  assert.deepEqual(monthSoFar(now, "UTC"), { from: "2026-11-01", to: "2026-11-01", days: ["2026-11-01"] });
  const ny = monthSoFar(now, "America/New_York");
  assert.equal(ny.from, "2026-10-01");
  assert.equal(ny.to, "2026-10-31");
  assert.equal(ny.days.length, 31);
  assert.equal(dayOf("2026-11-06T02:00:00Z", "America/Los_Angeles"), "2026-11-05");
});

test("leads called counts each lead once a day, however often it was dialled", () => {
  const days = ["2026-11-01", "2026-11-02"];
  const series = dailySeries(days, ["2026-11-01", "2026-11-01", "2026-11-02"], [
    { day: "2026-11-01", leadId: "a" }, { day: "2026-11-01", leadId: "a" }, { day: "2026-11-01", leadId: "b" }, { day: "2026-11-02", leadId: "a" },
  ]);
  assert.deepEqual(series.leadsIn.map((point) => point.value), [2, 1]);
  assert.deepEqual(series.leadsCalled.map((point) => point.value), [2, 1]);
  assert.equal(series.leadsIn[0].label, "Nov 1");
  assert.equal(series.leadsIn[0].key, "2026-11-01");
});

test("sources name the vendor, then the campaign, then partners, and fold the tail", () => {
  const campaigns = new Map([["c1", { name: "Facebook FE", vendorId: "v1" }], ["c2", { name: "Own list", vendorId: null }]]);
  const vendors = new Map([["v1", "LeadCo"]]);
  const slices = sourceSlices([
    { campaign_id: "c1", partner_id: null, first_dial_at: "x" },
    { campaign_id: "c1", partner_id: null, first_dial_at: null },
    { campaign_id: "c2", partner_id: null },
    { campaign_id: null, partner_id: "p1" },
    { campaign_id: null, partner_id: null },
  ], campaigns, vendors);
  assert.deepEqual(slices[0], { key: "vendor:v1", label: "LeadCo", value: 2, called: 1 });
  assert.ok(slices.some((slice) => slice.key === "campaign:c2" && slice.label === "Own list"));
  assert.ok(slices.some((slice) => slice.key === "partner"));
  assert.ok(slices.some((slice) => slice.key === "none"));

  const many = Array.from({ length: 8 }, (_, index) => ({ campaign_id: `c${index}`, partner_id: null }));
  const named = new Map(many.map((lead) => [lead.campaign_id, { name: lead.campaign_id, vendorId: null }]));
  const folded = sourceSlices(many, named, new Map());
  assert.equal(folded.length, MAX_SLICES);
  assert.deepEqual(folded.at(-1), { key: "other", label: "Other sources", value: 4, called: 0 });
  assert.equal(folded.reduce((sum, slice) => sum + slice.value, 0), 8);
});

test("a source opens its vendor or campaign page only for a reader who opens Vendors & campaigns", () => {
  assert.equal(sourceHref("vendor:v1", "/app/campaigns", "/app/leads"), "/app/campaigns/vendors/v1");
  assert.equal(sourceHref("campaign:c1", "/app/campaigns", "/app/leads"), "/app/campaigns/c1");
  assert.equal(sourceHref("vendor:v1", null, "/app/leads"), "/app/leads");
  assert.equal(sourceHref("partner", "/app/campaigns", "/app/leads"), "/app/leads");
});

test("money: money.view, not a manager, not a narrowed agency session", () => {
  assert.equal(seesLeadMoney({ roles: ["owner"], noMoney: false, scope: null }), true);
  assert.equal(seesLeadMoney({ roles: ["owner"], noMoney: true, scope: null }), false);
  // AG-0.2: inside an agency a producer does not see lead cost.
  assert.equal(seesLeadMoney({ roles: ["producer"], noMoney: false, scope: ["u1"] }), false);
  assert.equal(seesLeadMoney({ roles: ["setter"], noMoney: false, scope: null }), false);
});

test("needs come most urgent first, each to its filtered page, and an unread count is left out", () => {
  const needs = leadNeeds({
    notCalled: { count: 3, capped: false, href: "/app/leads" },
    duplicates: { count: 2, href: "/app/duplicates?tab=duplication" },
    missing: { state: 5, phone: 1, href: (column) => `/app/duplicates?tab=missing&missing=${column}` },
    review: { count: 1, href: "/app/import/review/b1" },
    bills: { count: 4, flagged: 1, href: "/app/vendor-bills?tab=invoices&status=approve" },
  });
  assert.deepEqual(needs.map((need) => need.key), ["not-called", "duplicates", "missing", "review", "bills"]);
  assert.equal(needs[0].tone, "danger");
  assert.equal(needs[2].href, "/app/duplicates?tab=missing&missing=state");
  assert.equal(needs[2].detail, "1 with no phone");
  assert.equal(needs[4].href, "/app/vendor-bills?tab=invoices&status=approve");

  const phoneOnly = leadNeeds({ notCalled: null, duplicates: null, missing: { state: 0, phone: 7, href: (column) => `/x?missing=${column}` }, review: null, bills: null });
  assert.deepEqual(phoneOnly.map((need) => [need.label, need.href]), [["Leads with no phone", "/x?missing=phone"]]);
  assert.deepEqual(leadNeeds({ notCalled: null, duplicates: null, missing: { state: null, phone: null, href: () => "/x" }, review: null, bills: null }), []);
});

test("the funnel skips a step nobody counted and measures each step against the first", () => {
  const built = funnelSteps([
    { key: "leads", label: "Leads", count: 200 },
    { key: "reached", label: "Reached", count: 100 },
    { key: "quoted", label: "Quoted", count: null },
    { key: "apps", label: "Apps", count: 20 },
    { key: "issued", label: "Issued", count: 10 },
  ], "/app/true-cpa?from=2026-11-01&to=2026-11-06");
  assert.deepEqual(built.steps.map((step) => step.key), ["leads", "reached", "apps", "issued"]);
  assert.deepEqual(built.steps.map((step) => step.pct), [100, 50, 10, 5]);
  assert.equal(built.rate, "5.0% issued");
  assert.ok(built.steps.every((step) => step.href === "/app/true-cpa?from=2026-11-01&to=2026-11-06"));
  assert.equal(funnelSteps([{ key: "a", label: "A", count: 3 }], null), null);
});

test("the vendors table hides cost per sale without money, drops test batches, and links each row", () => {
  const lines = [
    { id: "v1", name: "LeadCo", leads: 40, reachedPct: 41.6, costPerSaleCents: 41_200, testBatch: false },
    { id: "v2", name: "Test", leads: 90, reachedPct: 10, costPerSaleCents: null, testBatch: true },
    { id: "v3", name: "Acme", leads: 60, reachedPct: null, costPerSaleCents: null, testBatch: false },
  ];
  const withMoney = vendorTable(lines, true, (id) => `/app/campaigns/vendors/${id}`);
  assert.deepEqual(withMoney.heads, ["Vendor", "Leads", "Reached", "Cost / sale"]);
  assert.deepEqual(withMoney.rows.map((row) => row.cells), [["Acme", "60", "—", "—"], ["LeadCo", "40", "42%", "$412"]]);
  assert.equal(withMoney.rows[1].href, "/app/campaigns/vendors/v1");
  const without = vendorTable(lines, false, () => null);
  assert.deepEqual(without.heads, ["Vendor", "Leads", "Reached"]);
  assert.ok(without.rows.every((row) => row.cells.length === 3 && !("href" in row)));
  assert.ok(!JSON.stringify(without.rows).includes("$"));
});

test("speed to lead: time to the first dial, or how long it has waited", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const items = speedItems([
    { id: "a", name: "Ann Lee", arrivedAt: "2026-11-06T11:00:00Z", firstDialAt: "2026-11-06T11:02:00Z" },
    { id: "b", name: "bo", arrivedAt: "2026-11-06T08:00:00Z", firstDialAt: null },
    { id: "c", name: "Cy", arrivedAt: "2026-11-06T11:50:00Z", firstDialAt: null },
  ], now, (id) => `/app/leads/${id}`);
  assert.deepEqual(items.map((item) => [item.mark, item.value, item.tone, item.href]), [["AL", "2m", "good", "/app/leads/a"], ["B", "4h", "danger", "/app/leads/b"], ["C", "10m", "neutral", "/app/leads/c"]]);
  assert.equal(items[0].when, "arrived 1h ago");
  assert.equal(items[1].detail, "not called yet");
});

test("formatting", () => {
  assert.equal(durationLabel(45), "45s");
  assert.equal(durationLabel(3 * 3600 + 300), "3h 5m");
  assert.equal(durationLabel(50 * 3600), "2d 2h");
  assert.equal(dollars(123_456), "$1,235");
  assert.equal(leadName({ first_name: "Ann", last_name: "Lee" }), "Ann Lee");
  assert.equal(leadName({ full_name: "  " }), "Unnamed lead");
});

test("a zero step that a later step exceeds was not counted on that path, so it is left out", () => {
  const out = funnelSteps([{ key: "served", label: "Served", count: 42 }, { key: "dialed", label: "Dialed", count: 0 }, { key: "contacts", label: "Contacts", count: 0 }, { key: "apps", label: "Applications", count: 38 }], null);
  assert.deepEqual(out.steps.map((step) => step.key), ["served", "apps"]);
  assert.equal(out.rate, "90% applications");
  const tail = funnelSteps([{ key: "a", label: "A", count: 10 }, { key: "b", label: "B", count: 0 }], null);
  assert.deepEqual(tail.steps.map((step) => step.key), ["a", "b"], "a zero at the end is a real zero");
});
