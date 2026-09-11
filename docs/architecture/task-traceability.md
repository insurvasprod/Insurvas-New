# INSURVAS Super Admin QA Traceability

Audit date: 2026-09-11  
Repository: `C:\Users\Victus\OneDrive\Documents\ChatGPT\Insurvas-git\Insurvas-New`  
Database: existing shared Supabase project configured by the repository's `.env.local` (project reference intentionally omitted from this document)

## How to read this audit

Notion status is planning evidence only. A task is `Pass` only when its specification, frontend, backend, database, automated QA, live Supabase behavior, and authenticated browser workflow are all evidenced. Authenticated browser evidence was collected for the Super Admin, Platform Configuration/System Admin, Agent, and Partner User surfaces. The complete role matrix and live mutation matrix remain open where credentials or compatible database contracts were unavailable. The live database was queried without exposing secrets.

Status vocabulary:

- **Partial — browser/live gap:** repository implementation is present, but the required authenticated or live proof is missing.
- **Blocked — schema drift:** the repository expects tables/views/functions that are not present in the configured live schema, so the workflow cannot be accepted safely.
- **Blocked — security gate:** a security or policy finding must be resolved before acceptance.
- **Decision variance:** implementation follows a recorded product decision that differs from the original task text.
- **Cancelled:** explicitly descoped; no implementation is required.
- **N/A:** no task was found in the current task inventory.

## Evidence baseline

| Layer | Evidence collected | Result |
|---|---|---|
| Frontend | 34 admin route files under `app/admin/(protected)` | Broad screen coverage exists; rendering is not acceptance proof |
| Backend | 68 admin API route files under `app/api/admin` | Broad route coverage exists; live contract still has to be proven |
| Automated QA | `npm.cmd test` | Pass: 294 tests |
| TypeScript | `npm.cmd run typecheck` | **Pass** (exit 0, re-run 2026-09-11). The earlier failure on lead-import, partner invite, credits monitor and partner-chat queries against `lib/supabase/database.types.ts` has been resolved; this row was stale |
| Lint | `npm.cmd run lint` | Pass |
| Build | `npm.cmd run build` | **Pass** (exit 0, re-run 2026-09-11). This row was stale for the same reason as the TypeScript row |
| Feature scan | `npm.cmd run check:features` | **Crash, not a failure** (re-run 2026-09-11): the process aborts with exit `-1073740791` (`0xC0000409`, stack buffer overrun) before it can report anything. The earlier `public.features` / `public.feature_flags` finding could not be reproduced because the checker no longer gets far enough to print it. Undiagnosed — see `docs/qa/LA-0.1-0.6-QA-AUDIT.md` |
| Unauthenticated browser | `/admin` and `/admin/users` redirect to `/admin/login`; `/api/admin/users` returns 401 | Pass for the unauthenticated boundary |
| Authenticated browser | Local authenticated sessions on admin, agent, and partner surfaces; desktop and 390×844 mobile checks | Partial pass: core shells and selected states rendered; full role/mutation matrix remains open |
| Responsive UX remediation | Admin mobile drawer added in `components/admin/admin-sidebar.tsx`; responsive shell spacing in admin layout | Pass for the verified admin shell at phone and desktop widths; wider page-by-page responsive coverage remains open |
| Live schema/security | Supabase inventory and advisors | Significant schema drift and security findings; see `database.md` and `security.md` |

## Section 1 — SA-0.1 through SA-0.4: platform foundation

Frontend/backend reference: `app/admin/(protected)/layout.tsx`, `app/admin/(protected)/page.tsx`, `app/admin/(protected)/tenants/`, `app/admin/(protected)/audit-log/`, `app/api/admin/auth/`, `app/api/admin/tenants/`, `app/api/admin/audit-log/`, `lib/adminAuth/`, `lib/audit/`.

