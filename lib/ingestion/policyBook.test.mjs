// LA-4.11 (Notion sprint) · the policy list and detail page: filters, sort, totals, CSV, timeline.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { changeLabel, changeValue, csvRows, CSV_HEADER, DEFAULT_SORT, EMPTY_FILTERS, filterRows, mergeTimeline, NONE, readQuery, sortRows, toCsv, totals, writeQuery } from "./policyBook.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const base = { carrierId: "c-am", carrierName: "Americo", contactId: null, provisional: false, product: "FE", premiumCents: 5000, premiumMode: "monthly", annualCents: 60000, faceCents: 1000000, status: "active", statusRaw: "Active", daysPastDue: 0, daysLeft: null, riskBand: "none", issueDate: "2026-06-01", agentUserId: "u1", agentName: "Devin", agency: null, leadSource: null };
const rows = [
  { ...base, policyNumber: "A1", clientName: "Avery" },
  { ...base, policyNumber: "A2", clientName: "Blake", riskBand: "at_risk", daysLeft: 9, status: "at_risk", daysPastDue: 12 },
  { ...base, policyNumber: "A3", clientName: "Casey", riskBand: "at_risk", daysLeft: 2, status: "at_risk", daysPastDue: 40 },
  { ...base, carrierId: "c-moo", carrierName: "Mutual of Omaha", policyNumber: "M1", clientName: null, annualCents: null, premiumCents: null, agentUserId: null, agentName: null, issueDate: null },
  { ...base, carrierId: "c-moo", carrierName: "Mutual of Omaha", policyNumber: "M2", clientName: "Drew", riskBand: "critical", daysLeft: 0, annualCents: 120000 },
];

test("filters: by carrier, by a missing value, by issue date and by search, and the totals follow", () => {
  const moo = filterRows(rows, { ...EMPTY_FILTERS, carrier: "c-moo" });
  assert.deepEqual(moo.map((r) => r.policyNumber), ["M1", "M2"]);
  assert.deepEqual(totals(moo), { count: 2, annualCents: 120000, monthlyCents: 10000, withoutPremium: 1, atRisk: 1 });
  assert.deepEqual(filterRows(rows, { ...EMPTY_FILTERS, agent: NONE }).map((r) => r.policyNumber), ["M1"]);
  assert.deepEqual(filterRows(rows, { ...EMPTY_FILTERS, issuedFrom: "2026-01-01" }).length, 4, "no issue date is outside a date filter");
  assert.deepEqual(filterRows(rows, { ...EMPTY_FILTERS, q: "case" }).map((r) => r.policyNumber), ["A3"]);
  assert.equal(totals(rows).annualCents, 60000 * 3 + 120000);
});

test("sort: risk first, closest to closing first within a band, missing values last either way", () => {
  assert.deepEqual(sortRows(rows, DEFAULT_SORT).map((r) => r.policyNumber), ["M2", "A3", "A2", "A1", "M1"]);
  assert.equal(sortRows(rows, { key: "premium", dir: "asc" }).at(-1).policyNumber, "M1");
  assert.equal(sortRows(rows, { key: "premium", dir: "desc" }).at(-1).policyNumber, "M1");
  assert.deepEqual(sortRows(rows, { key: "client", dir: "asc" }).map((r) => r.clientName), ["Avery", "Blake", "Casey", "Drew", null]);
});

test("the query string round-trips, drops what it doesn't know, and is what a saved filter stores", () => {
  const state = { filters: { ...EMPTY_FILTERS, carrier: "c-am", risk: "at_risk", issuedFrom: "2026-01-01" }, sort: { key: "premium", dir: "asc" } };
  const query = writeQuery(state.filters, state.sort);
  assert.equal(query, "carrier=c-am&risk=at_risk&from=2026-01-01&sort=premium&dir=asc");
  assert.deepEqual(readQuery(query), state);
  assert.deepEqual(readQuery("?sort=drop+table&from=yesterday&evil=1"), { filters: EMPTY_FILTERS, sort: DEFAULT_SORT });
  assert.equal(writeQuery(EMPTY_FILTERS, DEFAULT_SORT), "");
});

