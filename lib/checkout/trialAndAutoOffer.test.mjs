// SA-4.4 / SA-5.2 audit (2026-10-15): the trial a checkout grants is the plan's, and a self-serve
// checkout gets the platform's auto-offer exactly once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TRIAL_DAYS, resolveTrialDays } from "./constants.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the plan's own trial length wins, then the setting, then 14", () => {
  assert.equal(resolveTrialDays(7, 30), 7);
  assert.equal(resolveTrialDays(0, 30), 0, "zero is a plan with no trial, not a missing value");
  assert.equal(resolveTrialDays(null, 30), 30);
  assert.equal(resolveTrialDays(undefined, undefined), TRIAL_DAYS);
  assert.equal(resolveTrialDays(-1, 9999), TRIAL_DAYS, "nonsense on both falls back to 14");
  assert.equal(resolveTrialDays(2.5, 21), 21);
});

test("checkout completion, the checkout start and the Whop plan all use the plan's trial", () => {
  const complete = read("./complete.ts");
  assert.match(complete, /p_trial_days: await trialDaysForPlan\(planId\)/);
  assert.doesNotMatch(complete, /TRIAL_DAYS/);
  const start = read("./start.ts");
  assert.doesNotMatch(start, /trialDays: TRIAL_DAYS/);
  assert.equal((start.match(/trialDays: await trialDaysForPlan\(plan\.id\)/g) ?? []).length, 2);
  const mapping = read("../payments/whop/planMapping.ts");
  assert.match(mapping, /trialDays: await trialDaysForPlan\(planId\)/);
  const reader = read("./trialDays.ts");
  assert.match(reader, /from\("plan_prices"\)\s*\.select\("trial_days"\)/);
  assert.match(reader, /defaultTrialDays\(\)/);
});

test("a self-serve checkout applies the auto-offer once: only on the call that created the subscription", () => {
  const complete = read("./complete.ts");
  const created = complete.indexOf("if (row.created) {");
  const apply = complete.indexOf("await applyAutoOffer(row.subscription_id)");
  const blockEnd = complete.indexOf("return {", created);
  assert.ok(created > 0 && apply > created && apply < blockEnd, "inside the created branch");
  assert.equal((complete.match(/applyAutoOffer\(/g) ?? []).length, 1);
  assert.match(complete, /action: "offer\.applied"/);
});

test("the default trial length is a registered platform setting", () => {
  const settings = read("../settings/constants.ts");
  assert.match(settings, /key: "billing\.default_trial_days",[\s\S]{0,600}default: 14,/);
});
