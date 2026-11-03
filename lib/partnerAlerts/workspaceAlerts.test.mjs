import assert from "node:assert/strict";
import test from "node:test";

import { duplicateRateAlert, partnerStatusAlert, partnerWorkspaceAlerts } from "./workspaceAlerts.ts";

test("an active partner has no status alert; the others say what to do", () => {
  assert.equal(partnerStatusAlert("active"), null);
  assert.equal(partnerStatusAlert("paused").severity, "critical");
  assert.equal(partnerStatusAlert("offboarded").title, "Submissions closed");
  assert.equal(partnerStatusAlert("draft").severity, "warning");
  assert.equal(partnerStatusAlert("paused").actionLabel, "Message your agent");
});

test("a rising duplicate rate is an alert, with both weeks in the sentence", () => {
  const alert = duplicateRateAlert({ sent: 100, duplicates: 11 }, { sent: 80, duplicates: 4 });
  assert.ok(alert);
  assert.match(alert.body, /^11% of what your team sent/);
  assert.match(alert.body, /up from 5% the week before/);
  assert.equal(alert.link, "/partner/team-review");
});

test("no alert on a small sample, a low rate, or a rate that did not rise", () => {
  assert.equal(duplicateRateAlert({ sent: 9, duplicates: 5 }, { sent: 0, duplicates: 0 }), null);
  assert.equal(duplicateRateAlert({ sent: 100, duplicates: 4 }, { sent: 100, duplicates: 0 }), null);
  assert.equal(duplicateRateAlert({ sent: 100, duplicates: 10 }, { sent: 100, duplicates: 10 }), null);
  assert.equal(duplicateRateAlert({ sent: 100, duplicates: 10 }, { sent: 50, duplicates: 8 }), null);
});

test("a first week with duplicates says there were none before", () => {
  assert.match(duplicateRateAlert({ sent: 20, duplicates: 4 }, { sent: 0, duplicates: 0 }).body, /up from none/);
});

test("the rate is for partner admins only, and status always comes first", () => {
  const counts = { current: { sent: 100, duplicates: 20 }, previous: { sent: 100, duplicates: 1 } };
  assert.deepEqual(partnerWorkspaceAlerts({ status: "paused", isAdmin: true, ...counts }).map((a) => a.id), ["partner-status-paused", "duplicate-rate"]);
  assert.deepEqual(partnerWorkspaceAlerts({ status: "active", isAdmin: false, ...counts }), []);
  assert.deepEqual(partnerWorkspaceAlerts({ status: "active", isAdmin: true, current: null, previous: null }), []);
});
