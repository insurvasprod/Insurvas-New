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

### 27. Add-ons and overage are still not charged
**From:** SA-2.6 → **retargeted by SA-3.2 (2026-08-30)** · **Significant**

SA-3.2 built the invoice, but only for what **Whop** charges — and Whop charges the plan price and
nothing else. It knows nothing about our add-ons or metered overage, because those are our
concepts, attached to our subscriptions, invisible to a Whop plan.

The decision was to bill extras on a **separate Whop invoice** each period, using their
`create-invoice` API (arbitrary `line_items`, its own number, a hosted `pay_online_url`, and their
collection and dunning for free). **That is not built.**

So today: a tenant with three add-ons and 400 SMS of overage is invoiced for their plan and nothing
else, and the difference is simply not collected. `subscription_addons` keeps detached rows with
`attached_at` / `detached_at`, so a past period can still be reconstructed exactly when this is
built — read that history rather than only current attachments, or an add-on cancelled mid-period
vanishes from the bill it belongs on.

### 37. The two real sandbox payments have no invoices
**From:** SA-3.2 (2026-08-30) · Minor

`plan_a` ($198, the double-charge) and `plan_b` ($249) were both collected before invoice
generation existed, so neither produced an invoice. Replaying their stored envelopes through the
receiver would create them — the generator is idempotent on the provider payment id, so it is safe.

Worth deciding rather than drifting: the `plan_a` one would be created as **mismatched** (we say
$99, the provider charged $198), which is correct and is exactly the record you would want of that
incident.

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
the DDL in order and verify by replaying it into a scratch project. Worth doing **before SA-3**
writes invoices, because financial tables are the worst ones to hold only in a live database.

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

### 40. The void API's success path is untested end to end
**From:** SA-3.3 (2026-08-30) · Minor

Every invoice we hold is `paid`, so the UI can only ever exercise the REFUSAL path — which it does,
correctly. Voiding is covered at the database layer by `verify:invoices` and the rule itself by unit
tests, but no request has ever travelled through `POST /api/admin/invoices/:id/void` to a successful
void, and the audit entry it writes has never been seen.

Closes itself the moment SA-3.4 produces a `past_due` or `overdue` invoice.

### 41. Proration is exact, and nothing calls it
**From:** SA-3.4 (2026-08-30) · **Significant**

`prorate()` produces the ticket's worked example to the cent ($152.61 credit, $275.19 charge, net
**$122.58**) and is covered by twelve tests. **No code path invokes it.**

The decision was: on a mid-period upgrade, switch our subscription and entitlement immediately,
schedule the Whop membership to `cancel_at_period_end`, and raise a separate Whop invoice for the
difference. Only the arithmetic exists. Changing a plan mid-period today moves our side and leaves
Whop billing the old plan until renewal, and **nobody is charged the difference**.

Needs: `PATCH /memberships/{id}` with `cancel_at_period_end`, a new checkout on the new plan, and
the difference invoice — which is the same separate-invoice mechanism [#27] needs for add-ons.
Worth building both at once.

---

## ✅ Resolved

*Terse log — details live in git history.*

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
  `(provider, provider_payment_id)`, which is what makes Whop's at-least-once delivery safe.
  Verified end to end by replaying a real stored Whop payload: `INV-2026-08-0001`, ours 24900 =
  provider 24900, matched.

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
