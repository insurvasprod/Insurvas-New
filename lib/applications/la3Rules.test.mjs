// LA-3 acceptance criteria that are pure rules — each assertion is a line from the sprint task.
import test from "node:test";
import assert from "node:assert/strict";

const { isPlausibleSsn, isValidAbaRouting, passesLuhn, cardBrand, dobVariants, phoneVariants, maskLast4 } = await import("./formats.ts");
const { splitEvenly, checkBeneficiaries, parseShare, formatShare } = await import("./beneficiaries.ts");
const { estimatePayout, checkQuote, ratingAge, premiumPer1000 } = await import("../quotes/math.ts");
const { recommendDraftDay, MAX_DRAFT_DAY } = await import("../draftDates/optimiser.ts");
const { previousBusinessDay, federalHolidays, nthWeekday } = await import("../draftDates/holidays.ts");
const { runQa } = await import("./qa.ts");
const { FIXTURE_ATTEMPT, FIXTURE_CASE } = await import("./fixtures.ts");

test("3.11: routing 021000021 passes the ABA checksum and 021000022 fails", () => {
  assert.equal(isValidAbaRouting("021000021"), true);
  assert.equal(isValidAbaRouting("021000022"), false);
});

test("3.11: SSN 666-12-3456 fails and 123-45-6789 passes", () => {
  assert.equal(isPlausibleSsn("666-12-3456"), false);
  assert.equal(isPlausibleSsn("123-45-6789"), true);
  assert.equal(isPlausibleSsn("900-12-3456"), false);
  assert.equal(isPlausibleSsn("123-00-6789"), false);
  assert.equal(isPlausibleSsn("123-45-0000"), false);
});

test("3.19: card numbers pass Luhn and the brand is inferred", () => {
  assert.equal(passesLuhn("4111 1111 1111 1111"), true);
  assert.equal(passesLuhn("4111 1111 1111 1112"), false);
  assert.equal(cardBrand("5105105105105100"), "mastercard");
  assert.equal(cardBrand("2221000000000009"), "mastercard");
  assert.equal(cardBrand("378282246310005"), "amex");
  assert.equal(cardBrand("6011111111111117"), "discover");
});

test("3.14: DOB and phone offer the format variants carriers disagree on", () => {
  assert.deepEqual(dobVariants("1953-03-14").slice(0, 2), ["03/14/1953", "19530314"]);
  assert.deepEqual(phoneVariants("8175550142"), ["(817) 555-0142", "8175550142", "817-555-0142"]);
  assert.equal(maskLast4("123456789"), "••••6789");
});

test("3.8: split evenly across 3 primaries is 33.34 / 33.33 / 33.33, exactly 100.00", () => {
  const shares = splitEvenly(3);
  assert.deepEqual(shares.map(formatShare), ["33.34", "33.33", "33.33"]);
  assert.equal(shares.reduce((a, b) => a + b, 0), 10_000);
  assert.equal(parseShare("33.3"), 3330);
  assert.equal(parseShare("33.333"), null);
});

test("3.8: primaries totalling 99.99 block, naming the rule; a contingent alone is rejected; a minor warns", () => {
  const base = { first_name: "A", last_name: "B", relationship: "child" };
  const block = checkBeneficiaries([{ ...base, id: "1", tier: "primary", share_bp: 9_999 }]);
  assert.ok(block.some((i) => i.code === "BENEFICIARY_PRIMARY_TOTAL" && i.severity === "block"));
  const orphan = checkBeneficiaries([{ ...base, id: "1", tier: "contingent", share_bp: 10_000 }]);
  assert.ok(orphan.some((i) => i.code === "BENEFICIARY_NO_PRIMARY"));
  const minor = checkBeneficiaries([{ ...base, id: "1", tier: "primary", share_bp: 10_000, dob: "2015-01-01" }], new Date("2026-09-28T00:00:00Z"));
  assert.ok(minor.some((i) => i.code === "BENEFICIARY_MINOR" && i.severity === "warn"));
  assert.ok(!minor.some((i) => i.severity === "block"));
});

