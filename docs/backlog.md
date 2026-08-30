# Module backlog — deferred items & known gaps

Running list of things deliberately not built, not verified, or knowingly inconsistent, captured
as they came up while building. **Review this at the end of each module** before calling it done.

Each entry says *why* it was deferred and *where it belongs*, so nothing here is a mystery later.

Legend: 🔴 needs a decision · 🟡 blocked on a later ticket · 🔵 unverified · ⚪ tech debt · ✅ resolved

---

## 🔴 Needs a decision

### 1. Create Tenant asks the admin to type the owner's password
**From:** SA-0.2, flagged during SA-1.2 · **Decision:** deferred by user on 2026-08-29

The Create Tenant dialog has a "Temporary password" field. SA-1.2 states explicitly:
*"Out of scope: Setting the user's password directly (admins never see or type a customer password)."*
So the platform now has **two contradictory onboarding paths** — tenant owners get a typed
password, directly-created users get an invite link.

**Fix:** drop the password field from Create Tenant and issue an invite via the same
`admin_create_user` / `user_invitations` machinery SA-1.2 built. Roughly an hour's work.

---

## 🟠 Descoped by decision

### 14. Delete user — not built
**From:** SA-1.4 · **Descoped by user on 2026-08-29:** *"we will only do inactive"*

SA-1.4 as written included Delete with typed confirmation and a 7-day soft delete. The product
owner cut it: users are switched off via **Inactive** (seat freed) or **Suspended** (seat kept,
blocked at login), never removed. No `DELETE /api/admin/users/:id`, no purge job, no Deleted filter.

Two of the ticket's acceptance criteria are therefore **not applicable**, not failed:
- *"Deleting the last `owner` of a tenant is blocked"* — no delete exists. (The equivalent guard
  for role changes **is** built and tested, in SA-1.3.)
- *"A soft-deleted user's email cannot be reused until the 7 days elapse"* — no soft delete exists.

The `deleted` value still exists in the `user_status` enum and is filtered out of the Users screen
throughout, so re-introducing this later is additive rather than a migration.

---

## 🟡 Blocked on a later ticket

### 3. No plan selector when creating a user
**From:** SA-1.2 · **Belongs to:** a small follow-up

SA-1.2's criterion *"Selecting a plan attaches a subscription in `active` state"* is still unmet as
written, but everything it needs now exists: SA-2.7 built assignment, and a tenant gets a
subscription via the tenant detail page.

What's left is purely convenience — a plan selector on the Create User form that calls
`admin_assign_subscription` for a **newly created** tenant. Small, and arguably better as a
deliberate second step anyway, since it forces a billing-cycle choice.

### 4. No email is actually sent
**From:** SA-1.2 · **Belongs to:** SA-4.11

`lib/email/sendInvitationEmail.ts` logs the invite and returns `delivered: false`. The admin UI
compensates by showing a copyable link. **The invite flow itself is complete and real** — 72h
expiry, hashed tokens, resend, revocation. Only the transport is missing.

**Fix:** replace that one function body when SA-4.11 picks a provider. No caller changes.

### 6. Users list still reads the wrong plan source — STILL OPEN
**From:** SA-1.1 · ⚠️ **Now definitely wrong, not just empty. Worth doing next.**

The Users list's Plan column (and its filter) read `tenants.plan_code` — a free-text column from
SA-0.2 that nothing writes. SA-2.7 completed the real source of truth: `subscriptions.plan_id` →
`plans`, which the tenant detail page reads correctly.

**SA-2.7 did not repoint the Users screen**, so a tenant can now genuinely be on Plan B while the
Users list shows "No plan yet". Two notions of the same fact, and the screen reads the dead one.

Fix: repoint `admin_user_list.plan_code` at the subscription's plan, then drop `tenants.plan_code`
rather than leaving a decoy column that will mislead the next person.

### 20. Removing an archived feature from a plan needs a detour
**From:** SA-2.3 · Minor

An archived feature that a plan already grants is preserved on save — deliberately, since the
picker can't offer it and trusting the submitted list would silently revoke it (SA-2.1's rule).
The picker shows it ticked and locked.

Consequence: to genuinely remove one, an admin must un-archive the feature, untick it, then
re-archive. Rare enough to be acceptable; worth a dedicated "revoke" action if it ever bites.

