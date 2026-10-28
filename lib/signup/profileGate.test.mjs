import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PROFILE_GATE_PATH, needsProfileGate, sessionKey } from "./profileGate.ts";

const owner = { role: "owner", userStatus: "active", onboardingState: "completed", signedUpHere: true, hasProfile: false, skippedSession: null, currentSession: "s1" };

test("a self-serve owner without a business profile is gated once the plan has started", () => {
  assert.equal(needsProfileGate(owner), true);
});

test("a saved profile, another role, or an unfinished sign-up is never gated", () => {
  assert.equal(needsProfileGate({ ...owner, hasProfile: true }), false, "saving it clears the gate");
  for (const role of ["producer", "manager", "assistant", "bookkeeper"]) assert.equal(needsProfileGate({ ...owner, role }), false, role);
  for (const state of ["ready_for_checkout", "awaiting_payment", "business_profile", "not_started"]) {
    assert.equal(needsProfileGate({ ...owner, onboardingState: state }), false, `${state}: sign-up routes it, not the gate`);
  }
  assert.equal(needsProfileGate({ ...owner, userStatus: "suspended" }), false);
});

test("agencies that did not come through self-serve sign-up are never gated", () => {
  assert.equal(needsProfileGate({ ...owner, signedUpHere: false }), false);
});

test("Skip lets this login through and the next login is asked", () => {
  assert.equal(needsProfileGate({ ...owner, skippedSession: "s1", currentSession: "s1" }), false, "the same login");
  assert.equal(needsProfileGate({ ...owner, skippedSession: "s1", currentSession: "s2" }), true, "a new sign-in");
});

test("a login's key changes with every sign-in", () => {
  assert.equal(sessionKey({ sid: "abc", exp: 5 }), "abc");
  assert.equal(sessionKey({ exp: 5 }), "exp:5", "older cookies without a session row");
  assert.notEqual(sessionKey({ exp: 5 }), sessionKey({ exp: 6 }));
});

test("the shell blocks every app page through the gate, after legal and maintenance", () => {
  const layout = readFileSync("app/app/(shell)/layout.tsx", "utf8").replace(/\r\n/g, "\n");
  const legal = layout.indexOf('redirect("/app/accept-terms")');
  const maintenance = layout.indexOf('redirect("/maintenance")');
  const gate = layout.indexOf("redirect(PROFILE_GATE_PATH)");
  assert.ok(gate > legal && gate > maintenance, "the gate comes after legal re-acceptance and the maintenance lock");
  assert.match(layout, /needsProfileGate\(\{/);
  assert.equal(PROFILE_GATE_PATH, "/app/onboarding/business-profile?finish=1");
});
