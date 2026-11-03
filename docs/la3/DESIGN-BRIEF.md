# LA-3 design brief — for everyone building an LA-3 screen

Read this, then `docs/design/UI-CONSISTENCY.md` (binding), then the Notion task text quoted in your
assignment. You are building the **Design phase**: real routes, real components, real copy, driven
by typed sample data. No database, no API, no migrations.

## The contract you build against (do not edit these files)

| File | What it gives you |
|---|---|
| `lib/applications/constants.ts` | statuses, outcomes, labels, tones, steps, canonical field groups (`CANONICAL_GROUPS`), payment methods, relationships, requirement kinds, income types |
| `lib/applications/types.ts` | every view model: `CaseView`, `AttemptView`, `QuoteView`, `BeneficiaryView`, `PaymentView`, `DisclosureView`, `InterviewView`, `RequirementView`, `CounterofferView`, `SubmissionView`, `ApplicationListRow`, `PendingRow` |
| `lib/applications/fixtures.ts` | `FIXTURE_CASE` (Rita Alvarez: attempt 1 declined at Foresters, attempt 2 draft at Mutual), `FIXTURE_ATTEMPT`, `FIXTURE_APPLICATIONS`, `FIXTURE_PENDING`, `FIXTURE_COUNTEROFFER` |
| `lib/applications/qa.ts` | `runQa()` → `{verdict, blocking[], warnings[]}` with deep links |
| `lib/applications/beneficiaries.ts` | `checkBeneficiaries`, `splitEvenly`, `parseShare`, `formatShare`, `tierTotal` (shares are integer hundredths: 3334 = 33.34%) |
| `lib/applications/formats.ts` | `isPlausibleSsn`, `isValidAbaRouting`, `passesLuhn`, `cardBrand`, `cardExpiryInFuture`, `maskLast4`, `dobVariants`, `phoneVariants` |
| `lib/quotes/math.ts` | `estimatePayout`, `checkQuote`, `premiumPer1000`, `ratingAge` |
| `lib/draftDates/optimiser.ts` | `recommendDraftDay(input)` → recommended day, two alternates, read-aloud reason, 12 arrival dates |
| `components/app/applications/parts.tsx` | `money`, `face`, `shortDate`, `ordinal`, `AttemptStatusChip`, `QaVerdictChip`, `SourceMark` (prefilled marker), `SensitiveValue` (masked + Reveal), `Panel` (a titled white module), `SampleDataNotice` |
| `components/app/applications/workspace/context.tsx` | `useWorkspace()` → `{caseView, attempt, attemptsForInsured, insured, interview, step, qa, readOnly, sample, goTo(step, fieldKey?), selectAttempt, setValue(key, v), markReviewed(key), updateAttempt(patch), updateInterview(patch)}` |

If a view model is missing something you need, define a local type in **your** file and list it
in your report. Do not edit shared files — other people are building beside you right now.

## Design system — use these, never hand-roll a copy

- `PageHeader {title, description?, actions?}` (`@/components/ui/page-header`) — once per page. No eyebrow. Detail pages get one back link (`← Applications`) above it, like `components/app/lead-detail-workspace.tsx`.
- `StatStrip` + `StatTile {label, value, valueTone?, footnote?, delta?}` (`@/components/ui/stat`) — at most one strip, 3–6 tiles, directly under the header.
- `TableCard {title?, description?, action?, toolbar?, footer?}` + `DataToolbar`, `ToolbarSearch`, `FilterButton`, `RefreshButton`, `toolbarControl` (`@/components/ui/data-toolbar`) — the model is `components/app/partner-quality-workspace.tsx` lines 119–200. Order: search → filters → spacer → actions → Refresh last. Tables use `className="portal-lead-table w-full text-left text-sm"`, `tbody className="m-seq"`, rows `className="m-row"`. Row actions are the last column, right-aligned, `size="sm"` outline.
- `Pager` + `paginate()` (`@/components/ui/pager`) in the footer. `EmptyState {title, hint}` / `NoMatches` / `ErrorState` / `SectionLoading` (`@/components/ui/page-states`).
- `StatusChip {tone}` — tones `neutral | good | info | warning | danger | action`. Orange (`action`) only for a row the reader must act on.
- `Button` (`@/components/ui/button`) — default size (36px) everywhere; `size="sm"` only in table rows; `size="icon"` for icon-only. Variants `default` (primary, orange), `outline`, `secondary`, `ghost`, `destructive`. Primary action last.
- Form fields: `Field {label, htmlFor, required?, hint?, error?}` and the `control` class for `<input>`/`<select>`/`<textarea>` from `@/components/app/settings/primitives`. Every field has an `id`; **canonical fields use the canonical key as the DOM id** (e.g. `id="insured.dob"`, `id="pay.routing_number"`) so QA deep links land on them.
- Dialogs: `@/components/ui/dialog` (see an existing use, e.g. `components/app/disposition-wizard-dialog.tsx`).
- Icons: `lucide-react`. Toasts: `import { toast } from "sonner"`.
- Layout: page stack `className="m-stagger flex flex-col gap-6"`. No card inside a card. Two columns only when the second column is real content. Tailwind only — no new CSS in `app/globals.css`, no `.portal-*` rules. No motion classes on print routes.
- Colour: `--primary` (orange) only for active / selected / action. Never an orange border, divider or table header. Warnings are amber (`--warning`), never red.

## Copy rules

- No explanatory, design-note or "how this works" cards. Helper text goes in a field `hint` or a `title` tooltip.
- **Exception — required honesty lines.** Where the sprint task requires a fixed line (payout strip: *"Recommend on fit first. Payout is shown to inform the choice between carriers the client equally qualifies for, not to choose between them."*; carrier ranking: *"Ranked by your commission. This does not check whether the carrier will accept their health history."*; clipboard: *"Clearing the clipboard is best-effort — your computer may keep a copy."*; placed metric: *"Partial"*), render it as **one line of muted text** in place, never a card.
- Sentences are plain and short. Sentence case. Say what to do.
- The AI assistant (LA-3.3) is blocked on the provider decision — do not design a working one; where it would sit, show nothing.

## Every page shows

- `SampleDataNotice` while it reads fixtures.
- Its empty state, and (for lists) its no-matches state. Read-only when `readOnly`.
- Keyboard: every clickable thing is a `<button>` or `<a>`, visible focus ring.

## Checks before you report

Run from **PowerShell** (Bash cannot find node here):

```
node node_modules/typescript/bin/tsc --noEmit -p .
node node_modules/eslint/bin/eslint.js <every file you created or changed>
```

Check `$LASTEXITCODE`, not grep. Other agents are writing files at the same time; fix every error
in **your** files and ignore errors that are only in files you do not own (name them in your
report). Do not start a dev server, do not open a browser, do not commit.

## Report back

Files created/changed; anything in the task you could not show with the fixtures (and why); any
local types you had to add; tsc and eslint results for your files.
