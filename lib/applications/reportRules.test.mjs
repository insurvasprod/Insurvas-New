// LA-3.21 (and 3.24's "each application counts once") — the report against a hand count.
import test from "node:test";
import assert from "node:assert/strict";

const { buildSalesReport, crossCell, median, defaultWindow } = await import("./reportRules.ts");
const { sampleReportInput } = await import("./reportFixtures.ts");

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";

function attempt(id, over = {}) {
  return {
    id, caseId: "case-1", leadId: "lead-1", insuredRole: "primary", attemptNo: 1, carrierId: C1, productCode: "final_expense", quoteId: `q-${id}`,
    status: "submitted", outcome: null, outcomeReasonCode: null, createdBy: "u1", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-02T10:00:00Z",
    submittedAt: "2026-09-02T10:00:00Z", outcomeRecordedAt: null, ...over,
  };
}
function quote(id, over = {}) {
  return { id, caseId: "case-1", leadId: "lead-1", insuredRole: "primary", carrierId: C1, productCode: "final_expense", monthlyPremiumCents: 6_840, createdBy: "u1", createdAt: "2026-09-01T09:00:00Z", ...over };
}

/**
 * The hand count:
 *   case-1 (inbound): Rita, attempt 1 at C1 declined (medication), attempt 2 at C2 issued. Her spouse
 *     Tom, one attempt at C1, submitted and still pending.
 *   case-2 (outbound, campaign X): Ann, quoted at C2, withdrawn draft — never submitted.
 *   case-3 (outbound): Bea, attempt at C1 counteroffered, client refused (declined_by_client).
 *   case-4: Cal, quoted in August — outside the window.
 */
function input() {
  return {
    timeZone: "UTC",
    carriers: [{ id: C1, name: "Mutual of Omaha" }, { id: C2, name: "Gerber Life" }],
    products: [{ code: "final_expense", label: "Final Expense" }],
    campaigns: [{ id: "cmp-x", name: "TX aged" }],
    producers: [{ id: "u1", name: "Priya Sharma" }, { id: "u2", name: "Rinor G" }],
    cases: [
      { id: "case-1", source: "inbound", campaignId: null },
      { id: "case-2", source: "outbound", campaignId: "cmp-x" },
      { id: "case-3", source: "outbound", campaignId: null },
      { id: "case-4", source: "outbound", campaignId: null },
    ],
    attempts: [
      attempt("a1", { status: "closed", outcome: "declined", outcomeReasonCode: "medication", outcomeRecordedAt: "2026-09-05T10:00:00Z", quoteId: "q1" }),
      attempt("a2", { attemptNo: 2, carrierId: C2, status: "closed", outcome: "issued", submittedAt: "2026-09-07T10:00:00Z", outcomeRecordedAt: "2026-09-17T10:00:00Z", quoteId: "q3" }),
      attempt("s1", { insuredRole: "spouse", status: "pending_carrier", submittedAt: "2026-09-03T10:00:00Z", quoteId: "q2" }),
      attempt("b1", { caseId: "case-2", leadId: "lead-2", carrierId: C2, status: "closed", outcome: "withdrawn", outcomeReasonCode: "client_changed_mind", submittedAt: null, outcomeRecordedAt: "2026-09-10T10:00:00Z", quoteId: "q4", createdBy: "u2" }),
      attempt("c1", { caseId: "case-3", leadId: "lead-3", status: "closed", outcome: "declined_by_client", submittedAt: "2026-09-08T10:00:00Z", outcomeRecordedAt: "2026-09-20T10:00:00Z", quoteId: "q5" }),
      attempt("d1", { caseId: "case-4", leadId: "lead-4", status: "closed", outcome: "issued", submittedAt: "2026-08-10T10:00:00Z", outcomeRecordedAt: "2026-08-20T10:00:00Z", quoteId: "q6" }),
    ],
    quotes: [
      quote("q1"),
      quote("q2", { insuredRole: "spouse", monthlyPremiumCents: 5_000 }),
      quote("q3", { carrierId: C2, monthlyPremiumCents: 7_120, createdAt: "2026-09-06T09:00:00Z" }),
      quote("q4", { caseId: "case-2", leadId: "lead-2", carrierId: C2, createdBy: "u2", createdAt: "2026-09-09T09:00:00Z" }),
      quote("q5", { caseId: "case-3", leadId: "lead-3", createdAt: "2026-09-07T09:00:00Z" }),
      quote("q6", { caseId: "case-4", leadId: "lead-4", createdAt: "2026-08-09T09:00:00Z" }),
    ],
    counteroffers: [{ id: "o1", applicationId: "c1", status: "rejected", receivedAt: "2026-09-12T10:00:00Z", reasonCode: "height_weight" }],
    requirements: [{ applicationId: "s1", kind: "aps", raisedAt: "2026-09-04", satisfiedAt: "2026-09-10" }],
    rates: [{ carrierId: C2, productCode: "final_expense", rateBp: 11_000 }],
    reasonLabels: { medication: "Medication disclosed", client_changed_mind: "Client changed their mind", height_weight: "Build" },
  };
}

const SEPT = { from: "2026-09-01", to: "2026-09-30" };

