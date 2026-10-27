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

## What is next

1. **The owner says "commit"** → commit module 5 (see the note above).
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
