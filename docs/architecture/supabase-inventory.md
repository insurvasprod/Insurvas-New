# Supabase inventory — live project

## Current foundation reconciliation — 2026-09-14

The latest read-only contract pass uses `npm.cmd run verify:rpc-contract`,
`npm.cmd run check:tenant-access`, and `npm.cmd run check:triggers`: 165/165 application RPCs are
present, 127/127 tenant-app declarations are correct, and 86/86 declared triggers are present.
Those checks no longer report missing application RPCs, incomplete tenant-access declarations, or
missing declared triggers. The remaining live database findings are specific security/advisor,
shape-compatibility, migration-authority, and authenticated-browser evidence items recorded in the
master register. The current LA-2.2 import RPC is a separate live shape defect: its deployed actor
predicate references the absent `public.users.tenant_id`; the local membership-bridge repair is not
promoted because the configured role has no DDL authority.

The earlier 2026-09-11 snapshot below is historical and is not the current SA contract. Focused
read-only checks against the existing configured project now confirm these objects are present:
`features`, `feature_flags`, `tenants`, `tenant_users`, `users`, `admin_users`, `audit_log`,
`platform_audit_events`, `billing_plans`, `billing_plan_versions`, `organization_subscriptions`,
and `organization_entitlements`.

Current row counts from the live project are: `tenants` 25, `tenant_users` 23, `users` 39,
`admin_users` 7 (5 active), `audit_log` 474, `platform_audit_events` 195, `features` 28,
`feature_flags` 26, `billing_plans` 6, and `billing_plan_versions` 6. These counts include
existing records and namespaced QA fixtures; no reset or broad deletion was performed.

The feature contract check passes: 28 active customer-facing catalog entries have menu coverage,
and feature-bearing agent APIs are covered. `create_tenant_with_owner` and the current admin-user
RPCs are present. The post-hardening custom inventory is 384 tables, 18 views, and 289 functions;
The 2026-09-14 live inventory reports 3 RLS-disabled tables, 7 client-executable security-definer
functions, 0 mutable search paths in its custom scan, 433 tables, 28 views, and 387 functions.
It reports 85 RLS-enabled tables without policies. These values supersede the earlier
snapshot below and keep SA-0.4 open until each finding is reconciled.

The earlier custom snapshot reported 0 RLS-disabled tables, 0 client-executable security-definer functions, and 0 mutable
paths. The earlier Supabase advisor independently reported 86 policyless RLS tables, 28 anon/43
authenticated security-definer findings, and 39 mutable paths; that scanner discrepancy remains
open for SA-0.4 and is not silently treated as resolved.

The 2026-09-14 local remediation pass parse-verified, but did not apply,
`20260914180000_la_2_tenant_access_policy_repair.sql` and
`20260914181000_la_1_security_and_offer_search_path_repair.sql`. The first addresses the eight
incomplete tenant-access declarations reported by `check:tenant-access`; the second addresses the
four findings reported by `verify:la1-security` (one function search path and three partner-policy
expressions). Fresh live inventory is required after an authorized migration run.

The focused live grant query after the 2026-09-12 hardening returned no `anon`, `authenticated`, or
`tenant_app` grants for `audit_log`, `lead_notes`, `lead_note_edits`, `lead_note_mentions`,
`agent_notifications`, or `platform_audit_events`. Server-role access remains. The local
hardening migration is
`supabase/migrations/20260912350000_sa_0_4_revoke_legacy_lead_note_grants.sql`.

SA-1 live reconciliation (2026-09-12): the current project contains `admin_user_list`,
`admin_user_stats`, `admin_login_activity_stats`, `admin_attach_user_to_tenant`,
`admin_update_user_with_email_change`, `admin_replace_user_token`, and the `user_invitations`
store. Auth-first invitation creation, resend replacement, duplicate rejection, role editing,
last-owner protection, and user audit diffs were exercised with namespaced fixtures. The two
SA-1.2 function corrections are tracked by migrations
`20260912370000_sa_1_2_attach_tenant_conflict_fix.sql` and
`20260912380000_sa_1_2_replace_token_text_fix.sql`.