## 🔵 Unverified

### 7. Users list performance at scale — NOT verified
**From:** SA-1.1 · **User opted out on 2026-08-29**

The criterion *"page loads in under 1 second with 5,000 users seeded"* was **not tested** — the
user declined seeding 5,000 throwaway rows into the Supabase project.

Built *for* it: server-side pagination (20/page), `count: 'exact'` rather than loading all rows,
trigram GIN indexes on `users.name`/`users.email` for `ilike` search, plus btree indexes on
`status`, `created_at`, `last_login_at`. **Treat the number as an assumption, not a result.**

The same applies to SA-1.5's *"activity screen loads with 50,000 login rows without timing out"* —
also unverified, same reasoning, same decision carried forward. Built for it with pagination
(25/page) and a `ts desc` index on `login_events`.

One thing worth watching if either is ever load-tested: `admin_user_list.distinct_ips_24h` is a
correlated subquery. Postgres should only evaluate it for rows surviving `LIMIT`, but that is a
planner behaviour, not a guarantee — if the Users list ever slows down at scale, check this first.

### 8. Browser verification — now unblocked, mostly still undone
**From:** SA-1.1, SA-1.2, SA-1.3 · **Blocker removed 2026-08-30**

The reason this never happened was admin login needing a TOTP code. That is solved: an admin
session token can be minted locally from `ADMIN_SESSION_SECRET` and set as the
`insurvas_admin_session` cookie, which is how SA-3.3's screens were verified in a real browser.

Still unverified by clicking: the invite → set-password → login round trip, the email-change →
confirm round trip (the old address must keep working until confirmed), a role change appearing on
the tenant side without re-login, seat-limit enforcement at the limit, and the plan version editor.

**Verified in a browser so far:** the invoice list, detail and print screens (SA-3.3).

### 9. No CI pipeline exists
**From:** SA-0.2, SA-0.3, SA-2.1

Several tickets specify acceptance as *"an automated test that runs in CI."* The repository now
has a substantial verification surface — 119 unit tests at the end of SA-3 plus dedicated scripts
for tenant isolation, feature keys, entitlements, payments, webhooks, invoices, subscription
events, coupons, custom invoices and credit notes — but `.github/workflows/` still does not exist.

`npm run check:features` is no longer dormant: it hard-fails references to unknown feature keys and
reports the remaining 25 unguarded features as TODO until the agent app exists. The flag that makes
complete guard coverage mandatory still needs to be flipped when LA-0.1 ships those routes.

**Fix:** add a PR workflow for `next build`, `eslint`, `npm test` and `check:features`. Database
verification scripts should run against a disposable/staging Supabase project, not production,
because several intentionally create and clean up rows. Add tenant isolation there or as a
scheduled integration job. This would have caught the server-only bundling bug that broke the
first Vercel deploy.

---

## ⚪ Tech debt

### 11. `middleware.ts` uses a deprecated convention
**From:** SA-0.3

Next.js 16 wants `proxy.ts`. Still fully functional; emits a deprecation warning every build.
Fix: `npx @next/codemod@canary middleware-to-proxy .`

### 12. 2FA reset is CLI-only
**From:** SA-0.1

`npm run reset:totp -- <email>` is the only way to re-enroll an admin who loses their authenticator.
Fine at 2–3 admins; wants an in-app super_admin-only action (itself audited) as the team grows.

### 13. Direct Postgres host is IPv6-only
**From:** SA-0.2 · **Deployment note**

`db.<ref>.supabase.co` resolves AAAA-only on this project tier and isn't reachable from every
network. `TENANT_DB_URL` therefore points at the Supavisor pooler (IPv4, transaction mode).
Already handled — noted so nobody "fixes" it back to the direct host.

---

### 22. Metered actions have nothing to meter yet
**From:** SA-2.5 · **Belongs to:** LA-0.1 and the agent-side features

`checkMeterCapacity()` / `consumeMeter()` are built and tested, but nothing calls them — there is
no dialer, no TCPA checker, no statement importer.

The blocking behaviour **is** proven (at 1000/1000 of a hard-capped meter the check returns
`allowed=false, reason=over_cap`); what is unproven is that a real feature honours the answer.
Whoever builds the first metered action must call `consumeMeter()` **before** acting, not after.

