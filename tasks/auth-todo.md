# Sign-in and sign-up tasks

Plan: `tasks/auth-plan.md`
SQL to run: `tasks/branch-migrations-redesign-my-profile.sql` (one transaction, safe to re-run)

## Questions to answer first
- [ ] Q1 Is Google sign-in enabled in Supabase with the callback URL? (blocks A2)
- [x] Q2 Title Case: applied to labels, buttons, Settings navigation and section headings; helper text stays sentence case
- [ ] Q3 Legal: keep the consent checkbox or move to "By continuing you agree…"? (checkbox kept)
- [x] Q4 Showcase: animated recreations of real screens with made-up data (no live account needed)
- [ ] Q5 Run `tasks/branch-migrations-redesign-my-profile.sql` on the database (needed before A7/A9 can be tested end to end)

## Small fixes (no backend)
- [x] A1 Phone row: country box and number on one line (shared `PhoneField`, error shows after leaving the field)
- [x] A3 "Confirm your email": Gmail/Outlook buttons with logos, one row; clear order; "Didn't get it?" section at the bottom
- [x] A4 Title Case: "Independent agent", "For an Agency", "Primary State", form labels, Settings names

## Flow
- [ ] A2 Google: "Continue with Google" on sign-up, "Sign in with Google" on sign-in. **Blocked on Q1**: no OAuth route exists yet
- [x] A5 One Back/Continue footer on every step: Plan's Back now goes to About you (was Business profile); About you can be reopened and edited until payment starts; checkout has Back under the form
- [x] A6 Smooth transitions: the progress bar holds still between steps, the form swaps in place
- [x] A7 Checkout trimmed (shorter heading, no stale "Edit your agency details" link); "Change plan" now works for plans picked on Pricing (it used to bounce straight back to checkout). Fit at 1536×826 still to be checked with a real Whop form

## Showcase
- [x] A8 Right panel: one animated product screen per step (Inbound, Dialer checks, Lead to policy, Commissions), used on sign-up and sign-in

## Fixes found along the way
- [x] `save_signup_about_you` failed with "column reference onboarding_state is ambiguous", so every new sign-up would have stopped at About you. Fixed in the migration and tested on Postgres
- [x] The sign-up progress bar wrapped its 6th step onto a second line (5-column grid for 6 steps)
- [x] Sign-in: partner link now the same size and style as the trial link, on one line

## Review
- [ ] A9 Full journey on a preview deploy with the SQL applied: both entry paths (Pricing / header "Start free trial"), skip business info, desktop + phone

## Sign-up cut to 3 steps (29 Oct, manager review §1.9)
- [x] Step 1 Your account: email + password, then the email check (same step number)
- [x] Step 2 Plan & payment: plan screen only when no plan was picked on Pricing, then Whop checkout
- [x] Step 3 About you: name and phone (required) plus business details; Skip for now saves the name/phone and skips only the business part
