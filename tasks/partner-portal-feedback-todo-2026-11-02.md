# Partner Portal Manager Feedback — Task Checklist

Plan: [partner-portal-feedback-plan-2026-11-02.md](partner-portal-feedback-plan-2026-11-02.md)
Video review: [manager-review-2026-11-02.md](manager-review-2026-11-02.md)
Transcript: [manager-transcript-2026-11-02.md](manager-transcript-2026-11-02.md)

## Phase 1: Pipeline, table, and conversation foundations

- [ ] **Task 1 — Lead Pipeline:** full shell frame; replace gray lane headers; add a searchable list of the agency's live pipelines; use the reference icon view switch; place Filters between view switch and Refresh; keep publisher rows to the publisher and admin rows to the admin's assigned team. Apply migration and verify against a running local database before marking complete.
- [x] **Task 2 — Daily Deal Flow:** correct full name; use searchable shared selectors and inline FilterPanel; align date/search/filter/refresh; remove export; fill table frame and center simple empty state.
- [x] **Task 3 — Messages:** fix Details crash and rebalance conversation/history/details layout; preserve messages, attachments, linked leads, and navigation. The current source already uses a shared Details drawer; the page now uses the full shell width.

### Checkpoint: Phase 1

- [ ] Verify authorized pipeline switching and no export on Lead Pipeline or Daily Deal Flow.
- [ ] Verify filter and empty-table behavior at desktop and narrow widths.
- [ ] Open Messages Details without crash and verify retained actions/content.

## Phase 2: Submission and lead comprehension

- [x] **Task 4 — Submit Lead entry:** Product + customer State only; continue in place after screening; preserve consent and validation.
- [x] **Task 5 — Saved drafts (original scope):** the earlier Save/Resume/Discard direction is superseded by the 2 Nov follow-up below. Current flow is autosaved and Resume-only; do not reintroduce discard.
- [x] **Task 6 — Configured form sections:** Submit Lead already reads the configured form schema; section navigation remains derived from that schema without a duplicate.
- [x] **Task 7 — Lead Details / pipeline card polish:** keep Overview / Call Updates / Notes visible; lower the field-label emphasis; refine information groups; show product and submitted-language tags on detail and board cards. Preserve the submitted snapshot, timeline, and access scope.
  - Added a tenant/partner/lead-scoped language fallback for older pipeline RPC responses and softened detail labels. Focused tests, ESLint and TypeScript pass; local browser showed English/Spanish tags and working tabs.

### Checkpoint: Phase 2

- [ ] Resume a saved draft and confirm its values survive option/form loading.
- [ ] Confirm screening proceeds to the configured full form in place.
- [ ] Confirm all submitted fields and timeline data remain accessible.

## Phase 3: Statements and team workspaces

- [x] **Task 8 — Commission Statements:** full-height list with headers/empty row/pager; balanced statistics and filters; redesign financial statement details; preserve dispute/payment semantics.
- [x] **Task 9 — Team Access:** stable full-height table and empty state; preserve search, paging, invite, and deactivate.
- [x] **Task 10 — Team Performance:** rebalance cards/chart/table, qualify sparse conversion/response metrics, add supported date/performance filtering.

### Checkpoint: Phase 3

- [ ] Confirm empty/populated list behavior and pagination.
- [ ] Confirm statement details are complete and sparse metrics remain truthful.

## Phase 4: Overview analytics

- [x] **Task 11 — Partner Overview:** rebalance cards/charts/outcomes/earnings; add meaningful date/performance filters; use authorized payout statements; no partner-authorized invoice feed exists in the current API.

### Checkpoint: Phase 4

- [ ] Confirm sparse/populated dashboard states, periods, labels, links, and access.

## Phase 5: Partner navigation, settings, and global actions

- [x] **Task 12 — Profile, alerts, notifications:** audited existing shared menus and actions; kept workspace alerts distinct from read-state notifications because they have different sources and clearing rules.
- [ ] **Task 13 — Partner Settings/navigation:** add searchable and foldable settings navigation that follows the agent settings rail; put Account and Security on the same page; fill the desktop content frame to the bottom margin and keep overflow within the active panel. Preserve notification/session/product behavior and role access.
  - Implementation and focused ESLint/TypeScript/whitespace checks are complete; browser visual and interaction checks remain open.
