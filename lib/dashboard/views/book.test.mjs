// Run with: node --experimental-strip-types --test lib/dashboard/views/book.test.mjs
//
// The dashboard's Book of business view (owner 2026-11-06): the shaping behind its cards. Every figure is
// counted from the rows the Policies list shows, and every link is a filter that list (or the ledger) reads.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readQuery, filterRows } from "../../ingestion/policyBook.ts";
import {
  bookStanding,
  bookTotals,
  carrierShares,
  chargedBackPolicies,
  dayIn,
  filesThisWeek,
  issuedByMonth,
  lapsedByMonth,
  monthKeys,
  monthRange,
  recentChanges,
} from "./book.ts";

const row = (over) => ({
  carrierId: "c1", carrierName: "Aetna", policyNumber: "P1", clientName: "Ann Lee", contactId: null, provisional: false, product: null,
  premiumCents: 5000, premiumMode: "monthly", annualCents: 60000, faceCents: null, status: "active", statusRaw: "Active",
  daysPastDue: null, daysLeft: null, riskBand: "none", issueDate: "2026-10-04", agentUserId: null, agentName: null, agency: null, leadSource: null,
  ...over,
});

test("monthKeys runs back across a year end, oldest first", () => {
  assert.deepEqual(monthKeys("2026-02-15", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(monthKeys("2026-11-06").length, 12);
  assert.equal(monthKeys("2026-11-06")[11], "2026-11");
});

test("monthRange is the whole month, leap days included", () => {
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(monthRange("2026-11"), { from: "2026-11-01", to: "2026-11-30" });
});

test("issued by month counts each policy in its issue month and every month is present", () => {
  const keys = ["2026-09", "2026-10", "2026-11"];
  const points = issuedByMonth([row({}), row({ issueDate: "2026-10-30" }), row({ issueDate: "2026-11-01" }), row({ issueDate: null }), row({ issueDate: "2025-01-01" })], keys);
  assert.deepEqual(points.map((p) => p.value), [0, 2, 1]);
  assert.equal(points[1].label, "Oct 2026");
});

test("a month's point opens exactly the policies the chart counted there", () => {
  const rows = [row({ policyNumber: "A", issueDate: "2026-10-01" }), row({ policyNumber: "B", issueDate: "2026-10-31" }), row({ policyNumber: "C", issueDate: "2026-11-01" })];
  const range = monthRange("2026-10");
  const { filters } = readQuery(`from=${range.from}&to=${range.to}`);
  assert.equal(filterRows(rows, filters).length, issuedByMonth(rows, ["2026-10"])[0].value);
});

test("lapsed by month counts a policy once a month, and only policies in the reader's book", () => {
  const changes = [
    { carrierId: "c1", policyNumber: "P1", toDate: "2026-10-03" },
    { carrierId: "c1", policyNumber: "P1", toDate: "2026-10-20" },
    { carrierId: "c1", policyNumber: "P2", toDate: "2026-10-05" },
    { carrierId: "c9", policyNumber: "X", toDate: "2026-10-05" },
  ];
  const points = lapsedByMonth(changes, ["2026-10", "2026-11"], new Set(["c1|P1", "c1|P2"]));
  assert.deepEqual(points.map((p) => p.value), [2, 0]);
});

test("the book's totals: in force is active or at risk, premium annualised, a missing premium adds nothing", () => {
  const totals = bookTotals([row({}), row({ status: "at_risk", annualCents: null }), row({ status: "lapsed" }), row({ status: null, source: "issued" })]);
  assert.deepEqual(totals, { all: 4, inForce: 2, annualCents: 60000, withoutPremium: 1 });
});

test("where the book stands: each row's count is what its link shows on the Policies list", () => {
  const rows = [
    row({ policyNumber: "A" }), row({ policyNumber: "B", status: "at_risk" }), row({ policyNumber: "C", status: "lapsed" }),
    row({ policyNumber: "D", status: "submitted" }), row({ policyNumber: "E", status: null, source: "issued" }),
  ];
  const standing = bookStanding(rows, null, null);
  assert.deepEqual(standing.map((s) => s.key), ["inforce", "submitted", "awaiting", "lapsed"]);
  for (const entry of standing.filter((s) => s.key !== "inforce")) {
    const { filters } = readQuery(entry.href.split("?")[1]);
    assert.equal(filterRows(rows, filters).length, entry.count, entry.key);
  }
  assert.equal(standing[0].count, 2);
  assert.equal(standing[0].href, "/app/policies?show=inforce");
});

test("charged back is shown only when the ledger was read, and opens its chargeback lines", () => {
  const rows = [row({ policyNumber: "A" }), row({ policyNumber: "B", status: "lapsed", annualCents: 12000 })];
  const standing = bookStanding(rows, new Set(["c1|B"]), "/app/ledger");
  const charged = standing.find((s) => s.key === "chargedback");
  assert.deepEqual(charged, { key: "chargedback", label: "Charged back", count: 1, annualCents: 12000, href: "/app/ledger?type=chargeback" });
  assert.equal(bookStanding(rows, null, "/app/ledger").some((s) => s.key === "chargedback"), false);
});

test("a chargeback reversed in full is not a charged-back policy", () => {
  const set = chargedBackPolicies([
    { carrierId: "c1", policyNumber: "A", entryType: "chargeback", correctsType: null, amountCents: -500 },
    { carrierId: "c1", policyNumber: "B", entryType: "chargeback", correctsType: null, amountCents: -500 },
    { carrierId: "c1", policyNumber: "B", entryType: "reversal", correctsType: "chargeback", amountCents: 500 },
    { carrierId: "c1", policyNumber: "C", entryType: "advance", correctsType: null, amountCents: -900 },
  ]);
  assert.deepEqual([...set], ["c1|A"]);
});

test("carrier shares: in force only, biggest first, the rest as Other, each opening that carrier in force", () => {
  const rows = [
    row({ carrierId: "a", carrierName: "A", annualCents: 100 }), row({ carrierId: "b", carrierName: "B", annualCents: 300 }),
    row({ carrierId: "c", carrierName: "C", annualCents: 50 }), row({ carrierId: "d", carrierName: "D", annualCents: 999, status: "lapsed" }),
  ];
  const money = carrierShares(rows, true, 2);
  assert.deepEqual(money.map((s) => [s.key, s.value]), [["b", 300], ["a", 100], ["other", 50]]);
  assert.equal(money[0].href, "/app/policies?show=inforce&carrier=b");
  const counts = carrierShares(rows, false, 5);
  assert.deepEqual(counts.map((s) => s.value), [1, 1, 1]);
  assert.equal(carrierShares([row({ carrierId: "hand:acme" })], false)[0].href, "/app/policies?show=inforce&carrier=hand%3Aacme");
});

test("recent changes: issued, lapsed, other status moves and a draft date moved back; payments are not news", () => {
  const base = { carrierId: "c1", carrierName: "Aetna", policyNumber: "P1", toDate: "2026-11-04" };
  const items = recentChanges([
    { ...base, id: "1", fieldName: "status_normalized", oldValue: "approved_unpaid", newValue: "active" },
    { ...base, id: "2", fieldName: "paid_to_date", oldValue: "2026-10-01", newValue: "2026-11-01" },
    { ...base, id: "3", fieldName: "status_normalized", oldValue: "active", newValue: "lapsed" },
    { ...base, id: "4", fieldName: "paid_to_date", oldValue: "2026-11-01", newValue: "2026-10-01" },
    { ...base, id: "5", fieldName: "status_normalized", oldValue: "active", newValue: "at_risk" },
    { ...base, id: "6", fieldName: "premium_cents", oldValue: "100", newValue: "200" },
  ], new Map([["c1|P1", "Ann Lee"]]));
  assert.deepEqual(items.map((i) => [i.key, i.kind]), [["1", "issued"], ["3", "lapsed"], ["4", "draft"], ["5", "status"]]);
  assert.equal(items[0].title, "Ann Lee");
  assert.equal(items[0].when, "Nov 4");
  assert.equal(items[0].href, "/app/policies/carrier/c1/P1?tab=history");
  assert.match(items[3].detail, /At risk/);
  assert.equal(recentChanges([{ ...base, id: "9", fieldName: "status_normalized", oldValue: "active", newValue: "lapsed" }], new Map())[0].title, "Policy P1");
});

test("this week's files: newest first, the last seven days, replaced files left out", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const file = (id, receivedAt, status = "parsed") => ({ id, carrierName: "Aetna", fileType: "policies", fileDate: null, originalFilename: `${id}.csv`, status, receivedAt });
  const week = filesThisWeek([file("old", "2026-10-29T11:00:00Z"), file("a", "2026-11-01T09:00:00Z"), file("b", "2026-11-05T09:00:00Z"), file("gone", "2026-11-05T10:00:00Z", "superseded")], now);
  assert.deepEqual(week.map((f) => f.id), ["b", "a"]);
});

test("the agency's day follows its zone", () => {
  const now = Date.parse("2026-11-07T03:00:00Z");
  assert.equal(dayIn("America/Chicago", now), "2026-11-06");
  assert.equal(dayIn("UTC", now), "2026-11-07");
  assert.equal(dayIn("Not/AZone", now), "2026-11-07");
});
