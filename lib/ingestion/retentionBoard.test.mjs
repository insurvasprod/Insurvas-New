// LA-4.16 (Notion sprint) · the retention board: the seven reasons, the order, the groups, the save rate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { boardOrder, daysLeftFor, groupOf, reasonFor, saveRates, urgency } from "./retentionBoard.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261008260000_la_4_16_retention_board.sql", import.meta.url), "utf8");
const T = "2026-10-08";
const base = { carrierId: "c", policyNumber: "P", status: "active", statusReported: "active", statusRaw: "Active", paidTo: "2026-10-01", effectiveDate: "2026-06-01", daysPastDue: 7, daysUntilClose: 38, graceDays: 3, lapsedOn: null, paymentMethod: "bank_draft", lastPaidToChange: null, reinstatementDays: null, lastSnapshotDate: "2026-10-05" };
const p = (over) => ({ ...base, ...over });

test("each of the seven reasons is found, and a healthy policy is not on the board", () => {
  assert.equal(reasonFor(p({ statusRaw: "Requested Termination" }), T), "cancellation_request");
  assert.equal(reasonFor(p({ statusRaw: "Lapse Pending", statusReported: "at_risk", status: "at_risk" }), T), "conservation");
  assert.equal(reasonFor(p({ lastPaidToChange: { from: "2026-10-01", to: "2026-09-01", on: "2026-10-05" } }), T), "bounced_draft", "paid-to moved back in the latest file");
  assert.equal(reasonFor(p({ lastPaidToChange: { from: "2026-10-01", to: "2026-09-01", on: "2026-09-05" }, daysPastDue: 2 }), T), null, "an older bounce since made good is not");
  assert.equal(reasonFor(p({ statusRaw: "Act-Ret Item" }), T), "bounced_draft", "a carrier that flags it explicitly");
  assert.equal(reasonFor(p({ paidTo: "2026-06-01", effectiveDate: "2026-06-01", daysPastDue: 129 }), T), "first_payment_missed");
  assert.equal(reasonFor(p({ status: "approved_unpaid", paidTo: null, effectiveDate: "2026-10-01", daysPastDue: null }), T), "first_payment_missed");
  assert.equal(reasonFor(p({}), T), "later_payment_missed", "7 days past due, 3 days' grace");
  assert.equal(reasonFor(p({ status: "lapsed", lapsedOn: "2026-09-20", reinstatementDays: 60 }), T), "recently_lapsed");
  assert.equal(reasonFor(p({ daysPastDue: 0, paymentMethod: "direct_bill" }), T), "direct_bill");
  assert.equal(reasonFor(p({ daysPastDue: 2 }), T), null, "inside grace, bank draft: nothing to do");
  assert.equal(reasonFor(p({ status: "lapsed", lapsedOn: "2026-05-01", reinstatementDays: 60 }), T), null, "past the reinstatement window");
  assert.equal(reasonFor(p({ status: "lapsed", lapsedOn: "2026-10-05", reinstatementDays: null }), T), "recently_lapsed", "no window: a lapse in the latest file is listed");
  assert.equal(reasonFor(p({ status: "lapsed", lapsedOn: "2026-09-05", reinstatementDays: null }), T), null, "no window: an older lapse is not, rather than a guessed window");
  assert.equal(reasonFor(p({ status: "approved_unpaid", paidTo: null, effectiveDate: "2026-10-20", daysPastDue: null }), T), null, "the first draft isn't due yet");
  assert.equal(reasonFor(p({ statusRaw: "Requested Termination", status: "lapsed" }), T), null, "a request on a policy already gone is not a save");
});

test("days left: the carrier window; the reinstatement window for a lapse; none for prevention", () => {
  assert.equal(daysLeftFor(p({ daysUntilClose: 2 }), "later_payment_missed", T), 2);
  assert.equal(daysLeftFor(p({ daysUntilClose: -4 }), "later_payment_missed", T), 0);
  assert.equal(daysLeftFor(p({ lapsedOn: "2026-09-20", reinstatementDays: 60 }), "recently_lapsed", T), 42);
  assert.equal(daysLeftFor(p({ lapsedOn: "2026-09-20", reinstatementDays: null }), "recently_lapsed", T), null);
  assert.equal(daysLeftFor(p({}), "direct_bill", T), null);
  assert.deepEqual([urgency(2), urgency(5), urgency(20), urgency(null)], ["red", "amber", "plain", "plain"]);
});

test("the default order: days left ascending, then money; no window in a labelled group below; prevention last", () => {
  const rows = [
    { key: "convert", reason: "direct_bill", daysLeft: null, atRiskCents: 90000 },
    { key: "nowindow", reason: "later_payment_missed", daysLeft: null, atRiskCents: 50000 },
    { key: "ten", reason: "later_payment_missed", daysLeft: 10, atRiskCents: 99999 },
    { key: "two-small", reason: "first_payment_missed", daysLeft: 2, atRiskCents: 1200 },
    { key: "two-big", reason: "first_payment_missed", daysLeft: 2, atRiskCents: 42840 },
    { key: "two-unknown", reason: "first_payment_missed", daysLeft: 2, atRiskCents: null },
  ].map((r) => ({ ...r, group: groupOf(r.reason, r.daysLeft) }));
  assert.deepEqual(boardOrder(rows).map((r) => r.key), ["two-big", "two-small", "two-unknown", "ten", "nowindow", "convert"]);
  assert.deepEqual(boardOrder(rows).map((r) => r.group), ["deadline", "deadline", "deadline", "deadline", "no_window", "prevention"]);
});

test("save rate per reason, carrier or agent: saved over decided, still-at-risk counted apart", () => {
  const rates = saveRates([
    { reason: "first_payment_missed", carrierId: "a", actedBy: "u1", result: "saved" },
    { reason: "first_payment_missed", carrierId: "a", actedBy: "u1", result: "saved" },
    { reason: "first_payment_missed", carrierId: "b", actedBy: "u2", result: "lost" },
    { reason: "later_payment_missed", carrierId: "a", actedBy: "u1", result: "lost" },
    { reason: "later_payment_missed", carrierId: "a", actedBy: "u2", result: "still_at_risk" },
  ], (a) => a.reason);
  assert.deepEqual(rates.get("first_payment_missed"), { saved: 2, lost: 1, open: 0, rate: 66 });
  assert.deepEqual(rates.get("later_payment_missed"), { saved: 0, lost: 1, open: 1, rate: 0 });
  assert.equal(saveRates([{ reason: "x", carrierId: "a", actedBy: null, result: null }], (a) => a.carrierId).get("a").rate, null);
});

test("the migration: a logged call never changes; the next file decides saved, still at risk or lost", () => {
  assert.match(sql, /A logged retention call never changes; log another\./);
  assert.match(sql, /revoke update, delete, truncate on public\.retention_action from service_role, tenant_app/);
  assert.match(sql, /when pc\.status_normalized in \('lapsed', 'not_taken'\) then 'lost'/);
  assert.match(sql, /pc\.paid_to_date > \(a\.board_state->>'paid_to'\)::date\) then 'saved'/);
  assert.match(sql, /pc\.last_snapshot_date > coalesce\(a\.result_snapshot_date, a\.board_snapshot_date, '-infinity'::date\)/);
});

test("nothing on the board is a prediction", () => {
  const source = readFileSync(new URL("./retentionBoard.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /predict|model|score|probabil/i);
});
