// Book of business, round 2 (owner 2026-11-02, docs/la4/BUILD-ROUND2.md) · Files: a file's eight stages and
// its rows' outcomes, derived from what the pipeline already records, and the pages that show them.
// Run with: node --experimental-strip-types --test lib/ingestion/fileStages.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FILE_STAGE_NAMES, changeValue, failedAt, fileStages, linkMethodLabel, linkedNote, needsCount, notInFile, policyHref, rowOutcome, toCsv, whereItIs } from "./fileStages.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const facts = (over = {}) => ({ status: "parsed", fileType: "policies", carrierKnown: true, waitingForLayout: false, rowsKept: true, errorDetail: null, heldRows: 0, completed: true, unfinishedStage: null, openReviews: 0, ...over });
const states = (stages) => stages.map((s) => (s.state === "needs" ? `needs:${s.count}` : s.state));

test("the eight stages, in the owner's words and order", () => {
  assert.deepEqual([...FILE_STAGE_NAMES], ["Uploaded", "Layout", "Read", "Status words", "Linked", "History", "Pipeline", "Commissions"]);
  for (const f of [facts(), facts({ status: "failed", carrierKnown: false }), facts({ fileType: "commissions" }), facts({ status: "received" })]) {
    assert.deepEqual(fileStages(f).map((s) => s.name), [...FILE_STAGE_NAMES]);
  }
});

test("a read policy file with nothing waiting is done, commissions not needed", () => {
  const stages = fileStages(facts());
  assert.deepEqual(states(stages), ["done", "done", "done", "done", "done", "done", "done", "skipped"]);
  assert.deepEqual(whereItIs(stages), { label: "Done", tone: "good" });
});

test("held rows wait at Status words, open reviews at Linked; the chip adds them up at the first", () => {
  const stages = fileStages(facts({ heldRows: 2, openReviews: 3 }));
  assert.deepEqual(states(stages), ["done", "done", "done", "needs:2", "needs:3", "done", "done", "skipped"]);
  assert.equal(needsCount(stages), 5);
  assert.deepEqual(whereItIs(stages), { label: "5 need you · Status words", tone: "warning" });
  assert.equal(whereItIs(fileStages(facts({ openReviews: 3 }))).label, "3 need you · Linked");
});

test("one figure for what a file waits on: reviews plus the no-sale items it raised, on the strip, the chip and the list", () => {
  // The walk of 2026-11-02: an Aetna file with 12 reviews and 395 policies no sale has said 12 on the chip and 653 on the list.
  const stages = fileStages(facts({ openReviews: 12, noSaleItems: 395 }));
  assert.equal(stages[4].count, 407);
  assert.equal(stages[4].note, "Waiting for you: 12 policies to pick the client for, 395 policies with no sale");
  assert.equal(whereItIs(stages).label, "407 need you · Linked");
  assert.equal(linkedNote(0, 1), "Waiting for you: 1 policy with no sale");
  assert.equal(linkMethodLabel("no_match"), "To a new client from the row");
  const store = read("lib/ingestion/fileOutcomeStore.ts");
  assert.match(store, /export const ROW_QUEUE_TYPE = "no_deal_flow";/, "only a policy with no sale is a row's item; a sale no carrier has (no_policy) and same person (multi_policy) are not");
  assert.equal(store.split('.eq("queue_type", ROW_QUEUE_TYPE)').length - 1, 4, "the list, the head, the rows and the row page tie items the same way");
  assert.equal((store.match(/\.eq\("payload->>file_date", (?:f\.file_date|head\.fileDate)\)/g) ?? []).length, 3, "by the file date the item carries, never by policy number alone");
  assert.ok(store.includes("href: itemHref(kind, id)"), "each item opens its Needs you page");
  const page = read("app/app/(shell)/carrier-files/file/[fileId]/page.tsx");
  assert.ok(page.includes("This file needs you for ${n(needsCount(head.stages) || needs.length)}"));
  assert.match(page, /const NEEDS_SHOWN = 10;/);
  assert.ok(page.includes("See all {n(needs.length)} in Needs you"));
});

test("a file with no carrier waits at Layout for 'Who sent this?'; a missing layout waits on Insurvas", () => {
  const who = fileStages(facts({ status: "failed", carrierKnown: false, rowsKept: false }));
  assert.deepEqual(states(who), ["done", "needs:1", "pending", "pending", "pending", "pending", "pending", "pending"]);
  assert.equal(whereItIs(who).label, "Who sent this?");
  const layout = fileStages(facts({ status: "failed", waitingForLayout: true, rowsKept: true }));
  assert.equal(layout[1].state, "needs");
  assert.equal(whereItIs(layout).label, "Waiting for a layout");
});

