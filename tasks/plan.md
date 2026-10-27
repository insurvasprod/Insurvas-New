# Implementation Plan: Manager Feedback and Settings Experience

## Overview

Fulfill the manager's requests across the full 28 October review, with one reusable page layout for every Settings section and dedicated Settings route. Simplify dense screens only after tracing what each control supports. Keep work on `redesign/my-profile`, preserve the existing uncommitted Profile redesign, and use the user-selected UI Foundation v3 artifact as the visual foundation.

## Read-only audit

The review source is `tasks/manager-review-2026-10-28.md`; the full local transcript is `tasks/manager-transcript-2026-10-28.md`. The transcript is automatic speech recognition, so names and a few terms remain uncertain. The table distinguishes direct manager feedback from work already partially present.

| Area | Manager's clear request | Current local source review | Planned treatment |
|---|---|---|---|
| Sign-up | Start with email/password and Google; move personal details to About you; full-width fields; smoother Back/Continue navigation | Source now has email/password plus required legal acceptance; personal details are collected in the later About you section. No Google account OAuth route exists in this checkout. The running localhost preview exposes Google links and different labels/step order that do not match source, so it is not reliable visual evidence for this checkout yet. | Preserve legal acceptance and existing signup creation; finish the source-backed personal-details path; reconcile the local preview and verify provider configuration before counting Google sign-up as working |
| Verification and flow | One clear Continue action; consistent bottom navigation; persona-aware About you copy | The current flow routes through email verification, business profile, plan and checkout; a shared Back/Continue footer is absent | Align screens and navigation without losing resend/change-email behavior or deep links |
| Plan and checkout | Reuse a plan selected from Pricing; show trial and due-today facts; reduce checkout scrolling | `PlanChoiceProvider` initializes saved plan details but `PlanChoiceForm` still renders “Choose your plan”; business profile comes before plan/payment | Distinguish an intentional Pricing selection from the header free-trial entry; reorder the flow and compact checkout around Whop |
| Business profile | Let the user skip business details and finish them after paying | `app/app/(shell)/layout.tsx` already gates incomplete self-serve onboarding; current business profile is before checkout and has no skip route | Move it after payment and preserve an explicit setup gate; do not turn the manager's “trap” wording into user-facing copy |
| Product showcase | Show real product capabilities on the auth/signup right panel and make transitions smooth | `FunnelFrame` reuses the existing `StoryPanel`; it is not the step-aware product showcase described in the review | Build from real components and synthetic data; support reduced motion and a pause control if any scene auto-advances |
| Sign-in | Simplify copy, remove the email-link CTA, use matching partner-link styling, label Google action “Sign in with Google” | Source has the requested copy, no email-link request CTA, and matching partner-link styles. The running localhost preview shows a Google link absent from source; no matching auth route exists in this checkout. | Keep the source changes; reconcile which build the preview serves before confirming rendered Google behavior |
| App shell | One account menu at top right; breadcrumb on the page; improve sidebar hierarchy | Current code puts the account control in the sidebar rail, matching an earlier owner request; manager explicitly asked for top right. The local shell is not identical to the deployed screen in the video | Treat the latest user instruction to follow this manager review as superseding the earlier placement choice; change only the named shell surfaces |
| Settings navigation | Real left-side Settings navigation; consistent Settings title and description; align panel starts | `AgentSettingsTabs` is a 262px sticky rounded/frosted rail; Settings has a title but no description | Replace with a clear attached navigation and shared page header while preserving section, role and entitlement gates |
| Contracting | Guided carrier/state setup, inline carrier details, state multi-select, saved progress, responsive selection; move Field maps out of the main steps | Carriers and States tabs, multi-state selection, All/None actions and per-change saves exist; Add carrier remains a dialog; Field maps remains a tab; current state interaction still needs real browser verification | Keep useful existing behavior and build a clear guided two-step flow; move Field maps to an Advanced/Other destination rather than deleting the feature |
| Licence/NPN requirements | The manager agreed to removing the database requirement for NPN/licence details in the contracting setup | Source trace finds no NPN/licence requirement on the appointment-save path; the state setup warning was presentation-only and is now replaced by a clear note that selling/routing eligibility still checks licences | No migration is justified by this checkout's save path. Keep stored data and separate eligibility checks; reconcile the deployed preview and a non-production schema before closing the audit |
| Partners | Fix the Add partner form's email, name, timezone and country experience | `partners-workspace.tsx` uses free-text country/timezone and a 2-column order the manager disliked | Use labelled country/timezone selectors with sensible defaults, validate email clearly, and retain existing saved values and API contract |

## Design direction

