import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pageFrom, userDetailTabFrom, userStatusTone, utcDate, utcDateTime } from "./detailFormat.ts";

test("times print in UTC with the zone named, whatever the server's zone", () => {
  assert.equal(utcDate("2026-01-04T23:30:00Z"), "4 Jan 2026");
  assert.equal(utcDateTime("2026-09-18T14:02:41Z"), "18 Sep 2026 14:02 UTC");
  assert.equal(utcDateTime("2026-09-18T23:59:00-02:00"), "19 Sep 2026 01:59 UTC");
  for (const bad of [null, undefined, "", "not a date"]) {
    assert.equal(utcDate(bad), "—");
    assert.equal(utcDateTime(bad), "—");
  }
});

test("unknown tabs and pages fall back to the first", () => {
  assert.equal(userDetailTabFrom(undefined), "login");
  assert.equal(userDetailTabFrom("sessions"), "sessions");
  assert.equal(userDetailTabFrom(["audit", "login"]), "audit");
  assert.equal(userDetailTabFrom("billing"), "login");
  assert.equal(pageFrom("3"), 3);
  for (const bad of [undefined, "0", "-2", "abc", "1.9"]) assert.equal(pageFrom(bad), 1, String(bad));
});

test("suspended reads red; every status the table holds gets a tone", () => {
  assert.equal(userStatusTone("suspended"), "error");
  assert.equal(userStatusTone("active"), "success");
  assert.equal(userStatusTone("invited"), "info");
  assert.equal(userStatusTone("pending_verification"), "info");
  for (const s of ["inactive", "deactivated", "", null, "something-new"]) assert.equal(userStatusTone(s), "neutral");
});

test("the page keeps status changes on the existing routes and adds no write of its own", () => {
  const actions = readFileSync(new URL("../../components/admin/user-detail-actions.tsx", import.meta.url), "utf8");
  for (const route of ["unsuspend", "activate", "deactivate", "send-reset", "resend-invite"]) {
    assert.match(actions, new RegExp(`"${route}"`), route);
  }
  // Suspend goes through the shared dialog, which posts to /suspend with the mandatory reason.
  assert.match(actions, /SuspendUserDialog/);
  assert.doesNotMatch(actions, /method: "(PATCH|DELETE|PUT)"/);
});
