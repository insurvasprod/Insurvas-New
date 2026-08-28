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

### 15. "Seat counted?" is not enforced
**From:** SA-1.4 · **Belongs to:** SA-2.5 / SA-3

SA-1.4's state table says `inactive` frees a seat while `suspended` keeps (and keeps billing) one.
Nothing counts seats yet — there is no plan, no `max_seats`, no billing. The distinction is
currently **documentation only**. It becomes real when limits land in SA-2.5.

---

## 🟡 Blocked on a later ticket

### 3. No subscription attached on user creation
**From:** SA-1.2 · **Belongs to:** SA-2.7

SA-1.2's criterion *"Selecting a plan attaches a subscription in `active` state"* is **unmet**.
There is no `plans` table and no `subscriptions` table — SA-2.x owns plans, SA-2.7 owns assigning
them. Building a subscriptions schema now would pre-empt a design SA-2 has to make anyway.
No plan selector exists on the Create User form.

### 4. No email is actually sent
**From:** SA-1.2 · **Belongs to:** SA-4.11

`lib/email/sendInvitationEmail.ts` logs the invite and returns `delivered: false`. The admin UI
compensates by showing a copyable link. **The invite flow itself is complete and real** — 72h
expiry, hashed tokens, resend, revocation. Only the transport is missing.

**Fix:** replace that one function body when SA-4.11 picks a provider. No caller changes.

### 6. Plan column is present but always empty
**From:** SA-1.1 · **Belongs to:** SA-2.x

The Users list has a Plan column reading `tenants.plan_code`, and a plan filter whose options come
from distinct plan codes in use. Both are correct and will light up on their own once SA-2 ships
plans — until then the column reads "No plan yet" and the filter has one option. Intentional.

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
**From:** SA-0.2, SA-0.3

Both tickets say acceptance is *"an automated test that runs in CI."* `npm run verify:tenant-isolation`
is a real, repeatable check that passes — it just isn't wired to anything. Worth standing up before
SA-2/SA-3 add more criteria of the same shape.

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

## ✅ Resolved

### 10. Admin sessions didn't re-check `is_active` per request
**From:** SA-0.1 → **fixed in SA-1.3.** `requireAdminRole()` now resolves role and active state
from the database on every call (`resolveAdminContext`) instead of trusting the 12h JWT.
Deactivating or demoting an admin takes effect on their next request. Costs one indexed query
per admin API call.

The same fix was applied to the tenant side for SA-1.3's own criterion: `TenantSessionPayload` no
longer carries a role at all, and `resolveTenantContext()` reads the live role from `tenant_users`.

### 5. Failed logins were invisible
**From:** SA-0.3 → **fixed in SA-1.5**, and extended past what that ticket asked for.

`login_events` records every attempt — success and failure, with IP, user agent and a reason —
for **both** tenant users and admins. The ticket's own data model covered tenant users only;
admins were added because the admin panel is the more security-sensitive plane, and a run of
failed 2FA attempts against a `super_admin` was exactly the blind spot.

SA-6.2 (rate limiting / brute-force protection) now has the signal it needs rather than having
to build the recording layer first.

### 2. Invited users reading as "Active" before they accept
**From:** SA-1.2 → **settled in SA-1.4 as a deliberate no-change.**

Status and invite-acceptance are two different axes, and conflating them would break the state
table SA-1.4 defines. `status` answers *has an admin switched this account on?*; the separate
"Invite pending" badge answers *has the person finished onboarding?* An invited user is
legitimately `active` — they simply have no password yet, and login rejects a null hash.

Adding an "Invited" status would also make the counter strip ambiguous (is an invited user counted
as active?). Left as-is; the badge already communicates it.

### Audit log pagination
**From:** SA-0.3 → fixed during the CRM-styling pass. Was hard-capped at 100 rows with no
indication more existed; now has real server-side pagination (20/page, `count: 'exact'`).

### Sidebar icon serialization crash
**From:** the CRM-styling pass. Lucide icon components were being passed from a Server Component
to a Client Component as props, which React rejects. Now passes a string key resolved to a
component inside the client component.

---

## Related

Items 5, 9, 10, 11, 12 are also captured in the Notion ticket
[SA-0.4 · M0 foundation hardening & follow-ups](https://app.notion.com/p/3ca75c44dafd8109b624e2a2387b2cfe).
This file is the working copy; keep both in step when triaging.
