# INSURVAS Super Admin baseline QA audit

Audit date: 2026-09-13  
Repository: `C:\Users\Victus\OneDrive\Documents\ChatGPT\Insurvas-git\Insurvas-New`  
Database: existing Supabase project configured by `.env.local`; project reference intentionally omitted  
Scope: SA-0.1 through SA-5.5, with the baseline plan's cross-module regression checks

Current-status correction: this is a dated 2026-09-13 audit snapshot. The current authoritative
register is `docs/qa/MASTER-GAP-BLOCKER-REGISTER.md`. A fresh local browser attempt reached the
mandatory Super Admin MFA challenge but did not have a valid OTP available, so the older browser
paragraphs in this snapshot must not be treated as current proof of complete authenticated
mutation coverage.

## Current focused revalidation update — 2026-09-14

Since this snapshot, the current checkout has 504 passing automated tests. The SA-2 authenticated
tenant matrix, rate-limit verifier, annual invoice generation, invoice immutability, payment-provider
boundary, coupon, and custom-invoice suites pass against the configured shared Supabase project.
Hosted checkout remains blocked by the configured Whop plan mapping, not by a local authorization
or return-path defect. SA task classifications remain conservative because authenticated mutation
browser evidence, complete RLS inventory proof, and several live migration/provider/legal gates are
still open; the master register is the current classification source.

## Authenticated Super Admin browser and UX recheck — 2026-09-14

The user supplied an already-authenticated Super Admin browser session at `/admin`. All 28 SA entry
points were visited in that session: 27 rendered pages plus the supported `/admin/settings` alias to
`/admin/advanced`. The dashboard, customer, billing, catalog, monitoring, and platform screens all
reached their expected page identity without a framework error screen. The
rendered data states were inspected on the dashboard, billing workspace, tenant directory,
subscriptions, invoices, credits/limits, compliance, and advanced settings surfaces. No browser
`warn` or `error` entries were observed during the updated pass.

The functional and UI review found two navigation clarity issues and one landing-page dead end:

- Billing workspace tabs now identify the current section with a visible selected state and
  `aria-current="page"`.
- Desktop admin links now expose the current page to assistive technology and have an explicit
  visible keyboard focus treatment.
- The SA dashboard now includes an accessible, native disclosure guide with three ordered steps:
  establish tenants/users, configure the catalog, then verify audit and platform health. Each step
  links to the relevant SA screen so an operator can understand what to do next.

Dashboard, billing, and tenant-directory screenshots were captured and visually inspected. The
current viewport shows the desktop sidebar and responsive table overflow container; the tenant table
remains intentionally horizontally scrollable for its wide data shape. This is evidence of the
reviewed surfaces, not a claim of full WCAG conformance or complete mutation coverage. Browser
unverified rows remain open where the acceptance criterion requires fresh desktop/mobile mutation
replay, provider behavior, legal approval, or other external authority.

Source checks after the changes: `npm.cmd test` 504/504, `npm.cmd run typecheck`, `npm.cmd run lint`,
and `npm.cmd run build` all pass. The updated browser session still has no observed console
warnings/errors.

## Executive result

The repository is not fully accepted as a complete Super Admin product yet. The current
implementation has substantial verified coverage, but the acceptance boundary remains open for
live-schema alignment, complete authenticated browser evidence, provider checkout, and a small
set of performance/fixture conditions.

The aggregate run on this checkout completed **63 of 73 suites successfully**. Ten suites remained
red. Focused reruns passed the repaired user-integrity, credits/limits, system-maintenance,
rate-limit, agent-template, contacts, partner-chat, and most billing/security checks. A red
aggregate suite is not silently treated as a product failure when the failure is caused by a
shared fixture or a migration that cannot be applied with the available database role; those
conditions are recorded below.

No database reset, broad deletion, new Supabase project, real payment, email, telephony, carrier,
tax, or production integration was enabled.

## Evidence boundary

The following evidence layers were used:

- repository routes, services, migrations, and permission guards;
- focused live verifiers using namespaced disposable fixtures;
- aggregate `npm.cmd run verify:all` execution;
- authenticated Super Admin browser walkthrough at desktop, tablet, and mobile widths;
- live Supabase read-only inventory and policy/grant checks;
- typecheck, lint, build, unit tests, and feature-contract checks.

The browser walkthrough verified the Super Admin shell, dashboard, tenant directory, audit log,
search/filter interactions, billing workspace, invoice route, responsive navigation, loading/empty
and denied route behavior, and absence of observed console/framework errors. It did not exercise
every mutation and every acceptance criterion for every SA task; those tasks remain Partial or
Browser-unverified rather than Pass.

## Task classification

`Pass` is reserved for a task with complete frontend, backend, database, automated, live, and
authenticated browser evidence. The current conservative classifications are:

