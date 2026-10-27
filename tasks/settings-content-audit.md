# Settings content audit

Scope: the registered destinations in `lib/settings/sections.ts`, their panel mapping in
`components/app/settings/panels.tsx`, and the dedicated Accounting, Retention, and Compliance routes.
This is a source-based inventory, not browser proof. The local preview was previously found to render
a different build from this checkout, so live states, viewport behavior, and exact save feedback remain
to be reviewed before the visual pass is called complete.

## Manager constraints carried into the audit

- Every Settings destination shares the `Settings` title and purpose line, aligned left navigation,
  and the same content width. Each section can still have a task-specific heading beneath it.
- Keep useful settings discoverable; simplify duplicate presentation, not capabilities.
- Preserve role and entitlement gates, read-only status, audit history, security, legal and licence
  controls, existing deep links, and save/recovery paths.
- The manager specifically asked to move carrier field maps out of the main contracting steps and
  under an `Other`/`Advanced` area. This is a move candidate, not a removal.
- Settings labels and tabs should follow the chosen Title Case convention; help text remains sentence
  case. Do not change copy outside the requested surfaces without checking context.

## Registry and panel inventory

All in-page sections below are rendered through `SETTINGS_PANELS`; all three route-backed sections
use the same `SettingsPageFrame`. Feature/role values are those declared in the registry. Runtime
API authorization remains authoritative.

