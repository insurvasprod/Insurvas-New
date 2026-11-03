import { test } from "node:test";
import assert from "node:assert/strict";

import { lifecycleOf, LIFECYCLE_STATUSES, USER_LIFECYCLES } from "./lifecycle.ts";
import { heldSeat, seatState } from "../tenantTeam/seats.ts";
import { loginCell, orderLabel, tileText } from "./present.ts";

const T = "tenant-1";

test("a member's state is the seat they hold (the one seat rule)", () => {
  for (const status of ["active", "suspended", "invited", "pending_verification", "inactive", "deactivated", "deleted"]) {
    for (const acceptedAt of [null, "2026-09-01T00:00:00Z"]) {
      const state = lifecycleOf({ status, tenantId: T, acceptedAt });
      const seat = seatState({ status, acceptedAt });
      if (seat) assert.equal(state, seat, `${status}/${acceptedAt}`);
      else assert.ok(state === "deactivated" || state === null, `${status}/${acceptedAt} -> ${state}`);
      // Holds a seat exactly when the list calls it active, invited or suspended.
      assert.equal(heldSeat({ status, acceptedAt }), ["active", "invited", "suspended"].includes(state ?? ""), status);
    }
  }
});

test("an active member who never accepted is invited, not active", () => {
  assert.equal(lifecycleOf({ status: "active", tenantId: T, acceptedAt: null }), "invited");
  assert.equal(lifecycleOf({ status: "active", tenantId: T, acceptedAt: "2026-09-01T00:00:00Z" }), "active");
});

test("a person in no tenant is judged by their account status alone", () => {
  assert.equal(lifecycleOf({ status: "active", tenantId: null, acceptedAt: null }), "active");
  assert.equal(lifecycleOf({ status: "invited", tenantId: null, acceptedAt: null }), "invited");
  assert.equal(lifecycleOf({ status: "pending_verification", tenantId: null, acceptedAt: null }), "invited");
  assert.equal(lifecycleOf({ status: "suspended", tenantId: null, acceptedAt: null }), "suspended");
  assert.equal(lifecycleOf({ status: "inactive", tenantId: null, acceptedAt: null }), "deactivated");
  assert.equal(lifecycleOf({ status: "deactivated", tenantId: null, acceptedAt: null }), "deactivated");
  assert.equal(lifecycleOf({ status: "deleted", tenantId: null, acceptedAt: null }), null);
});

test("every status behind a state maps back to that state for a tenantless row", () => {
  for (const state of USER_LIFECYCLES) {
    for (const status of LIFECYCLE_STATUSES[state]) {
      assert.equal(lifecycleOf({ status, tenantId: null, acceptedAt: null }), state);
    }
  }
});

test("login times are UTC with the zone, and the year only outside the reading year", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  assert.equal(loginCell("2026-09-22T08:12:40Z", now), "22 Sep 08:12 UTC");
  assert.equal(loginCell("2025-08-02T11:40:00Z", now), "2 Aug 2025 11:40 UTC");
  assert.equal(loginCell(null, now), "—");
});

test("the footer names the order the query uses", () => {
  assert.equal(orderLabel("created_at", "desc"), "newest first");
  assert.equal(orderLabel("last_login_at", "desc"), "latest login first, never signed in last");
});

test("tile footnotes never claim what the counts do not say", () => {
  const base = { rows: 10, tenants: 3, tenantless: 0, active: 7, invited: 2, invitedStale: 0, suspended: 1, suspendedNoReason: 1, deactivated: 0 };
  const t = tileText(base);
  assert.equal(t.users.footnote, "across 3 tenants");
  assert.equal(t.active.footnote, "70.0%");
  assert.equal(t.invited.footnote, "none over 7 days old");
  assert.equal(t.suspended.footnote, "1 without a reason");
  assert.equal(tileText({ ...base, suspended: 0, suspendedNoReason: 0 }).suspended.footnote, "none right now");
  assert.equal(tileText({ ...base, suspended: 4, suspendedNoReason: 0 }).suspended.footnote, "each with a reason");
  assert.equal(tileText({ ...base, tenantless: 5 }).users.footnote, "across 3 tenants, 5 in none");
});
