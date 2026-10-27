# Spec: signup-flow

Module 5 of the [UI Foundation v3 capability map](CAPABILITY-MAP.md). Depends on `auth-shell`
(committed in `8331067`). Status: **approved 2026-10-27 with the recommended answers, built (uncommitted at hand-off).**

## Objective

Make every word on the sign-in and sign-up screens true, in the order things happen, and say
nothing that does not help the person finish. Add a way back on the steps that can go back. Take
the trial length and the card wording from data, so the screens never disagree with each other or
with the plan.

**Users:** agency owners signing up, and agents signing in.

**Success looks like:**
- A new user reads, in order: create your account → confirm your email → your agency → your plan
  → payment.
- No screen promises something the next screen contradicts.
- The trial length shown on every screen is the one the chosen plan actually gets.
- From the plan and payment steps, one click goes back a step.

## What is wrong today

Found in the code while building `auth-shell` and in the owner's review on 2026-10-27:

1. **The sign-up panel says "Free trial. Card required."** beside an account form that no longer
   mentions a trial. The first point says the card "is required for the trial", but nothing on
   steps 1–3 involves a card.
2. **The trial length comes from three sources:**
   - **Plan step:** the chosen plan's `plan_prices.trial_days`
     (`lib/signup/planChoiceQueries.ts:60`);
   - **Payment step:** the fixed `TRIAL_DAYS = 14` for its title, its terms and the "first charge"
     date (`app/app/checkout/page.tsx:14,95`);
   - **Sign-in link:** "Start a 14-day trial" also uses `TRIAL_DAYS`.

   A plan with a 30-day trial would show "30-day trial" on step 4 and "Start your 14-day trial"
   with a wrong first-charge date on step 5. `resolveTrialDays(plan, setting)` already exists
   (`lib/checkout/constants.ts:17`) and is not used here.
3. **No way back.** Steps are tied to the account's server state, so the browser's Back usually
   bounces forward. The only ways back are "Change plan" inside the payment receipt and "Edit your
   agency details" under the payment form.
4. **Filler and internal notes:**
   - "Four choices. Your total updates as you go." (plan)
   - "…and keeps anyone else from opening a workspace in your name." (email)
   - "Pay on this page. Your card goes straight to Whop…" (payment)
   - "Your floor is already running." with "Server-side" and "True CPA" (sign-in panel)

## Research: how established SaaS products build the first sign-up screen

Checked live on 2026-10-27 (several large products block automated browsers, so these are the ones
that loaded):

| Product | First screen asks for | Legal | Sign-in link | Layout |
|---|---|---|---|---|
| Close (CRM) | Google, or work email only | Sentence under the button | "Already have an account? Sign in" | Form beside a product image |
| Pipedrive (CRM) | Work email only | Checkbox + optional marketing checkbox | "Already have an account? Log in" | Form beside benefit lines |
| Attio (CRM) | Google, or work email only | Sentence under the field | (separate page) | Split card: form + customer quote |
| Linear | Google, email or SSO | Sentence under the buttons | "Already have an account? Log in" | One centred column, same as its log-in |

What they share, and what Insurvas does differently today:

- **Few fields first.** None of them asks for a phone number or a password confirmation on the
  first screen. Insurvas asks for seven inputs: first name, last name, email, password, confirm
  password, country code and phone.
- **Sign-up looks like sign-in.** Same column, same heading size, same button. Insurvas now
  matches this through `AuthLayout`.
- **No contradictions.** The words beside the form describe what you get, not conditions that
  come later.

### Step 1 redesign (ui-taste review)

The owner's screen (1920×1080 at the browser's zoom) still scrolls with seven inputs. The review
found three problems:

1. **Hierarchy.** The form is mostly fields of equal weight. Phone and confirm-password add height
   without helping the person finish.
2. **Redundant control.** Confirm password repeats the field, and the show/hide button plus the
   strength meter already prevent typos.
3. **Contradicting panel.** The panel says "Card required" beside a form about an account (item 1).

The proposed step 1 has these, top to bottom:

