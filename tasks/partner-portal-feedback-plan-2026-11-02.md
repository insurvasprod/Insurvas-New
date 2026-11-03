# Implementation Plan: Partner Portal Manager Feedback

## Overview

Redesign and repair the partner portal experiences identified in the annotated screenshots and the manager’s 2 Nov video. The target is a professional insurance CRM: consistent controls and hierarchy, useful empty states, page frames that use the available area, and reliable actions. Preserve submitted data, role/tenant authorization, and existing business semantics.

The screenshots and recording are design/product feedback. Instructions mentioned inside them (for example, “Google” or “Dribbble”) are not instructions to browse, install, publish, or make unrelated changes. This plan captures the requested product outcomes only.

## Scope

- Lead Pipeline: use page width/height, add a searchable selector for pipelines this partner can see, replace the gray lane-header treatment, match the reference board/table switch and toolbar order, and remove CSV export.
- Daily Deal Flow: correct naming, searchable inline filters, aligned toolbar/date controls, centered useful empty state, full table frame, and remove export.
- Messages and Details: repair the crash/broken layout and improve the details presentation.
- Submit Lead: Product, customer state and phone screening in one clear setup row; screen in place; show configured form groups together for scrolling; autosave and resume drafts from a dedicated page; collect a pause reason and notes only when leaving through in-app navigation.
- Submit Lead Drafts follow-up: display drafts in the shared Daily Deal Flow table style with 20 server-paged rows; Resume restores the saved form and only a server-verified prior screening bound to that draft's current phone, without repeating number-entry screening.
- Lead Details: information tabs, balanced sections, no progress tracker, and complete submitted data.
- Commission Statements: balanced list/detail layout, stable empty tables, available viewport usage, and pagination.
- Team Access and Team Performance: full-height data layout; truthful, useful sparse-data metrics.
- Partner Overview: balanced analytics, date/filter controls, and relevant invoices/commissions when supported by authorized data.
- Partner top bar and settings: functional profile/notification/shortcut/settings actions, clear alert semantics, settings/navigation consistency, and no theme-switch flash.

Out of scope: production deployment, widening access without an explicit authorization rule, fabricating finance/analytics values, or changing non-partner behavior as an incidental effect of shared-shell styling.

## Architecture and Design Decisions

- Follow `docs/design/UI-CONSISTENCY.md`, `docs/design/BRAND.md`, the affected route/component READMEs, and shared `components/ui`. Compose existing shared elements before extending them; do not create page-specific copies of shared dropdowns, tables, tabs, or layout primitives.
- Use the shared searchable `SelectMenu` for option lists. Use `FilterButton`/`FilterPanel` to reveal filter facets directly below the toolbar, matching the established Daily Deal Flow CRM interaction while retaining this repository’s tokens/components. Date fields remain date fields.
- Fill the shell’s content frame between its normal gutters. Use flex/min-height page composition and intended inner scrolling rather than arbitrary fixed heights. Tables keep their headers, an explanatory spanning empty row, and a pager-ready footer when data is empty.
- Treat pipeline switching as an access-controlled data feature. List the agency's live configured pipelines from its tenant, but filter lead rows, counters, stages and facets to the signed-in publisher's own submissions or (for an admin) their own and assigned team's submissions. Enforce this before paging on the server and use the same scope for CSV export.
- Derive Submit Lead sections from the configured application form in partner settings. Preserve draft compatibility and ensure asynchronous product/state/form data cannot overwrite restored user data.
- Preserve the full submitted Lead Details snapshot and timeline. Replace the progress treatment with descriptive information navigation; do not imply the partner can edit a submitted application.
- Keep sparse-data metrics truthful. Reuse current APIs/data contracts; identify whether invoice/commission metrics are already available and authorized before adding new reads.
- Audit Alerts and Notifications separately. Combine their icon/panel only if their data and action semantics overlap; otherwise make their different purposes explicit.
- Scope shared top-bar/settings/nav changes so agent/admin/customer roles retain their links, permissions, and interactions.
- Keep these dated plan files separate from the unrelated unfinished `tasks/plan.md` and `tasks/todo.md`. Preserve all existing working-tree changes.
- For the Submit Lead follow-up, retain the supplied annotated screenshots as the incumbent visual target. Use shared fields, menus, page headers and dialogs; do not introduce another form renderer or decorative cards.
- Save draft data continuously on the server. For in-app navigation, show an in-app pause dialog with a required reason and notes, persist both with the draft, then continue. On browser close, rely on frequent autosaves and a best-effort visibility/page lifecycle flush; do not promise a custom browser-close dialog or rely on it to save data.
- Remove draft deletion from the partner flow. Because a user cannot discard drafts, remove the current arbitrary 25-draft rejection or replace it with a non-destructive policy; never silently delete old drafts.