### 28. Guard coverage is 2 of 27 features
**From:** SA-2.8 · **Belongs to:** LA-0.1

SA-2.8 built `requireFeature()` and proved it works, but only two features have an actual API
route to guard (`book_of_business`, `chargeback_radar`) — the rest have no agent-facing endpoint
yet, so there is nothing to protect.

`npm run check:features` reports this as **TODO, not FAIL**, deliberately: a check that stays red
for months trains people to ignore it. There is a single flag in that script,
`GUARD_COVERAGE_MUST_BE_COMPLETE`, to flip once LA-0.1 has built the agent app — from then on an
unguarded feature genuinely means a route shipped without protection.

**Do not forget to flip it.** A guard referencing a non-existent key already fails hard, since
that's always a bug regardless of how complete the app is.

### 23. `consumeMeter` check-then-record is not atomic
**From:** SA-2.5 · Minor, deliberate

The capacity check and the usage record are two separate statements, so a burst of concurrent
calls could each pass the check before any of them records — overshooting a hard cap by roughly
the concurrency level.

Accepted for now: the overshoot is small and bounded, and SA-3 bills overage anyway. If a meter
ever needs a strict ceiling (a legal one, say), this needs to become a single transaction that
locks the total row.

### 24. Nothing *schedules* the period rollover
**From:** SA-2.5, narrowed by SA-2.7 · **Belongs to:** SA-6.1

SA-2.7 built `advance_billing_periods()` and `npm run advance:periods`, which rolls ended periods,
applies queued downgrades, completes cancellations and resets meter allowances. Verified end to end.

What's still missing is a **scheduler**. Until SA-6.1 runs this on a cron, a queued downgrade only
applies when a human runs the script — and per the doc, a job that silently never runs looks
identical to a healthy one. SA-6.1 should schedule it *and* alert on missed runs.

### 26. Add-on CRUD is read-only in the UI
**From:** SA-2.6 · Minor

The Add-ons screen lists everything with its price, granted features and credits, but there's no
create/edit form — the four seeded add-ons came from the migration. Attaching and detaching them
to subscriptions **is** fully built.

Adding a new add-on today means a migration. Worth a dialog (same shape as the plan editor) if the
business starts iterating on them; not urgent while the catalog is four rows that rarely change.

### 38. An invoice can still be deleted
**From:** SA-3.2 (2026-08-30) · Minor

UPDATE is revoked on every column of `invoices` except the lifecycle ones, and `invoice_lines`
refuses UPDATE and DELETE outright. But `invoices` itself can still be DELETEd by the application.

Deleting a financial record is worse than editing one, and the correct operation is already
built — `void`. DELETE is currently retained only so verification scripts can clean up after
themselves; the same tension as `usage_events`, resolved the other way. Before real customers,
revoke it and give the test scripts a dedicated path.

### 29. The database schema lives only in Supabase, not in the repo
**From:** end-of-SA-2 push · **Significant**

Surfaced while preparing the SA-2 pull request: `git ls-files` shows no `.sql` anywhere. Every
table, RLS policy, grant/REVOKE and all ~14 functions (`admin_save_plan_version`,
`resolve_tenant_entitlement`, `refresh_tenant_entitlement`, `advance_billing_periods`,
`record_usage`, …) were applied straight to project `iiimdgizjwnihpyrukbu` and exist nowhere else.

Three consequences, in order of how much they'd hurt:

1. **A fresh clone cannot run.** The TypeScript in this repo is a client of a schema it doesn't
   contain. New machine, new environment, or a restore from a git backup all produce an app that
   compiles and immediately fails at runtime.
2. **No review of the security-critical half.** The REVOKEs that make `audit_log` and
   `usage_events` append-only, and the `tenant_app` NOBYPASSRLS role that makes isolation real,
   are the parts most worth a second pair of eyes — and they never appear in a diff.
3. **No rollback.** There is no record of what a migration changed, so there's nothing to revert.

Not a code fix — it's an export. Either `supabase db pull` into `supabase/migrations/`, or hand-write
the DDL in order and verify by replaying it into a scratch project. This was already worth doing
before SA-3; it is now overdue because the live-only schema also contains invoices, payments,
coupons, credit notes and revenue metrics.

### 32. The provider panel has never been opened in a browser
**From:** SA-3.1 · Minor

