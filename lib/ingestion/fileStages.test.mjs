// Book of business, round 2 (owner 2026-11-02, docs/la4/BUILD-ROUND2.md) · Files: a file's eight stages and
// its rows' outcomes, derived from what the pipeline already records, and the pages that show them.
// Run with: node --experimental-strip-types --test lib/ingestion/fileStages.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FILE_FILTERS, FILE_STAGE_NAMES, changeValue, failedAt, fileStages, fileWhere, linkMethodLabel, linkedNote, needsCount, notInFile, shownStages, policyHref, rowOutcome, toCsv, whereItIs } from "./fileStages.ts";

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
  // Round 4 (owner 2026-11-02: "not see all 407"): the one figure heads the grouped work, every group has its way
  // through on the page, and a file's "No sale yet" items are confirmed at once.
  assert.match(page, /const needsTotal = needsCount\(head\.stages\) \|\| needs\.length;/);
  // Round 5 (owner 2026-11-03): the file page shows, it never decides: one line, one button into the Review page.
  assert.match(page, /<FileWaiting total=\{needsTotal\} parts=\{parts\} reviewHref=\{reviewable \? reviewBase : null\}/);
  assert.match(page, /const reviewBase = `\/app\/needs-you\/review\?file=\$\{head\.id\}&from=/);
  assert.doesNotMatch(page, /NEEDS_SHOWN|See all \{n\(needsTotal\)\}/, "no 10-row table, then a link off the page");
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
  assert.match(page, /watched, never lapsed/, "said as a muted half-line beside the heading, not an explainer card");
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
  assert.doesNotMatch(list, /Download problem rows/, "owner 2026-11-02: problems are fixed in the system, not downloaded");
  assert.match(list, /listFileStages\(tenantId, list\.files\)/);
  const table = read("components/app/carrier-files-table.tsx");
  assert.match(table, /<StageStrip stages=\{view\.stages\} fileType=\{file\.fileType\} reading=\{whereOf\(file\) === "running"\} \/>/);
  // Live (owner 2026-11-05): no Refresh button; the list asks again while a file reads, and says when it finishes.
  assert.doesNotMatch(table, /RefreshButton/);
  assert.match(table, /window\.setTimeout\(\(\) => router\.refresh\(\), LIVE_EVERY_MS\)/);
  assert.match(table, /notify\.warn\(`\$\{file\.originalFilename\} could not be read`/);
  assert.match(table, /view\.where\.label/);
  assert.match(table, /fileWhere\(file, stages\?\.\[file\.id\]\)/, "the list filters by the same rule as the chips count");

  const frame = read("components/app/book/files/file-frame.tsx");
  assert.match(frame, /<DataInPage\s+step="files"\s+title=\{head\.name\}/);
  for (const label of ["Rows", "Changes", "Commissions"]) assert.ok(frame.includes(`${label.toLowerCase()}: "${label}"`), label);
  assert.match(frame, /Replace with a corrected file/);
  assert.match(frame, /preset: \{ carrierId: head\.carrierId, fileType: head\.fileType as CarrierFileType, fileDate: head\.fileDate, agency: head\.agency \}/, "a corrected file is the same carrier, type and day, so it supersedes");

  const file = read("app/app/(shell)/carrier-files/file/[fileId]/page.tsx");
  assert.match(file, /<StageRow stages=\{head\.stages\}/);
  assert.match(file, /<CarrierFileAttribute/, "Who sent this? stays on the file's page");
  assert.match(file, /\{!readOnly && <FileReread fileId=\{head\.id\} \/>\}/, "Read again sits on the file's page, for those who can change it");
  assert.match(file, /<PdfBalanceReview check=\{balance\} \/>/);
  assert.match(file, /\/app\/needs-you\/review\?file=\$\{head\.id\}/, "what a file left opens the Review page, narrowed to the file");
  assert.match(file, /\{ label: "The file as sent", href: `\$\{fileHref\(head\.id\)\}\/whole` \}/, "the whole file as sent is in the Rows tab's More (round 4)");
  assert.match(file, /if \(search\.view === "sent"\)/, "the old rows-as-sent address still opens");
  assert.match(read("app/app/(shell)/carrier-files/file/[fileId]/whole/page.tsx"), /<FileFrame head=\{head\} tab="rows"/);

  const row = read("app/app/(shell)/carrier-files/file/[fileId]/row/[rowNumber]/page.tsx");
  assert.match(row, /<DataInPage\s+step="files"/);
  // Round 5 (board 5): the policy number and the client are the title, "Row N" only when the row made no policy.
  assert.match(row, /const title = \[policy, outcome\?\.clientName\]\.filter\(Boolean\)\.join\(" · "\) \|\| `Row \$\{row\.rowNumber\}`;/);
  assert.match(row, /title=\{title\}/);
  assert.match(row, /policyLink\("client"\)/);
  assert.match(row, /policyLink\("history"\)/);
  assert.match(row, />Open the policy</);
  for (const page of [list, file, row]) assert.doesNotMatch(page, /<PageHeader\b/, "the frame draws the one title");
});

test("round 3 · Files is one list with chips; the old tabs redirect or live in More", () => {
  assert.deepEqual(FILE_FILTERS.map((f) => f.label), ["All", "Needs you", "Failed", "Missing"]);
  assert.equal(fileWhere({ status: "superseded", waitingForLayout: false }), "replaced");
  assert.equal(fileWhere({ status: "failed", waitingForLayout: true }), "waiting");
  assert.equal(fileWhere({ status: "failed", waitingForLayout: false }), "failed");
  assert.equal(fileWhere({ status: "parsed", waitingForLayout: false }, { stages: fileStages(facts({ openReviews: 2 })) }), "needs");
  assert.equal(fileWhere({ status: "parsed", waitingForLayout: false }, { stages: fileStages(facts()) }), "done");

  const list = read("app/app/(shell)/carrier-files/page.tsx");
  assert.doesNotMatch(list, /ViewTabs|role="tablist"|tabs=\{\[/, "the Files step has no tab bar");
  assert.match(list, /<OutcomeFilter\s+label="Show files"/);
  assert.match(list, /const HOW_FILES_ARRIVE_HREF = "\/app\/book-setup\/how-files-arrive";/);
  assert.match(list, /if \(asked === "doors" \|\| asked === "bucket" \|\| asked === "arrive"\) redirect\(/);
  assert.match(list, /const RECENT_CHANGES_HREF = "\/app\/policies\?view=changes";/);
  assert.match(list, /if \(asked === "changes"\) redirect\(RECENT_CHANGES_HREF\);/);
  // Owner 2026-11-02: Run history is a tab on each file's page; Checks are "Problems found" under Needs you.
  assert.match(list, /if \(asked === "runs"\) redirect\("\/app\/carrier-files"\);/);
  assert.match(list, /if \(asked === "findings"\) redirect\("\/app\/carrier-files\?show=needs"\);/);
  assert.doesNotMatch(list, /<PipelineRuns |<MoreMenu/);
  assert.match(list, /filter === "needs" && findings[\s\S]*<AgentFindings /);
  assert.match(list, /needs: list\.files\.filter\(\(file\) => where\(file\) === "needs"\)\.length \+ openFindings/);
  const file = read("app/app/(shell)/carrier-files/file/[fileId]/page.tsx");
  assert.match(file, /listRuns\(tenantId, 50, \{ fileId \}\)/);
  assert.match(file, /<FileRuns runs=\{runs\.runs\} available=\{runs\.available\} fileId=\{head\.id\} fileType=\{head\.fileType\} \/>/, "round 4: the file's runs as steps in the stage bar's words");
  const runs = read("components/app/book/files/file-runs.tsx");
  for (const name of ["Uploaded", "Read", "History", "Linked", "Pipeline", "Commissions"]) assert.ok(runs.includes(`"${name}"`), name);
  assert.doesNotMatch(runs, /Each file goes through/, "no helper sentence");
  assert.match(read("components/app/book/files/file-frame.tsx"), /history: "Run history"/);
  assert.equal((list.match(/<Callout\b/g) ?? []).length, 1, "the warnings above the list are one line");
  assert.match(list, /upload_\(\{ label: "Upload", size: "sm", variant: "outline", preset: \{ carrierId: item\.carrierId \} \}\)/, "Missing has Upload on the row");
  // The walk of 2026-11-02: the strip and the chips count the same files; the table fits its card.
  assert.match(list, /<StatTile label="Need you" value=\{n\(counts\.needs\)\}/);
  assert.match(list, /<StatTile label="Failed" value=\{n\(counts\.failed\)\}/);
  const table = read("components/app/carrier-files-table.tsx");
  assert.doesNotMatch(table, /Any stage/, "the chips pick the stage");
  // Every filter on the toolbar's one row (owner 2026-11-02), no "More filters" panel.
  assert.doesNotMatch(table, />More filters</);
  assert.match(table, /aria-label="How it arrived"/);
  assert.match(table, /aria-label="When it arrived"/);
  assert.match(table, /table-fixed/);
  assert.doesNotMatch(table, /min-w-\[1040px\]/);
});

test("round 3 · the file page is compact: no explainer card, figures are links, at most two buttons", () => {
  const file = read("app/app/(shell)/carrier-files/file/[fileId]/page.tsx");
  assert.doesNotMatch(file, /tone="info"/, "no info Callout on the file page");
  assert.doesNotMatch(file, /See rows ›|See lines ›|See policies ›/, "the whole tile is the link");
  assert.doesNotMatch(file, /<Card\b|CardContent/, "the stage row sits under the header without a card");
  assert.doesNotMatch(file, /function sentence\(/, "no sentence under the stages");
  // Round 4: the Overview's figures are the outcome chips' counts; the file page has no figure strip of its own.
  assert.match(file, /count: all\.filter\(f\.test\)\.length, href: query\(f\.key\)/);
  assert.match(file, /title=\{`Not in this file · \$\{n\(notIn\.policies\.length\)\}`\}/);
  assert.match(file, /title=\{`Changed · \$\{n\(changes\.length\)\}`\}/);
  assert.match(file, />Open the previous file</);
  assert.match(file, /const changed = rows && notIn \? rows\.rows\.reduce\(\(sum, row\) => sum \+ row\.changes\.length \+ \(row\.outcome === "new" \? 1 : 0\), 0\) : null;/, "owner 2026-11-03: the Changes count is changes and new policies only; Not in this file is watched, not counted");
  assert.match(read("components/ui/stat.tsx"), /return href \? <Link href=\{href\} className=\{tileClass\}>/);

  const frame = read("components/app/book/files/file-frame.tsx");
  assert.doesNotMatch(frame, /Whole file/, "the whole file is the Rows tab's As sent action");
  assert.match(frame, /head\.fileType === "commissions" \? \["rows", "commissions", "history"\] : \["rows", "changes", "history"\]/, "a tab shows only when this file has content for it; round 4: no Overview");
  assert.match(frame, /<MoreMenu\s+items=\{more\}\s+replace=\{canReplace \? \{\s+label: "Replace with a corrected file"/);
  // Owner 2026-11-02: the file's name alone on the title line, its tabs beside it, no chip and no facts line.
  assert.doesNotMatch(frame, /chip=\{|facts=\{/);
  assert.match(frame, /lead=\{\s+<ViewTabs/);
  assert.match(read("components/app/data-in/data-in-page.tsx"), /titleInfo=\{chip\}\s+meta=\{facts\}/);
  const row = read("app/app/(shell)/carrier-files/file/[fileId]/row/[rowNumber]/page.tsx");
  // Round 5 (board 5): no More menu on a row; ‹ Row and Row › step through the file, the file is a link.
  assert.doesNotMatch(row, /<MoreMenu\b/);
  assert.match(row, />‹ Row</);
  assert.match(row, />Row ›</);
  assert.match(row, /facts=\{/);
  // One page, no tabs: What happened beside The row as sent, every column on one list.
  assert.doesNotMatch(row, /<ViewTabs\b|PagedTableCard/);
  assert.match(row, /<RowAsSent entries=\{row\.columns\.map\(asSent\)\}/);
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

test("an empty statement says it held nothing, never 'every row read' or 'lines posted' (E2E 2026-11-02)", () => {
  const empty = fileStages(facts({ fileType: "commissions", rowCount: 0 }));
  assert.equal(empty[2].note, "Read, but the file holds no rows");
  assert.equal(empty[7].note, "No commission lines in this file");
  assert.equal(fileStages(facts({ rowCount: 12 }))[2].note, "Every row read");
  // A PDF keeps its statement-total row: 1 raw row, 0 lines read (Americo's synthetic statement, E2E 2026-11-03).
  const pdf = fileStages(facts({ fileType: "commissions", rowCount: 1, parsedRows: 0, heldRows: 0 }));
  assert.equal(pdf[2].note, "Read, but the file holds no rows");
  assert.equal(pdf[7].note, "No commission lines in this file");
  assert.equal(fileStages(facts({ fileType: "commissions", rowCount: 5, parsedRows: 0, heldRows: 5 }))[2].note, "Every row read", "rows held for a status word are not an empty file");
});

test("round 4 · the stage bar shows the file type's own stages, and a file's rows are decided in place", () => {
  const policy = shownStages(fileStages(facts({ openReviews: 3 })));
  assert.deepEqual(policy.map((s) => s.name), ["Uploaded", "Layout", "Read", "Status words", "Linked", "History", "Pipeline"], "no Commissions on a policy file");
  const money = shownStages(fileStages(facts({ fileType: "commissions" })));
  assert.deepEqual(money.map((s) => s.name), ["Uploaded", "Layout", "Read", "Linked", "Commissions"]);
  // A commission file that stopped at Read shows the five it would have run, not eight.
  assert.deepEqual(shownStages(fileStages(facts({ fileType: "commissions", status: "failed", errorDetail: "off by $46.25" })), "commissions").map((s) => s.name), ["Uploaded", "Layout", "Read", "Linked", "Commissions"]);
  assert.deepEqual(shownStages(fileStages(facts({ status: "failed", errorDetail: "bad" })), "policies").map((s) => s.name), ["Uploaded", "Layout", "Read", "Status words", "Linked", "History", "Pipeline"]);
  const strip = read("components/app/book/files/stage-strip.tsx");
  assert.equal((strip.match(/shownStages\(stages, fileType\)/g) ?? []).length, 2, "the list's strip and the file's bar drop the same stages");

  const file = read("app/app/(shell)/carrier-files/file/[fileId]/page.tsx");
  assert.match(file, /\?\? "rows";/, "?tab=overview lands on the file's one page");
  assert.match(file, /<FileRowsTable\s+key=/);
  assert.match(file, /chipTitle: row\.what/, "the full sentence is the chip's tooltip, not a column repeated down the table");
  const rows = read("components/app/book/files/file-rows.tsx");
  assert.doesNotMatch(rows, /DecideInPlace|<ItemDecide/, "round 5: nothing is decided inside the table");
  assert.match(rows, /row\.reviewHref \? \(/, "a waiting row links to the Review page");
  assert.match(read("components/app/book/needs-you/review-workspace.tsx"), /\/api\/app\/needs-you\/item\?kind=/);
  const api = read("app/api/app/needs-you/item/route.ts");
  assert.match(api, /refuseNarrowInAgency\(auth\.context, "Needs you"\)/, "the same refusals as the item page");
  assert.match(api, /loadItemPage\(scope, kind, id\)/);
});
