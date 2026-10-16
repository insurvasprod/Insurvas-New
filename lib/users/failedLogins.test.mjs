// LA-8 audit · the security log's failed sign-ins follow the person, not today's address.
// Run with: node --experimental-strip-types --test lib/users/failedLogins.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { ownFailedLogins } from "../tenantAuth/securityRules.ts";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("failed sign-ins are matched by user id, then by current and former addresses no account claimed", () => {
  const former = new Map([["old@example.test", "2026-10-10T00:00:00.000Z"]]);
  const rows = [
    { id: "1", ts: "2026-10-12T00:00:00.000Z", ip: "1.1.1.1", user_id: ME, email: "new@example.test" },
    { id: "2", ts: "2026-10-05T00:00:00.000Z", ip: "2.2.2.2", user_id: ME, email: "old@example.test" }, // before the change, tied to me
    { id: "3", ts: "2026-10-06T00:00:00.000Z", ip: "3.3.3.3", user_id: null, email: "old@example.test" }, // old address, no account matched, while it was mine
    { id: "4", ts: "2026-10-11T00:00:00.000Z", ip: "4.4.4.4", user_id: null, email: "old@example.test" }, // old address after I left it: not mine
    { id: "5", ts: "2026-10-13T00:00:00.000Z", ip: "5.5.5.5", user_id: OTHER, email: "new@example.test" }, // someone else's account
    { id: "6", ts: "2026-10-14T00:00:00.000Z", ip: "6.6.6.6", user_id: null, email: "NEW@example.test" }, // current address
    { id: "1", ts: "2026-10-12T00:00:00.000Z", ip: "1.1.1.1", user_id: ME, email: "new@example.test" }, // the same row from both queries
  ];
  assert.deepEqual(ownFailedLogins(rows, ME, "new@example.test", former).map((r) => r.ip), ["6.6.6.6", "1.1.1.1", "3.3.3.3", "2.2.2.2"]);
});

test("the security log queries by user id, not by the email of today", () => {
  const source = fs.readFileSync("lib/users/securityEvents.ts", "utf8");
  assert.match(source, /from\("login_events"\)\.select\(columns\)\.eq\("actor_type", "user"\)\.eq\("user_id", userId\)/);
  assert.match(source, /\.in\("email", \[email\.toLowerCase\(\), \.\.\.formerEmails\.keys\(\)\]\)\.is\("user_id", null\)/);
  assert.doesNotMatch(source, /\.eq\("email", email\.toLowerCase\(\)\)\.eq\("success", false\)/);
});