| Section / audience | Primary task and controls | Data / dependency surface | Gate | Treatment |
|---|---|---|---|---|
| My profile — each workspace member | Edit personal details; manage sign-in, two-step verification, sessions, notifications, and personal/security history. | Profile API/form; auth/security endpoints; alert preferences; security event history. | Registry: signed-in member; endpoint-level ownership checks. | Keep all capabilities. Preserve the Profile WIP and hash tabs; review dense subpanels for shared card spacing only. |
| Business identity — owner | Maintain legal/trading identity, NPN, tax ID, address, phone, logo, timezone, partner support contact, and workspace ownership. | Business identity panel and storage/API; tenant/team ownership. | Owner. | Keep; do not remove identity fields or overwrite existing values in a visual pass. |
| Team & access — owner | Invite, assign roles/seats, manage membership and access boundaries. | Team snapshot and tenant-team service/API; plan seat limits. | Owner; seat availability affects actions. | Keep security/access actions visible and preserve owner/self-row restrictions. |
| Plan & billing — owner | Review plan, usage, invoices and payment method; change, pause, or cancel. | Subscription, billing, invoices, usage/metering and payment provider. | Owner; billing remains usable in read-only recovery state. | Keep; reduce duplicated summaries only after checking provider and recovery states. |
| Contracting — owner | Manage carrier contracts, appointments/states, carrier details and rules; field maps are in Other / Advanced. | Appointment vault, carrier library, sales-carrier/product data, rules, field-map storage. | `appointment_vault` + owner; carrier rules have their own feature gate. | Carrier picker is inline, state selection has corrected checkbox semantics and optimistic save/rollback. Full guided flow and in-context legacy/deep-link review remain. |
| Browser extension — owner | Install/use extension, define allowed carrier sites and inspect access grants. | Applications/extension state and recent grants. | `applications` + owner. | Keep; do not remove while the feature exists. Consider concise status grouping, no capability reduction. |
| Underwriting templates — owner | Edit interview questions and disqualifying answers. | Application template data; carrier/product eligibility consumers. | `applications` + owner. | Keep eligibility logic; align editor controls, preview and save states. |
| Quotation templates — owner | Configure quote questions and premium inputs. | Application templates, carrier/product data and quote flow. | `applications` + owner. | Keep; align editor and preview. |
| Application field sets — owner | Maintain named carrier-required fields shared by workspace, QA and extension. | Field-set definitions and downstream application/QA/extension consumers. | `applications` + owner. | Keep canonical shared fields; avoid duplicating names across editors. |
| Disclosures — owner | Define disclosure content and when it is required. | Application disclosure templates and submit/eligibility checks. | `applications` + owner. | Keep legal content and requiredness; no deletion for density. |
| Quote & QA rules — owner | Set plausibility, appointment, draft-date buffer, requirement-ageing and welcome-pack rules. | Sales preferences/settings consumed by quote and application QA. | `applications` + owner. | Keep. Group related rules with clear subsections; don't hide safety checks. |
| Welcome pack — owner | Configure the post-submit client email. | Email template/delivery and application submit event. | `applications` + owner. | Keep; preserve preview/test/error feedback. |
| AI assistant — owner | Configure assistant behavior and what application data it receives. | AI assistant settings and underwriting/application context. | `applications` + owner. | Keep privacy/data scope explicit; no reduction in consent or context controls. |
| Pipeline sync — owner | Map application progress to lead pipeline stages. | Application events plus pipeline definitions. | `applications` + owner. | Keep; preserve stage mapping and unmatched-state feedback. |
| Pipelines & outcomes — owner | Edit pipeline stages, call outcomes and outcome-to-stage routing. | Book-of-business pipeline/outcome APIs used by lead workflows. | `book_of_business` + owner. | Keep routing semantics; simplify only duplicate presentation. |
| Form templates — owner | Configure partner/agent lead-capture fields. | Lead form schema and partner/agent capture surfaces. | `book_of_business` + owner. | Keep fields and validation; preserve existing submissions and compatibility. |
| Lead posting — owner | Manage vendor posting keys, destination and field maps. | Lead-import credentials/API, mapping and posting endpoint. | `lead_import` + owner. | Keep secrets protected and server-only; retain key rotation and mapping paths. |
| Calendar & availability — owner | Set working hours, blocked time and appointment capacity. | Calendar availability settings read by scheduling/booking. | `outbound_dialing` + owner. | Keep constraints and timezone handling; ensure empty/error/save states are clear. |
| Dialing cadence — owner | Set retry intervals and preferred call windows. | Dialer cadence configuration and outbound job scheduler. | `outbound_dialing` + owner. | Keep; do not remove compliance limits or retry controls. |
| Inbound transfers — owner | Configure transfer queue wait, escalation, alerts, buffers and routing. | Queue SLA/routing APIs, team roster and alert delivery. | `book_of_business` + owner. | Keep the routing and escalation controls; use progressive grouping for advanced routing only. |
| Calling windows — owner | Narrow agency dialing hours on top of federal/state limits. | Calling-window configuration used by outbound dialer/compliance. | `outbound_dialing` + owner. | Keep; restrictions must remain additive/narrowing. |
| Accounting — owner/bookkeeper | Set reporting basis, fiscal year, expense categories, partner cadence, producer splits, matching and tax thresholds. | `/app/accounting-settings`; accounting settings store, bank accounts and change history. | `profit_and_loss`; owner can edit, bookkeeper reads. | Keep financial controls and audit context; do not merge unlike accounting tasks into one form. |
| Retention — owner | Tune radar scoring, thresholds, queue, signals, campaigns, cooling-off and assignments. | `/app/retention-settings`; retention hub and change history. | `chargeback_radar` + owner. | Keep operational safeguards and experiment holdout; group into scannable subsections. |
| Compliance — owner | Set complaint deadlines, retention/purge, legal holds, deletion, transfer gate and evidence reporting. | `/app/compliance/settings`; compliance settings, jobs and evidence/audit services. | `tcpa_checker` + owner. | Keep legal holds, deletion safeguards, evidence and transfer eligibility controls. |
| API keys & webhooks — owner | Create/revoke scoped keys and configure signed event delivery. | Integration credential store, scope enforcement and webhook delivery. | Owner. | Keep secrets masked and revocation available; preserve delivery/recovery status. |
| Settings history — owner | Read who changed settings and before/after values. | Settings audit log and per-section history. | Owner. | Keep append-only audit evidence; read-only by design. |

## Safe simplification candidates

1. **Move, do not remove:** carrier Field maps belong under an Advanced/Other disclosure, with a
   visible explanation that the extension uses them and legacy `#carriers/carriers-maps` links still
   open them.
2. **Group, do not delete:** long forms can use task headings and progressive disclosure for
   infrequent controls, as long as the first-use task remains discoverable and no security, legal,
   licensing, eligibility, audit, or recovery control is hidden.
3. **Remove only after source trace:** repeated headings, duplicate descriptions, redundant nested
   cards, and repeated status copy are candidates when they describe the same task. Their API,
   schema, audit and role-gate dependencies must be checked before removal.

## Audit limits and next work

- Registry coverage is source-confirmed: 26 sections map to 23 in-page panel entries and 3 dedicated
  route-backed pages. Route-specific gates and read-only handling stay in their existing server
  guards.
- This pass records task purpose, audience, broad data/service dependencies and safe disposition. It
  does not yet trace every form field to every API/schema caller, nor inspect live loading, empty,
  error, saved or permission states. That trace and rendered review are required before changing
  capability or counting Tasks 11A/12–16 complete.
- Keep the manager's unresolved Settings-entry comment untouched; its target was unclear in the
  recording and does not justify removing navigation or controls.
