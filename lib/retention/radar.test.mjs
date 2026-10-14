// LA-5.1 / 5.2 / 5.3 (Notion sprint) · the chargeback radar and the save queue, as plain functions.
// Run with: node --experimental-strip-types --test lib/retention/radar.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PLATFORM_DEFAULT_SETTINGS as SETTINGS, PLATFORM_DEFAULT_WEIGHTS as WEIGHTS, SIGNALS, SIGNAL_LABELS } from "./constants.ts";
import { deriveSignals, wholeMonths } from "./signals.ts";
import { agePoints, bandFor, confidenceFor, scorePolicy, timingPoints } from "./score.ts";
import { recommendFixes, MAX_FIXES } from "./fixes.ts";
import { buildQueue, daysUntilNextDraft, isEmergency, isHeld } from "./queue.ts";
import { draftTiming } from "../draftDates/optimiser.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");

/** Rita: SSA (born on the 15th → third Wednesday), drafted on the 3rd, paper bill… month 3. */
const complete = (over = {}) => ({
  status: "active",
  paymentMethod: "bank_draft",
  issueDate: "2026-07-20",
  asOf: "2026-10-14",
  inClawbackWindow: true,
  monthlyPremiumCents: 7140,
  draft: { draftDay: 3, incomeType: "ssa", incomeInputs: { birthDay: 15 }, dob: "1955-04-15", buffer: 3 },
  wobble: { failures: 1, lastFailureDate: "2026-09-10", recovered: true },
  hasPaymentHistory: true,
  monthlyCadence: false,
  income: { monthlyCents: 120000, confidence: "stated", householdTotal: false },
  householdMonthlyPremiumCents: null,
  vendorId: "v1",
  campaignId: null,
  source: { persistencyBp: 5900, sample: 40, tenantBp: 8100 },
  carrier: { graceDays: 31, redraftAttempts: 1, lapseRateBp: 2000, sample: 60 },
  ...over,
});

// ─── LA-5.1 · signals ──────────────────────────────────────────────────────────────────────────

test("all seven signals populate for a policy with complete data", () => {
  const s = deriveSignals(complete(), SETTINGS);
  assert.equal(s.signalsAvailable, 7);
  assert.deepEqual(s.missing, []);
  assert.equal(s.paymentMethod, "bank_draft");
  assert.equal(s.monthsSinceIssue, 2);
  assert.equal(s.draftFailuresCount, 1);
  assert.equal(s.premiumPctOfIncomeBp, 595);
  assert.equal(s.sourcePersistency9moBp, 5900);
  assert.equal(s.carrierGraceDays, 31);
});

test("draft timing comes from LA-3.9's optimiser and is negative when the draft lands before the money", () => {
  const s = deriveSignals(complete(), SETTINGS);
  const direct = draftTiming({ incomeType: "ssa", birthDay: 15, buffer: 3, from: new Date("2026-10-01T00:00:00Z") }, 3);
  assert.equal(s.daysDraftBeforeIncome, direct.daysDraftBeforeIncome);
  assert.ok(s.daysDraftBeforeIncome < 0, "a draft on the 3rd lands before a third-Wednesday deposit");
  assert.ok(s.expectedIncomeDay >= 15 && s.expectedIncomeDay <= 21);
  // A draft a few days after the deposit is safe: positive.
  assert.ok(draftTiming({ incomeType: "ssi", buffer: 3, from: new Date("2026-10-01T00:00:00Z") }, 4).daysDraftBeforeIncome > 0);
  // The optimiser's own recommendation travels with the row, for the fix.
  assert.ok(s.recommendedDraftDay >= 1 && s.recommendedDraftDay <= 28);
  assert.match(s.recommendedDraftReason, /Social Security/);
});

test("unknown income: the timing is null and named missing — never a default", () => {
  const s = deriveSignals(complete({ draft: { draftDay: 3, incomeType: "none", incomeInputs: {}, dob: null, buffer: 3 } }), SETTINGS);
  assert.equal(s.incomeType, "unknown");
  assert.equal(s.daysDraftBeforeIncome, null);
  assert.equal(s.expectedIncomeDay, null);
  assert.ok(s.missing.includes("draft_timing"));
});

