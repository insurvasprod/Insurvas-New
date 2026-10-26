import { test } from "node:test";
import assert from "node:assert/strict";

import { flowRange, leadFlowView, money } from "./leadFlow.ts";

const step = (key, label, count) => ({ key, label, count, toNext: null });
const funnel = (counts, extra = {}) => ({
  steps: [
    step("served", "Served", counts[0]),
    step("dialed", "Dialed", counts[1]),
    step("contacts", "Contacts", counts[2]),
    step("quoted", "Quoted", counts[3]),
    step("applications", "Applications", counts[4]),
  ],
  spendCents: 1_842_000,
  annualisedCents: 4_188_000,
  deals: 43,
  leak: { servedNeverDialed: 760, share: 0.35, top: { id: "u1", name: "Jordan M.", count: 310, alsoMostZeroClick: false, zeroClick: 4 } },
  ...extra,
});

test("the biggest leak is the step that keeps the smallest share", () => {
  const view = leadFlowView(funnel([2140, 1380, 412, 138, 61]));
  assert.equal(view.leak?.from, "Dialled");
  assert.equal(view.leak?.to, "Reached");
  assert.equal(view.leak?.percent, "30%");
  assert.equal(view.leak?.lost, 968);
  assert.equal(view.drops[1].text, "−968 not reached");
  // 968 of 2,140 served leads at $18,420: what the lost ones cost.
  assert.equal(view.leak?.lostSpendCents, Math.round((1_842_000 / 2140) * 968));
  // The served-never-dialled agent belongs to the first step only.
  assert.equal(view.leak?.topAgent, null);
});

test("a leak at served → dialled names the agent who left the most", () => {
  const view = leadFlowView(funnel([1000, 100, 60, 40, 30]));
  assert.equal(view.leak?.to, "Dialled");
  assert.deepEqual(view.leak?.topAgent, { name: "Jordan M.", count: 310 });
});

test("an unknown step is left out, never drawn as zero", () => {
  const view = leadFlowView(funnel([100, 80, 40, null, 10]));
  assert.deepEqual(view.stages.map((s) => s.label), ["Leads served", "Dialled", "Reached", "Applications"]);
  assert.equal(view.drops.length, 3);
  assert.equal(view.drops[2].text, "−30 no application");
});

test("a rise is not a loss, and a tiny base is not a finding", () => {
  const view = leadFlowView(funnel([3, 9, 1, 0, 0]));
  assert.equal(view.drops[0].lost, 0);
  assert.equal(view.drops[0].text, "none lost");
  // 9 → 1 dialled to reached is the only step from a base of 5 or more.
  assert.equal(view.leak?.to, "Reached");
  assert.equal(leadFlowView(funnel([4, 3, 2, 1, 0])).leak, null);
});

test("no spend recorded: no costs, never $0", () => {
  const view = leadFlowView(funnel([100, 50, 20, 10, 5], { spendCents: null }));
  assert.ok(view.stages.every((s) => s.note === undefined));
  assert.equal(view.leak?.lostSpendCents, null);
  assert.equal(view.costPerApplicationCents, null);
});

test("an empty day is empty", () => {
  assert.equal(leadFlowView(funnel([0, 0, 0, 0, 0])).empty, true);
  assert.equal(leadFlowView(funnel([0, 0, 0, 0, 0])).leak, null);
});

test("money and the period's dates", () => {
  assert.equal(money(1335), "$13.35");
  assert.equal(money(1_842_000), "$18,420");
  assert.deepEqual(flowRange("2026-10-25", 1), { fromDate: "2026-10-25", toDate: "2026-10-25" });
  assert.deepEqual(flowRange("2026-03-02", 7), { fromDate: "2026-02-24", toDate: "2026-03-02" });
});
