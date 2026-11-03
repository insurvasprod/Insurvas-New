# Database architecture and the schema decision

Updated: 2026-09-14, from the SA-2.1 – SA-2.3 QA batch and focused LA remediation reruns.
Companion documents: `supabase-inventory.md` (what is there), `security.md` (how it is protected),
`../qa/LA-0-BLOCKERS.md` (how the gap was found), `task-traceability.md` (what it costs per task).

## Focused live reconciliation update — 2026-09-14

The current read-only inventory reports 165 of 165 application RPCs present, 127 of 127 tenant-app
declarations correct, and 86 of 86 declared triggers present. The executable checks are
`npm.cmd run verify:rpc-contract`, `npm.cmd run check:tenant-access`, and
`npm.cmd run check:triggers`. No migration was applied during this reconciliation.

The live `tenant_users` contract contains `tenant_id`, `user_id`, `role`, invitation timestamps,
and acceptance timestamps, but no generic `id` column. The outbound metering adapter was corrected
to use a shape-compatible count query; `verify:tenant-roles` now passes without changing the live
schema.

The live `lead_queue` indexes include an equivalent tenant/status/queue-time index under the
compatibility name `lead_queue_tenant_status_compat_idx`. The transfer-inbox verifier still reports
1,461 ms for a 500-row request, so query correctness and indexing are evidenced while the strict
under-one-second remote timing target remains open.

The live offer, security, partner-submission, add-on, and disposition focused contracts now pass
their current verifiers. Hosted checkout remains provider-mapping blocked, and the deployed
`import_agent_lead_batch` function still references absent `public.users.tenant_id`; its reviewed
membership-bridge repair remains local until a DDL-authorized owner promotes it. The application
maps this known contract failure to a stable `503 import_unavailable` response and does not fall
back to client-side or multi-step lead writes.

`check:collisions` separately reports 11 repository/live type-shape incompatibilities. They are
tracked as adapter/migration decisions and are not silently treated as compatible merely because
the object names match.

The 2026-09-14 remediation pass added two local, additive migration candidates for the remaining
drift: `20260914180000_la_2_tenant_access_policy_repair.sql` restores the eight incomplete tenant
access declarations (including the two global statutory read policies), and
`20260914181000_la_1_security_and_offer_search_path_repair.sql` pins the disposition-note function
and corrects the offer function search-path ordering. Both parse successfully and neither has been
applied to the shared project because the available role cannot perform DDL.

## Current reconciliation (2026-09-12)

The existing Supabase project remains the only database target. The live project now includes the
additive SA migrations through the current foundation and SA-2/SA-5 compatibility work. Read-only
inventory confirms these objects are present: `features`, `feature_flags`, `tenants`,
`tenant_users`, `users`, `admin_users`, `audit_log`, `platform_audit_events`, billing-plan and
entitlement tables, and `create_tenant_with_owner` plus the current admin-user RPCs.

The earlier 2026-09-11 statement that the SA-1/SA-2 schema was absent is retained only in the
historical QA records. It must not be used as the current schema contract. The database still hosts
two product generations and the full RLS/advisor review remains open under SA-0.4.

## Current SA-2.1 – SA-2.3 contract

The live shared project contains the additive catalog and plan-version compatibility model used by
the current application:

- `feature_modules` and `features` provide the ordered, archived feature catalog. `feature_key` is
  immutable and is the foreign-key contract used by menu guards and `requireFeature()`.
- `plans` stores one row per plan version. `plan_features`, `plan_prices`, and `plan_limits` are
  keyed by that version row, so an existing subscriber keeps its original configuration.
- `subscriptions.plan_id` points at the assigned plan version, while `tenant_entitlements` is the
  materialized runtime read model rebuilt by the entitlement RPC.
- The authenticated admin feature screen reads the catalog through a server-only adapter and
  computes plan/add-on reference counts. The plan editor reads the same catalog and renders the
  resulting agent menu preview.