## Task List

### Phase 1: Pipeline, table, and conversation foundations

- [ ] **Task 1 — Lead Pipeline layout and pipeline access.** Expand the board/table within the shell frame, replace the gray lane headers, remove CSV export, and add a searchable selector for the agency's live pipelines. Match the reference icon switch and place Filters between the view switch and Refresh. Filter rows, counters, stages and export to the signed-in publisher's submissions or their admin-assigned team. Apply the new database migration before claiming live behavior.
- [x] **Task 2 — Daily Deal Flow toolbar and empty table.** Use the full content height; keep the exact “Daily Deal Flow” name; remove export; position date/search/filter/refresh controls coherently; move filter facets into the shared inline panel and use searchable selectors; center a concise empty state inside the stable table body.
- [x] **Task 3 — Messages layout and Details reliability.** Keep the publisher chat within the available viewport like the agent Partner Chat, with scrolling contained to the conversation/list panes; preserve the shared Details drawer and its current content/actions.

  **Implementation status:** the chat now uses the agent page's desktop height frame and header-to-pane spacing. Local browser review at 1280×720 confirmed the page has no document-level overflow and the thread retains its own scroll area. Narrow viewport review remains open.

### Checkpoint: Phase 1

- [ ] The pipeline selector changes only among authorized data views and export is absent from Lead Pipeline and Daily Deal Flow.
- [ ] Daily Deal Flow filter facets use the shared searchable selector and inline filter panel; its empty table remains centered and full-frame.
- [ ] Messages Details opens without crashing and preserves all current actions/content.

### Phase 2: Submission and lead comprehension

- [x] **Task 4 — Submit Lead entry and screened form flow.** Keep product and customer state as the setup choices; remove carrier selection; after successful screening, continue to the full form in the same page flow. Preserve consent, validation, duplicate/screening checks, and page state.
- [x] **Task 5 — Saved draft list and reliable actions.** Replace the unexplained draft-count strip with a clear list; show useful identifying metadata; make Resume restore product, state, and entered answers despite asynchronous loading; make Save Draft and Discard work and communicate their outcome.
- [x] **Task 6 — Configured form sections.** Submit Lead already derives its sections from the partner’s configured application form; validation and saving remain bound to that schema without a parallel hard-coded form.
- [x] **Task 7 — Lead Details and pipeline card polish.** Keep Overview / Call Updates / Notes visible beneath the lead identity; reduce field-label emphasis to sentence case and a compact scale; refine the grouped information cards; show the submitted product and language as distinct tags on both the detail and board cards. Preserve every submitted value, locked-form notice, status, timeline, and existing access scope.

  **Implementation status:** added a scoped language fallback for older pipeline RPC responses and softened detail labels/tags. Focused tests, ESLint and TypeScript pass; the local browser showed both English and Spanish pipeline tags and switching Overview / Call Updates / Notes.

### Checkpoint: Phase 2

- [ ] A draft resumes with all values intact after product/state/form options load; Save and Discard produce the expected persisted result.
- [ ] Successful phone screening continues in place to the configured complete form and all section data remains available.
- [ ] Lead Details shows all submitted information/history without presenting a misleading progress workflow.

### Phase 3: Statements and team workspaces

- [x] **Task 8 — Commission Statements list and detail.** Make the list use the available page area with headers, empty row, and pager-ready footer; balance the stats/filter/table layout. Redesign the statement detail view into a cohesive, scannable financial record. Preserve dispute/open/payment semantics and show an empty transfer row when needed.
- [x] **Task 9 — Team Access full-height table.** Keep the table frame and empty state visible at the bottom margin; preserve search, pagination, invite/deactivate actions, and role meaning.
- [x] **Task 10 — Team Performance sparse metrics and layout.** Rework congested cards and chart/table spacing; remove weak conversion/response-time summary cards and keep rate interpretation sample-qualified; preserve existing data support.