The create-user form now selects an initial plan for new tenants. Local migration
`20260914120000_sa_1_2_provision_initial_plan.sql` adds the service-only
`admin_attach_user_to_tenant_with_plan` RPC, which commits the new tenant, first owner, invitation,
and initial monthly subscription together. It is not live-applied because the shared DDL role is
unavailable; existing-tenant invites continue through the existing RPC. Counts above include the
disposable QA records created during this batch; they were not removed or used to modify shared
identities.

Collected: 2026-09-11 by `npm run qa:inventory`, catalog reads only through `TENANT_DB_URL`
(`tenant_app`: not superuser, `NOBYPASSRLS`, no `CREATE` on `private`, owns nothing in `public`).
Regenerate with:

```bash
npm run qa:inventory -- --out inventory.json
```

The project reference, connection string and keys are deliberately absent from this document.

## Focused remediation inventory — 2026-09-14

The live `tenant_users` table was rechecked during the tenant-role verifier repair; it has no `id`
column, and the application count adapter now uses a compatible `select(*)` count shape. The live
`lead_queue` table has an equivalent `(tenant_id,status,queued_at)` index named
`lead_queue_tenant_status_compat_idx`.

The live `apply_auto_offer_to_subscription` and security-definer paths now pass the focused offer and
security checks. The local verifier evidence is current; authenticated admin/browser proof and the
broader advisor inventory remain open. Do not infer that all historical migration drift has been
removed from the two-lineage public schema.

The current local repository gates are: 501 tests passing, typecheck passing, lint passing, build
passing without the former middleware deprecation warning, and `check:features` passing with 28 active
catalog features and no catalog/menu/API drift. These are repository/current-runtime facts and do
not replace the unresolved live advisor and authenticated browser evidence.

The latest `npm.cmd run check:collisions` pass found 11 declared/live table shape incompatibilities:
invoice status/period types, partner and user status types, UUID-versus-bigint pipeline identifiers,
the audit target identifier, lead-SLA rung, and disposition-flow identifiers. These are compatibility
risks, not automatically safe rename candidates; each must be mapped or isolated before a new foreign
key or write path is introduced.

## SA-2.1 – SA-2.3 live inventory update

The current live counts for the catalog and plan-version contract are: `feature_modules` 9,
`features` 28, `plans` 3, `plan_features` 47, `plan_limits` 3, `plan_prices` 3,
`plan_available_addons` 0, `subscriptions` 6, and `tenant_entitlements` 20. The
`plans_individual_defaults` trigger is present on `public.plans` and calls
`seed_individual_plan_defaults()` with `search_path=""`.

The previously failing plan-version verifier now passes after the additive migration
`20260912480000_sa_2_2_repair_individual_plan_limit_trigger.sql`. No existing plan rows were
rewritten; the migration only inserted missing one-seat defaults and restored the future-insert
trigger.

## Totals

| Object | Count |
|---|---|
| Tables in `public` | 384 |
| Views and materialized views | 18 |
| Functions in `public`, excluding extension-owned | 289 |
| Foreign keys | see `inventory.json` |
| Triggers on `public` and `auth` | see `inventory.json` |
| Extensions installed in `public` | 2 (`btree_gist`, `pg_trgm`) |

308 tables is far more than this application uses. The project hosts **two generations of the
product at once**: the tenant-era SaaS in this repository, and an organizations-era CRM that is
live and in use. The evidence is in the function inventory below.

## The application-to-database contract

`npm run verify:rpc-contract` measures it directly:

| Measure | Count |
|---|---|
| RPCs this application calls | 131 |
| Present in the database | **27** |
| **Missing** | **104** |
| Application functions in the database this app never calls | 106 |

Those 106 are not dead code. They are a coherent other product: `outbound_can_dial_now`,
`outbound_set_agent_campaigns`, `reserve_organization_seat`, `consume_organization_usage`,
`get_next_legacy_lead`, `assign_lead`, `approve_commission`, `resolve_agent_commission`,
`transition_insurance_policy`, `transition_talent_candidate`, `hr_generate_slug`,
`chat_sidebar_state`.