- [x] **Task 14 — Theme transition:** theme provider now owns the document update, removing the duplicate switch/provider class application.

### Checkpoint: Phase 5

- [ ] Verify profile/notification/settings actions and alert semantics.
- [ ] Verify role-specific navigation and theme changes without flash.

## Phase 6: Submit Lead follow-up (manager screenshots, 2 Nov)

The tasks below supersede the earlier wizard/save/discard/side-sheet direction for Submit Lead. Use the supplied annotated screenshots as the visual baseline and read the current Next.js and design-system guides before implementation.

- [x] **Task 15 — Setup row and customer state (source complete):** Product, customer State, and phone screening align in the setup row; primary customer state is mapped and hidden only from its duplicate form field; Drafts is a header action without a count strip. Browser/form-data verification remains open below.
- [x] **Task 16 — Scrollable configured form (source complete):** after screening, all configured groups and fields render in schema order in one scrollable form, with consent at the end. The stepper and Continue/Back actions are removed; validation, duplicate handling, and submission remain in source. Browser verification remains open below.
- [x] **Task 17 — Draft metadata/data contract (source complete, migration unverified):** pause reason/notes are scoped through the caller's draft route; normal autosave preserves them; migration removes the cap without deleting drafts. Migration parsing/application and live DB behavior remain unverified because the configured Supabase host is unreachable.
- [x] **Task 18 — Autosave and leave flow (source complete):** autosave status and Retry are retained; in-app navigation asks for reason/notes and waits for a successful save; Save Draft, Save and Close, and Discard controls are removed. Browser-close persistence uses completed autosaves plus best-effort lifecycle flush. Browser interaction verification remains open below.
- [x] **Task 19 — Dedicated Drafts page (source complete):** `/partner/submit-lead/drafts` provides empty/populated paginated states with Resume-only rows. Resume passes the exact scoped draft ID after async setup; partner draft deletion is removed. Browser, data-isolation, and multi-page verification remain open below.

### Checkpoint: Submit Lead follow-up

- [ ] Top setup row is Product, customer State, phone screening; state appears once and is retained in submitted data.
- [ ] Screening opens every configured form group in one scrollable page; all safeguards remain active.
- [ ] Resume restores exact drafts; in-app exit records reason/notes; browser close uses autosaved state; no partner draft deletion remains.
- [ ] Inspect desktop and 375px layouts, including setup, long form, pause dialog, drafts list, empty state and resume.

## Phase 7: Lead record details and Submit Lead setup alignment (manager screenshots, 2 Nov)

- [x] **Task 20 — Align Submit Lead setup controls (source complete):** align Product, customer State and Phone screening labels and controls on common baselines; keep hint/error text below the phone control; keep phone compact; preserve the order at narrow widths. Existing local Chrome screenshot shows desktop alignment; narrow and error states remain unchecked below.
- [x] **Task 21 — Lead record tabs and collapsible configured groups (source complete):** use the submitted form revision's group labels/order; make each group independently collapsible; separate Overview, Call updates and partner-shared Notes; retain value masking/access scope and keep the progress treatment absent. No partner-authorized support-ticket read exists; ticket data is not exposed. Lead record browser review remains unchecked below.

### Checkpoint: Lead detail and setup alignment

- [ ] Phone helper and screening errors do not shift Product or State controls; verify desktop error/screened states and 375px. One current desktop screenshot showed the initial alignment.
- [ ] Compare lead record fields against the saved form revision in browser; verify collapsed/open states, shared-note filtering, call updates, sensitive masking, and role isolation. Source and focused unit checks pass; Computer Use stopped before this page could be inspected.
- [ ] Confirm no support-ticket or internal-note data is exposed through an unauthorized route.

## Final review

- [ ] Review affected routes in an authorized local partner session at desktop and narrow viewports, plus supported themes. The manager's local partner session is open; the local Supabase database is currently unavailable.
- [ ] Walk pipeline switching/access, filters/exports, Details, screening/drafts/forms, Lead Details, tables/statements, metrics, popovers/settings, and theme transition.
- [ ] Walk the revised Submit Lead flow: customer state mapping, grouped full form, autosave failure/retry, pause metadata, browser-close recovery, and Resume-only drafts page.
- [ ] Identify the exact checkout/build for each visual review; distinguish local from production.
- [ ] Confirm existing WIP and unrelated `tasks/plan.md` / `tasks/todo.md` remain untouched.

