import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { heldSeat, seatCounts, seatLimitFor, seatState, seatsLabel, SEAT_HOLDING_STATUSES } from "./seats.ts";

test("active, suspended and invited people hold a seat; deactivated and deleted do not", () => {
  for (const status of ["active", "suspended", "invited", "pending_verification"]) assert.equal(heldSeat({ status, acceptedAt: null }), true, status);
  for (const status of ["inactive", "deactivated", "deleted", "", null, undefined, "something-new"]) assert.equal(heldSeat({ status, acceptedAt: "2026-01-01" }), false, String(status));
});

test("a membership that was never accepted is an invited seat, whatever the status says", () => {
  assert.equal(seatState({ status: "active", acceptedAt: null }), "invited");
  assert.equal(seatState({ status: "invited", acceptedAt: "2026-01-01" }), "invited");
  assert.equal(seatState({ status: "active", acceptedAt: "2026-01-01" }), "active");
  assert.equal(seatState({ status: "suspended", acceptedAt: null }), "suspended");
  assert.equal(seatState({ status: "inactive", acceptedAt: null }), null);
});

test("the breakdown adds up to the seats held", () => {
  const counts = seatCounts([
    { status: "active", acceptedAt: "x" },
    { status: "active", acceptedAt: "x" },
    { status: "suspended", acceptedAt: "x" },
    { status: "invited", acceptedAt: null },
    { status: "inactive", acceptedAt: "x" },
    { status: "deleted", acceptedAt: "x" },
  ]);
  assert.deepEqual(counts, { held: 4, active: 2, suspended: 1, invited: 1 });
  assert.equal(counts.held, counts.active + counts.suspended + counts.invited);
});

test("an individual plan without an explicit limit is one seat, not unlimited", () => {
  assert.equal(seatLimitFor(null, "individual"), 1);
  assert.equal(seatLimitFor(null, "agency"), null);
  assert.equal(seatLimitFor(12, "individual"), 12);
  assert.equal(seatsLabel(12, 12), "12 of 12 seats");
  assert.equal(seatsLabel(1, null), "1 seat · no limit");
});

test("the TypeScript rule and the SQL rule list the same statuses", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260924346000_one_seat_rule.sql", import.meta.url), "utf8");
  const match = /create or replace function public\.user_status_holds_seat[\s\S]*?p_status in \(([^)]*)\)/.exec(sql);
  assert.ok(match, "user_status_holds_seat not found in the migration");
  const statuses = match[1].split(",").map((part) => part.trim().replace(/'/g, "")).sort();
  assert.deepEqual(statuses, [...SEAT_HOLDING_STATUSES].sort());
});

test("the TypeScript and SQL seat limits share the individual-plan fallback, and every join check uses it", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260924346000_one_seat_rule.sql", import.meta.url), "utf8");
  const limit = /create or replace function public\.tenant_seat_limit[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql);
  assert.ok(limit, "tenant_seat_limit not found in the migration");
  // SQL: coalesce(max_seats, 1 when the plan is individual) — the same as seatLimitFor.
  assert.match(limit[1], /coalesce\(pl\.max_seats,\s*case when p\.plan_type::text = 'individual' then 1 end\)/);
  for (const [maxSeats, planType] of [[null, "individual"], [null, "agency"], [5, "individual"], [0, "individual"], [null, null]]) {
    const sqlAnswer = maxSeats !== null ? maxSeats : planType === "individual" ? 1 : null;
    assert.equal(seatLimitFor(maxSeats, planType), sqlAnswer, `${maxSeats}/${planType}`);
  }
  // Invite, attach and the status-transition check (reactivation) all read the limit through it.
  for (const fn of ["assert_user_seat_transition", "admin_attach_user_to_tenant", "tenant_invite_user_with_auth"]) {
    const body = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`).exec(sql);
    assert.ok(body, `${fn} not found`);
    assert.match(body[0], /tenant_seat_limit\(/, `${fn} must use tenant_seat_limit`);
    assert.doesNotMatch(body[0], /select\s+(?:pl|l)\.max_seats/, `${fn} still reads max_seats directly`);
  }
});