The live integrity check found that the original individual-plan default trigger function existed
without its trigger. The additive migration
`20260912480000_sa_2_2_repair_individual_plan_limit_trigger.sql` recreates the trigger, preserves
explicit limits, backfills only missing rows, and pins the security-definer function to an empty
`search_path`. `npm.cmd run verify:plan-version` passes after this repair.

## Historical snapshot (2026-09-11)

The sections below preserve the earlier migration-gap diagnosis for audit history. They are not a
current statement that the objects are absent; the current state is the reconciliation above.

## The situation, stated plainly

The configured Supabase project hosts **two generations of the product on one database**:

- the **organizations-era CRM** — live, in use, ~308 tables, with its own outbound dialing, HR and
  talent, insurance-policy and commission modules; and
- the **tenant-era SaaS** in this repository, which was grafted on through the LA-0 compatibility
  bridge.

The bridge covered the LA-0 slice only. That is why all 14 LA-0 tables are present and 29 of the
tables the SA plane needs are not, and why 104 of 131 RPCs the application calls do not exist.

It also drifted in both directions: the database already contains `tenant_invite_user` and
`tenant_update_member_role` — exactly what LA-0.2's invitation and role-change criteria need — and
the application calls neither.

## The decision

Three options were put to the product owner on 2026-09-11. The active decision is to continue using
the existing shared project with additive, reversible migrations and compatibility adapters. A new
Supabase project is not part of the current plan.

| Option | Shape | Cost |
|---|---|---|
| (a) Complete the bridge | Write ~104 compatibility shims over the organizations schema | Largest ongoing effort; the bridge has already drifted once |
| **(b) Provision from migrations** | Build a database from this repo, point `.env.local` at it | Reference option only; not the current shared-project execution path |
| (c) Converge | Migrate the organizations CRM onto the tenant model | Largest blast radius; touches a live product |

The current route keeps the shared project, namespaced QA fixtures, and no destructive reset. Any
new schema object must be justified by a verified task gap and applied as an additive migration.

### SA-4.1 settings contract status

The live project contains `public.settings` with four stored rows. The server registry contains
seven supported keys and intentionally returns coded defaults when a stored row is absent, so the
admin endpoint can still return seven settings while only four overrides are persisted. The
additive migration `20260914182000_sa_4_1_settings_registry_completion.sql` seeds the three
missing Agent Floor/callback defaults with `ON CONFLICT DO NOTHING`; it never overwrites an
existing platform override. Promotion and an authenticated override round-trip remain required
before SA-4.1 can be accepted as database-aligned.

## What option (b) requires

`npm run db:check:deep` reports **155 problems**. The repository cannot build a working database
from its own migrations today.

The gap is the SA-0 through SA-3 schema. Per backlog #29 the numbered migrations start at SA-4.1,
and everything the earlier modules built has only ever existed inside a live database.
`0000_baseline.sql` was meant to close this — it is a 445-statement generated dump — but it reports
59 of those 155 problems itself, because it references `payments`, `subscriptions`, `plans`,
`provider_settings`, `usage_events` and `legal_documents` in indexes and views it never creates. It
was generated from a database that already lacked them, so `npm run db:dump` cannot rescue it.

**Therefore the missing schema has to be authored, not dumped.** Approximately 29 tables plus their
constraints, indexes, policies and the ~104 functions. SA-5.4 also has the additive
`20260914183000_sa_5_4_atomic_legal_acceptances.sql` repair, which makes signup/re-acceptance
acceptance writes atomic while retaining the original single-document RPC for compatibility.

### This is the SA work, not a detour

The tables that have to be authored map one-to-one onto the SA tasks:

| Migration work | Tasks it completes |
|---|---|
| `features`, `feature_modules` | SA-2.1 |
| `plans`, `plan_versions`, `plan_features`, `plan_prices`, `plan_limits`, `addons` | SA-2.2 – SA-2.6 |
| `subscriptions`, `subscription_addons`, `subscription_coupons` | SA-2.7 |
| entitlement rebuild from the above | SA-2.8 — gives `tenant_entitlements` the producer it currently lacks |
| `admin_user_list` and the `admin_*` user RPCs | SA-1.1 – SA-1.5 |
| `payments`, `coupons`, `credit_notes`, invoice generation | SA-3.2 – SA-3.9 |
| `settings` name reconciliation, `template_fields`, `credit_packs`, `compliance_vendors`, `email_log` | SA-4.4, 4.6, 4.8, 4.9, 4.11 |
| `checkout_sessions`, `legal_documents`, `legal_acceptances`, `trial_reminders` | SA-5.1 – SA-5.4 |

Authoring SA-2.x first is the highest-leverage start: it is the deepest dependency, and it turns
the LA-0 entitlement cache from an orphan into a produced artifact — which unblocks LA-0.1
criterion 5 as a side effect.

## Invariants to preserve when building the new schema

Carried forward from the SA-00 build plan and from what the live LA-0 bridge already gets right:

- **Money is integer cents. Rates are integer basis points.** Enforced today in
  `lib/carriers/resolve.ts`, which rejects non-integer basis points at runtime.
- **Issued invoices are immutable.** Corrections are credit notes.
- **Append-only audit.** `prevent_platform_audit_mutation` is deployed and should be reproduced.
- **The entitlement object is the whole contract.** The agent app reads one cached JSON blob and
  never queries a plan, subscription or price. `tenant_entitlements` already has this shape.
- **Suspension preserves read access** to the customer's own book of business.
- **Kill switches are evaluated before entitlements**, and produce a different code so the client
  shows a maintenance notice rather than an upgrade prompt. Implemented in
  `lib/entitlements/requireFeature.ts`; keep it.
- **RLS on every table, and no unintended client grants.** The live project has no RLS-disabled
  tables. `audit_log` is intentionally service-role-only after the 2026-09-12 hardening migration;
  `platform_audit_events` still has authenticated SELECT and broader database grants that require
  the SA-0.4 review.
- **Tenant scope comes from the session, never a request parameter.** Asserted by
  `lib/menu/planBranching.test.mjs` across all 82 agent routes.

## Current verified foundation controls

- `audit_log` has the additive `audit_log_append_only` trigger and only `service_role` table grants
  for application reads/inserts.
- `platform_audit_events` retains its authenticated SELECT policy and append-only trigger; its
  broader grants remain part of the SA-0.4 grant review.
- `create_tenant_with_owner` is executable only by `service_role` and `postgres`, so tenant
  provisioning is routed through the server-only adapter.
- The live feature consistency check passes with 28 active catalog features.

## SA-0.4 grant hardening — 2026-09-12

The existing project contains a hybrid `lead_notes` contract: legacy RLS policies refer to
`organization_id`/`created_by`, while the current service contract uses `tenant_id`/
`author_user_id`. Rather than rely on incompatible direct-client policies, the additive migration
`20260912350000_sa_0_4_revoke_legacy_lead_note_grants.sql` removes `anon`, `authenticated`, and
`tenant_app` table grants from `lead_notes`, `lead_note_edits`, `lead_note_mentions`, and
`agent_notifications`. The application continues through the server-only lead-note adapter,
which applies tenant predicates. No rows, columns, or existing policies were deleted.

The same migration closes direct client access to `platform_audit_events`; the current application
uses `audit_log` for its admin audit surface. Both audit stores retain append-only database
triggers, while server-role access remains available for the intended adapters and triggers.

The live grant query after hardening returned no client-role grants on those six focused tables.
This is a boundary hardening measure, not a claim that the shared project's two historical schema
generations are fully reconciled. The Supabase advisor findings and migration-chain replay gap
remain documented in `docs/architecture/security.md` and this inventory.

