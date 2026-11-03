// A partner user invited by the agency must be able to sign in once they set a password (E2E 2026-10-16:
// the live consume_partner_password_token never left 'invited', so every invited partner was locked out).
// Run with: node --test lib/partnerAuth/setPasswordActivates.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(join(process.cwd(), "app/api/partner/auth/set-password/route.ts"), "utf8");

test("setting the password activates the account, only from 'invited', after the token is consumed", () => {
  const consume = route.indexOf(`rpc("consume_partner_password_token"`);
  const activate = route.indexOf(`.update({ status: "active" }).eq("id", invitation.user_id).filter("status", "eq", "invited")`);
  assert.ok(consume > 0, "the token is consumed through the database function");
  assert.ok(activate > consume, "the account is activated after the token is consumed");
});
