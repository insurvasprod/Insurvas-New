# Spec: Settings › Form templates redesign

Status: **draft for approval** (2026-10-27). Mockups: the "Form templates redesign" canvas.
Nothing is built yet.

**Revision 2: the team's redesign style.** The team's "Insurvas Redesign Canvas" sets the look for
every redesigned screen, and this page now follows it (canvas page "Round 2 · team style"):

- **Look:** dark only, background `#030b09` with the animated green "Data Highway" lines; glass cards (white 6%→1.5% gradient, white 9% border, 16px radius, blur); Montserrat; 30px page titles (-0.03em) with a 14px `#9fbcb2` line under them; small-caps labels (12px, 700, `#7fa89b`); pill buttons (`#07d6a0` on `#04110d`, ghost with a white 16% border), 36px fields with 10px radius; 30–34px chips for choices; an "i" circle with a tip on every label; orange `#f2a541` "CHANGED" tags with "Reset to default".
- **Page pattern:** title, description and one primary pill on the right → selector cards (here: one per product) → a **status card** ("✓ Live" in green, or the orange "N changes not published" with Discard and Publish) → list on the left with an editor card on the right → new things in a centred glass modal. Its rulebook: 12 questions per screen, one green moment per view, motion 80–250ms with reduced motion respected.
- **Process:** variants plus a **"Nothing lost" board** that places every feature. Here: **A** three panes (questions · the one you picked · the partner's phone) and **B** the partner form is the page and you edit it in place. Both keep all 14 features (see the board).

**Revision 3: critique and the recommended variant C** (canvas boards "C" and "Critique"). Checked
against the team rulebook and the `ui-taste` simplify/polish playbooks, from source (not rendered):
B's idea won (edit the form itself; A showed the form twice). C fixes twelve findings: one green
button (Publish, only when there are changes); the live/changed state moves into the product card;
settings live only on the status line, in plain words ("Who can apply", "Parts of the form", "Lead
steps", "New Insurvas version"); "Do they have to answer? Yes, always / Only here / No, they can skip";
answer types in plain words ("Words, A number, Money, A date, Yes or no, Pick from a list"); a small
up/down/delete toolbar on the picked question; the "add a question" picker opens inside its section;
"Deleted · Undo" for 6 seconds; a Computer/Phone switch; and a plain-words sentence at the top of the
panel that says what partners will experience, generated from the settings. Section names such as
"How to reach them" are suggested defaults; each agency's own labels stay theirs.

**Revision 4: layout A, built 2026-10-30** (owner pick; canvas page "Settings · Form templates",
boards FtA and every edit FtE01–FtE18, FtP01–FtP03). The form plus one side panel: "This form" rows
(Who can apply, Topics, Lead steps, Version with who published it and when, For your agents only) until
a question is picked, then that question. Live / N changes, Review (changes + blockers), Undo all and
Publish version N sit on the title's line; products are chips; each part's move and remove are in a ⋯
menu; the phone preview is always one column; below 1280px the panel is a sheet drawn on `<body>`.
No API change except `published` on GET /api/app/templates.

The light-theme layout below was round 1. It still describes the features, the storage and the tests; the
look follows revision 2.

## Objective

Settings › Form templates (`components/app/template-settings.tsx`, `/app/settings#form-templates`)
is where an owner decides **which questions a lead form asks, for each product**. Partners fill
that form in the partner portal, and agents see the same fields on the lead. Today it works, but
it is a long page that nobody understands at a glance:

| Today | Why it hurts |
|---|---|
| One long table: grey section rows mixed with field rows, each with an Edit button | You see a database table, not a form. Order, grouping and what partners see are guesswork |
| The partner preview is at the very bottom, under 6 cards | The one thing that explains the page is out of sight |
| Six cards below the table: Eligibility limits, Changes before commit, Your active product form, Platform templates, Pipeline stages, Form sections | About 2,000px of scrolling, each card a separate idea with its own vocabulary |
| The product switcher is a small select in a toolbar | It is not obvious there is one form **per product** |
| Draft, commit, versions: "Changes before commit", "Commit all three" | Developer words; it is unclear that partners already mid-form are safe |
| Field and section editing in modals, sections edited from a separate dialog | Your place in the form is lost, and fields are added in two different ways |

**Who:** the agency owner (owner-only, as today).
**Success:** someone who has never seen the page can say, within 30 seconds, which product's form
they are looking at, what a partner will see, how to add or change a question, and whether their
changes are live.

## What must be kept (functional inventory)

Same API (`GET/POST /api/app/templates`, `PATCH /api/app/templates/[id]`, `POST /api/app/templates/preview`):

1. One form per product; switching product is blocked while there are unpublished changes.
2. Sections: add, rename (key fixed), reorder (new), remove (not the last one), see their fields.
3. Fields: add new (to a section or as lead-only), place an existing field in a section, remove from a section, reorder within a section, delete; edit label, type (13 types), help text, required everywhere, options for choice types, validation per type (min/max; age min/max for dates; length and pattern for text-like; fixed rules for bank routing/account; none for choice types).
4. Per placement: required on this form, "show only when <field> equals <value>".
5. Lead fields not on the partner form are listed (lead-only fields).
6. Eligibility limits: min/max age read from the date-of-birth field; the "no date of birth" state.
7. Section groups on/off (Personal, Medical, Insurance, Beneficiary, Banking, Signature) with the refusal rules (the phone section, required fields).
8. The form's name; the live version number; field count.
9. Platform templates: choose, preview what applying adds (fields, sections, stages, already applied), apply (blocked while unpublished changes exist); "Review platform update" when a newer version exists.
10. The product's pipeline stages: add, rename, closes as (open, won, lost), colour, remove; key shown.
11. The whole form is one draft; the change list with times; Discard; Commit as a new immutable version; partners mid-form stay on their version; save error shown.
12. The partner preview: the real `PartnerLeadForm`, fed the draft, never submits.
13. Loading, error with Try again, and "No form is configured" states.

## Design (what changes)

Shared parts only (`docs/design/UI-CONSISTENCY.md`), no new dependencies.

- **Header:** `SettingsSectionHeader` "Form templates", one sentence, and a **status chip**: "● Live · version 7" (good) or "● 3 changes not published" (warning).
- **Product tabs (`ViewTabs`):** one tab per product, each with its question count ("Term Life · 18"). It reads as "one form per product" without a word of explanation. Switching with unpublished changes asks Publish / Discard / Stay.
- **Settings summary row:** four compact chips under the tabs, each a button opening the **Form settings** panel at that part: "Ages 18–80", "5 of 6 section groups on", "6 stages", "Platform update v8 available" (info tone, only when there is one). This replaces the six cards: about 1,800px saved.
- **The builder, two panes (≥1100px; one column below):**
  - **Left: the form outline.** Sections are numbered cards (1 Applicant, 2 Contact, 3 Coverage…). Inside, each field is one 40px row: ↑↓ buttons, a type icon, the label, and tags only when they matter: **Required**, **Only if…** (conditional), **?** (has help text). An **+ Add a question** button sits at the end of each section, and **+ Add a section** at the end of the form. A last, muted group, **Kept on the lead, not asked on the form**, holds lead-only fields.
  - **Right: Preview / Field settings.** By default, the live **partner preview** (the real form, with a Desktop / Phone width switch). Clicking a field selects it (highlighted in the outline and in the preview) and the right pane becomes **Field settings**: label, type (picker with icons), help text, **Required**: Everywhere / On this form only / No, options (one per line, add/remove), validation that only shows the rules that type has, **Only show when** (field + value), Move to section, Remove from form, Delete field. **Back to preview** returns.
- **Form settings (`DetailPanel` overlay), four tabs:** Eligibility (age limits) · Sections (group switches with their refusal reasons) · Stages (the product's stages) · Template (name, version history, platform update preview and apply).
- **Publishing:** the sticky save bar reads "3 changes not published · See changes · Discard · **Publish version 8**". "See changes" opens the change list in a popover. The `InfoTip` on Publish says partners mid-form keep their version. "Commit" becomes **Publish** everywhere.
- **Help:** an `InfoTip` on product, required, only-if, help text, lead-only fields, eligibility, section groups, stages, version. No explanation cards.
- **Phone:** tabs scroll; the outline is one column; Field settings and Form settings are full-screen sheets; a **Preview** button opens the preview as a sheet.

## Research and what it changed

**Patterns from form builders** (Formtoro, Tripetto, Typeform, Tally, HubSpot docs; vendor sources):
an outline on the left and an inspector on the right, a live preview with desktop/phone widths, a
badge on fields that have logic, and a separate "test with logic" mode. A single-column form is
easier to fill (eye-tracking guidance). Applied: the outline + preview/inspector panes, the
**Only if…** tag, Desktop/Phone switch; the partner form itself stays single-column on phones.

**Installed skill checklist (`ui-ux-pro-max`, Forms & Feedback, Accessibility, Touch):**
- a keyboard alternative for every drag → drag handles **and** ↑↓ in the inspector;
- undo for destructive actions → deleting a question shows "Deleted · **Undo**" (sonner toast action) instead of a confirm dialog; deleting a section with questions still confirms;
- confirm before dismissing with unsaved work → switching product or leaving the page with a draft asks Publish / Discard / Stay;
- error summary before submit → the changes popover ends with "Checked: nothing blocks publishing", or lists each problem with a link to the question (for example a section group that cannot be switched off);
- autosave long work → the draft is kept on this device (local storage, per product) and restored on return, labelled "Draft kept on this device";
- progressive disclosure → validation shows only the rules that answer type has; options only for choice types;
- 44px targets, visible focus, labels on every control, no colour-only meaning (tags carry words).

**Libraries checked against what we already ship** (`radix-ui`, `lucide-react`, `sonner`, `zod`, `cva`):
- **`@dnd-kit/core` + `@dnd-kit/sortable`** — accessible drag-and-drop with a keyboard sensor and screen-reader announcements. Recommended for reordering questions and sections (new dependency → needs approval). Without it: up/down buttons only.
- **Answer-type picker:** a Radix Popover with a 13-item grid and a filter box (screen 3). `cmdk` was considered and is not needed for 13 items.
- **Preview:** keep rendering the real `PartnerLeadForm`; no form library is added, so the preview cannot drift from what partners get.
- Radix `Collapsible`, `ToggleGroup` and `Popover` (already in `radix-ui`) cover section collapse, the segmented controls and the changes popover.

## Tech stack (unchanged)

Next.js 16.3.3, React 19.2.3, TypeScript, Tailwind v4 tokens in `app/globals.css` (light and `.dark`),
Radix UI, lucide-react, sonner, zod, Supabase. Montserrat.

## Commands

```
Dev:        npm run dev        (http://localhost:3000/app/settings#form-templates)
Test:       npm test           (~24 known baseline failures)
Lint:       npm run lint
Typecheck:  npx tsc --noEmit -p tsconfig.la3check.json
UI ratchet: node --experimental-strip-types --test lib/design/uiConsistency.test.mjs
```

## Project structure

```
components/app/template-settings.tsx          → the section (split below)
components/app/form-templates/outline.tsx     → NEW: sections and field rows
components/app/form-templates/field-settings.tsx → NEW: the right-pane inspector
components/app/form-templates/form-settings.tsx  → NEW: the DetailPanel with 4 tabs
lib/agentTemplates/draftChanges.ts            → change list (unchanged)
lib/templates/*                               → types, availability rules (unchanged)
docs/design/specs/form-templates.md           → this spec
```

## Code style

Match the existing files: shared parts, tokens only, the draft updated through one `update()`.

```tsx
<FieldRow field={field} placement={placement} selected={selectedKey === field.field_key}
  onSelect={() => select(section.section_key, field.field_key)} onMove={(by) => moveField(section.section_key, field.field_key, by)} />
```

## Testing strategy

- Pure helpers (field row tags, settings-summary chips, move between sections) in `lib/agentTemplates/` with `node --test`.
- The existing draft and availability tests stay green (`draftChanges`, `sectionAvailability`).
- Browser: 1280px and 375px, light and dark, keyboard only; every inventory item checked against a test agency, including a publish that creates a new version.

## Boundaries

- **Always:** keep every inventory item; shared components; tokens only; `InfoTip` for explanations; test, lint, typecheck, ratchet.
- **Ask first:** any API or database change (none planned); moving product stages out of this page; drag-and-drop (planned: buttons only).
- **Never:** drag-only reordering; editing a published version in place; a second header; explanation cards.

## Success criteria

1. All 13 inventory items work as before.
2. The partner preview is visible on first load at ≥1100px, with no scrolling.
3. The page with a typical form (4 sections, 15 fields) fits in about 1.3 screens at 1440×900, against about 3.5 today.
4. Adding a question takes one click from the section it belongs to; editing one never opens a modal.
5. Whether the form is live or has unpublished changes is visible at all times.
6. 375px with no sideways scroll; 44px tap targets; contrast and keyboard as in `00-FOUNDATION.md` §9.
7. `npm test` has no new failures; lint, typecheck and the ratchet are clean.

## Open questions

1. **Pipeline stages here:** each product's form carries its own stages, which overlaps with Settings › Pipelines. Keep them under Form settings › Stages (this spec), or move them to Pipelines?
2. **Reordering:** add `@dnd-kit` for drag-and-drop with keyboard support (recommended, a new dependency), or up/down buttons only?
3. **Required wording:** "Everywhere / On this form only / No" (this spec) instead of the two separate switches today: agreed?