| Task range | Classification | Basis |
|---|---|---|
| SA-0.1 | Partial | Admin authentication, TOTP, role guards, and browser shell paths were exercised; session-expiry, fresh-install seed, and complete role-session evidence remain open. |
| SA-0.2 | Partial | Tenant directory and tenant isolation verifiers pass; exhaustive operational-table RLS and complete tenant-user browser evidence remain open. |
| SA-0.3 | Partial | Append-only audit behavior and focused audit workflows pass; exactly-one audit evidence for every administrative write is not proven. |
| SA-0.4 | Database-misaligned | Local hardening migrations exist, but live advisor findings, missing live grants/search-path settings, and unavailable DDL authority prevent acceptance. |
| SA-1.1–SA-1.4 | Partial | Focused user-integrity and admin-user workflows pass, including Auth-first provisioning and owner protection; complete browser mutation replay and all scale evidence remain open. |
| SA-1.5 | Browser-unverified | Activity and last-login implementation is present and focused checks pass; full large-volume and mobile browser evidence remain open. |
| SA-2.1–SA-2.8 | Partial | Catalog, plan integrity, entitlement, add-on, subscription-transition, idempotency, kill-switch, and tenant-matrix checks pass; complete browser mutation evidence and live migration alignment remain open. |
| SA-3.1–SA-3.4 | Partial | Provider adapter, invoice, annual billing, webhook, settlement, and payment-state checks pass; full billing mutation browser evidence remains open. |
| SA-3.5 | Cancelled | Dunning remains provider-owned by product decision. |
| SA-3.6–SA-3.9 | Partial | Coupons, custom invoices, credit notes/refunds, and internal revenue data have focused coverage; populated billing/revenue browser evidence and complete reconciliation proof remain open. |
| SA-4.1–SA-4.12 | Partial | Configuration Center routes, permissions, products, templates, credits, kill switches, compliance, and system maintenance have focused coverage; live schema/grant drift and full browser evidence remain open. |
| SA-5.1 | Partial | Self-serve signup, legal acceptance, trials, and rate limiting pass focused live checks; complete public browser and provider-linked flow evidence remains open. |
| SA-5.2 | Blocked | Whop returns `404 This Plan was not found` for placeholder provider plan IDs; live checkout cannot be verified until provider configuration is corrected by the account owner. |
| SA-5.3–SA-5.4 | Partial | Trial and legal focused verifiers pass; full authenticated/public browser evidence and provider-linked conversion proof remain open. |
| SA-5.5 | N/A | No SA-5.5 task was found in the current task inventory; no implementation was invented. |

## Aggregate failures and disposition

| Suite | Result | Disposition |
|---|---|---|
| `npm.cmd run check:triggers` | Red | The declared-trigger inventory remains below the migration declarations; this is the documented backlog-183 migration/application gap, not silently accepted. |
| `verify:offers` | Red | A pre-existing broad auto-offer is selected before the disposable plan-specific offer. Local precedence repair exists in `20260913350000_sa_4_4_auto_offer_precedence.sql`, but live DDL cannot be applied. Shared offer rows were not mutated. |
| `verify:compliance-vendors` | Red | The shared global registry already has an enabled DNC vendor. The verifier correctly refuses to disable the last shared vendor without an explicit consequence confirmation. |
| `verify:dial-preflight` | Red | Same shared enabled-DNC-vendor condition; the test did not mutate shared vendor state. |
| `verify:credits-limits` | Red in aggregate, Pass focused | Focused run passes after bounded pagination and compatibility fallback. The aggregate performance fixture hit a statement timeout under the long sequential run; no shared data was broadly deleted. |
| `verify:contacts` | Red in aggregate, Pass focused | Focused run passes including duplicate detection and tenant isolation. Aggregate 20,000-contact timing was 1024.7 ms under sequential-suite load versus the 500 ms budget. |
| `verify:transfer-inbox` | Red in aggregate, Partial focused | Behavior and tenant isolation pass. The 500-row hot path measured 1601 ms in aggregate; local index migration `20260913360000_la_1_10_transfer_inbox_hot_path_index.sql` is not live-applied. |
| `npm.cmd run verify:la1-security` | Red | `render_disposition_note` has an empty live `search_path`; local repair `20260913340000_la_1_security_definer_search_path_repair.sql` is pending live DDL authority. |
| `verify:checkout` | Red | Whop checkout cannot open because the configured plan ID is not present at the provider. No real checkout was retried or enabled. |

The focused `verify:user-integrity`, `verify:system`, `verify:ratelimit`,
`verify:agent-templates`, `verify:contacts`, `verify:credits-limits`, and
`verify:partner-chat` runs passed after their scoped corrections. `check:features` also passes:
28 active catalog features have menu coverage, guarded API coverage, and no catalog/menu drift.

## Database and security findings

- The shared project is the only database target and existing records were preserved.
- Local additive migrations are present for Auth-first owner enforcement, usage-monitor and
  entitlement repair, offer precedence, the transfer-inbox index, and the definer search path.
- Applying DDL through the configured database role failed with `permission denied for schema
  public`; therefore the live database must not be described as migrated.
- The live inventory reports migration/index/trigger drift, including missing tenant-app grants
  for calling-window tables and `tenant_vendor_post_keys`, missing indexes, and 20 missing declared
  triggers.
- `audit_log` remains append-only in the intended local migration, but the current live database
  does not expose the expected `service_role` INSERT grant to the migration checker. The local
  hardening migration is pending application.
