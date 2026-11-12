// Settings round 8 · Sales process (owner pick A, 2026-11-12): six Selling pages as the header tabs of one
// section. The tab list, which tab an old link or a search anchor opens, and the Overview's "Needs you".
// Run with: node --experimental-strip-types --test lib/salesSettings/salesProcess.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OLD_SALES_SECTIONS, PRODUCER_TABS, SALES_PROCESS_TABS, ageText, countPairs, healthDrafts, lastChange, pairsOnInsurvasDefault, tabForAnchor } from "./salesProcess.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the tabs are the call in order, with the board's names", () => {
  assert.deepEqual(SALES_PROCESS_TABS.map((t) => t.label), ["Overview", "Health questions", "Quote inputs", "Carrier application", "Quote & case checks", "Disclosures", "Stage moves"]);
  assert.deepEqual([...PRODUCER_TABS], ["health-questions"]);
});

test("every old Selling page lands on its tab, here and in the registry's redirects", () => {
  const registry = read("lib/settings/registry.ts");
  for (const [old, tab] of Object.entries(OLD_SALES_SECTIONS)) {
    assert.ok(SALES_PROCESS_TABS.some((t) => t.key === tab), tab);
    assert.match(registry, new RegExp(`"${old}": "sales-process/${tab}"`), old);
  }
});

test("an anchor opens the tab that holds it", () => {
  assert.equal(tabForAnchor("checks"), "checks");
  assert.equal(tabForAnchor("qa-buffer"), "checks");
  assert.equal(tabForAnchor("pair.all.final_expense"), "quote-inputs");
  assert.equal(tabForAnchor("doc.REPLACEMENT_NOTICE"), "disclosures");
  assert.equal(tabForAnchor("sales-pipeline-sync"), "stage-moves");
  assert.equal(tabForAnchor("set.abc"), null, "a record inside a tab the page already shows");
  assert.equal(tabForAnchor(null), null);
});

const t = (p) => ({ id: "x", tenantOwned: true, kind: "quotation", productCode: "final_expense", productName: "Final Expense", carrierId: null, carrierName: null, name: "n", version: 1, status: "published", definition: {}, publishedAt: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", editedBy: null, ...p });

test("Needs you: health drafts, oldest first, and pairs still on the Insurvas default", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  const drafts = healthDrafts([t({ id: "a", status: "draft", carrierId: "c1", carrierName: "Aetna", updatedAt: "2026-11-10T00:00:00Z" }), t({ id: "b", status: "draft", carrierId: "c2", carrierName: "Corebridge", updatedAt: "2026-11-03T00:00:00Z" }), t({ id: "c" })], now);
  assert.deepEqual(drafts.map((d) => [d.title, d.detail, d.anchor]), [["Corebridge · Final Expense", "Health questions draft · 9 days old", "set.b"], ["Aetna · Final Expense", "Health questions draft · 2 days old", "set.a"]]);

  const facts = {
    carriers: [{ id: "c1", name: "Aetna" }, { id: "c2", name: "Transamerica" }],
    carrierProducts: [{ carrierId: "c1", productCode: "final_expense" }, { carrierId: "c2", productCode: "final_expense" }, { carrierId: "c2", productCode: "term_life" }],
    productLines: [{ code: "final_expense", name: "Final Expense" }, { code: "term_life", name: "Term life" }, { code: "medicare", name: "Medicare", sold: false }],
    templates: [t({ carrierId: "c1", productCode: "final_expense" })],
  };
  assert.deepEqual(pairsOnInsurvasDefault(facts).map((n) => n.title), ["Transamerica · Final Expense", "Transamerica · Term life"]);
  assert.deepEqual(countPairs(facts), { sold: 3, own: 1 });
  // An agency default for the line covers every carrier on it.
  const covered = { ...facts, templates: [t({ carrierId: null, productCode: "final_expense" })] };
  assert.deepEqual(pairsOnInsurvasDefault(covered).map((n) => n.title), ["Transamerica · Term life"]);
});

test("words: ages and the newest change", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(ageText("2026-11-12T01:00:00Z", now), "today");
  assert.equal(ageText("2026-11-11T00:00:00Z", now), "1 day old");
  assert.deepEqual(lastChange([{ at: null, by: "A", what: "x" }, { at: "2026-11-01T00:00:00Z", by: "B", what: "y" }, { at: "2026-11-05T00:00:00Z", by: null, what: "z" }]), { at: "2026-11-05T00:00:00Z", by: null, what: "z" });
});
