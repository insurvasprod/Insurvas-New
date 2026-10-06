// LA-4.8 · persistency: month boundaries, cohorts too young to count, and small groups.
import test from "node:test";
import assert from "node:assert/strict";

const { judge, computePersistency, issueCohort, MIN_COHORT, TARGET_RATE } = await import("./compute.ts");
import { readFileSync } from "node:fs";

const p = (id, effectiveDate, status = "active", endedOn = null, extra = {}) => ({ id, status, effectiveDate, endedOn, carrier: "Americo", leadSource: "Apex", ...extra });

test("a lapse on the checkpoint day did not make it; the day after did", () => {
  const today = "2026-12-31";
  assert.deepEqual(judge(p("a", "2026-01-15", "lapsed", "2026-04-15"), 3, today), { eligible: true, alive: false });
  assert.deepEqual(judge(p("b", "2026-01-15", "lapsed", "2026-04-16"), 3, today), { eligible: true, alive: true });
  assert.deepEqual(judge(p("c", "2026-01-15", "lapsed", "2026-04-14T09:00:00Z"), 3, today), { eligible: true, alive: false }, "a timestamp is read by its date");
});

test("months clamp to the month's end, as the ledger dates them", () => {
  // 31 Jan + 1 month is 28 Feb (2026 is not a leap year): a lapse on 1 Mar survived month 1.
  assert.equal(judge(p("a", "2026-01-31", "lapsed", "2026-03-01"), 1, "2026-12-31").alive, true);
  assert.equal(judge(p("b", "2026-01-31", "lapsed", "2026-02-28"), 1, "2026-12-31").alive, false);
});

test("a cohort too young to count is left out, never counted as alive; pending is never issued", () => {
  assert.deepEqual(judge(p("a", "2026-08-01"), 3, "2026-10-02"), { eligible: false, alive: false });
  assert.deepEqual(judge(p("b", "2026-01-01", "pending"), 3, "2026-10-02"), { eligible: false, alive: false });
});

test("rates by carrier and lead source, with fewer than the minimum showing no rate", () => {
  const today = "2026-12-31";
  const book = [
    ...Array.from({ length: 6 }, (_, i) => p(`a${i}`, "2026-01-10", i < 2 ? "lapsed" : "active", i < 2 ? "2026-05-01" : null)),
    ...Array.from({ length: 3 }, (_, i) => p(`v${i}`, "2026-01-10", "active", null, { carrier: "Mutual of Omaha", leadSource: "Vertex" })),
    p("pending", "2026-01-10", "pending"),
  ];
  const report = computePersistency(book, today);
  assert.equal(report.policies, 9, "pending is not in the book's persistency");
  const m3 = report.overall.find((cell) => cell.month === 3);
  assert.equal(m3.eligible, 9);
  assert.equal(m3.alive, 9, "both lapses came after month 3");
  const m6 = report.overall.find((cell) => cell.month === 6);
  assert.equal(m6.alive, 7);
  const americo = report.byCarrier.find((row) => row.label === "Americo");
  assert.equal(americo.cells.find((cell) => cell.month === 6).rate, 4 / 6);
  const omaha = report.byCarrier.find((row) => row.label === "Mutual of Omaha");
  assert.ok(3 < MIN_COHORT);
  assert.equal(omaha.cells[0].rate, null, "three policies do not make a rate");
  assert.equal(report.byLeadSource.map((row) => row.label).join(","), "Apex,Vertex");
  assert.equal(report.target.month, 9);
  assert.equal(report.target.rate, 7 / 9);
  assert.equal(report.target.below, 7 / 9 < TARGET_RATE);
});

// ── by issue cohort (LA-4.8: "by issue cohort, carrier and lead source") ────────────

test("a policy's issue cohort is the calendar quarter it was issued in", () => {
  assert.deepEqual(issueCohort("2026-01-01"), { key: "2026-Q1", label: "2026 Q1" });
  assert.deepEqual(issueCohort("2026-03-31"), { key: "2026-Q1", label: "2026 Q1" });
  assert.deepEqual(issueCohort("2026-04-01"), { key: "2026-Q2", label: "2026 Q2" });
  assert.deepEqual(issueCohort("2025-12-31T23:00:00Z"), { key: "2025-Q4", label: "2025 Q4" }, "a timestamp is read by its date");
});