test("3.21: each stage matches the hand count; placed is null, never inferred from issued", () => {
  const r = buildSalesReport(input(), SEPT);
  // Submitted in September: a1, a2, s1, c1 (b1 never submitted; d1 was August).
  assert.equal(r.totals.submitted, 4);
  assert.deepEqual(r.totals.issued, { n: 1, d: 4 });
  assert.deepEqual(r.totals.declined, { n: 2, d: 4 }); // a1 declined, c1 refused the counteroffer
  assert.deepEqual(r.totals.counteroffered, { n: 1, d: 4 });
  // Funnel by insured, first quote in September: Rita, Tom, Ann, Bea (Cal was August).
  assert.equal(r.funnel.quoted, 4);
  assert.deepEqual(r.funnel.applied, { n: 3, d: 4 }); // Ann never reached ready
  assert.deepEqual(r.funnel.submitted, { n: 3, d: 3 });
  assert.deepEqual(r.funnel.issued, { n: 1, d: 3 }); // Rita once, though she had two attempts
  assert.equal(r.funnel.placed, null);
});

test("3.24: a spouse's application counts once, beside the primary's — neither merged nor doubled", () => {
  const r = buildSalesReport(input(), { ...SEPT, source: "source:inbound" });
  // case-1 only: Rita (a1, a2) and Tom (s1) are three applications and two insureds.
  assert.equal(r.totals.submitted, 3);
  assert.equal(r.funnel.quoted, 2);
  assert.equal(r.funnel.submitted.n, 2);
});

test("3.21: every rate carries its numerator and denominator; a cell under 5 cases is a greyed count", () => {
  assert.deepEqual(crossCell(4, 26), { kind: "count", text: "n=4" });
  assert.deepEqual(crossCell(9, 26), { kind: "rate", text: "35%", detail: "(9/26)" });
  const r = buildSalesReport(input(), SEPT);
  for (const ratio of [r.totals.issued, r.totals.declined, r.funnel.applied, r.funnel.submitted, r.funnel.issued]) {
    assert.ok(ratio.n <= ratio.d, "a numerator is part of its denominator");
  }
});

test("3.21: decline reasons by carrier, with refused and expired counteroffers separable", () => {
  const r = buildSalesReport(input(), SEPT);
  assert.equal(r.declines.total, 2);
  const med = r.declines.rows.find((x) => x.key === "reason:medication");
  assert.equal(med.byCarrier[C1], 1);
  assert.equal(med.label, "Medication disclosed");
  const refused = r.declines.rows.find((x) => x.key === "outcome:declined_by_client");
  assert.equal(refused.total, 1);
  assert.deepEqual(r.declines.carriers.map((c) => [c.id, c.total]), [[C1, 2]]);
  const co = r.counteroffers.rows.find((x) => x.carrierId === C1);
  assert.equal(co.refused, 1);
  assert.equal(co.expired, 0);
});

test("3.21: filters compose — carrier + lead source + date range", () => {
  const all = buildSalesReport(input(), SEPT);
  const carrier = buildSalesReport(input(), { ...SEPT, carrierId: C1 });
  const both = buildSalesReport(input(), { ...SEPT, carrierId: C1, source: "source:outbound" });
  const narrow = buildSalesReport(input(), { from: "2026-09-01", to: "2026-09-05", carrierId: C1, source: "source:inbound" });
  assert.equal(all.totals.submitted, 4);
  assert.equal(carrier.totals.submitted, 3); // a1, s1, c1
  assert.equal(both.totals.submitted, 1); // c1
  assert.equal(narrow.totals.submitted, 2); // a1, s1
  const campaign = buildSalesReport(input(), { ...SEPT, source: "campaign:cmp-x" });
  assert.equal(campaign.funnel.quoted, 1); // Ann
  assert.equal(campaign.totals.submitted, 0);
});

test("3.21: FYC is estimated in integer cents from the year-one rate; unrated issues are left out and counted", () => {
  const r = buildSalesReport(input(), SEPT);
  // a2 issued at C2, $71.20 a month: $854.40 a year × 110% = $939.84 → 93 984¢.
  assert.equal(r.premium.total.issuedAnnualCents, 85_440);
  assert.equal(r.premium.total.estimatedFycCents, 93_984);
  assert.equal(r.premium.total.ratedCount, 1);
  assert.ok(Number.isInteger(r.premium.total.estimatedFycCents));
  // Submitted annualised: q1 6 840 + q3 7 120 + q2 5 000 + q5 6 840, × 12.
  assert.equal(r.premium.total.submittedAnnualCents, (6_840 + 7_120 + 5_000 + 6_840) * 12);
});

test("timing medians", () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  const r = buildSalesReport(input(), SEPT);
  assert.equal(r.timing.requirements[0].all.value, 6);
});

test("the sample input is consistent: every rate's numerator fits its denominator", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const r = buildSalesReport(sampleReportInput(now), defaultWindow(now, "UTC"));
  assert.ok(r.totals.submitted > 20);
  assert.ok(r.totals.issued.n <= r.totals.submitted);
  assert.equal(r.declines.carriers.reduce((s, c) => s + c.total, 0), r.declines.total);
  for (const row of r.declines.rows) assert.equal(Object.values(row.byCarrier).reduce((s, n) => s + n, 0), row.total);
});

test("a submitted attempt the agency withdrew is not a carrier decline", () => {
  const base = input();
  const withWithdrawn = { ...base, attempts: [...base.attempts, attempt("w1", { caseId: "case-2", leadId: "lead-2", status: "closed", outcome: "withdrawn", outcomeReasonCode: "client_changed_mind", submittedAt: "2026-09-11T10:00:00Z", outcomeRecordedAt: "2026-09-12T10:00:00Z", quoteId: "q4" })] };
  const r = buildSalesReport(withWithdrawn, SEPT);
  assert.equal(r.totals.submitted, 5); // it was submitted, so it is in the population
  assert.deepEqual(r.totals.declined, { n: 2, d: 5 }); // still only a1 and c1
  assert.equal(r.declines.total, 2);
});
