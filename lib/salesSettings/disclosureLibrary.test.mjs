// Settings › Sales › Disclosures, as pure checks — no database: the library read one row per code, what
// needs the owner, what a draft changes, Try a case through the workspace's own rules, and the call
// wording the dialer would serve per state (LA-3.10, LA-2.23).
//
// Run with: node --experimental-strip-types --test lib/salesSettings/disclosureLibrary.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { documents, docMatches, searchDocs, attention, versionChanges, readAloudLine, tryCase, callCoverage, isPlaceholderWording, duplicateCode, wordDiff } = await import("./disclosureLibrary.ts");

const item = (over) => ({ id: over.id, code: "REPLACEMENT_NOTICE", title: "Replacement notice", body: "Read this.", states: [], carrierIds: [], version: 1, status: "published", platform: false, hasAttachment: false, rules: [], updatedAt: "2026-10-01T00:00:00Z", acknowledged: 0, ...over });
const coverage = { clauses: [{ field: "health.existing_coverage", op: "eq", value: true }] };

test("one row per code: the agency's newest version shows, its published one is live, every version is kept", () => {
  const items = [
    item({ id: "p1", platform: true, rules: [coverage] }),
    item({ id: "a1", version: 2, status: "retired" }),
    item({ id: "a2", version: 3, status: "published", rules: [coverage] }),
    item({ id: "a3", version: 4, status: "draft" }),
  ];
  const [doc] = documents(items);
  assert.equal(doc.shown.id, "a3");
  assert.equal(doc.live.id, "a2");
  assert.equal(doc.draft.id, "a3");
  assert.deepEqual(doc.versions.map((v) => v.id), ["a3", "a2", "a1", "p1"]);
});

test("an agency that retired its own version falls back to the Insurvas one", () => {
  const [doc] = documents([item({ id: "p1", platform: true }), item({ id: "a1", version: 2, status: "retired" })]);
  assert.equal(doc.live.id, "p1");
  assert.equal(docMatches(doc, "retired"), false);
  assert.equal(docMatches(doc, "live"), false);
});

test("filters and search", () => {
  const docs = documents([
    item({ id: "p1", platform: true }),
    item({ id: "x1", code: "TX_FORM", title: "Texas form", status: "published" }),
    item({ id: "x2", code: "TX_FORM", title: "Texas form", version: 2, status: "draft" }),
    item({ id: "o1", code: "OLD", title: "Old notice", status: "retired", body: "Surrender charges may apply." }),
  ]);
  const by = (f) => docs.filter((d) => docMatches(d, f)).map((d) => d.code);
  assert.deepEqual(by("draft"), ["TX_FORM"]);
  assert.deepEqual(by("live"), ["TX_FORM"]);
  assert.deepEqual(by("platform"), ["REPLACEMENT_NOTICE"]);
  assert.deepEqual(by("retired"), ["OLD"]);
  assert.deepEqual(searchDocs(docs, "tx_").map((d) => d.code), ["TX_FORM"]);
  assert.equal(searchDocs(docs, "  ").length, 3);
  assert.deepEqual(searchDocs(docs, "surrender").map((d) => d.code), ["OLD"], "the wording is searched too");
});

test("needs you: a live agency document no rule requires, and a waiting draft; Insurvas rows are not the agency's to fix", () => {
  const docs = documents([
    item({ id: "p1", platform: true }),
    item({ id: "c1", code: "AGENT_COMP", title: "Compensation", status: "published" }),
    item({ id: "t1", code: "TX", title: "Texas", status: "published", rules: [coverage] }),
    item({ id: "t2", code: "TX", title: "Texas", version: 2, status: "draft" }),
  ]);
  const a = attention(docs);
  assert.deepEqual(a.noRule.map((d) => d.code), ["AGENT_COMP"]);
  assert.deepEqual(a.drafts.map((d) => d.code), ["TX"]);
});