## SA-1 current live reconciliation — 2026-09-12

The live project now contains the SA-1 user-management contract: `admin_user_list`,
`admin_user_stats`, `admin_login_activity_stats`, `user_invitations`, `admin_set_user_status`,
`admin_replace_user_token`, `admin_attach_user_to_tenant`, and
`admin_update_user_with_email_change`. The application uses a service-only adapter for the
platform-wide directory and Auth Admin for the credential identity; tenant membership remains a
separate `tenant_users` record.

Two live function mismatches were found during authenticated provisioning QA and corrected with
additive migrations:

1. `admin_attach_user_to_tenant` used an unqualified conflict target whose `tenant_id` name
   collided with the function's returned `tenant_id` variable. It now targets `tenant_users_pkey`.
2. `admin_replace_user_token` compared the live text `user_invitations.purpose` column to the
   `user_token_purpose` enum. It now validates the supported values explicitly and compares/stores
   text, preserving the existing token history behavior.

The verified invitation state is Auth user → bridge-created `public.users` profile →
`tenant_users` membership → append-only `user_invitations` token row. Invitation links are issued
with the configured 72-hour default in this QA run, and token material is never stored in the
architecture evidence. The newly created QA record remains namespaced and pending verification;
it was not used to alter shared production identities.

SA-1.2 now exposes an initial-plan selector when a platform admin creates a new tenant. The route
uses the additive `admin_attach_user_to_tenant_with_plan` RPC so tenant, first-owner membership,
invitation, and the first monthly subscription are committed together; the subscription is active
or trialing according to the selected plan's configured trial. Existing-tenant invitations do not
change the tenant subscription. The migration is staged locally and remains unapplied because the
shared DDL role is not available, so live plan-linked provisioning and browser proof remain open.

SA-1.4 and SA-1.5 reconciliation: `admin_set_user_status` supports the active, inactive,
suspended, pending-verification, and deleted vocabulary, updates suspension fields atomically,
and increments `users.session_version`. The current product decision keeps hard deletion and the
7-day purge out of the implementation, so the deleted-state acceptance criteria are not claimed.
`login_events` has indexed user/timestamp and timestamp access paths, and
`admin_login_activity_stats` supplies the platform aggregates used by `/admin/activity`. The
remaining 50,000-row timing claim requires a seeded performance fixture and was not inferred from
the indexes alone.

## Known blocker on the current project

The complete SA role matrix still requires follow-up because live `support_agent` and
`billing_admin` fixtures were not available during this batch. The current repository typecheck
now passes; the remaining foundation blockers are the SA-0.4 advisor/grant review, session-expiry
and fresh-install seed evidence, and full audit coverage across later SA mutations.

## SA-2.4 through SA-2.6 live contract — 2026-09-12

The shared project currently exposes the pricing, meter, usage, and add-on compatibility tables
through the existing `public` schema. The focused inventory found the following live shape:

| Area | Tables checked | RLS/policy result | Live rows |
|---|---|---|---:|
| Pricing | `plan_prices`, `plan_limits`, `plan_meters` | RLS enabled; service-role policy only | 3, 3, 0 |
| Meters | `meters`, `usage_events`, `usage_totals` | RLS enabled; service-role policy only | 6, 4, 38 |
| Add-ons | `addons`, `addon_features`, `addon_meters`, `plan_available_addons`, `subscription_addons` | RLS enabled; service-role policy only | 5, 0, 0, 0, 1 |

The additive migration `20260912500000_sa_2_6_repair_addon_entitlement_resolution.sql` repaired the
live `resolve_tenant_entitlement` and `check_meter_capacity` RPCs so plan allowances, active
add-on credits, and current-period grants resolve consistently. The focused `verify:addon-meters`
workflow passed after the repair. The resolver and capacity-check functions use an empty
`search_path` and are restricted to the server-side service role.

