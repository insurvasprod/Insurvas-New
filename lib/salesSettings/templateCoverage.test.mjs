import { test } from "node:test";
import assert from "node:assert/strict";

const { inUseNow, usesOf, scopeOf, templateChanges, changesSummary } = await import("./templateCoverage.ts");
const { definitionFromDraft, draftFromDefinition, newUnderwritingDefinition } = await import("./templateDefinition.ts");
const { addFromBank } = await import("./questionBank.ts");

const row = (p) => ({
  id: p.id, tenantOwned: p.mine ?? true, kind: "underwriting", productCode: p.product ?? "final_expense", productName: p.productName ?? "Final Expense",
  carrierId: p.carrier ?? null, carrierName: p.carrierName ?? null, name: p.id, version: p.version ?? 1, status: p.status ?? "published",
  definition: {}, publishedAt: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", editedBy: null,
});
const LINES = [{ code: "final_expense", name: "Final Expense", sold: true }, { code: "term_life", name: "Term Life", sold: true }, { code: "whole_life", name: "Whole Life", sold: false }];
const CARRIERS = [{ id: "c-am", name: "Americo" }, { id: "c-mo", name: "Mutual of Omaha" }];

test("the general template follows the interview's ladder: the agency's live one beats Insurvas's", () => {
  const all = [row({ id: "ins-fe", mine: false }), row({ id: "fe-v3", version: 3 }), row({ id: "fe-v4", version: 4, status: "draft" })];
  const [fe] = inUseNow(all, LINES, CARRIERS);
  assert.equal(fe.general.id, "fe-v3", "a draft is never loaded");
  assert.equal(fe.fallback, false);
  assert.deepEqual(fe.carriers, []);
});

test("with nothing of its own published, a call loads the Insurvas default and the page says so", () => {
  const all = [row({ id: "ins-fe", mine: false }), row({ id: "mine-draft", status: "draft" }), row({ id: "mine-old", status: "retired" })];
  assert.equal(inUseNow(all, LINES, CARRIERS)[0].general.id, "ins-fe");
});

test("a carrier with its own template is listed; a product with none falls back to Final Expense", () => {
  const all = [row({ id: "fe" }), row({ id: "am", carrier: "c-am", carrierName: "Americo" })];
  const [fe, term] = inUseNow(all, LINES, CARRIERS);
  assert.deepEqual(fe.carriers.map((c) => [c.carrierName, c.template.id]), [["Americo", "am"]]);
  assert.equal(term.general.id, "fe");
  assert.equal(term.fallback, true);
  assert.equal(inUseNow(all, LINES, CARRIERS).length, 2, "a line the agency does not sell is left out");
  assert.deepEqual(usesOf(all[0], inUseNow(all, LINES, CARRIERS)), ["Final Expense · every other carrier", "Term Life · every carrier"]);
  assert.deepEqual(usesOf(all[1], inUseNow(all, LINES, CARRIERS)), ["Final Expense · Americo"]);
});

test("nothing published at all leaves general null", () => {
  assert.equal(inUseNow([row({ id: "d", status: "draft" })], LINES, CARRIERS)[0].general, null);
});

test("scope words", () => {
  assert.equal(scopeOf({ productName: "Final Expense", carrierId: null, carrierName: null }), "Final Expense · every carrier");
  assert.equal(scopeOf({ productName: "Final Expense", carrierId: "c", carrierName: "Americo" }), "Final Expense · only Americo");
});

test("changes against the live version: added, knockouts, reworded, removed", () => {
  const live = newUnderwritingDefinition();
  let draft = addFromBank(draftFromDefinition(live), "oxygen");
  draft = { ...draft, questions: draft.questions.map((q) => (q.key === "decision_maker" ? { ...q, label: "Who else decides with you?" } : q)) };
  const c = templateChanges(live, definitionFromDraft(draft));
  assert.deepEqual(c.added, ["Do you use oxygen, or have you in the last 2 years?"]);
  assert.deepEqual(c.knockoutsAdded, ["Do you use oxygen, or have you in the last 2 years?"]);
  assert.deepEqual(c.reworded, ["Who else decides with you?"]);
  assert.equal(c.sections, true, "the Health section is new");
  assert.equal(changesSummary(c), "+1 question · 1 knockout added · 1 reworded · sections changed");
  const back = templateChanges(definitionFromDraft(draft), live);
  assert.deepEqual(back.removed, ["Do you use oxygen, or have you in the last 2 years?"]);
  assert.deepEqual(back.knockoutsRemoved, ["Do you use oxygen, or have you in the last 2 years?"]);
});

test("no change is an empty summary; a required flip is a change", () => {
  const live = newUnderwritingDefinition();
  assert.equal(templateChanges(live, live).total, 0);
  assert.equal(changesSummary(templateChanges(live, live)), "");
  const d = draftFromDefinition(live);
  const flipped = definitionFromDraft({ ...d, questions: d.questions.map((q) => (q.key === "decision_maker" ? { ...q, required: true } : q)) });
  const c = templateChanges(live, flipped);
  assert.deepEqual(c.changed, ["Does anyone else need to be on this call?"]);
  assert.equal(c.total, 1);
});

test("round 3: Insurvas start and before/after rows", async () => {
  const { insurvasStart, changeRows } = await import("./templateCoverage.ts");
  const all = [row({ id: "ins-fe", mine: false }), row({ id: "mine" })];
  assert.equal(insurvasStart(all, "term_life").id, "ins-fe", "a line with no default of its own starts from Final Expense's");
  const live = newUnderwritingDefinition();
  const draft = addFromBank(draftFromDefinition(live), "oxygen");
  const rows = changeRows(live, definitionFromDraft(draft));
  assert.deepEqual(rows.map((r) => [r.kind, r.after]), [["Added", "Yes / No · required · knockout"]]);
  assert.deepEqual(changeRows(live, live), []);
});
