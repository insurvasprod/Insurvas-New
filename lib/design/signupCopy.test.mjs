// Run with: npm test
//
// The sign-up words and navigation (docs/design/foundation-v3/SPEC-signup-flow.md): no screen types
// a trial length, every trial number comes from the rule checkout and Whop use, the phrases the
// owner removed stay removed, and Back appears on every step from 2 on.
//
// DB-free and network-free: reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { firstChargeDate, resolveTrialDays } from "../checkout/constants.ts";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const AUTH_FILES = [
  "components/app/tenant-auth-workspace.tsx",
  "components/app/funnel-frame.tsx",
  "components/public/signup-form.tsx",
  "components/app/verify-email-panel.tsx",
  "components/app/business-profile-form.tsx",
  "components/app/plan-choice.tsx",
  "components/public/checkout-view.tsx",
  "app/signup/page.tsx",
  "app/app/verify-email/page.tsx",
  "app/app/onboarding/business-profile/page.tsx",
  "app/app/onboarding/plan/page.tsx",
  "app/app/checkout/page.tsx",
  "app/app/checkout/return/page.tsx",
];

test("no sign-in or sign-up screen types a trial length or reads the fallback constant", () => {
  const offenders = [];
  for (const file of AUTH_FILES) {
    const source = code(file);
    if (/\b\d+-day\b/.test(source)) offenders.push(`${file}: a typed "N-day"`);
    if (/\bTRIAL_DAYS\b/.test(source)) offenders.push(`${file}: imports TRIAL_DAYS (use trialDaysForPlan / resolveTrialDays)`);
  }
  assert.deepEqual(offenders, []);
});

test("the payment step, its return page and the plan cards use the trial checkout grants", () => {
  assert.match(code("app/app/checkout/page.tsx"), /trialDaysForPlan\(selection\.plan_id\)/);
  assert.match(code("app/app/checkout/return/page.tsx"), /trialDaysForPlan\(selection\.plan_id\)/);
  assert.match(code("lib/signup/planChoiceQueries.ts"), /trialDays: resolveTrialDays\(price\?\.trial_days \?\? null, defaultTrial\)/);
  assert.match(code("components/app/plan-choice.tsx"), /firstChargeDate\(plan\.trialDays/);
  assert.match(code("app/app/checkout/page.tsx"), /firstChargeDate\(trialDays\)/);
});

test("the removed phrases stay removed", () => {
  const REMOVED = [
    "Start your free trial",
    "No card on this step",
    "Free trial. Card required.",
    "A card is required for the trial",
    "Four choices. Your total updates as you go.",
    "keeps anyone else from opening a workspace",
    "Your floor is already running.",
    "Pay on this page.",
    "Confirm password",
    "reviewed by a lawyer",
    "Create my workspace",
  ];
  const found = [];
  for (const file of AUTH_FILES) for (const phrase of REMOVED) if (code(file).includes(phrase)) found.push(`${file}: "${phrase}"`);
  assert.deepEqual(found, []);
});

// Owner, 2026-10-27: "we don't have a back button anywhere". Every step from 2 on goes back one step;
// step 1 has none. Steps 1 and 2, once done, show what was done and a Continue (FunnelReview) rather
// than a form that cannot be redone.
test("every step from 2 on has Back to the step before it; step 1 has none", () => {
  assert.match(code("app/app/verify-email/page.tsx"), /const BACK = \{ href: "\/signup", label: "Back to your account" \}/);
  assert.match(code("app/app/onboarding/business-profile/page.tsx"), /back=\{\{ href: "\/app\/verify-email", label: "Back to your email" \}\}/);
  assert.match(code("app/app/onboarding/plan/page.tsx"), /back=\{\{ href: "\/app\/onboarding\/business-profile", label: "Back to your agency" \}\}/);
  assert.match(code("components/public/checkout-view.tsx"), /back=\{\{ href: "\/app\/onboarding\/plan", label: "Back to your plan" \}\}/);
  assert.doesNotMatch(code("app/signup/page.tsx"), /back=\{/, "step 1 has no Back");
  assert.match(code("app/signup/page.tsx"), /<FunnelReview[\s\S]*continueHref=\{destination\}/, "step 1 seen again shows the account, not the form");
  assert.match(code("app/app/verify-email/page.tsx"), /<FunnelReview[\s\S]*continueHref=\{destination\}/, "step 2 seen again shows the email confirmed");
  assert.match(code("app/app/onboarding/business-profile/page.tsx"), /Signed in as[\s\S]*<LogoutButton/, "step 3 keeps sign-out");
});

test("step 3 does not guess the business name from the email", () => {
  const form = code("components/app/business-profile-form.tsx");
  assert.doesNotMatch(form, /nameFromEmail|Taken from your email/);
  assert.doesNotMatch(code("app/app/onboarding/business-profile/page.tsx"), /email=\{/);
  assert.match(form, /useState\(initial\?\.businessName \?\? ""\)/);
});

// Owner, 2026-10-27 (round 2): step 4 lost what repeated the plan cards and the summary, and what
// could not be used; the brand panel is still.
test("step 4 has no add-on modules, seat slider, band strip or band sentence", () => {
  const form = code("components/app/plan-choice.tsx");
  assert.doesNotMatch(form, /Add modules|toggleAddon|type="range"|aria-label="Seat bands"|before the next band|You can change it before you pay/);
  assert.match(form, /addonCodes: \[\] \}/, "the saved body sends no add-ons");
});

test("the sign-in and sign-up brand panel is still: no ribbon, no WebGL", () => {
  const shell = code("components/portal/portal-auth-split-shell.tsx");
  assert.doesNotMatch(shell, /LandingObject|brand-ribbon|portal-auth-story-veil/);
});

test("the trial rule and the first-charge date", () => {
  assert.equal(resolveTrialDays(30, 7), 30, "the plan's own trial wins");
  assert.equal(resolveTrialDays(null, 7), 7, "then the platform default");
  assert.equal(resolveTrialDays(null, null), 14, "then 14");
  assert.equal(resolveTrialDays(0, 7), 0, "zero is a real answer: no trial");
  const now = new Date("2026-10-27T12:00:00Z");
  assert.equal(firstChargeDate(14, now).toISOString(), "2026-11-10T12:00:00.000Z");
  assert.equal(firstChargeDate(0, now).toISOString(), now.toISOString());
});
