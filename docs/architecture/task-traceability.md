# INSURVAS Super Admin QA traceability — SA-0.1 … SA-6.4

Recheck date: 2026-09-14
Repository: `C:\Users\Victus\OneDrive\Documents\ChatGPT\Insurvas-git\Insurvas-New`
Database: the existing project configured by `.env.local` (reference deliberately omitted)
Supersedes the 2026-09-11 morning revision of this document.

## Current remediation update — 2026-09-14

The active checkout now reports 509 passing automated tests. Focused live rechecks passed for the
SA-2 tenant matrix, annual invoice generation, invoice immutability, payment-provider boundary,
coupon restrictions/consumption, custom invoice lifecycle, and persistent rate limits. The reviewed
LA-2.2 import actor-membership repair was promoted to the authorized shared project and its live
verification now passes; remaining LA-2.2 gaps are usable-row accounting, performance evidence, and
authenticated browser coverage. Hosted checkout remains blocked by the current Whop plan mapping.
Historical rows below are retained as dated evidence; current classifications are maintained in
`docs/qa/MASTER-GAP-BLOCKER-REGISTER.md`.

The current SA role matrix was rerun on 2026-09-14 and persisted at
`docs/qa/evidence/sa-matrix-20260914.json`: all six required sessions were available, 36 static
admin APIs and 29 admin screens were probed, there were zero 5xx responses, zero transport errors,
zero missing sessions, and zero anonymous protected-path leaks. The matrix is read-only apart from
temporary namespaced admin fixtures, which were deactivated after the run. The SA-1.2 plan-aware
provisioning migration is now promoted and `verify:user-integrity` passes plan selection,
forced-owner behavior, seat limits, lifecycle, and rollback. Authenticated invitation, login, and
mobile browser evidence remain open.

## Latest authenticated Super Admin review — 2026-09-14

The user-provided authenticated Super Admin session reached all 28 SA entry points (27 rendered
pages plus the supported `/admin/settings` alias to `/admin/advanced`). Dashboard, tenant,
billing, catalog, monitoring, compliance, and platform surfaces were inspected. The dashboard
now provides an accessible three-step operator guide, billing tabs expose the active section with
`aria-current="page"`, and desktop admin links expose current-page and keyboard-focus semantics.
Screenshots were captured for dashboard, billing, and tenants; the guide disclosure interaction
passed; no browser warning/error entries were observed. This current browser evidence supplements
the role matrix and does not convert mutation, provider, legal, or mobile evidence gaps into passes.

## Focused remediation update — 2026-09-14

The latest read-only live reconciliation uses the executable package scripts recorded in the QA
register: `check:tenant-access`, `check:triggers`, and `verify:la1-security`. It reports 127 of 127
tenant-app declarations correct, 86 of 86 declared triggers present, and 165 of 165 application
RPCs present. `verify:la1-security` passes. These current results supersede the earlier live drift
snapshot retained in the historical entries below.

The current live results were read-only; no shared records or live security state were changed by
this pass. Previously reviewed local migrations remain in the repository as historical/audit
artifacts and are not treated as proof of live state.

The fresh production-build browser session rendered `/admin/login`, accepted the disposable admin
credentials, and reached the mandatory six-digit MFA challenge. No OTP was guessed or bypassed, so
authenticated admin evidence remains open for this session. Anonymous login-page rendering and
the local build remain verified.

The current checkout was rebuilt successfully after fixing a live-shape compatibility defect in
`lib/metering/outbound.ts`: the tenant-user count query now selects `*` instead of assuming an
`id` column that is not present in the live `tenant_users` table. The repository test suite now
reports **499 passing tests and 0 failures**; `typecheck`, `lint`, `build`, and `check:features`
also pass. The Next.js middleware-to-proxy deprecation is cleared by the local `proxy.ts` migration.

Focused live reruns passed `verify:lead-workspace`, `verify:lead-notes`, `verify:tenant-roles`,
`verify:lead-import`, `verify:contacts`, `verify:screening`, `verify:partner-submission`, and
`verify:affiliate`. These results strengthen the LA evidence but do not change browser
classifications where full authenticated evidence is absent.
`verify:transfer-inbox` passed correctness, isolation, and audit checks but measured 1,461 ms for
the 500-row timing assertion; the live project has an equivalent `(tenant_id,status,queued_at)`
index, so this remains an environment/performance evidence gap.

The current focused screening rerun also proved fail-closed vendor outage handling, TCPA-over-DNC
precedence, replay, and concurrent cache coordination. The partner verifiers passed the public
`tcpa_block` rejection contract while retaining `tcpa_litigator` as the persisted screening
outcome. Remaining open classifications are browser evidence and other separately documented
provider, legal, deployment-performance, or product-decision boundaries.

Anonymous browser QA also rechecked `/pricing` at desktop and 390×844 mobile widths after the
contrast fix. Plan cards, prices, descriptions, feature text, cycle controls, and empty-state text
are readable; there is no horizontal overflow. Authenticated admin browser evidence for SA billing
and the complete LA matrix remains open and is not inferred from this public-page check.

## Historical batch evidence — SA-0.1 through SA-0.3 (2026-09-12)

This was the first completed QA batch in the then-current checkout. It is retained as historical
evidence, but it does not supersede the fresh live inventory below. No shared rows were reset or
deleted. The older claims about the catalog and canonical SA-2 objects must therefore not be used
as present-day acceptance evidence.

| Evidence | Result |
|---|---|
| Automated tests | **Pass** — 368 tests, 0 failures |
| TypeScript | **Pass** — `npm.cmd run typecheck` exit 0 on the current checkout |
| ESLint | **Pass** |
| Production build | **Pass** — Next 16.3.3 completes without the former middleware-to-proxy warning |
| Feature contract | **Pass** — 28 active catalog features, menu coverage and feature-bearing API coverage agree |
| Tenant isolation | **Pass** — `verify:tenant-isolation`, `verify:membership-lookup`, and `verify:tenant-roles` passed with namespaced fixtures |
| Admin browser | **Pass for exercised flows** — fresh super-admin login, mandatory TOTP, dashboard, tenants, audit log, search/filter, mobile drawer, and tablet/mobile layouts |
| Live audit hardening | **Pass for append-only controls** — `audit_log` and `platform_audit_events` reject update/delete; `audit_log` is service-role-only |

The batch remains open because no active `support_agent` or `billing_admin` fixture remains after
cleanup, admin session-expiry/fresh-install seed proof was not exercised, and the exactly-one-
audit-row rule for every SA-1–SA-3 write route was not proven. A disposable support-admin account
completed the browser login and denied-route check; the disposable billing-admin account was
created and deactivated, but its browser TOTP verification returned an invalid/expired-code state.

## Current SA-0.4 evidence — foundation hardening (2026-09-12)

SA-0.4 is **Partial**, not accepted. The live hardening pass made three narrow, additive changes
against the existing Supabase project: the legacy/current hybrid lead-note tables no longer grant
`anon`, `authenticated`, or `tenant_app` direct table access; the unused `platform_audit_events`
table is server-only; and eleven server-side `SECURITY DEFINER` entry points no longer expose
client execution. The local migration is
`supabase/migrations/20260912350000_sa_0_4_revoke_legacy_lead_note_grants.sql`.

Evidence collected:

- `npm.cmd test`: **Pass** — 368 tests, 0 failures.
- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run check:features`,
  and `npm.cmd run db:check`: **Pass**. The Next 16 middleware-to-proxy convention is migrated to
  `proxy.ts`.
- Prior post-hardening custom inventory: 384 tables, 18 views, 289 functions, 0 RLS-disabled tables,
  0 custom-inventory client-executable security-definers, and 0 custom-inventory mutable paths.
- Fresh 2026-09-14 Supabase inventory: 433 tables, 28 views, 387 functions, 3 RLS-disabled tables,
  85 RLS-enabled tables without policies, and 7 client-executable security-definers. This newer
  snapshot supersedes the prior advisor snapshot below.
- Prior Supabase security advisor: 86 RLS-enabled tables without policies (INFO), 39 mutable
  `search_path` findings (WARN), 28 anon and 43 authenticated security-definer execution findings
  (WARN), 2 extensions in `public` (WARN), and leaked-password protection disabled (WARN). The
  advisor/custom-inventory discrepancy is retained rather than silently called resolved.
- Live grant query: no `anon`, `authenticated`, or `tenant_app` grants remain on `audit_log`,
  `lead_notes`, `lead_note_edits`, `lead_note_mentions`, `agent_notifications`, or
  `platform_audit_events`; service-role access remains for server adapters.
- Authenticated browser: super-admin audit log loaded 393 entries; page 2 pagination worked;
  action filtering returned only matching entries; no browser console errors were observed.
  Current-run screenshot: `C:\Users\Victus\AppData\Local\Temp\insurvas-qa-sa04-audit-log-desktop.png`.

Remaining acceptance gaps are the advisor findings, external Auth leaked-password configuration,
missing CI proof, full active-role matrix, session-expiry/fresh-seed
proof, failed-login/2FA visibility, and the audit-log browser treatment at narrow widths. The table
now keeps horizontal overflow inside its bordered table shell; a fresh narrow-width authenticated
capture is still required before the UX evidence can be closed.

## Current batch evidence — SA-1.1 through SA-1.3 (2026-09-12)

This batch was revalidated against the current live project after two verified SA-1.2 database
defects were corrected with additive migrations:

- `supabase/migrations/20260912370000_sa_1_2_attach_tenant_conflict_fix.sql` replaces the
  ambiguous `ON CONFLICT (tenant_id, user_id)` target with the existing `tenant_users_pkey`
  constraint.
- `supabase/migrations/20260912380000_sa_1_2_replace_token_text_fix.sql` aligns invitation-token
  replacement with the live text `user_invitations.purpose` column and validates the supported
  purpose vocabulary.

Evidence collected:

- `npm.cmd test -- --test-reporter=dot`: **Pass** — 368 tests, 0 failures.
- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run check:features`,
  and `npm.cmd run db:check`: **Pass**. Build is warning-free for the former middleware convention.