test("the CSV is the on-screen rows in on-screen order, and a formula in carrier data is defused", () => {
  const shown = sortRows(filterRows(rows, { ...EMPTY_FILTERS, carrier: "c-am" }), { key: "client", dir: "desc" });
  const lines = toCsv(CSV_HEADER, csvRows(shown)).split("\r\n");
  assert.equal(lines.length, 1 + shown.length);
  assert.deepEqual(lines.slice(1).map((line) => line.split(",")[0]), ["Casey", "Blake", "Avery"]);
  const hostile = toCsv(["x"], [["=HYPERLINK(\"http://x\")"], ["+1"], ["-2"], ["@a"], ["plain, with comma"], [42]]);
  assert.deepEqual(hostile.split("\r\n").slice(1), ["\"'=HYPERLINK(\"\"http://x\"\")\"", "'+1", "'-2", "'@a", "\"plain, with comma\"", "42"]);
});

test("the timeline merges every source in date order, sale before carrier before change on one day", () => {
  const merged = mergeTimeline([
    { date: "2026-09-05", kind: "change", label: "Paid-to moved" },
    { date: "2026-06-01T10:00:00Z", kind: "carrier", label: "Effective" },
    { date: "2026-06-01", kind: "sale", label: "Submitted" },
    { date: "not a date", kind: "sale", label: "dropped" },
    { date: "2026-07-10", kind: "money", label: "Advance" },
  ]);
  assert.deepEqual(merged.map((item) => item.label), ["Submitted", "Effective", "Advance", "Paid-to moved"]);
  assert.equal(changeLabel({ field: "paid_to_date", oldValue: "2026-09-01", newValue: "2026-10-01" }), "Payment credited: paid-to date moved forward");
  assert.equal(changeLabel({ field: "status_normalized", oldValue: "active", newValue: "lapsed" }), "Status changed to Lapsed");
});

test("the store never writes carrier data, scopes producers to their own policies, and the migration revokes truncate", () => {
  const store = read("lib/ingestion/policyBookStore.ts");
  assert.doesNotMatch(store, /from\("policy_(current|snapshot|change)"\)\.(insert|update|upsert|delete)/);
  assert.match(store, /role === "producer"/);
  const sql = read("supabase/migrations/20261008210000_la_4_11_policy_book.sql");
  assert.match(sql, /revoke truncate on public\.policy_saved_filter, public\.policy_annotation from service_role, tenant_app/);
});

test("a policy that is not in force has no risk: \"Low\" never includes a lapsed one", () => {
  const book = [{ ...base, policyNumber: "L1", clientName: "Lapsed", status: "lapsed", riskBand: "none" }, { ...base, policyNumber: "A1", clientName: "Avery" }];
  assert.deepEqual(filterRows(book, { ...EMPTY_FILTERS, risk: "none" }).map((r) => r.policyNumber), ["A1"]);
  assert.equal(csvRows(book)[0][11], "");
});
test("changed dates read as dates, without Intl's server-only spelling", () => {
  assert.equal(changeValue("paid_to_date", "2026-09-01"), "Sep 1, 2026");
  assert.equal(changeValue("premium_cents", "6100"), "$61.00");
  assert.equal(changeValue("status_normalized", "at_risk"), "At risk");
  assert.equal(changeValue("termination_date", null), "none");
});
test("5,000 policies filter, sort and total well inside a second", () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({ ...base, policyNumber: `P${i}`, clientName: `Client ${i % 997}`, carrierId: i % 3 ? "c-am" : "c-moo", carrierName: i % 3 ? "Americo" : "Mutual of Omaha", annualCents: (i % 50) * 1200, riskBand: ["none", "watch", "at_risk", "critical"][i % 4], daysLeft: i % 30 }));
  const started = performance.now();
  for (const sort of [{ key: "risk", dir: "desc" }, { key: "client", dir: "asc" }, { key: "premium", dir: "desc" }]) {
    const shown = sortRows(filterRows(big, { ...EMPTY_FILTERS, carrier: "c-am", q: "client 1" }), sort);
    totals(shown);
    toCsv(CSV_HEADER, csvRows(shown));
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `took ${Math.round(elapsed)} ms`);
});