- **Approved direction:** the user-provided *Insurvas UI Foundation v3* artifact (27 Oct 2026) marks **Inter + Inter Tight** as the chosen type direction. The earlier Montserrat assumption in this plan was wrong. Current `app/layout.tsx` and `app/globals.css` still load Montserrat, so make the font switch an explicit foundation task and inspect `docs/design/BRAND.md` plus representative public/app screens before changing the root font.
- Reuse the artifact's UI grammar: page 24/600, section 18/600, card title 15/600, body 14/400, label 13/500, meta 12/400; tabular figures for numeric data; 8px controls, 12px cards/dialogs/sheets, 10px menus and 6px badges; one purposeful card per task/object, with spacing before borders and one divider before meaningful footer actions. Do **not** paste the dashboard's glossy metric-card treatment onto settings forms.
- Use the shipped shadcn/Radix controls and `components/app/settings/primitives.tsx` as the base. Keep semantic status colors, the app's contrast-tested tokens, and light/dark support. The artifact's Inter choice supersedes the previous Montserrat plan for this work; don't change unrelated marketing styling without checking the root-font impact.
- For Settings, use one consistent frame: “Settings” plus a useful purpose description, an attached left navigation with aligned content, predictable section headers, and a shared content width. On small screens, collapse the rail into a usable section selector; preserve route links, role/entitlement gates, read-only states, history, and hash/anchor deep links.
- Make that frame a single reusable layout component used by every registered Settings panel and the dedicated Accounting, Retention and Compliance routes. The active page keeps its own task-specific heading/description, while the shared Settings title/purpose, navigation, content start line and width remain stable. Prefer a semantic grouped navigation list with current-page state; don't make a large Settings menu a horizontal tab strip.
- Simplify through an evidence-based page inventory: label each block as required for a task, duplicated, rarely used/advanced, or obsolete. Consolidate or move optional configuration to Advanced where discoverability improves; remove only confirmed dead/duplicated UI after checking its route, API, role/feature gate, help content and data dependencies. Preserve security, audit, legal, licensing and eligibility controls unless the user explicitly approves a behavior change.
- Apply the manager's Title Case request consistently to Settings navigation labels and tabs only. Keep helper text sentence case. Leave the manager's ambiguous “remove this thing” near the Settings entry untouched until its target is identified.
- Contracting should guide a first-time user through carriers then states. Use real checkbox/multiselect semantics, visible saved/error states, and reversible optimistic updates; avoid blocking setup for optional appointment details. Do not delete existing licence/NPN data or weaken separate eligibility checks.
- UI-taste workflow: treat the provided artifact as the approved foundation target; use the local Settings screen as the incumbent baseline. Before implementation, capture a safe representative Settings view (avoid retaining account secrets), then implement from shared patterns, check desktop/tablet/phone and light/dark, and compare a real render. Source review alone does not prove the design or interactions.

### Continuation scope for this turn

The user has clarified that the scope is **all** manager requests in the video, not only the portions after sign-in. Continue in the plan's order: finish auth/onboarding changes, then the app shell, shared Settings layout/content system, Contracting, and Partners. The local Settings route previously inspected was `/app/settings?two_factor=required#my-profile/security`; its accessibility tree confirmed the Settings registry groups sections and renders the active Profile/security panel. No account settings were changed, and no private account values belong in the design notes.

### Current implementation status

Task 1's source changes are present, but the live localhost preview shows a Google OAuth link that has no corresponding route in this checkout. Task 2 now removes names, phone and password confirmation from the account form, preserves the existing legal-document IDs and adds those personal details to the later About you section. The source-backed signup schema tests pass. The live preview does not match the checkout's signup labels/order, so it cannot serve as the visual verification target until the dev-server/worktree mismatch is resolved. No browser signup or account creation was submitted.

Task 3 routes fresh signups through a one-button account-created state, preserves verification actions and removes its sign-out link. Task 4 persists whether the plan came from Pricing and tailors copy to the selected audience. Task 5 now has a separate About you step before plan/payment, an optional business-profile gate after checkout, and a persisted Skip for now action. Migrations `20261028400000_pricing_plan_intent.sql` and `20261028500000_payment_before_business_profile.sql` are source-only and unapplied. The checkout embed and whole-journey browser review remain. No tests were run during this continuation; `npm run typecheck` was previously blocked by the malformed generated route type file noted below.

### Design research