test("what a draft changes, in words", () => {
  const base = item({ id: "a", body: "One two three.", states: ["TX"], rules: [coverage] });
  assert.deepEqual(versionChanges(base, base), []);
  assert.deepEqual(versionChanges(base, { ...base, body: "One two three four five.", states: [], hasAttachment: true }), ["Wording (+2 words)", "States: every state", "PDF added"]);
  assert.deepEqual(versionChanges(base, { ...base, states: ["TX"], rules: [] }), ["Rules: 0 rules"]);
});

test("read-aloud time", () => {
  assert.equal(readAloudLine(""), "No wording yet");
  assert.equal(readAloudLine(Array(62).fill("word").join(" ")), "62 words · about 25 seconds read aloud");
  assert.equal(readAloudLine(Array(300).fill("word").join(" ")), "300 words · about 2 minutes read aloud");
});

test("Try a case runs the live versions through the workspace's rules, scope included", () => {
  const docs = documents([
    item({ id: "r1", platform: true, rules: [coverage] }),
    item({ id: "t1", code: "TX", title: "Texas", states: ["TX", "OK"], rules: [coverage] }),
    item({ id: "t2", code: "TX", title: "Texas", version: 2, status: "draft", states: [], rules: [coverage] }),
    item({ id: "n1", code: "NORULE", title: "No rule" }),
  ]);
  const run = (state, existing) => tryCase(docs, { state, carrierId: null, values: { "addr.state": state }, answers: { existing_coverage: existing } }).map((d) => d.code);
  assert.deepEqual(run("TX", true), ["REPLACEMENT_NOTICE", "TX"]);
  assert.deepEqual(run("NM", true), ["REPLACEMENT_NOTICE"], "scoped to TX/OK, so not for NM — the draft that drops the scope is not counted");
  assert.deepEqual(run("TX", false), []);
});

test("call wording per state: the newest arrived row, placeholder by its marker, missing blocks dialing, a later row is the next change", () => {
  const rows = [
    { id: "1", state: "TX", product_code: "term_life", required_text: "[PLACEHOLDER — NOT COMPLIANCE-APPROVED.]\nHi.", effective_from: "2026-09-23" },
    { id: "2", state: "FL", product_code: "term_life", required_text: "Approved wording.", effective_from: "2026-09-01" },
    { id: "3", state: "FL", product_code: "term_life", required_text: "Newer wording.", effective_from: "2026-12-01" },
  ];
  const [term, fe] = callCoverage(rows, ["FL", "NM", "TX"], ["final_expense"], "2026-10-30");
  assert.equal(term.code, "term_life");
  assert.deepEqual(term.states.map((s) => s.status), ["approved", "missing", "placeholder"]);
  assert.deepEqual(term.states[0].next, { effectiveFrom: "2026-12-01", approved: true });
  assert.deepEqual([term.approved, term.placeholder, term.missing], [1, 1, 1]);
  assert.equal(fe.code, "final_expense");
  assert.equal(fe.missing, 3);
  assert.equal(isPlaceholderWording("  [placeholder x]"), true);
  assert.equal(isPlaceholderWording("Hello"), false);
});

test("a duplicate gets the next free code", () => {
  assert.equal(duplicateCode("TX_FORM", ["TX_FORM"]), "TX_FORM_2");
  assert.equal(duplicateCode("TX_FORM_2", ["TX_FORM", "TX_FORM_2"]), "TX_FORM_3");
});

test("Compare marks words removed and added, keeping the rest", () => {
  const parts = wordDiff("Ask your agent for details.", "Ask your agent before you decide.");
  assert.deepEqual(parts.map((p) => [p.kind, p.text.trim()]), [["same", "Ask your agent"], ["del", "for details."], ["add", "before you decide."]]);
  assert.deepEqual(wordDiff("same words", "same words"), [{ text: "same words", kind: "same" }]);
  assert.deepEqual(wordDiff("", "new"), [{ text: "new", kind: "add" }]);
});
