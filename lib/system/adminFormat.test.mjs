import test from "node:test";
import assert from "node:assert/strict";
import {
  announcementState,
  announcementWindow,
  canChangeMaintenance,
  confirmsLock,
  fromUtcInput,
  maintenanceDraftError,
  toUtcInput,
  utcDateTime,
} from "./adminFormat.ts";

const NOW = Date.parse("2026-09-24T12:00:00Z");

test("only a super admin may change maintenance mode", () => {
  assert.equal(canChangeMaintenance("super_admin"), true);
  for (const role of ["platform_config", "support_agent", "billing_admin", ""]) assert.equal(canChangeMaintenance(role), false);
});

test("the lock phrase must be typed, not approximated", () => {
  assert.equal(confirmsLock("lock every workspace"), true);
  assert.equal(confirmsLock("  Lock  every   WORKSPACE "), true);
  assert.equal(confirmsLock("lock"), false);
  assert.equal(confirmsLock("confirm"), false);
});

test("datetime inputs are read and written in UTC", () => {
  assert.equal(toUtcInput("2026-09-22T03:00:00.000Z"), "2026-09-22T03:00");
  assert.equal(fromUtcInput("2026-09-22T03:00"), "2026-09-22T03:00:00.000Z");
  assert.equal(fromUtcInput(toUtcInput("2026-12-31T23:59:00Z")), "2026-12-31T23:59:00.000Z");
  assert.equal(fromUtcInput(""), null);
  assert.equal(fromUtcInput("22/09/2026 03:00"), null);
  assert.equal(toUtcInput(null), "");
});

test("times print in UTC with the zone", () => {
  assert.equal(utcDateTime("2026-09-25T03:00:00Z"), "25 Sep 2026 03:00 UTC");
  assert.equal(utcDateTime("2026-01-05T23:07:00Z"), "5 Jan 2026 23:07 UTC");
  assert.equal(utcDateTime(null), "—");
});

test("announcement windows read like the board", () => {
  assert.equal(announcementWindow("2026-09-20T00:00:00Z", "2026-10-04T00:00:00Z"), "20 Sep – 4 Oct 2026");
  assert.equal(announcementWindow("2026-09-21T09:00:00Z", "2026-09-21T10:00:00Z"), "21 Sep 2026");
  assert.equal(announcementWindow("2026-12-30T00:00:00Z", "2027-01-02T00:00:00Z"), "30 Dec 2026 – 2 Jan 2027");
});

test("announcement state follows the customer rule: start inclusive, end exclusive", () => {
  assert.equal(announcementState({ starts_at: "2026-09-24T12:00:00Z", ends_at: "2026-09-25T00:00:00Z" }, NOW), "live");
  assert.equal(announcementState({ starts_at: "2026-09-24T13:00:00Z", ends_at: "2026-09-25T00:00:00Z" }, NOW), "scheduled");
  assert.equal(announcementState({ starts_at: "2026-09-23T00:00:00Z", ends_at: "2026-09-24T12:00:00Z" }, NOW), "expired");
});

test("a maintenance draft is refused for the reasons the route would refuse it, and one more", () => {
  const base = { level: "read_only", message: "Upgrading the dialer.", start: "", end: "" };
  assert.equal(maintenanceDraftError(base, NOW), null);
  assert.equal(maintenanceDraftError({ ...base, level: "off", message: "" }, NOW), null);
  assert.match(maintenanceDraftError({ ...base, message: "  " }, NOW), /message/);
  assert.match(maintenanceDraftError({ ...base, start: "2026-09-24T13:00" }, NOW), /scheduled end as well/);
  assert.equal(maintenanceDraftError({ ...base, end: "2026-09-24T15:00" }, NOW), null, "an end alone is allowed");
  assert.match(maintenanceDraftError({ ...base, end: "2026-09-24T11:00" }, NOW), /already passed/);
  assert.match(maintenanceDraftError({ ...base, start: "2026-09-24T16:00", end: "2026-09-24T15:00" }, NOW), /after the start/);
});