| Task | Notion planning signal | Goal checked | Evidence result | Decision |
|---|---|---|---|---|
| SA-0.1 | Completed | Separate Super Admin login, mandatory TOTP, role enforcement, protected admin routes | Super Admin and Platform Configuration/System Admin authenticated dashboards rendered. Logout/session boundary and unauthenticated redirect were verified. TOTP, session expiry, and the complete role matrix remain unproven; live `admin_users` lookup still mismatches the database. | **Partial — live/security gap** |
| SA-0.2 | Completed | Tenant/users/membership model and server-derived tenant scope | Repository contains tenant isolation routes/services and verifier, but live provisioning failed because `public.create_tenant_with_owner(...)` is absent and `public.tenants` is absent. | **Blocked — schema drift** |
| SA-0.3 | Completed | Append-only audit log for administrative writes | Repository audit helpers/routes exist. Repository expects `audit_log`; live project has `platform_audit_events` with an admin SELECT policy. Live create/read/update/delete workflow was not proven against the current contract. | **Blocked — schema drift** |
| SA-0.4 | Backlog | RLS, grants, session, function, and service-role hardening | Live inventory found 53 RLS-enabled tables with no policies, 28 `anon`-executable and 43 `authenticated`-executable security-definer functions, six mutable search-path functions, and RLS disabled on `platform_outbox_events`. | **Blocked — security gate** |

## Section 2 — SA-1.1 through SA-1.5: user administration

Frontend/backend reference: `app/admin/(protected)/users/`, `app/api/admin/users/`, `lib/users/`, `scripts/verify-user-integrity.mjs`, `scripts/verify-tenant-roles.mjs`, and `scripts/verify-tenant-isolation.mjs`.

| Task | Notion planning signal | Goal checked | Evidence result | Decision |
|---|---|---|---|---|
| SA-1.1 | Completed | Searchable, filterable, sortable, paginated platform-user directory and counts | `/admin/users` is protected and now renders a user-safe error boundary instead of a framework overlay, but the underlying loader still fails because `public.admin_user_list` is absent. Search, pagination, performance, and live data behavior remain unverified. | **Blocked — schema drift** |
| SA-1.2 | Completed | Create/invite user, tenant, membership, role, plan, duplicate validation | Create/invite routes and components exist. Live verifier cannot create the expected tenant/admin records; temporary-password and plan-attachment decisions remain documented backlog items. | **Blocked — schema drift** |
| SA-1.3 | Completed | Edit identity/role and enforce owner-preservation/session effects | Lifecycle routes and server guards exist. Live role verifier failed because the expected tenant/admin tables are absent; authenticated next-request behavior is not browser-proven. | **Blocked — schema drift** |
| SA-1.4 | Completed | Active/inactive/suspended/deleted lifecycle and seat behavior | Activate/deactivate/suspend routes exist. Hard deletion was deliberately descoped in favor of inactive status; the live lifecycle matrix was not executed. | **Decision variance; live-unverified** |
| SA-1.5 | Completed | Login activity, last-login, suspicious-IP indicators, audit history | Login/activity implementation exists. Live activity fixture and authenticated browser evidence are missing; failure-login and IP threshold behavior remain unaccepted. | **Partial — browser/live gap** |

## Section 3 — SA-2.1 through SA-2.8: pricing, usage, and entitlements

Frontend/backend reference: `app/admin/(protected)/features/`, `plans/`, `addons/`, `credits-limits/`, `subscriptions/`, `app/api/admin/features/`, `plans/`, `credits-limits/`, `subscriptions/`, `lib/entitlements/`, `lib/billing/`, and `scripts/check-feature-keys.mjs`.

| Task | Notion planning signal | Goal checked | Evidence result | Decision |
|---|---|---|---|---|
| SA-2.1 | Completed | Feature catalog, archive/restore, stable references, and guard consistency | Authenticated `/admin/features` renders Catalog/Kill switches and the role can change tabs, but the live catalog contract remains `feature_flags`/`key` while the app checker expects `features`/`feature_key`. | **Blocked — schema drift** |
| SA-2.2 | Completed | Plan CRUD and immutable versions | Plan pages/version routes exist; live plan verifier expects `public.plans`, while live exposes `billing_plans` and `billing_plan_versions`. | **Blocked — schema drift** |
| SA-2.3 | Completed | Feature assignment, dependency validation, preview, subscriber impact | Editor/preview code and unit coverage exist; live feature catalog cannot be resolved, so publish and grandfathering are not accepted. | **Blocked — schema drift** |
| SA-2.4 | Completed | Monthly/quarterly/yearly integer-cent pricing and versioning | Billing line tests pass locally; live pricing/plan-version verifier cannot resolve the repository contract. | **Partial — live gap** |
| SA-2.5 | Completed | Meter events, limits, warnings, caps, corrections, and aggregates | Billing/usage unit tests pass; live `verify:subscription-limits` reports a missing migration/table and tenant fixtures cannot be created. | **Blocked — schema drift** |
| SA-2.6 | Completed | Add-ons, credit packs, stacking, expiry, and idempotency | Routes/services exist; live add-on/meter and credits verifiers fail on missing expected tenant/catalog records. | **Blocked — schema drift** |
| SA-2.7 | Completed | Subscription lifecycle and immediate entitlement rebuild | Lifecycle routes and transition tests exist; live transition verifier cannot find active admin/tenant records. | **Blocked — schema drift** |
| SA-2.8 | Completed | Central entitlement enforcement across menu, route, API, and kill switch | Menu/entitlement code and unit tests exist; `check:features` and live entitlement verifier fail at the catalog/tenant contract boundary. | **Blocked — schema drift** |

