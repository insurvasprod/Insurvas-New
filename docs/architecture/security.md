# Security posture — live project

Collected: 2026-09-14 via the live Supabase inventory and security-advisor query (catalog reads only, through the deliberately
unprivileged `TENANT_DB_URL` role) plus the read-only admin surface matrix `npm run qa:sa-matrix`.
No secret, key or project reference appears in this document.

## Focused security QA update — 2026-09-14

- A fresh production-build admin browser attempt rendered the login surface and reached the
  mandatory six-digit MFA challenge. No OTP was guessed or bypassed; role-specific authenticated
  browser evidence therefore remains open for this session.
- The current read-only database checks report 165/165 application RPCs, 127/127 tenant-access
  declarations, and 86/86 declared triggers present/correct. `verify:la1-security` passes its
  focused grant, search-path, and tenant-policy checks; broader advisor review and authenticated
  RLS evidence remain separate gates.
- `verify:lead-workspace`, `verify:lead-notes`, and `verify:tenant-roles` passed their authenticated
  role, hostile-session, tenant-isolation, and mutation checks after the live-shape compatibility
  fix. `verify:lead-import` and `verify:contacts` also passed their focused isolation and replay
  checks.
- The transfer-inbox function is tenant-filtered and the live equivalent hot-path index exists;
  only the strict remote timing assertion remains open at 1,461 ms.
- The live offers function still has the older mutable `search_path` and precedence ordering. The
  current focused offer verifier passes against the live contract; any historical migration
  comparison remains preserved below as dated evidence rather than current failure state.
- The deployed `import_agent_lead_batch` function still references absent `public.users.tenant_id`.
  The local membership-bridge repair is not promoted because the available role has no DDL authority;
  the importer fails closed and no non-atomic fallback exists.
- Public pricing was rechecked at desktop and mobile widths after replacing dark-theme foreground
  variables on white cards with explicit slate contrast classes. This is a UX correction, not an
  authorization change.

## SA-2.1 – SA-2.3 QA update (2026-09-12)

- Catalog, plan, and plan-feature mutations remain behind server-side admin role checks and
  service-only database adapters; browser code receives no service credential.
- The live plan-version integrity verifier initially found a missing trigger that could create an
  individual plan without its mandatory one-seat limit. The additive repair migration
  `20260912480000_sa_2_2_repair_individual_plan_limit_trigger.sql` restores the invariant and
  revokes direct client execution on the trigger function.
- `check:features`, `verify:entitlements`, and `verify:plan-version` now pass against the existing
  project. This proves catalog consistency and core entitlement resolution, not the complete
  authenticated cross-tenant mutation matrix.
- The current Supabase inventory reports 85 RLS-enabled tables without policies, 7 client-executable
  security-definer functions, and 3 RLS-disabled tables. These counts supersede the earlier
  2026-09-12 snapshot below; they are findings, not acceptance.
- The earlier Supabase advisor snapshot (86 policyless RLS tables, 28 anon/43 authenticated
  security-definer execution findings, and 39 mutable-path findings) remain open under SA-0.4;
  this batch does not broaden the grant surface or claim those findings are fixed.

## Summary

| Check | Result |
|---|---|
| Tables with RLS disabled | **3** (current 2026-09-14 inventory) |
| Tables with RLS enabled but no policy | **85** (current inventory; SA-0.4 review open) |
| Focused foundation tables granted to `anon` | **0** |
| Focused audit/admin provisioning grants to `authenticated` | **0** |
| `SECURITY DEFINER` functions executable by a client role | **7 current inventory findings**; the older advisor snapshot reported 28 anon / 43 authenticated findings |
| `SECURITY DEFINER` functions with a mutable `search_path` | **0 in the current custom scan**; the older advisor snapshot reported 39, so this discrepancy remains open |
| Extensions installed in `public` | 2 (`btree_gist`, `pg_trgm`) |
| Anonymous access to a protected admin surface | **0 of 62 probed** |

The posture is materially better after the focused grant hardening, but the current Supabase
advisor still reports policy-less tables, mutable search paths, client-executable security-definer
functions, and disabled leaked-password protection. Those findings remain open and are not treated
as accepted. The repository's custom inventory reports zero for the two function categories after
the targeted revocations; both measurements are recorded because they do not currently agree.

## Current foundation changes (2026-09-12)

- Admin 2FA is mandatory in `lib/adminAuth/config.ts`; a fresh browser login reached and completed
  the TOTP challenge with a locally generated code.
- `supabase/migrations/20260912193000_sa_0_audit_and_provisioning_hardening.sql` is applied to the
  existing project. It adds the `audit_log_append_only` trigger, removes client table grants from
  `audit_log`, and restricts `create_tenant_with_owner` to `service_role`/`postgres`.
