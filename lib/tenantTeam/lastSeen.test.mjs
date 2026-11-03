import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lastSeenCell, newestStamp, relativeSeen, shouldTouchPresence } from "./lastSeen.ts";

const now = Date.parse("2026-09-24T12:00:00Z");
const ago = (ms) => new Date(now - ms).toISOString();

test("last seen reads the way the board writes it", () => {
  assert.equal(relativeSeen(ago(30_000), now), "Now");
  assert.equal(relativeSeen(ago(4 * 60_000), now), "4 min ago");
  assert.equal(relativeSeen(ago(61 * 60_000), now), "1 hr ago");
  assert.equal(relativeSeen(ago(3 * 86_400_000), now), "3 days ago");
});

test("presence wins; without it the sign-in is labelled as a sign-in, never as presence", () => {
  assert.equal(lastSeenCell({ lastSeenAt: ago(4 * 60_000), lastLoginAt: ago(3 * 86_400_000) }, now), "4 min ago");
  assert.equal(lastSeenCell({ lastSeenAt: null, lastLoginAt: ago(3 * 86_400_000) }, now), "Signed in 3 days ago");
  assert.equal(lastSeenCell({ lastSeenAt: null, lastLoginAt: ago(10_000) }, now), "Signed in just now");
  assert.equal(lastSeenCell({}, now), "Never signed in");
});

test("the newest stamp of several is the one shown", () => {
  assert.equal(newestStamp(ago(60_000), null, ago(10_000), undefined), ago(10_000));
  assert.equal(newestStamp(null, undefined), null);
});

test("presence writes are throttled to one a minute per member", () => {
  assert.equal(shouldTouchPresence(undefined, now), true);
  assert.equal(shouldTouchPresence(now - 30_000, now), false);
  assert.equal(shouldTouchPresence(now - 60_000, now), true);
});

test("the alert-feed poll is what records presence, after the response", () => {
  const route = readFileSync(join(process.cwd(), "app", "api", "app", "notifications", "route.ts"), "utf8");
  assert.match(route, /after\(\(\) => touchMemberPresence\(/);
  const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "20260924220400_team_member_last_seen.sql"), "utf8");
  assert.match(migration, /interval '1 minute'/, "the database refuses a second write inside a minute too");
});

test("revoking an invite only touches this tenant's invitations", () => {
  const service = readFileSync(join(process.cwd(), "lib", "tenantTeam", "service.ts"), "utf8");
  const revoke = service.slice(service.indexOf("export async function revokeTenantInvite"));
  const deletes = [...revoke.matchAll(/from\("user_invitations"\)\.delete\(\)[^;]*/g)].map((match) => match[0]);
  assert.ok(deletes.length >= 1);
  // Every delete is either tenant-scoped or limited to legacy rows with no tenant at all.
  for (const statement of deletes) assert.match(statement, /\.eq\("tenant_id" as never, tenantId as never\)|\.is\("tenant_id" as never, null\)/);
});
