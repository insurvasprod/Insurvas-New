// The Retention ladder (owner 2026-11-05, docs/retention/SPEC.md): every case from the files, at its risk point.
// Run with: node --experimental-strip-types --test lib/retention/cases/ladder.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { reasonFor } from "../../ingestion/retentionBoard.ts";
import { DEFAULT_LADDER_SETTINGS as S, caseOrder, chargebackMeansLost, daysUntil, ladderTransition, paperworkTransition, placeOnLadder, priorityOf, stepNumber } from "./ladder.ts";

const TODAY = "2026-11-05";

test("each file fact lands on its step, with the carrier's deadline", () => {
  const place = (boardReason, daysLeft = 20, flag = null) => placeOnLadder({ boardReason, daysLeft, flag }, TODAY).ladder;
  assert.deepEqual(place("first_payment_missed"), { step: "payment_problem", reason: "first_draft_failed", deadline: "2026-11-25", priority: 1 });
  assert.equal(place("later_payment_missed").step, "payment_problem");
  assert.equal(place("bounced_draft").reason, "bounced_draft");
  assert.equal(place("conservation").step, "pending_lapse");
  assert.equal(place("recently_lapsed").step, "lapsed_reinstatable");
  assert.equal(place(null, null, "banking").reason, "banking_problem");
  assert.equal(place(null, null, "notice").step, "pending_lapse");
});

test("a payment problem near its deadline is a pending lapse: act now", () => {
  const near = placeOnLadder({ boardReason: "later_payment_missed", daysLeft: 3, flag: null }, TODAY).ladder;
  assert.equal(near.step, "pending_lapse");
  assert.equal(near.reason, "later_draft_failed", "the reason keeps saying what happened");
  assert.equal(placeOnLadder({ boardReason: "later_payment_missed", daysLeft: 8, flag: null }, TODAY).ladder.step, "payment_problem");
});

test("a deadline already passed keeps its real day, never today (walk 2026-11-05: 333 overdue cases read 'Today')", () => {
  const p = placeOnLadder({ boardReason: "later_payment_missed", daysLeft: -12, flag: null }, TODAY).ladder;
  assert.equal(p.deadline, "2026-10-24");
  assert.equal(p.step, "pending_lapse", "past its date is still urgent");
  assert.equal(daysUntil(p.deadline, TODAY), -12);
});

test("a deadline is never guessed: no carrier window, no date", () => {
  const p = placeOnLadder({ boardReason: "later_payment_missed", daysLeft: null, flag: null }, TODAY).ladder;
  assert.equal(p.deadline, null);
  assert.equal(p.step, "payment_problem", "no window cannot make it urgent either");
});

test("paperwork sits beside the ladder; the highest risk point wins on the ladder", () => {
  const both = placeOnLadder({ boardReason: "direct_bill", daysLeft: null, flag: "pending_lapse" }, TODAY);
  assert.equal(both.ladder.step, "pending_lapse");
  assert.deepEqual(both.paperwork.map((p) => p.reason), ["mailed_bill"]);
  const cancel = placeOnLadder({ boardReason: "cancellation_request", daysLeft: 10, flag: null }, TODAY);
  assert.equal(cancel.ladder, null);
  assert.equal(cancel.paperwork[0].reason, "cancellation_request");
  const high = placeOnLadder({ boardReason: "later_payment_missed", daysLeft: 20, flag: "notice" }, TODAY);
  assert.equal(high.ladder.reason, "lapse_notice", "a lapse notice outranks a missed payment");
});

test("an agency can switch a reason off", () => {
  const off = placeOnLadder({ boardReason: "direct_bill", daysLeft: null, flag: null }, TODAY, { ...S, disabled: new Set(["mailed_bill"]) });
  assert.deepEqual(off, { ladder: null, paperwork: [] });
});

