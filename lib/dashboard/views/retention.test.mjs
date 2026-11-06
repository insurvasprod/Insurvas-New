import { test } from "node:test";
import assert from "node:assert/strict";

import { casesHref, dayIn, monthHref, monthKeys, servicingNeedsCheck, shapeCases, winbackReady } from "./retention.ts";

const base = { carrierId: "c1", carrierName: "Carrier", ownerId: "u1", unreachable: false, monthlyCents: 5000, resolvedAt: null, deadline: null, daysLeft: null, clientName: "Ann Lee" };
const kase = (over) => ({ ...base, id: over.id, policyNumber: `P-${over.id}`, step: "payment_problem", reason: "later_draft_failed", status: "open", ...over });

test("monthKeys counts back across a year end, oldest first", () => {
  assert.deepEqual(monthKeys("2026-02-14", 4).map((m) => m.key), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(monthKeys("2026-02-14", 1)[0].label, "Feb");
});

test("dayIn reads the day in the agency's zone, and falls back to UTC", () => {
  const at = Date.parse("2026-11-06T03:00:00Z");
  assert.equal(dayIn(at, "America/New_York"), "2026-11-05");
  assert.equal(dayIn(at, "Not/AZone"), "2026-11-06");
});

test("shapeCases: past due, paper bills, reasons, closing soonest", () => {
  const shape = shapeCases([
    kase({ id: "1", daysLeft: -3, deadline: "2026-11-03" }),
    kase({ id: "2", daysLeft: 2, deadline: "2026-11-08", step: "pending_lapse", reason: "pending_lapse" }),
    kase({ id: "3", daysLeft: 0, deadline: "2026-11-06" }),
    kase({ id: "4", step: "paperwork", reason: "mailed_bill" }),
    kase({ id: "5", daysLeft: 1, step: "lost", reason: "chargeback" }),
    kase({ id: "6", status: "saved", resolvedAt: "2026-11-02T12:00:00Z" }),
  ], "2026-11-06", "UTC");
  assert.equal(shape.open, 5);
  assert.equal(shape.pastDue, 1);
  assert.equal(shape.mailedBills, 1);
  assert.deepEqual(shape.byReason.map((r) => [r.reason, r.count]), [["later_draft_failed", 2], ["pending_lapse", 1], ["chargeback", 1], ["mailed_bill", 1]]); // ties by label
  // Lost and paperwork have no lapse ahead; a passed deadline is not "soonest".
  assert.deepEqual(shape.closingSoon.map((c) => c.id), ["3", "2"]);
});

test("shapeCases: saved and lost by month, this month, and the scorecard's rate", () => {
  const shape = shapeCases([
    kase({ id: "a", status: "saved", resolvedAt: "2026-11-01T02:00:00Z", monthlyCents: 3000 }),
    kase({ id: "b", status: "saved", resolvedAt: "2026-10-20T12:00:00Z", monthlyCents: 4000 }),
    kase({ id: "c", status: "lost", resolvedAt: "2026-10-21T12:00:00Z", monthlyCents: 2500 }),
    kase({ id: "d", status: "closed_no_save", resolvedAt: "2026-10-22T12:00:00Z" }),
    kase({ id: "e", status: "saved", resolvedAt: "2026-01-02T12:00:00Z" }),
  ], "2026-11-06", "America/New_York");
  const byKey = Object.fromEntries(shape.months.map((m) => [m.key, m]));
  assert.equal(shape.months.length, 6);
  // 02:00 UTC on Nov 1 is still October 31 in New York.
  assert.deepEqual([byKey["2026-10"].saved, byKey["2026-10"].savedCents, byKey["2026-10"].lost, byKey["2026-10"].lostCents], [2, 7000, 1, 2500]);
  assert.deepEqual(shape.thisMonth, { saved: 0, savedCents: 0, lost: 0 });
  assert.equal(byKey["2026-01"], undefined);
  // Closed without a save stays out of the rate (lib/retention/cases/scorecard).
  assert.deepEqual([shape.score.saved, shape.score.lost, shape.score.closedNoSave], [3, 1, 1]);
  assert.deepEqual(shape.recent.map((c) => c.id), ["a", "c", "b", "e"]);
});

test("servicingNeedsCheck is the board's Check it bucket", () => {
  const sent = { status: "submitted", unprovable: [], expectedEffectiveDate: null };
  assert.equal(servicingNeedsCheck(sent, "2026-11-06"), false);
  assert.equal(servicingNeedsCheck({ ...sent, expectedEffectiveDate: "2026-11-05" }, "2026-11-06"), true);
  assert.equal(servicingNeedsCheck({ ...sent, status: "confirmed_by_carrier" }, "2026-11-06"), true);
  assert.equal(servicingNeedsCheck({ ...sent, unprovable: ["draft_day"] }, "2026-11-06"), true);
  assert.equal(servicingNeedsCheck({ ...sent, status: "draft", expectedEffectiveDate: "2026-01-01" }, "2026-11-06"), false);
  assert.equal(servicingNeedsCheck({ ...sent, status: "verified_in_file", expectedEffectiveDate: "2026-01-01" }, "2026-11-06"), false);
});

test("winbackReady: on the list, or cooling-off over and not stuck", () => {
  const c = { band: "fair", releasedAt: null, eligibleFrom: "2026-11-01", blockedReason: null };
  assert.equal(winbackReady(c, "2026-11-06"), true);
  assert.equal(winbackReady({ ...c, eligibleFrom: "2026-12-01" }, "2026-11-06"), false);
  assert.equal(winbackReady({ ...c, blockedReason: "No phone" }, "2026-11-06"), false);
  assert.equal(winbackReady({ ...c, eligibleFrom: null, releasedAt: "2026-10-01" }, "2026-11-06"), true);
  assert.equal(winbackReady({ ...c, band: "never", releasedAt: "2026-10-01" }, "2026-11-06"), false);
});

test("links use the Cases page's own filters", () => {
  assert.equal(casesHref("/app/retention", { step: "paperwork", reason: "mailed_bill" }), "/app/retention?step=paperwork&reason=mailed_bill");
  assert.equal(casesHref("/app/retention", { deadline: "over" }), "/app/retention?deadline=over");
  assert.equal(casesHref("/app/retention", { step: "lapsed_reinstatable" }), "/app/retention?step=lapsed");
  assert.equal(casesHref("/app/retention", {}), "/app/retention");
  const links = { cases: "/app/retention", scorecard: "/app/retention-scorecard" };
  assert.equal(monthHref("2026-09-01", "2026-11-06", links), "/app/retention?step=closed");
  assert.equal(monthHref("2026-07-01", "2026-11-06", links), "/app/retention-scorecard?period=180");
  assert.equal(monthHref("2026-07-01", "2026-11-06", { cases: null, scorecard: null }), null);
});