- **Logo, then steps:** unchanged.
- **Title:** "Create your account", with "Already have an account? **Sign in**" under it. Already
  live.
- **Name:** first and last name in one row. Unchanged, because the API takes the full name.
- **Email:** labelled "Work email".
- **Password:** with show/hide and the strength meter on one line.
- **Confirm password:** removed. Show/hide covers typos. This is client-only; the API only takes
  `password`.
- **Phone:** stays on step 1, because `/api/public/signup` requires it today, but it is compacted
  into one row with its hint. Moving it to step 3 (Your agency) would need an API and profile
  change; see open questions.
- **Terms:** one checkbox line, unchanged. The code records which document versions were
  accepted, and the box must start unticked.
- **Button:** **"Create account"**, replacing "Create my workspace". The workspace is not created
  until the plan starts.

**Target:** steps 1–5 and sign-in fit without scrolling at 1366×768 and at 1536×864 (1920×1080 at
125%). This is checked in the browser at both sizes.

## Scope

### 1. Copy, screen by screen

The **Proposed** column is the new copy. `{n}` is the resolved trial length (item 2). Lines marked
*card* or *no card* depend on `checkoutPaymentMode()`.

| Screen | Now | Proposed |
|---|---|---|
| Sign-in link | New to Insurvas? Start a 14-day trial | New to Insurvas? **Create an account** |
| Sign-in panel | Licensed agent portal · "Your floor is already running." · One claim / Server-side / True CPA / One record | **For licensed agents** · "Your agency's floor, in one workspace." · rows: Inbound transfers — *Claimed by one agent*; Every dial — *Checked against do-not-call*; Lead cost — *Traced to the policy*; Callbacks and appointments — *On the lead's record* |
| Step 1 title | Create your account (owner, 2026-10-27) | unchanged |
| Steps 1–3 panel | "Free trial. Card required." + 2 points | **"Five steps to your workspace."** · the five steps as rows, marking the done steps (✓), the current one (*Now*) and the rest. *card:* the Payment row reads "Card on Whop's secure checkout · not charged during your trial". *no card:* "No card needed". |
| Step 2 | Confirm your email · Open the link we sent. It works once, for {h} hours, and keeps anyone else… Nothing has been charged. | Confirm your email · **We sent a link to {email}. It works once, for {h} hours. This page moves on by itself when you open it.** (The repeated "waiting…" line under the buttons goes.) |
| Step 3 | Tell us about your agency (no subtitle) | Tell us about your agency · **We use this to set up your workspace.** |
| Step 4 | Choose your plan · Four choices. Your total updates as you go. | Choose your plan · **Pick a plan and your seats. You can change it before you pay.** |
| Step 4 trial line | $0.00 today · {plan days}-day trial · first charge {date} | unchanged wording, `{n}` from item 2 |
| Step 5 title | *card:* Start your {14}-day trial / *no card:* Confirm your plan | *card, n > 0:* **Start your {n}-day free trial** · *card, n = 0:* **Start your plan** · *no card:* **Confirm your plan** (unchanged) |
| Step 5 subtitle | Pay on this page. Your card goes straight to Whop… | *card, n > 0:* **Add a card to start. You won't be charged until {date}.** · *card, n = 0:* **Your first {period} is charged today.** · *no card:* **No card needed. Nothing is charged.** |
| Payment return | Starting your trial · This usually takes a few seconds. | *n > 0:* Starting your trial · *n = 0:* **Starting your plan**. Subtitle unchanged. |
| Welcome | unchanged | unchanged |

Rules for any line not in the table:
- Say what happens next, or what the person must do.
- No marketing claims.
- No notes meant for the team (drafts, internal names).
- One line under a title at most.

Legal and renewal terms beside the payment form keep their full wording (UI-CONSISTENCY §8: legal
wording is never shortened). Only the trial numbers inside them change, per item 2.

### 2. Trial length and card wording from data

