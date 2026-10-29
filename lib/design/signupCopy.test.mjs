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
  "components/public/google-finish-form.tsx",
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
    // Owner, 2026-10-27: "it should be just Email" on sign-in and sign-up.
    "Work email",
    "work email",
  ];
  const found = [];
  for (const file of AUTH_FILES) for (const phrase of REMOVED) if (code(file).includes(phrase)) found.push(`${file}: "${phrase}"`);
  assert.deepEqual(found, []);
});

// Owner, 2026-10-27: "we don't have a back button anywhere". Every step from 2 on goes back one step;
// step 1 has none. Steps 1 and 2, once done, show what was done and a Continue (FunnelReview) rather
// than a form that cannot be redone.
// The screen order (2026-10-28): account, email, plan, payment, About you. Manager review §1.9: the
// progress line shows them as three steps (account, plan & payment, About you).
test("the sign-up screens run account, email, plan, payment, About you, in three steps", () => {
  assert.match(code("components/app/funnel-frame.tsx"), /FUNNEL_STEPS = \["Your account", "Plan & payment", "About you"\]/);
  assert.match(code("components/app/funnel-frame.tsx"), /STEP_OF_SCREEN[^=]*= \{ 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4 \}/);
  assert.match(code("app/app/onboarding/plan/page.tsx"), /<FunnelFrame step=\{3\}/);
  assert.match(code("components/public/checkout-view.tsx"), /<FunnelFrame\s+step=\{4\}/);
  assert.match(code("app/app/onboarding/business-profile/page.tsx"), /<FunnelFrame\s+step=\{5\}/);
  assert.match(code("components/public/checkout-return-status.tsx"), /router\.replace\(AFTER_PAYMENT\)/);
  assert.match(code("lib/checkout/noPayment.ts"), /NO_PAYMENT_LANDING = AFTER_PAYMENT/);
});

// Manager review, 2026-10-28: Back is a button beside Continue at the bottom of every step from 2
// on, not a link above the heading; a step seen again has one Continue; no Sign out in the funnel.
test("every step from 2 on has Back beside Continue; step 1 has none", () => {
  assert.match(code("app/app/verify-email/page.tsx"), /const BACK = "\/signup"/);
  assert.match(code("app/app/verify-email/page.tsx"), /<VerifyEmailPanel[^>]*back=\{BACK\}/);
  // Payment comes before About you (2026-10-28): plan → back to email; About you → back to the plan
  // only before payment (after it there is no step to go back to).
  assert.match(code("components/app/plan-choice.tsx"), /<FunnelActions back="\/app\/verify-email" onDark=\{onDark\}>/);
  assert.match(code("components/app/plan-choice.tsx"), /<ContinueButton onDark \/>/, "Back on the green summary uses the panel's colours");
  assert.match(code("app/app/onboarding/business-profile/page.tsx"), /back=\{paid \? undefined : "\/app\/onboarding\/plan"\}/);
  // Payment: Whop's form is as tall as it is, so Back sits on the step line (2026-10-28: it must not scroll).
  assert.match(code("components/public/checkout-view.tsx"), /stepsAside=\{\s*<Link href="\/app\/onboarding\/plan" data-funnel-back=""/);
  for (const page of ["app/signup/page.tsx", "app/app/verify-email/page.tsx", "app/app/onboarding/business-profile/page.tsx", "app/app/onboarding/plan/page.tsx", "components/public/checkout-view.tsx"]) {
    assert.doesNotMatch(code(page), /<FunnelFrame[^>]*back=\{/, `${page}: no Back link above the heading`);
  }
  assert.doesNotMatch(code("app/signup/page.tsx"), /back=/, "step 1 has no Back");
  // A step seen again: one Continue to where the sign-up stands, no "Next: …" button.
  assert.match(code("app/signup/page.tsx"), /<FunnelReview[\s\S]*continueHref=\{destination\}/);
  assert.doesNotMatch(code("components/app/funnel-review.tsx"), /next|Next:/);
  for (const file of ["app/signup/page.tsx", "components/app/business-profile-form.tsx", "components/app/verify-email-panel.tsx"]) {
    assert.doesNotMatch(code(file), /LogoutButton/, `${file}: no Sign out in the funnel`);
  }
  // The one exception: the first-login gate blocks the app, not the person (owner, 2026-10-28).
  assert.match(code("app/app/onboarding/business-profile/page.tsx"), /stepsAside=\{gate \? <>Not now\? <LogoutButton/);
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
  // Billing is one control for both audiences; a cycle an audience is not sold on is disabled with
  // its reason, not replaced by text (owner, 2026-10-27).
  assert.doesNotMatch(form, /\} only<\/p>/);
  assert.match(form, /plans are billed/);
  assert.equal((form.match(/data-seat-row=""/g) ?? []).length, 2, "one seat row shape for both audiences");
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

test("the payment step keeps only what it collects", () => {
  const embed = code("components/public/checkout-embed.tsx");
  assert.match(embed, /"whop-Email": \{ display: "none" \}/, "the verified email is not asked again");
  assert.match(embed, /<CheckoutElement buyerEmail=\{email\} lockBuyerEmail /);
  assert.doesNotMatch(code("components/public/checkout-view.tsx"), /Leave now and come back/);
  assert.match(embed, /<div className="overflow-hidden rounded-xl">\s*<WhopElements/, "no second box around Whop's card");
  assert.match(embed, /height: "44px"/, "the pay button is the app's 44px");
  assert.match(code("app/app/checkout/page.tsx"), /name=\{context\.name && context\.name !== nameFromEmail\(context\.email\)/, "no stand-in name on the card");
});

// Manager review, 2026-10-28 (03:43): a plan picked on the pricing page is shown, not asked for again.
test("the plan step shows a plan picked on Pricing instead of the chooser", () => {
  const page = code("app/app/onboarding/plan/page.tsx");
  assert.match(page, /const showChosen = Boolean\(saved\?\.chosen\) && change !== "1";/);
  assert.match(page, /\{showChosen \? <PlanChosenPanel \/> : <PlanChoiceForm \/>\}/);
  assert.match(page, /aside=\{showChosen \? undefined : <PlanChoiceSummary \/>\}/, "the plan is not shown twice: the slides are on the right");
  assert.match(page, /aside=\{showChosen \? undefined : <PlanChoiceSummary \/>\}/, "the plan is not shown twice: the slides are on the right");
  const panel = code("components/app/plan-choice.tsx");
  assert.match(panel, /href="\/app\/onboarding\/plan\?change=1"/, "Change plan opens the chooser");
  assert.match(code("components/public/checkout-view.tsx"), /href="\/app\/onboarding\/plan\?change=1"/, "Change plan on Payment opens the chooser too");
});

// Manager review, 2026-10-28 (02:15): an independent agent is not asked for an agency/business name.
test("one-agent plans have no business-name field; the workspace carries the person's name", () => {
  const form = code("components/app/business-profile-form.tsx");
  assert.match(form, /\{!solo && \(\s*<div>\s*\{label\("name", "Agency name", true\)\}/);
  assert.doesNotMatch(form, /Business name \(optional\)/);
  assert.match(form, /const sentBusinessName = solo \? fullName : businessName\.trim\(\);/);
});