- Direct live update/delete attempts against `audit_log` failed with the append-only SQLSTATE and
  message. `platform_audit_events` retains its append-only trigger, and direct client table grants
  were revoked from both audit stores.
- The legacy/current lead-note table boundary was closed with the additive grant migration; the
  old policies remain for compatibility and require a future schema-contract migration.
- Leaked-password protection and the remaining advisor findings require SA-0.4 follow-up.

## Corrections to the previous revision

- It reported **RLS disabled on `platform_outbox_events`**. Fixed — no table in `public` now has
  RLS disabled.
- It reported **28 `anon`-executable and 43 `authenticated`-executable security-definer
  functions**. Eleven targeted application entry points are now revoked, but the current advisor
  still reports the same aggregate counts; this is an open advisor/custom-inventory discrepancy.
- It reported **six mutable-`search_path` functions**. The current advisor now reports 39; the
  custom inventory reports zero. This is retained as unresolved until the scanners are reconciled.
- It reported **53 RLS-enabled tables with no policy** as a headline risk. The current advisor
  count is 86, but
  the framing was misleading — see below.

## Policy-less tables are closed, not open

A table with RLS enabled and no policy denies every row to any role subject to RLS. It becomes a
risk only if a client role also holds a grant on it. The focused foundation grant check found no
`anon` access and no `authenticated` grant on `audit_log` or the provisioning function. A complete
all-table grant inventory remains required by SA-0.4.

This is a defence-in-depth observation and a maintenance hazard (the day someone adds a grant, 86
tables become reachable at once), not a live exposure. It should be tracked, not treated as an
incident.

The list spans both product generations: `admin_users`, `audit_log`, `login_events`,
`payment_providers`, `platform_announcements`, `platform_billing_outbox` from this application, and
`outbound_*`, `calling_window_*`, `carrier_*` from the organizations-era CRM sharing the database.

## Finding 1 — client-executable `SECURITY DEFINER` functions (highest risk)

These run with the owner's privileges and bypass RLS by design. The older advisor snapshot reports
28 anon and 43 authenticated findings; the fresh 2026-09-14 custom inventory reports four current
client-executable findings. Eleven targeted functions used only through server-side services were
revoked in the current migration. The complete advisor/inventory discrepancy still requires
ownership review before any further broad revoke.

| Function | Belongs to |
|---|---|
| `initialize_verification_items` | verification workflow |
| `update_verification_progress` | verification workflow |
| `set_partner_user_status` | partner administration |
| `update_partner_status` | partner administration |
| `outbound_enforce_agent_campaign` | organizations-era outbound module |
| `validate_outbound_provenance` | organizations-era outbound module |

These eleven targeted entry points are now restricted to server-role execution. The advisor still
reports additional client-executable functions, including organizations-era CRM routines, and
the aggregate advisor/custom-inventory discrepancy is unresolved. The remaining functions need
ownership and caller-scope review before additional grants are changed.

**Recommended:** review each remaining function for a tenant/ownership check, then revoke client
execution and grant only to the intended server role unless a client genuinely needs it. This must
be done in owned batches; the shared project also contains the older organizations-era CRM.

## Finding 2 — authorization boundary verified and holding

From 62 read-only probes across 6 sessions:

- Every protected admin API returned `401` to an anonymous caller; every protected screen
  redirected. The only anonymous `200` is `/admin/login`.
- A **tenant** session cookie returned `401` on every admin API — the planes do not interchange.
  Corroborated cryptographically: `lib/tenantAuth/sessionSeparation.test.mjs` proves the two planes
  sign with different secrets, so a cross-plane cookie fails signature verification rather than a
  name check.
- `platform_config` received `403` on all 13 customer and billing endpoints and `200` on the 7
  configuration endpoints. Least privilege is real here, not nominal.

## Finding 3 — role-matrix coverage is available; browser coverage remains open

The fail-closed `qa:sa-matrix` now creates only clearly namespaced verification-admin rows when a
required role is absent, signs short-lived local sessions, and deactivates those rows in `finally`.
The final 2026-09-13 run exercised `super_admin`, `support_agent`, `billing_admin`,
`platform_config`, `owner`, and `assistant` against 35 static admin APIs and 29 screens with zero
5xx responses, zero transport errors, zero missing sessions, and zero protected anonymous 200s.
This proves the automated route matrix, not a complete human browser workflow; desktop/mobile
screenshots, TOTP login replay for every role, and mutation journeys remain open evidence gaps.

## Finding 4 — error messages leak nothing, but also say nothing