- **One source: `trialDaysForPlan(planId)`** (`lib/checkout/trialDays.ts`, existing). Checkout
  completion and the Whop plan mapping already use it, so it is the trial Insurvas actually sells.
  The screens use it too:
  - the plan step, for each plan card;
  - the payment step's title, subtitle, receipt "First charge on" line and renewal terms;
  - the return page.

  Today the plan step shows `price.trial_days ?? 0`. That means a plan with no trial of its own
  shows "no trial" even though checkout gives it the default 14 days, which is a second mismatch
  this fixes.
- **`firstChargeDate(days, now)`** joins it in `lib/checkout/trialDays.ts`, so every screen draws the
  same date.
- **Before a plan is chosen** (the sign-in link, the steps 1–3 panel), no number is shown. The
  copy says "your trial", not "14-day trial", because the length depends on the plan.
- **Card wording** reads `checkoutPaymentMode()` everywhere it appears; no screen hard-codes "card
  required" or "no card".
- **`TRIAL_DAYS`** stays only as `resolveTrialDays`'s last fallback. No component imports it.

### 3. Back navigation

The steps are tied to the account's state on the server, so Back can only go to a step that state
still allows. That rule is enforced by each page today:

| Step | Back | Why |
|---|---|---|
| 1 Your account | none | First step. |
| 2 Your email | none; keeps "Wrong address?" and Sign out | The account exists. Changing the address is the way back. |
| 3 Your agency | none; adds "Signed in as {email} · Sign out" under the form | Steps 1–2 are done and cannot be redone: the account exists and the email is confirmed. Sign-out is the honest exit. |
| 4 Your plan | **← Back to your agency** → `/app/onboarding/business-profile` | Agency is editable while `ready_for_checkout` (`business-profile/page.tsx:9`). |
| 5 Payment | **← Back to your plan** → `/app/onboarding/plan` | The plan is choosable while `awaiting_payment` (`plan/page.tsx:12`). "Change plan" in the receipt stays. "Edit your agency details" under the form goes, because Back covers it in two clicks. |

- Back is the `AuthBack` slot from `auth-shell`: a real link above the heading.
- Nothing typed on a later step is lost by going back: plan and profile are saved on the server
  before moving on, and forms prefill from what is saved.

### 4. Tests

**`lib/design/signupCopy.test.mjs`:**
- no auth or sign-up file contains a typed trial length (`\d+-day`) or imports `TRIAL_DAYS`;
- the checkout and plan pages take the trial through `trialDaysForPlan`'s rule;
- steps 4 and 5 pass `back` to `FunnelFrame`, and steps 1–3 do not;
- the phrases removed in item 1 do not appear in auth files.

**Unit tests for `resolveTrialDays` (the rule `trialDaysForPlan` applies) and `firstChargeDate`:**
- a plan value;
- a null plan value with the setting;
- both null (falls back to 14);
- 0 (no trial).

### 5. Docs

`UI-CONSISTENCY.md` §13's copy and Back rules move to **Live**, with the Back table as the
reference.

Out of scope:
- products, prices, plan data and Whop checkout behaviour;
- the marketing site's trial copy (`landing-hero.tsx`, `site-header.tsx`, `pricing-plan-card.tsx`),
  which is listed as a follow-up;
- the partner and staff panels, whose words are already factual.

## Tech stack

Next.js 16.3 App Router (server pages read the signup context and plan), React 19.2, Supabase
reads through the existing queries, Node test runner. No new dependencies.

## Commands

```
Dev (visual check):  npx next dev --webpack -p 3002
Test:                npm test
One test:            node --experimental-strip-types --test lib/design/signupCopy.test.mjs lib/signup/trial.test.mjs
Types:               npm run typecheck
Lint:                npm run lint
Build:               npx next build --webpack
```

## Project structure

