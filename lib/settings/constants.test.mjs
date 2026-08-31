// Run with: npm test
//
// The registry is the source of truth for what a setting IS, and coerceSettingValue is shared by
// the form and the API — so a bug here is a bug in both at once, which is exactly the kind of
// thing that gets found in production instead of in a test.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SETTING_DEFS,
  coerceSettingValue,
  isSettingKey,
  settingDef,
  settingGroups,
  settingRefusalReason,
} from "./constants.ts";

const number = settingDef("users.invite_expiry_hours");
const select = settingDef("platform.default_currency");

test("every definition is internally consistent", () => {
  for (const def of SETTING_DEFS) {
    assert.equal(typeof def.key, "string", `${def.key} needs a key`);
    assert.ok(def.key.includes("."), `${def.key} should be namespaced group.name`);
    assert.ok(def.label.length > 0, `${def.key} needs a label`);
    assert.ok(def.help.length > 0, `${def.key} needs help text`);

    // The default must survive its own validation, or a missing row is worse than a wrong one.
    assert.notEqual(
      coerceSettingValue(def, def.default),
      null,
      `${def.key}'s own default fails its own validation`,
    );

    if (def.type === "select") {
      assert.ok(def.options?.includes(def.default), `${def.key} default is not one of its options`);
    }
  }
});

test("keys are unique", () => {
  const keys = SETTING_DEFS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate setting key");
});

test("the cancelled dunning keys are not in the registry", () => {
  // SA-3.5 was cancelled — Whop owns dunning. A key nothing reads invites someone to rebuild the
  // ladder later just to make the setting true.
  for (const forbidden of [
    "billing.dunning_steps_days",
    "billing.suspend_after_days",
    "billing.cancel_after_days",
  ]) {
    assert.equal(isSettingKey(forbidden), false, `${forbidden} should not exist`);
  }
});

test("number coercion accepts strings from a form and rejects nonsense", () => {
  assert.equal(coerceSettingValue(number, 72), 72);
  assert.equal(coerceSettingValue(number, "72"), 72, "the form submits strings");
  assert.equal(coerceSettingValue(number, "  96  "), 96);
  assert.equal(coerceSettingValue(number, ""), null);
  assert.equal(coerceSettingValue(number, "abc"), null);
  assert.equal(coerceSettingValue(number, null), null);
  assert.equal(coerceSettingValue(number, Infinity), null);
  assert.equal(coerceSettingValue(number, NaN), null);
});

test("number bounds are inclusive at the edges and refused beyond", () => {
  assert.equal(coerceSettingValue(number, number.min), number.min);
  assert.equal(coerceSettingValue(number, number.max), number.max);
  assert.equal(coerceSettingValue(number, number.min - 1), null);
  assert.equal(coerceSettingValue(number, number.max + 1), null);
});

test("a select only takes one of its own options", () => {
  assert.equal(coerceSettingValue(select, "USD"), "USD");
  assert.equal(coerceSettingValue(select, "EUR"), null, "multi-currency was declined in SA-00");
  assert.equal(coerceSettingValue(select, 1), null);
});

test("refusal reasons are human and name the bound", () => {
  assert.equal(settingRefusalReason(number, 72), null, "a good value has no reason");

  const tooBig = settingRefusalReason(number, 99_999);
  assert.match(tooBig, /number/i);
  assert.match(tooBig, /720/, "the message should name the limit the admin has to satisfy");

  assert.match(settingRefusalReason(select, "EUR"), /USD/);
});

test("groups keep declaration order and lose nothing", () => {
  const groups = settingGroups();
  const flat = groups.flatMap((g) => g.defs.map((d) => d.key));
  assert.deepEqual(flat, SETTING_DEFS.map((d) => d.key));
  assert.equal(new Set(groups.map((g) => g.group)).size, groups.length, "a group appears twice");
});

test("an unknown key is not a setting key", () => {
  assert.equal(isSettingKey("users.invite_expiry_hours"), true);
  assert.equal(isSettingKey("nope.not.real"), false);
  assert.equal(settingDef("nope.not.real"), undefined);
});