`/api/admin/users`, `/plans`, `/subscriptions` and `/offers` return `{"error":"Could not load X"}`,
discarding the underlying cause. Good for disclosure; bad for operations — a missing table, a
permission fault and a network error are indistinguishable. `credits-limits` and
`compliance-vendors` return the real cause and are the better model for an admin-only surface.

## Finding 5 — secret handling is correct on the surfaces checked

`/api/admin/payments/status` returns the provider key fingerprinted (`••••<4 chars>`), reports
`webhookSecretPresent: true` without the value, and runs in `sandbox` mode. No real payment, email,
telephony, carrier or tax integration was enabled during this recheck.

## Finding 6 — extensions in `public`

`btree_gist` and `pg_trgm` are installed in `public`. Standard advisory finding, low severity;
moving them to a dedicated schema is a rebuild-time decision, not a live fix — `pg_trgm` backs the
LA-0.6 duplicate-detection index.

## Priority

1. Reconcile the Supabase advisor's 28/43 security-definer and 39 mutable-path findings against
   the custom inventory, then lock down each owned function in reviewed batches.
2. Create or reactivate disposable `support_agent` and `billing_admin` fixtures and complete the
   authenticated role matrix (user creation is now possible for the current schema, but the
   prior user-integrity verifier still exposed a separate duplicate/FK defect).
3. Preserve the zero-grant invariant deliberately — add a check that fails if any `public` table
   gains an `anon` or `authenticated` grant while it has no policy.
4. Give the four generic admin error paths the same cause-reporting as `credits-limits`.
5. Extensions out of `public` at the next rebuild.

## SA-1 authenticated user-management findings — 2026-09-12

- The platform-wide Users list is served through a server-only adapter and is not directly
  readable by tenant sessions.
- Admin creation uses Supabase Auth first, then the transactional tenant-attachment RPC. If the
  attachment fails, the route compensates by removing the just-created Auth identity; no service
  credential is sent to the browser.
- Duplicate email rejection, last-owner preservation, session-version invalidation after role
  change, invitation resend supersession, and audit diffs were exercised with namespaced QA data.
- The initial live attach and resend RPCs had database type/name resolution defects. They were
  corrected by the additive SA-1.2 migrations recorded in `task-traceability.md`; the live flows
  passed after migration.
- The remaining SA-1 acceptance gaps are evidence or live-environment gaps: full tenant-session
  next-request proof, email/password-token browser flows, populated suspended-filter proof,
  5,000-user performance, and live execution of the new-tenant initial-plan RPC. The local
  create-user form now requires a plan for new tenants and never accepts an admin-entered password.
- SA-1.4 state transitions are restricted to the super-admin route boundary and use a live RPC
  that increments `session_version`; the suspended login response is explicit only after Auth
  credentials are proven. Delete/7-day purge is intentionally not exposed under the current
  product decision, so it remains an open specification mismatch rather than an unsafe partial
  delete implementation.
- SA-1.5 records both successful and failed attempts through the server-side login paths. The
  activity screen is authenticated and paginated, but 50,000-row timing and a dedicated failure
  versus `last_login_at` comparison have not been proven in this run.

## SA-2.4 through SA-2.6 security review — 2026-09-12

The focused live inventory found RLS enabled on all 11 pricing, meter, usage, and add-on tables,
with service-role-only policies. No tenant mutation was authorized through the browser. The
repaired entitlement and meter-capacity RPCs use an empty `search_path`, and the focused add-on
meter verifier passed plan allowance, stacked add-on credits, resolver agreement, and detachment
history checks.

This is not a complete SA-2 security acceptance. The dedicated tenant-boundary verifier remains
the source of truth for subscription, add-on, entitlement, usage-event, and correction isolation;
authenticated browser mutation replay, mobile, and screenshot evidence remain open. The related
`verify:credits-limits` suite now passes its live grant, cached-entitlement, usage-monitor,
purchase, audit, and bounded-population checks after the fallback contract was refreshed.

## SA-2.7 security review — 2026-09-12

The live transition verifier passed server-side rejection of invalid resume/pause requests and
archived-plan assignment/change attempts. The repaired assignment function is `SECURITY DEFINER`
with an empty `search_path`; `anon` and `authenticated` cannot execute it, while `service_role`
can. The mutation route performs platform-admin authorization before invoking lifecycle RPCs and
rebuilds entitlements before responding when access changes.

The subscription mutation API now requires an `Idempotency-Key` and records the actor-scoped
request hash and final response in the service-only `subscription_mutation_requests` ledger.
Focused live verification passed first-write/replay, no duplicate subscription, and key-reuse
conflict behavior. The security gate remains partial because the complete authenticated
cross-tenant mutation matrix, browser mutation replay, mobile browser evidence, and screenshots
remain outstanding.

