import test from "node:test";
import assert from "node:assert/strict";

import {
  activeFilterCount,
  decodeActorChoice,
  encodeActorChoice,
  formatUtc,
  isApproximateCount,
  parseAuditLogFilters,
  quotePostgrestValue,
  relativeTime,
  searchMatchingActions,
  utcDayBounds,
} from "./logView.ts";
import { isMoneyAction } from "./moneyActions.ts";

const ACTIONS = ["user.suspended", "credit_note.approved", "feature.switch_changed", "invoice.voided"];
const LABELS = {
  "user.suspended": "User suspended",
  "credit_note.approved": "Credit note approved",
  "feature.switch_changed": "Feature kill switch changed",
  "invoice.voided": "Invoice voided",
};
const params = (o) => new URLSearchParams(o);

test("the to-date includes the whole of its UTC day", () => {
  const b = utcDayBounds("2026-09-21", "2026-09-22");
  assert.equal(b.gte, "2026-09-21T00:00:00.000Z");
  // `< next midnight`, not `<= "2026-09-22"` (which was midnight at the START of the 22nd).
  assert.equal(b.lt, "2026-09-23T00:00:00.000Z");
  assert.equal(utcDayBounds(null, "2026-12-31").lt, "2027-01-01T00:00:00.000Z");
  assert.deepEqual(utcDayBounds(null, null), { gte: null, lt: null });
});

test("filters drop anything malformed instead of forwarding it", () => {
  const f = parseAuditLogFilters(
    params({ action: "drop.table", actorType: "root", actorId: "not-a-uuid", from: "2026-02-30", to: "yesterday", page: "-3" }),
    ACTIONS,
  );
  assert.deepEqual(
    { action: f.action, actorType: f.actorType, actorId: f.actorId, from: f.from, to: f.to, page: f.page },
    { action: null, actorType: null, actorId: null, from: null, to: null, page: 1 },
  );
  const ok = parseAuditLogFilters(
    params({ action: "user.suspended", actorType: "tenant", from: "2026-09-01", to: "2026-09-22", target: "  abc  ", q: " suspend ", page: "3" }),
    ACTIONS,
  );
  assert.equal(ok.action, "user.suspended");
  assert.equal(ok.actorType, "tenant");
  assert.equal(ok.target, "abc");
  assert.equal(ok.q, "suspend");
  assert.equal(ok.page, 3);
});

test("times are absolute UTC whatever the machine's zone, with a relative hint", () => {
  assert.equal(formatUtc("2026-09-22T08:40:55.123Z"), "22 Sep 2026 08:40:55 UTC");
  assert.equal(formatUtc("2026-01-02T23:05:09+02:00"), "02 Jan 2026 21:05:09 UTC");
  const now = Date.parse("2026-09-22T08:45:00Z");
  assert.equal(relativeTime("2026-09-22T08:40:55Z", now), "4 minutes ago");
  assert.equal(relativeTime("2026-09-22T08:44:30Z", now), "just now");
  assert.equal(relativeTime("2026-09-21T17:02:18Z", now), "15 hours ago");
  assert.equal(relativeTime("2026-09-21T08:44:00Z", now), "1 day ago");
});

test("search matches action codes and labels; everything else is an exact target id", () => {
  assert.deepEqual(searchMatchingActions("suspend", ACTIONS, LABELS), ["user.suspended"]);
  assert.deepEqual(searchMatchingActions("KILL SWITCH", ACTIONS, LABELS), ["feature.switch_changed"]);
  assert.deepEqual(searchMatchingActions("8f3a2c1e", ACTIONS, LABELS), []);
  assert.deepEqual(searchMatchingActions("   ", ACTIONS, LABELS), []);
  assert.equal(quotePostgrestValue('a,b"c\\d'), '"a,b\\"c\\\\d"');
});

test("the actor dropdown round-trips kinds and people, and rejects anything else", () => {
  const id = "0b9f5d2e-8c1a-4f3b-9d6e-2a7c4b1e0f93";
  assert.equal(encodeActorChoice({ actorType: null, actorId: id }), `id:${id}`);
  assert.deepEqual(decodeActorChoice(`id:${id}`), { actorType: null, actorId: id });
  assert.deepEqual(decodeActorChoice("type:system"), { actorType: "system", actorId: null });
  assert.deepEqual(decodeActorChoice("type:root"), { actorType: null, actorId: null });
  assert.deepEqual(decodeActorChoice("all"), { actorType: null, actorId: null });
});

test("the Filters badge counts action, date range and target once each", () => {
  assert.equal(activeFilterCount({ action: null, from: "", to: "", target: null }), 0);
  assert.equal(activeFilterCount({ action: "user.suspended", from: "2026-09-01", to: "2026-09-02", target: null }), 2);
  assert.equal(activeFilterCount({ action: "user.suspended", from: "", to: "2026-09-02", target: "x" }), 3);
});

test("counts past the exact ceiling are said as approximate", () => {
  assert.equal(isApproximateCount(412), false);
  assert.equal(isApproximateCount(1000), false);
  assert.equal(isApproximateCount(45210), true);
});

test("money actions are credit notes, voids, manual payments, credit grants, billing and waivers", () => {
  for (const a of ["credit_note.requested", "credit_note.approved", "credit_note.reconciled", "invoice.voided",
    "payment.recorded_manually", "credit_grant.created", "billing.period_run", "billing.waiver_granted", "billing.waiver_revoked"]) {
    assert.ok(isMoneyAction(a), a);
  }
  for (const a of ["user.suspended", "invoice.custom_created", "plan.version_created", "credit_pack.created"]) {
    assert.ok(!isMoneyAction(a), a);
  }
});
