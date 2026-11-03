import assert from "node:assert/strict";
import test from "node:test";

import { credentialAction, resetRefusal } from "./credential.ts";

test("a joined member with no stored hash gets a reset, not an invitation", () => {
  assert.equal(credentialAction({ status: "active", hasPassword: false, acceptedMembership: true }), "reset");
  assert.equal(credentialAction({ status: "active", hasPassword: true, acceptedMembership: false }), "reset");
});

test("someone never onboarded is still invited", () => {
  assert.equal(credentialAction({ status: "active", hasPassword: false, acceptedMembership: false }), "invite");
  assert.equal(credentialAction({ status: "pending_verification", hasPassword: false, acceptedMembership: false }), "invite");
});

test("a suspended or deactivated account gets no reset (consuming one would reactivate it)", () => {
  assert.equal(credentialAction({ status: "suspended", hasPassword: true, acceptedMembership: true }), null);
  assert.equal(credentialAction({ status: "inactive", hasPassword: false, acceptedMembership: true }), null);
  assert.match(resetRefusal({ status: "suspended", hasPassword: true, acceptedMembership: true }), /active account/);
  assert.match(resetRefusal({ status: "active", hasPassword: false, acceptedMembership: false }), /invitation/);
  assert.equal(resetRefusal({ status: "active", hasPassword: false, acceptedMembership: true }), null);
});