### Checkpoint: Phase 3

- [ ] Commission statement and Team Access tables retain headers and a useful empty state without data and paginate when populated.
- [ ] Statement details remain complete, balanced, and readable; Team Performance makes no unsupported rate/time claim.

### Phase 4: Overview analytics

- [x] **Task 11 — Partner Overview analytics and filters.** Rebalance the summary cards/charts/outcomes/earnings; add date controls that update reporting. The current authorized source provides published payout statements; no partner-authorized invoice feed exists, so invoice figures were not added.

### Checkpoint: Phase 4

- [ ] Overview remains informative with sparse and populated data, and every metric/filter identifies its period and meaning.
- [ ] No unsupported invoice or commission figures are introduced; existing links and access rules still apply.

### Phase 5: Partner navigation, settings, and global actions

- [x] **Task 12 — Profile, alerts, and notifications.** Audited existing profile, shortcuts, notification-preference, read-state, and alert actions. Kept workspace alerts distinct from notifications because their data and clearing semantics differ; no functional menu gaps remained in current source.
- [ ] **Task 13 — Partner Settings and navigation consistency.** Extend the shared settings layout so partner settings have the agent site's searchable navigation, a foldable desktop rail, and a viewport-filling content frame. Put Account and Security & sessions together on the Account page; keep Notifications and Approved products on their own pages. Stretch the active content card to the bottom page margin, including sparse states, while preserving existing settings actions and role access.

  **Implementation status:** shared layout and publisher settings updated; focused ESLint, TypeScript, and whitespace checks pass. Browser interaction and visual checks remain open.

  **Acceptance:** search filters available settings destinations; the desktop navigation folds and restores with accessible labels; Account and Security are visible together without a separate Security destination; the page fills the available height between shell margins and keeps overflow inside its content area; notification, session sign-out, product-read and existing partner authorization behavior remain unchanged.

  **Verification:** compare partner Settings with the agent settings rail at desktop and 375px; exercise search, clear, fold/unfold, each destination, session sign-out, loading/error and empty products states; verify no page-level overflow at the reference viewport.

  **Dependencies:** reuse `SettingsLayout` and current Settings API. **Likely files:** `components/ui/settings-layout.tsx`, `components/partner/partner-settings-workspace.tsx`, focused layout/service tests. **Scope:** Medium.
- [x] **Task 14 — Theme transition flash.** Updated the shared theme handoff to avoid applying the same theme once in the switch and again in the provider, preserving stored preference and transition behavior.

### Checkpoint: Phase 5

- [ ] Profile, notifications, alert settings, keyboard shortcuts, and Settings links work and communicate their purpose.
- [ ] Navigation remains correct for each role; theme changes do not flash or alter stored preference unexpectedly.

### Phase 6: Submit Lead follow-up (manager screenshots, 2 Nov)

The earlier Submit Lead source pass (Tasks 4–6) is the baseline, not proof of the newly requested behavior. These tasks replace its wizard, save/discard actions, and side-sheet draft list. The supplied screenshots are the visual baseline; implementation must first read the current Next.js guide and project design guidance.

- [ ] **Task 15 — Setup row and customer state.** Put Product, customer State, and phone screening in three aligned columns across the full content frame. Keep state once in the setup row, map it into the configured primary customer-state field/value, and do not render that same field again in the applicant form. Keep distinct state fields such as beneficiary state. Put Drafts in the page header at top right; remove the count strip.

  **Acceptance:** product/state/screening read left-to-right at desktop and stack in that order on narrow screens; selected state remains in saved and submitted data; the matching customer-state question appears only once.

  **Verification:** use a form with customer-state and beneficiary-state fields; check selection, reset, resume and submission values. Inspect desktop and 375px layout.

  **Dependencies:** None. **Likely files:** `components/partner/partner-portal-workspace.tsx`, `app/globals.css`. **Scope:** Medium.