- No service-role credential was found in browser-facing code during the reviewed routes/build.
- Cross-tenant SELECT/INSERT/UPDATE/DELETE denial passed for the exercised tenant and SA-2 control
  plane matrices. This is not a substitute for a complete inventory of every policyless RLS table.

## Frontend and UX findings

The exercised Super Admin screens are usable and consistent with the existing shell: navigation,
search/filter controls, billing tabs, invoice list/detail routes, empty/denied states, and mobile
drawer behavior worked without observed framework or console errors. The most important UX gap is
not a visual defect: many task-specific mutation workflows still lack authenticated browser
evidence at both desktop and mobile widths. Billing checkout is blocked by provider configuration,
not by a local UI exception.

## Required next actions in strict order

1. Apply the pending additive migrations with an authorized owner/DDL connection, after reviewing
   each migration and taking a schema snapshot.
2. Re-run the live inventory, grants, trigger, index, audit-log, offer, usage, transfer-inbox, and
   security verifiers.
3. Provision fresh disposable role fixtures and complete the missing authenticated browser
   mutation matrix for SA-0.1 through SA-5.4 at desktop and mobile widths.
4. Correct the Whop plan mapping and price mismatch with the provider account owner, then rerun
   SA-5.2 without enabling production payment execution.
5. Re-run `npm.cmd run verify:all` twice consecutively, followed by the baseline commands, before
   accepting any task or starting a new product module.

## Commands and current results

| Command | Result |
|---|---|
| `npm.cmd run verify:all` | 63/73 suites passed; 10 documented failures remain. |
| `npm.cmd test` | Previously passing baseline: 393/393; rerun after final documentation-only changes is required. |
| `npm.cmd run typecheck` | Pass after current scoped fixes. |
| `npm.cmd run lint` | Pass in the current focused run; rerun with final baseline. |
| `npm.cmd run build` | Pass; the former middleware-to-proxy warning is cleared by `proxy.ts`. |
| `npm.cmd run check:features` | Pass: 28 active catalog features, no drift. |
| `npm.cmd run db:check -- --fast` | Every file parses; live semantic check reports the current audit-log grant mismatch. |

This audit is complete as a factual baseline record, but the Super Admin module is not yet a
fully accepted production-grade surface until the listed live, browser, provider, and regression
gates are closed.

## Follow-up: accidental QA email prevention — 2026-09-13

The Gmail bounce report identified that fixture recipients using reserved domains could still reach
SMTP when local credentials were configured. The shared transport was corrected so external delivery
is disabled by default and must be explicitly opted into with `EMAIL_DELIVERY_MODE=smtp`. Reserved
QA recipients, including `.test`, `.example`, `.invalid`, localhost, and `example.*`, remain blocked regardless of SMTP
mode. The standalone email test command also refuses those addresses before connection or delivery.

Verification evidence:

- `npm.cmd test`: 449/449 passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed.
- `npm.cmd run build`: passed; the former Next.js middleware deprecation is cleared by `proxy.ts`.
- `npm.cmd run email:test -- fixture@invalid.test`: refused before SMTP connection.
- `.env.local` was not modified and no email was sent.

This closes the accidental local QA-delivery defect. It does not close the broader SA browser,
live-schema, provider, or aggregate-verifier blockers listed above.

## Fresh cross-module remediation checkpoint — 2026-09-14

The current checkout was revalidated after the scoped compatibility and QA-harness fixes.

| Check | Current result |
|---|---|
| Unit suite | 499 passed, 0 failed |
| TypeScript | Pass |
| ESLint | Pass |
| Production build | Pass; middleware-to-proxy deprecation cleared by `proxy.ts` migration |
| Feature consistency | Pass; 28 active features, 28 menu references, 13 feature-bearing API keys |
| LA-1.1/1.2/1.3 | Focused live suites pass; authenticated browser evidence remains open |
| LA-1.11/1.13/1.14/1.15/1.18/1.19 | Focused live suites pass; authenticated browser evidence remains open |
| LA-1.24 | Focused 20,000-contact timing gate passes; aggregate run exceeded the target under remote contention |
| Screening-dependent LA-1 flows | Fail closed because live `consume_meter_capacity` is absent |
| Offer precedence | Database-misaligned; live function is older than the reviewed local repair |
| LA database security | Database-misaligned; live `render_disposition_note` lacks the pinned search path |
| Transfer inbox | Correctness/isolation pass; aggregate timing remains above target |
| SA-5.2 checkout | Blocked by the configured Whop placeholder-plan mapping |

The focused partner-quality verifier was corrected to use the shared database UTC calendar because the
live report filters `created_at::date` in UTC. It now passes all 17 checks, including raw lead-count
reconciliation and every drill-down. The LA-1.7 verifier now reports a controlled screening prerequisite
failure instead of throwing a secondary TypeError. The fresh aggregate completed 73 suites with 57
passing and 16 red; the complete red set and exact root causes are maintained in
[`MASTER-GAP-BLOCKER-REGISTER.md`](MASTER-GAP-BLOCKER-REGISTER.md).