test("signals_available is always seven minus the missing ones, and a null signal is never filled in", () => {
  const bare = complete({ draft: null, paymentMethod: null, issueDate: null, hasPaymentHistory: false, income: null, source: null, carrier: null, wobble: null });
  const s = deriveSignals(bare, SETTINGS);
  assert.equal(s.signalsAvailable, 7 - s.missing.length);
  assert.equal(s.signalsAvailable, 0);
  for (const field of ["daysDraftBeforeIncome", "paymentMethod", "monthsSinceIssue", "draftFailuresCount", "premiumPctOfIncomeBp", "sourcePersistency9moBp", "carrierGraceDays"]) {
    assert.equal(s[field], null, `${field} stays null when missing`);
  }
  for (let i = 0; i < 40; i++) {
    const random = complete({
      draft: Math.random() < 0.5 ? null : complete().draft,
      paymentMethod: Math.random() < 0.5 ? null : "card",
      income: Math.random() < 0.5 ? null : complete().income,
      source: Math.random() < 0.5 ? null : complete().source,
      hasPaymentHistory: Math.random() < 0.5,
    });
    const r = deriveSignals(random, SETTINGS);
    assert.equal(r.signalsAvailable, SIGNALS.length - r.missing.length);
  }
});

test("a lead source below the sample floor is unavailable, not a low-confidence number", () => {
  const s = deriveSignals(complete({ source: { persistencyBp: 8100, sample: 11, tenantBp: 8100 } }), SETTINGS);
  assert.equal(s.sourcePersistency9moBp, null);
  assert.equal(s.sourceSampleSize, 11);
  assert.ok(s.missing.includes("lead_source"));
});

test("a monthly-cadence carrier has the wobble limitation recorded on the row", () => {
  assert.equal(deriveSignals(complete({ monthlyCadence: true }), SETTINGS).wobbleDetectionLimited, true);
  assert.equal(deriveSignals(complete(), SETTINGS).wobbleDetectionLimited, false);
});

test("one file is no payment history: the wobble signal is missing, not zero", () => {
  const s = deriveSignals(complete({ hasPaymentHistory: false, wobble: null }), SETTINGS);
  assert.equal(s.draftFailuresCount, null);
  assert.ok(s.missing.includes("payment_wobble"));
  // With history and no failure seen, zero is a real observation.
  assert.equal(deriveSignals(complete({ wobble: null }), SETTINGS).draftFailuresCount, 0);
});

test("a household-total income divides across the household's policies (a spouse pair)", () => {
  const pair = complete({ monthlyPremiumCents: 3800, householdMonthlyPremiumCents: 8000, income: { monthlyCents: 210000, confidence: "stated", householdTotal: true } });
  assert.equal(deriveSignals(pair, SETTINGS).premiumPctOfIncomeBp, 381);
  const own = complete({ monthlyPremiumCents: 3800, householdMonthlyPremiumCents: 8000, income: { monthlyCents: 210000, confidence: "stated", householdTotal: false } });
  assert.equal(deriveSignals(own, SETTINGS).premiumPctOfIncomeBp, 181);
});

test("whole months since issue", () => {
  assert.equal(wholeMonths("2026-07-20", "2026-10-14"), 2);
  assert.equal(wholeMonths("2026-07-14", "2026-10-14"), 3);
  assert.equal(wholeMonths("2026-10-20", "2026-10-14"), 0);
});

// ─── LA-5.2 · the score ────────────────────────────────────────────────────────────────────────

test("the contribution breakdown sums to the score, for every shape of policy", () => {
  const shapes = [complete(), complete({ paymentMethod: "direct_bill" }), complete({ income: null, source: null, carrier: null }), complete({ draft: null }), complete({ issueDate: "2020-01-01", wobble: null })];
  for (const p of shapes) {
    const score = scorePolicy(deriveSignals(p, SETTINGS), WEIGHTS, SETTINGS);
    assert.equal(score.contributions.reduce((a, c) => a + c.contribution, 0), score.score);
    assert.ok(score.score >= 0 && score.score <= 100);
  }
});

