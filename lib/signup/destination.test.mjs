import assert from "node:assert/strict";
import test from "node:test";

import { PLAN_CHOOSABLE_STATES, PROFILE_EDITABLE_STATES, signupDestination } from "./destination.ts";

// Payment before the business profile (manager review, 2026-10-28; migration 20261028200000).
test("a verified owner goes to the plan, then payment; no state routes to the business profile", () => {
  const at = (onboardingState, userStatus = "active") => signupDestination({ userStatus, onboardingState });
  assert.equal(at("pending_verification", "pending_verification"), "/app/verify-email");
  assert.equal(at("ready_for_checkout"), "/app/onboarding/plan");
  assert.equal(at("business_profile"), "/app/onboarding/plan", "a row from before the migration still lands on the plan");
  assert.equal(at("awaiting_payment"), "/app/checkout");
  assert.equal(at("completed"), null, "a started plan has no sign-up step left");
  assert.equal(at("ready_for_checkout", "suspended"), null);
  for (const state of ["pending_verification", "business_profile", "ready_for_checkout", "awaiting_payment", "completed"]) {
    assert.notEqual(at(state), "/app/onboarding/business-profile");
  }
});

test("the business profile can be saved before, during and after payment", () => {
  assert.deepEqual([...PROFILE_EDITABLE_STATES], ["business_profile", "ready_for_checkout", "awaiting_payment", "completed"]);
});

test("the migration leads verification to checkout and never moves a tenant backwards", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("supabase/migrations/20261028200000_payment_before_profile.sql", "utf8");
  assert.match(sql, /set onboarding_state = 'ready_for_checkout'\s+where tenant\.id = v_tenant_id\s+and tenant\.onboarding_state = 'pending_verification'/);
  assert.match(sql, /not in \('business_profile', 'ready_for_checkout', 'awaiting_payment', 'completed'\)/);
  assert.match(sql, /case when v_state = 'business_profile' then 'ready_for_checkout' else v_state end/);
});

test("the plan step never sends someone back to itself", () => {
  // The plan page redirects any state it does not take to signupDestination; if that were the plan
  // page again, the browser would loop. Every state routed to the plan must be one it takes.
  for (const state of ["pending_verification", "business_profile", "ready_for_checkout", "awaiting_payment", "completed"]) {
    if (signupDestination({ userStatus: "active", onboardingState: state }) === "/app/onboarding/plan") {
      assert.ok(PLAN_CHOOSABLE_STATES.includes(state), `${state} is routed to the plan but the plan page refuses it`);
    }
  }
});
