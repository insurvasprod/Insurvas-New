// LA-4.8 · persistency: month boundaries, cohorts too young to count, and small groups.
import test from "node:test";
import assert from "node:assert/strict";

const { judge, computePersistency, MIN_COHORT, TARGET_RATE } = await import("./compute.ts");

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