test("three missing signals: scored over the weight we have — not penalised, not read as low risk", () => {
  const full = scorePolicy(deriveSignals(complete({ paymentMethod: "card" }), SETTINGS), WEIGHTS, SETTINGS);
  const partial = scorePolicy(deriveSignals(complete({ paymentMethod: "card", income: null, source: null, carrier: null }), SETTINGS), WEIGHTS, SETTINGS);
  assert.equal(partial.signalsAvailable, 4);
  // Missing weight is not counted as zero risk: the score stays in the same range as the full one.
  assert.ok(Math.abs(partial.score - full.score) <= 15, `${partial.score} vs ${full.score}`);
  assert.equal(partial.availableWeight, 85);
});

test("confidence follows the available weight: 80+ high, 50–79 medium, under 50 low", () => {
  assert.equal(confidenceFor(100), "high");
  assert.equal(confidenceFor(80), "high");
  assert.equal(confidenceFor(79), "medium");
  assert.equal(confidenceFor(50), "medium");
  assert.equal(confidenceFor(49), "low");
});

test("an estimated income counts for less than a stated one", () => {
  const stated = scorePolicy(deriveSignals(complete(), SETTINGS), WEIGHTS, SETTINGS);
  const estimated = scorePolicy(deriveSignals(complete({ income: { monthlyCents: 120000, confidence: "estimated", householdTotal: false } }), SETTINGS), WEIGHTS, SETTINGS);
  const w = (score) => score.contributions.find((c) => c.signal === "affordability").weight;
  assert.equal(w(estimated), w(stated) / 2);
});

test("bands from the configurable thresholds", () => {
  assert.equal(bandFor(24, SETTINGS), "low");
  assert.equal(bandFor(25, SETTINGS), "medium");
  assert.equal(bandFor(50, SETTINGS), "high");
  assert.equal(bandFor(75, SETTINGS), "critical");
  assert.equal(bandFor(60, { ...SETTINGS, highFrom: 65, criticalFrom: 80 }), "medium");
});

test("signal points: timing full 0–7 days before, none after; months 2–5 full", () => {
  assert.equal(timingPoints(-3), 100);
  assert.equal(timingPoints(-7), 100);
  assert.ok(timingPoints(-14) < 100 && timingPoints(-14) > 0);
  assert.equal(timingPoints(3), 0);
  assert.equal(agePoints(1, SETTINGS), 100); // month 2
  assert.equal(agePoints(4, SETTINGS), 100); // month 5
  assert.ok(agePoints(0, SETTINGS) < 100); // month 1
  assert.equal(agePoints(14, SETTINGS), 5); // month 15
});

test("the sentence names at most three contributors in plain words, with no internal signal names", () => {
  const s = deriveSignals(complete({ paymentMethod: "direct_express" }), SETTINGS);
  const score = scorePolicy(s, WEIGHTS, SETTINGS);
  assert.ok(score.explanation.length > 10);
  assert.match(score.explanation, /Payment comes out on the 3rd, their money arrives around the \d+(st|nd|rd|th)\./);
  assert.match(score.explanation, /Pays by Direct Express card\.|Month 3\./);
  // A mailed bill has no draft: its sentence leads with the bill, never with a draft date.
  const bill = scorePolicy(deriveSignals(complete({ paymentMethod: "direct_bill" }), SETTINGS), WEIGHTS, SETTINGS);
  assert.match(bill.explanation, /Paper bill in the post\./);
  assert.doesNotMatch(bill.explanation, /Payment comes out/);
  const sentences = score.explanation.split(/(?<=\.)\s+/).filter(Boolean);
  assert.ok(sentences.length <= 3, score.explanation);
  for (const name of [...SIGNALS, ...Object.values(SIGNAL_LABELS)]) assert.ok(!score.explanation.includes(name), `no "${name}"`);
  assert.doesNotMatch(score.explanation, /\bbp\b|weight|points|contribution/i);
});

test("a policy with only the four history-free signals still gets a usable score and sentence", () => {
  const s = deriveSignals(complete({ income: null, source: null, carrier: null, wobble: null }), SETTINGS);
  const score = scorePolicy(s, WEIGHTS, SETTINGS);
  assert.equal(score.signalsAvailable, 4);
  assert.equal(score.confidence, "high");
  assert.ok(score.explanation.trim().length >= 3);
  // And a healthy one still says something.
  const calm = scorePolicy(deriveSignals(complete({ draft: null, issueDate: "2021-01-01", wobble: null, income: null, source: null, carrier: null }), SETTINGS), WEIGHTS, SETTINGS);
  assert.match(calm.explanation, /^Nothing stands out\./);
});