- [ ] **Task 16 — Show configured form groups in one scrollable flow.** After screening clears, render every enabled parent group and its configured fields together in their configured order. Remove section-stepper navigation and Continue/Back actions. Keep conditional fields, required validation, duplicate handling, consent and final Submit; place consent/submit at the end of the scroll flow. Keep readiness information concise and use the available width without hiding form fields in another step.

  **Acceptance:** all enabled configured groups are visible in one vertical form; group labels come from the agent's application configuration; required fields, visibility rules, duplicate checks and consent still gate submission correctly.

  **Verification:** exercise a multi-group form with conditional fields and incomplete required fields; confirm keyboard order, focus/error navigation and final submit at desktop and narrow widths.

  **Dependencies:** Task 15. **Likely files:** `components/partner/partner-portal-workspace.tsx`, `app/globals.css`, focused form checks. **Scope:** Medium.

- [ ] **Task 17 — Persist pause metadata and remove the draft ceiling safely.** Add tenant-safe draft metadata for the in-app pause reason and notes; preserve it on draft updates/resume. Update the draft-save RPC so autosaves do not fail at 25 drafts. Keep every existing draft row; do not delete or silently replace records.

  **Acceptance:** reason/notes are stored only on the caller's own draft; normal autosaves do not erase pause metadata; more than 25 drafts can be saved without deleting records.

  **Verification:** migration replay and focused API/service checks cover create/update/resume, row ownership and the former 25-draft boundary. Inspect generated database types and route-policy registration.

  **Dependencies:** None. **Likely files:** new `supabase/migrations/*`, `app/api/partner/forms/[productCode]/draft/route.ts`, `app/api/partner/drafts/route.ts`, `lib/agentTemplates/service.ts`, database types and focused checks. **Scope:** Large; keep DB/API separate from UI.

- [ ] **Task 18 — Autosave and in-app pause flow.** Keep server autosave as the source of truth, with clear Saving/Saved/Retry feedback and safe handling of edits made during an in-flight save. On an in-app navigation attempt, use the shared leave-guard/dialog pattern without a Discard action; ask for a reason and notes, save them with current values, and navigate only after save succeeds. Remove Save Draft and Save and Close. Browser close/reload must retain the last completed autosave and make a best-effort final flush without blocking on a custom reason prompt.

  **Acceptance:** no Save Draft, Save and Close, or Discard action remains in this partner flow; in-app navigation collects pause metadata and cannot lose unsaved edits; a failed save keeps the user on the page with a clear retry path.

  **Verification:** exercise successful/failed autosave, edits during save, in-app navigation Stay/Save-and-leave, reload and tab-hide/close behavior. Confirm close recovery is autosave-based and does not claim browser event delivery is guaranteed.

  **Dependencies:** Task 17. **Likely files:** `components/partner/partner-portal-workspace.tsx`, `components/ui/leave-guard.tsx` or compatible shared extension, dialog styling and focused checks. **Scope:** Medium.

- [ ] **Task 19 — Dedicated resumable Drafts page.** Replace the embedded side sheet with a Drafts action in the Submit Lead page header and a dedicated `/partner/submit-lead/drafts` list. Show useful identifying details and last-saved state; provide Resume as the only draft action. Resume returns to the form with the exact draft ID and restores product, customer state, phone, values and configured form snapshot after options load. Add pagination if the no-discard policy makes the list long. Remove the partner draft-delete API if source review confirms there are no other supported consumers.

  **Acceptance:** the page lists the signed-in user's drafts only, has a clear empty state, and Resume opens the exact saved application; there is no Discard control or partner delete path.

  **Verification:** resume drafts across products/states after reload; test empty and multi-page lists, access isolation and return navigation at desktop and narrow widths.

  **Dependencies:** Tasks 15, 17 and 18. **Likely files:** new `/partner/submit-lead/drafts` route and list component, `components/partner/partner-portal-workspace.tsx`, `app/globals.css`, draft API and focused checks. **Scope:** Large; keep route/UI separate from schema work.

### Phase 7: Lead record details and Submit Lead setup alignment (manager screenshots, 2 Nov)

- [x] **Task 20 — Align Submit Lead setup controls (source complete).** Keep Product, customer State and Phone screening in equal, clearly separated columns. Align all three field labels and control tops; place phone guidance and screening feedback below the input without shifting its control relative to the other two. Keep the phone control compact at desktop and stack the same sequence cleanly on narrow viewports. An existing local Chrome capture showed the 3-column controls aligned at desktop; narrow/error states remain uninspected.

  **Acceptance:** product, state and phone labels share a baseline; their controls share a baseline; helper/error text stays within the phone column below the control. The phone input does not dominate the row, and screening remains usable by keyboard and at 375px.

  **Verification:** inspect initial, error and screened states at 1536×826 and 375px; check focus, validation message placement and row alignment after the helper text appears.

  **Dependencies:** None. **Likely files:** `components/partner/partner-portal-workspace.tsx`, `app/globals.css`. **Scope:** Small.

