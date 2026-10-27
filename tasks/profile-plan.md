# Implementation Plan: Settings › My profile redesign

Branch: `redesign/my-profile` (from main at ee10778). Form templates C and the Settings rail search are
held on `redesign/form-templates` (local commit 5baeb4e, not pushed).

## Overview

My profile now lives inside Settings (the friend's commit df98b99, "owner pick A"). It has four tabs:
Profile, Sign-in & security, Notifications, and What you changed. Every tab still draws its old
component, and those components were built as standalone pages. The result:
- Everything is squeezed into a 720px column with stacked cards.
- Each card has its own header band.
- The password form is always open.
- Nothing tells you at a glance whether your account is in good shape.

The goal is a compact page that fills the width, says in plain words what each thing does, and
shows what needs doing first. A 12-year-old should be able to tell what this page is, what is
missing, and how to fix it. All the working behaviour stays: the same APIs, the same anchors, and
nothing new in the database.

## What is there today (inventory: nothing may be lost)

| Tab | Parts | Source |
|---|---|---|
| Profile | photo upload/change/remove (saves at once); name; email (read-only); phone; display timezone; NPN; a licence number per licensed state; one Save | `components/app/own-profile-form.tsx` |
| Sign-in & security | sign-in email change (new email + password → confirmation link); password (current/new/repeat); two-factor (status, required-for-role warning, QR enrolment, recovery codes copy/download, new codes, turn off); sessions (end one, end all others); security log (50 latest) | `components/app/profile/security-settings.tsx` |
| Notifications | quiet hours; group filter + "Always on"; a table of alerts × in-app/email/browser switches; digest chips; locked alerts with their reason; saves each change | `components/app/settings/notification-preferences.tsx` |
| What you changed | your own settings history, with filters, export, and paging | `components/app/settings/settings-history.tsx` (`mine`) |

Behaviour to keep:
- The deep links `#my-profile/<tab>` and the anchor prefixes (`profile-`, `security-`, `notify-`).
- `?two_factor=required`: it opens security and starts enrolment.
- `/app/profile` keeps redirecting here.
- The bell link `#my-profile/notifications` keeps working.

## Architecture decisions

- **Look: the app's current tokens and shared Settings parts, light and dark.** No new visual
  world. This is a redesign of layout, wording and flow (ui-taste "Preserve" authority).
- **The tab keys stay** (`profile`, `security`, `notifications`, `changes`), so links and tests
  hold. Only the labels change to plain words, for example "About you", "Signing in", "Alerts" and
  "Your changes". The exact words get settled on the mockups.
- **Layout B, improved.** You picked B on 2026-10-27. Canvas page "Recommended" holds the board,
  plus "Nothing lost" and "Critique".
  - **Tabs are status cards:** About you · Signing in · Alerts · History. Each card carries one
    line saying what needs you; the selected card has a 2px ink border.
  - **About you and Signing in** are each one card made of rows: a name on the left, the value
    edited in place, and actions on the right. Forms (email, password, two-step setup) open
    under their own row.
  - **No account-check chip strip.** The tab status lines do that job.
  - **Header:** "My profile", with the name and role shown quietly on the right.
- **Fill the width.** The 720px cap goes. Rows stretch to the panel width, inputs are capped at
  about 420px, and rows stack on phones.
- **Critique fixes are part of the build.** The full list is on the Critique board:
  - one save bar;
  - code-gated turn-off and new spare codes;
  - spare codes unlock only after Copy or Download;
  - wrong-code, not-available and success states;
  - a confirm on "Sign out the others";
  - live password checks;
  - row-named switch labels;
  - an on-switch contrast of 3:1 or better;
  - the digest select and the real lock reason on Alerts;
  - History keeps its filters, export and paging;
  - every control 36px.
- **Progressive disclosure.** The password form and the email change open from a button; they
  are not always on screen. Two-factor shows one status line plus one action until it is used.
- **Split the big files while touching them.** Security becomes small parts (email, password,
  two-factor, devices, log) under `components/app/profile/`, so no file passes about 250 lines.
  Behaviour moves over verbatim first, and only then is it restyled. This is the same pattern
  that worked for Form templates.
- **No backend changes.** The same `/api/app/profile*` and notification routes.

## Task list

### Phase 1: Direction (no app code)
- [ ] **Task 1: Mockups.** 2–3 distinct layouts for the Profile and Signing in tabs, light and dark,
  with real copy, on a Design canvas. Each layout covers: the summary strip and account check, a
  filled-in profile, two-factor off but required, two-factor on, and a phone width.
- [ ] **Task 2: Critique round.** Run the impeccable critique with two isolated reviewers (a design
  review, and the automated detector on the current page). Fold the findings into one recommended
  layout plus a "nothing lost" board. **You pick one; the build waits for that.**

### Checkpoint A: direction approved

### Phase 2: Build (each task leaves the page working)
- [ ] **Task 3: Shell and summary strip.**
  - Plain tab labels; the account check, computed from the profile plus the two-factor status; the
    photo moves into the strip.
  - Acceptance: the hashes and `?two_factor=required` still open the right tab; each check item
    jumps to its fix.
  - Files: `my-profile.tsx`, a new `profile/summary-strip.tsx`, `own-profile-form.tsx`, and a pure
    helper `lib/users/accountCheck.ts` with a test.
- [ ] **Task 4: About you tab.**
  - Two cards side by side ("Who you are", "Licence numbers"); licence numbers as compact rows
    (state + number); one save bar that appears only when something changed.
  - Acceptance: a partial save, the pending-migration callout, and the no-states and unreadable-
    states messages all still show; the timezone hint text is kept (security.test.mjs).
  - Files: `own-profile-form.tsx`, plus its split parts.
- [ ] **Task 5: Signing in, split verbatim.**
  - `security-settings.tsx` is split into its parts with no visual change.
  - Acceptance: tsc, lint and the security tests are green; every flow behaves the same.
  - Files: `profile/security-*.tsx`.
- [ ] **Task 6: Signing in, redesigned.**
  - Email and password become one "How you sign in" card, each opened by a button.
  - Two-factor becomes a status card that states the one next step.
  - "Devices signed in" and "Sign-in history" sit side by side on wide screens.
  - Acceptance: enrolment, recovery codes (copy/download/fallback), turning it off, ending one or
    all sessions, and each read failing with Retry all still work.

### Checkpoint B: Profile + Signing in done, reviewed by you in your dev server

- [ ] **Task 7: Alerts and Your changes, compact pass.**
  - Quiet hours move into the table's toolbar row; the existing notification tests hold.
  - History gets the plain title only (it is already a full-width table).
- [ ] **Task 8: States, wording, phone.**
  - Loading, error, empty and read-only (suspended) states on every tab.
  - All wording plain, with InfoTips for the detail.
  - Checked at 375px, 768px and 1280px, light and dark.
- [ ] **Task 9: Verify.**
  - `npx tsc --noEmit -p tsconfig.la3check.json`, `npm run lint`, `npm test` (only the known
    SQL/migration baseline failures).
  - The UI ratchet is not raised.
  - A self-critique pass on the built page, with fixes.

### Checkpoint C: done, ready for you to click through (nothing committed until you say so)

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| String-matching tests (`security.test.mjs` timezone hint, `settingsAudit.test.mjs` `<SettingsHistory mine />`, `notifications.test.mjs` panel regexes, the login redirect hash) | Med | Keep those strings; run the focused tests after every task |
| Two-factor flows are high-stakes and hard to reach locally (no sign-in from me) | High | Split verbatim before restyling (Task 5); you click the flows yourself; a temporary unsigned preview page for layout only, deleted after |
| The account check could claim something false (for example, two-factor still loading) | Med | Unknown is its own state ("checking…"), never "done" |
| Merging the held Form templates branch later conflicts with the friend's Settings changes | Med | Not in scope here; it is noted for when we resume that branch |
| UI ratchet (36px controls, no raw hex, no extra page header) | Low | Shared `control`/`Field` parts; run the ratchet each task |

## Status (2026-10-27): Tasks 1–9 done, not committed

Built as layout B. On top of the plan:
- Sign-in history moved into the History tab.
- Devices show 3 at a time, then "Show N more".
- The two-step QR code stays closed until "Set it up".
- Alerts stack into blocks on a phone.
- "Try again" on every failed read.

The final critique found three real bugs, all fixed:
- Switching tabs threw away the spare codes, unsaved About you edits and a changed photo. Tabs now
  stay mounted once opened.

Its polish items were done too, except one: a save writes back the NPN and licence numbers as they
were when the page loaded, so an edit to them made elsewhere while the page is open would be undone.
This is low risk and left as is.

Follow-ups, outside this redesign:
- **Suspended accounts can't switch tabs.** On a suspended (read-only) account, Settings wraps the
  panel in `<fieldset disabled>`, which disables the My profile tab cards too, so only About you can
  be read. This was already true before the redesign.
- **The NPN elsewhere.** It is still on Business identity and anywhere else it appears.

## Decisions (2026-10-27, approved)

1. **NPN:** dropped from My profile. The UI no longer shows or sends it; the stored value and the
   API stay untouched. Removing it across the app is a separate task.
2. **Tab names:** About you · Signing in · Alerts · History. "History" replaces "Your changes" after
   the critique, because it clashed with the save bar's wording. The tab keys don't change.
3. **Look:** the app's own light and dark tokens and its shared Settings parts.
