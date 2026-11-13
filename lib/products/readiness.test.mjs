import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Settings › Products, round 8 (board settings-r8/products-and-ai): "sold" is not "ready". These pin what a
// product needs, the one chip, where each "+" link goes, and that the page keeps today's switch and wording.
const { needsFor, readinessOf, addedByText, matchesFilter, namesText, NEED_HREF } = await import("./readiness.ts");

const ROOT = process.cwd();
const read = (file) => readFileSync(join(ROOT, file), "utf8");

const full = {
  code: "final_expense",
  form: { name: "FE intake", appliedAt: "2026-10-14T00:00:00Z" },
  carriers: ["Americo", "Mutual of Omaha", "Aetna", "Corebridge"],
  health: { name: "FE health questions", questions: 14, knockouts: 3, own: true },
  quote: { name: "FE quote inputs", own: false },
};

test("the four needs come in call order, with the right links", () => {
  const needs = needsFor("life", full);
  assert.deepEqual(needs.map((n) => n.key), ["form", "carriers", "health", "quote"]);
  assert.ok(needs.every((n) => n.state === "done"));
  assert.equal(needs[1].short, "4 carriers");
  assert.equal(NEED_HREF.form, "/app/settings#form-templates");
  assert.equal(NEED_HREF.carriers, "/app/settings#carriers");
  assert.equal(NEED_HREF.health, "/app/settings#sales-process/health-questions");
  assert.equal(NEED_HREF.quote, "/app/settings#sales-process/quote-inputs");
  assert.match(needs[2].detail, /14 questions · 3 knock a carrier out/);
});

test("a product with nothing set up needs all four; retirement never needs health questions", () => {
  const none = needsFor("life", undefined);
  assert.deepEqual(none.map((n) => n.state), ["missing", "missing", "missing", "missing"]);
  assert.equal(none[1].short, "A carrier");
  const annuity = needsFor("retirement", { ...full, health: null });
  assert.equal(annuity[2].state, "na");
  assert.equal(readinessOf(true, annuity).label, "Ready");
});

test("one chip: Ready, Needs N things, or Not sold", () => {
  assert.deepEqual(readinessOf(true, needsFor("life", full)).tone, "good");
  const iul = readinessOf(true, needsFor("life", { ...full, quote: null }));
  assert.equal(iul.label, "Needs 1 thing");
  assert.equal(iul.tone, "warning");
  assert.equal(iul.missing[0].missingWords, "quote inputs");
  assert.equal(readinessOf(true, needsFor("life", undefined)).label, "Needs 4 things");
  assert.equal(readinessOf(false, needsFor("life", undefined)).label, "Not sold");
});

test("plans and names read as words", () => {
  assert.equal(addedByText(["Agency Plus"]), "Agency Plus");
  assert.equal(addedByText(["Agency Plus", "Enterprise"]), "Agency Plus or Enterprise");
  assert.equal(addedByText([]), null);
  assert.equal(namesText(["A", "B"]), "A and B");
  assert.equal(namesText(["A", "B", "C", "D"], 2), "A, B and 2 more");
});

test("the list's filter and search", () => {
  const ready = readinessOf(true, needsFor("life", { ...full, quote: null }));
  const row = { name: "Indexed Universal Life", sold: true, ready };
  assert.ok(matchesFilter(row, "setup", ""));
  assert.ok(matchesFilter(row, "sold", "indexed"));
  assert.ok(!matchesFilter(row, "off", ""));
  assert.ok(!matchesFilter(row, "all", "term"));
});

test("the page keeps the instant switch with Undo, asks before stopping, and calls no new write", () => {
  const page = read("components/app/settings/products-settings.tsx");
  assert.match(page, /action: undoable \? \{ label: "Undo"/);
  assert.match(page, /Stop selling \{confirmOff\.name\}\?/);
  assert.match(page, /<DialogDescription>Nothing is deleted\.<\/DialogDescription>/);
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /\/api\/app\/products\/readiness/);
  assert.doesNotMatch(page, /<Callout\b/, "a status line, never a notice card");
  assert.match(read("app/api/app/products/readiness/route.ts"), /requireTenant\(\["owner"\]\)/);
});
