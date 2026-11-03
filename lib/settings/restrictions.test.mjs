// Run with: npm test
//
// The Advanced screen and PATCH /api/admin/settings both read these lists. A key that drifts out of
// the registry would make the gate silently guard nothing, so every entry is checked against it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { settingDef } from "./constants.ts";
import {
  ABUSE_CONTROL_KEYS,
  LOGIN_PROTECTION_KEYS,
  LOGIN_PROTECTION_LABELS,
  canManageSettingKey,
  isLoosenedAbuseControl,
} from "./restrictions.ts";

test("every restricted or flagged key is a real registry key", () => {
  for (const key of [...LOGIN_PROTECTION_KEYS, ...ABUSE_CONTROL_KEYS]) {
    assert.ok(settingDef(key), `${key} is not in the settings registry`);
  }
});

test("abuse-control keys are numbers, so 'above its default' means something", () => {
  for (const key of ABUSE_CONTROL_KEYS) {
    assert.equal(settingDef(key)?.type, "number", `${key} must be a number setting`);
  }
});

test("every login-protection key has a card label", () => {
  for (const key of LOGIN_PROTECTION_KEYS) {
    assert.ok(LOGIN_PROTECTION_LABELS[key]?.length > 0, `${key} needs a label`);
  }
});

test("the login-protection keys are the ones lib/authProtection reads", () => {
  const source = readFileSync(new URL("../authProtection/index.ts", import.meta.url), "utf8");
  for (const key of LOGIN_PROTECTION_KEYS) {
    assert.ok(source.includes(`"${key}"`), `${key} is not read by lib/authProtection`);
  }
});

test("only a super admin may manage login-protection keys", () => {
  for (const key of LOGIN_PROTECTION_KEYS) {
    assert.equal(canManageSettingKey("super_admin", key), true);
    assert.equal(canManageSettingKey("platform_config", key), false, `${key} leaked to platform_config`);
  }
  assert.equal(canManageSettingKey("platform_config", "users.invite_expiry_hours"), true);
});

test("the settings API enforces the per-key gate server-side", () => {
  const route = readFileSync(new URL("../../app/api/admin/settings/route.ts", import.meta.url), "utf8");
  assert.match(route, /canManageSettingKey\(auth\.session\.role, key\)/);
});

test("a loosened abuse control is one set above its default, and only for flagged keys", () => {
  assert.equal(isLoosenedAbuseControl("security.signup_per_ip_per_hour", 20, 10), true);
  assert.equal(isLoosenedAbuseControl("security.signup_per_ip_per_hour", 10, 10), false);
  assert.equal(isLoosenedAbuseControl("security.signup_per_ip_per_hour", 5, 10), false, "stricter is not a warning");
  assert.equal(isLoosenedAbuseControl("security.lockout_minutes", 60, 30), false, "a longer lockout is stricter");
  assert.equal(isLoosenedAbuseControl("users.invite_expiry_hours", 96, 72), false);
});