## SA-2.8 security review — 2026-09-12

Live HTTP verification passed kill-switch precedence over entitlement, beta allowlist enforcement,
same-session restore, unauthenticated toggle denial, invalid catalog-key rejection, and audit
coverage. Entitlement verification passed exact plan grants, suspended read-only access, and
cancelled no-access behavior. The application guard order is kill switch, entitlement, role, then
write/read-only state.

The process-local kill-switch cache was removed because invalidation from an admin route cannot be
assumed to reach a separate route bundle or server instance. The direct table read is safer for this
small safety-control dataset. `verify:sa2-tenant-matrix` now passes the live two-tenant boundary
checks: service-only subscription/add-on/usage/mutation tables deny all four direct operations,
tenant entitlement reads are own-tenant-only with writes denied, and tenant sessions are denied at
the admin subscription API. SA-2.8 remains Partial because authenticated browser mutation replay,
mobile browser evidence, and screenshots are still outstanding.

## SA-3 security reconciliation — 2026-09-13

The focused billing security checks passed against the shared project. Provider mode is Whop-only
and sandbox/local; no real payment execution is enabled. Issued invoice and credit-note records
remain immutable, and document counters only move forward. Payment and webhook replay handling is
idempotent. A signed payment success activates the subscription; a failure moves it to `past_due`,
and stale provider events cannot resurrect an older state. A real tenant payment that cannot be
invoiced is left unprocessed with a durable error for retry.

Two direct-update permission defects were corrected with narrow service-only RPCs:
`approve_credit_note` (`20260913240000_sa_3_8_credit_note_approval_rpc.sql`) and
`mark_webhook_processed`/`mark_webhook_failed`
(`20260913241000_sa_3_4_webhook_state_rpcs.sql`). Each uses `SECURITY DEFINER`, an empty
`search_path`, and denies execute to public, anonymous, authenticated, and `tenant_app` roles.
The application service role does not receive broad direct UPDATE access to those protected
tables.

The remaining SA-3 security evidence is browser-level: fresh authenticated admin workflows at
desktop and mobile widths, denied non-admin paths, and a complete tenant billing read/mutation
matrix. Real provider, email, tax, and dunning behavior remains intentionally disabled.

## Baseline QA security reconciliation — 2026-09-13

The baseline audit is recorded in [`docs/qa/SA-0.1-SA-5.5-QA-AUDIT.md`](../qa/SA-0.1-SA-5.5-QA-AUDIT.md).
Focused authenticated checks passed for cross-tenant denial across the exercised SA-2 control-plane
objects, Auth-first user lifecycle behavior, usage/add-on entitlement resolution, audit immutability,
kill-switch precedence, billing replay protection, and role-specific configuration routes.

The acceptance gate remains open because the live database has not received the pending additive
hardening migrations. The remaining findings are: live `render_disposition_note` has no pinned
`search_path`; the expected service-role audit-log grant is absent from the current live grant
inventory; multiple RLS-enabled tables remain policyless according to the advisor; and the complete
authenticated mutation matrix for every SA task has not been browser-exercised at desktop and
mobile widths. These are recorded as blockers or partial evidence, not as silently accepted risk.

## Local email delivery safety — 2026-09-13

External email delivery is now an explicit opt-in. Local and QA runs remain disabled unless
`EMAIL_DELIVERY_MODE=smtp` is deliberately configured. Reserved recipients (`.test`, `.example`,
`.invalid`, localhost, and `example.*`) are blocked even when SMTP mode is enabled, preventing fixture invitations,
verification messages, reminders, and other transactional mail from reaching Gmail and generating
bounces. Blocked or disabled attempts are recorded as skipped email-log entries for auditability.
The local `.env.local` file was not changed and no email was sent during this verification.

## QA credential-handling verification — 2026-09-14

The repository scan found no tracked demo password, service-role value, SMTP credential, or
platform-admin credential. Disposable demo passwords are read from the ignored `.env.demo.local`
file by the local provisioning script; the values were not printed, committed, or sent through the
application. The tracked repository contains only `.env.example`. This does not replace secret
rotation or provider-side credential review if a value has ever been exposed outside the local
environment.

## Focused LA security update — 2026-09-14

### TCPA rejection data minimization — local remediation

