# Hand-off: UI Foundation v3 (2026-10-27)

For the next person or agent picking this up. Read this first, then
[CAPABILITY-MAP.md](CAPABILITY-MAP.md) and the authority
[UI-CONSISTENCY.md](../UI-CONSISTENCY.md) (§0 lists every v3 rule and whether it is live).

## Where the work is

- **Branch:** `redesign/foundation-v3`, cut from `origin/main` at `ee10778`. Not pushed, no PR.
- **Worktree:** `.claude/worktrees/foundation-v3` inside the main checkout. The main checkout is on
  `redesign/my-profile` with someone else's uncommitted profile work; do not touch it.
- **Local setup in the worktree** (both gitignored, local only):
  - `node_modules` is a junction to the main checkout's;
  - `.env.local` is a copy of the main checkout's.
- **Building:**
  - Turbopack refuses the linked `node_modules`, so use webpack:
    `npx next dev --webpack -p 3002`, `npx next build --webpack`.
  - `npm run build` works only after a real `npm ci` in the worktree.
- **Review server:** `http://localhost:3002` (`/signup`, `/app/login`, `/partner/login`,
  `/admin/login`, `/design`, `/design/auth`).
- **Process:** the owner works spec-first (`/agent-skills:spec-driven-development`): spec → owner
  approval → plan (`tasks/plan.md`, `tasks/todo.md`, both untracked) → build → owner says "commit".
  Never commit or move to the next module without the owner saying so.

## What is done on this branch (4 commits + 1 uncommitted module)

| # | Commit | Module | What it did |
|---|---|---|---|
| 1 | `2780c32` | design-foundation | v3 rules in `UI-CONSISTENCY.md` §0 and §4a, §5a, §6a, §10–§14, each with a status line. `BRAND.md` and `00-FOUNDATION.md` point at them. The mockup is in `foundation-v3/mockup.html`. A `README.md` in every `components/*` folder and in `app/{app,partner,admin}`. A design-rules block in `AGENTS.md`. `lib/design/designDocs.test.mjs` checks links, anchors, statuses and the signposts. |
| 2 | `b30b42e` | foundation-tokens | Inter for the apps and auth pages, Inter Tight as `--font-display`, Geist Mono as `--font-mono`. Montserrat becomes `--font-brand` and stays on `/` and `/pricing` via `.type-brand`. Gloss surface tokens (`--gloss-*`, `--stat-icon-*`) in both themes. Contrast tests are extended; `typeface.test.mjs` is added. |
| 3 | `d6732dd` | foundation-components | New glossy `StatRow` / `StatCard` (`components/ui/stat-card.tsx`), adopted **page by page only when someone works on a page**; `StatStrip` / `StatTile` are untouched. Button corners go from pill to 8px (marketing CTAs keep pills). `FilterButton` gets a chevron and a filled badge; `FilterPanel`, `ActiveFilters` and the `TableCard` `filters` slot are new (the INSURVAS-CRM inline pattern). Page titles use Inter Tight. `DeltaChip goodWhen="neither"`. Ratchet rules `pill-button`, `hand-filter-panel` (11 lists) and `mixed-stat` are added. `/design` shows every state. |
| 4 | `8331067` | auth-shell | One `AuthLayout` (`components/portal/auth-layout.tsx`) for all 17 sign-in and sign-up screens, plus `auth-controls.tsx` (44px fields and buttons, one `AuthAlert`). One heading, stepper and panel style. Accept terms moves into the layout at 720px. `authShell.test.mjs` holds the structure; `/design/auth` shows every combination. Also the owner's first step-1 edits: "Create your account", and the trial line and lawyer note removed. |
| 5 | uncommitted | signup-flow | See below. Built and checked, waiting for the owner to say "commit". |

### Module 5, signup-flow (uncommitted, ready)

Spec: [SPEC-signup-flow.md](SPEC-signup-flow.md). The owner approved it with the recommended
answers.

- **Step 1:**
  - confirm-password removed;
  - "Work email";
  - strength meter on one line;
  - phone hint only on error;
  - button "Create account".
- **Copy:**
  - **Sign-in:** link "New to Insurvas? Create an account"; panel "For licensed agents · Your
    agency's floor, in one workspace." with factual rows.
  - **Steps 1–3 panel:** "Five steps to your workspace." with Done/Now per step and the Payment
    line from the payment mode.
  - **Steps 2–5:** new subtitles per the spec's copy table.
