// AG-0.7 · suspend and offboard, with the frozen-balance confirmation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chargebackOwner, freezeBalance, offboardSentence } from "./offboardCore.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261018150000_ag_0_7_suspend_and_offboard.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/app/agency/producers/[id]/offboard/route.ts", import.meta.url), "utf8");

test("a negative balance survives offboarding unchanged", () => {
  assert.equal(freezeBalance(-72_000), -72_000);
  assert.match(sql, /frozen_balance_cents = v_preview\.balance_cents/);
  assert.doesNotMatch(sql, /greatest\(\s*0|clamp/i);
});

test("a lapse after the offboarding date is the agency's, not the producer's", () => {
  const maria = { status: "offboarded", offboardedOn: "2026-10-18" };
  assert.equal(chargebackOwner(maria, "2026-11-02"), "agency");
  assert.equal(chargebackOwner(maria, "2026-10-01"), "producer", "a chargeback dated before he left is still his");
  assert.equal(chargebackOwner({ status: "active", offboardedOn: null }, "2026-11-02"), "producer");
});

test("the confirmation shows the exposure, in a plain sentence, before the button", () => {
  assert.equal(offboardSentence("Maria Ruiz", 16), "Lapses on these 16 policies after today will be charged to the agency, not to Maria Ruiz.");
  assert.equal(offboardSentence("Dev Shah", 1), "Lapses on this 1 policy after today will be charged to the agency, not to Dev Shah.");
  assert.match(route, /export async function GET/);
  assert.match(route, /z\.literal\("OFFBOARD"/);
});

test("offboarding never deletes or reassigns book rows; it is reversible for 30 days; the seat runs to period end", () => {
  assert.doesNotMatch(sql, /delete from public\.(policy|commission|producer)/i);
  assert.match(sql, /current_date \+ 30/);
  assert.match(sql, /reactivation_window_closed/);
  assert.match(sql, /p\.status = 'offboarded' and p\.seat_released_on >= current_date/);
});

test("login is blocked per membership, not per account (one person, two agencies)", () => {
  assert.match(sql, /update public\.tenant_users set access_blocked_at = now\(\)/);
  assert.doesNotMatch(sql, /update public\.users set status/);
  const session = readFileSync(new URL("../tenantAuth/requireTenant.ts", import.meta.url), "utf8");
  assert.match(session, /if \(read\.data\.access_blocked_at\) return null;/);
});