The remaining database/product gap is catalog completeness: the add-on page currently reads the
catalog but does not provide catalog CRUD, feature/meter assignment, availability restrictions,
or archive/restore controls. The live add-on feature, meter, and plan-availability tables are
empty, so SA-2.6 remains Partial rather than accepted.

The `admin_usage_monitor_json` compatibility function currently returns an empty array in the
shared project, so the server adapter uses a bounded fallback over the same public tables. That
fallback omits tenants with no subscription, current usage, or credit grant; otherwise the admin
page would serialize six empty meter rows for every unconfigured tenant. The live population is
3265 tenants, while the fallback response measured 421,878 bytes after this narrowing. This is a
read-model/payload optimization only: the separate tenant directory used for credit grants still
lists every tenant, and no tenant authorization predicate was weakened.

## SA-2.7 live contract — 2026-09-12

The shared project now has the guarded compatibility signature
`admin_assign_subscription(uuid, uuid, text, timestamptz)`. The additive repair migration
`20260912510000_sa_2_7_repair_assignment_guard.sql` validates tenant and plan existence, rejects
archived plans and unavailable billing cycles, refuses a second live subscription, computes the
subscription period, and rebuilds the entitlement before returning. The function is service-role
only and uses an empty `search_path`.

The existing change-plan, cancel, and pause/resume RPCs remain the lifecycle transition boundary.
They lock the subscription row and reject invalid state changes. The additive
`subscription_mutation_requests` table is a service-only, actor-scoped idempotency ledger. It
stores an operation, resource, canonical request hash, final HTTP status, and JSON response so
completed assignment and lifecycle requests can be replayed without a second transition. A key
cannot be reused for a different operation, resource, or payload. The ledger is claim-first and
completed after the route's audit and entitlement work; a pending duplicate is rejected for a
short retry rather than executing concurrently.

## SA-2.8 live contract — 2026-09-12

The live entitlement contract is composed of `resolve_tenant_entitlement(uuid)` for source
resolution, `refresh_tenant_entitlement(uuid)` for the tenant cache, and server-side route/API
guards that apply kill switch, entitlement, role, and read-only checks in that order. Exact plan
feature sets, suspended read-only behavior, cancelled no-access behavior, and live off/beta/on
kill-switch decisions passed focused HTTP/database verification.

The kill-switch table remains platform-owned and is read directly on each enforcement request so an
admin toggle cannot remain stale in a different Next.js route bundle or process. The dedicated live
tenant boundary matrix now passes for the SA-2 storage objects: service-only subscription, add-on,
usage, and mutation-ledger tables deny direct SELECT/INSERT/UPDATE/DELETE; tenant entitlement
reads are restricted to the caller's own tenant and entitlement writes are denied; tenant sessions
cannot call admin subscription APIs. The remaining acceptance gap is authenticated browser mutation
replay plus mobile and screenshot evidence, not an untested direct database boundary.

## Current SA-3 live contract — 2026-09-13

The shared project now uses `platform_invoices` and `platform_invoice_lines` as the application
billing document family. The additive migrations `20260913200000_sa_3_align_billing_rpcs_with_platform_invoices.sql`
and `20260913202000_sa_3_repoint_invoice_family.sql` align invoice-generation RPCs and foreign keys
for payments, credit notes, pending charges, and period billing. Draft assembly and negative
reduction-line semantics are preserved by `20260913210000_sa_3_invoice_lines_assemble_as_draft.sql`
and `20260913220000_sa_3_invoice_line_sign_convention.sql`.

Live focused checks passed for provider adapters, invoice generation and immutability, custom
invoices, coupons, credit notes/refunds, period billing, signed Whop events, payment activation,
past-due transitions, stale-event ordering, duplicate delivery, and durable webhook failures.
Credit-note approval and webhook processing state use service-only SECURITY DEFINER RPCs with an
empty search path (`approve_credit_note`, `mark_webhook_processed`, and `mark_webhook_failed`) so
the application does not need direct UPDATE grants on immutable billing/event tables.

