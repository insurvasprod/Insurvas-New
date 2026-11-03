// LA-5.6 (Notion sprint) · reinstatement, as plain rules, plus the migration's promises.
// Run with: node --experimental-strip-types --test lib/retention/reinstatement.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ageOn, canMove, caseOrder, compare, daysRemaining, estimateOwed, urgencyOf } from "./reinstatement.ts";
import { PLATFORM_DEFAULT_SETTINGS as SETTINGS } from "./constants.ts";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261014400000_la_5_6_reinstatement.sql"), "utf8");

test("the countdown: amber inside 14 days, red inside 7, pinned inside 3; no window is its own group", () => {
  assert.equal(urgencyOf(20, SETTINGS), "plain");
  assert.equal(urgencyOf(14, SETTINGS), "amber");
  assert.equal(urgencyOf(7, SETTINGS), "red");
  assert.equal(urgencyOf(3, SETTINGS), "pinned");
  assert.equal(urgencyOf(0, SETTINGS), "pinned");
  assert.equal(urgencyOf(null, SETTINGS), "no_window");
  assert.equal(daysRemaining("2026-10-20", "2026-10-14"), 6);
  assert.equal(daysRemaining(null, "2026-10-14"), null);
});

test("days remaining is the default order, ascending; no-window cases last; equal days by money", () => {
  const order = caseOrder([
    { key: "none", daysRemaining: null, advanceCents: 90000 },
    { key: "late", daysRemaining: 20, advanceCents: 10 },
    { key: "soon-small", daysRemaining: 2, advanceCents: 100 },
    { key: "soon-big", daysRemaining: 2, advanceCents: 42800 },
  ]);
  assert.deepEqual(order.map((r) => r.key), ["soon-big", "soon-small", "late", "none"]);
});

test("a person moves a case forward or records a no; never reinstated or expired, never backwards, never once closed", () => {
  assert.equal(canMove("identified", "contacted"), true);
  assert.equal(canMove("identified", "submitted"), true);
  assert.equal(canMove("submitted", "contacted"), false);
  assert.equal(canMove("contacted", "declined_by_client"), true);
  assert.equal(canMove("submitted", "reinstated"), false);
  assert.equal(canMove("identified", "expired"), false);
  assert.equal(canMove("expired", "contacted"), false);
  assert.equal(canMove("reinstated", "declined_by_client"), false);
  assert.match(sql, /if new\.status in \('reinstated', 'expired'\) then\s+if not v_sync then/);
});

test("the amount owed is an estimate until the carrier's figure is entered", () => {
  assert.deepEqual(estimateOwed("2026-08-01", "2026-10-14", 7140), { months: 3, cents: 21420 });
  assert.equal(estimateOwed(null, "2026-10-14", 7140), null);
  assert.equal(estimateOwed("2026-10-20", "2026-10-14", 7140), null);
  const est = compare({ enteredOwedCents: null, enteredMonths: null, estimate: { months: 3, cents: 21420 }, advanceCents: 42800, needsHealthQuestions: null, dob: "1955-04-15", issuedOn: "2026-02-10", today: "2026-10-14" });
  assert.equal(est.reinstate.owedIsEstimate, true);
  assert.equal(est.reinstate.owedCents, 21420);
  const real = compare({ enteredOwedCents: 21400, enteredMonths: 3, estimate: { months: 3, cents: 21420 }, advanceCents: 42800, needsHealthQuestions: true, dob: "1955-04-15", issuedOn: "2026-02-10", today: "2026-10-14" });
  assert.equal(real.reinstate.owedIsEstimate, false);
  assert.equal(real.reinstate.owedCents, 21400);
});

test("the comparison: the advance revives, and a new policy prices at today's age — never an invented premium", () => {
  const c = compare({ enteredOwedCents: null, enteredMonths: null, estimate: null, advanceCents: 42800, needsHealthQuestions: null, dob: "1955-04-15", issuedOn: "2026-02-10", today: "2026-10-14" });
  assert.equal(c.reinstate.advanceRevivesCents, 42800);
  assert.deepEqual(c.sellNew, { ageThen: 70, ageNow: 71, olderNow: true });
  assert.equal(Object.keys(c.sellNew).includes("premiumCents"), false);
  assert.equal(ageOn("1955-10-15", "2026-10-14"), 70);
  assert.equal(ageOn(null, "2026-10-14"), null);
});

test("a deadline comes from the carrier's window and the real lapse date, or is null — never guessed", () => {
  assert.match(sql, /constraint reinstatement_case_deadline check \(\(window_days is null and deadline is null\) or \(window_days is not null and deadline = lapsed_on \+ window_days\)\)/);
  // With no window, only a lapse the newest file brought opens a case.
  assert.match(sql, /or \(l\.window_days is null and l\.lapsed_on = l\.last_snapshot_date\)/);
  // The agency's own window unless cleared, else the platform's.
  assert.match(sql, /case when own\.cleared then plat\.window_days else coalesce\(own\.window_days, plat\.window_days\) end/);
});

test("reinstated only when a newer file shows the policy in force; expired counted apart; alerts once per threshold", () => {
  assert.match(sql, /pc\.status_normalized in \('active', 'at_risk', 'paid_up'\)\s+and pc\.last_snapshot_date > c\.lapsed_on/);
  assert.match(sql, /set status = 'expired', resolved_at = now\(\)/);
  assert.match(sql, /'reinstatement:' \|\| r\.id \|\| ':'/);
  assert.match(sql, /revoke insert, delete, truncate on public\.reinstatement_case from service_role, tenant_app;/);
  assert.match(sql, /raise exception using errcode = 'P0099';/);
});

test("the thresholds are settings with sane bounds", () => {
  assert.equal(SETTINGS.reinstatementAmberDays, 14);
  assert.equal(SETTINGS.reinstatementRedDays, 7);
  assert.equal(SETTINGS.reinstatementPinDays, 3);
  assert.match(sql, /reinstatement_red_days > reinstatement_pin_days and reinstatement_amber_days > reinstatement_red_days/);
});
