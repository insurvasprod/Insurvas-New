// The pricing page's plan arithmetic (2026-10-13 pricing): the "Everything in X, plus" increments
// and the "Which plan fits you?" picker. Fixtures mirror the shape of the live catalog (three nested
// plans) without pinning its names or prices, plus the shapes the page must survive.
import test from "node:test";
import assert from "node:assert/strict";

const { planIncrements, recommendPlan, availableNeeds, joinWords, FIT_NEEDS } = await import("./planFit.ts");

const MODULES = { book: ["Book of business", 1], acquisition: ["Acquisition", 2], sell: ["Sell", 3], retention: ["Retention", 4], insight: ["Insight", 5], partners: ["Partners", 6] };
let order = 0;
const f = (key, module) => ({ key, label: key, module, moduleLabel: MODULES[module][0], moduleOrder: MODULES[module][1], order: ++order });

const BOOK = [f("book_of_business", "book"), f("commission_ledger", "book"), f("cohort_persistency", "insight")];
const MID = [...BOOK, f("inbound_transfers", "acquisition"), f("outbound_dialing", "acquisition"), f("lead_import", "acquisition"), f("quoting", "sell"), f("applications", "sell")];
const TOP = [...MID, f("chargeback_radar", "retention"), f("publisher_records", "partners"), f("payout_runs", "partners"), f("true_cpa", "insight")];

const plan = (code, name, monthlyCents, features) => ({ code, name, monthlyCents, features });
const NESTED = [plan("a", "Small", 9900, BOOK), plan("b", "Middle", 24900, MID), plan("c", "Large", 44900, TOP)];
const pick = (plans, ids) => recommendPlan(plans, ids);

test("increments: the first plan lists everything, each next one only what it adds", () => {
  const [first, second, third] = planIncrements(NESTED);
  assert.equal(first.buildsOn, null);
  assert.deepEqual(first.modules.map((m) => m.module), ["book", "insight"]);
  assert.deepEqual(second.buildsOn, { code: "a", name: "Small" });
  assert.deepEqual(second.modules.map((m) => [m.module, m.features.map((x) => x.key)]), [
    ["acquisition", ["inbound_transfers", "outbound_dialing", "lead_import"]],
    ["sell", ["quoting", "applications"]],
  ]);
  assert.deepEqual(third.modules.map((m) => m.module), ["retention", "insight", "partners"]);
});

test("increments: a plan that does not hold all of the previous one lists itself in full", () => {
  const [, odd] = planIncrements([plan("a", "Small", 1, BOOK), plan("b", "Other", 2, MID.slice(3))]);
  assert.equal(odd.buildsOn, null);
  assert.deepEqual(odd.modules.map((m) => m.module), ["acquisition", "sell"]);
});

test("picker: nothing ticked is not an answer", () => {
  assert.deepEqual(pick(NESTED, []), { status: "unanswered" });
});

test("picker: the cheapest plan that covers the jobs, and why", () => {
  const leads = pick(NESTED, ["leads"]);
  assert.equal(leads.status, "match");
  assert.equal(leads.code, "b");
  assert.equal(leads.reason, "Middle is the lowest-priced plan with Acquisition; Small does not include Acquisition.");
  assert.equal(pick(NESTED, ["leads", "sell"]).code, "b");
  assert.equal(pick(NESTED, ["partners"]).code, "c");
  assert.equal(pick(NESTED, ["retention", "sell"]).reason, "Large is the lowest-priced plan with Sell and Retention; Middle does not include Retention.");
});

test("picker: price decides, not the order the plans arrive in", () => {
  const shuffled = [NESTED[2], NESTED[0], NESTED[1]];
  assert.equal(pick(shuffled, ["sell"]).code, "b");
});

test("picker: the lowest-priced plan says so", () => {
  const plans = [plan("x", "Only", 100, TOP)];
  assert.equal(pick(plans, ["leads"]).reason, "Only already covers Acquisition, and it is the lowest-priced plan.");
});

test("picker: a job needs every anchor the catalog sells, not just one", () => {
  // Middle has transfers but not the list import the catalog also sells: Large is the answer.
  const partial = [plan("a", "Small", 1, BOOK), plan("b", "Middle", 2, [...BOOK, f("inbound_transfers", "acquisition")]), plan("c", "Large", 3, TOP)];
  assert.equal(pick(partial, ["leads"]).code, "c");
});

test("picker: with no anchor in the catalog, the whole module is the requirement", () => {
  const custom = [{ id: "x", label: "x", modules: ["sell"], anchors: ["not_sold_anywhere"] }];
  assert.equal(recommendPlan(NESTED, ["x"], custom).code, "b");
});

test("picker: questions the catalog cannot answer are not asked", () => {
  assert.deepEqual(availableNeeds([plan("a", "Small", 1, MID)]).map((n) => n.id), ["leads", "sell"]);
  assert.equal(availableNeeds(NESTED).length, FIT_NEEDS.length);
});

test("picker: no plan covers it", () => {
  const split = [plan("a", "Dialer", 1, MID.slice(0, 6)), plan("b", "Retention", 2, [...BOOK, f("chargeback_radar", "retention")])];
  assert.deepEqual(pick(split, ["leads", "retention"]), { status: "none", reason: "No single plan covers Acquisition and Retention together yet." });
});

test("joinWords", () => {
  assert.equal(joinWords(["A"]), "A");
  assert.equal(joinWords(["A", "B"]), "A and B");
  assert.equal(joinWords(["A", "B", "C"]), "A, B and C");
});