## Section 4 — SA-3.1 through SA-3.9: billing and revenue

Frontend/backend reference: `app/admin/(protected)/invoices/`, `payments/`, `coupons/`, `credit-notes/`, `revenue/`, `app/api/admin/invoices/`, `payments/`, `coupons/`, `credit-notes/`, `lib/payments/`, `lib/billing/`, and `scripts/verify-*.mjs` billing verifiers.

| Task | Notion planning signal | Goal checked | Evidence result | Decision |
|---|---|---|---|---|
| SA-3.1 | Completed | Provider adapter boundary, connection state, and disabled live execution | Whop provider adapter and payment-status UI exist; live payment verifier failed during expected tenant setup. Real provider execution remains disabled by decision. | **Partial — live/provider gap** |
| SA-3.2 | Completed | Monthly/annual invoice generation and immutable rating | Invoice routes/lines and local rating tests exist; live invoice verifier cannot create the expected tenant and subscription fixture. | **Blocked — schema drift** |
| SA-3.3 | Completed | Invoice list/detail/print and reminder visibility | Authenticated invoice workspace rendered its empty state in the admin session; invoice detail/reminder data could not be proven because the live billing contract and disposable invoice fixtures are not aligned. | **Partial — live/schema gap** |
| SA-3.4 | Completed | Payment recording, idempotency, activation, and past-due transition | Payment routes and local tests exist; live payment workflow failed before fixture creation. | **Partial — live gap** |
| SA-3.5 | Cancelled | Provider-owned dunning | Explicitly cancelled by product decision; no replacement implementation is required. | **Cancelled** |
| SA-3.6 | Completed | Coupons, restrictions, duration, redemption, and invoice discounts | Coupon UI/API exists; live verifier failed while creating the expected coupon/tenant fixture. | **Blocked — schema drift** |
| SA-3.7 | Completed | Manual billing accounts and custom invoice lifecycle | Manual invoice routes/UI exist; live verifier could not resolve active admin/expected billing records. | **Blocked — schema drift** |
| SA-3.8 | Completed | Refund approvals, threshold, execution, and immutable credit notes | Refund/credit-note routes and local tests exist; live refund path was not accepted against current schema. | **Partial — live gap** |
| SA-3.9 | Completed | Revenue dashboard and reconciliation | Revenue page exists; live invoice/payment/refund reconciliation was not run against the current contract. | **Partial — live gap** |

## Section 5 — SA-4.1 through SA-4.12: configuration and operational controls

Frontend/backend reference: `app/admin/(protected)/settings/`, `offers/`, `products/`, `templates/`, `compliance-sources/`, `credits-limits/`, `advanced/`, `email/`, `system/`, and corresponding `app/api/admin/` route families.