TCPA-blocked partner submissions now have a dedicated local contract. The server records only the
tenant, partner, submission id, reason code, optional screening-result reference, and masked phone
last four; it never persists the full phone number in the rejection record. A unique key makes
retries idempotent, the service adapter is the only insert path, and tenant-app reads require both
authenticated tenant and partner scope. The partner response exposes a stable `tcpa_block` code,
count, masked last four, and neutral close script without exposing a blocked-number list. The
reviewed migration is pending live DDL authority, so this is not yet live security evidence.

The following focused checks now pass against namespaced live fixtures: partner lifecycle and access,
verification correction, buffer handoff, deal flow, agent floor, partner-quality reporting and
drill-down isolation, and subscription-limit enforcement. The partner-quality date fixture was aligned
to PostgreSQL UTC so the evidence tests the live predicate rather than a workstation-calendar offset.

The remaining LA security blockers are live-contract issues. Screening and affiliate-dependent flows
fail closed because `consume_meter_capacity` is not present in the shared project; no non-atomic
fallback was introduced. The live `apply_auto_offer_to_subscription` definition still has the older
broad-offer ordering and unpinned `search_path`, and `render_disposition_note` still lacks its pinned
search path. These are pending reviewed, additive migrations and DDL-authorized application.

Transfer-inbox correctness and tenant isolation pass, but the remote timing assertion remains above
one second even though an equivalent `(tenant_id, status, queued_at)` index is live; this is retained
as a performance/environment blocker until server-side query time is measured separately. No
authenticated browser proof has been claimed for these workflows.

## 2026-09-14 dialer gate correction

The dialer now treats browser eligibility as informational until the final server request. The final
click rechecks tenant calling-window policy, tenant suppression, and provider DNC availability, and it
does not open a `tel:` URI if any check fails. The attempt and agent are tenant-scoped before any
update. Disposition completion requires disclosure confirmation, a recorded dial click, a claimed
work item, and the service-only transactional completion function.

Authenticated browser and live-RPC evidence remain open. The absence of the new live function is a
database deployment blocker, not a reason to add a non-atomic client fallback.

The add-on catalog remediation keeps the same boundary: browser requests reach only platform-admin
routes, while catalog writes use the service-role-only `admin_upsert_addon` RPC. The RPC pins an
empty `search_path`, fully qualifies application tables, validates all foreign-key references, and
does not allow live attached grants to be changed in place. Until the additive migration is applied
by a schema owner, the API returns a controlled unavailable response rather than falling back to
direct browser writes.
## LA-2 presentation remediation — 2026-09-14

The dialer selection explanation is a best-effort, tenant-scoped read and never controls whether a
call may be placed. The screen does not expose the scoring number; it shows only the server-provided
reason or a neutral unavailable message. Setter scorecard and roster requests continue through the
existing authenticated tenant role boundary; the UI does not accept a user or tenant scope
parameter. Live RLS and authenticated browser evidence remain required before acceptance.

Appointment reminders use an at-most-once database claim and a unique recipient event key. Customer
email addresses are accepted only when they have a basic valid shape, then still pass the shared
transport's disabled-mode and reserved-test-domain guards. No appointment reminder provider secret or
full phone number is stored in the reminder ledger. The worker is server-only; authenticated users
cannot execute the claim function or mutate reminder events.

## LA-2.12 appointment close-out boundary — 2026-09-14

Close-out reads and writes require the `outbound_dialing` entitlement and the `owner` or `producer`
tenant role. The authenticated request context supplies the tenant and actor; appointment IDs are
revalidated by the server-side RPC. The UI confirmation is not treated as authorization. The write
is audited with `tenant.appointment_outcome_recorded`, and the service does not expose unrestricted
view data to the browser. The reviewed view/RPC migration remains pending live promotion, so live RLS
and browser acceptance are intentionally still open.

## LA-2.2 list-import boundary — 2026-09-14

List import is authorized at the route boundary for the authenticated tenant role and performs
validation, duplicate matching, usage checks, and compliance screening before the final write. The
intended final lead/source commit uses the service-only `import_agent_lead_batch` RPC, which checks
the actor through `tenant_users`, rejects out-of-scope lead/campaign identifiers, and is granted to
no browser role. Read-only inspection on 2026-09-14 found the deployed function still uses the
obsolete `public.users.tenant_id` predicate and therefore fails before writing; the local repair is
`20260914193000_la_2_2_import_actor_membership_fix.sql`. Request idempotency remains tracked per
tenant so retries do not duplicate the batch once the live contract is repaired.

The local contract is not live security evidence until the repair and mapping migrations are
promoted and tested with two authenticated tenants. Vendor mappings are tenant-scoped and vendor
ownership is checked by the reviewed trigger; vendor scrub preview results and a 20k-row resource
benchmark remain open. No non-atomic fallback is permitted.
