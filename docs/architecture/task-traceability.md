# INSURVAS Super Admin QA traceability — SA-0.1 … SA-5.5

Recheck date: 2026-09-11
Repository: `C:\Users\Victus\OneDrive\Documents\ChatGPT\Insurvas-git\Insurvas-New`
Database: the existing project configured by `.env.local` (reference deliberately omitted)
Supersedes the 2026-09-11 morning revision of this document.

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
| Automated tests | `npm test` | **Pass** — 323 tests, 0 failures |
| TypeScript | `npm run typecheck` | **Pass** (exit 0) |
| Lint | `npm run lint` | **Pass** (exit 0) |
| Build | `npm run build` | **Pass** (exit 0) |
| Migrations, parse | `npm run db:check` | **Pass** — every file parses |
| Migrations, replay | `npm run db:check:deep` | **Fail** — 155 problems; the chain cannot build a database from nothing (backlog #29) |
| Feature catalog | `npm run check:features` | **Fail** — `public.features` absent |
| RPC contract | `npm run verify:rpc-contract` | **Fail** — of 131 RPCs the app calls, **27 exist and 104 do not** |
| Supabase inventory | `npm run qa:inventory` | 308 tables, 13 views, 135 non-extension functions |
| Admin surface matrix | `npm run qa:sa-matrix` | 34 static API routes + 28 screens × 6 sessions, read-only |
| Authenticated browser | Minted local sessions, desktop + 375×812 | Dashboard, audit log, users error state, mobile drawer |

### The role matrix could not be completed

`admin_users` contains **3 active rows: 2 × `super_admin`, 1 × `platform_config`.** There is no
`support_agent` and no `billing_admin` row, so two of the six requested roles could not be
exercised at all. Creating them is not possible either — user creation is broken project-wide (see
`docs/qa/LA-0-BLOCKERS.md`). Both roles are therefore **Blocked**, not passing, everywhere their
behaviour matters.

Tenant-plane roles were exercised as `owner` and `assistant` (the restricted member).

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

## Live failures observed

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

`settings` (7 rows) · `templates` (1) · `products` (6) · `carriers` (8) · `tenants` (6) ·
`feature-switches` (24) · `audit-log` (14 entries, 14 total) · `activity` (40 events) ·
`admins` (3) · `payments/status` (sandbox mode, API key shown fingerprinted as `••••623f`,
webhook secret present but not exposed).

## The matrix

### M0 — Foundation

| Task | Notion | Verdict | Evidence |
|---|---|---|---|
| SA-0.1 Admin auth + super_admin role | Completed | **Partial** | Authenticated super-admin dashboard renders desktop and mobile. Full anonymous 401/redirect boundary verified across 62 surfaces. Role split `super_admin` vs `platform_config` verified on 20 APIs. Cross-plane rejection verified. **Unproven:** mandatory TOTP was never exercised (sessions were minted, not logged in through), session expiry, and two of four admin roles have no rows to test |
| SA-0.2 Tenant & user data model | Completed | **Database-misaligned** | `tenants` (6), `tenant_users` (14), `users` (21) exist and `/api/admin/tenants` returns them. But `create_tenant_with_owner` — the provisioning RPC `app/api/admin/tenants/route.ts` calls — does not exist, so a tenant cannot be created |
| SA-0.3 Audit log | Completed | **Pass** | `audit_log` and `platform_audit_events` both present. `/api/admin/audit-log` returns 14 entries; the screen renders them with actor, action, target and date filters. `prevent_platform_audit_mutation` is deployed, so append-only is enforced in the database rather than only in code |
| SA-0.4 M0 hardening & follow-ups | Backlog | **Deferred** | Not built, by plan |

### M1 — User administration

Every task in this module depends on objects that are absent. `admin_user_list`,
`admin_create_user`, `admin_update_user_with_email_change`, `admin_set_user_status`,
`admin_replace_user_token` and `admin_user_stats` are all missing.

| Task | Notion | Verdict | Evidence |
|---|---|---|---|
| SA-1.1 Users list, search & counts | Completed | **Database-misaligned** | `/admin/users` renders a graceful error card, not a framework overlay — the error boundary works. Underneath: `public.admin_user_list` absent |
| SA-1.2 Create user | Completed | **Database-misaligned** | `admin_create_user` absent. Independently blocked: no user can be created project-wide |
| SA-1.3 Edit user & change role | Completed | **Database-misaligned** | `admin_update_user_with_email_change` absent |
| SA-1.4 User state lifecycle | Completed | **Database-misaligned** | `admin_set_user_status` absent |
| SA-1.5 Login activity & last-login | Completed | **Partial** | `/api/admin/activity` returns 40 real events and the dashboard shows a last-login date, so the capture path works. `admin_login_activity_stats` is absent, so the aggregate view does not |

### M2 — Subscription management

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
| SA-4.1 Global settings store + shell | Completed | **Pass** | `/api/admin/settings` returns 7 live settings to `super_admin` and `platform_config`, `401` anonymous. The store is real and is what stops constants being hardcoded |
| SA-4.2 Payment provider configuration | Completed | **Partial** | Config screen backed by `payments/status`; sandbox mode, secrets fingerprinted. Failure simulator not exercised |
| SA-4.3 Configuration Center hub | Completed | **Partial** | Hub and its sections render for both entitled roles; several linked sections are themselves 500 (offers, credits, compliance) |
| SA-4.4 Offers & promotion rules | Completed | **Database-misaligned** | `/api/admin/offers` 500 |
| SA-4.5 Product catalog | Completed | **Pass** | `/api/admin/products` returns 6 products to both entitled roles, `403` to non-entitled, `401` anonymous |
| SA-4.6 Product templates | Completed | **Partial** | `/api/admin/templates` returns 1 template. `template_fields` is absent and `admin_save_template` is missing, so the template cannot be edited |
| SA-4.7 Agent template selection & apply | Completed | **Database-misaligned** | `admin_apply_tenant_template` and `admin_update_tenant_template` absent |
| SA-4.8 Compliance vendor sources | Completed | **Database-misaligned** | `public.compliance_vendors` absent — the API says so explicitly |
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
| SA-5.4 Terms & privacy acceptance | Completed | **Database-misaligned** | `legal_documents`, `legal_acceptances`, `current_legal_documents` absent; `record_legal_acceptance` and `outstanding_legal_documents` missing |
| **SA-5.5** | — | **N/A** | No such task exists in the inventory |

## Verdict counts (SA-0.1 – SA-5.5, 43 entries)

| Verdict | Count |
|---|---|
| Pass | 5 |
| Partial | 7 |
| Database-misaligned | 27 |
| Browser-unverified | 1 |
| Deferred | 1 |
| Cancelled | 1 |
| N/A | 1 |

Out of range, for completeness: SA-6.1, SA-6.2, SA-6.3 — **Deferred** (Notion `Planned`).

## Root cause

One cause produces 27 of the 43 verdicts, and it is not application code. See
`docs/qa/LA-0-BLOCKERS.md`: `.env.local` points at a database belonging to a different generation
of the product. Of 131 RPCs the app calls, 27 exist; 106 application functions in that database are
never called by this app and describe a different product (`outbound_*`, `reserve_organization_seat`,
`transition_talent_candidate`, `hr_generate_slug`). The LA-0 compatibility bridge covered only the
LA-0 slice, which is exactly why LA-0 tables are present and the SA plane is not.