test("the cohort table has one row per quarter, newest first, judged like every other table", () => {
  const today = "2026-12-31";
  const q1 = Array.from({ length: 6 }, (_, i) => p(`a${i}`, "2026-02-10", i < 2 ? "lapsed" : "active", i < 2 ? "2026-04-01" : null));
  const q3 = [p("b1", "2026-08-01"), p("b2", "2026-08-02", "pending")];
  const lastYear = Array.from({ length: 5 }, (_, i) => p(`c${i}`, "2025-11-05"));
  const report = computePersistency([...q1, ...q3, ...lastYear], today);
  assert.deepEqual(report.byCohort.map((row) => [row.label, row.policies]), [["2026 Q3", 1], ["2026 Q1", 6], ["2025 Q4", 5]], "newest first, pending never issued");
  const q1Month3 = report.byCohort.find((row) => row.key === "2026-Q1").cells.find((cell) => cell.month === 3);
  assert.deepEqual([q1Month3.eligible, q1Month3.alive], [6, 4], "the two that lapsed in month 2 did not make month 3");
  assert.equal(q1Month3.rate, 4 / 6);
  const q3Month3 = report.byCohort.find((row) => row.key === "2026-Q3").cells.find((cell) => cell.month === 3);
  assert.equal(q3Month3.rate, null, "one policy is not a rate");
  // Every policy is in exactly one cohort, as in exactly one carrier and one lead source.
  const total = (rows) => rows.reduce((sum, row) => sum + row.policies, 0);
  assert.equal(total(report.byCohort), report.policies);
  assert.equal(total(report.byCarrier), report.policies);
});

test("under the minimum a cell shows the dash alone; the counts are only in its title", () => {
  const table = readFileSync(new URL("../../components/app/persistency-tables.tsx", import.meta.url), "utf8");
  assert.match(table, /if \(!cell \|\| cell\.rate === null\) return <span className="text-muted-foreground" title=\{title\} aria-label=\{title\}>—<\/span>;/);
  assert.match(table, /a rate needs \$\{MIN_COHORT\} policies/);
  assert.match(table, /<DataToolbar actions=\{<>[\s\S]*?<RefreshButton[\s\S]*?<ToolbarSearch/, "the standard toolbar: search, then Refresh last");
  assert.match(table, /footer=\{visible\.length > 0 \? <Pager /, "the shared pager");
  const page = readFileSync(new URL("../../app/app/(shell)/persistency/page.tsx", import.meta.url), "utf8");
  for (const key of ["cohort", "carrier", "source"]) assert.ok(page.includes(`{ key: "${key}"`), `the ${key} breakdown`);
  // A server page can render a client component but never call a client function (the shared
  // formatter lives in compute.ts; calling it from the client file crashed the page).
  assert.match(page, /import \{ PersistencyTable \} from "@\/components\/app\/persistency-tables";/, "only the component crosses from the client file");
  assert.match(page, /persistencyPct \} from "@\/lib\/persistency\/compute";/);
});

test("lead sources: a failed read is said, never passed off as 'Unattributed', and numbers match as statements match", () => {
  const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(service, /\.catch\(\(\) => \[\]\)/, "no read error is swallowed into an empty table");
  assert.match(service, /if \(isSchemaGap\(error\)\) return \{ rows: \[\], failed: false \};/, "a table not there yet is honestly empty");
  assert.match(service, /return \{ rows: \[\], failed: true \};/);
  assert.match(service, /leadSourcesUnavailable: unavailable/);
  assert.match(service, /const sourceKey = \(policyNumber: string\) => normalisePolicyNumber\(policyNumber\);/, "MO-1001 and mo 1001 are one policy, as on a statement");
  assert.doesNotMatch(service, /trim\(\)\.toUpperCase\(\)/);
  const page = readFileSync(new URL("../../app/app/(shell)/persistency/page.tsx", import.meta.url), "utf8");
  assert.match(page, /report\.leadSourcesUnavailable && \([\s\S]*?Lead sources could not be read just now/);
});