A `supabase.rpc("x")` against a function that does not exist is not a compile, type or lint error —
`lib/supabase/database.types.ts` is hand-maintained and can declare a function nobody created. It is
a runtime 500. `verify:rpc-contract` is the guard; run it before trusting any other result.

## Historical application-shape snapshot — 2026-09-11

The following section is retained for reconciliation history. It must not be read as the current
live schema summary above.

## Tables this application needs (historical)

Checked against `pg_class`. 20 present, 29 absent.

### Present (20)

The complete LA-0 set, plus the identity and audit spine:

`tenants` · `tenant_users` · `tenant_entitlements` · `contacts` · `households` · `appointments` ·
`licenses` · `eo_policies` · `ce_records` · `field_schema` · `merge_log` · `tenant_carriers` ·
`commission_schedules` · `advance_rules` · `users` · `organizations` · `admin_users` · `audit_log` ·
`platform_audit_events` · `invoices`

Row counts (service role, RLS bypassed): `tenants` 6 · `tenant_users` 14 ·
`tenant_entitlements` 6 · `users` 21 · `contacts` 3 · `invoices` 0 · `settings` 4 ·
`admin_users` 3 active.

### Absent (28)

Essentially the whole SA plane:

`plans` · `plan_versions` · `plan_features` · `plan_limits` · `plan_prices` · `subscriptions` ·
`payments` · `coupons` · `credit_notes` · `meters` · `usage_events` · `usage_totals` · `features` ·
`feature_modules` · `addons` · `legal_documents` · `legal_acceptances` · `email_log` ·
`checkout_sessions` · `webhook_events` · `whop_plans` · `business_profiles` · `template_fields` ·
`tenant_products` · `tenant_credits` · `form_drafts` · `affiliate_links` · `buffer_handoffs`

Also absent and referenced directly by failing admin routes: `admin_user_list`, `credit_packs`,
`compliance_vendors`.

**Note on `settings`:** `public.settings` is present in the live project with four stored rows.
`/api/admin/settings` returns the seven registry keys because the server safely supplies coded
defaults for keys without stored overrides. The deployed table name and generated type agree; the
three missing default rows are covered by the additive
`20260914182000_sa_4_1_settings_registry_completion.sql` migration. Until that migration is
promoted by the database owner, those three keys remain default-only and SA-4.1 remains
database-misaligned for override persistence.

## The auth bridge

`public.users`:

- `id` — no default, `NOT NULL`, foreign key `users_id_fkey` → `auth.users`
- `name` — `NOT NULL`, no default
- also carries legacy `users_role_id_fkey` → `roles`, `users_organization_id_fkey`,
  `users_team_id_fkey`, `users_call_center_id_fkey` from the organizations era

Trigger `on_auth_user_created` → `private.handle_new_auth_user()` inserts `id`, `email`,
`full_name`, `display_name`, `status`, `active` — **but never `name`**. Every insert into
`auth.users` therefore raises `23502`, surfaced by Supabase Auth as *"Database error creating new
user"*. No user can be created by any path: signup, invitation acceptance, `auth.admin.createUser`,
or a test fixture.

Fix written and parsing but **not applied**:
`supabase/migrations/20260911120000_auth_user_bridge_name_fix.sql`. Applying it needs DDL access,
which no credential in this repository has, by design.

## Migration chain

| Check | Result |
|---|---|
| `npm run db:check` (parse each file) | **Pass** |
| `npm run db:check:deep` (replay in order) | **Fail — 155 problems** |

`0000_baseline.sql` is a 445-statement generated dump intended to close backlog #29, and it reports
59 problems on replay: it references `payments`, `subscriptions`, `plans`, `provider_settings`,
`usage_events` and `legal_documents` in indexes and views it never creates. It was generated from a
database that already lacked them, so regenerating it with `npm run db:dump` will not help.

**Consequence:** the repository cannot currently provision a working database from its own
migrations. Closing that gap means authoring the SA-0 – SA-3 schema as committed migrations — which
is the same work as the SA-1, SA-2 and SA-3 tasks themselves.

