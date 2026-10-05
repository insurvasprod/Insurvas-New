// LA-4.4 · the discrepancy engine: every kind, and the guards that keep it from crying wolf.
import test from "node:test";
import assert from "node:assert/strict";

const { computeDiscrepancies, owedSummary, NEVER_PAID_GRACE_DAYS } = await import("./compute.ts");

const TODAY = "2026-10-02";
const policy = (id, extra = {}) => ({ id, policyNumber: `MO-${id}`, insuredName: `Insured ${id}`, carrierId: "mo", carrierName: "Mutual of Omaha", status: "active", effectiveDate: "2026-06-01", ...extra });
const expected = (id, policyId, amountCents, postedOn, extra = {}) => ({ id, policyId, kind: "commission", amountCents, postedOn, rateBp: 10_000, premiumCents: 100_000, ...extra });
const received = (id, policyId, amountCents, extra = {}) => ({ id, policyId, statementId: "s-aug", carrierId: "mo", kind: "commission", amountCents, postedOn: "2026-08-31", periodStart: "2026-08-01", periodEnd: "2026-08-31", rateBp: null, premiumCents: null, ...extra });
const covered = (statementId = "s-aug", periodStart = "2026-08-01", periodEnd = "2026-08-31", carrierId = "mo") => ({ statementId, carrierId, periodStart, periodEnd });

test("never paid: in force past the grace, the carrier's statements cover the period, and no line pays it", () => {
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:advance", "p1", 54_000, "2026-06-01", { kind: "advance" })],
    received: [],
    coverage: [covered("s-jul", "2026-07-01", "2026-07-31")],
    today: TODAY,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "never_paid");
  assert.equal(found[0].owedCents, 54_000);
  assert.deepEqual(found[0].detail.expectedEntryIds, ["p1:advance"]);
  assert.match(found[0].detail.explanation, /One statement from Mutual of Omaha covers the time this payment was due, to 2026-07-31, and none pays this policy/);
  assert.equal(found[0].fingerprint, "never_paid|p1");
});

test("never paid claims only what fell due while a statement was reporting", () => {
  // Issued July 2025; the only statement covers May–July 2026. The 2025 advance and year-1
  // commission may be on a 2025 statement nobody imported; only the July 2026 renewal is evidence.
  const found = computeDiscrepancies({
    policies: [policy("p1", { effectiveDate: "2025-07-24" })],
    expected: [
      expected("p1:advance", "p1", 85_860, "2025-07-24", { kind: "advance" }),
      expected("p1:1", "p1", 14_310, "2025-07-24"),
      expected("p1:2", "p1", 14_310, "2026-07-24"),
    ],
    received: [],
    coverage: [covered("s-q2", "2026-05-01", "2026-07-31")],
    today: TODAY,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].owedCents, 14_310);
  assert.deepEqual(found[0].detail.expectedEntryIds, ["p1:2"]);
  // A statement that ends before anything fell due, alone, is no evidence at all.
  assert.equal(computeDiscrepancies({
    policies: [policy("p1", { effectiveDate: "2025-07-24" })],
    expected: [expected("p1:advance", "p1", 85_860, "2025-07-24", { kind: "advance" })],
    received: [],
    coverage: [covered("s-q2", "2026-05-01", "2026-07-31")],
    today: TODAY,
  }).length, 0);
});

test("never paid is not claimed without coverage, inside the grace, for another carrier's statements, or for a pending policy", () => {
  const base = { expected: [expected("e", "p1", 54_000, "2026-06-01")], received: [], today: TODAY };
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1")], coverage: [] }).length, 0, "no statement is not no payment");
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1", { effectiveDate: "2026-09-20" })], coverage: [covered("s-sep", "2026-09-01", "2026-09-30")] }).length, 0, `still inside the ${NEVER_PAID_GRACE_DAYS}-day grace`);
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1")], coverage: [covered("s", "2026-08-01", "2026-08-31", "americo")] }).length, 0, "another carrier's statement says nothing about this one");
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1", { status: "pending" })], coverage: [covered()] }).length, 0);
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1", { status: "lapsed" })], coverage: [covered()] }).length, 0, "a lapsed policy is not owed new commission");
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1", { effectiveDate: "2026-06-01" })], coverage: [covered("s-jun", "2026-06-01", "2026-06-30")] }).length, 0, "a statement that ends before the grace is not evidence");
});

test("short-paid: less than the contract expects for the periods reported, at the right rate", () => {
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:2", "p1", 50_000, "2026-08-15")],
    received: [received("l1", "p1", 30_000, { rateBp: 10_000 })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "short_paid");
  assert.equal(found[0].owedCents, 20_000);
  assert.equal(found[0].detail.expectedCents, 50_000);
  assert.equal(found[0].detail.receivedCents, 30_000);
});