test("3.6: $68.40/mo at 105% for a 9-month advance is $820.80 / $861.84 / $646.38", () => {
  assert.deepEqual(estimatePayout({ monthlyPremiumCents: 6_840, rateBp: 10_500, advancePctBp: 10_000, advanceMonths: 9 }), { annualPremiumCents: 82_080, fycCents: 86_184, advanceCents: 64_638 });
});

test("3.5: premium ≥ face is rejected outright; an out-of-band per-$1,000 warns and still saves", () => {
  assert.ok(checkQuote({ monthlyPremiumCents: 1_000_000, faceCents: 1_000_000, age: 70 }).error);
  const low = checkQuote({ monthlyPremiumCents: 420, faceCents: 1_000_000, age: 71 });
  assert.equal(low.error, null);
  assert.ok(low.warnings.some((w) => w.code === "QUOTE_PER1000_BAND"));
  assert.equal(premiumPer1000(6_840, 1_000_000), 6.84);
});

test("3.4: a DOB seven months past the last birthday is age+1 nearest and age last", () => {
  const today = new Date("2026-10-14T00:00:00Z");
  assert.equal(ratingAge("1953-03-14", "last", today), 73);
  assert.equal(ratingAge("1953-03-14", "nearest", today), 74);
});

test("holidays: 2026 federal holidays land on their observed dates", () => {
  const h = federalHolidays(2026);
  for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]) assert.ok(h.has(d), d);
  assert.equal(nthWeekday(2026, 10, 3, 3), 21);
});

const from = new Date("2026-09-15T00:00:00Z");

test("3.9: day-of-birth 7 → 2nd Wednesday, 15 → 3rd, 28 → 4th", () => {
  for (const [birthDay, week] of [[7, "second"], [15, "third"], [28, "fourth"]]) {
    const r = recommendDraftDay({ incomeType: "ssa", birthDay, from });
    assert.equal(r.kind, "recommended");
    assert.match(r.schedule, new RegExp(`${week} Wednesday`));
  }
});

test("3.9: the recommendation is 2–4 days after the LATEST arrival in 12 months, never past the 28th", () => {
  const r = recommendDraftDay({ incomeType: "ssa", birthDay: 15, from });
  assert.equal(r.kind, "recommended");
  // 3rd Wednesdays run 15th–21st; the latest is the 21st, so a 3-day buffer is the 24th.
  assert.equal(r.recommended.day, 24);
  assert.ok(r.recommended.minGapDays >= 2 && r.recommended.minGapDays <= 4);
  assert.ok(r.alternates.every((a) => a.day <= MAX_DRAFT_DAY && a.minGapDays >= 2 && a.minGapDays <= 4));
  assert.equal(r.arrivals.length, 12);
  assert.match(r.recommended.reason, /third Wednesday.*24th/);
  for (let birthDay = 1; birthDay <= 31; birthDay++) {
    const x = recommendDraftDay({ incomeType: "ssa", birthDay, from });
    assert.ok(x.kind === "recommended" && x.recommended.day <= MAX_DRAFT_DAY, `birth day ${birthDay}`);
  }
});

test("3.9: the pre-1997 and SSI-concurrent flags override to the 3rd", () => {
  const a = recommendDraftDay({ incomeType: "ssa", birthDay: 25, before1997: true, from });
  const b = recommendDraftDay({ incomeType: "ssa_ssi", from });
  assert.match(a.schedule, /the 3rd/);
  assert.match(b.schedule, /the 3rd/);
});

test("3.9: SSI on a month whose 1st is a Sunday resolves to the preceding Friday", () => {
  // 2026-11-01 is a Sunday.
  assert.equal(previousBusinessDay("2026-11-01"), "2026-10-30");
});

test("3.11: the fixture attempt fails on the unacknowledged replacement notice, with a deep link to it", () => {
  const v = runQa({ caseId: FIXTURE_CASE.caseId, attempt: FIXTURE_ATTEMPT, interview: FIXTURE_CASE.interviews.primary });
  assert.equal(v.verdict, "fail");
  const d = v.blocking.find((i) => i.code === "QA_DISCLOSURE");
  assert.ok(d);
  assert.match(d.deepLink, /step=disclosures#disclosure\.REPLACEMENT_NOTICE$/);
  for (const item of [...v.blocking, ...v.warnings]) assert.match(item.deepLink, /^\/app\/applications\//);
});
