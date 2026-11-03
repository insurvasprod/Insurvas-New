# Book of business, round 2: the build brief

The owner approved the round-2 mockups on 2026-11-02 and said "Build it". This brief is the contract that the people building the parts share.

- Canvas page: "M4 · Book of business, simplified", https://claude.ai/artifact/ByAaRwqkzg3STpjbLDZqj2. Its boards are described below.
- Plan: `docs/la4/SIMPLIFY-PROPOSAL.md`.
- Spec: Notion LA-4, all 20 tasks.

## The one pattern
- **List page → detail page → tabs.**
- No side panels, no side sheets, no drawers.
- An edit happens on its own page, or on a tab of the thing it changes.
- Pop-ups are only for:
  - confirming something (unlink, undo, switch to live)
  - uploading a file
- On a detail page, the trail and title come first, then a status chip and a short line of facts. The actions sit on the right, then the tabs, then the content.

## The frame (already built, don't change it)
- `components/app/data-in/data-in-page.tsx` exports `DataInPage({ step, title?, lead?, actions?, children })`.
  - `step` is one of `"files" | "needs-you" | "policies" | "setup"`.
  - `title` names a record on a detail page.
  - `lead` holds the tabs.
  - `actions` holds the buttons on the right.
- Every page in the area, detail pages included, renders inside `DataInPage`. Never use its own `PageHeader`.
- Steps and the area matching live in `lib/dataIn/steps.ts`. `bookAreaOf` keeps the sidebar lit on records.
- The rail counts come from `app/api/app/data-in/steps/route.ts`.

## The eight stages of a file (these exact words, in this order)
1. Uploaded
2. Layout
3. Read
4. Status words
5. Linked
6. History
7. Pipeline
8. Commissions

Each stage is in one of these states: done · needs you (with a count) · failed · not needed · not reached.

Map them from what exists:
- `file_registry.status`
- `parse_block`
- `held_row_count`
- `pipeline_stage_run` (the runs: collect, ingest, parse, store, match, reconcile, analyse)
- `unfinishedSteps`
- `policy_match_review`
- queue items
- commission entries

## Rules for everyone
- Read `AGENTS.md`, `docs/design/UI-CONSISTENCY.md` and `components/ui/README.md` before writing UI.
  - Compose from `components/ui`: `TableCard`, `ViewTabs`, `StatusChip`, `Button`, `Field`, `Callout` and the rest.
  - Text stays at 12 or 14px.
  - No uppercase eyebrows, glows or gradients.
- Never break or drop an existing feature. The older pages keep working and keep their addresses:
  - `/app/policy-matching`, `/app/exceptions`, `/app/book-import`
  - `/app/rate-card`
  - the file and row pages
- **No DDL.** A migration is written to `supabase/migrations/2026110x…` and NEVER applied. The owner pastes it.
  - The code must degrade with a "pending database" note when its tables are missing. Copy that pattern from `POLICY_BOOK_PENDING_MESSAGE`.
- Don't commit. Don't touch files another part owns.
- Don't touch the files another session is editing right now:
  - `app/app/(shell)/layout.tsx`, `app/globals.css`
  - `components/ui/table-card.tsx`, `components/ui/paged.tsx`
  - `components/app/app-top-bar.tsx`, `components/app/overdue-complaint-banner.tsx`
  - `docs/design/UI-CONSISTENCY.md`
  - `lib/design/uiConsistency.test.mjs`, `lib/design/uiOffenders.json`
- **New API routes** must be registered in `lib/entitlements/agentApiPolicy.ts`.
  - Add one line per route.
  - Re-read the file right before each Edit, because others append too.
  - Every route needs `requireFeatureRole`/`requireTenantRole` plus a tenant filter.
- **Running tools:** Node tools run from PowerShell, not Bash.
  - `npx tsc --noEmit -p .`: ignore `validator.ts`.
  - `node node_modules/eslint/bin/eslint.js --quiet <files>`
  - `npm test`
  - Python inside Bash hangs. Use the Edit/Write tools instead.
  - Never round-trip a file through PowerShell `Get-Content`/`Set-Content`, because it corrupts UTF-8.
- Keep the line endings a file already has.
- Add a source-contract test for your part, next to the others under `lib/`.