## Security posture

See `docs/architecture/security.md`. Headline: 0 tables with RLS disabled; the focused six-table
grant query found no `anon`/`authenticated`/`tenant_app` grants; the custom inventory reports zero
client-executable security-definers and mutable paths, while the current Supabase advisor reports
28 anon and 43 authenticated security-definer findings plus 39 mutable paths. The scanner
discrepancy needs resolution before the security gate is accepted.

## SA-2.4 through SA-2.6 live inventory — 2026-09-12

The shared project contains the compatibility tables required by the current pricing and usage
adapters. Live row counts at review time were: `plan_prices` 3, `plan_limits` 3,
`plan_meters` 0, `meters` 6, `usage_events` 4, `usage_totals` 38, `addons` 5,
`addon_features` 0, `addon_meters` 0, `plan_available_addons` 0, and
`subscription_addons` 1 retained detached-history row. Each of these tables had RLS enabled and
one service-role policy in the focused inventory.

The live RPC repair migration `20260912500000_sa_2_6_repair_addon_entitlement_resolution.sql`
is applied. `verify:addon-meters` passed after application. The authenticated browser review
rendered `/admin/addons`, `/admin/credits-limits`, and `/admin/subscriptions` with live data and
no console errors. The add-on catalog screen is currently read-only, and the credit/usage monitor
fixture suite still has known failures; therefore these tasks remain Partial. Mobile and visual
screenshot evidence remain unverified.

## SA-2.7 live inventory — 2026-09-12

`admin_assign_subscription(uuid,uuid,text,timestamptz)` is the live compatibility function after
`20260912510000_sa_2_7_repair_assignment_guard.sql`. Its security configuration is
`SECURITY DEFINER`, `search_path=""`, `anon_execute=false`, `authenticated_execute=false`, and
`service_execute=true`. The additive migration `20260912520000_sa_2_7_subscription_mutation_idempotency.sql`
adds the service-only `subscription_mutation_requests` table with actor/key uniqueness, request
hash, operation/resource fields, replay response, completion status, and a resource index. The
transition and replay verifiers passed against the shared project. The admin subscription page
and Active filter were browser-checked; full authenticated mutation replay, cross-tenant matrix,
mobile, and screenshot evidence remain unverified.

## SA-2.8 live inventory — 2026-09-12

The focused live checks confirmed the entitlement and control-plane objects used by the current
adapters: `features`, `plan_features`, `plans`, `plan_prices`, `subscriptions`,
`tenant_entitlements`, `feature_switches`, and `platform_feature_controls`. The live plan and
kill-switch HTTP checks passed against the shared project after the supported Auth-first fixture
repair. `npm.cmd run verify:sa2-tenant-matrix` now passes the dedicated live two-tenant boundary
matrix. Service-only subscription/add-on/usage/mutation tables deny SELECT/INSERT/UPDATE/DELETE;
tenant entitlement reads are scoped to the caller's own tenant and writes are denied; app sessions
resolve their own tenants; and tenant cookies are denied at the admin subscription API. No blanket
Pass is recorded for the remaining authenticated browser mutation replay, mobile, or screenshot
evidence.

## Current SA-3 live inventory — 2026-09-13

The application billing family is `platform_invoices` / `platform_invoice_lines`, with related
`payments`, `credit_notes`, `pending_charges`, `period_billing_runs`, `coupons`,
`subscription_coupons`, `webhook_events`, `metrics_daily`, and `invoice_counters`. The additive
SA-3 reconciliation migrations repointed the application foreign keys and billing RPCs away from
the unrelated legacy `invoices` family without deleting legacy records.

Focused live verifiers passed:

- `verify:payments` — Whop-only registry, local adapter behavior, call-log immutability and retention.
- `verify:invoices` — reconciliation, idempotency, numbering, line totals, payment arrival, and immutability.
- `verify:custom` — custom invoice validation, issue/void-related state, settlement, activation, and audit.
- `verify:coupons` — restrictions, expiry, duration, caps, atomic consumption, replay, and discount lines.
- `verify:credits` — second-admin refund approval, failed refund retention, credit-note immutability, and replay.
- `verify:period-billing` — plan/add-on/overage/credit rating and period idempotency.
- `verify:events`, `verify:webhook`, and `verify:webhook-invoicing` — event ordering, duplicate delivery,
  durable failures, and signed endpoint behavior.

The service-only functions `approve_credit_note`, `mark_webhook_processed`, and
`mark_webhook_failed` are live with empty search paths and no client execute grants. QA-issued
financial history is retained under namespaced fixtures; cleanup deactivates fixtures and never
rewinds invoice or credit-note counters. The annual live billing verifier now passes. Browser
evidence, invoice-reminder visibility, and a dedicated revenue reconciliation verifier remain
outstanding, so SA-3 is not marked fully accepted.

## Baseline QA inventory reconciliation — 2026-09-13

See [`docs/qa/SA-0.1-SA-5.5-QA-AUDIT.md`](../qa/SA-0.1-SA-5.5-QA-AUDIT.md) for the task-by-task
classification. The aggregate verification run passed 63/73 suites. Focused reruns passed the
repaired user-integrity, system-maintenance, credits/limits, rate-limit, agent-template, contacts,
partner-chat, invoice, payment, coupon, credit-note, subscription, and legal checks.

The live inventory still differs from the repository migration set: 20 declared triggers and many
declared indexes are absent, three tenant-app grant/policy surfaces are incomplete, and the live
definer/grant state has not incorporated the pending local repairs. No migration was applied in
this pass because the configured connection lacks schema DDL authority. Existing shared records and
QA fixtures were preserved according to the baseline safety rules.

## Local email delivery safety — 2026-09-13

Email transport is application-level safety behavior and does not require a schema migration.
`EMAIL_DELIVERY_MODE` defaults to `disabled`, so SMTP credentials present in a local environment do
not cause accidental external delivery. Reserved QA domains (`.test`, `.example`, `.invalid`,
localhost, and `example.*`) are rejected before SMTP connection attempts. Disabled and rejected attempts are
recorded as skipped rows in the existing `email_log` table when available; no provider secret or
message content is exposed in browser code.

## QA credential-handling verification — 2026-09-14

The tracked-file scan found no demo password, service-role value, SMTP credential, or platform-admin
credential. Local demo passwords are supplied through the ignored `.env.demo.local` file and consumed
by the provisioning script through environment variables. No credential values were emitted or
written to Supabase during this check.

## Focused LA live inventory update — historical snapshot superseded 2026-09-14

The earlier snapshot below is retained to explain the original findings. The current reconciliation
reports 165/165 application RPCs, 127/127 tenant-access declarations, and 86/86 declared triggers
present/correct. Current focused screening, partner-submission, affiliate, offer, add-on, security,
and disposition verifiers pass. The remaining live database defect in this area is the deployed
`import_agent_lead_batch` actor predicate referencing absent `public.users.tenant_id`; the reviewed
repair `20260914193000_la_2_2_import_actor_membership_fix.sql` remains unapplied pending DDL
authority. `check:collisions` also reports 11 repository/live type-shape incompatibilities.

No migration was applied during this pass. The configured database role lacks schema DDL authority.

### Superseded historical details

### Pending LA-1.5 rejected-submission object

The local migration `20260914140000_la_1_5_rejected_partner_submissions.sql` was reviewed and
parsed, but `public.partner_rejected_submissions` is not yet present in the live project. The
configured database role cannot apply DDL. Until a schema-authorized operator applies the additive
migration and this inventory is rerun, the TCPA rejection count and partner-quality source remain
local implementation evidence rather than live schema evidence.

Live function inspection confirmed:

- `partner_quality_evidence` and `partner_quality_report` exist and return the expected raw counts;
  the focused verifier passes after using PostgreSQL UTC date semantics for its disposable fixtures.
- `apply_auto_offer_to_subscription(uuid)` exists but is the older definition with broad-offer
  creation ordering and `search_path=public`; the local SA-4.4 repair is not live.