- **Trial length from one source:**
  - plan cards use `resolveTrialDays(plan, default setting)`;
  - payment and return pages use `trialDaysForPlan(selection.plan_id)`;
  - dates come from `firstChargeDate` (`lib/checkout/constants.ts`);
  - no screen types "N-day" or imports `TRIAL_DAYS`.

  This fixes a real mismatch: payment used to say 14 days whatever the plan.
- **Back links:**
  - step 4: "Back to your agency";
  - step 5: "Back to your plan";
  - step 3: no Back (steps 1–2 cannot be redone), "Signed in as … · Sign out" instead.
- **Short screens:** a `max-height: 820px` compact mode on the auth layout. Sign-in, sign-up,
  partner and staff sign-in fit without scrolling at 1366×768 and 1536×864 (measured).
- **Tests:** `lib/design/signupCopy.test.mjs` is new.
  `lib/signup/legacySignupRetired.test.mjs` is updated to the approved copy, keeping its intent:
  sign-in links to `/signup`, and "no card" appears only in the no-payment branch.
- **Docs:** `UI-CONSISTENCY.md` §13 is fully Live.

**Commit note:**
- `app/globals.css` is stored with CRLF in the repository. Stage it with
  `git -c core.autocrlf=false add app/globals.css`, or the diff becomes the whole file.
- Do not commit `tasks/`.

## Checks at hand-off

- 55/55 design tests pass (`node --experimental-strip-types --test lib/design/*.test.mjs`).
- `npm test`: 3,265 tests, **23 failures, all pre-existing** in migration and SQL text tests
  (probably CRLF line endings on Windows; not investigated, not caused by this branch).
- `npm run typecheck` and lint on changed files are clean. `npx next build --webpack` passes.
- Not checked since module 5:
  - dark mode and 375px phone width of the sign-up steps;
  - steps 2–5 rendered with a real account in each signup state (the funnel needs a test
    account in the matching `onboarding_state`; `npm run session` mints an *active* tenant,
    which the funnel redirects away from).

## Owner review of step 3 (2026-10-27, evening)

**Status correction:** module 5 is no longer uncommitted. It is commit `8fabff8` ("Foundation v3
signup flow…"); the worktree has only `tasks/` untracked. The table above is out of date on that row.

The owner reviewed step 3 (`/app/onboarding/business-profile`) in the browser at 1920×1080 and says
**none of the step 3 feedback is done yet**. Their list, with where the code is:

1. **Scrolling when it is not needed.** The page still scrolls on a 1920×1080 screen: the
   legal footer (Privacy · Terms · Support) and the "Signed in as" line sit below the fold. The
   compact mode only starts at `max-height: 820px`, so it never applies here. The owner also
   reports unneeded scrolling on step 1. Goal: steps 1 and 3 fit in the window with no scrollbar at
   common laptop and desktop heights (1366×768, 1536×864, 1920×1080); measure each.
   Files: `components/portal/auth-layout.tsx`, the `.portal-tenant-auth-shell` / `.portal-login-footer`
   rules in `app/globals.css` (~line 1559–1600; CRLF, see the commit note).
2. **"What you sell" and "Where your leads come from" become dropdowns**, not chip rows. Both are
   multi-select, so this is a multi-select dropdown (checkbox list, selected items shown in the
   trigger as a count or short list), keyboard-accessible, themed like `StatePicker`
   (`components/app/state-picker.tsx`), 44px trigger to match the auth fields. "Other" still opens
   the free-text field. "Applications a month" stays as chips unless the owner says otherwise.
   File: `components/app/business-profile-form.tsx`.
3. **The dropdowns' design is "too bad"; make it better.** This covers the new ones and the
   existing Primary state picker: the owner wants a cleaner, more professional menu (surface,
   spacing, selected and hover states, check marks). Run `/ui-taste` on it and show the owner
   before committing.
4. **Do not prefill the business name from the email.** Remove `nameFromEmail`, the
   `PERSONAL_DOMAINS` list, the `suggested` state and the "Taken from your email address. Change it
   if it is not right." note in `business-profile-form.tsx`, and stop passing `email` to the form
   from `app/app/onboarding/business-profile/page.tsx`. The field starts empty (or from the saved
   profile when coming back from checkout). Update the spec and any test that mentions it.
5. **"Sign out" is badly aligned.** It renders as "Sign out" with the arrow wrapped onto a second
   line under it, lower than "Signed in as …". Cause: `LogoutButton variant="link"`
   (`components/app/logout-button.tsx`) wraps the button in `inline-flex flex-col items-center` and
   the button itself is not `inline-flex`, so the icon breaks to its own line. Make the button
   `inline-flex items-center gap-1` and keep the whole line on one baseline.
6. **There is no Back button anywhere.** The owner sees none in the flow. The spec's "step 3: no
   Back" decision is overridden: step 3 needs a Back too. Also verify in the browser that the step 4
   ("Back to your agency") and step 5 ("Back to your plan") links actually render — the owner says
   they see none. Decide with the owner where step 3's Back goes (steps 1–2 cannot be redone, so it
   likely signs out back to the start or goes to a confirmed-email screen); ask, don't guess.
   Files: `components/app/funnel-frame.tsx` (`back` prop), the onboarding pages under
   `app/app/onboarding/`.