- User-provided *Insurvas UI Foundation v3*: selected Inter + Inter Tight and card/table/overlay rules above (visual and accessibility-tree review).
- [Primer NavList](https://primer.style/product/components/nav-list/): grouped, active navigation for a parent/detail split layout, including a Settings example; use `aria-current` and keep URL state meaningful.
- [Atlassian navigation-system migration guidance](https://atlassian.design/components/navigation-system/migration-guide): global actions belong in top navigation, while app destinations belong in side navigation. The older standalone SideNavigation package is deprecated, so only use its newer system guidance as a pattern reference.
- [Carbon checkbox guidance](https://www.carbondesignsystem.com/building-blocks/core/components/checkbox/guidelines): checkboxes for independent multi-selection; parent/child selection should expose indeterminate state.
- [Carbon form selection guidance](https://www.carbondesignsystem.com/building-blocks/core/patterns/forms): match control choice to the number and multiplicity of options; use a multi-select for many selectable values.
- [W3C WCAG 2.2 target-size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): assess pointer targets and spacing on the dense carrier/state controls.

## Architecture decisions and safeguards

- Preserve legal acceptance and accepted-document version IDs. The transcript's suggestion to change checkbox presentation is not authorization to remove legal consent; keep it until the legal requirement is confirmed.
- Preserve old signup URLs, email verification, plan intent, notification/security history, anchors and role/entitlement gates.
- Do not erase stored NPN or licence values. A licensing data migration must be rerunnable, reviewed, and verified on a non-production database before production application.
- Do not infer Google sign-in is configured from Google Calendar support. Confirm the Supabase/provider callback settings and environment readiness before calling the UI flow complete.
- Keep changes uncommitted and preserve existing dirty work unless the user later asks for a commit or a different branch.

## Task List

### Phase 1: Clear manager-requested auth fixes

#### Task 1: Correct tenant sign-in copy and actions

**Description:** Apply the clear sign-in feedback while preserving password reset, email verification and maintenance states.

**Acceptance criteria:**
- [x] Subtitle says “Sign in to your workspace.”
- [x] The standalone email-link CTA is removed from the sign-in surface; already-issued emailed links still complete sign-in.
- [x] Partner portal copy shares the same visual treatment and line hierarchy as the nearby account link.
- [ ] The checkout source has no Google account OAuth route. The localhost preview exposes a Google link absent from source; reconcile the preview/build and verify the route/provider before calling that action complete.

**Verification:** Source review confirms the requested copy and removed email-link CTA. The current localhost preview disagrees with source about Google OAuth; resolve the target/build before claiming rendered verification. Keyboard/narrow-screen review remains.

**Dependencies:** None.

**Files likely touched:** `components/app/tenant-auth-workspace.tsx`, auth callback/provider files if already supported.

**Estimated scope:** Medium.

### Checkpoint: Sign-in fixes

- [ ] Task 1's applied copy/action changes are visually reviewed in the local app.
- [ ] The signup first step and verification transition are ready for the user to review before plan/payment changes.
- [ ] Existing auth routes and legal acceptance behavior are accounted for.

#### Task 2: Make account creation a short first step

**Description:** Reduce the first signup step to the account credentials and social sign-in, moving name and phone collection to About you. Keep legal consent recorded with the exact accepted document versions.

**Acceptance criteria:**
- [x] Email and password occupy separate full-width rows; the first step has no name, phone or confirmation field.
- [x] One primary account-creation action remains.
- [ ] Google sign-up is wired to a verified provider path; the current source has no matching OAuth route.
- [x] Legal acceptance remains required; accepted document IDs continue to be sent and recorded.
- [x] The public signup API accepts account-first payloads; it stages a provisional name and the later About you path validates and saves real name/phone.

**Verification:** `node --experimental-strip-types --test lib/signup/schemas.test.mjs` passes. Desktop/phone browser verification is pending because the localhost preview renders different signup labels and step order from the checked-out source.

**Dependencies:** Task 1's provider/configuration check.

**Files likely touched:** `components/public/signup-form.tsx`, `app/api/public/signup/route.ts`, signup validation/context files.

**Estimated scope:** Large; split backend/provider and form changes if they exceed one focused session.

#### Task 3: Make verification and step navigation consistent

**Description:** Align the post-account screen and onboarding steps with one predictable footer and preserve the existing email-verification actions.

**Acceptance criteria:**
- [x] The account-created path has one clear primary Continue action; the verification panel has no competing sign-out link and keeps resend/change-email actions.
- [ ] Later steps use a consistent bottom Back/Continue pair; Back is absent on the first step.
- [x] Privacy, Terms and Support remain available in the shared footer.
- [ ] Enter submits the current form, and old verification/deep-link routes continue to work.

**Verification:** Focused signup and plan-choice checks pass (19 tests), and ESLint passes on touched files. Browser verification remains pending because localhost renders a different signup build than this checkout; full typecheck is blocked by malformed `.next/dev/types/routes.d.ts` at line 745.

**Dependencies:** Task 2.

**Files likely touched:** `components/app/funnel-frame.tsx`, `components/app/verify-email-panel.tsx`, onboarding step pages.

**Estimated scope:** Medium.

### Phase 2: Signup sequence, plan and showcase

#### Task 4: Carry persona and plan intent through onboarding

**Description:** Preserve the landing-page persona and distinguish a plan explicitly chosen in Pricing from a visitor who starts a trial without choosing a plan.

**Acceptance criteria:**
- [x] Agent copy says “Tell us about you”; agency copy remains appropriate for agency selection.
- [x] A plan selected in Pricing is shown as selected and does not require an unnecessary second plan decision.
- [x] A visitor starting the free-trial path without a chosen plan still gets the plan chooser.
- [x] Progress, plan, billing cycle and selected add-ons survive refresh and returning to the flow.

**Verification:** Focused plan-choice tests; exercise both Pricing and header-trial entry paths in a browser.

**Dependencies:** Tasks 2–3.

**Files likely touched:** `lib/signup/context.ts`, `lib/signup/planChoiceQueries.ts`, `app/app/onboarding/plan/page.tsx`, `components/app/plan-choice.tsx`.

**Implementation note:** Explicit Pricing intent is persisted as `signup_selections.selected_from_pricing` by migration `20261028400000_pricing_plan_intent.sql`. The app code and migration are present, but the migration has not been applied to any database. Apply it through the approved migration workflow before relying on this path. Existing plan/cycle/add-on persistence remains in the existing selection and add-on records.

**Estimated scope:** Medium.

#### Task 5: Reorder payment and optional business details safely

**Description:** Move plan/payment ahead of business details, offer Skip for now, and retain a clear setup gate after payment for the requested business information.

**Acceptance criteria:**
- [x] New signups can complete payment before filling the business profile.
- [x] Skip for now persists safely and returns the user to a clear onboarding completion step after payment.
- [x] Required setup is explained plainly and does not use coercive “trap” copy.
- [x] Existing users already in `business_profile`, `ready_for_checkout` or `awaiting_payment` continue to the correct destination.
- [x] Route/API/migration transitions preserve trial, paid and abandoned-checkout behavior.

**Implementation note:** the new sequence uses `about_you` before payment and `business_profile` only as a post-checkout gate for new accounts. The previous combined form remains available to accounts already in the older `business_profile` state. `business_profile_skipped_at` records an intentional skip. Migration `20261028500000_payment_before_business_profile.sql` is present but unapplied; deploy the migration before relying on this sequence. Source changes have not yet been browser-reviewed.

**Verification:** State-transition tests; migration replay/DB checks on a non-production database; browser walkthrough for new, skipped, paid and abandoned flows.

**Dependencies:** Task 4.

**Files likely touched:** `lib/signup/context.ts`, onboarding pages, `app/app/(shell)/layout.tsx`, signup state migration and transition APIs.

**Estimated scope:** Large; split state migration/API and UI flow into separate commits/tasks.

#### Task 6: Replace the static auth panel with a step-aware product showcase

**Description:** Tell the product story with real Insurvas UI scenes and synthetic data, changing the featured capability with signup progress.

**Acceptance criteria:**
- [ ] Showcase scenes correspond to signup/login progress and use existing product components or approved screenshots.
- [x] No real customer/lead data appears in sample scenes; the preview uses generic workflow labels only.
- [x] Source honors `prefers-reduced-motion`, offers pause/manual selection, and pauses rotation while the showcase is hovered or focused.
- [ ] The form and showcase remain legible at mobile and desktop sizes.

**Verification:** Browser review at desktop and phone sizes; verify reduced-motion behavior and keyboard/focus stability.

**Dependencies:** Tasks 2–5; approved scene selection.

**Files likely touched:** `components/app/funnel-frame.tsx`, auth story/showcase components, local synthetic scene components/assets.

**Estimated scope:** Large.

**Current source pass:** A shared `AuthShowcase` now presents four Insurvas workflows (inbound handoff,
dialing checks, lead-to-policy attribution, and commission matching) beside sign-in and the funnel.
Scenes rotate every five seconds, can be paused or selected manually, follow the funnel step, and stop
auto-rotation when reduced motion is preferred. The transition uses CSS `transform` and `opacity` only.
The previous Remotion dashboard still uses a different visual language, so it was not embedded as-is;
these are illustrative mini-previews, not approved screenshots or embedded product components. Validate
the product visuals and real-device performance in a preview built from this checkout before closing Task 6.

### Checkpoint: Signup and onboarding flow

- [ ] Tasks 2–6 are reviewed as one journey from account creation through payment and optional business setup.
- [ ] Pricing-selected and trial-entry paths, existing in-progress signups, and mobile layouts are included.
- [ ] User reviews the proposed sequence before implementation of the state-transition changes.

### Phase 3: Post-sign-in shell and Settings foundation

#### Task 7: Apply the chosen Inter typography foundation

**Description:** Replace the outdated Montserrat assumption with the artifact's selected Inter + Inter Tight type system, keeping the change coherent with the current semantic tokens and the Next.js version in this checkout.

**Acceptance criteria:**
- [ ] Body/UI uses Inter; page titles and large figures use Inter Tight; numeric tables keep tabular figures.
- [ ] Fonts load with the project's supported `next/font` API and do not create an avoidable layout shift.
- [ ] App shell, Settings, and one public/auth surface are checked for wrapping regressions; no unrelated brand colors or motion are changed.

**Verification:** Read the local Next.js font guide before editing; inspect rendered Settings and representative public/auth screens after fonts load, including a narrow width and dark theme.

**Dependencies:** None; user explicitly supplied the chosen artifact.

**Files likely touched:** `app/layout.tsx`, `app/globals.css`.

**Estimated scope:** Small.

#### Task 8: Reconcile the account menu placement

**Description:** Audit the real agent and partner shells for duplicate account/profile/logout controls, then ensure one account menu appears at top right as requested.

**Acceptance criteria:**
- [ ] The visible account menu appears once at the top right; the workspace switcher remains in the sidebar.
- [ ] Profile, notifications, plan/billing, shortcuts and sign-out remain reachable from that menu.
- [ ] Agent and partner shells do not gain a duplicate or lose role-specific actions.

**Verification:** Inspect both shells at desktop and phone widths and walk the menu by keyboard. Confirm account location from rendered output before removing any portal/rail slot.

**Dependencies:** None.

**Files likely touched:** `components/app/agent-sidebar.tsx`, `components/app/app-top-bar.tsx`.

**Estimated scope:** Small.

#### Task 9: Clarify sidebar group hierarchy

**Description:** Make parent groups read as headings and children as subordinate destinations, applying the manager's connected-line idea only where a group has multiple children.

**Acceptance criteria:**
- [ ] Parent/child typography and indentation are distinct; the active destination is clear without color alone.
- [ ] A single-child group has no redundant tree line or heading.
- [ ] Search, role gates, expanded state, workspace switcher and destination URLs remain unchanged.

**Verification:** Keyboard expand/collapse and active-route checks across grouped and single-child cases; screenshot review at desktop/narrow widths.

**Dependencies:** Task 8 is independent; share only the shell visual tokens.

**Files likely touched:** `components/app/agent-sidebar.tsx`, sidebar styles.

**Estimated scope:** Small.

#### Task 10: Put nested breadcrumbs in page content

**Description:** Move hierarchical context such as Partners › Publishers from the utility bar to a page-level breadcrumb above the page title.

**Acceptance criteria:**
- [x] Top bar remains for search, status/actions, notifications, theme and the account menu.
- [ ] Page-level parent/current labels render for menu destinations whose parent differs from the page label; current route links are preserved by the existing sidebar.
- [x] Standalone pages do not get empty or repetitive breadcrumbs.

**Verification:** Source implements menu-derived breadcrumbs above shell content. Walk the Inbound and Partners nested routes; check browser back and narrow wrapping. Rendered review pending.

**Dependencies:** Task 9 shares shell only; no route/auth changes.

**Files likely touched:** `components/app/app-top-bar.tsx`, page-header/breadcrumb component, up to three route consumers.

**Estimated scope:** Medium; split route consumers into a second slice if more than five files need edits.

### Checkpoint: App shell

- [ ] Tasks 7–10 leave one coherent shell on agent and partner surfaces.
- [ ] Current route, workspace switching, role gates and account actions remain available.
- [ ] A human reviews the rendered shell before the Settings frame is rolled out.

### Phase 4: Settings frame and cards

#### Task 11: Build a shared Settings page frame

**Description:** Turn the floating tab card into attached Settings navigation and align the Settings title, description and every section panel. Include in-page registry sections and dedicated Settings routes.

**Acceptance criteria:**
- [x] Every registered section and dedicated settings route uses the shared Settings title/description and content frame.
- [x] Desktop navigation is an attached left rail; narrow layouts expose the same sections through a compact selector.
- [x] Per the user's 2026-10-28 visual clarification, the active Settings section title, purpose line and its local navigation render in the left Settings rail; setting cards remain in the right content column. Correct-preview visual review remains open.
- [x] In-page Settings hashes now produce contextual breadcrumbs below the app bar; verify the rendered result against the correct checkout preview.
- [ ] Grouping, role/feature gates, read-only mode, route links, history, hash tabs, anchors and legacy moved-tab links are verified after the frame change.
- [x] Dedicated Accounting, Retention and Compliance settings screens share the same page header and width rules.

**Verification:** Source adapters preserve the existing registry, route and panel wiring. Browser walkthrough of an in-page panel and each dedicated route at 375/768/1280px, in light/dark and with keyboard navigation remains pending.

**Dependencies:** Tasks 7–10 establish typography and outer shell; may begin after Task 7 if shell work is independent.

**Files likely touched:** `app/app/(shell)/settings/page.tsx`, `components/app/agent-settings-tabs.tsx`, `components/app/settings/primitives.tsx`, and up to two dedicated route headers per slice.

**Estimated scope:** Medium per slice; break out dedicated route adapters if the five-file limit is exceeded.

#### Task 11A: Audit and simplify Settings content safely

**Description:** Inventory every registered Settings panel and dedicated route, then identify duplicated, overly dense, advanced or obsolete content before changing what users can do.

**Acceptance criteria:**
- [ ] Each page's audience, primary task, required fields/actions, optional fields, data/API dependencies, and role/feature gate are recorded.
- [ ] Each content block is classified as keep, consolidate, move to Advanced, or removal candidate with a reason and impact.
- [ ] Security, audit, legal, licensing and eligibility controls are preserved; no feature is removed solely because it looks busy.

**Verification:** Compare the inventory with the registry, panel mapping, routes, forms, API/schema callers, and a representative rendered state. Any irreversible or material capability removal is reviewed with the user before implementation.

**Dependencies:** Task 11 establishes the surface inventory; complete before Tasks 12–16 panel simplification.

**Files likely touched:** `tasks/settings-content-audit.md` plus source-only reads from `lib/settings/sections.ts`, `components/app/settings/panels.tsx`, dedicated Settings routes and panel components.

**Estimated scope:** Medium.

#### Task 12: Set the Settings card rules in shared primitives

**Description:** Map the artifact's card anatomy to settings tasks (editable form, read-only summary, dense table, warning/recovery state) and refine shared primitives before changing individual panels.

**Acceptance criteria:**
- [ ] A card means one task/object; whitespace groups fields, and a divider is reserved for meaningful footer actions.
- [ ] The artifact's typography, 12px card radius, semantic status treatments, and current light/dark tokens are used consistently.
- [ ] Static forms do not inherit dashboard hover lift/gloss or redundant nested card frames.

**Verification:** Review representative form, table, loading/error and read-only states from the running app against the artifact; capture a stable target before panel migrations.

**Dependencies:** Task 7; Task 11 establishes the shared frame.

**Files likely touched:** `components/app/settings/primitives.tsx` and at most four component consumers in the first slice.

**Estimated scope:** Medium.

**Current source pass:** Shared Settings card titles now use the artifact's 15px card-title step,
default card padding is 20px, field/toggle labels use 13px medium weight, and table-card headers use
15px. Four Settings panels that used translucent blur surfaces now use the opaque `--surface` token.
The local UI standard and approved artifact both favor readable task surfaces over decorative glass.
This is still source-only; light/dark rendering and overlapping card patterns remain to be reviewed.

#### Task 13: Align Account and Agency Settings cards

**Description:** Apply Task 12's card rules to Profile, security, notifications, history, Business identity, Products and Plan & billing, preserving the approved Profile row layout and local uncommitted work.

**Acceptance criteria:**
- [ ] These sections share heading, content, status and action spacing without flattening genuinely separate tasks.
- [ ] Existing Profile row behavior, unsaved-change cues, security controls and hash deep links remain intact.
- [ ] Draft, autosave, loading, error and read-only states remain distinguishable in light/dark.

**Implementation slices (each ≤5 files):**
- 13a Profile, security and notifications: review the existing Profile WIP first; touch only mismatched wrappers/primitives.
- 13b History, Business identity and Products: align shared headings, cards and status/error states.
- 13c Plan & billing: align summary/action cards and billing tables without changing billing behavior.

**Verification:** Review the Profile diff before touching its files; inspect representative simple/dense/error states at phone and desktop widths.

**Dependencies:** Tasks 11–12; complete Task 11A's content audit before simplifying these panels.

**Files likely touched:** up to five per focused slice from `components/app/settings/my-profile.tsx`, `profile/security-settings.tsx`, `notification-preferences.tsx`, `settings-history.tsx`, `business-identity.tsx`, `billing-settings.tsx` and Products panel.

**Estimated scope:** Large overall; ship as ≤5-file slices.

#### Task 14: Align Carriers, Money and Compliance Settings cards

**Description:** Apply the shared card pattern to the remaining carrier, billing/integration and compliance surfaces without changing their data contracts in this visual task.

**Acceptance criteria:**
- [ ] Dense tables, carrier detail cards and compliance callouts remain scannable and use consistent status meanings.
- [ ] Actions sit with the task they affect; no decorative card nesting is added.
- [ ] Existing permissions, feature gates, loading and recovery paths remain unchanged.

**Implementation slices (each ≤5 files):**
- 14a Carriers and carrier details.
- 14b Accounting/commission and compliance settings, grouped only where they share the same card rule.
- 14c Integrations and remaining Money & Compliance destinations.

**Verification:** Compare a dense carrier table, a form and a warning state in light/dark; inspect keyboard focus and mobile overflow.

**Dependencies:** Tasks 11–12; complete Task 11A's content audit before simplifying these panels.

**Files likely touched:** `components/app/settings/carriers-settings.tsx`, `carrier-card.tsx`, `billing-settings.tsx`, integration settings and up to one compliance panel per slice.

**Estimated scope:** Large overall; split each delivery into ≤5-file slices.

#### Task 15: Align Sales Process and Leads & Dialing Settings cards

**Description:** Finish the card-system pass across registered Sales Process and Leads & Dialing panels, grouped into focused slices no larger than five files.

**Acceptance criteria:**
- [ ] Every registered panel has been reviewed against the shared card rules; any deliberate dense layout is documented.
- [ ] Tables, editors, toggles and empty/error states remain task-oriented and responsive.
- [ ] No section is dropped because it is role/feature gated; the eligible view remains correct.

**Implementation slices (each ≤5 files):**
- 15a Template editors (underwriting, quotation, field sets, disclosures).
- 15b Sales rules and delivery settings (QA, welcome pack, AI assistant, pipeline sync).
- 15c Lead capture and pipeline panels (forms, posting, outcomes).
- 15d Scheduling, dialing cadence, inbound transfer and calling-window panels.

**Verification:** Review one simple form, one template editor and one dense operational panel at phone/desktop widths and light/dark.

**Dependencies:** Tasks 11–12; complete Task 11A's content audit before simplifying these panels.

**Files likely touched:** focused groups under `components/app/settings/sales/` and `components/app/settings/` (≤5 per slice).

**Estimated scope:** Large overall; expand into explicit panel slices after the first inventory pass.

#### Task 16: Align dedicated Settings destinations

**Description:** Bring Accounting, Retention and Compliance route pages into the shared Settings title, purpose line, content width and card language.

**Acceptance criteria:**
- [ ] Each route identifies its Settings context and provides a clear return path.
- [ ] Search/registry links and existing Settings trails land at the same section/anchor.
- [ ] Existing route authorization and read-only behavior remain intact.

**Verification:** Direct-load each route and each Settings trail, including browser back and narrow viewport.

**Dependencies:** Tasks 11–12; complete Task 11A's content audit before simplifying these panels.

**Files likely touched:** up to three dedicated Settings page components and shared header.

**Estimated scope:** Medium.

### Checkpoint: Settings frame and card system

- [ ] Every registered Settings section and dedicated destination has been inventoried and reviewed.
- [ ] Tasks 11–16 are implemented in slices of no more than five files.
- [ ] Deep links, gates, save behavior and current Profile work remain intact.
- [ ] User reviews the shared frame and representative card states before remaining panel slices.

### Phase 5: Contracting and Partners

#### Task 17: Audit the NPN/licence setup blocker

**Description:** Trace database constraints, RPCs, server validation and consumers to identify exactly which NPN/licence requirement blocks multi-state/carrier setup and which rules govern actual eligibility to sell.

**Acceptance criteria:**
- [x] Each affected constraint/caller is documented as setup-only or selling-eligibility logic.
- [x] Existing NPN/licence records are preserved; no production target is modified.
- [ ] The proposed migration scope and rollback/verification plan are reviewed before implementation.

**Verification:** Source/schema audit and a non-production schema snapshot; do not treat SQL parsing as proof of database behavior.

**Dependencies:** None; complete before designing wizard persistence.

**Files likely touched:** migration history, RPCs, server schemas and relevant contracting validators (audit first; no changes until the map is complete).

**Estimated scope:** Medium/high risk.

**Source audit:** `tasks/licence-setup-audit.md` finds no current licence/NPN prerequisite in the
appointment save API, schema, RPC or appointment table constraints. NPN is already nullable in the
relevant profile schemas/migrations. Live selling/assignment eligibility separately requires current
contract, appointment and licence evidence; preserve that gate. No database was queried or changed.

#### Task 18: Remove only the approved setup blocker

**Description:** Add a numbered migration only if Task 17 confirms a setup-only blocker. The source audit found none, so this task records the no-migration disposition and preserves independent licensing/compliance checks.

**Acceptance criteria:**
- [x] Existing records and unrelated eligibility logic are unchanged by this code slice.
- [x] The current appointment setup save path accepts rows without optional NPN/licence fields.
- [x] No migration is needed in this checkout; if deployment evidence contradicts the source audit, reopen this task with before/after queries and rollback notes.

**Verification:** SQL shape validation and migration replay on a scratch/non-production database, plus focused API behavior checks.

**Dependencies:** Task 17.

**Files likely touched:** one migration, one API/schema/RPC slice, one verification note.

**Estimated scope:** Medium.

**Progress:** No migration was added. The appointment setup save path has no NPN/licence prerequisite; the separate eligibility rule remains. The missing-licence warning was removed from the setup selection surface and replaced with a concise note that selling/routing checks still apply. Deployment/schema reconciliation is still open under Task 17.

**Disposition:** The audited checkout has no setup blocker to remove, so no migration is warranted.
Do not weaken the separate eligibility gate. If the deployed demo still blocks appointment saves,
reconcile that build/schema before writing a migration.

#### Task 19: Build the Contracting carrier step

**Description:** Replace the add-carrier modal as the primary setup path with a searchable inline carrier list; selecting a carrier reveals optional contract level, contracted-from date and writing number.

**Acceptance criteria:**
- [ ] Carrier selection and optional details are edited inline with clear Save & exit / Next actions.
- [ ] Existing carrier detail/edit paths remain reachable and populated.
- [ ] Empty, loading and save-error states tell the user what to do next.

**Verification:** Browser create/edit/re-entry flow; test keyboard selection and save failure recovery.

**Dependencies:** Task 18 where the current DB constraint blocks setup; otherwise the UI contract may proceed against existing APIs.

**Files likely touched:** `components/app/settings/carriers-settings.tsx`, `carrier-card.tsx`, and at most three carrier API/client files.

**Estimated scope:** Medium.

**Progress:** The add-carrier picker is now inline rather than modal, setup completion is derived from saved readiness, and Next/Back actions sit with the step lists. Contract level, contracted-from date, and writing number are labeled optional; a new carrier no longer defaults to an invented start date, and a contract saves only after all three real values are entered. The fields remain in the selected-carrier detail card rather than beside each carrier in the list, and incomplete drafts do not persist across reloads; both are still open against the manager brief. Browser save/re-entry review remains.

#### Task 20: Build the Contracting states step and save feedback

**Description:** Let users select multiple states, default each state to all selected carriers, allow per-carrier exceptions, and save responsively with recoverable optimistic updates.

**Acceptance criteria:**
- [ ] Multi-select works by keyboard and pointer; “Select all” has an accessible indeterminate state.
- [ ] State-to-carrier defaults and exceptions persist across refresh/re-entry.
- [ ] Optimistic saves roll back or explain failures; progress reflects persisted state.

**Verification:** Browser bulk-select, failure/recovery, refresh/re-entry and measured interaction feedback.

**Dependencies:** Tasks 18–19.

**Files likely touched:** one contracting panel slice, one state/carrier API slice, and shared state-selection primitive if needed (≤5 files per slice).

**Estimated scope:** Medium/large; split API and UI if needed.

**Progress:** State checkboxes now reflect a single selected state correctly; “Select all shown” respects search/filter results. Saves update optimistically and restore the previous snapshot with an error notification if the server rejects the batch. The default all-carrier association is intentionally unresolved because these rows assert actual carrier appointments; auto-creating them would misstate eligibility. Verify the manager’s intended state-licence relationship before changing the data model.

#### Task 21: Move Field maps under Advanced

**Description:** Remove Field maps from the guided setup steps while keeping the postponed extension configuration reachable under Other/Advanced and preserving old deep links.

**Acceptance criteria:**
- [ ] Field maps is absent from the primary guided step navigation.
- [ ] Eligible users can still open it from Advanced; ineligible users do not gain access.
- [ ] Existing `#carriers/carriers-maps` and moved-tab URLs resolve or redirect clearly.

**Verification:** Feature-gate and deep-link walkthrough for eligible/ineligible accounts.

**Dependencies:** Task 19 defines the new Contracting navigation.

**Files likely touched:** `components/app/settings/carriers-settings.tsx`, field-map panel/navigation, registry/hash mapping (≤4 files).

**Estimated scope:** Small/medium.

**Progress:** Removed Field maps from the main setup tabs and added an Other / Advanced entry; map content remains in its own view, and the legacy anchor still targets that view. Feature-gate behavior and the deployed preview remain unverified.

#### Task 22: Improve the Add Partner form

**Description:** Reorder the form and replace free-text country/timezone with appropriate selectors, using the existing lead-source selector patterns and preserving saved values/API shape.

**Acceptance criteria:**
- [ ] Order is partner name, type, contact name/email, country, timezone, notes.
- [ ] Country and timezone are real selections; US is the default, and timezone options respond to country without silently changing a saved value.
- [ ] Invalid email is explained inline; create/edit forms remain keyboard-usable and preserve legacy records.

**Verification:** Browser create/edit for US and non-US records, invalid email, keyboard use and narrow modal layout.

**Dependencies:** None.

**Files likely touched:** `components/app/partners-workspace.tsx`, existing timezone/country selector source and API/schema only if compatibility requires it (≤5 files).

**Estimated scope:** Medium.

**Progress:** The form is in the requested order with country/timezone selects and inline email feedback. New records default to a country-matched time zone; editing a record preserves its saved time zone when country changes and shows the country suggestion. Browser create/edit and narrow-dialog review remain.

### Checkpoint: Manager feedback implemented

- [ ] All manager requests across Tasks 1–22 are complete or have their external dependencies and decisions recorded.
- [ ] No manager request was mistaken for a code change already completed, and no unclear Settings removal was guessed.
- [ ] The current Profile WIP and its links/flows remain intact.

### Checkpoint: Settings experience ready for review

- [ ] Tasks 11–16 are complete across all registered Settings sections and dedicated destinations.
- [ ] Focused checks and cross-role/deep-link review are complete.
- [ ] Responsive screenshots have been reviewed in light and dark.
- [ ] The settings layout and card system are ready for the user's click-through.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Signup state order changes existing tenants and abandoned checkouts | High | Model every current state transition; add/backfill migration only after scratch replay and route checks |
| Google auth is not configured on the deployment | High | Verify provider and callback configuration before exposing a nonfunctional button; keep credentials outside source control |
| NPN/licence schema removal weakens a separate regulated-selling rule | High | Trace each caller and remove only the setup blocker approved in the review; preserve data and selling eligibility checks |
| Contracting updates are currently slow/unreliable | High | Use optimistic state only with rollback/error recovery; verify real browser behavior, not just source |
| Current branch has uncommitted Profile work | High | Preserve all dirty files; do not reset, stash, or overwrite them; review shared Settings files before each edit |
| Current local shell differs from the deployed review build | Medium | Confirm the local target screen before changing shell components |
| Global card polish creates visual churn | Medium | Agree the shared primitive first; change only Settings panels that do not fit it |
| Artifact's selected font conflicts with current Montserrat brand tokens | Medium | Treat the user's supplied UI Foundation v3 artifact as the selected direction; inspect brand guidance and real public/app surfaces when applying the global font |

## Open questions / dependencies

- Verify Supabase Google OAuth and allowed callback URLs; no account Google OAuth path was found in the local source scan.
- Preserve the terms acceptance checkbox until the legal owner confirms another presentation is acceptable.
- The user's UI Foundation v3 artifact selects Inter + Inter Tight; reconcile its intended app-wide scope with `docs/design/BRAND.md` during Task 7.
- Treat partner-form details beyond the manager's named fields as a design recommendation, not a quoted specification.
- Review the scope of the NPN/licence migration against the actual database target before any application.
- Do not remove unspecified items near Settings until the manager identifies them.

## Validation checkpoint for the current continuation

Run the repository suite (`npm test`), TypeScript check (`npm run typecheck`), and focused ESLint on
the edited Settings, Contracting, Partner and Auth Showcase files. Fix findings in touched code and
separate existing/generated-route failures from regressions. Confirm the localhost server serves this
checkout before browser review; avoid submitting account, billing or carrier changes in the live
session. Record command outcomes here and in `tasks/todo.md` before closing the manager-review work.

## Verification record — 2026-10-28 continuation

- `npm run typecheck`: passed after `npx next typegen` and the dev route-type generator refreshed `.next/dev/types/routes.d.ts`. Fixed three actual TypeScript errors in onboarding phone-country state and carrier bulk-state selection.
- Focused ESLint and `git -c core.whitespace=cr-at-eol diff --check`: passed. Focused regression checks for appointment eligibility, the UI tall-control ratchet, Settings grouping/frame/breadcrumb wiring, audit history, and API money-boundary/role policy pass.
- `npm test`: 3,224 passed, 23 failed, 0 cancelled (3,247 total). Remaining failures name unrelated API-key, licensing, export, assignment, lead/disposition, commission, reporting, and transfer-inbox suites. Several source-text checks are line-ending-sensitive against CRLF inputs; failures were not treated as proven product regressions without diagnosis. The full suite is not green.
- The existing browser tab on port 3000 is not the checkout preview. This checkout's temporary Next server on port 3001 was not reachable from the in-app browser. Visual, responsive, keyboard and light/dark validation therefore remain open; no live account forms were submitted.
- Two onboarding routes were added to the neutral money-boundary list and agent API role-policy registry. Dedicated Settings route tests now cover the shared frame and app-shell breadcrumb; the LA-8 audit test covers the shared history header rather than requiring duplicate page-level markup.
- Remaining manager work includes rendered shell/settings review, settings content/card alignment across sections, Contracting inline details and the intended license-versus-appointment data semantics, Field maps legacy/gate review, Partner form browser review, OAuth/provider reconciliation, and the two unapplied onboarding migrations. Preserve all existing dirty work and do not mark the overall manager plan complete.