test("a statement that didn't balance stops at Read; a missed required column stops at Layout", () => {
  const read_ = fileStages(facts({ status: "failed", fileType: "commissions", errorDetail: "The totals don't balance." }));
  assert.deepEqual(states(read_), ["done", "done", "failed", "pending", "pending", "pending", "pending", "pending"]);
  assert.deepEqual(whereItIs(read_), { label: "Read failed", tone: "danger" });
  assert.equal(failedAt({ carrierKnown: true, waitingForLayout: false, errorDetail: "A required column is missing: Policy #" }), "Layout");
  assert.equal(whereItIs(fileStages(facts({ status: "failed", errorDetail: "A required column is missing" }))).label, "Layout failed");
});

test("a step that failed after reading shows where (pipeline_stage_run), and the rest are not reached", () => {
  assert.deepEqual(states(fileStages(facts({ completed: false, unfinishedStage: "store" }))), ["done", "done", "done", "done", "pending", "failed", "pending", "skipped"]);
  assert.deepEqual(states(fileStages(facts({ completed: false, unfinishedStage: "match" }))), ["done", "done", "done", "done", "failed", "done", "pending", "skipped"]);
  assert.equal(whereItIs(fileStages(facts({ completed: false, unfinishedStage: "match" }))).label, "Linked failed");
  // Still running, nothing failed: at the first stage not reached.
  assert.equal(whereItIs(fileStages(facts({ completed: false }))).label, "At Linked");
  assert.equal(whereItIs(fileStages(facts({ status: "received", rowsKept: false }))).label, "At Read");
});

test("a commission file: no status words, history or pipeline; its lines are the Commissions stage", () => {
  assert.deepEqual(states(fileStages(facts({ fileType: "commissions" }))), ["done", "done", "done", "skipped", "done", "skipped", "skipped", "done"]);
  assert.equal(fileStages(facts({ fileType: "commissions", commissionWaiting: 2 }))[7].count, 2);
  assert.equal(fileStages(facts({ fileType: "commissions", completed: false, unfinishedStage: "reconcile" }))[7].state, "failed");
});

test("a replaced file says so, whatever its stages", () => {
  assert.deepEqual(whereItIs(fileStages(facts({ status: "superseded" })), true), { label: "Replaced by a corrected file", tone: "neutral" });
});

test("a row's outcome: a person's decision first, then new, changed, no change; lines; held or not read", () => {
  const base = { policyNumber: "AM-1", commissionLines: 0, waitsForPerson: false, isNew: false, changedFields: 0, fileHasHeldRows: false };
  assert.equal(rowOutcome({ ...base, waitsForPerson: true, isNew: true }), "needs_you");
  assert.equal(rowOutcome({ ...base, isNew: true, changedFields: 2 }), "new");
  assert.equal(rowOutcome({ ...base, changedFields: 1 }), "changed");
  assert.equal(rowOutcome(base), "no_change");
  assert.equal(rowOutcome({ ...base, policyNumber: null, commissionLines: 2 }), "commission");
  assert.equal(rowOutcome({ ...base, policyNumber: null, fileHasHeldRows: true }), "held");
  assert.equal(rowOutcome({ ...base, policyNumber: null }), "not_read");
});

