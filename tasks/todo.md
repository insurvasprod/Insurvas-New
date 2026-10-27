# Manager feedback and Settings redesign task list

Plan: `tasks/plan.md`  
Source review: `tasks/manager-review-2026-10-28.md`  
Full local transcript: `tasks/manager-transcript-2026-10-28.md`

## Phase 1: Auth and onboarding feedback

- [ ] Task 1: Correct tenant sign-in copy and actions (source fixes are present; localhost preview exposes an OAuth link that is absent from this checkout, so rendered behavior is not confirmed)
- [ ] Task 2: Make account creation a short first step (email/password and About you source changes are in; provider and browser verification remain)
- [ ] Task 3: Make verification and step navigation consistent (account-created state and About you/plan navigation are implemented; checkout and browser review remain)
- [x] Task 4: Carry persona and plan intent through onboarding (source path implemented; migration `20261028400000_pricing_plan_intent.sql` is pending application; browser review remains)
- [x] Task 5: Reorder payment and optional business details safely (source state transitions and persisted skip are implemented; migration `20261028500000_payment_before_business_profile.sql` is pending application; browser review remains)
- [ ] Task 6: Replace the static auth panel with a step-aware product showcase (shared preview scenes added for signup/onboarding and sign-in; browser, reduced-motion and small-screen review remain)

## Scope: full manager review

All requests in the manager's video/transcript are in scope: signup and onboarding, app shell and navigation, every Settings destination, Contracting, and Partners. Task 1's code change is already applied and awaits rendered review. Keep the existing Profile WIP intact.

### Phase 2: Typography and app shell

- [ ] Task 7: Apply the selected Inter + Inter Tight foundation from UI Foundation v3 (source updated; responsive/render review pending)
- [ ] Task 8: Reconcile the account menu to one top-right location (source updated; agent/partner shell review pending)
- [ ] Task 9: Clarify sidebar parent/child hierarchy (source updated; visual and keyboard review pending)
- [ ] Task 10: Put nested breadcrumbs on the page (agent shell renders menu-derived breadcrumbs above content; nested route review pending)

### Checkpoint: App shell

- [ ] Agent and partner shells keep all existing routes, workspace switching, role gates and account actions
- [ ] Desktop and narrow layouts have been reviewed before Settings rollout

### Phase 3: Settings frame and cards

- [ ] Task 11: Build one Settings frame for registered sections and dedicated destinations (active section title, purpose and local tabs now sit in the shared left rail; contextual breadcrumbs render below the app bar; correct-preview visual review pending)
- [ ] Task 11A: Inventory Settings content and identify safe consolidation/Advanced candidates before simplification (source inventory written; field-to-API trace and browser states remain)
- [ ] Task 12: Set the Settings card rules in shared primitives (shared title/label scale, padding and opaque surfaces updated; render review pending)
- [ ] Task 13: Align Account and Agency Settings cards
  - [ ] 13a Profile, security and notifications (review current Profile WIP first)
  - [ ] 13b History, Business identity and Products
  - [ ] 13c Plan & billing
- [ ] Task 14: Align Carriers, Money and Compliance cards
  - [ ] 14a Carriers and carrier details
  - [ ] 14b Accounting/commission and compliance
  - [ ] 14c Integrations and remaining Money & Compliance destinations
- [ ] Task 15: Align Sales Process and Leads & Dialing cards
  - [ ] 15a Template editors
  - [ ] 15b Sales rules and delivery settings
  - [ ] 15c Lead capture and pipeline panels
  - [ ] 15d Scheduling, dialing cadence, inbound transfers and calling windows
- [ ] Task 16: Align dedicated Accounting, Retention and Compliance destinations

### Checkpoint: Settings frame and cards

- [ ] Every registered section and dedicated Settings destination has been inventoried, including content purpose, audience, gates, data/API dependencies and removal impact
- [ ] Any proposed removal that changes capability is reviewed before implementation
- [ ] Deep links, feature/role gates, read-only behavior and save paths remain intact
- [ ] Representative phone/desktop and light/dark screenshots are ready for review

### Phase 4: Contracting and Partners

- [ ] Task 17: Audit NPN/licence blockers and separate setup requirements from selling eligibility (source audit in `tasks/licence-setup-audit.md`; setup warning removed; non-production schema snapshot and deployed-build reconciliation remain)
- [x] Task 18: Decide whether a setup-only migration is needed (current save path has no NPN/licence blocker; no migration added; existing eligibility checks and stored data remain)
- [ ] Task 19: Build the guided inline carrier step (inline picker, persisted-data progress bar, Next/Back, optional contract labels, and no invented start date are in source; inline optional fields and separate autosaved setup drafts are now implemented in source; migration application, browser save/re-entry review and complete rendered walkthrough remain)
- [ ] Task 20: Build multi-state selection with safe defaults and recoverable optimistic saves (single-state checkbox fixed, select-all-shown added, saves update optimistically and roll back on failure; confirm the “all carriers” default against appointment semantics before writing appointment records)
- [ ] Task 21: Move Field maps under Advanced while preserving access and legacy deep links (Advanced entry and map subview added; verify feature gates and old anchors in a matching preview)
- [ ] Task 22: Improve Add Partner ordering, selectors and email feedback (source form updated; browser review pending)

## Checkpoint: Manager feedback implemented

- [ ] Clear manager requests across signup, onboarding, shell, Settings, Contracting and Partners are implemented or their external dependencies/decisions are recorded
- [ ] Signup, login, plan/payment, shell, contracting and partner paths are browser-reviewed
- [ ] Current uncommitted Profile work remains intact

## Checkpoint: Settings experience ready for review

- [ ] All registered Settings sections share the reviewed layout
- [ ] Card refinements are consistent and responsive
- [ ] Focused checks and light/dark browser review are complete
- [ ] Ready for user click-through

## Validation pass: current continuation

- [ ] `npm test`: 3,224/3,247 pass; 23 failures remain in other repository suites (see `tasks/plan.md` verification record). The focused regressions for this work pass.
- [x] `npm run typecheck` passes after regenerating Next route types and fixing the touched onboarding/carrier types.
- [x] Focused ESLint passes for edited Settings, Contracting, Partner, Auth Showcase, onboarding forms and API policy files.
- [ ] Browser review remains blocked: open port 3000 does not map to this checkout; port 3001 timed out in the in-app browser. No form was submitted.
- [x] Validation results and remaining external dependencies are recorded in `tasks/plan.md`.