- Fresh authenticated super-admin browser: `/admin/users` loaded live counts and paginated rows;
  no browser console errors were observed.
- Disposable creation: Auth account, public profile, tenant membership, invitation row, and
  `user.created` audit event were written. The account remained `pending_verification` and
  inactive, and the invitation expiry was 72 hours from issue.
- Disposable resend: the old invitation was superseded, a new invitation was issued, and the
  `user.invite_resent` audit event was written. Link material is intentionally not recorded here.
- Duplicate email: the browser displayed `This email is already registered`; no new record was
  created.
- Disposable edit: name and role changed in the browser from producer to assistant; the live row
  showed `session_version = 1`, and the audit metadata contained old/new name and role values.
- Last-owner guard: attempting to demote the only owner of the namespaced tenant was rejected in
  the browser with the clear owner-preservation message and no mutation.
- Search/empty UX: a namespaced `Ray Delgado` fixture was returned by `delg`; a non-matching
  search displayed the empty state. Desktop browser evidence was captured during the run.

The batch is **Partial**. SA-1.1 still lacks live proof for the 5,000-user under-one-second
criterion and a populated suspended-only filter/count comparison. SA-1.2 still lacks the plan
selector and active subscription attachment required by its specification, and the invite-to-
set-password/login path was not completed in this run. SA-1.3 still lacks authenticated browser
proof for email-change confirmation, password-reset delivery, and a tenant session observing the
role change on its next request. Mobile-width browser evidence for this batch is also pending.

## Current batch evidence — SA-1.4 through SA-1.5 (2026-09-12)

The next two tasks were rechecked against their current Notion specifications, the live Supabase
objects, the admin routes, and an authenticated browser session.

| Task | Verdict | Evidence and remaining gap |
|---|---|---|
| SA-1.4 User state lifecycle | **Partial** | Active/inactive/suspended transitions are implemented behind the super-admin-only routes, suspension reason validation is server-side, state changes increment `session_version`, and tenant login returns the specified suspension message after successful credential verification. The only-owner role guard was exercised in the browser. **Open:** the Notion delete/7-day soft-delete requirements are intentionally descoped by the current product decision and no delete route is exposed; fresh authenticated suspend/unsuspend browser evidence and the full live session-invalidation workflow remain to be captured. |
| SA-1.5 Login activity and last-login | **Partial** | Authenticated `/admin/activity` rendered live platform activity with successful and failed attempts, daily/weekly aggregates, relative last-login values, and paginated results; the user detail route loads the latest 50 attempts and the shared-account IP warning is implemented. **Open:** 50,000-row timing proof, a dedicated failed-login-to-`last_login_at` comparison fixture, and mobile-width browser evidence remain unverified. |

The batch is **Partial**. No task is marked `Pass` because the required authenticated, high-volume,
and mobile evidence is incomplete. The live login-activity page showed failed attempts and no
browser console errors during this run. The repository-wide test baseline remains 368 passing
tests; focused SA-1.4/SA-1.5 automated tests are not present as separate suites.

The read-only admin surface matrix completed with **0 server errors** across 34 static admin API
routes and 28 admin screens. Anonymous protected requests returned redirects/401s as expected;
the only anonymous 200 was the public `/admin/login` screen. The matrix could not exercise
`support_agent` or `billing_admin` because no active disposable rows exist for those roles, and
dynamic user-action routes were intentionally skipped because they require fixture IDs.

## How to read this

Notion status is planning evidence only and is never sufficient. A task is `Pass` only when its
specification, frontend, backend, database, automated tests and live behaviour all agree. Every
row below cites the evidence that produced its verdict.

| Verdict | Meaning |
|---|---|
| **Pass** | Specification, code, database and live behaviour all verified |
| **Partial** | Implementation present and partly verified; a named part remains unproven |
| **Blocked** | Cannot be assessed until a named prerequisite is cleared |
| **Browser-unverified** | Backend verified; the authenticated screen was not exercised |
| **Database-misaligned** | The code expects tables/views/functions the live project does not have |
| **Deferred** | Not built yet, by plan |
| **Cancelled** | Explicitly descoped in Notion |
| **N/A** | No such task in the inventory |

## Task inventory

Read from the *Insurvas Sprint* Notion database, 2026-09-11. **45 SA task rows plus the SA-00
plan page.** Modules: SA-0 (×4), SA-1 (×5), SA-2 (×8), SA-3 (×9), SA-4 (×12), SA-5 (×4),
SA-6 (×3).

**SA-5.5 does not exist.** M5 is defined as SA-5.1 – SA-5.4 in both the SA-00 build plan and the
task database. It is recorded as `N/A` below, as instructed.

Two rows carry a non-Completed Notion status and are classified from that, not from code:
**SA-3.5** (`Cancelled`) and **SA-0.4** (`Backlog`). SA-6.1–6.3 are `Planned` and sit outside the
requested SA-0.1–SA-5.5 range.

## Evidence baseline