The SA-3 database gate is not fully accepted yet: the annual live invoice verifier now passes, while
populated browser evidence, invoice-reminder visibility, and a dedicated revenue reconciliation
verifier remain open. The consolidated `/admin/billing` workspace is implemented but still needs
authenticated browser evidence. Issued invoices and credit notes created by QA are retained as
immutable, namespaced history; their counters are never rewound.

## Baseline QA database reconciliation — 2026-09-13

The detailed task audit is in [`docs/qa/SA-0.1-SA-5.5-QA-AUDIT.md`](../qa/SA-0.1-SA-5.5-QA-AUDIT.md).
The current live project remains behind the local migration set. Applying DDL through the available
database role failed with `permission denied for schema public`, so local migrations are recorded
as pending rather than represented as live facts.

Known live drift affecting the baseline includes the expected service-role audit-log grant,
`render_disposition_note`'s empty `search_path`, missing declared indexes/triggers, and incomplete
tenant-app grants for calling-window and vendor-post-key objects. The local repair files are
additive and reversible, but require an authorized schema-owner run followed by a fresh inventory.
The live tenant and SA-2 control-plane isolation verifiers pass for the exercised matrices; this
does not prove every RLS-enabled table has a complete policy.

## Focused LA reconciliation — 2026-09-14

### LA-1.5 rejected partner submissions — local remediation

The current checkout includes the reviewed additive migration
`20260914140000_la_1_5_rejected_partner_submissions.sql`. It defines
`public.partner_rejected_submissions` as an append-only, non-billable source for TCPA-blocked
partner submissions. Rows are scoped by `tenant_id` and `partner_id`, retain only an optional
four-digit phone suffix, enforce `reason = 'tcpa_block'`, and use a unique submission/reason key
for idempotent retries. The tenant-app role can read only its own tenant and partner rows; the
service-only adapter inserts and reads the aggregate count. The migration has been parsed locally
but is not live-applied because the configured database role lacks schema DDL authority.

Current focused live checks after the compatibility fixes:

- Partner, partner-user, and partner-product lifecycle suites pass against the live project.
- Verification, deal-flow, buffer-handoff, agent-floor, partner-quality, and subscription-limit
  suites pass their API, isolation, audit, and idempotency checks.
- The partner-quality verifier now uses the shared database UTC calendar, matching the live
  `created_at::date` predicate; all 17 checks pass, including direct `agent_leads` reconciliation
  and every metric drill-down.
- The live project still lacks the atomic `consume_meter_capacity` RPC required by screening and
  affiliate-dependent workflows. The application fails closed rather than using a non-atomic
  fallback.
- `apply_auto_offer_to_subscription` is still the older live definition (`search_path=public` and
  broad-offer creation ordering). The reviewed additive precedence/search-path repair remains local
  and requires a schema owner to apply.
- `render_disposition_note` likewise remains without the pinned live search path required by the
  local security repair. No DDL was attempted because the configured database role cannot alter the
  shared schema.

These findings are live-schema facts, not migration assumptions. The local migration set is not
considered applied until a DDL-authorized operator runs it and a fresh inventory confirms the exact
function, grant, policy, and index state.

## 2026-09-14 dialer completion correction

The working tree adds `supabase/migrations/20260914100000_la_2_9_complete_existing_attempt.sql`.
It is an additive, service-role-only function for the browser flow that creates a call attempt before
disclosure confirmation and therefore must complete that existing row rather than insert a second
attempt. It locks the tenant-scoped attempt, queue item, and lead; updates the attempt; advances or
closes the lead; releases the queue item; and writes an audit event in one transaction.

This function is part of the reviewed local contract, not live-schema evidence. The shared database
inspection previously showed missing application RPCs and no DDL authority for the configured role.
The application therefore fails closed when the function is absent. No existing rows are reset,
deleted, or rewritten by this correction.