test("the platform weights sum to 100, and the migration seeds the same numbers and settings", () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
  const sql = read("supabase/migrations/20261014100000_la_5_1_3_chargeback_radar.sql");
  for (const [signal, weight] of Object.entries(WEIGHTS)) assert.match(sql, new RegExp(`"${signal}": ${weight}[,}]`));
  assert.match(sql, new RegExp(`medium_from smallint not null default ${SETTINGS.mediumFrom}`));
  assert.match(sql, new RegExp(`high_from smallint not null default ${SETTINGS.highFrom}`));
  assert.match(sql, new RegExp(`critical_from smallint not null default ${SETTINGS.criticalFrom}`));
  assert.match(sql, new RegExp(`worked_cooldown_days smallint not null default ${SETTINGS.workedCooldownDays}`));
  assert.match(sql, new RegExp(`sample_floor smallint not null default ${SETTINGS.sampleFloor}`));
});

test("no AI provider is reached anywhere in the radar, and the prediction is never written to risk_band", () => {
  const dir = join(root, "lib/retention");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join(dir, file), "utf8");
    assert.doesNotMatch(source, /from "[^"]*(\/ai\/|anthropic|openai|aiProvider|llm)[^"]*"/i, `${file} imports an AI module`);
    assert.doesNotMatch(source, /risk_band/, `${file} touches risk_band`);
  }
  const sql = read("supabase/migrations/20261014100000_la_5_1_3_chargeback_radar.sql");
  assert.doesNotMatch(sql, /update\s+public\.policy_current/i);
});

test("the migration keeps records records: explicit revokes on the guarded tables", () => {
  const sql = read("supabase/migrations/20261014100000_la_5_1_3_chargeback_radar.sql");
  assert.match(sql, /revoke delete, truncate on public\.save_attempt from service_role, tenant_app;/);
  assert.match(sql, /revoke update, delete, truncate on public\.retention_setting_change, public\.risk_weight_set from service_role, tenant_app;/);
  assert.match(sql, /revoke delete, truncate on public\.save_queue_hold from service_role, tenant_app;/);
  assert.match(sql, /signals_available = 7 - jsonb_array_length\(signals_missing_json\)/);
});

// ─── LA-5.3 · fixes and the queue ──────────────────────────────────────────────────────────────

test("a draft-timing card recommends a specific day from LA-3.9, and no card has more than two fixes", () => {
  const s = deriveSignals(complete({ paymentMethod: "direct_express" }), SETTINGS);
  const fixes = recommendFixes(s, scorePolicy(s, WEIGHTS, SETTINGS));
  assert.ok(fixes.length <= MAX_FIXES);
  const move = fixes.find((f) => f.action === "move_draft_date");
  assert.ok(move, "the draft-date fix is offered");
  assert.equal(move.targetDraftDay, s.recommendedDraftDay);
  assert.match(move.label, /^Move the payment date to the \d+(st|nd|rd|th)$/);
  assert.ok(fixes.every((f, i) => i === 0 || fixes[i - 1].removes >= f.removes), "ranked by the share of the score it removes");
  // A mailed bill: convert it.
  const bill = deriveSignals(complete({ paymentMethod: "direct_bill" }), SETTINGS);
  assert.ok(recommendFixes(bill, scorePolicy(bill, WEIGHTS, SETTINGS)).some((f) => f.action === "convert_to_draft"));
  // Months since issue alone: a courtesy call, no change.
  const calm = deriveSignals(complete({ draft: null, wobble: null, income: null, paymentMethod: "bank_draft" }), SETTINGS);
  assert.deepEqual(recommendFixes(calm, scorePolicy(calm, WEIGHTS, SETTINGS)).map((f) => f.action), ["courtesy_call"]);
});

const card = (over = {}) => ({ key: "c|1", score: 80, band: "critical", confidence: "high", status: "active", daysPastDue: 0, boardReason: null, lastAttempt: null, hold: null, atRiskCents: 40000, nextDraftDays: 5, monthsSinceIssue: 2, ...over });