The tenant Payment provider panel, its API route and the call-logging decorator are verified at the
database and unit level but never clicked. No longer blocked — see #8 for how to get a session —
just not done.

### 39. Two invoice filters exist in the API but not the UI
**From:** SA-3.3 (2026-08-30) · Minor

The ticket asked for filters on status, tenant, date range and overdue-only. The screen has status,
overdue-only and mismatched-only; **tenant and date range are supported by `GET /api/admin/invoices`
but have no control**. Both are a couple of inputs once there are enough invoices for filtering to
matter — with two rows it would be furniture.

### 48. The 2-second / 500-tenant target is unverified
**From:** SA-3.9 · Unverified

The dashboard reads a snapshot table rather than aggregating live, which is what the target asks
for, and every figure comes from one indexed table scan over at most 31 rows. But it has never been
run against 12 months of data and 500 tenants — the same position as [#7], and for the same reason.

### 45. The provider refund call has never been executed
**From:** SA-3.8 (2026-08-30) · **Unverified**

Everything guarding a refund is verified: the threshold, the pending queue, the self-approval
refusal (in the route *and* as a database constraint), and that a failed execution is left in
`failed` with a reason. **The `POST /payments/{id}/refund` call itself has never run.**

Deliberately: the only refundable payments are the two real sandbox charges, and a refund is
irreversible. `WhopProvider.refund()` is written against the documented endpoint and unit-tested
against a stubbed fetch, but the live path is unproven — the same status the plan and promo calls
had before they were exercised, and both turned out to have bugs.

Worth spending $1 of sandbox money on a partial refund to close it.

### 46. Credit balances are never applied automatically
**From:** SA-3.8 (2026-08-30) · Minor

A credit reaches `tenant_credits.balance_cents`, and `redeemCreditAsFreeDays()` converts it into
free days on the Whop membership. **Nothing calls that automatically** — there is no control on the
tenant page and no job. The balance is recorded and visible; turning it into value is a manual step
that currently has no button.

The ticket's criterion "an unused credit balance is applied to the next invoice automatically and
shown as its own line" is therefore **unmet**. On automatic billing there is no invoice of ours to
apply it to before Whop charges; free days are the workable equivalent and they need wiring up.

### 44. Add-ons, overage, proration and waivers still do not reach an invoice
**From:** SA-3.7 / SA-3.8 (2026-08-30) · **Significant** — consolidates former [#27] and [#41]

SA-3.7 built the machinery both were waiting for: `create_custom_invoice` raises an arbitrary
invoice from the shared number sequence, and `WhopProvider.createInvoice` sends it for online
payment. **Nothing calls it for either purpose yet.**

What remains is a job that, at each period rollover, gathers a tenant's attached add-ons, their
metered overage above the plan allowance, any pending proration from a mid-period upgrade, and any
billing-admin waiver that must remove an overage line before issue. It then raises one custom
invoice for the lot. The custom-invoice pieces exist; the period billing assembler and waiver
model do not.

Until then: a tenant with add-ons is billed for their plan only, overage is free, and a mid-period
upgrade charges nobody the difference.

### 42. Coupons are creatable but not yet attachable from a screen
**From:** SA-3.6 (2026-08-30) · Minor

`POST /api/admin/subscriptions/:id/coupon` applies a coupon and `DELETE` removes it, both
audit-logged and enforced atomically in SQL. **Neither has a control on the tenant page** — the
Coupons screen creates and lists them, but attaching one to a customer is API-only today.

A picker on the subscription panel, next to add-ons. Small, and worth doing before anyone is asked
to use coupons in anger.

### 43. Applying a coupon to an ALREADY-RUNNING membership is unverified
**From:** SA-3.6 (2026-08-30) · **Unverified**

Our side attaches the coupon and the discount appears on the next invoice we generate. Whether the
customer is actually charged less depends on Whop applying the promo to an existing membership,
and **that has not been tested**.

Whop documents an `existing_memberships_only` flag "for cancellation retention offers", which
implies it is possible, but not the mechanism. Until it is confirmed in the sandbox, a coupon
applied mid-subscription may show a discount on our invoice that the card never received — which
reconciliation would correctly flag as `mismatched`.

Coupons applied **at checkout** are the verified path.

### 49. A failed provider refund alerts nobody
**From:** SA-3.8 acceptance criteria · **Significant**

`executeCreditNote()` correctly leaves a refused refund in `failed`, stores `failure_reason`, logs
to the server console and returns the failure to the admin who clicked. It does **not** alert a
billing admin after that request ends. A failure during an automated retry or webhook path can sit
unseen until someone opens Credit Notes.

**Fix:** emit an operational alert through the notification/email seam and record delivery. This
depends naturally on SA-4.11 (email configuration) or the job/alert infrastructure in SA-6.1.

### 50. Public-schema RPC functions still grant EXECUTE to PUBLIC
**From:** live Supabase audit after SA-3 · **Security hardening**

The inspected `admin_*`, billing, metering, entitlement and metrics functions are `SECURITY
INVOKER`, which is safer than definer functions, but their ACL includes `=X/postgres`: every role
inheriting PUBLIC — including `anon` and `authenticated` — may invoke them. RLS currently blocks
the underlying tables for those roles, so this audit did not prove an immediate data escape.
However, these functions are exposed as callable RPC surface and a future permissive policy could
turn a harmless grant into a privilege escalation.

**Fix:** revoke EXECUTE from PUBLIC, `anon` and `authenticated` for control-plane functions; grant
only `service_role` (and a narrowly scoped tenant role only where genuinely required). Add a test
that anonymous RPC calls are denied.

### 51. The revenue dashboard is a truthful partial implementation, not the full ticket
**From:** SA-3.9 acceptance criteria · **Significant**

The page deliberately labels expansion and contraction as **not measured**. It also has a fixed
31-day revenue window and 90-day funnel window, no date/plan controls, no churn-by-plan calculation,
and no trial-to-paid conversion rate. Two funnel steps — completed profile and completed setup —
remain uninstrumented. This is honest UI, but several explicit SA-3.9 outcomes are still unmet.

**Fix:** record plan-change MRR deltas and real funnel events, extend `metrics_daily` for per-plan
churn and trial conversion, and add date/plan filters. Performance against 500 tenants remains [#48].

---

## ✅ Resolved

*Terse log — details live in git history.*

- **#47 A provider checkout created no subscription** -> SA-5.2. `create_subscription_from_checkout`
  is called from BOTH the return handler and `membership.activated`, idempotent on the tenant,
  because either can arrive first and either can be the only one that arrives. Verified both paths
  separately and together: returning twice creates one subscription, and a customer who closes the
  tab still gets one.
- **#21 "Only monthly at checkout" could not be verified** -> SA-5.2 calls `availableBillingCycles()`
  on the raw price row rather than re-deriving the rule, so a cycle with no price cannot be sold.
- **SA-5.2 hosted checkout** -> verified 17/17 against a real Whop sandbox checkout. The trial lives
  on the mapped Whop plan, not the checkout configuration: Whop only accepts `trial_period_days` on
  a plan, and a checkout takes either `plan_id` OR an inline plan, so putting it on the checkout
  would have meant abandoning the (plan version, cycle) mapping that makes grandfathering work.

- **SA-5.1 review (2026-08-30).** Host-header injection in verification links: `buildVerificationUrl`
  fell back to `request.nextUrl.origin` when `NEXT_PUBLIC_APP_URL` was unset — and it was unset. An
  attacker could sign up with a victim's address and a forged `Host`, and the victim would receive a
  genuine email from our domain whose link handed the token over. The fallback is gone; missing
  configuration now throws.
- **Public endpoints had no rate limiting.** Signup created a user, a tenant and an email per call,
  and `change_email` would send verification mail to an ARBITRARY address. Now database-backed
  (serverless instances share no memory), claimed in a single statement so concurrent requests
  cannot both take the last slot. Verified 7/7, including ten concurrent claims letting exactly
  three through.
- **The self-serve signup flow could not complete.** `save_signup_business_profile` raised 42702 —
  its `RETURNS TABLE(tenant_id …)` OUT parameter collided with `on conflict (tenant_id)` — so the
  business-profile step threw at runtime. Fixed with `#variable_conflict use_column`; the sibling
  fix in `20260830010200` could not be reused because an ON CONFLICT target must name the column
  bare. Codex's own `verify:signup` script now passes; it was failing before.
- **A review finding of mine that was wrong:** I reported that the app shell did not gate
  unverified users. It does — new users get `pending_verification` and `signupDestination` redirects
  them to `/app/verify-email`. My grep pattern missed the helper names and I drew a conclusion from
  an absence I had not established.

- **SA-3.9 revenue dashboard** → MRR/ARR/ARPC, churn, plan breakdown and the activation funnel, off
  a nightly `metrics_daily` snapshot that is re-runnable for any past date. Contracted MRR is shown
  beside collected, and the gap is called out — which immediately surfaced [#47]. Two funnel steps
  render as *not instrumented* rather than zero, and are excluded from the biggest-drop-off
  sentence so it cannot name a step nobody measures.
- **Payments were only recorded when a subscription already existed** → fixed in SA-3.9. The
  `recordPayment` call sat after an early return in `applyProviderEvent`, so both real charges were
  invisible. Moved before the subscription lookup and the two payments backfilled: money arriving
  is a fact about the tenant, not about our subscription records.

- **SA-3.8 refunds and credit notes** → verified 14/14. The control the ticket exists for is
  enforced twice: the route refuses a self-approval, and so does a database CHECK constraint that
  no code path can route around. Approval was exercised through the real HTTP route with a second
  admin's session, not by writing the row. Credit notes take a `CN-` series from the same gap-free
  counter as invoices, generalised to (series, year, month) rather than duplicated.

- **#40 The void/mark-paid success path was never exercised through the API** → closed by SA-3.7.
  Custom invoices are born *issued*, which finally produced an unpaid invoice; `verify:custom`
  settles one through the real HTTP route with a minted admin session and asserts the subscription
  reactivates and both actions are audit-logged.
- **SA-3.7 custom invoices and manual billing** → verified 18/18. Manual billing pauses the Whop
  membership: confirmed against the sandbox that this flips `payment_collection_paused` to true
  while leaving `status` as "active" — reading `status` would wrongly suggest the pause failed.

- **SA-3.6 coupons** → Whop promo codes are the real discount, mirrored locally for the UI, the
  invoice line and the audit trail. The redemption cap, one-coupon-per-subscription and the
  duration countdown are all enforced in SQL in a single locked transaction, because checking a
  count and then incrementing it lets two admins both claim the last slot. Verified 13/13,
  including that a 3-period coupon consumes exactly three periods and then deactivates itself with
  no scheduled job. **`promo_duration_months: 0` means forever** — checked against the sandbox
  rather than assumed, since Whop's docs never say.

- **#34 Events stored but nothing acted on them** → SA-3.4. Provider events now drive subscription
  status and rebuild the entitlement immediately. Out-of-order delivery is handled by discarding
  any event older than the last one applied, verified with a deliberately stale event that would
  otherwise have reactivated a failing tenant. `payment.failed` keeps FULL access while Whop
  retries; read-only starts only when Whop gives up.

- **SA-3.3 invoice screens** → list with totals strip, detail, print view and void. The strip's
  numbers are derived from the same rows the filters read, so "the overdue filter matches the strip"
  is true by construction rather than by two calculations agreeing. Verified in a real browser
  against real data: mismatched filter 1 = strip 1, overdue 0 = strip 0. `INV-2026-08-0001` renders
  its $99-vs-$198 disagreement, and Void is correctly refused on it because it was paid.

- **SA-3.2 invoice generation** → built and verified. Numbering is gap-free via a counter row
  updated in the invoice's own transaction, **not** a Postgres SEQUENCE — `nextval` does not roll
  back, so a failed invoice would burn its number permanently. Generation is idempotent on
  `(provider, provider_payment_id)`, which is what makes Whop's at-least-once delivery safe. Real
  stored Whop payloads verified both the matched and mismatched reconciliation paths.
- **#37 The two pre-invoice sandbox payments had no invoices** → closed by replay/backfill. The
  $198 Plan A double-charge is retained as a mismatched financial record ($99 expected), and the
  $249 Plan B payment reconciles. Provider payment idempotency prevents replay duplicates.

- **SA-3.1 proven end to end (2026-08-30).** A second sandbox payment on `plan_b` — whose Whop plan
  was created entirely by the corrected code rather than patched by hand — charged **$249.00 for a
  $249.00 plan**, once. The earlier `plan_a` purchase charged $198 for a $99 plan under the
  `initial_price` bug. Tenant resolved automatically from metadata on both `payment.succeeded` and
  `membership.activated`, with no backfill.

- **#33 Whop payload shapes unseen** → closed 2026-08-30 against three real sandbox events.
  `data.metadata.tenant_id` arrives exactly as sent and resolves to the right tenant on both
  `payment.succeeded` and `membership.activated`. The dashboard's own test event correctly resolves
  to **no** tenant — it carries placeholder ids and no metadata.
- **#35 No Whop product** → created `prod_2hPt3oh77ziBp`, business `biz_Pj5jnt92mDCBZN`. Plan A
  monthly maps to `plan_fCpKbKKfCqYZT`.

- **#30 `createCharge` was the wrong shape for Whop** → SA-3.1. The interface now leads with
  `createCheckoutSession()`, and `createCharge` is **optional** — absent on Whop, which never lets
  us originate a charge, present on the dummies so decline and timeout paths stay testable offline.
  The logging decorator attaches it only when the wrapped provider has one, so
  `provider.createCharge` is not falsely truthy for Whop. Reshaped while it still had zero callers,
  as planned.

- **#31 Nothing receives webhooks** → SA-3.1 built `/api/webhooks/whop`: hand-written Standard
  Webhooks HMAC-SHA256 verification (their SDK helper has not shipped), a 5-minute replay window,
  and `webhook_events` unique on `(provider, event_id)`. Deduplication keys on **processed_at, not
  row existence** — Whop reuses the webhook-id across 12 retries, so treating any repeat as a
  duplicate would permanently lose an event we stored but failed to handle. Verified against the
  running app with the real secret: 8/8, including a body altered after signing (401) and rejected
  requests writing nothing to the table.

- **#15 Seats were documentation-only** → SA-2.5 enforces `max_seats` at user creation. Verified:
  blocked at the limit, `inactive` frees a seat, `suspended` keeps one (matching SA-1.4's table).
- **#19 Menu defined but not rendered to agents** → SA-2.8. `/app` now renders
  `buildAgentMenu(entitlement.features)` — the same function the admin preview uses, so the
  preview is accurate by construction.
- **#25 Rolled periods left a stale entitlement** → SA-2.8 put the refresh in SQL
  (`refresh_tenant_entitlement`), so `advance_billing_periods()` refreshes it directly. Verified:
  rollover bumped the cached version 6→7 and the plan reverted correctly.
- **#17 `subscriptions` was a stub** → SA-2.7 filled it in: billing cycle, trial end, period
  start/end, queued plan change, cancel-at-period-end, reason. Both decisions SA-2.2 flagged were
  kept deliberately — `plan_id` points at a specific version (that's what makes grandfathering
  work), and one live subscription per tenant is now enforced in `admin_assign_subscription` too.

- **#10 Admin sessions ignored `is_active`** → SA-1.3. `requireAdminRole()` resolves role and
  active state from the DB per request instead of trusting the 12h JWT. Same fix applied to the
  tenant side, which is what makes SA-1.3's "role change applies on next request" true.
- **#5 Failed logins were invisible** → SA-1.5. `login_events` records every attempt for **both**
  planes, not just tenant users as the ticket specified. SA-6.2 inherits the signal.
- **#2 Invited users read as "Active"** → SA-1.4, settled as a deliberate no-change: status is the
  admin lifecycle, invite acceptance is a separate axis with its own badge.
- **#16 Archiving a feature could break a plan** → fully closed by SA-2.3 + SA-2.8.
  `admin_set_plan_features` preserves archived grants, and the shared entitlement/menu path now
  continues enforcing those grants for existing subscribers.
- **#18 Plan pricing not built** → SA-2.4.
- **Audit log pagination** → fixed in the CRM-styling pass; was hard-capped at 100 rows.
- **Sidebar icon crash** → Lucide components were being passed as props from a Server Component;
  now passes a string key resolved on the client.
- **Server-only code in the client bundle** → broke the first Vercel deploy. `tsc` cannot catch
  this class of bug; see [[verify-with-real-build-not-just-tsc]] in memory.

---

## Related

Items 9, 11, 12 are also captured in the Notion ticket
[SA-0.4 · M0 foundation hardening & follow-ups](https://app.notion.com/p/3ca75c44dafd8109b624e2a2387b2cfe).
This file is the working copy; keep both in step when triaging.