- [x] **Task 21 — Lead record information tabs and collapsible configured groups (source complete).** When a partner opens a lead, show a clear Overview plus separate Call updates and Notes views. In Overview, render submitted values in the exact saved form section order and labels, with each section independently collapsible and a consistent four-column information layout that responsively reduces columns. Use the submitted form definition revision, preserve all unclassified fields, and keep sensitive-field masking and the locked/read-only status. Keep the status chip, but no progress bar. Notes contain only notes explicitly shared with that partner; call/status updates stay in their own view. No partner-authorized support-ticket read exists, so no ticket data is exposed. Lead-record browser verification remains open.

  **Acceptance:** group titles and field order match the immutable submitted form revision; all submitted values remain reachable; collapsible groups work by keyboard and announce state; Overview, Call updates and Notes remain distinct; partner-shared-note filtering and existing lead access scope are unchanged; no progress workflow is presented.

  **Verification:** compare a multi-section submission with the agent's record at desktop and narrow widths; test all-open/all-collapsed groups, sensitive values, leads with and without shared notes, timeline-only updates, and a user requesting another partner's lead. Confirm support-ticket visibility only if an authorized partner endpoint/data contract exists.

  **Dependencies:** inspect the stored submission revision and partner-visible notes contract before rendering; no new ticket or note write path. **Likely files:** `components/partner/partner-lead-record.tsx`, `lib/partnerLeads/service.ts`, `lib/partnerLeads/types.ts`, `lib/partnerLeads/view.ts`, focused tests. **Scope:** Large; split data contract from presentation if needed.

### Checkpoint: Submit Lead follow-up

- [ ] Product, customer state and screening form the top setup row; duplicate customer state is absent from the form but retained in submitted data.
- [ ] Screening reveals all configured form groups in one scrollable page; validation, conditional fields, duplicate safeguards and consent remain intact.
- [ ] Drafts autosave and resume; in-app exit records reason/notes; browser close depends on completed autosaves; no user-facing draft deletion remains.
- [ ] The dedicated Drafts page is usable at desktop and narrow widths and does not reveal another partner user's drafts.
- [ ] Setup controls align with the phone hint/error text beneath the phone field rather than beside or above Product/State.
- [ ] Lead record uses saved configured groups, independently collapsible; shared notes and call updates are separated without adding unauthorized ticket access.

### Final review

- [ ] Review every affected route against the current local checkout at the annotated desktop size and a narrow viewport; review supported light/dark themes.
- [ ] Walk pipeline switching/access, Daily Deal Flow filters/empty state, Messages Details, screening and draft resume/save/discard, configured form sections, Lead Details tabs, empty/populated tables, statement details, metrics, popovers, Settings links, and theme changes.
- [ ] Record whether each browser observation is local or production and identify the exact commit/build. Do not claim production parity or deployment from source review alone.
- [ ] Confirm no unrelated working-tree changes or existing plan files were modified.

## Dependencies and Scope Boundaries

### Implementation status (2 Nov 2026)

Source-level work is complete for the tasks checked above. Lead Pipeline switching remains blocked on an authorized partner data contract for transfer/customer/chargeback views. Overview invoices remain omitted because no partner-authorized invoice endpoint was found. The browser checkpoints below are still required before claiming visual or interaction parity. The 2 Nov Submit Lead follow-up is implemented at source level; typecheck and targeted lint passed, but database migration behavior and visual/browser interactions remain unverified because the configured Supabase host and local preview listener are unavailable.

