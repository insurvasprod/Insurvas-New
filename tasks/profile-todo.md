# My profile redesign: tasks

Plan: tasks/profile-plan.md · Branch: redesign/my-profile

## Phase 1: Direction
- [x] Task 1: Mockups (2–3 layouts, light and dark, real copy, phone width): https://claude.ai/artifact/9p8mBzgTJyrG1Gpv5njqD1
  - Verify: the canvas covers the summary strip, a filled profile, 2FA off+required, 2FA on, and a phone width
- [x] Task 2: Critique round (two isolated reviewers) → one recommended layout + a "nothing lost" board
  - Done: you picked B; the recommended board is B improved with the critique fixes

## Checkpoint A: direction approved

## Phase 2: Build
- [x] Task 3: Shell: status-card tabs (About you · Signing in · Alerts · History) with one status line each (`lib/users/profileStatus.ts` + test)
  - Verify: the hashes and ?two_factor=required open the right tab; the focused tests pass
- [x] Task 4: About you as one card of rows (photo, name, phone, time zone, email, licence numbers; no NPN) + a save bar that shows only on changes
  - Verify: security.test.mjs timezone hint; the partial-save and migration callouts
- [x] Task 5: Split Signing in into parts, verbatim (no visual change)
  - Verify: tsc, lint, security tests
- [x] Task 6: Redesign Signing in as rows (email, password, two-step with its flows under the row, devices, sign-in history) + the critique's safety fixes
  - Verify: every 2FA and session flow; Retry on failed reads

## Checkpoint B: you review in localhost:3000

- [x] Task 7: Compact pass on Alerts and Your changes
  - Verify: notifications.test.mjs, settingsAudit.test.mjs
- [x] Task 8: States, plain wording, 375/768/1280, light and dark
- [x] Task 9: Full checks + self-critique pass and fixes

## Checkpoint C: ready for your click-through (no commit until asked)
