// LA-5.5 (Notion sprint) · the paper-bill campaign, as plain rules, plus the migration's promises.
// Run with: node --experimental-strip-types --test lib/retention/campaign.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { byPerson, campaignOrder, campaignTotals, historyLine, lapseComparison, PLATFORM_TALK_TRACK, stateOf } from "./campaign.ts";
import { PLATFORM_DEFAULT_SETTINGS as SETTINGS } from "./constants.ts";
import { buildQueue } from "./queue.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const sql = read("supabase/migrations/20261014300000_la_5_5_paper_bill_campaign.sql");
const store = read("lib/retention/campaignStore.ts");
const policy = (over = {}) => ({ key: "c|1", onPaperNow: true, annualCents: 112800, attempts: [], request: null, ...over });

test("every in-force mailed-bill policy is listed, biggest annual premium first; Direct Express is not", () => {
  const order = campaignOrder([{ key: "a", annualCents: 60000 }, { key: "b", annualCents: 112800 }, { key: "c", annualCents: null }]);
  assert.deepEqual(order.map((r) => r.key), ["b", "a", "c"]);
  assert.match(store, /\.eq\("payment_method", "direct_bill"\)/);
  assert.doesNotMatch(store, /direct_express/);
});

test("a conversion counts only once the carrier file verifies its request — agreeing is 'switch asked for'", () => {
  assert.equal(stateOf(policy({ attempts: [{ outcome: "converted", at: "2026-10-01T10:00:00Z" }], request: { status: "confirmed_by_carrier", verifiedAt: null } }), "2026-10-14", 180).state, "in_progress");
  assert.equal(stateOf(policy({ onPaperNow: false, request: { status: "verified_in_file", verifiedAt: "2026-10-12T07:30:00Z" } }), "2026-10-14", 180).state, "converted");
  // A request the file contradicted goes back on the list.
  assert.equal(stateOf(policy({ request: { status: "failed", verifiedAt: null } }), "2026-10-14", 180).state, "remaining");
});

test("no bank account leaves the campaign for good; a decline rests for the cooling-off, then returns", () => {
  assert.equal(stateOf(policy({ attempts: [{ outcome: "unable_no_bank_account", at: "2025-01-01T10:00:00Z" }] }), "2026-10-14", 180).state, "no_bank_account");
  const declined = stateOf(policy({ attempts: [{ outcome: "declined", at: "2026-09-01T10:00:00Z" }] }), "2026-10-14", 180);
  assert.equal(declined.state, "declined");
  assert.equal(declined.returnsOn, "2027-02-28");
  assert.equal(stateOf(policy({ attempts: [{ outcome: "declined", at: "2026-03-01T10:00:00Z" }] }), "2026-10-14", 180).state, "remaining");
  // No answer and "call me back" keep it on the list.
  assert.equal(stateOf(policy({ attempts: [{ outcome: "no_answer", at: "2026-10-13T10:00:00Z" }, { outcome: "callback_requested", at: "2026-10-14T10:00:00Z" }] }), "2026-10-14", 180).state, "remaining");
});

test("the header: count, monthly premium, converted / asked / declined / no bank / to go, and premium moved off paper", () => {
  const t = campaignTotals([
    { state: "converted", annualCents: 120000 }, { state: "remaining", annualCents: 60000 }, { state: "declined", annualCents: 24000 },
    { state: "no_bank_account", annualCents: 12000 }, { state: "in_progress", annualCents: 36000 },
  ]);
  assert.deepEqual(t, { policies: 5, monthlyCents: 21000, converted: 1, inProgress: 1, declined: 1, noBankAccount: 1, remaining: 1, monthlyMovedCents: 10000 });
});

test("the payoff number shows counts, not percentages, below the sample floor", () => {
  const small = lapseComparison({ lapsed: 3, total: 5 }, { lapsed: 40, total: 200 }, 20);
  assert.equal(small.converted, "3 of 5 lapsed");
  assert.equal(small.onPaper, "20% lapsed (40 of 200)");
  assert.equal(small.comparable, false);
  assert.equal(lapseComparison({ lapsed: 0, total: 0 }, { lapsed: 1, total: 2 }, 20).converted, "none yet");
});

test("per person: calls, agreed, and conversions the file proved", () => {
  const m = byPerson([{ by: "u1", outcome: "converted", verified: true }, { by: "u1", outcome: "converted", verified: false }, { by: "u1", outcome: "no_answer", verified: false }]);
  assert.deepEqual(m.get("u1"), { calls: 3, agreed: 2, verified: 1 });
});

test("the history line", () => {
  assert.equal(historyLine(24, 0), "Paying by post for 24 months · never missed");
  assert.equal(historyLine(5, 2), "Paying by post for 5 months · missed 2 times");
  assert.equal(historyLine(null, null), "Paying by post");
});

test("the talk track is content: the platform's words until an agency writes its own", () => {
  assert.match(PLATFORM_TALK_TRACK, /stamps/);
  assert.equal(SETTINGS.billTalkTrack, null);
  assert.equal(SETTINGS.billDeclineCooloffDays, 180);
  assert.match(sql, /bill_decline_cooloff_days smallint not null default 180/);
  assert.match(sql, /bill_talk_track text/);
});

test("a logged call is a record, and a decline needs its reason", () => {
  assert.match(sql, /constraint conversion_attempt_reason check \(\(outcome = 'declined'\) = \(decline_reason is not null\)\)/);
  assert.match(sql, /revoke update, delete, truncate on public\.conversion_attempt from service_role, tenant_app;/);
  assert.match(sql, /'unable_no_bank_account'/);
});

const card = (over = {}) => ({ key: "c|1", score: 10, band: "low", confidence: "low", status: "active", daysPastDue: 0, boardReason: "direct_bill", lastAttempt: null, hold: null, atRiskCents: 40000, nextDraftDays: null, monthsSinceIssue: 20, failedFix: null, noBankAccount: false, ...over });

test("no bank account sends the policy to the save queue whatever its score — holds still apply", () => {
  const q = buildQueue([card({ key: "nb", noBankAccount: true }), card({ key: "other" })], SETTINGS, "2026-10-14");
  assert.deepEqual(q.cards.map((c) => c.key), ["nb"]);
  assert.equal(q.lowConfidence, 0);
  const held = buildQueue([card({ key: "nb", noBankAccount: true, hold: { kind: "dismiss", until: null, score: 10 } })], SETTINGS, "2026-10-14");
  assert.equal(held.cards.length, 0);
});
