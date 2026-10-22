// AG-0.1 · agency record, producer record, plan audience.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { audienceForPlanType, bandFor, holdsAgencySeat } from "./constants.ts";
import { producerProfileUpdateSchema } from "./schemas.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261018100000_ag_0_1_agency_and_producer.sql", import.meta.url), "utf8");

test("one agency row per tenant is enforced by a database constraint, not by code", () => {
  assert.match(sql, /constraint agency_one_per_tenant unique \(tenant_id\)/);
  // and the migration proves it against the live database it is applied to
  assert.match(sql, /a second agency row for one tenant was accepted/);
});

test("no application role can write producer.can_submit", () => {
  assert.match(sql, /revoke insert, update, delete, truncate on public\.agency, public\.producer from service_role, tenant_app;/);
  const grants = sql.split("\n").filter((line) => /^grant (insert|update)/.test(line) && /public\.producer/.test(line));
  assert.ok(grants.length >= 2, "producer has column-scoped grants");
  for (const line of grants) assert.doesNotMatch(line, /can_submit/, line);
  assert.match(sql, /can_submit boolean not null default false/);
});

test("can_submit cannot be set through the ordinary producer-update API", () => {
  assert.equal(producerProfileUpdateSchema.safeParse({ canSubmit: true }).success, false);
  assert.equal(producerProfileUpdateSchema.safeParse({ can_submit: true }).success, false);
  assert.equal(producerProfileUpdateSchema.safeParse({ displayName: "Maria Ruiz", canSubmit: true }).success, false);
  assert.equal(producerProfileUpdateSchema.safeParse({ displayName: "Maria Ruiz" }).success, true);
});

test("ein is stored as the last four digits only", () => {
  assert.match(sql, /ein_last4 text,/);
  assert.match(sql, /ein_last4 ~ '\^\[0-9\]\{4\}\$'/);
  assert.doesNotMatch(sql, /\bein text\b|\bein_full\b/);
});

test("audience is derived from plan_type; unknown is absent, not guessed", () => {
  assert.equal(audienceForPlanType("individual"), "individual");
  assert.equal(audienceForPlanType("agency_with_teams"), "agency");
  assert.equal(audienceForPlanType("agency_no_teams"), "agency");
  assert.equal(audienceForPlanType("management"), null);
  assert.equal(audienceForPlanType(null), null);
});

test("every working member holds a seat — assistants included; invited and released ones do not; bands are flat", () => {
  const member = (extra) => ({ accepted: true, accountStatus: "active", producerStatus: null, today: "2026-10-20", ...extra });
  assert.equal(holdsAgencySeat(member({})), true, "an assistant (no producer row) uses a seat");
  assert.equal(holdsAgencySeat(member({ producerStatus: "active" })), true);
  assert.equal(holdsAgencySeat(member({ producerStatus: "suspended", accountStatus: "suspended" })), true);
  assert.equal(holdsAgencySeat(member({ accepted: false })), false, "an invited member holds none");
  assert.equal(holdsAgencySeat(member({ producerStatus: "invited", accepted: false })), false);
  assert.equal(holdsAgencySeat(member({ producerStatus: "offboarded", seatReleasedOn: "2026-10-31" })), true, "until the period ends");
  assert.equal(holdsAgencySeat(member({ producerStatus: "offboarded", seatReleasedOn: "2026-10-01" })), false);
  assert.equal(bandFor(50).band, "to_50");
  assert.equal(bandFor(51).band, "to_150");
  assert.equal(bandFor(400).band, "over_150");
  assert.equal(bandFor(51).priceCents, 249_900);
});

test("agency_id starts being populated on the LA-4…LA-7 tables", () => {
  for (const table of ["commission_entry", "policy_current", "cost_entry", "producer_ledger_entry"]) {
    assert.ok(sql.includes(`'${table}'`), table);
  }
  assert.match(sql, /new\.agency_id := public\.tenant_agency_id\(new\.tenant_id\)/);
});