Follow the usual process: short spec update → owner approval → build → browser check at the three
sizes, light and dark → owner says "commit".

### Done (2026-10-27, late; committed after the owner checked it)

The owner answered the Back question: **step 3 → step 2 → step 1; step 1 has no Back.**

1. **Scrolling.**
   - The short-screen mode (`max-height: 820px` in `app/globals.css`) is tighter: less padding, and
     smaller gaps under the logo, the steps, the heading and the Back link. The step 1 and step 3
     forms carry `data-auth-fields`, which drops their field gap to 12px.
   - Step 1 puts Work email and Password on one row (like First / Last name). The strength meter
     is narrower, so it stays on one line in the half column.
   - Measured with no vertical scroll: 1366×657, 1536×744 and 1920×969 browser windows (the
     usable part of 1366×768, 1536×864 and 1920×1080 screens), for `/signup` and step 3. No
     horizontal overflow at 375px.
2. **Dropdowns.** `components/app/multi-picker.tsx` is new: a 44px trigger that names what is
   picked ("Life insurance, Medicare +1") and a list with a tick box per row. Keyboard: arrows,
   Home/End, Space/Enter, Escape. It opens upward when there is no room below, so it never makes
   the page scroll. "What you sell" and "Where your leads come from" now sit side by side;
   "Applications a month" stays as chips.
3. **Dropdown design.** `MultiPicker` and `StatePicker` share `pickerPanel` / `pickerOption`: a
   softer shadow, 40px rows, a grey hover and a check mark for the chosen row instead of green
   text. The trigger's edge turns accent-coloured and the chevron flips while the list is open.
4. **Email prefill removed.** `nameFromEmail`, `PERSONAL_DOMAINS` and the "Taken from your
   email…" note are gone; the field starts empty, or from the saved profile.
5. **Sign out.** `LogoutButton variant="link"` is now `inline-flex` with the arrow on the text's
   line. The step 3 line is "Signed in as … · Sign out →" on one baseline.
6. **Back.**
   - Step 3 → "Back to your email" (`/app/verify-email`). For a confirmed account, that page now
     renders `FunnelReview`: "Your email is confirmed", with Continue to where the signup stands.
   - Step 2 → "Back to your account" (`/signup`). With a signup in progress, `/signup` renders
     "Your account is created" (name, email, Continue, "Not you? Sign out") instead of an empty
     form that would only fail with "account already exists".
   - Steps 4 and 5 already had Back in code (owner only saw step 3).
   - New: `components/app/funnel-review.tsx`.
7. **Docs and tests.**
   - `SPEC-signup-flow.md` §3 and `UI-CONSISTENCY.md` §13 have the new Back table and the
     dropdown rule.
   - `signupCopy.test.mjs` checks Back on steps 2–5, none on step 1, the two review screens, and no
     email prefill.
   - `funnel-review.tsx` and `multi-picker.tsx` are on the 44px auth-control list in
     `uiConsistency.test.mjs`.
   - `/design/auth` "step 3" now renders the real `BusinessProfileForm`, so the step can be checked
     without a signup account.

**Checks:**
- design and signup tests: 79/79;
- `npm test`: 3,266 tests, the same 23 pre-existing failures;
- `npm run typecheck` and eslint on the changed files: clean.

