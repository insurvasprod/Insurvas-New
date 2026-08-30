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

### 21. "Only monthly at checkout" can't be verified yet
**From:** SA-2.4 · **Belongs to:** SA-5.2

SA-2.4's criterion is *"a plan with only `price_monthly` set offers only monthly at checkout."*
There is no checkout — that's SA-5.2.

The **data half is done and tested**: a null cycle price means that cycle isn't offered, and
`availableBillingCycles()` is the single helper that answers the question, with unit tests
(including that **zero is a price but null is an absence** — a free plan must still be buyable).
SA-5.2 should call that helper rather than re-deriving the rule.

### 20. Removing an archived feature from a plan needs a detour
**From:** SA-2.3 · Minor

An archived feature that a plan already grants is preserved on save — deliberately, since the
picker can't offer it and trusting the submitted list would silently revoke it (SA-2.1's rule).
The picker shows it ticked and locked.

Consequence: to genuinely remove one, an admin must un-archive the feature, untick it, then
re-archive. Rare enough to be acceptable; worth a dedicated "revoke" action if it ever bites.

### 16. Archive-doesn't-break-existing-plans — now verified at the data layer
**From:** SA-2.1 → **mostly closed in SA-2.3** · Remaining part belongs to SA-2.8

SA-2.1's criterion: *"archiving a feature does not break plans that already reference it — it
stays enforced for existing subscribers and disappears from the picker."*

Both halves now hold at the data layer, tested in SQL: archiving keeps the row, removes it from
the picker, and **`admin_set_plan_features` re-adds any archived grant the plan already had**, so
saving the picker can't silently revoke it. Verified: archive a granted feature, save without it,
it survives.

Still outstanding: "enforced" ultimately means the agent app honours it, which needs SA-2.8's
entitlement engine. The grant is correct in the database; nothing reads it yet.

---

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

### 8. No browser verification yet for SA-1.1 / SA-1.2 / SA-1.3
**From:** SA-1.1, SA-1.2, SA-1.3

All pass `tsc --noEmit`; SA-1.1 also passed a full `next build`. DB layers were verified directly
in SQL — SA-1.2 (duplicate email → `23505`, no orphan tenant) and SA-1.3 (last-owner demotion
blocked, role unchanged after the block, demotion succeeds with a second owner). But no screen has
been driven in a browser yet. **Part of the end-of-module pass**, per the user's request to batch
builds.

Specifically worth clicking through at that point:
- the full invite → set-password → login round trip
- the email-change → confirm round trip (old address must keep working until confirmed)
- a role change showing up on the tenant side without re-login
- suspending a user with a live session, then confirming their next request drops them
- a suspended user's login showing the suspension message, while a *wrong* password on the same
  account still shows only the generic error

### 9. No CI pipeline exists
**From:** SA-0.2, SA-0.3, SA-2.1

Three tickets now specify acceptance as *"an automated test that runs in CI."* Two real,
repeatable checks exist and neither is wired to anything:

- `npm run verify:tenant-isolation` (SA-0.2) — passes
- `npm run check:features` (SA-2.1) — currently **dormant by design**: it exits 0 while zero
  `requireFeature()` guards exist, and flips to enforcing the moment the first one is written
  (verified in both modes)

SA-2.4 added a third: `npm test` (Node's built-in runner, no new dependency) covering the money
conversions — 9 tests, all passing.

This is now the most overdue item in the file. Standing up even a minimal GitHub Actions workflow
running `next build`, `eslint`, `npm test`, `check:features` and `verify:tenant-isolation` would
close three tickets' criteria at once — and would have caught the server-only bundling bug that
broke the first Vercel deploy.

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

### 27. Add-on prices don't reach an invoice
**From:** SA-2.6 · **Belongs to:** SA-3.2

SA-2.6's criterion *"add-on price appears as a separate line on the invoice"* is **not met** —
there are no invoices. The data needed is in place: `subscription_addons` keeps detached rows with
`attached_at` / `detached_at`, so a past period can be reconstructed exactly.

SA-3.2 should read that history rather than only current attachments, or an add-on cancelled
mid-period will silently vanish from the bill it should appear on.

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
the DDL in order and verify by replaying it into a scratch project. Worth doing **before SA-3**
writes invoices, because financial tables are the worst ones to hold only in a live database.

### 32. The provider panel has never been opened in a browser
**From:** SA-3.1 · Minor

The tenant Payment provider panel, its API route and the call-logging decorator are verified by
`npm run verify:payments` at the database level and by unit tests at the logic level, but the wired
path — click Save, see a `provider_calls` row appear — has not been exercised. Same root cause as
[#8]: admin login needs a TOTP code. Folds into that item's browser pass.

### 36. The deployed receiver is behind the code
**From:** the first real payment (2026-08-30) · **Operational**

The first live webhooks resolved to no tenant, and the resolver was not at fault — `main` still
carries the pre-metadata version of the receiver. Everything since commit `c808d98` (metadata-first
resolution, the Whop provider, plan mapping) is local only.

The stored rows were backfilled by running the current resolver over them, which is what the
column-level UPDATE grant on `webhook_events` exists for. But **until this deploys, every incoming
webhook lands with `tenant_id` null** and SA-3.4 will have nothing to attach a payment to.

### 34. Events are stored and marked handled, but nothing acts on them
**From:** SA-3.1 webhook receiver (2026-08-30) · **SA-3.4**

The receiver verifies, stores, deduplicates and marks processed. The step in the middle — turning
`payment.succeeded` into `subscription active` and rebuilding the entitlement — is a comment
pointing at SA-3.4.

This is safe rather than lossy: the full envelope is in `webhook_events`, so events arriving before
the handler exists can be replayed once it does. But **nothing is reacting to payments today**, and
that should not be mistaken for a working billing integration.

Two things SA-3.4 must handle that the receiver deliberately left alone:

1. **Out-of-order delivery.** Whop does not guarantee ordering — `membership.deactivated` can
   arrive before the `payment.succeeded` that precedes it. `occurred_at` is stored for exactly this
   reason but nothing reads it yet. A handler that applies "last received wins" to subscription
   status will eventually reactivate a cancelled tenant.
2. **Whether `payment.failed` fires on every one of Whop's five retries** while `invoice.past_due`
   fires once. Unconfirmed — the docs do not say. Test it in sandbox before choosing the trigger.

---

## ✅ Resolved

*Terse log — details live in git history.*

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
- **#16 Archiving a feature could break a plan** → SA-2.3. `admin_set_plan_features` re-adds
  archived grants the plan already had, so saving the picker can't silently revoke them.
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