| Task | Notion planning signal | Goal checked | Evidence result | Decision |
|---|---|---|---|---|
| SA-4.1 | Completed | Global settings storage, validation, and cache behavior | Settings UI/API exists; configuration verifier failed because expected `admin_users` is absent. | **Blocked — schema drift** |
| SA-4.2 | Completed | Payment-provider configuration and connection status | Provider settings/status routes exist; live provider configuration verifier was not accepted against current records. | **Partial — live/provider gap** |
| SA-4.3 | Completed | Configuration Center organization/navigation | The current navigation deliberately removes the Configuration Center hub and exposes standalone routes; this is a recorded product decision, not an accidental missing page. | **Decision variance** |
| SA-4.4 | Completed | Offers and promotion rules | Offers UI/API and focused verifier exist; verifier requires migrations not present in the connected live schema. | **Blocked — schema drift** |
| SA-4.5 | Completed | Product catalog lifecycle | Product UI/API exists; focused verifier reports the required migration/table is not applied to the connected database. | **Blocked — schema drift** |
| SA-4.6 | Completed | Template creation/versioning/assignment | Template UI/API exists; focused verifier reports its required migration/table is not applied. | **Blocked — schema drift** |
| SA-4.7 | Completed | Agent-side template application and tenant copies | Agent template service exists and local tests cover copy/selection behavior; authenticated/live verification is incomplete. | **Partial — browser/live gap** |
| SA-4.8 | Completed | Compliance/DNC vendor configuration and fail-closed behavior | Compliance routes/services exist; focused verifier reports missing migration/table in live schema. | **Blocked — schema drift** |
| SA-4.9 | Completed | Credits, limits, usage monitor, and margin data | Credits/limits UI/API exists; live verifier could not resolve the expected admin/tenant/catalog records. | **Blocked — schema drift** |
| SA-4.10 | Completed | Feature kill switches and propagation | Feature-switch routes/services and local tests exist; live switch verifier has no compatible active plan/tenant fixture. | **Blocked — schema drift** |
| SA-4.11 | Completed | Email templates, transport configuration, and delivery boundary | Email UI/templates exist; provider transport is intentionally not wired for production delivery and authenticated/live evidence is incomplete. | **Partial — provider gap** |
| SA-4.12 | Completed | Maintenance mode and announcements | System UI/API exists; live system verifier expected missing `admin_plan_list`/legacy records. | **Blocked — schema drift** |

## Section 6 — SA-5.1 through SA-5.5: public acquisition and legal

Frontend/backend reference: public signup, checkout, trial, and legal routes plus `app/api/admin/legal/`, `app/api/admin/trials/`, `scripts/verify-self-serve-signup.mjs`, `scripts/verify-checkout.mjs`, `scripts/verify-trials.mjs`, and `scripts/verify-legal.mjs`.

| Task | Notion planning signal | Goal checked | Evidence result | Decision |
|---|---|---|---|---|
| SA-5.1 | Completed | Public pricing, signup, validation, and plan linkage | Public signup implementation exists; verifier fails because expected `admin_plan_list`/legacy plan contract is absent from live schema. | **Blocked — schema drift** |
| SA-5.2 | Completed | Hosted checkout and trial start | Checkout code and provider adapter exist; real provider execution remains constrained and the live verifier was not accepted as a full authenticated workflow. | **Partial — provider/live gap** |
| SA-5.3 | Completed | Trial lifecycle, reminders, expiry, and conversion | Trial pages/services exist; live trial verifier cannot find the required active support admin fixture. | **Blocked — schema drift** |
| SA-5.4 | Completed | Terms/privacy versions and acceptance records | Legal UI/API exists; live legal verifier cannot find the expected active super-admin fixture. | **Blocked — schema drift** |
| SA-5.5 | Not found | No task definition found in current Notion inventory or repository task sources | No implementation invented. | **N/A — task not defined** |

## Acceptance conclusion

The repository has broad SA screen, API, service, migration, and local-test coverage, but the SA-0.1–SA-5.4 batch is **not fully accepted**. The decisive blockers are:

1. The configured live Supabase schema is not the schema consumed by this checkout (`features` versus `feature_flags`, `tenants` versus `organizations`, `plans` versus `billing_plans`, and related functions/views).
2. The current dirty tree fails TypeScript in partner-chat/database typings.
3. SA-0.4 has unresolved live security findings, including a table with RLS disabled and RLS-enabled tables without policies.
4. Authenticated browser evidence is partial: the primary admin, agent, and partner-user shells were exercised, but the complete role-specific mutation matrix, 2FA/session-expiry proof, tenant-isolation mutation proof, and all desktop/mobile task workflows are still open. System Admin is the only additional supplied admin role that authenticated; separate Support, Billing, and Tenant Owner/Restricted User sessions were not provided or proven in this run.

## Verified remediation during this audit

- Added an admin route error boundary at `app/admin/(protected)/error.tsx`. Database/schema failures now show a recoverable, user-facing error state with Retry and Back to dashboard actions instead of exposing a Next.js runtime overlay.
- Added a responsive admin mobile header and drawer in `components/admin/admin-sidebar.tsx`, plus responsive shell padding in `app/admin/(protected)/layout.tsx`. The 390×844 authenticated check confirmed a reachable menu, expandable groups, close-on-navigation, and no fixed sidebar squeezing the page.
- These changes improve failure handling and usability; they do not resolve the live schema mismatch or convert blocked tasks into accepted tasks.

No migration or shared-data mutation was performed by this audit. The next safe action is to reconcile the live contract and repair the current TypeScript baseline before rerunning focused task gates.