## Submit Lead drafts follow-up (2 Nov)

- [x] Replace the vertical draft list with the shared TableCard and table row design; show product, state, customer, answer count, last saved time, and Resume action.
- [x] Page drafts on the server at 20 rows and use the shared Pager.
- [x] Persist the server-issued screening result pointer and partner-safe response with a draft; on resume, verify the result still matches the saved phone before restoring the form as screened.
- [x] Preserve the screening submission retry key with the draft; phone edits clear the saved screen, while the final submit still runs the authoritative transfer gate.
- [ ] Apply migration `20261102210000_partner_draft_screening_resume.sql` (or the complete dated handoff) before relying on saved screening state.
- [ ] Verify a 21+ draft account, resume with a clear and blocked result, edit phone then re-screen, and confirm the final submit rechecks compliance in the local browser/database.

## Source-level implementation notes

- Task 1 is in progress: source changes list the agency's live pipelines, filter lead rows/counters/facets to the signed-in publisher or the admin's assigned team, include configured stages for an empty selected pipeline, use the compact icon switch and requested toolbar order, and replace gray lane headers. The new migration has not been applied because Docker/Supabase local services are unavailable; the authenticated partner route still cannot verify database-backed switching.
- Current UI pass: Daily Deal Flow uses the full available table frame with a centered empty state. Searchable dropdown panels match their trigger width on both Daily Deal Flow and Lead Pipeline. A local design-preview walkthrough confirmed the empty table and a selected Chargeback Customer sample; it does not substitute for database-backed verification.
- Task 11 uses `/api/partner/payouts` for published statements. No partner-authorized invoice endpoint/feed was found, so invoice figures were not added.
- Tasks marked complete above are source-level changes or confirmation of current supported behavior. Checkpoint and final-review items remain unchecked until a browser walkthrough is performed. Targeted ESLint and `npx tsc --noEmit` pass. The final full `npm test` run reports 3,558 passed and 23 failed out of 3,581; failures span broader source-contract/migration checks and have not all been isolated, so do not describe the suite as green or attribute them to this UI work without further review. The stale Submit Lead assertion requiring carrier selection was updated to the customer-state-only contract and now passes as part of the suite.

- Submit Lead follow-up (2 Nov): `npx tsc --noEmit` and targeted ESLint passed after the latest form introduction-card edit. Focused visibility/profile-configuration tests passed 7/7 earlier in this turn. A stale Submit Lead assertion that required carrier selection was revised to assert customer-state-only selection; the final `npm test` run had 23 failures (3,558/3,581 passed), which are not fully triaged. Migration parse/application is still unverified (Supabase DNS failure), and the current local route could not be visually inspected because the in-app browser reports `browser.user is unavailable` and no process is listening on port 3000.
- Lead record follow-up planning: source review found `snapshotFields()` currently groups by field-key heuristics; the agent lead record's immutable `tenant_template_revisions` stores actual form groups and field order and can be read with `getTenantTemplateForProductVersion`. The partner detail currently exposes only notes explicitly marked shared and not deleted. No partner support-ticket read endpoint was found. The detail redesign will reuse only partner-authorized data.

## Phase 8: Lead record header and pipeline-card metadata (2 Nov)

- [x] **Task 22 — Move lead information tabs into the header action row:** keep Overview, Call updates and Notes grouped at the right of the lead title with the Message your agent action; keep the active panel semantics and responsive wrapping.
- [x] **Task 23 — Improve lead card metadata:** retain a concise customer and stage hierarchy, show product and customer-language tags, and keep SLA age/status readable and semantically distinct. Add language to the partner pipeline RPC without shifting existing array positions or widening the partner/team scope.
- [x] **Task 24 — Match the agent chat's viewport fit:** constrain publisher Messages to the desktop shell frame, remove the extra header-to-chat gap, and keep scrolling within the chat panes. Local browser viewport 1280×720 showed document height equal to viewport height; narrow viewport review remains open.
- [ ] Compare lead header and lead cards against the supplied screenshots at desktop and narrow widths; verify missing-language fallback and language values from the live DB after migration.
- [ ] Apply ordered migrations `20261102180000`, `20261102190000`, and `20261102200000`, or run the combined SQL handoff once. Confirm pipeline cards receive language and partner draft saving works.