test("a case closes only on the files' word: saved when paying again, lost when gone; it never steps down", () => {
  const open = { id: "c", step: "pending_lapse", reason: "pending_lapse", deadline: "2026-11-08", status: "open" };
  assert.deepEqual(ladderTransition(open, null, { status: "active", paidTo: "2026-12-01" }), { kind: "save" });
  assert.deepEqual(ladderTransition(open, null, { status: "lapsed", paidTo: "2026-10-01" }), { kind: "lose", reason: "lapsed_lost" });
  const lower = placeOnLadder({ boardReason: "later_payment_missed", daysLeft: 20, flag: null }, TODAY).ladder;
  const t = ladderTransition(open, lower, { status: "active", paidTo: "2026-10-01" });
  assert.equal(t.kind, "refresh");
  assert.equal(t.to.step, "pending_lapse", "never back down while it is worked");
  const lapsed = placeOnLadder({ boardReason: "recently_lapsed", daysLeft: 28, flag: null }, TODAY).ladder;
  assert.deepEqual(ladderTransition(open, lapsed, { status: "lapsed", paidTo: null }), { kind: "move", to: lapsed });
  assert.deepEqual(ladderTransition({ ...open, step: "lost", reason: "lapsed_lost" }, null, { status: "lapsed", paidTo: null }), { kind: "keep" }, "a lost case waits for a person to close it");
});

test("a chargeback is a loss only when the policy file shows the policy gone", () => {
  assert.equal(chargebackMeansLost("lapsed"), true);
  assert.equal(chargebackMeansLost("not_taken"), true);
  assert.equal(chargebackMeansLost("active"), false, "paid ahead after the chargeback: recovered, not a case");
  assert.equal(chargebackMeansLost(null), false);
});

test("paperwork clears when the file drops it; a payment-date change is only ever closed by a person", () => {
  const p = { id: "p", step: "paperwork", reason: "mailed_bill", deadline: null, status: "open" };
  assert.deepEqual(paperworkTransition(p, false, { status: "active", paidTo: null }), { kind: "save" });
  assert.deepEqual(paperworkTransition(p, true, { status: "active", paidTo: null }), { kind: "keep" });
  assert.deepEqual(paperworkTransition({ ...p, reason: "payment_date_change" }, false, { status: "active", paidTo: null }), { kind: "keep" });
  // Round 7 (Lapse risk 4·A): a case a person opened stays until a person closes it, or the policy is gone.
  assert.deepEqual(paperworkTransition({ ...p, reason: "cancellation_request", byPerson: true }, false, { status: "active", paidTo: null }), { kind: "keep" });
  assert.equal(paperworkTransition({ ...p, reason: "cancellation_request", byPerson: true }, false, { status: "lapsed", paidTo: null }).kind, "lose");
});

test("priorities and the working order: the highest step, then the nearest deadline", () => {
  assert.equal(priorityOf("first_draft_failed", "payment_problem"), 1);
  assert.equal(priorityOf("later_draft_failed", "payment_problem"), 2);
  assert.equal(priorityOf("mailed_bill", "paperwork"), 3);
  const rows = caseOrder([
    { id: "pp", step: "payment_problem", deadline: "2026-11-09", premiumCents: 5000 },
    { id: "pl", step: "pending_lapse", deadline: "2026-11-20", premiumCents: 5000 },
    { id: "lr", step: "lapsed_reinstatable", deadline: "2026-12-03", premiumCents: 5000 },
    { id: "pw", step: "paperwork", deadline: null, premiumCents: 9000 },
    { id: "pp2", step: "payment_problem", deadline: "2026-11-07", premiumCents: 100 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["lr", "pl", "pp2", "pp", "pw"]);
  assert.equal(stepNumber("paperwork"), null);
  assert.equal(daysUntil("2026-11-07", TODAY), 2);
});

test("built on LA-4.16's reasons, not a second copy of them", () => {
  assert.equal(typeof reasonFor, "function");
  const src = readFileSync(join(process.cwd(), "lib/retention/cases/ladder.ts"), "utf8");
  assert.match(src, /import type \{ Reason as BoardReason \} from "..\/..\/ingestion\/retentionBoard.ts"/);
  assert.doesNotMatch(src, /\bpaidTo\s*<=\s*/, "the never-paid rule lives in reasonFor only");
});