test("not in this file: the previous file's policies this one lacks, never lapsed on their own", () => {
  assert.deepEqual(notInFile(["AM-3", "AM-1", "AM-2", "AM-2"], ["AM-1"]), ["AM-2", "AM-3"]);
  assert.deepEqual(notInFile([], ["AM-1"]), []);
  const page = read("app/app/(shell)/carrier-files/file/[fileId]/page.tsx");
  assert.match(page, /never lapsed on its own/);
  assert.doesNotMatch(read("lib/ingestion/fileOutcomeStore.ts"), /\.(insert|update|upsert|delete)\(/, "the outcome store reads; it never writes");
});

test("changes read as words; the CSV is safe in a spreadsheet; the policy page's tabs", () => {
  assert.equal(changeValue("premium_cents", "5820"), "$58.20");
  assert.equal(changeValue("status_normalized", "approved_unpaid"), "Approved unpaid");
  assert.equal(changeValue("paid_to_date", "2026-11-02"), "Nov 2, 2026");
  assert.equal(changeValue("product_code", null), "—");
  assert.equal(toCsv(["a", "b"], [["=SUM(A1)", "x, \"y\""], [-5, null]]), "a,b\r\n'=SUM(A1),\"x, \"\"y\"\"\"\r\n-5,\r\n");
  assert.equal(policyHref("c1", "AM 1", "client"), "/app/policies/carrier/c1/AM%201?tab=client");
});

test("the pages: inside the frame, with the strip, tabs and actions the mockups draw", () => {
  const list = read("app/app/(shell)/carrier-files/page.tsx");
  assert.match(list, /<DataInPage\s+step="files"/);
  for (const tab of ['key: "files"', 'key: "missing"', 'key: "arrive"', 'key: "changes"', 'key: "runs"', 'key: "findings"']) assert.ok(list.includes(tab), tab);
  assert.match(list, /Download problem rows/);
  assert.match(list, /listFileStages\(tenantId, list\.files\)/);
  const table = read("components/app/carrier-files-table.tsx");
  assert.match(table, /<StageStrip stages=\{view\.stages\} \/>/);
  assert.match(table, /view\.where\.label/);

  const frame = read("components/app/book/files/file-frame.tsx");
  assert.match(frame, /<DataInPage\s+step="files"\s+title=\{head\.name\}/);
  for (const label of ["Overview", "Rows", "Changes", "Commissions", "Whole file"]) assert.ok(frame.includes(`label: "${label}"`), label);
  assert.match(frame, /Replace with a corrected file/);
  assert.match(frame, /<CarrierFileReread fileId=\{head\.id\} \/>/);
  assert.match(frame, /preset=\{\{ carrierId: head\.carrierId, fileType: head\.fileType as CarrierFileType, fileDate: head\.fileDate, agency: head\.agency \}\}/, "a corrected file is the same carrier, type and day, so it supersedes");

  const file = read("app/app/(shell)/carrier-files/file/[fileId]/page.tsx");
  assert.match(file, /<StageStripLarge stages=\{head\.stages\}/);
  assert.match(file, /<CarrierFileAttribute/, "Who sent this? stays on the Overview");
  assert.match(file, /<PdfBalanceReview check=\{balance\} \/>/);
  assert.match(file, /\/app\/needs-you\?file=\$\{head\.id\}/);
  assert.match(file, /tab=rows&view=sent/, "the rows as sent stay one click away");
  assert.match(read("app/app/(shell)/carrier-files/file/[fileId]/whole/page.tsx"), /<FileFrame head=\{head\} tab="whole"/);

  const row = read("app/app/(shell)/carrier-files/file/[fileId]/row/[rowNumber]/page.tsx");
  assert.match(row, /<DataInPage\s+step="files"/);
  assert.match(row, /title=\{`Row \$\{row\.rowNumber\}\$\{policy \? ` · \$\{policy\}` : ""\}`\}/);
  assert.match(row, /policyLink\("client"\)/);
  assert.match(row, /policyLink\("history"\)/);
  assert.match(row, />Open the policy</);
  for (const page of [list, file, row]) assert.doesNotMatch(page, /<PageHeader\b/, "the frame draws the one title");
});

test("the rows export is registered, gated to the file's holders, and recorded like a download", () => {
  const route = read("app/api/app/carrier-files/rows-export/route.ts");
  assert.match(route, /requireFeatureRole\("statement_ingestion", roles\)/);
  assert.match(route, /const roles = \["owner", "bookkeeper"\] as const;/);
  assert.match(route, /action: "tenant\.carrier_file_downloaded"/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/carrier-files\/rows-export\/route\.ts", featureKey: "statement_ingestion", allowedRoles: \["owner", "bookkeeper"\]/);
  // Every read in the store names the tenant.
  const store = read("lib/ingestion/fileOutcomeStore.ts");
  const reads = [...store.matchAll(/db\(\)\.from\("(\w+)"\)\.select\([^)]*\)([^;\n]*)/g)].filter(([, table]) => !["carriers", "carrier_layout_map", "carrier_layout_map_entry", "tenant_pipeline_stages"].includes(table));
  assert.ok(reads.length > 10);
  for (const [whole, table, rest] of reads) assert.match(rest, /\.eq\("tenant_id", tenantId\)/, `${table}: ${whole.slice(0, 120)}`);
});
