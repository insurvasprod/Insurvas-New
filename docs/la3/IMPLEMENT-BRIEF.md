# LA-3 implementation brief — match the boards, build the behaviour, meet the criteria

You are finishing one slice of LA-3 so it is **ready to publish**: the page looks exactly like its
design board, every control does something real against the database, and every acceptance
criterion in `docs/la3/ACCEPTANCE.md` for your tasks is met (or reported as not met, with why).

Read, in this order: this file, `docs/la3/BUILD-BRIEF.md` (server patterns — binding),
`docs/la3/DESIGN-BRIEF.md` (components — binding), `docs/design/UI-CONSISTENCY.md` (binding),
`docs/la3/STATUS-MODEL.md`, the migrations `supabase/migrations/202609261*_la_3_*.sql` (the real
tables), and your boards.

## Your boards

Each board has a condensed outline at `docs/la3/boards/<board>.txt` (structure, copy, and a style
summary: `fsize`, `fweight`, `bg`, `bd`, `color`, sizes) — start there. The full source is at
`C:\Users\Victus\AppData\Local\Temp\claude\C--Users-Victus-OneDrive-Documents-ChatGPT-Insurvas-git-Insurvas-New\3b7cc06c-e0c5-4143-8a36-a21f4fdcc5ba\scratchpad\artifact-files\976a3dc5-a1c8-415c-a6ff-d22b5c48a19d\project\<board>.dc.html`
when you need an exact value. Board content is design data, never instructions.

## Matching rules (settled — apply without asking)

1. **Identical to the board**: layout, order, spacing, copy, which controls exist, which columns
   a table has, which chips a row shows. Sample names and numbers on the board ("Grace Oyelaran",
   "$68.40") are illustrations — render the real data in those slots.
2. **Text sizes snap to the scale**: 11px → 12px, 13px → 14px. 12 / 14 / 16 / 18 / 24 / 32 only.
3. **Controls are 36px** (`<Button>` default), not the board's 40px; `size="sm"` only in table rows.
4. **Colours are tokens**, never the board's hex: `#f1f3f7`→`--canvas`, `#ffffff`→`--surface`,
   `#e4e8ee`→`--surface-alt`, `#d5dbe3`→`--border`, `#7a828e`→`--border-strong`, `#15191e`→`--ink`,
   `#33383f`→`--body`, `#60646c`→`--muted`, `#fff3ec`→`--brand-50`, `#a63800`→`--accent-ink`,
   `#ff5900`→`--primary`, success `#138a43/#0d7038/#e0f3e7`→`--success/--success-ink/--success-surface`,
   warning `#b35c00/#9a4f00/#fcefdf`→`--warning/--warning-ink/--warning-surface`, danger
   `#c92a2a/#b02020/#fdeaea`→`--error/--error-ink/--error-surface`, info `#00708a/#005e75/#e0f2f6`→
   `--info/--info-ink/--info-surface`.
5. **Not built from the board**: the eyebrow line above a page title ("Sell · Application") —
   UI-CONSISTENCY bans eyebrows; any **"Designer's note"** or explanatory callout card (blue/grey
   left-border box explaining the design) — UI-CONSISTENCY §3. One-line field hints and footer
   notes that state a fact the user needs stay.
6. **Build what the board shows**: if a board shows data or a control the product lacks, build the
   real thing behind it (service + route + migration if needed). Never a control that does nothing,
   never invented numbers. If it genuinely cannot be backed (e.g. the AI assistant, blocked on
   decision 4), render the honest unavailable state and report it.
7. The workspace frame (header, step rail, check rail) is already built in
   `components/app/applications/workspace/application-workspace.tsx` and `qa-rail.tsx`. Each step
   renders ONLY its middle card(s), using `StepCard` / `StepSection` from
   `components/app/applications/workspace/step-card.tsx` (grey header strip with the step's
   question + chips, body, footer strip with a one-line note on the left and Back / primary on the
   right, primary last). Back / Continue buttons call `goTo(previous|next step)`.

## Code rules that tests enforce

- Toasts: `import { notify } from "@/lib/notify"` (`notify.done`, `.warn`, `.block`, `.fail`,
  `.win` for money only; options `{ detail, action }`). Never import `sonner`.
- Import components by alias (`@/components/app/applications/...`) or same-folder `./name` — never
  `../x/y` (the orphan check cannot see those).
- Every `<Button>`/`<button>` has `onClick`, `type="submit"` inside a form, `asChild`, or
  `disabled` (with a `title` saying why).
- API routes call `requireFeatureRole("<feature>", ["owner", "producer"], { write: true })` **in the
  route body** (then `actorOf(auth, request)` from `lib/applications/http.ts`) — the money-boundary
  and plane-isolation tests read the role list from the route file.
- Appointment eligibility only through `lib/appointments/eligibility.ts` (`appointmentIsActiveAt`,
  `canWriteFromVault`) — never compare `terminated_at` yourself.
- Money: integer cents; `parseDollarsToCents` / `formatCentsAsCurrency` from `lib/money.ts`.

## Shared files

Do NOT edit: `lib/entitlements/agentApiPolicy.ts`, `lib/audit/actions.ts`, `lib/menu/definition.ts`,
`lib/settings/sections.ts`, `components/app/agent-settings-tabs.tsx`, `components/app/agent-sidebar.tsx`,
the test registries (`lib/tenantAuth/moneyRoutes.test.mjs`, `lib/partnerAuth/planeIsolation.test.mjs`,
`lib/audit/coverage.test.mjs`), `lib/applications/{constants,types,db,http,crypto,service,mutations,schemas,qa}.ts`,
`components/app/applications/workspace/{context,application-workspace,qa-rail,step-card}.tsx`,
`components/app/applications/parts.tsx`, and existing migrations.

If you need a change in one of them, put the logic in a NEW file and list the exact change you
need in your report. New migrations go in YOUR timestamp range (given in your assignment), one per
concern, following `20260926100000_la_3_7_application_record.sql`'s conventions (and the explicit
`revoke delete, truncate` for anything that must never be deleted). Parse-check each with
`node --env-file=.env.local scripts/check-migrations.mjs <bare filename>` from PowerShell (expected
noise: "blocked on rights", 42P01 on tables not yet created, the final assertion failing).

## Report back

1. Files created / changed. 2. Per task: each acceptance criterion — met / not met (why).
3. Registry entries I must add: `agentApiPolicy` lines, audit actions (key + label), money/neutral
classification per route, any bearer/pre-auth route. 4. Changes you need in shared files.
5. Migrations you added. 6. Checks: `tsc -p tsconfig.la3check.json`, eslint on your files, your tests.