| Layer | Method | Result |
|---|---|---|
| Automated tests | `npm test` | **Pass** — 368 tests, 0 failures |
| TypeScript | `npm run typecheck` | **Pass** (exit 0) |
| Lint | `npm run lint` | **Pass** (exit 0) |
| Build | `npm run build` | **Pass** (exit 0) |
| Migrations, parse | `npm run db:check` | **Pass** — every file parses |
| Migrations, replay | `npm run db:check:deep` | **Fail** — 155 problems; the chain cannot build a database from nothing (backlog #29) |
| Feature catalog | `npm run check:features` | **Pass** — 28 active features, menu/API coverage checked against the live project |
| RPC contract | `npm run verify:rpc-contract` | **Fail** — of 131 RPCs the app calls, **27 exist and 104 do not** |
| Supabase inventory | `npm run qa:inventory` | 308 tables, 13 views, 135 non-extension functions |
| Admin surface matrix | `npm run qa:sa-matrix` | 34 static API routes + 28 screens × 6 sessions, read-only |
| Authenticated browser | Fresh super-admin login with TOTP, desktop + tablet/mobile widths | Dashboard, tenant directory, audit log, search/status filters, mobile drawer |

### The role matrix could not be completed

The current live count is **7 admin rows: 5 active and 2 deactivated disposable QA rows**. The
active rows are 4 × `super_admin` and 1 × `platform_config`; the deactivated rows cover one
`support_agent` and one `billing_admin`. Support was exercised in a browser; billing remains
browser-unverified because its TOTP attempt failed. Their behaviour is not assumed safe.

Tenant-plane roles were exercised as `owner` and `assistant` (the restricted member).

Rows after SA-0.3 retain the previous audit's evidence until their own sequential batch is run.
They are not being reclassified from the current first-batch results.

### Authorization boundary — verified, and it holds

From `qa-sa-matrix`, read-only GET probes:

- **Anonymous:** every protected admin API returned `401` and every protected screen redirected.
  The single anonymous `200` is `/admin/login`, which is correct. **No anonymous leak.**
- **Tenant cookie against the admin plane:** `401` on every admin API. The planes do not
  interchange — corroborated cryptographically by `lib/tenantAuth/sessionSeparation.test.mjs`
  (different signing secrets, so a cross-plane cookie fails signature verification).
- **`platform_config` vs `super_admin`:** genuine differentiation. `403` on `activity`, `admins`,
  `coupons`, `credit-notes`, `feature-switches`, `invoices`, `offers`, `payments/status`, `plans`,
  `subscriptions`, `tenants`, `users`, `users/stats`; `200` on `audit-log`, `carriers`, `features`,
  `me`, `products`, `settings`, `system`, `templates`. This matches the intended split.

## Historical live failures observed on 2026-09-11

The following table is retained as historical evidence from the prior schema snapshot. It is not a
current claim: the focused 2026-09-12 reconciliation confirmed that the tenant-provisioning,
admin-user, feature-catalog, plan, entitlement and subscription objects now exist. Each later task
must still be rechecked against the current live project before it receives a new verdict.

Seven admin APIs and six screens return `500`. Every one is a missing database object:

| Surface | Error |
|---|---|
| `/api/admin/users`, `/api/admin/users/stats`, `/admin/users` | `public.admin_user_list` absent (confirmed in the browser console) |
| `/api/admin/plans`, `/admin/plans` | `public.plans` absent |
| `/api/admin/subscriptions`, `/admin/subscriptions` | `public.subscriptions` absent |
| `/api/admin/offers`, `/admin/offers` | offers backing tables absent |
| `/api/admin/credits-limits`, `/admin/credits-limits` | `public.credit_packs` absent |
| `/api/admin/compliance-vendors`, `/admin/compliance-sources` | `public.compliance_vendors` absent |

**Diagnosability finding.** `credits-limits` and `compliance-vendors` return the real cause.
`users`, `plans`, `subscriptions` and `offers` return only `"Could not load X"`, discarding the
underlying message. The second pattern makes a missing table indistinguishable from a permission
problem or a network fault.

**Silent-empty finding.** `/api/admin/features` returns `200` with `groups: []` although
`public.features` does not exist. A missing catalog is presented as an empty one, so SA-2.1 looks
built-and-unused rather than broken. This is worse than a 500.

## Surfaces returning real data

`settings` (4 stored rows; 7 registry keys including coded defaults) · `templates` (1) · `products` (6) · `carriers` (8) · `tenants` (6) ·
`feature-switches` (24) · `audit-log` (14 entries, 14 total) · `activity` (40 events) ·
`admins` (3) · `payments/status` (sandbox mode, API key shown fingerprinted as `••••623f`,
webhook secret present but not exposed).

## The matrix

### M0 — Foundation

| Task | Notion | Verdict | Evidence |
|---|---|---|---|
| SA-0.1 Admin auth + super_admin role | Completed | **Partial** | Fresh browser login required and accepted a locally generated authenticator code; `/api/admin/me` then returned the authenticated admin context. Dashboard and mobile shell rendered without console/framework errors. Anonymous admin APIs returned 401; `platform_config` was denied on super-admin-only routes. **Open:** no live support-agent or billing-admin fixture, session-expiry proof, fresh-install seed proof, and full browser evidence for the TOTP step |
| SA-0.2 Tenant & user data model | Completed | **Partial** | `tenants`, `tenant_users`, `users`, and `create_tenant_with_owner` are present in the live project. The namespaced tenant-isolation, membership-lookup, and role verifiers passed cross-tenant read/write denial checks; the admin tenant directory rendered live data and mobile/tablet layouts. **Open:** complete browser proof for tenant-user sessions and an exhaustive all-operational-table RLS inventory before SA-0.4 |
| SA-0.3 Audit log | Completed | **Partial** | Fresh `/admin/audit-log` rendered persisted events with actor/action/target/date controls. The live `audit_log_append_only` trigger and existing platform trigger rejected update/delete attempts; `audit_log` grants are now limited to `service_role` for application writes. **Open:** exactly-one audit event for every SA-1–SA-3 mutation, malformed/failed-write authenticated workflows, and full admin-role coverage |
| SA-0.4 M0 hardening & follow-ups | Backlog | **Partial** | Narrow grant hardening and live audit-log verification are implemented. **Open:** the fresh 2026-09-14 inventory reports 85 policyless RLS tables, 7 client-executable security-definer functions, and 3 RLS-disabled tables; the older advisor snapshot also reports 39 mutable search paths and leaked-password protection disabled. CI, session-expiry, failed-login/2FA visibility, active support/billing role coverage, and narrow-width audit UX evidence remain open. The Next.js middleware convention is migrated locally to `proxy.ts`. |

### M1 — User administration

The current live project contains the user-directory and lifecycle objects. The historical
absence finding below is retained only as superseded evidence from the earlier checkout.

| Task | Notion | Verdict | Evidence |
|---|---|---|---|
| SA-1.1 Users list, search & counts | Completed | **Partial** | Current `/admin/users` live directory, database-computed counters, pagination, search, empty state, and authenticated browser evidence are recorded above. 5,000-user performance and populated suspended-filter proof remain open. |
| SA-1.2 Create user | Completed | **Database-misaligned** | Auth-first provisioning, invitation, duplicate protection, resend, and owner protection remain implemented. New-tenant creation requires the plan-aware `admin_attach_user_to_tenant_with_plan` RPC for atomic subscription attachment; the live project reports that function absent from its schema cache. The route returns a safe `tenant_provisioning_unavailable` 503 and compensates the Auth identity. The reviewed additive migration, plan-linked invite-to-login, and mobile browser proof remain open. |
| SA-1.3 Edit user & change role | Completed | **Partial** | Current name/role editing, old/new audit metadata, owner guard, and browser evidence are recorded above. Email confirmation, password reset, and next-request tenant-role proof remain open. |
| SA-1.4 User state lifecycle | Completed | **Partial** | Lifecycle routes, server-side reason validation, session-version invalidation design, and the intentional delete descoping are recorded above. Fresh suspend/unsuspend browser evidence remains open. |
| SA-1.5 Login activity & last-login | Completed | **Partial** | Current `/admin/activity` live browser evidence includes successful and failed attempts, aggregates, and pagination. 50,000-row timing, failed-login comparison, and mobile evidence remain open. |

### Current M2 reconciliation — SA-2.1 through SA-2.3 (2026-09-12)

This batch was audited against the live shared project, the current routes, focused verifiers, and
authenticated admin browser screens. The batch is not fully accepted: the implementation is live,
but the full authenticated cross-tenant mutation matrix and complete mobile evidence are still
missing.

| Task | Notion | Current verdict | Evidence and remaining gap |
|---|---|---|---|
| SA-2.1 Feature catalog | Completed | **Partial** | Live catalog has 28 features in 9 ordered modules. `npm.cmd run check:features` passes, archive/restore routes are role-protected, and the authenticated catalog now supports search, module filtering, and plan/add-on reference counts. Full archive/restore mutation proof and mobile evidence remain open. |
| SA-2.2 Plan CRUD + plan type | Completed | **Partial** | Authenticated `/admin/plans` and the version editor render live Basic/Pro/Advance plans, immutable-version messaging, yearly pricing, subscriber counts, and archive/delete actions. A live integrity defect was fixed by `20260912480000_sa_2_2_repair_individual_plan_limit_trigger.sql`; `verify:plan-version` now passes. Published-version mutation, subscriber grandfathering, and full lifecycle/browser evidence remain open. |
| SA-2.3 Feature picker | Completed | **Partial** | Authenticated plan editor renders grouped feature checkboxes, select-all/clear-all controls, zero-feature prevention, and an “Agent will see” preview. `verify:entitlements` passes for Basic/Pro/Advance. Exact save/publish mutation evidence and affected-subscriber preview evidence remain open. |

Batch evidence:

- `npm.cmd test`: **Pass** — 368 tests, 0 failures.
- `npm.cmd run typecheck`, `npm.cmd run lint`: **Pass**.
- `npm.cmd run verify:plan-version`: **Pass** after repairing the missing live individual-plan
  seat trigger.
- `npm.cmd run verify:entitlements`: **Pass** — Basic 5, Pro 16, Advance 26; suspended read-only
  and cancelled behavior included.
- `npm.cmd run check:features`: **Pass** — live catalog, menu coverage, and feature-bearing API
  coverage agree.
- `npm.cmd run qa:inventory`: **Pass** read-only inventory — 391 tables, 18 views, 300 functions,
  0 RLS-disabled tables, 86 policyless RLS tables, and 0 custom-inventory client-executable
  security-definer or mutable-path findings. The Supabase advisor discrepancy remains tracked
  under SA-0.4.
- Authenticated browser: fresh super-admin session loaded `/admin/features`, filtered the catalog
  by “dialer”, showed reference counts, and loaded `/admin/plans/<id>/edit` with grouped picker and
  agent preview. No framework error was observed. Mobile viewport and full mutation replay remain
  unverified.

The live SA-2.1–SA-2.3 database contract is now confirmed as `features`, `feature_modules`, `plans`,
`plan_features`, `plan_limits`, `plan_prices`, `subscriptions`, and `tenant_entitlements`. Current
live counts are 28 features, 9 modules, 3 plan rows, 47 plan-feature rows, 3 plan-limit rows, 3
plan-price rows, 6 subscriptions, and 20 tenant-entitlement rows. The `plans_individual_defaults`
trigger is present with an empty `search_path` after the additive repair migration.

### Current M2 reconciliation — SA-2.4 through SA-2.6 (2026-09-12)

This batch was rechecked against the live shared Supabase project, focused scripts, current admin
routes, and an authenticated super-admin browser session. The batch is not fully accepted: the
core pricing/meter/add-on calculations are now aligned, but catalog management and the complete
authenticated mutation/mobile evidence are still open.

| Task | Notion | Current verdict | Evidence and remaining gap |
|---|---|---|---|
| SA-2.4 Pricing and billing cycles | Completed | **Partial** | `public.plan_prices` is live with 3 rows and integer-cent monthly/quarterly/yearly columns. `/admin/plans` and the authenticated version editor render prices and cycle-aware values. Unit/proration tests pass. Full save/publish mutation replay, annual browser proof, and mobile evidence remain open. |
| SA-2.5 Limits, meters, and usage | Completed | **Partial** | Live `meters` (6), `plan_limits` (3), `usage_events` (4), and `usage_totals` (38) are RLS-protected. Meter catalog/plan-limit UI renders through `/admin/credits-limits`; `check_meter_capacity` and `record_usage` are service-only. The SA-2.6 live regression found and repaired a resolver/enforcement drift with `20260912500000_sa_2_6_repair_addon_entitlement_resolution.sql`; `verify:addon-meters` now passes. The older `verify:credits-limits` suite still fails on monitor/fixture assumptions and needs a dedicated contract refresh. |
| SA-2.6 Add-ons | Completed | **Partial** | Add-on catalog, feature/meter joins, plan availability, and soft-detached subscription attachments are live with RLS and FK constraints. Add-on credits now stack in both live resolver and enforcement, and detached credits disappear. `/admin/addons` is currently read-only; catalog create/edit/archive/restore and feature/meter assignment controls are not complete. Full authenticated attach/detach replay and mobile evidence remain open. |

Batch evidence:

- `npm.cmd run verify:addon-meters`: **Pass** — plan allowance, add-on stacking, resolver/enforcement
  agreement, and detachment all pass against the shared project.
- `npm.cmd test`: **Pass** — 368 tests, 0 failures.
- `npm.cmd run typecheck`, `npm.cmd run lint`, and `git diff --check`: **Pass**.
- `npm.cmd run verify:entitlements`, `npm.cmd run verify:plan-version`, `npm.cmd run check:features`,
  and `npm.cmd run verify:rpc-contract`: **Pass**.
- `npm.cmd run verify:credits-limits`: **Pass for the focused automated/live contract** — route
  authorization, pack lifecycle, pricing, concurrent grants, cached entitlement refresh, monitor
  visibility, purchase-to-grant behavior, audit logging, plan-owned allowance precedence, and the
  bounded shared-population monitor check all pass. SA-4.9 remains Partial overall because browser
  mutation/mobile evidence and the complete cross-tenant matrix are still open.
- Authenticated browser: `/admin/addons`, `/admin/credits-limits`, `/admin/subscriptions`, and the
  plan editor rendered with no console warnings/errors observed. Desktop DOM evidence is present;
  screenshot capture, mobile replay, and mutation replay remain unverified.
- Live inventory after QA: `addons` 5 (four archived namespaced prior fixtures plus current test
  history), `addon_features` 0, `addon_meters` 0, `plan_available_addons` 0, `subscription_addons` 1
  retained detached history row, `plan_meters` 0 after restoration, `usage_events` 4, and
  `usage_totals` 38. Namespaced QA add-ons are inactive; no shared plan rows were left changed.

The current live resolver/enforcement contract is `resolve_tenant_entitlement(uuid)` plus
`check_meter_capacity(uuid,text,integer)`, both service-role executable with an empty search path.
`refresh_tenant_entitlement(uuid)` remains the cache writer and folds active add-ons into the same
`meters` and `features` objects. SA-2.7 and SA-2.8 were continued after this snapshot; their
remaining lifecycle idempotency, cross-tenant mutation, and browser/mobile gaps are recorded below.

### Current M2 reconciliation — SA-2.7 (2026-09-12)

SA-2.7 was exercised against the live shared project after repairing a drifted assignment RPC.
The batch remains **Partial** at the task level because authenticated browser mutation replay,
mobile browser evidence, and screenshot evidence are still open. Durable idempotency is now
implemented and focused replay-tested, and the live tenant boundary matrix has passed.

| Task | Notion | Current verdict | Evidence and remaining gap |
|---|---|---|---|
| SA-2.7 Assign, change, pause, resume, and cancel subscriptions | Completed | **Partial** | `verify:transitions` passes invalid resume/pause rejection, valid pause/resume, archived-plan assignment rejection, and archived-plan change rejection. The additive `20260912510000_sa_2_7_repair_assignment_guard.sql` restored the guarded text-signature `admin_assign_subscription` RPC: archived plans are rejected, existing live subscriptions are not replaced, service role is the only executor, and `search_path` is empty. The additive `20260912520000_sa_2_7_subscription_mutation_idempotency.sql` and `lib/subscriptions/idempotency.ts` now claim, complete, and replay assignment/lifecycle requests by actor-scoped key and request hash. `/admin/subscriptions` rendered live data and its Active filter returned only active rows without console errors. `verify:sa2-tenant-matrix` passes the live tenant boundary checks for subscriptions, add-ons, entitlements, usage, corrections, and admin-plane denial. Authenticated browser mutation replay, mobile, and screenshot evidence remain open. |

SA-2.7 evidence:

- `npm.cmd run verify:transitions`: **Pass** — all invalid and valid transition checks passed.
- Live function inventory: `admin_assign_subscription(uuid,uuid,text,timestamptz)` is security-definer,
  has `search_path=""`, is not executable by `anon` or `authenticated`, and is executable by
  `service_role`.
- Authenticated browser: `/admin/subscriptions` loaded with live rows; the status filter interaction
  produced six active rows and no console warnings/errors. Screenshot, mobile, and mutation replay
  evidence were not captured.
- `npm.cmd run verify:subscription-idempotency`: **Pass** — the first assignment succeeds, a
  repeated key replays the same response without a second subscription, the replay header is
  present, and reuse of a key for a different request is rejected.
- The assignment and lifecycle routes require an `Idempotency-Key` header; the admin subscription
  UI generates one per mutation. The service-only `subscription_mutation_requests` ledger retains
  the request hash and final response for replay.
- `npm.cmd run verify:sa2-tenant-matrix`: **Pass** — two Auth-first disposable tenants were isolated
  in the shared project. Service-only subscription/add-on/usage/mutation tables denied all four
  direct operations; tenant entitlement reads were restricted to the caller's own tenant and all
  entitlement writes were denied; both app sessions resolved only their own tenant; tenant cookies
  were denied at the admin subscription API.
- Remaining gap: authenticated browser mutation replay, mobile, and screenshot evidence have not
  been captured.

### Current M2 reconciliation — SA-2.8 (2026-09-12)

SA-2.8 is **Partial**. The live entitlement resolution, route guards, API guards, role checks,
platform kill-switch behavior, and dedicated tenant boundary matrix were verified. Authenticated
browser mutation replay, mobile browser evidence, and screenshots are still outstanding.

| Task | Notion | Current verdict | Evidence and remaining gap |
|---|---|---|---|
| SA-2.8 Entitlement engine and enforcement | Completed | **Partial** | `verify:entitlements` passes exact Basic/Pro/Advance feature sets, suspended read-only access, and cancelled no-access behavior. `verify:switches` passes off/beta/on propagation, denied-path codes, audit reasons, and validation guards through HTTP. `check:features` passes catalog/menu/API coverage. `guardPage`, `requireFeature`, and `requireFeatureRole` enforce kill switch before entitlement before role/write checks. `verify:sa2-tenant-matrix` passes the live two-tenant isolation matrix: service-only subscription/add-on/usage/mutation tables deny SELECT/INSERT/UPDATE/DELETE, tenant entitlements allow only own-tenant SELECT and deny writes, and tenant sessions cannot call admin subscription APIs. Authenticated browser mutation replay, mobile, and screenshot evidence remain open. |

SA-2.8 evidence:

- `npm.cmd run verify:entitlements`: **Pass** — exact seeded plan feature lists and suspended/cancelled
  access behavior passed against the shared project.
- `npm.cmd run verify:switches`: **Pass** — live HTTP enforcement passed for off, beta allowlist,
  restore without re-login, validation, unauthenticated denial, catalog foreign-key validation, and
  audit coverage. The verifier now uses the supported Auth-first fixture path and probes the feature
  that `/api/app/policies` actually guards.
- `npm.cmd run check:features`: **Pass** — active catalog, menu references, and feature-bearing API
  guard coverage agree.
- `lib/features/killSwitch.ts` now reads the small safety-control table directly per request. The
  prior in-memory cache could survive an admin toggle across route bundles, so the change removes
  that stale-access window and keeps the invalidation hook for compatibility.
- Authenticated browser: `/admin/subscriptions` loaded and its Active filter returned only active
  rows without console warnings/errors. Mobile, screenshot, and full mutation replay evidence remain
  unverified.

### Current M3 reconciliation — SA-3.1 through SA-3.9 (2026-09-13)

The earlier M3 table below is a historical snapshot from before the billing objects were reconciled
against the shared project. It is superseded by this current review. The live focused billing suites
now pass after additive compatibility repairs, but the tasks remain **Partial** until the required
authenticated desktop/mobile browser evidence and the SA-3.9 revenue reconciliation gate are
captured.

| Task | Current verdict | Current evidence and remaining gap |
|---|---|---|
| SA-3.1 Payment provider adapter | **Partial** | `verify:payments` passes the Whop-only registry, sandbox adapter behavior, provider-call immutability, and retention checks. Real provider execution remains disabled; authenticated browser evidence is still open. |
| SA-3.2 Invoice generation | **Partial** | `verify:invoices`, `verify:period-billing`, and `verify:annual-invoice` pass invoice idempotency, monthly/yearly line totals, immutability, custom-period rating, add-ons, overage, credits, and empty-period handling. The additive migrations `20260913200000_sa_3_align_billing_rpcs_with_platform_invoices.sql`, `20260913202000_sa_3_repoint_invoice_family.sql`, `20260913210000_sa_3_invoice_lines_assemble_as_draft.sql`, and `20260913220000_sa_3_invoice_line_sign_convention.sql` align the live RPCs with `platform_invoices`. Authenticated browser evidence remains open. |
| SA-3.3 Invoice list/detail and reminders | **Browser-unverified** | `/admin/billing`, `/admin/invoices`, and `/admin/invoices/[id]` exist and use the live platform invoice family. The billing workspace now provides keyboard-focusable navigation across invoice, coupon, refund/credit, and revenue surfaces. Fresh populated desktop/mobile browser evidence and the requested invoice-reminder visibility workflow were not verified in this pass. |
| SA-3.4 Record payment and activate | **Partial** | `verify:events`, `verify:webhook`, `verify:webhook-invoicing`, and `verify:payments` pass signed webhook handling, duplicate delivery, payment recording, success activation, failure-to-`past_due`, stale-event protection, durable failure recording, and disabled live mode. Webhook state transitions now use service-only RPCs from `20260913241000_sa_3_4_webhook_state_rpcs.sql`; browser evidence remains open. |
| SA-3.5 Missed payment / provider dunning | **Cancelled** | Provider-owned dunning remains cancelled by product decision. Local access state still responds to provider events. |
| SA-3.6 Discounts and coupons | **Partial** | `verify:coupons` passes redemption caps, duration, expiry, plan/cycle restrictions, atomic invoice consumption, replay, discount lines, and reconciliation. Browser CRUD evidence remains open. |
| SA-3.7 Custom/manual invoices | **Partial** | `verify:custom` passes validation, numbering, issued state, overdue handling, manual settlement, activation, duplicate payment rejection, and audit logging. Browser draft/issue/void evidence remains open. |
| SA-3.8 Refunds and credit notes | **Partial** | `verify:credits` passes refund validation, threshold/second-admin approval, self-approval denial, failed execution retention, invoice immutability, credits, replay, numbering, and audit logging. The approval path now uses the service-only `approve_credit_note` RPC from `20260913240000_sa_3_8_credit_note_approval_rpc.sql`; browser evidence remains open. |
| SA-3.9 Revenue dashboard | **Partial** | `/admin/revenue`, `metrics_daily`, and `compute_metrics_for_date` exist. No dedicated live revenue reconciliation verifier or authenticated populated desktop/mobile evidence was completed, so revenue figures are not accepted as fully verified. |

Current focused results: `verify:payments`, `verify:invoices`, `verify:custom`, `verify:coupons`,
`verify:credits`, `verify:period-billing`, `verify:events`, `verify:webhook`, and
`verify:webhook-invoicing` pass. Repository typecheck and lint pass; a fresh production build was
not rerun because the user-owned Next dev server currently holds `.next/dev/lock`.

### Historical M2 snapshot — superseded

**The entire module is unbackable.** `plans`, `plan_versions`, `plan_features`, `plan_limits`,
`plan_prices`, `subscriptions`, `features`, `feature_modules`, `addons`, `meters`, `usage_events`
and `usage_totals` are all absent.

| Task | Notion | Verdict | Evidence |
|---|---|---|---|
| SA-2.1 Feature catalog | Completed | **Database-misaligned** | `public.features` absent; the API masks it as an empty catalog (200, `groups: []`) |
| SA-2.2 Plan CRUD + plan type | Completed | **Database-misaligned** | `/api/admin/plans` 500; `public.plans` absent |
| SA-2.3 Feature picker | Completed | **Database-misaligned** | `plan_features` absent; unreachable behind SA-2.2 |
| SA-2.4 Plan pricing & billing cycle | Completed | **Database-misaligned** | `plan_prices` absent |
| SA-2.5 Plan limits & metered credits | Completed | **Database-misaligned** | `plan_limits`, `meters`, `usage_*` absent |
| SA-2.6 Add-ons | Completed | **Database-misaligned** | `addons`, `plan_available_addons`, `subscription_addons` absent |
| SA-2.7 Assign, change & cancel subscription | Completed | **Database-misaligned** | `/api/admin/subscriptions` 500; `subscriptions` absent, as are all four `admin_*_subscription` RPCs |
| SA-2.8 Entitlement engine & enforcement | Completed | **Database-misaligned** | `tenant_entitlements` exists with 6 cached rows and the agent app reads them correctly — but `plans` and `subscriptions`, the source those rows derive from, do not exist. **The cache has no producer.** This is why `npm run verify:entitlements` cannot resolve a suspended subscription |

### M3 — Billing & payments

| Task | Notion | Verdict | Evidence |
|---|---|---|---|
| SA-3.1 Payment provider adapter | Completed | **Partial** | `/api/admin/payments/status` returns `200` in **sandbox** mode with a fingerprinted key and a health block. No real payment integration is enabled, as required. Provider behaviour itself not exercised |
| SA-3.2 Invoice generation | Completed | **Database-misaligned** | `invoices` exists (0 rows) but `create_invoice_for_payment_with_coupon` and `bill_subscription_period` are absent, so nothing can generate one |
| SA-3.3 Invoice list & detail screens | Completed | **Browser-unverified** | `/api/admin/invoices` returns `200` with an empty list; list and detail screens exist. With no invoice able to exist, the populated state cannot be shown |
| SA-3.4 Record payment → auto-activate | Completed | **Database-misaligned** | `payments` absent |
| SA-3.5 Missed payment → auto-suspend | **Cancelled** | **Cancelled** | Descoped in Notion; no implementation expected |
| SA-3.6 Discounts & coupons | Completed | **Database-misaligned** | API returns `200` empty; `coupons` and `subscription_coupons` absent, `admin_apply_coupon` absent |
| SA-3.7 Custom / manual invoice | Completed | **Database-misaligned** | `create_custom_invoice` absent |
| SA-3.8 Refunds & credit notes | Completed | **Database-misaligned** | API returns `200` empty; `credit_notes` absent and all six credit-note RPCs missing |
| SA-3.9 Revenue dashboard | Completed | **Database-misaligned** | `compute_metrics_for_date` absent; depends on `subscriptions` and `payments` |

### M4 — Configuration

The healthiest module. Four tasks have live, populated evidence.

| Task | Notion | Verdict | Evidence |
|---|---|---|---|
| SA-4.1 Global settings store + shell | Completed | **Database-misaligned** | `/api/admin/settings` returns 7 keys by combining 4 live `public.settings` rows with 3 coded defaults. The additive `20260914182000_sa_4_1_settings_registry_completion.sql` migration covers the missing defaults; promotion and authenticated persistence evidence remain open |
| SA-4.2 Payment provider configuration | Completed | **Partial** | Config screen backed by `payments/status`; sandbox mode, secrets fingerprinted. Failure simulator not exercised |
| SA-4.3 Configuration Center hub | Completed | **Partial** | `verify:configuration` passes 41 hub, route, role-denial, and anonymous-redirect checks; authenticated desktop/mobile browser evidence remains open. Offer, credits, and compliance-specific live findings are tracked separately |
| SA-4.4 Offers & promotion rules | Completed | **Database-misaligned** | `/api/admin/offers` 500 |
| SA-4.5 Product catalog | Completed | **Pass** | `/api/admin/products` returns 6 products to both entitled roles, `403` to non-entitled, `401` anonymous |
| SA-4.6 Product templates | Completed | **Partial** | `verify:templates` passes live template creation, normalized fields/form shape, duplicate/version/concurrency, archive/restore, and audit checks; authenticated desktop/mobile browser evidence remains open. Historical `template_fields`/save drift is not reproduced by the current compatibility path |
| SA-4.7 Agent template selection & apply | Completed | **Partial** | `verify:agent-templates` passes tenant-copy provenance, isolation, concurrent/idempotent apply, edit, and entitlement filtering against namespaced live fixtures; authenticated desktop/mobile browser evidence remains open |
| SA-4.8 Compliance vendor sources | Completed | **Blocked** | `verify:compliance` passes authentication, role denial, HTTPS validation, credential masking/encryption, health logging, and recovery against live namespaced fixtures; last-enabled-DNC/all-off proof is blocked because pre-existing shared global DNC vendors cannot be disabled safely by QA |
| SA-4.9 Credit packs, limits & usage monitor | Completed | **Database-misaligned** | `public.credit_packs` absent |
| SA-4.10 Global feature kill switches | Completed | **Pass** | `/api/admin/feature-switches` returns 24 live switches, `403` to `platform_config`, `401` anonymous. `lib/features/killSwitchRules.test.mjs` covers the evaluation order that puts kill switches ahead of entitlements |
| SA-4.11 Email & mail server configuration | Completed | **Database-misaligned** | `email_log` absent; `prune_email_log` missing. No real mail sending was enabled |
| SA-4.12 Maintenance mode & announcements | Completed | **Pass** | `/api/admin/system` returns a maintenance object and an announcements array to both entitled roles. The LA-0 shell consumes the same contract |

### M5 — Signup & trial

| Task | Notion | Verdict | Evidence |
|---|---|---|---|
| SA-5.1 Pricing page & self-serve signup | Completed | **Database-misaligned** | `self_serve_signup`, `self_serve_signup_with_subscription` and `claim_rate_limit` all absent. Signup additionally cannot create a user at all |
| SA-5.2 Hosted checkout & trial start | Completed | **Database-misaligned** | `checkout_sessions`, `signup_selections` absent; `create_subscription_from_checkout` missing |
| SA-5.3 Trial management | Completed | **Database-misaligned** | `trial_reminders` absent; `extend_trial` missing |
| SA-5.4 Terms & privacy acceptance | Completed | **Database-misaligned** | Local signup/re-acceptance now uses the atomic service-only `record_legal_acceptances` contract (`20260914183000_sa_5_4_atomic_legal_acceptances.sql`), with append-only/idempotent rows. The live batch RPC is not promoted, legal signup/re-acceptance browser proof is open, and final legal copy still needs approval |
| **SA-5.5** | — | **N/A** | No such task exists in the inventory |

## Historical verdict counts (SA-0.1 – SA-5.5, 43 entries)

| Verdict | Count |
|---|---|
| Pass | 4 |
| Partial | 9 |
| Database-misaligned | 26 |
| Browser-unverified | 1 |
| Deferred | 1 |
| Cancelled | 1 |
| N/A | 1 |

Out of range, for completeness: SA-6.1, SA-6.2, SA-6.3 — **Deferred** (Notion `Planned`).

## Historical root cause note

The 2026-09-11 inventory found a generation mismatch between the repository and the shared
database. That finding is retained for history in `docs/qa/LA-0-BLOCKERS.md`, but it is no longer
the current SA-0.2/SA-2 schema state: the shared project has since received additive SA migrations,
including the tenant-provisioning, feature-catalog, plan, entitlement and user-management objects.
The current remaining schema/security findings are documented above and in `security.md`; they are
not silently treated as resolved merely because the newer objects exist.

## Baseline QA reconciliation — 2026-09-13

The complete baseline audit is recorded in [`docs/qa/SA-0.1-SA-5.5-QA-AUDIT.md`](../qa/SA-0.1-SA-5.5-QA-AUDIT.md).
The 63-of-73 aggregate result below is a historical 2026-09-13 snapshot. The current repository
regression gate is 499/499 unit and contract tests, while live migration/grant/index drift, shared
DNC fixture state, aggregate-load timing, and Whop provider mapping remain tracked in the current
master register.

The audit keeps SA-0.1 through SA-5.4 at Partial/Blocked/Database-misaligned classifications where
complete authenticated browser evidence or live schema proof is missing. SA-3.5 remains Cancelled
and SA-5.5 remains N/A because no such task is defined. Focused fixes made during this pass include
Auth-first owner enforcement at the API boundary, announcement title/FK compatibility, bounded
usage-monitor fallback, old-RPC phone-dedupe compatibility, offer-precedence and transfer-inbox
indexes, and the definer search-path repair; the corresponding migrations are not live-applied
because the configured database role lacks DDL authority.

The consolidated remediation queue is [`docs/qa/MASTER-GAP-BLOCKER-REGISTER.md`](../qa/MASTER-GAP-BLOCKER-REGISTER.md).
On 2026-09-13 the read-only `qa:sa-matrix` verifier was corrected to fail closed when the local
application is unreachable or required role sessions are missing. This prevents an all-error probe
run from being mistaken for successful authorization coverage.
The matrix now provisions only clearly namespaced verification-admin rows when a required role is
absent, deactivates those rows in `finally`, times out individual probes, and exercises each route
against all available roles concurrently. The final live run exercised all six required sessions,
35 static admin APIs, and 29 screens with zero 5xx responses, zero transport errors, zero missing
sessions, and zero protected anonymous 200 responses. The credits/limits compatibility fallback was
also narrowed to omit tenants with no subscription, usage, or credit grant; its measured local
response dropped from approximately 42 MB to 421,878 bytes.

## Focused remediation update — 2026-09-14 (current)

The current working-tree remediation pass reran the following focused workflows after the live-compatible
tenant count and entitlement-cache fixes:

| Area | Result | Evidence and remaining boundary |
|---|---|---|
| LA-1.1 partners | Focused pass | `verify:partners` passes lifecycle, tenant isolation, and role checks; authenticated browser evidence remains open. |
| LA-1.2 partner users | Focused pass | `verify:partner-users` passes invitation/deactivation/isolation checks; browser evidence remains open. |
| LA-1.3 partner products | Focused pass | `verify:partner-products` passes product access and lifecycle checks; browser evidence remains open. |
| LA-1.11 verification | Focused pass | `verify:verification` passes all checks, including correction audit and hostile input; browser evidence remains open. |
| LA-1.13 deal flow | Focused pass | `verify:deal-flow` passes; aggregate failures were stale entitlement results. |
| LA-1.14 buffer handoff | Focused pass | `verify:buffer-handoff` passes atomic acceptance, idempotency, timeout, and isolation checks. |
| LA-1.15 agent floor | Focused pass | `verify:agent-floor` passes; browser evidence remains open. |
| LA-1.18 partner quality | Focused pass | `verify:partner-quality` passes all 17 checks after aligning the fixture with PostgreSQL UTC date semantics. |
| LA-1.19 subscription limits | Focused pass | `verify:subscription-limits` passes; browser evidence remains open. |
| LA-1.5/1.6/1.7/1.8 screening-dependent flows | Browser-unverified | Live `verify:screening`, `verify:partner-submission`, and `verify:affiliate` now pass screening, fail-closed outage handling, TCPA precedence, replay, and concurrency checks. Authenticated browser evidence remains open. |
| LA-1.4 conditional form parity | Implementation and automated pass; browser-unverified | Admin preview, agent form, and partner form now share conditional visibility and stable hidden-value pruning in `lib/templates/visibility.ts`; `lib/templates/visibility.test.mjs` passes 4/4, the partner accessibility contract passes, and the full suite passes 523/523. Side-by-side authenticated browser comparison remains open. |
| SA-4.4 offers | Database-misaligned | Live `apply_auto_offer_to_subscription` remains the old broad-offer ordering; reviewed local additive repair is not applied. |
| LA-1 database security | Focused pass | Live `render_disposition_note` now has `search_path=pg_catalog`, and `agent_leads_tenant_compat`/`lead_queue_tenant_compat` now use initplan-wrapped tenant settings after `la_1_tenant_policy_initplans`; `verify:la1-security` passes. Remaining LA-1 gaps are authenticated browser/provider/deployment evidence, not this database repair. |
| LA-1.24 existing-customer preflight | Focused pass | Live migration `la_1_24_preflight_candidate_indexes` adds tenant-scoped exact phone/DOB and trigram candidate indexes before the existing `.45` scorer; two consecutive 20,000-contact focused runs pass. The function remains security-definer and service-only. |
| Transfer inbox | Focused pass | Correctness, isolation, claim, audit, 500-row timing, and tenant-scoped cross-agent invalidation pass after the live index, bundle RPC, empty-handoff fast path, and inbox Realtime subscription. |
| LA-1 migration replay guards | Focused pass | The LA-1.21/22 collision guard no longer depends on a legacy CRM row count, and the LA-1.9 disposition seed skips the colliding bigint CRM table unless UUID-keyed application tables are present; both targeted deep migration checks pass. |

These results update implementation evidence only. Tasks requiring authenticated browser evidence remain
`Browser-unverified` or `Partial` until a real role session is exercised at desktop and mobile widths.

## LA-1 verification recheck — 2026-09-15

After the partner-field accessibility repair, the preceding required `npm run verify:la1` aggregate
completed all 27 suites after its bounded retry. The first shared development-server attempt had
only the LA-1.10 timing/invalidation checks over budget (1,671 ms and 1,883 ms); the runner retried
that suite and it passed at 983 ms with tenant-scoped invalidation. The strict timing assertion
remains unchanged.

The fresh shared-development aggregate recheck again produced timing-only LA-1.10 and LA-1.24
results: the inbox measured 1,060 ms and its bounded retry 1,007 ms, while the 20,001-contact
pre-flight fixture measured 591.2 ms and 715.5 ms. All correctness assertions passed. Isolated
clean-production reruns passed the inbox at 995 ms with tenant-scoped invalidation and passed the
20,000-contact pre-flight check under 500 ms. The strict gates remain unchanged; these shared-run
measurements are retained as runtime contention evidence.

The authenticated desktop browser recheck then exercised the existing agent and partner-user
accounts without mutations. Agent `/app/dashboard`, `/app/leads`, `/app/floor`, `/app/inbound`, and
`/app/partner-chat` rendered their expected ready, entitlement-error, empty-state, filter, channel,
and alert-settings surfaces. Partner-user `/partner/submit-lead`, `/partner/pipeline`,
`/partner/messages`, and `/partner/settings` rendered the no-approved-products, empty-pipeline,
disabled-send, and partner-user-permissions states. This confirms authenticated routing and role
guidance, but not populated submission, conditional fields, screening, provider delivery, or
notification permission/click-through.

The preceding complete aggregate passed 26/27 suites. LA-1.10 alone exceeded the one-second shared
development-server budget at 1,332 ms and 1,025 ms on its bounded retry, while its Realtime check
passed on retry. All other LA-1 task suites and database-security checks passed. The focused clean
production transfer-inbox runs remain green at 954 ms and 890 ms with tenant-scoped invalidation;
the strict assertion is retained and the aggregate difference is recorded as shared-server/runtime
contention.
The subsequent bounded clean-production rerun passed all transfer-inbox checks at 972 ms, including
the tenant-scoped Realtime event under one second. Live function inspection confirmed that the
deployed runtime-compatibility migration already applies state and screening filters before the
500-row limit; no redundant replacement migration was retained or applied.

The clean local production-server rerun separates application behavior from the hot-development
server and shared remote timing. `verify:partner-users`, `verify:screening`, and the focused
`verify:partner-pipeline` rerun pass; `typecheck`, `lint`, and `build` pass. The live expiry-sweep
index, service-only inbox-bundle RPC, and empty-handoff fast path now produce 892 ms, 966 ms, and
853 ms on three developer-server runs, followed by 954 ms and 890 ms on clean local production
reruns for the 500-row inbox target. The canonical development aggregate completed 26 of 27
suites; only LA-1.10 exceeded the one-second budget under shared hot-server load, so that result is
retained as environment/performance evidence. Correctness, isolation, claiming, audit, and the tenant-scoped
cross-agent invalidation check passed; the inbox now reloads on the same `floor_changed` signal used
by Agent Floor. The partner-pipeline Realtime verifier records subscription status and retries once
with a fresh subscription/write after a transient missed event while retaining the event requirement.
The alert panel's unsupported-notification state was hardened to explain the limitation and keep
in-app toasts available; the focused alert suite and production build pass. Permission delivery and
click-through remain browser-unverified.
After the LA-1.24 candidate-index repair, the complete aggregate again passed 26 of 27 suites; the
only red result was LA-1.10 under shared development-server load (1,035/1,120 ms first pass and
1,008/1,030 ms bounded retry). A clean production-server `verify:transfer-inbox` run passed at
956 ms with Realtime, while the live PostgreSQL inbox plan remains approximately 62 ms. This is
retained as runtime/deployment-like contention evidence, not a correctness failure.
The targeted Codex Security diff review recorded zero reportable findings for the LA-1 authorization,
tenant-boundary, Realtime, RPC, idempotency, and notification changes. Broader unrelated working-tree
changes were explicitly left as deferred coverage rather than represented as reviewed.

Authenticated browser smoke QA covered tenant and partner pages at desktop and 390px mobile widths:
the exercised pages had no console errors or horizontal overflow, empty states were readable, and
partner pipeline Board/Table switching worked. The current partner account has no approved product,
so conditional form rendering and partner submission remain unverified. Browser notification
permission/click-through and deployment-like timing remain open; the in-app browser reports the
`Notification` API as unsupported and exposes no permission-grant capability. No status was
promoted based on static code evidence alone.

The smoke pass also covered `/app/floor` plus `/app/partner-quality`, `/app/deal-flow`, `/app/duplicates`,
`/app/lapse-risk`, `/app/true-cpa`, `/app/policies`, `/app/publishers`, and `/app/assignments` at
both desktop and 390px mobile widths. All reached their authenticated surfaces without console
errors or horizontal overflow; this does not substitute for populated-state or mutation evidence.
The fresh `/app/floor` desktop DOM additionally showed `Realtime subscribed`, `Waiting 0`,
`Callbacks due 0`, `On calls 0`, and `Available 11`; populated transfer, active-call, and nudge
evidence remains open. At 390x844 it exposed `Loading Agent Floor…` before settling, with body and
document widths of 375px and no console errors.
Keyboard smoke on the authenticated partner-quality route reached the menu, alerts control, and
upgrade link with visible focus outlines and accessible names; no browser errors were emitted.

The subsequent clean-production focused recheck also passed `verify:dynamic-forms`,
`verify:partner-submission`, `verify:verification`, `verify:partner-quality`, and
`verify:agent-alerts`. Those green functional and database results do not close the browser-only
conditional-form comparison, notification permission/click-through, or deployed timing findings.
The LA-1.2 verifier now handles a non-JSON response as a controlled assertion with bounded response
details; its patched production run passes, while the stale dev-server 404 remains environment-only
evidence.

The partner authentication route now shares the persistent login-protection gate with the tenant and
admin login routes. Invalid credentials and invalid membership status record failures, successful
authentication clears them, and the clean local production `verify:partner-users` run passes the full
LA-1.2 lifecycle, isolation, invite, concurrency, revocation, and audit suite. The same verifier now
proves the endpoint-level 401-to-429 transition, `Retry-After`, persistent email/IP/lockout
counters, and successful-login lockout clearing. The verifier uses reserved namespaced IPs so
repeated runs do not consume a shared caller bucket. Provider email delivery is intentionally not
claimed; the verifier records the configured `email_delivery_disabled` outcome.

The LA-1.20 append-only migration's grant assertions were also hardened to use PostgreSQL's
`has_table_privilege` function rather than the restricted-role view
`information_schema.role_table_grants`. The full read-only migration parse and
`verify:la1-security` both pass after that correction; no shared state was changed.

## Focused reconciliation — LA-2.10 callback counting — 2026-09-14

The earlier audit described the overdue callback counting surface as missing. The current checkout
contains the callback calendar route and component, which render separate Due today, Overdue, and
Open callbacks counts. `npm.cmd run verify:callbacks` passes 20 focused checks covering the callback
API, customer-local timezone conversion, overdue visibility/counting, tenant isolation, invalid
input, lifecycle changes, immutable history, and idempotency. LA-2.10 therefore has no remaining
focused server/data defect known, but remains Browser-unverified until authenticated desktop and
mobile evidence is captured.

## Continuous remediation update — LA-2.9 dialer — 2026-09-14

The active checkout was re-read after the historical QA artifact described the dialer as absent.
`/app/dialer` and `components/app/dialer-workspace.tsx` are present. The screen now shows the
server-backed eligibility decision, customer local time/timezone, consent certificate state and age,
required disclosure, rebuttals, and recent attempt history. The click route waits for the server
calling-window, internal suppression and fresh DNC checks before opening `tel:`; gate errors retain
stable HTTP statuses.

One functional defect was verified and corrected in the working tree: disposition completion no longer
updates only `tenant_call_attempts`. Attempts are attached to the currently claimed `lead_queue` item,
and the service calls the additive transactional `complete_existing_dial_disposition` function so the
attempt, lead, queue, suppression, and audit records move together. The migration is not claimed as
live-applied because the configured database role lacks DDL authority; until the schema owner applies
it, the service returns a controlled unavailable response rather than creating a limbo outcome.

Still open for LA-2.9: authenticated desktop/mobile browser evidence, keyboard-only loop evidence,
selection-reason rendering from `serve_next_lead`, and live migration/RPC proof.

## SA-2.6 catalog remediation — 2026-09-14

The read-only gap is addressed in the current checkout. `/admin/addons` now has a responsive
editor for code, price, billing cycle, archive/restore state, feature grants, meter credits, and
plan availability. `POST /api/admin/addons` and `PATCH /api/admin/addons/[id]` require the existing
platform plan-management permission and send configuration through the additive
`20260914110000_sa_2_6_addon_catalog_admin_rpc.sql` transaction boundary. The RPC validates
catalog references, prevents code renames, and refuses grant/meter changes while live
subscriptions are attached so current entitlements cannot change silently.

This remains **implemented locally, not fully accepted**: the migration has not been applied to
the shared Supabase project because the current role has no DDL authority. Authenticated live
mutation and mobile evidence therefore remain open. Local schema tests, existing add-on
read/attach/detach and entitlement tests, typecheck, feature scan, and full test suite pass.

## LA-1.5 TCPA rejection remediation — 2026-09-14

The current checkout now includes a pure rejection contract, an idempotent server-side rejected
submission adapter, partner-facing coded/count/neutral-copy UX, audit action, and the additive
`20260914140000_la_1_5_rejected_partner_submissions.sql` migration. Static contract checks pass
2/2, typecheck passes, and the migration parses. The live object has not been applied because the
configured Supabase role lacks DDL authority; authenticated desktop/mobile browser evidence and
live end-to-end partner-quality evidence remain open. Phone-entry timing (decision 9a) is
implemented locally through valid-phone blur screening with an explicit keyboard/retry fallback.

## LA-2 presentation remediation — 2026-09-14

The current checkout now closes two presentation gaps without changing the shared database. The
dialer panel reads the latest tenant-scoped `selection_reason` from `outbound_scoring_decisions` when
that optional table exists and renders it as “Why this lead?”; a missing table or row produces a safe
fallback and does not bypass the compliance gate. The existing Activity & scorecard screen also
loads `/api/app/scorecard` and renders the setter scorecard's show rate beside its coverage, pending
and overdue close-out counts, plus the team roster's local time and shift state when the caller has
team scope.

This is **implemented locally, not fully accepted**. `npm.cmd test` passes 478/478, typecheck, lint,
build, feature scan, and migration parsing pass. The reviewed LA-2 migrations and authenticated
desktop/mobile browser workflows remain open because the current environment has no DDL authority
and no usable direct browser automation session.

## LA-2.11 appointment reminders — 2026-09-14

The local checkout now has an additive reminder claim function and recipient event ledger. The worker
claims upcoming booked/confirmed appointments with `for update skip locked`, renders the appointment
instant in both the customer's recorded timezone and the agent's availability timezone, writes a
deduplicated in-app agent alert, and optionally records customer email delivery through the shared
transport. Email remains disabled by default and reserved test domains are rejected, so this cannot
produce the invalid-address Gmail noise reported during QA.

Reminder links open the related lead at `/app/leads/[id]`; they do not point at `/app/appointments`,
which is the separate carrier-appointment vault.

This is **implemented locally, not fully accepted**. The focused reminder contract tests pass, along
with the repository test/typecheck/lint/build/feature/migration gates. Live migration promotion,
authenticated browser evidence, and external provider delivery remain open.

## LA-2.12 appointment close-out strip — 2026-09-14

The local checkout now mounts `AppointmentCloseOutStrip` on the Activity & scorecard workspace. It
loads only the authenticated tenant's pending appointments, links each item to its lead, and offers
explicit Showed, No-show, and Cancelled actions after confirmation. The GET and POST route is guarded
by the outbound entitlement and owner/producer role boundary; the write delegates the state transition
to `mark_appointment_outcome` and records `tenant.appointment_outcome_recorded`. Loading, empty, retry,
validation, and failure states are present.

This is **implemented locally, not fully accepted**. The new action is covered by the policy registry
and the full local suite passes 493/493, with typecheck, lint, feature scan, and migration parsing
clean. The reviewed view/RPC migration has not been promoted to the shared Supabase project and no
authenticated desktop/mobile browser evidence is claimed.

## LA-2.4 dialer blocked-state UI — 2026-09-14

The final dial action in `components/app/dialer-workspace.tsx` now requires the current server
`eligibility.allowed` result in addition to disclosure confirmation and a phone number. Blocked leads
show “Dialing blocked” plus the server reason through an accessible status description, and the server
still repeats compliance checks before opening `tel:`. This local implementation is covered by the
outbound contract suite; state-statute legal review and authenticated desktop/mobile browser evidence
remain open.

## SA-6 implementation checkpoint — 2026-09-14

SA-6.1, SA-6.2, and SA-6.3 were reconciled against the current task inventory. SA-6.4 has no
authoritative definition in the inventory and is recorded as N/A rather than being invented.

SA-6.1 remains **Partial**. Existing billing-period and unclaimed-lead SLA monitors provide
durable run/heartbeat and escalation behavior, but the specified cross-job `job_runs`/
`job_schedule` contract, Run now control, and 90-day retention were not claimed without the
reviewed scheduler and database contract.

SA-6.2 remains **Partial with safe local implementation verified**. Both login routes now apply
configurable email/IP attempt limits, persistent lockout counters, generic credential responses,
and Retry-After handling before credential lookup. Super Admin Advanced settings expose the
security values and a lockout list with audited manual clearing. The focused `verify:sa6-2`
script passes. Publisher-webhook limiting, the general authenticated-API tenant cap, lockout
email delivery, self-service reset coverage, and full browser/provider timing evidence remain
open and are not represented as complete.

SA-6.3 remains **Blocked**. A safe export/deletion implementation requires an authoritative table
and storage inventory plus approved retention/legal semantics before introducing background jobs or
destructive purge behavior. No destructive path was added or falsely advertised.

| SA task | Current status | Evidence | Remaining boundary |
|---|---|---|---|
| SA-6.1 | Partial | `docs/qa/SA-6-QA-AUDIT.md`; existing SLA monitor and focused verifier | Reviewed generic scheduler/job-run schema, Run now, retention, and authenticated alert delivery |
| SA-6.2 | Partial | `lib/authProtection/index.ts`; `app/api/admin/security/rate-limits/route.ts`; `components/admin/login-protection-panel.tsx`; `verify:sa6-2` | Webhook/general API caps, reset/email contract, browser timing/provider proof |
| SA-6.3 | Blocked | `docs/qa/SA-6-QA-AUDIT.md` | Authoritative schema/storage inventory, legal retention approval, reversible purge design |
| SA-6.4 | N/A | Current task inventory search | No task definition exists |

## LA-0 tenant-plane traceability — current recheck 2026-09-14

| Task | Current implementation/evidence | Current acceptance status |
|---|---|---|
| LA-0.1 | `verify:agent-shell`, `verify:entitlements`, role/session unit tests, and manual dashboard/settings/mobile navigation QA | Pass for the verified shell and entitlement behavior; browser re-login persistence remains unproven |
| LA-0.2 | `verify:tenant-roles`, `verify:tenant-isolation`, `verify:la0-rls`, protected APIs, and focused unit tests | Pass for live role, session, RLS, and isolation evidence |
| LA-0.3 | Dashboard tiles, setup checklist, empty states, and manual desktop/mobile smoke are present | Partial: controlled timing and checklist completion across reload/re-login remain open |
| LA-0.4 | Carrier/product/contract/commission schedule verifier and integer basis-point tests pass; `/app/ledger` renders an honest empty state | Partial: no downstream ledger row exists for a rendered amount trace |
| LA-0.5 | Appointment vault verifier, eligibility tests, 90/60/30 thresholds, audit, idempotency, and responsive appointments UI pass | Partial: provider-backed delivery and renewal silencing evidence remain open |
| LA-0.6 | Contact/household verifier, secondary-phone matching, merge/undo, CSV, isolation, role guards, mobile directory QA, and the 20k benchmark pass | PASS: latest focused verifier passed all 18 checks |

Repository gates for this recheck: 509 tests passed; typecheck, lint, build, feature consistency, and
fast migration parsing passed. The latest focused contact run passed all correctness checks but missed
the LA-0.6 performance threshold. The responsive Appointments correction is in
`components/app/appointment-vault-settings.tsx`; the latest database optimization is
`supabase/migrations/20260914220000_la_0_6_dedupe_phone_marker.sql`.

## LA-2.2 list import — 2026-09-14

The current checkout now normalizes imported phones, dates, states, and timezones; suggests safe
vendor-column mappings; exposes a truthful parser-backed preflight; screens rows before write; and
commits new leads and campaign sources through the reviewed service-only
`import_agent_lead_batch` transaction. The import request remains idempotent through
`agent_lead_import_batches`.

LA-2.2 remains **Database-misaligned** for the live contract. Read-only inspection of the deployed
RPC found that its actor predicate still references `public.users.tenant_id`, which does not exist
in the shared compatibility schema; tenant membership is stored in `public.tenant_users`. The local
repair `20260914193000_la_2_2_import_actor_membership_fix.sql` is covered by a contract test but is
not promoted because the configured Supabase role lacks DDL authority. Usable-row cost accounting,
vendor scrub outcomes in preview, a 20k-row benchmark, live RLS proof, and authenticated browser
evidence also remain open. The live verifier fails closed with `column "tenant_id" does not exist`.