```
lib/checkout/trialDays.ts (+ test)              → trialDaysForPlan (existing), firstChargeDate (new)
lib/signup/planChoiceQueries.ts                  → each plan's trial through trialDaysForPlan's rule
components/app/tenant-auth-workspace.tsx         → sign-in link, sign-in panel copy
components/app/funnel-frame.tsx                  → steps 1–3 panel (five-step rows, mode-aware)
components/app/verify-email-panel.tsx            → step 2 copy
components/app/business-profile-form.tsx         → step 3 subtitle, signed-in line
app/app/onboarding/plan/page.tsx, components/app/plan-choice.tsx → step 4 copy, Back, trial source
app/app/checkout/page.tsx, components/public/checkout-view.tsx   → step 5 copy, Back, trial source
app/app/checkout/return/page.tsx                 → return title by trial length
lib/design/signupCopy.test.mjs                   → copy and Back contracts (new)
docs/design/UI-CONSISTENCY.md                    → §13 to Live
```

## Code style

Copy lives beside the screen that shows it, as plain strings. Derived parts come from the shared
helpers, never inline arithmetic.

```tsx
const trialDays = await trialDaysForPlan(choice.planId);
<FunnelFrame step={5} wide back={{ href: "/app/onboarding/plan", label: "Back to your plan" }} aside={…}>
  <FunnelHeading title={noPayment ? "Confirm your plan" : trialDays > 0 ? `Start your ${trialDays}-day free trial` : "Start your plan"}>
    …
```

## Testing strategy

- **Unit and contract tests** as in Scope item 4, under `npm test`.
- **Visual check on the dev server**, light and dark at 1536×864 and 375px:
  - `/app/login`, `/signup` and `/design/auth`, with the steps 1–3 panel in both payment modes;
  - every step reached with a test account in the matching signup state.
- **Back from steps 4 and 5:** checked by following the link, which opens the earlier step with
  its saved values.
- **Copy review:** every changed line is listed in the hand-off next to its old wording.
- **No real payments.** No real sign-up or payment is completed. Whop is not called beyond loading
  the embedded form.

## Boundaries

- **Always:** take trial length and card wording from data; keep legal and renewal wording whole;
  keep every request and state transition as it is.
- **Ask first:** any copy that differs from the table above; changing marketing-site copy; changing
  which states a page accepts.
- **Never:** change prices, plans or Whop behaviour; complete a real payment; widen a step guard to
  make Back reach a step the server does not allow.

## Success criteria

0. Step 1 matches the redesign above. Sign-in and steps 1–5 fit without scrolling at 1366×768 and
   1536×864, in light and dark.
1. Every line in the copy table reads as **Proposed**. `signupCopy.test.mjs` finds no typed trial
   length, no `TRIAL_DAYS` import and none of the removed phrases in auth files.
2. Steps 4 and 5 show a Back link that opens the previous step with its saved values. Steps 1–3
   show none, and step 3 shows the signed-in line with Sign out.
3. With a plan whose `trial_days` differs from 14, the plan step, the payment title, the
   first-charge date and the renewal terms all show the same number and date.
4. The steps 1–3 panel shows the five steps and the right card wording in both payment modes.
5. `UI-CONSISTENCY.md` §13 is Live. Typecheck, lint, the webpack build and `npm test` pass, with
   no new failures beyond the 23 known ones.
6. Screenshots of `/signup`, steps 4 and 5 (with Back), and `/app/login`, in light and dark, are
   attached to the hand-off.

## Open questions

1. **The proposed copy:** approve the table, or edit any line before building. It is a proposal.
2. **Step 3 Back:** the spec gives step 3 no Back, because the account and email cannot be
   un-done, and shows "Signed in as … · Sign out" instead. If you want a Back on step 3, it can
   only go to "Wrong address?" on step 2 by reopening the email change; say if that is what you
   want.
3. **Marketing trial copy** (landing hero, header button, pricing cards) still hard-codes the trial
   length. Fix it in this module, or as a separate follow-up?
4. **Confirm password:** remove it, as every product researched does? Recommended: yes.
5. **Phone number:** keep it on step 1, compacted (no API change), or move it to step 3, Your
   agency (API and profile change, and a shorter first step)? Recommended: keep it on step 1 for
   this module and move it later if you want.
6. **Terms:** keep the explicit checkbox (recommended: the acceptance record depends on it), or
   switch to a sentence under the button like Close, Attio and Linear? The second needs a legal
   decision, not a design one.