- `consume_meter_capacity` is absent, as are other downstream RPCs recorded by the RPC contract
  verifier. Screening-dependent workflows therefore fail closed rather than bypassing atomic usage
  enforcement.
- `render_disposition_note` remains without the pinned `search_path` recorded in the local security
  repair migration.
- The live `lead_queue` has an equivalent `(tenant_id,status,queued_at)` index, but transfer-inbox
  timing still exceeds the acceptance target from the remote developer environment.

No migration was applied during this pass. The configured database role lacks schema DDL authority;
the local migration set remains a reviewed proposal until an authorized schema owner applies it and
the inventory is rerun.

## 2026-09-14 application RPC reconciliation

Local migration `20260914100000_la_2_9_complete_existing_attempt.sql` declares the reviewed
`complete_existing_dial_disposition` RPC. It is intentionally granted only to `service_role` and uses
an explicit `public, pg_catalog` search path. The RPC must be present in the shared project before
LA-2.9 disposition completion can be live-accepted. Until then, the application reports a controlled
workflow-unavailable error and does not perform a partial attempt-only update.

The live RPC inventory remains authoritative for current deployment state. Local migration presence is
not counted as live application or RLS evidence.

### Add-on catalog remediation — 2026-09-14

The local repository now contains the additive migration
`20260914110000_sa_2_6_addon_catalog_admin_rpc.sql` and corresponding server routes. It is not
present in the live project yet: the current database role cannot apply DDL, so the live function,
grant, authenticated mutation, and browser replay are intentionally recorded as pending. The
existing live add-on tables and service-role-only policies remain unchanged.

The post-change `npm.cmd run db:check -- --fast` run parsed the migration stream but the remote
connection reset (`ECONNRESET`) before the live check completed. This is retained as an infrastructure
verification limitation; it is not reported as a successful migration application.
## LA-2 presentation objects — verification status

- `outbound_scoring_decisions`: optional compatibility read for dialer `selection_reason`; current
  application code tolerates an unavailable table and fails closed for the actual dial action.
- `tenant_setter_scorecard`: existing tenant-scoped scorecard view consumed by `/api/app/scorecard`.
- `tenant_member_roster`: existing roster view consumed for owner/team scorecard presentation.

The local checkout has not applied or modified these database objects. Confirm their presence,
grants, and policy behavior in the shared project before marking LA-2.9 or LA-2.12 fully accepted.

`tenant_appointment_reminder_events` and `claim_appointment_reminders` are pending additive objects
from `20260914150000_la_2_11_appointment_reminders.sql`. They require the preceding
`tenant_appointments` migration and are intentionally not represented as live inventory until a
schema owner promotes them.

`tenant_appointment_close_out` and `mark_appointment_outcome` are the reviewed local contracts used
by the new LA-2.12 close-out strip. They are not counted as live inventory from this checkout because
the migration has not been applied. Before acceptance, confirm the view definition, RPC ownership,
explicit `search_path`, execute grants, tenant predicates, and append-only outcome/audit behavior in
the shared project.

## LA-2.2 list-import objects — verification status

`import_agent_lead_batch(uuid, uuid, jsonb)` is present in the live inventory, but its deployed
body is database-misaligned: the actor check references `public.users.tenant_id`, which is absent;
the live membership bridge is `public.tenant_users(tenant_id,user_id,...)`. The local repair
`20260914193000_la_2_2_import_actor_membership_fix.sql` preserves the intended
`SECURITY DEFINER`, `search_path = public, pg_catalog`, no execute grant for `public`, `anon`,
`authenticated`, or `tenant_app`, and explicit `service_role` grant. It has not been promoted
because the configured role has no DDL authority. Acceptance still requires live body/owner/grant
verification, actor/tenant checks, row locks, campaign scope checks, trigger side effects, and a
fresh two-tenant import test.

The local application-side normalization, mapping suggestions, preview, and
`tenant_import_mappings` contract are reviewed but not live inventory. A usable-row accounting
object is still not modeled.
