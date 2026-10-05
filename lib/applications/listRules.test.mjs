// LA-3.5 / 3.15 / 3.18 / 3.26 list rules — each assertion is an acceptance line.
import test from "node:test";
import assert from "node:assert/strict";

const { missingNumber, ageingFor, byRisk, delta, deltaText, expiryCountdown, summarise, quoteOutcome, wholeDaysSince, shortPersonName, waitingOnText } = await import("./listRules.ts");

test("3.15: submitted with no reference is on Missing reference until filled; issued with no policy number too", () => {
  assert.equal(missingNumber({ status: "submitted", outcome: null, reference: null, policyNumber: null }), "reference");
  assert.equal(missingNumber({ status: "pending_carrier", outcome: null, reference: "  ", policyNumber: null }), "reference");
  assert.equal(missingNumber({ status: "counteroffer_pending", outcome: null, reference: "APP-1", policyNumber: null }), null);
  assert.equal(missingNumber({ status: "closed", outcome: "issued", reference: "APP-1", policyNumber: null }), "policy_number");
  assert.equal(missingNumber({ status: "closed", outcome: "issued", reference: "APP-1", policyNumber: "POL-9" }), null);
  // A draft or a decline is not waiting for a number.
  assert.equal(missingNumber({ status: "draft", outcome: null, reference: null, policyNumber: null }), null);
  assert.equal(missingNumber({ status: "closed", outcome: "declined", reference: null, policyNumber: null }), null);
});

test("3.18: ageing is amber at N days and red at 2N, and N is the tenant's", () => {
  assert.equal(ageingFor(4, 5), "ok");
  assert.equal(ageingFor(5, 5), "amber");
  assert.equal(ageingFor(9, 5), "amber");
  assert.equal(ageingFor(10, 5), "red");
  assert.equal(ageingFor(3, 3), "amber");
  assert.equal(ageingFor(6, 3), "red");
  // Counted from the day the carrier raised it (a date, calendar days).
  assert.equal(wholeDaysSince("2026-09-19", Date.parse("2026-09-29T23:30:00Z")), 10);
});

test("3.18: pending cases sort waiting on the client first, then the oldest raised", () => {
  const rows = [
    { clientName: "A", waitingOn: "carrier", raisedAt: "2026-09-01", daysOpen: 28 },
    { clientName: "B", waitingOn: "client", raisedAt: "2026-09-20", daysOpen: 9 },
    { clientName: "C", waitingOn: "client", raisedAt: "2026-09-10", daysOpen: 19 },
    { clientName: "D", waitingOn: "third_party", raisedAt: "2026-08-30", daysOpen: 30 },
  ];
  assert.deepEqual([...rows].sort(byRisk).map((r) => r.clientName), ["C", "B", "D", "A"]);
});

test("3.26: the delta shows the difference in dollars and percent with no agent arithmetic", () => {
  assert.deepEqual(delta(1_500_000, 1_000_000), { cents: -500_000, pct: -33.3 });
  assert.deepEqual(delta(1_000_000, 750_000), { cents: -250_000, pct: -25 });
  assert.equal(deltaText(1_500_000, 1_000_000, true), "−$5,000 · −33.3%");
  assert.equal(deltaText(7_420, 9_150), "+$17.30 · +23.3%");
  assert.equal(deltaText(6_840, 6_840), "No change");
});

test("3.26: an expiring counteroffer shows a countdown before expires_at", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  assert.deepEqual(expiryCountdown("2026-09-30T11:00:00Z", now), { tone: "danger", label: "in 23 hours", expired: false });
  assert.deepEqual(expiryCountdown("2026-10-03T12:00:00Z", now), { tone: "warning", label: "in 4 days", expired: false });
  assert.deepEqual(expiryCountdown("2026-10-10T12:00:00Z", now), { tone: "neutral", label: "in 11 days", expired: false });
  assert.equal(expiryCountdown("2026-09-29T11:59:00Z", now).label, "Expired");
  assert.equal(expiryCountdown(null, now), null);
});

test("dashboard summary: awaiting, waiting on client / overdue, counteroffers expiring inside 5 days", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const req = (waitingOn, daysOpen) => ({ waitingOn, daysOpen });
  const s = summarise({
    requirements: [req("client", 2), req("client", 11), req("carrier", 12), req("agent", 1)],
    counteroffers: [
      { status: "pending_client", expiresAt: "2026-10-01T00:00:00Z" },
      { status: "pending_client", expiresAt: "2026-10-20T00:00:00Z" },
      { status: "pending_client", expiresAt: null },
    ],
    awaiting: [{ missing: "reference" }, { missing: "reference" }, { missing: "policy_number" }],
    ageingDays: 5,
    now,
  });
  assert.deepEqual(s.awaitingPolicyNumber, { count: 3, missingReference: 2, missingPolicyNumber: 1 });
  assert.deepEqual(s.waitingOnClient, { count: 2, overdue: 2, overdueAfterDays: 10 });
  assert.equal(s.counteroffersExpiring.count, 1);
  assert.equal(s.counteroffersExpiring.soonestExpiresAt, "2026-10-01T00:00:00Z");
});

test("3.5: every quote keeps its outcome; a selected quote on a declined attempt that was retried is superseded", () => {
  assert.equal(quoteOutcome("discarded", null), "discarded");
  assert.equal(quoteOutcome("selected", { status: "submitted", outcome: null, followedByNewAttempt: false }), "selected");
  assert.equal(quoteOutcome("selected", { status: "closed", outcome: "declined", followedByNewAttempt: true }), "superseded");
  assert.equal(quoteOutcome("selected", { status: "closed", outcome: "issued", followedByNewAttempt: true }), "selected");
});

test("board copy helpers", () => {
  assert.equal(shortPersonName("Priya Sharma"), "Priya S.");
  assert.equal(shortPersonName(""), null);
  assert.equal(waitingOnText({ waitingOn: "client" }), "The client");
  assert.equal(waitingOnText({ waitingOn: "third_party", examVendor: "ExamOne" }), "ExamOne");
});