## SA-2.6 catalog write boundary — 2026-09-14

The current checkout adds `20260914110000_sa_2_6_addon_catalog_admin_rpc.sql`. It does not create a
new schema or replace the compatibility tables. `public.admin_upsert_addon(...)` is a
`SECURITY DEFINER` transaction with an empty search path and service-role-only execute grant. It
validates active feature keys, meter keys and positive quantities, existing plan IDs, integer-cent
pricing, and unique child references. It atomically updates `addons`, `addon_features`,
`addon_meters`, and `plan_available_addons`. On update, feature/meter changes are refused while a
live `subscription_addons` attachment exists; this protects current entitlement behavior until
add-on versioning is introduced.

The migration is local and pending live application. No shared schema or data was changed during
this remediation because the configured role lacks DDL authority.
## LA-2 presentation adapters — local remediation

The dialer service reads `outbound_scoring_decisions.selection_reason` by `tenant_id` and `lead_id`
as an optional compatibility read. It is intentionally non-blocking when the shared project has not
yet applied the LA-2.13 scoring object. The setter presentation consumes the existing
`tenant_setter_scorecard` and `tenant_member_roster` contracts through `/api/app/scorecard`; no new
tables or writes were introduced. Scorecard and roster data remain tenant-scoped in the service.

## LA-2.11 appointment reminders — local migration

`tenant_appointment_reminder_events` retains one immutable recipient key per appointment and recipient
type, with both rendered local times and delivery status. `claim_appointment_reminders` uses row locks
and `skip locked` to set `tenant_appointments.reminder_sent_at` once before side effects. The table is
tenant-readable through `tenant_app` but writable only by the server-side worker's service role.
The migration is additive and has not been applied to the shared project from this checkout.

## LA-2.12 appointment close-out — local contract

`listCloseOutAppointments(tenantId)` consumes the reviewed `tenant_appointment_close_out` view and
rechecks `tenant_id` on both the close-out view and `agent_leads` lookup. `markCloseOutOutcome` calls
the reviewed `mark_appointment_outcome` RPC with the authenticated tenant and actor. The route does
not accept a client-selected tenant scope. The local UI contract supports explicit showed,
no-show, and cancelled outcomes; `rescheduled` remains an API-supported outcome for a future control.

These objects are local compatibility contracts only until their migration is promoted. No live
tables, rows, or functions were changed by this remediation.

## LA-2.2 atomic list import — local migration

`20260914160000_la_2_2_atomic_lead_import.sql` adds the service-role-only
`import_agent_lead_batch(uuid, uuid, jsonb)` transaction. It validates the actor and tenant,
locks existing tenant leads, inserts new leads with the template/pipeline/stage and screening
snapshot, validates campaign scope, and calls `import_agent_lead_source` before returning the
committed IDs. A failure rolls back the batch. The client-facing import route remains protected by
the authenticated tenant role and records an idempotent import-batch result.

Read-only live inspection on 2026-09-14 found that the deployed function still checks
`public.users.tenant_id`, a column absent from the shared compatibility schema; membership is
stored in `public.tenant_users`. The additive repair
`20260914193000_la_2_2_import_actor_membership_fix.sql` keeps the transaction and service-only
grants but validates `p_created_by` through the tenant membership bridge. It is not live-applied
because the configured database role has no DDL authority. The import contract remains
database-misaligned until promotion and a fresh two-tenant verification.

The parser-side normalization and preview are local application contracts. The additive
`20260914170000_la_2_2_vendor_import_mappings.sql` migration now provides one tenant/vendor/product
mapping record with tenant-app RLS, vendor/tenant trigger validation, and a unique conflict key for
idempotent saves. A usable-row cost ledger and live 20k import benchmark do not exist yet. Neither
migration has been applied to the shared project, so the live inventory and generated database types
must be refreshed after a schema-authorized promotion.