test("paid at the wrong rate: short, and the rate paid is not the schedule's", () => {
  const byColumn = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:2", "p1", 110_000, "2026-08-15", { rateBp: 11_000 })],
    received: [received("l1", "p1", 100_000, { rateBp: 10_000 })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(byColumn[0].kind, "mis_rated");
  assert.equal(byColumn[0].owedCents, 10_000);
  assert.equal(byColumn[0].detail.paidRateBp, 10_000);
  assert.equal(byColumn[0].detail.expectedRateBp, 11_000);
  assert.match(byColumn[0].detail.explanation, /Paid at 100%; your contract's schedule is 110%/);
  // Without a rate column, commission ÷ premium is the rate paid.
  const byPremium = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:2", "p1", 110_000, "2026-08-15", { rateBp: 11_000 })],
    received: [received("l1", "p1", 100_000, { premiumCents: 100_000 })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(byPremium[0].kind, "mis_rated");
});

test("paid in full, or within the rounding tolerance, is not a discrepancy", () => {
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:2", "p1", 50_000, "2026-08-15")],
    received: [received("l1", "p1", 49_950)],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(found.length, 0);
});

test("an unexpected chargeback: taken back from a policy the book has in force", () => {
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:advance", "p1", 54_000, "2026-06-01", { kind: "advance" })],
    received: [received("adv", "p1", 54_000, { kind: "advance", periodStart: "2026-06-01", periodEnd: "2026-06-30", postedOn: "2026-06-30" }), received("cb", "p1", -54_000, { kind: "chargeback" })],
    coverage: [covered()],
    today: TODAY,
  });
  const unexpected = found.find((item) => item.kind === "unexpected_chargeback");
  assert.ok(unexpected);
  assert.equal(unexpected.owedCents, 54_000);
  assert.deepEqual(unexpected.detail.receivedLineIds, ["cb"]);
});

test("a lapsed policy's chargeback is expected; charging it back twice is a duplicate", () => {
  const lapsed = policy("p1", { status: "lapsed" });
  const advance = received("adv", "p1", 54_000, { kind: "advance", periodStart: "2026-06-01", periodEnd: "2026-06-30", postedOn: "2026-06-30" });
  const once = computeDiscrepancies({
    policies: [lapsed],
    expected: [expected("p1:cb", "p1", -54_000, "2026-08-10", { kind: "chargeback" })],
    received: [advance, received("cb1", "p1", -54_000, { kind: "chargeback" })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(once.filter((item) => item.kind.endsWith("chargeback")).length, 0, "one chargeback for one lapse is right");
  const twice = computeDiscrepancies({
    policies: [lapsed],
    expected: [expected("p1:cb", "p1", -54_000, "2026-08-10", { kind: "chargeback" })],
    received: [advance, received("cb1", "p1", -54_000, { kind: "chargeback" }), received("cb2", "p1", -54_000, { kind: "chargeback", statementId: "s-sep", periodStart: "2026-09-01", periodEnd: "2026-09-30" })],
    coverage: [covered()],
    today: TODAY,
  });
  const duplicate = twice.find((item) => item.kind === "duplicate_chargeback");
  assert.ok(duplicate);
  assert.equal(duplicate.owedCents, 54_000);
  assert.equal(duplicate.detail.allowedCents, 54_000);
  assert.equal(duplicate.detail.takenCents, 108_000);
  assert.deepEqual(duplicate.detail.statementIds.sort(), ["s-aug", "s-sep"]);
});

test("the same facts give the same fingerprints, and the summary adds them up", () => {
  const args = {
    policies: [policy("p1"), policy("p2")],
    expected: [expected("p1:a", "p1", 54_000, "2026-06-01", { kind: "advance" }), expected("p2:2", "p2", 50_000, "2026-08-15")],
    received: [received("l2", "p2", 30_000)],
    coverage: [covered("s-jul", "2026-07-01", "2026-07-31"), covered()],
    today: TODAY,
  };
  const first = computeDiscrepancies(args).map((item) => item.fingerprint);
  const again = computeDiscrepancies(args).map((item) => item.fingerprint);
  assert.deepEqual(first, again);
  const summary = owedSummary(computeDiscrepancies(args));
  assert.equal(summary.totalCents, 54_000 + 20_000);
  assert.equal(summary.byKind.never_paid.cents, 54_000);
  assert.equal(summary.byKind.short_paid.count, 1);
});