test("a past-due policy, or one on Lapse risk's call list, never appears on the save queue", () => {
  assert.equal(isEmergency(card({ daysPastDue: 3 })), true);
  assert.equal(isEmergency(card({ status: "at_risk" })), true);
  assert.equal(isEmergency(card({ boardReason: "bounced_draft" })), true);
  // A mailed bill on the call list is prevention, not an emergency.
  assert.equal(isEmergency(card({ boardReason: "direct_bill" })), false);
  const q = buildQueue([card({ key: "a", daysPastDue: 2 }), card({ key: "b" })], SETTINGS, "2026-10-14");
  assert.deepEqual(q.cards.map((c) => c.key), ["b"]);
});

test("the default order is score × exposure: a probable lapse on $600 beats a near-certain one on $40", () => {
  const q = buildQueue([card({ key: "small", score: 95, atRiskCents: 4000 }), card({ key: "big", score: 60, band: "high", atRiskCents: 60000 })], SETTINGS, "2026-10-14");
  assert.deepEqual(q.cards.map((c) => c.key), ["big", "small"]);
  assert.deepEqual(buildQueue([card({ key: "small", score: 95, atRiskCents: 4000 }), card({ key: "big", score: 60, band: "high", atRiskCents: 60000 })], SETTINGS, "2026-10-14", "score").cards.map((c) => c.key), ["small", "big"]);
});

test("only the queue band and above; medium only when allowed and nothing higher is there", () => {
  const medium = card({ key: "m", score: 30, band: "medium" });
  assert.equal(buildQueue([medium], SETTINGS, "2026-10-14").cards.length, 0);
  const q = buildQueue([medium], { ...SETTINGS, includeMediumWhenEmpty: true }, "2026-10-14");
  assert.equal(q.cards.length, 1);
  assert.equal(q.usedMedium, true);
});

test("a worked card leaves for the cooldown and returns early only if the score rises", () => {
  const worked = card({ lastAttempt: { at: "2026-10-01T15:00:00Z", score: 80 } });
  assert.equal(isHeld(worked, "2026-10-14", 30), true);
  assert.equal(isHeld(worked, "2026-11-01", 30), false);
  assert.equal(isHeld({ ...worked, score: 85 }, "2026-10-14", 30), false);
});

test("a snooze holds until its day, a dismissal until the score rises", () => {
  assert.equal(isHeld(card({ hold: { kind: "snooze", until: "2026-10-21", score: 80 } }), "2026-10-14", 30), true);
  assert.equal(isHeld(card({ hold: { kind: "snooze", until: "2026-10-21", score: 80 } }), "2026-10-21", 30), false);
  assert.equal(isHeld(card({ hold: { kind: "dismiss", until: null, score: 80 } }), "2027-01-01", 30), true);
  assert.equal(isHeld(card({ score: 81, hold: { kind: "dismiss", until: null, score: 80 } }), "2026-10-14", 30), false);
});

test("days until the next draft", () => {
  assert.equal(daysUntilNextDraft(17, "2026-10-14"), 3);
  assert.equal(daysUntilNextDraft(14, "2026-10-14"), 0);
  assert.equal(daysUntilNextDraft(3, "2026-10-14"), 20);
  assert.equal(daysUntilNextDraft(31, "2026-02-10"), 18);
  assert.equal(daysUntilNextDraft(null, "2026-10-14"), null);
});

test("a low-confidence score never reaches the queue, and is counted (owner decision 2026-10-14)", () => {
  const q = buildQueue([
    card({ key: "thin", confidence: "low", score: 100 }),
    card({ key: "thin-low-band", confidence: "low", score: 10, band: "low" }),
    card({ key: "medium-conf", confidence: "medium", score: 60, band: "high" }),
    card({ key: "sure", confidence: "high" }),
  ], SETTINGS, "2026-10-14");
  assert.deepEqual(q.cards.map((c) => c.key).sort(), ["medium-conf", "sure"]);
  // Only those that would have made the queue band are counted.
  assert.equal(q.lowConfidence, 1);
  // Nor does a thin medium fill an empty queue.
  const fill = buildQueue([card({ key: "m", confidence: "low", score: 30, band: "medium" })], { ...SETTINGS, includeMediumWhenEmpty: true }, "2026-10-14");
  assert.equal(fill.cards.length, 0);
});