1. Task 1 must inspect partner pipeline API/data access before implementing the selector; UI work alone cannot establish safe customer/chargeback visibility.
2. Tasks 4–6 share Submit Lead state. Establish the configured form/data shape before implementing section navigation; draft restoration must be stable before relying on those sections.
3. Task 8 is a finance-sensitive presentation. Preserve existing payout authority and actions; layout work must not change payment/dispute outcomes.
4. Task 11 depends on existing partner reporting data. Add no backend reads until source availability and authorization are established.
5. Task 12 can touch shared top-bar components. Inspect all consumers and preserve role-specific behavior.
6. Task 13 depends on the existing shared Settings layout and the correct partner/customer route taxonomy.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pipeline switching reveals unauthorized leads | High | Trace route/API checks and tenant scoping before UI exposure; define each partner-visible dataset. |
| Form sections drift from the application form configuration | High | Reuse the configured form schema and validation source; avoid a second hard-coded schema. |
| Draft values are overwritten by async defaults | High | Restore only after options/config are ready; test resume with an actual saved draft. |
| Metrics imply statistical confidence with too little data | High | Use existing sample thresholds, explanatory labels, or neutral unavailable states. |
| Dashboard requests require finance data not currently available | High | Keep display tied to authorized APIs; record missing source as a dependency rather than fabricating data. |
| Common shell changes alter another role | High | Restrict partner presentation through composition/props and inspect shared consumers. |
| Empty tables or page fill introduce false content or clipping | Medium | Keep a real spanning empty row and use flex/min-height layout with intended inner scroll. |
| Browser closes before a save request completes | High | Save frequently to the server during editing; flush on visibility/page lifecycle as a best effort; test reload recovery and never rely on `beforeunload` as the persistence mechanism. |
| Removing draft discard while retaining the 25-draft cap blocks new work | High | Remove the arbitrary cap or replace it with a non-destructive retention/pagination policy; never delete a user's draft implicitly. |
| Production and local screens represent different commits | High | Tie every visual review to an exact checkout/commit/build and report the environment. |

## Open Questions

- Which partner-visible data contract backs Customer and Chargeback pipeline views? Resolve from existing route/API policy during Task 1; do not broaden access by assumption.
- Does partner Overview already have authorized invoice totals/details, or only commissions? Resolve from existing data sources during Task 11 before proposing additional API work.
- Are Alerts and Notifications duplicate streams or separate operational signals? Audit source and actions in Task 12 before consolidating.

## Verification Approach

- After implementation approval, use focused source review and existing project checks for touched scope. Do not add or run test suites unless requested.
- Browser review must use this checkout and the target role/account. Screenshots and source checks do not prove production behavior.
- Lead record groups come from the immutable template revision attached to the submitted lead; do not infer new group labels from field-key heuristics when saved form configuration is available.
- The partner detail service currently filters note-linked messages to `tenant_lead_notes.visibility = 'shared'` and non-deleted notes. Keep that gate before exposing a separate Notes view. No partner support-ticket read endpoint was found during source review; verify again before adding a ticket tab.
- Phase 7 source implementation: saved-schema groups, separate shared Notes/Call updates tabs, native keyboard-operable collapsibles, and aligned three-column setup controls are implemented. Focused partner lead view/masking tests pass 29/29, targeted ESLint and TypeScript pass. The existing Chrome screenshot showed the Submit Lead setup alignment; Computer Use stopped before the lead-record page could be inspected, so no visual parity claim is made for that page.
- Phase 8 source implementation: place Overview/Call updates/Notes in the lead header action row; show product and customer language as clear tags on the lead record and pipeline cards; keep stage and SLA age visually distinct. Language is appended at RPC row index 16 to preserve existing response positions. The follow-up migration and consolidated SQL handoff include it. Focused partner lead tests passed 37/37, TypeScript and targeted ESLint passed, and the diff check passed. Browser visual verification remains open because Chrome is not available through the browser bridge.
- Browser-lifecycle research: [MDN `beforeunload`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event) says custom browser prompt text is unsupported and the event is unreliable; [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) documents hidden-state events. Design browser-close recovery around frequent autosaves and a best-effort flush, not an unload-time modal.
- Long forms should preserve visible task structure and save progress for return journeys; see [GOV.UK task-list guidance](https://design-system.service.gov.uk/components/task-list/). This remains one configured application form, so use parent-group headings and scrolling rather than a separate task-list pattern.
- UI taste critique: the supplied screens repeat state, place screening below setup, split related work across a stepper, hide drafts in a side sheet, and offer conflicting manual save/delete actions. The proposed direction uses one aligned setup row, configured section headings, a single scrollable form, clear autosave feedback, and a dedicated Resume-only drafts page inside the existing Insurvas system.