**Not checked:**
- the two review screens (`/signup` with a signup in progress, `/app/verify-email` once
  confirmed) with a real account: no test account in those states. Only `/signup` signed out and
  the step 3 form (through `/design/auth`) were seen in the browser.

**Commit note:**
- `app/globals.css` is CRLF; stage it with `git -c core.autocrlf=false add app/globals.css`.
- Do not commit `tasks/`.

## Round 2 (2026-10-27, night): dropdowns, still brand panel, step 4. Committed after the owner checked it

Plan: `tasks/plan.md`, `tasks/todo.md` (untracked). Owner approved the recommended answers: remove
Add modules entirely; still brand-700 panel with one soft light; white-thumb 36px toggles.

1. **Dropdowns went under things.**
   - Cause: `.m-stagger > *` keeps each line of the auth column on its own layer, so a list
     inside one line goes under every later line, whatever its z-index.
   - The list is now drawn at `.portal-auth-split-shell` through a portal (`PickerPortal`,
     `useAnchoredPanel` in `components/app/multi-picker.tsx`). It has fixed position, is fitted to
     the room left, flips up when needed, and follows scroll and resize. `StatePicker` uses the
     same pieces.
   - Checked: the last row is on top (`elementFromPoint`), and no page scroll in either direction.
2. **Dropdown design.** Picks are removable tags in the field ("+N" past what fits), the list
   ends with "N selected · Clear", rows are 36px, the chosen rows are lightly filled, and the
   shadow is lighter.
3. **Still brand panel.**
   - `LandingObject` and the veil are gone from `portal-auth-split-shell.tsx`.
   - `.portal-auth-story-scene` is `--brand-700` plus one radial light.
   - The plan summary and the payment receipt cards lost their blur and big shadow.
   - The marketing pages keep their own ribbon.
4. **Step 4.**
   - Removed: Add modules, the slider, the band strip, the band sentence and the subtitle tail.
   - "Who it is for" and "Billing" are on one row; billing with a single cycle reads
     "Monthly only".
   - One-agent seats are one sentence.
   - Compact mode tightens the plan cards and the section headings.
   - Typing 98 seats still picks 51–150, and the summary follows.
5. **Preview.** `/design/auth` has "step 4 (plan)", rendered with the published plans from the
   database.

**Checks:**
- no page scroll at 1920×1030 and 1366×657 for steps 3 and 4 (both audiences), and at 1536×744
  for sign-in;
- light and dark;
- design and signup tests pass; `npm test`: 3,268 tests, the same 23 pre-existing failures;
- typecheck and eslint: clean.

**Not run:** `npx next build --webpack`, because the dev server was using the worktree. Run it
before pushing.

## What is next

1. **Check the two Back review screens with a real account** (see "Not checked" above).
2. **Visual check of steps 2–5** with a test account in each state, light and dark, plus phone
   width. Fix anything found.
3. **Follow-up already agreed:** the marketing site still types the trial length
   (`components/marketing/landing-hero.tsx`, `components/public/site-header.tsx`,
   `components/public/pricing-plan-card.tsx`). Give it the same data source.
4. **`foundation-rollout`** (capability map): on demand only. When the owner works on a page, move
   it to `StatRow` / `StatCard`, the inline filters (`FilterPanel` / `ActiveFilters`) and the other
   v3 rules, and remove client, lead or carrier avatars. The ratchets
   (`hand-filter-panel`, `mixed-stat`, `pill-button`) only go down.
5. **Possible later decisions the owner deferred:**
   - move the phone number from step 1 to step 3 (needs API and profile changes);
   - switch the terms checkbox to a consent sentence (a legal decision).

## Decisions to respect (owner, 2026-10-27)

- **Fonts:** Inter in the apps and auth; Montserrat only on marketing.
- **Shapes:** 8px controls, 12px cards; pills only on marketing CTAs.
- **Stat cards:** glossy "footer fact" cards, adopted only on pages being reworked.
- **Filters:** open inline under the toolbar, never as a dropdown, as in INSURVAS-CRM.
- **Avatars:** none for clients, leads or carriers.
- **Auth fields:** 44px; one auth layout; no filler or internal notes; the trial is named only
  where it starts.
- **The owner's style:** reviews in the browser, wants professional, consistent, non-"AI" copy, and
  uses `/ui-taste` for design critique.
