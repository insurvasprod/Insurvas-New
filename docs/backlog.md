# Module backlog — deferred items & known gaps

Running list of things deliberately not built, not verified, or knowingly inconsistent, captured
as they came up while building. **Review this at the end of each module** before calling it done.

Each entry says *why* it was deferred and *where it belongs*, so nothing here is a mystery later.

Legend: 🔴 needs a decision Â· 🟡 blocked on a later ticket Â· 🔵 unverified Â· âšª tech debt Â· ✅ resolved

## 🔴 Needs a decision

### 1. ✅ RESOLVED — Create Tenant no longer asks anyone to type a customer's password
**From:** SA-0.2, flagged during SA-1.2 Â· deferred 2026-08-29 Â· **Resolved:** 2026-09-13

The Create Tenant dialog had a "Temporary password" field, while SA-1.2 states in its own
out-of-scope line: *"Setting the user's password directly (admins never see or type a customer
password)."* The platform therefore had two contradictory onboarding paths — tenant owners got a
typed password, every other user got an invite link.

Closed as part of 193, because they were the same defect seen from two sides. The route that
consumed the password was calling an RPC that could not work; putting it on the supported
Auth-first path removed the need for the field entirely rather than merely hiding it.

What changed:

    lib/tenants/schemas.ts                    ownerPassword dropped from createTenantSchema
    components/admin/create-tenant-dialog.tsx the password input removed; the dialog now shows
                                              the invitation link on success
    app/api/admin/tenants/route.ts            creates the Auth identity and invites the owner

The dialog stays open after a successful create, showing the link. Closing it would be right if the
administrator had nothing left to do — but when mail delivery fails the link is the only way the
owner reaches the account, and it is not recoverable once the dialog closes. The estimate in the
original entry was "roughly an hour's work", which turned out to be about right.

### 76. Nine of the eleven settings the ticket lists were not created  *(was #53 on the module-4 branch — renumbered on merge, where main had already used #53 for something else)*
**From:** SA-4.1 Â· **Decided while building, 2026-08-30**

SA-4.1 names eleven keys under *"Settings needed by the tasks above."* Two of them exist. The store
holds four keys in total — the other two were added because they have real consumers that the
ticket did not anticipate.

**Created, and read by something today:**
`users.invite_expiry_hours` Â· `platform.default_currency` Â·
`billing.refund_approval_threshold_cents` (added, from SA-3.8) Â·
`usage.warn_percent` (added, from SA-2.5)

**Not created, and why:**

- `billing.dunning_steps_days`, `billing.suspend_after_days`, `billing.cancel_after_days` — SA-3.5
  was cancelled because Whop runs its own dunning on its own schedule. These three describe a
  ladder this platform does not operate. Creating them would put three controls on a screen that
  change nothing, and the next person would wire something to them to make them true.
- `billing.default_trial_days` — `plan_prices.trial_days` already owns trial length, per plan,
  which is finer-grained and already used. A global default would be a second answer to a question
  that already has one.
- `billing.invoice_due_days` — there is no due-date default to configure. `due_at` is nullable and
  set per invoice by the admin raising it (SA-3.7); nothing computes one.
- `billing.invoice_number_prefix` — the `INV` prefix is inside the SQL function
  `allocate_invoice_number`, not in application code. It could be made configurable, but changing
  a prefix partway through a sequence is exactly what SA-3.2's "sequential, no gaps" requirement
  exists to prevent, so it should stay fixed unless somebody argues otherwise.
- `users.soft_delete_days` — soft delete does not exist. Delete was descoped (#14 above).
- `users.session_idle_hours` — no idle timeout is implemented anywhere. Session lifetime is a
  fixed 12h TTL baked into the token at signing, which is a different thing (see #50).
- `platform.maintenance_mode` — SA-4.12 owns maintenance mode and needs three states, not a
  boolean. A boolean here would have to be migrated away the moment that ticket starts.

The governing rule, applied throughout: **a setting nothing reads is worse than no setting.** It
looks like a control, changes nothing, and invites someone to make it real later for the wrong
reason. Each key above becomes one registry entry plus one call site on the day something actually
reads it — the machinery is built and tested.

**Fix:** none. Recorded so that the gap between the ticket's list and the store is a decision on
the record rather than something that looks like an oversight.

### 77. Payment credentials remain environment configuration, not database data  *(was #54 on the module-4 branch — renumbered on merge, where main had already used #54 for something else)*
**From:** SA-4.2 Â· **Decided while building, 2026-08-30**

The Whop API key, base URL, webhook secret, product ID and account ID remain in process
environment variables. SA-4.2 deliberately does not add `credentials_enc`, a `mode` column, a
custom encryption helper or a Postgres secret store. A master key for custom encryption would also
live in the environment; moving the ciphertext into a service-role-readable table would widen the
blast radius rather than create a secret manager. The Basic Idea document calls for a real secret
manager, and a database row is not one. Swapping sandbox for production therefore remains a key
and base URL change, not a code change.

**Fix:** none. Keep credentials out of the settings store and database until a real secret-manager
integration is selected.

### 78. SA-4.2 original unchecked criteria not implemented after the Whop-only decision  *(was #55 on the module-4 branch — renumbered on merge, where main had already used #55 for something else)*
**From:** SA-4.2 acceptance checklist Â· **Decision:** Whop-only scope retained on 2026-08-30

The original ticket still contains seven checkbox criteria, but most describe the two-provider
product that was removed. The complete disposition is recorded here so the unchecked boxes are not
mistaken for unfinished Whop work:

- **Both providers enabled and shown at checkout — NOT APPLICABLE.** Stripe/PayPal-style parallel
  provider selection was removed. The product has one active provider: Whop.
- **Disable a provider without breaking existing subscriptions — NOT APPLICABLE.** There is no
  provider toggle or second provider to disable under the Whop-only decision.
- **Secrets never returned in full — DONE.** The Whop status page and status API expose only a
  masked API-key fingerprint and webhook-secret presence. The response was checked for the real
  configured secrets and did not contain them.
- **Switch `dummy` to `test` without code changes — SUPERSEDED / NOT IMPLEMENTED LITERALLY.** The
  dummy/test mode model was removed. The Whop equivalent is sandbox/production derived from the
  base URL and key; the derivation is implemented and tested, but an actual production credential
  switch has not been performed in QA.
- **Failure simulator creates a real `past_due` subscription — NOT APPLICABLE.** The simulator
  was removed from the settings workflow; Whop sandbox test cards are the selected failure path.
- **Only `super_admin` can view or edit — DONE.** The standalone page and status/test APIs use the
  super-admin-only configuration permission. Tenant provider assignment remains the separate
  `super_admin` + `billing_admin` permission.
- **Key changes are audit-logged — NOT APPLICABLE.** The Whop decision keeps credentials in
  environment variables, so there is no in-app key-change action to audit. The connection-test
  attempt is audited instead, because it is the real provider-configuration action available in
  this screen.

The original `provider_settings.credentials_enc` / encrypted-at-rest database design is also not
implemented. Credentials intentionally remain in environment variables; see #77. Reopening any
of these NOT APPLICABLE or NOT IMPLEMENTED decisions requires an explicit product-scope change.

### 80. The hardcoded-constant sweep is deliberately partial  *(was #50 on the module-4 branch — renumbered on merge, where main had already used #50 for something else)*
**From:** SA-4.1 Â· **Decided while building, 2026-08-30**

SA-4.1's first acceptance criterion is *"no dunning day, trial length or expiry window is hardcoded
anywhere in SA-1 to SA-3."* Three constants moved into the store: the invitation link lifetime, the
refund approval threshold, and the usage warning threshold. Several others were examined and
deliberately left in code, so the criterion passes for what it names and does not pass as a blanket
statement about every constant in the codebase.

**Left in code as security parameters.** The admin and tenant session lifetimes, the pending-2FA
window, and the webhook replay tolerance. A settings row that lengthens a session or widens a
replay window is a privilege-escalation lever available to anyone who can edit settings. The
session lifetime is also baked into the token when it is signed, so a settings row would look like
a live control and change nothing for anyone already logged in — worse than no control at all.

**Left in code as definitions rather than tunables.** The billing period lengths, which must agree
with what the payment provider actually charges. A configurable value that disagrees with the
provider mis-bills people silently.

**Left in code as rendering details.** The users, login-activity and audit-log page sizes. They are
imported by client components, so moving them would mean threading a server value through three
tables for no operational benefit, and a page size that changed mid-session would break the
pagination arithmetic already on the screen.

**Fix:** none needed unless the product wants one of these tunable, in which case it is one registry
entry plus a call site — the machinery is built.

### 64. The admin plan preview deliberately ignores kill switches
**From:** SA-4.10 Â· **Decided with the product owner, 2026-08-30**

SA-2.3 built the plan editor's menu preview so that "the preview matches what the agent actually
sees", by sharing the same `buildAgentMenu` function rather than by anyone remembering to update
two lists. SA-4.10 breaks that equivalence on purpose.

The agent's real menu is now built from *effective* features — what the plan grants, minus anything
switched off platform-wide right now. The preview still shows what the plan grants.

The reasoning: the preview answers "what does this plan include?", which is a question about the
product being sold. A temporary outage should not make a plan look like it does not include
something you are still charging for. An admin pricing a plan during an incident would otherwise
see a smaller product than the one the customer is buying.

The cost is that SA-2.3's "matches exactly" claim now carries a footnote, and someone comparing the
two screens during an outage will see a difference.

**Fix:** none wanted. If the preview should ever show outage state, it needs to say WHY an item is
missing rather than silently omitting it — otherwise it just looks wrong.

### 14. Delete user — not built
**From:** SA-1.4 Â· **Descoped by user on 2026-08-29:** *"we will only do inactive"*

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
**From:** SA-1.2 Â· **Belongs to:** a small follow-up

SA-1.2's criterion *"Selecting a plan attaches a subscription in `active` state"* is still unmet as
written, but everything it needs now exists: SA-2.7 built assignment, and a tenant gets a
subscription via the tenant detail page.

What's left is purely convenience — a plan selector on the Create User form that calls
`admin_assign_subscription` for a **newly created** tenant. Small, and arguably better as a
deliberate second step anyway, since it forces a billing-cycle choice.

### 4. No email is actually sent
**From:** SA-1.2 Â· **Belongs to:** SA-4.11

`lib/email/sendInvitationEmail.ts` logs the invite and returns `delivered: false`. The admin UI
compensates by showing a copyable link. **The invite flow itself is complete and real** — 72h
expiry, hashed tokens, resend, revocation. Only the transport is missing.

**Fix:** replace that one function body when SA-4.11 picks a provider. No caller changes.

SA-5.3 added a second caller with the same shape: `scripts/send-trial-reminders.mjs` composes the
real reminder — the customer's own plan, price and end date — decides delivery, and records a row
with `delivered: false`. Everything except the transport is real, and the column says which it was,
so the day keys arrive nothing about the job changes.

### 20. Removing an archived feature from a plan needs a detour
**From:** SA-2.3 Â· Minor

An archived feature that a plan already grants is preserved on save — deliberately, since the
picker can't offer it and trusting the submitted list would silently revoke it (SA-2.1's rule).
The picker shows it ticked and locked.

Consequence: to genuinely remove one, an admin must un-archive the feature, untick it, then
re-archive. Rare enough to be acceptable; worth a dedicated "revoke" action if it ever bites.

## 🔵 Unverified

### 7. Users list performance at scale — NOT verified
**From:** SA-1.1 Â· **User opted out on 2026-08-29**

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
**From:** SA-1.1, SA-1.2, SA-1.3 Â· **Blocker removed 2026-08-30**

The reason this never happened was admin login needing a TOTP code. That is solved: an admin
session token can be minted locally from `ADMIN_SESSION_SECRET` and set as the
`insurvas_admin_session` cookie, which is how SA-3.3's screens were verified in a real browser.

Still unverified by clicking: the invite â†’ set-password â†’ login round trip, the email-change â†’
confirm round trip (the old address must keep working until confirmed), a role change appearing on
the tenant side without re-login, seat-limit enforcement at the limit, and the plan version editor.
For SA-4.2 specifically, temporary active `billing_admin` and `platform_config` fixtures were
created, both protected APIs returned 403, and the fixtures were removed. A throwaway local server
with an unreachable provider host showed the real failure message in the UI with no console errors.
The success path, concurrent connection tests, anonymous/expired/forged 401s, the safe API payload,
hostile-body non-reflection, and connection-test audit rows were verified.

**Verified in a browser so far:** the invoice list, detail and print screens (SA-3.3), and the
SA-4.2 payment-status screen at `/admin/payments`, including the successful real connection-test
confirmation, responsive card layout, and no console errors. The protected status API's
safe-field-only response was also verified through an authenticated HTTP check; the API cannot be
opened as a standalone browser document because the in-app browser blocks raw JSON.

### 57. SA-4.4 live and browser verification completed
**From:** SA-4.4 Â· **Verified in live project, 2026-08-30**

Several tickets specify acceptance as *"an automated test that runs in CI."* The repository now
has a substantial verification surface — 169 unit tests currently, plus dedicated scripts
for tenant isolation, feature keys, entitlements, payments, webhooks, invoices, subscription
events, coupons, custom invoices and credit notes — but `.github/workflows/` still does not exist.

`npm run check:features` is no longer dormant: it hard-fails references to unknown feature keys and
reports the remaining 25 unguarded features as TODO until the agent app exists. The flag that makes
complete guard coverage mandatory still needs to be flipped when LA-0.1 ships those routes.

**Largely closed by PR #8**, which added `.github/workflows/ci.yml`. Confirm it runs `next build`,
`eslint`, `npm test` and `check:features` on pull requests, and note that the database verification
scripts still need a disposable project rather than production — several create and clean up rows.

**Original fix:** add a PR workflow for `next build`, `eslint`, `npm test` and `check:features`. Database
verification scripts should run against a disposable/staging Supabase project, not production,
because several intentionally create and clean up rows. Add tenant isolation there or as a
scheduled integration job. This would have caught the server-only bundling bug that broke the
first Vercel deploy.
The `offers` migration was applied to the Insurvas-Saas Supabase project as
`sa_4_4_offers`. The live verification script passes auto-apply, apply-time redemption caps,
rejected-capacity preservation, three-invoice duration, end-date auto-apply cutoff, admin API
visibility, offer editing, and offer-edit audit logging. Temporary verification tenants, coupons,
offers, subscriptions, and audit rows are cleaned up by the script.

`npm run verify:configuration` also passes all 45 checks on `http://localhost:3101`: super-admin
access, support-agent 403s on every route, platform-config exclusion from payments/offers, and
billing-admin access only to offers among the restricted sections.

The Playwright browser fallback verified the signed-in page at
`http://localhost:3101/admin/configuration/offers` on desktop (1440x1000) and mobile (390x844).
It verified page identity, meaningful rendered content, no framework overlay, no console/page
errors, the blank-name validation message, deactivate/reactivate success confirmations, and
screenshots. Mobile overflow matched the existing admin shell and did not increase it. No unmet
SA-4.4 verification criterion remains.

### 58. SA-4.5 product catalog implemented and verified
**From:** SA-4.5 Â· **Verified in live project, 2026-08-30**

The `products` migration was applied to the Insurvas-Saas Supabase project as
`sa_4_5_products`. It seeds Final Expense, Term Life, Whole Life, Indexed Universal Life,
Medicare Advantage and Annuity. Product codes are stable references; the API exposes create,
edit, archive and restore, and its DELETE operation is deliberately archive-only so future
template, form, reporting and agent-setting references continue to resolve. `?picker=1` excludes
archived products.

The live `npm run verify:products` check passed adding a product without a deploy,
platform-config editing/restoring, archive persistence, picker exclusion, audit logging, and
403s for support agents and billing admins. The admin list retains archived products for restore.
The six seed rows were verified directly in Supabase. No template or agent-setting reference
tables exist yet; SA-4.6 should add the eventual foreign keys with delete restricted. Until then,
the application has no hard-delete path and preserves the reference contract.

The Playwright browser fallback verified
`http://localhost:3101/admin/configuration/products` on desktop (1440x1000) and mobile (390x844):
page identity, all seeded products, blank-form validation, create, archive, archived visibility,
restore, no console/page errors, and no additional mobile overflow beyond the existing admin
shell. `npm run verify:configuration` passed all 45 route/role checks, including Products access.

Required checks passed: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test` (144),
`npm run check:features`, `npm run verify:products`, and `npm run verify:configuration`.
No SA-4.5 acceptance criterion remains unmet or unverified within the ticket's current scope.

### 59. ✅ SA-4.6 agent-side template consumption completed
**From:** SA-4.6 Â· **Belongs to:** SA-4.7 and the later agent lead-workspace ticket Â· **Resolved 2026-08-30**

The platform template builder and its agent-side consumer are implemented and live-verified.
Each tenant receives a pinned Term Life template version; the agent form, conditional fields,
pipeline board, JSONB lead values, custom-field filtering/sorting, and CSV export all read that
same immutable definition. Updating the assignment is explicit, so an existing agent stays on its
version until choosing the available update.

Acceptance status recorded for SA-4.6: PASS — create without deploy; PASS — schema plus JSONB;
PASS — agent-side filter/sort/export; PASS — version isolation, including a pinned tenant
assignment; PASS — one-action duplication; PASS — preview/runtime parity through the shared
template definition and the real agent screen. The schema-plus-JSONB checkbox previously marked
in the ticket is now backed by the migration, live SQL verification, API verification, and browser
verification. This entry was moved from the outstanding backlog into the resolved section after
the agent consumer was added.

### 71. Dark mode is built — resolved
**From:** UI verification 2026-08-30 Â· **Built 2026-08-31**

The earlier entry said dark mode was not partially built but absent: no `ThemeProvider` mounted,
`:root` carrying one light palette, and `dark:` utilities stranded in five shadcn primitives.

It exists now, and the `@theme inline` block is why it was tractable: every Tailwind semantic colour
already resolved through a `--color-*` variable, so redefining those under `.dark` carried the whole
app without a component being touched. The five stranded primitives turned out to be a non-issue —
their `dark:` variants are all token-based (`bg-input/30`, `bg-destructive/60`), so they were
correct-but-dormant rather than the landmine that entry predicted.

**Three real defects, all found by measuring rather than looking:**

| | before | after |
|---|---|---|
| `text-[var(--brand-700)]` on a dark card | **1.12:1** | 7.56:1 |
| Primary button label | **2.69:1** | 6.96:1 |
| Input border vs card | **1.31:1** dark, 1.28:1 light | 3.12 / 3.00 |

The first was the big one: `--brand-700` is a SURFACE colour (the sidebar, the table header row) and
32 places across 21 files were using it as a TEXT colour on light cards. Correct on white,
invisible on anything else. Split into `--color-accent-ink`, which flips, while `--brand-700` stays
navy for the six places that genuinely paint a surface with it.

The second and third are WCAG failures that also existed in the light theme — the input border
measured 1.28:1 there, well under the 3:1 that 1.4.11 asks of a control's edge. Both themes fixed;
`--color-control-border` is now separate from `--color-border` so table rules stay soft while inputs
become findable.

Also: the accent lifts to `#4da3f0` in dark, filled surfaces take dark ink through
`--color-on-primary`, and the seventeen Tailwind palette colours used as chrome (`bg-amber-50/70`,
`text-green-900`) now go through the semantic tokens. The one deliberate hold-out is the TOTP QR
code, which keeps a white quiet zone in both themes or it stops scanning.

**Verified on `/admin/login` only** — the one screen reachable without a session. Everything else is
behind a login (#72).

---

### 72. The UI verification harness exists but this session could not run it
**From:** browser verification, 2026-08-30 Â· **Needs an operator, not a fix**

`scripts/mint-session.mjs` (`npm run session admin`) signs a session cookie with the same secret the
app verifies against — the mechanism `verify-kill-switches-multi.mjs` already uses — so any admin or
agent screen can be opened in a browser without typing a password. That was the blocker behind #8:
33 screens, all behind a login.

It is written and unused. The sandbox this session ran in refused to execute a script that mints an
auth token, which is a reasonable thing for a sandbox to refuse. Someone with a normal shell can
run it:

```bash
npm run session admin -- --js     # prints a document.cookie one-liner; paste into devtools
npm run session admin -- --role billing_admin
npm run session tenant
```

Until someone does, every row in #8 stays open and the "~12 of 33 screens verified" number stands.

---

### 73. `payment_providers` is empty, and that has a consequence
**From:** reference data export, 2026-08-30 Â· **Corrected 2026-08-31**

The original entry read this as a catalog of providers and wondered whether it was dead schema. It
is not a catalog: it maps a **tenant** to its provider customer, and `lib/invoices/custom.ts` reads
`provider_customer_id` from it to attach a pay-online link to an invoice.

So the empty table has a real effect. Every invoice the new period billing run raises will come out
with no pay-online link and the warning *"No provider customer is known for this tenant yet"* — it
can still be settled by bank transfer, but the customer gets no button. Nothing populates this table
today.

**Fix:** write the row when a checkout completes, from the membership envelope Whop already sends.
That is the same wiring [#47] needs, and worth doing at the same time.

---

### 74. The agent app had no design pass, and most of its menu 404'd
**From:** agent app design pass, 2026-08-31 Â· **Largely closed**

Twenty-four of the thirty agent menu items had no route. Next answered every one with its default
404, so a customer on a plan granting Quoting or Statements saw a sidebar where most of it was
broken — features they were paying for, promised in the navigation, leading nowhere.

Closed by `app/app/(shell)/[section]/page.tsx` plus `components/app/coming-soon.tsx`. A static
segment beats a dynamic one, so the six real screens are untouched and the catch-all only ever runs
for the rest. It decides in this order: not in the menu â†’ 404, which is correct; in the menu but not
granted â†’ the existing gate notice; granted but unbuilt â†’ "on the way". Entitlement is checked
*before* build status on purpose, so someone without the plan is told about their plan rather than
about our roadmap.

Also in the pass:

- **`built: true` is now data in the menu**, not inferred, and `lib/menu/definition.test.mjs`
  asserts the flag and the filesystem agree in both directions. Adding a screen and forgetting to
  flip it fails in CI rather than in front of a customer — which is exactly how this happened.
- **The sidebar works on a phone.** It was a fixed 240px column with no way to reach navigation
  below that width, while LA-0.1 requires the app to work on one.
- **Internal vocabulary is gone from customer screens:** raw feature keys (`book_of_business`) and
  meter keys (`dials`) resolve to their labels, `plan_c (v3)` reads as "Plan C", and "this screen is
  scaffolding for LA-0.1" no longer quotes a ticket number at a paying customer.
- **Usage got bars**, banded by the same `usageState()` the admin monitor uses, so an agent and an
  operator cannot look at the same tenant and disagree about whether it is in trouble. Each says
  what happens at the limit — a hard cap that stops work is a different sentence from overage that
  lands on a bill.
- **`min-w-0` on `<main>`**, the same fix the admin shell needed in #52.

**Browser verification completed 2026-08-31.** A throwaway signed-in agent account was exercised at
the default desktop viewport and at 390Ã—844. The Basic-plan inbound URL showed the upgrade prompt,
the Inbound item was absent from the sidebar, the mobile drawer opened and closed, no horizontal
overflow was present, keyboard focus was visible, and the browser captured no warning or error
logs. The suspended dashboard showed the warning while retaining the Policies link. The live
verification script also covered the entitlement API, plan change without re-login, read-only
writes, forged/expired sessions, missing membership, repeated/concurrent requests, and the
agent/admin cookie boundary.

---

### 75. The entitlement blob should carry the plan's display name
**From:** agent app design pass, 2026-08-31 Â· Minor

`planDisplayName()` tidies `plan_c` into "Plan C" because that is all it can honestly do. The real
name lives in `plans.name`, and the agent app is forbidden from reading that table — "it reads this
one object and obeys it; it never queries a plan, a subscription or a price". Hardcoding a second
set of names in the tenant plane would be a copy that silently disagrees with the admin screen the
first time somebody renames a plan.

**Fix:** add `plan_name` to `resolve_tenant_entitlement`'s output and to the `Entitlement` type. It
is a change to the contract between the two planes, so it wants its own migration and a note in the
Basic Idea doc's Appendix A rather than being smuggled in with a UI change.

---

### 76. The fourteen remaining admin screens — pass done, unseen
**From:** admin design pass, 2026-08-31

The board called these "None — nobody has looked at them with design intent". Auditing them first
found they were in better shape than that implied: `AdminPageHeader` is used by every page but one,
and 17 of 18 tables share `table-styles.ts`. The inconsistency was one level down.

- **Status chips were hand-rolled six times.** Five separate `*_STATUS_BADGE_CLASS` maps, drifting
  in exactly the way copies do — some carried `text-[10px]`, some tinted with `--color-blue-faint`
  and some with a `/10` alpha of the same hue. Replaced by one `StatusChip` with a `tone` API, so a
  table says what a state MEANS and the component decides how that looks. Each chip also carries a
  dot, so the state survives for anyone who cannot separate the hues.
- **Empty states that stated a fact and stopped.** "No coupons yet." is true and a dead end. The six
  bare ones now say what the thing is for. `hint` is a required prop on the new `EmptyState` so the
  next one cannot skip it.
- **Filtered-empty and genuinely-empty were the same message,** which is worst on Invoices and
  Subscriptions: those check the *fetched* list, so a fresh platform with zero invoices was told
  "No invoices match these filters". They now distinguish, and the filter case offers to clear.

**Not seen in a browser** — same blocker as #72. Structure, contrast and build are verified; layout
and density are not.

---

## âšª Tech debt

### 81. The settings cache only invalidates on the instance that wrote  *(was #51 on the module-4 branch — renumbered on merge, where main had already used #51 for something else)*
**From:** SA-4.1 Â· Minor, bounded

The read helper caches overrides in memory and clears that cache when a setting is saved. On a
single server that is exact. On serverless every running instance holds its own copy, and only the
one that handled the write clears it — so another instance keeps serving the old value until its
own copy ages out.

The staleness is bounded to thirty seconds by a TTL, which is why this is minor rather than a bug:
nobody notices a thirty-second delay on a value that changes a few times a year. It is recorded
because the failure mode is confusing rather than visible — two admins on two instances briefly
disagreeing about a number, with nothing on screen to explain why.

**Fix, if it ever matters:** a short-lived shared cache, or drop the in-memory layer and accept one
indexed lookup per read.

### 11. `middleware.ts` uses a deprecated convention (resolved locally)
**From:** SA-0.3

Next.js 16 wants `proxy.ts`. The active checkout now uses `proxy.ts` with the same authentication
boundary and matcher behavior. Retain this note as historical context only; no further action is
needed unless the Next.js convention changes again.

### 12. 2FA reset is CLI-only
**From:** SA-0.1

`npm run reset:totp -- <email>` is the only way to re-enroll an admin who loses their authenticator.
Fine at 2â€“3 admins; wants an in-app super_admin-only action (itself audited) as the team grows.

### 13. Direct Postgres host is IPv6-only
**From:** SA-0.2 Â· **Deployment note**

`db.<ref>.supabase.co` resolves AAAA-only on this project tier and isn't reachable from every
network. `TENANT_DB_URL` therefore points at the Supavisor pooler (IPv4, transaction mode).
Already handled — noted so nobody "fixes" it back to the direct host.

---

### 22. Metered actions have nothing to meter yet
**From:** SA-2.5 Â· **Belongs to:** LA-0.1 and the agent-side features

`checkMeterCapacity()` / `consumeMeter()` are built and tested, but nothing calls them — there is
no dialer, no TCPA checker, no statement importer.

The blocking behaviour **is** proven (at 1000/1000 of a hard-capped meter the check returns
`allowed=false, reason=over_cap`); what is unproven is that a real feature honours the answer.
Whoever builds the first metered action must call `consumeMeter()` **before** acting, not after.

### 23. `consumeMeter` check-then-record is not atomic
**From:** SA-2.5 Â· Minor, deliberate

The capacity check and the usage record are two separate statements, so a burst of concurrent
calls could each pass the check before any of them records — overshooting a hard cap by roughly
the concurrency level.

Accepted for now: the overshoot is small and bounded, and SA-3 bills overage anyway. If a meter
ever needs a strict ceiling (a legal one, say), this needs to become a single transaction that
locks the total row.

### 24. ✅ RESOLVED — the billing run is scheduled, and says so when it stops
**From:** SA-2.5, narrowed by SA-2.7, widened by #44 Â· **Belongs to:** SA-6.1 Â· **Resolved:** 2026-09-13

`npm run bill:periods` always did the rollover correctly. What was missing was anything to call it,
and this entry's own sentence is why that mattered more than it sounds: *a job that silently never
runs still looks identical to a healthy one.* An unrun billing job does not throw, does not queue,
and leaves no trace — it just means nobody is invoiced.

**Scheduled** at `/api/cron/period-billing`, daily at 03:00 UTC via `vercel.json`, following the
LA-1.23 unclaimed-SLA cron exactly: one `CRON_SECRET`, one convention, fails closed without it.
Verified locally — 401 with no bearer, 401 with a wrong one, 200 with the right one.

**Deliberately does not advance the periods.** That is the ordering rule from `gather.ts` made
structural rather than remembered: usage is keyed by `period_start`, so billing after the roll
charges every customer for zero overage, every time, and looks healthy doing it. `bill:periods`
still does both in one process where the order can be guaranteed; the cron only bills. A period
billed but not rolled is simply found already billed next time — the ledger's primary key makes
repetition free.

**Watched two ways, because one is not enough.** `/api/internal/period-billing` answers 503 unless
both hold:

    the job ran            an age check on the last recorded run — catches a scheduler that has
                           stopped being invoked at all. Default window 36 hours against a daily
                           cron, so one missed run is tolerated and two are not.

    nobody is unbilled     the condition this entry actually named: "no row in the last N days for
                           a subscription whose period has ended". Catches the worse failure,
                           where the job runs on time and fails on everyone.

The second is the one worth having, and it is not theoretical. Proven live: with a subscription
whose period ended three days ago and no ledger row, the heartbeat answered

    503   reason: "subscriptions_unbilled"   lastRunAt: 45 seconds ago   unbilledCount: 1

A run 45 seconds old that had reported success — precisely the state an age check calls healthy.
The operator email was delivered in the same request.

Asked of `period_billing_runs` rather than of invoices, on purpose: a period that was examined and
had nothing to bill still writes a ledger row, so "no row" means "not examined" rather than
"nothing owed". Counting invoices would report every customer without add-ons as unbilled forever.

`lib/billing/heartbeat.ts` is pure and has 14 unit tests, most of them about the ways of being
unhealthy — a monitor that only proves it can say "ok" has proven nothing. One covers an
unparseable timestamp reading as infinitely old rather than as fresh, which is the direction that
would report a dead scheduler healthy.

**Still owed to an operator, as with LA-1.23 (see 168):** `CRON_SECRET`, `PERIOD_BILLING_SECRET`
and `PERIOD_BILLING_ALERT_EMAIL` must be set in the production deployment, and a deployment
carrying `vercel.json` promoted. Without them production fails closed — the safe direction, and
also not billing anybody.

### 26. Add-on CRUD is read-only in the UI
**From:** SA-2.6 Â· Minor

The Add-ons screen lists everything with its price, granted features and credits, but there's no
create/edit form — the four seeded add-ons came from the migration. Attaching and detaching them
to subscriptions **is** fully built.

Adding a new add-on today means a migration. Worth a dialog (same shape as the plan editor) if the
business starts iterating on them; not urgent while the catalog is four rows that rarely change.

### 27. ✅ RESOLVED — the extras reach an invoice, and the invoice is now sent
**From:** SA-2.6 â†’ retargeted by SA-3.2 Â· **Resolved:** 2026-09-13

This entry was half stale and half true, and the true half was worse than it read.

**Stale:** "add-ons and overage do not reach an invoice" stopped being accurate when
`0017_period_billing.sql` and `lib/billing/lines.ts` built the assembler. They have reached an
invoice since. Nobody updated the entry.

**True:** they were never *collected*. `bill_subscription_period` wrote the invoice row and
stopped. `pay_online_url` stayed null, `provider_invoice_id` stayed null, and nobody was ever asked
for the money. `lib/invoices/custom.ts` had done the provider push correctly all along for
hand-raised invoices — the same code, missing from the one path that runs unattended, which is the
path where nobody would notice.

**Fix:** the push is lifted into `lib/billing/collect.ts` and both callers share it. The period run
sends its invoice as `send_invoice` rather than `charge_automatically`, because a period invoice
for overage and add-ons is an amount the customer has not seen before, and charging a stored card
for it is how disputes start.

Best effort, never fatal: a provider that is down costs a pay-online link, not a bill, and must not
abandon the remaining tenants mid-run. Every outcome is recorded — `uncollected` in the run's
report names each invoice that exists but was never sent, because an invoice nobody has been asked
to pay is otherwise indistinguishable from a paid one until reconciliation.

Verified end to end in `verify:period-billing`: the fixture tenant has no payment provider, so the
suite asserts collection was *attempted* and its outcome reported. Before this there was no attempt
and no warning — which looks identical to success from every angle except the bank.

The separate-Whop-invoice decision this entry recorded still stands and is what was built. What it
described as unbuilt was the assembly, which existed; what was actually unbuilt was the sending.

### 37. Already invoiced — this entry was stale
**From:** SA-3.2 Â· **Checked and closed 2026-08-31**

The entry said the two real sandbox payments produced no invoices. `npm run backfill:invoices`
replays every stored payment envelope and reports what is missing; run against the live project it
finds nothing to do:

```
= pay_HauFP0LxGqtuUm: already invoiced as INV-2026-08-0001 (mismatched)
= pay_cqovMKvYNu6jZI: already invoiced as INV-2026-08-0002 (matched)
x pay_xxxxxxxxxxxxxx: the event was never matched to a tenant
```

Both real payments have invoices, and the `plan_a` double-charge is recorded as **mismatched** —
exactly the outcome this entry argued for. The third is a fixture with a placeholder id and no
tenant; it is correctly skipped rather than invented.

The script stays. It is a guard rather than a migration now: if a payment ever arrives while invoice
generation is down, this finds it and replays it through the same line-building code the live
receiver uses.

---

### 38. An invoice can still be deleted
**From:** SA-3.2 (2026-08-30) Â· Minor

UPDATE is revoked on every column of `invoices` except the lifecycle ones, and `invoice_lines`
refuses UPDATE and DELETE outright. But `invoices` itself can still be DELETEd by the application.

Deleting a financial record is worse than editing one, and the correct operation is already
built — `void`. DELETE is currently retained only so verification scripts can clean up after
themselves; the same tension as `usage_events`, resolved the other way. Before real customers,
revoke it and give the test scripts a dedicated path.

### 29. One step still owed: the baseline has never been replayed into an empty database
**From:** end-of-SA-2 push Â· **Mostly closed 2026-08-30**

The original of this entry said the schema existed nowhere but project `iiimdgizjwnihpyrukbu`. That
is no longer true. `supabase/migrations/0000_baseline.sql` now carries **45 tables, 23 enums, 57
indexes, 5 views, 47 functions, 61 foreign keys, 3 policies and the grant/revoke state of 50
tables**, generated by `npm run db:dump`, and `0016_reference_data.sql` seeds the three catalogs the
code asserts against. The `tenant_app` role is created by a migration for the first time.

`supabase db pull` could not be used: the only credential this repo holds is `TENANT_DB_URL`, whose
role is deliberately `NOBYPASSRLS` with no DDL rights, and the CLI wants an owner connection. The
dump reads the catalog instead, which any role may do.

All 17 files parse against a real PostgreSQL server (`npm run db:check`).

Not a code fix — it's an export. Either `supabase db pull` into `supabase/migrations/`, or hand-write
the DDL in order and verify by replaying it into a scratch project. This was already worth doing
before SA-3; it is now overdue because the live-only schema also contains invoices, payments,
coupons, credit notes and revenue metrics.
**What is still owed:** parsing is not applying. Nobody has replayed `0000` â†’ `0016` into an empty
database with an owner connection and confirmed the result matches production. Until that happens
the claim "a fresh clone can run" is inference, not evidence. The check is:

```bash
# against a scratch project, with an owner connection
psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0000_baseline.sql
# ... then 0001 through 0016 in order, then:
npm run verify:tenant-isolation
npm run verify:entitlements
```

Both suites must pass against the **replayed** schema, not the original. This needs an owner
credential that this repository does not have, so it is the operator's step, not a code change.

### 32. The orphaned per-tenant provider panel is intentionally retained but dormant
**From:** SA-3.1, resolved in SA-4.2 Â· **Decision:** keep dormant by user on 2026-08-30

The Whop-only decision removed the need for a customer-level provider choice, the dummy failure
simulator and multi-provider configuration. The existing tenant detail component and API route are
still retained because they touch shared `payment_providers` runtime records used by provider
resolution and future migration work. They are not part of the standalone platform status screen,
and they were not deleted because removing them would also touch the tenant detail page and billing
provider assignment behavior.

**Fix:** none for SA-4.2. Revisit whether to hide or remove the dormant UI and route when SA-4.3
defines the Configuration Center and the product makes an explicit decision about tenant-level
provider records.

### 39. Two invoice filters exist in the API but not the UI
**From:** SA-3.3 (2026-08-30) Â· Minor

The ticket asked for filters on status, tenant, date range and overdue-only. The screen has status,
overdue-only and mismatched-only; **tenant and date range are supported by `GET /api/admin/invoices`
but have no control**. Both are a couple of inputs once there are enough invoices for filtering to
matter — with two rows it would be furniture.

### 48. The 2-second / 500-tenant target is unverified
**From:** SA-3.9 Â· Unverified

The dashboard reads a snapshot table rather than aggregating live, which is what the target asks
for, and every figure comes from one indexed table scan over at most 31 rows. But it has never been
run against 12 months of data and 500 tenants — the same position as [#7], and for the same reason.

### 45. The provider refund call has never been executed
**From:** SA-3.8 (2026-08-30) Â· **Unverified**

Everything guarding a refund is verified: the threshold, the pending queue, the self-approval
refusal (in the route *and* as a database constraint), and that a failed execution is left in
`failed` with a reason. **The `POST /payments/{id}/refund` call itself has never run.**

Deliberately: the only refundable payments are the two real sandbox charges, and a refund is
irreversible. `WhopProvider.refund()` is written against the documented endpoint and unit-tested
against a stubbed fetch, but the live path is unproven — the same status the plan and promo calls
had before they were exercised, and both turned out to have bugs.

Worth spending $1 of sandbox money on a partial refund to close it.

### 46. Credit is applied automatically — resolved
**From:** SA-3.8 Â· **Built 2026-08-31**

The ticket's criterion was "an unused credit balance is applied to the next invoice automatically
and shown as its own line". It was unmet because on automatic billing there was no invoice of ours
to apply it to.

#44 created one. The period billing run applies the balance as a `credit` line on the period invoice
and deducts it — inside the same transaction that raises the invoice, because deducting afterwards
means a crash in between gives the discount away twice.

### 44. ✅ RESOLVED — the waiver was the missing fourth
**From:** SA-3.7 / SA-3.8 Â· consolidated former #27 and #41 Â· **Resolved:** 2026-09-13

Four things were listed. Three had been assembled since `0017_period_billing.sql`: attached
add-ons, metered overage above the allowance, and any charge parked by a mid-period plan change.
The fourth — "any billing-admin waiver that must remove an overage line before issue" — had no
model at all. The only way to forgive an overage was to let the invoice go out and then raise a
credit note, which is a different act with a different paper trail and leaves the customer holding
a bill for something already agreed not to charge.

**`billing_waivers`**, service-role only, asserted in the migration to be unreadable from the
tenant plane. Four decisions, each of which is the feature's safety rather than its shape:

    scoped to one meter    a waiver names the meter it forgives. A blanket "waive all overage" is
                           a much larger act than it looks, and is expressible as several rows
                           each carrying its own reason.

    scoped to one period   period_start is required. The failure mode of this feature everywhere
                           it exists is a waiver granted once for a bad month and then quietly
                           forgiving every month after, which nobody notices because the line
                           simply stops appearing.

    capped or complete     max_cents null forgives the line; a number forgives up to that much
                           and bills the rest.

    spent once             consumed_at and invoice_id are stamped inside the billing transaction.
                           A waiver marked spent against an invoice that never committed would
                           forgive an overage nobody was charged for, and the real one would
                           arrive next period at full price.

**The overage line stays.** A waived overage is shown and then discounted, not removed. "You used
400 SMS over your allowance and we are not charging you for it" is a document still defensible a
year later; one that silently omits the usage is not. The net is identical.

**A waiver matching no overage is left unspent**, and said out loud. Burning it against nothing
would be a forgiveness the customer never received and can never use again.

Granted and revoked at `POST` / `DELETE /api/admin/billing/waivers`, restricted to the roles that
may see an invoice — a waiver moves earned money back to the customer, so anyone who may not look
at an invoice may not forgive one. Revocation is a delete filtered on `consumed_at is null` rather
than a read-then-delete, so an admin revoking while the run is spending it cannot both succeed.

Eleven unit tests on the arithmetic and eleven live checks in `verify:period-billing`, including
that the waiver reaches the overage and nothing else (the add-on beside it is billed in full), that
credit applies to what is left *after* the waiver rather than before, and that the invoice lines
sum to what the invoice asks for.

### 42. Coupons are creatable but not yet attachable from a screen
**From:** SA-3.6 (2026-08-30) Â· Minor

`POST /api/admin/subscriptions/:id/coupon` applies a coupon and `DELETE` removes it, both
audit-logged and enforced atomically in SQL. **Neither has a control on the tenant page** — the
Coupons screen creates and lists them, but attaching one to a customer is API-only today.

A picker on the subscription panel, next to add-ons. Small, and worth doing before anyone is asked
to use coupons in anger.

### 43. Applying a coupon to an ALREADY-RUNNING membership is unverified
**From:** SA-3.6 (2026-08-30) Â· **Unverified**

Our side attaches the coupon and the discount appears on the next invoice we generate. Whether the
customer is actually charged less depends on Whop applying the promo to an existing membership,
and **that has not been tested**.

Whop documents an `existing_memberships_only` flag "for cancellation retention offers", which
implies it is possible, but not the mechanism. Until it is confirmed in the sandbox, a coupon
applied mid-subscription may show a discount on our invoice that the card never received — which
reconciliation would correctly flag as `mismatched`.

Coupons applied **at checkout** are the verified path.

### 49. A failed provider refund alerts nobody
**From:** SA-3.8 acceptance criteria Â· **Significant**

`executeCreditNote()` correctly leaves a refused refund in `failed`, stores `failure_reason`, logs
to the server console and returns the failure to the admin who clicked. It does **not** alert a
billing admin after that request ends. A failure during an automated retry or webhook path can sit
unseen until someone opens Credit Notes.

**Fix:** emit an operational alert through the notification/email seam and record delivery. This
depends naturally on SA-4.11 (email configuration) or the job/alert infrastructure in SA-6.1.

### 50. Public-schema RPC functions still grant EXECUTE to PUBLIC
**From:** live Supabase audit after SA-3 Â· **Security hardening**

The inspected `admin_*`, billing, metering, entitlement and metrics functions are `SECURITY
INVOKER`, which is safer than definer functions, but their ACL includes `=X/postgres`: every role
inheriting PUBLIC — including `anon` and `authenticated` — may invoke them. RLS currently blocks
the underlying tables for those roles, so this audit did not prove an immediate data escape.
However, these functions are exposed as callable RPC surface and a future permissive policy could
turn a harmless grant into a privilege escalation.

**Fix:** revoke EXECUTE from PUBLIC, `anon` and `authenticated` for control-plane functions; grant
only `service_role` (and a narrowly scoped tenant role only where genuinely required). Add a test
that anonymous RPC calls are denied.

### 51. The revenue dashboard is partial and has financial-correctness defects
**From:** SA-3.9 acceptance criteria Â· **Significant**

The page deliberately labels expansion and contraction as **not measured**. It also has a fixed
31-day revenue window and 90-day funnel window, no date/plan controls, no churn-by-plan calculation,
and no trial-to-paid conversion rate. Two funnel steps — completed profile and completed setup —
remain uninstrumented.

The Module 3 audit also found that historical snapshot rebuilds use the subscription's **current**
status/plan, and the page compares all collected cash with only new MRR. Those are correctness
bugs rather than missing polish: cancellation can rewrite history, while ordinary renewals create
a false “gap.” See M3-7, M3-8 and M3-12 in `bugs_sa.md`.

**Fix:** record plan-change MRR deltas and real funnel events, extend `metrics_daily` for per-plan
churn and trial conversion, and add date/plan filters. Performance against 500 tenants remains [#48].

### 52. Setup-step completion is recorded nowhere, so trial conversion can't be correlated with it
**From:** SA-5.3 Â· **Significant**

SA-5.3 asks for a setup-progress column on the trials screen and for conversion correlated with
setup completion. `business_profiles.recommended_setup_steps` stores the *list* of steps; nothing
anywhere records which of them a tenant has **finished**, so a progress figure would read the same
for every trial — a confident number with nothing behind it.

The screen shows a measured engagement signal instead (owner's `last_login_at`), labelled as
exactly that on both the table and the stats block. The conversion cut is engaged vs never-signed-in
rather than setup-complete vs not.

**Fix:** record step completion (a `tenant_setup_steps` table, or completion timestamps on the
profile), then swap the two cuts. The screen's shape does not need to change — only what feeds it.

### 53. The provider leg of extend/cancel has never executed against a real membership
**From:** SA-5.3 Â· **Unverified, same class as [#45]**

`extendTrial` calls `addFreeDays` and `cancelTrial` calls `pauseMembership` when the subscription
carries a `whop_membership_id`. Both methods are individually verified against the sandbox (SA-3.2,
SA-3.4), but never on a **trialing** membership, and `verify:trials` deliberately builds trials with
no membership id so no sandbox state is mutated — pausing a real membership is not reversible from
a test, and the only trialing memberships in the sandbox are the ones SA-5.2 created.

The failure handling is the part that matters and is exercised by inspection only: an extension
refuses rather than half-applying, because moving our date while the provider still charges on the
old one tells the customer one thing and bills another.

**Fix:** run one manual sandbox extension on a trialing membership and record the response, the way
SA-3.2's decisions were settled. Cheap, and it closes the last unproven path in SA-5.3.


### 54. The seeded Terms and Privacy Policy are drafts, not legal copy
**From:** SA-5.4 Â· **Blocks launch, not development**

`content/legal/*-v1.md` were written so the acceptance machinery could be built and tested against
real prose instead of filler. They have not been reviewed by a lawyer, and two sections say so
explicitly ("governing law: to be determined", "contact: to be completed"). They are stored with
`is_draft = true`, and that flag is surfaced on the public page, the signup checkbox, the
re-acceptance screen and the admin list — nothing pretends they are reviewed.

**Fix:** publish v2 of each from `/admin/legal` with counsel's copy. No code changes; the machinery
already handles the version bump and the re-acceptance it triggers.

### 55. `verify:legal` permanently advances the DPA version sequence
**From:** SA-5.4 Â· **Accepted, not a defect**

The script publishes real document versions and cannot delete them, because `legal_documents` is
append-only and nothing — not even `service_role` — may DELETE from it. Adding a teardown function
would destroy the exact guarantee under test, so it does not exist.

Every version the script publishes therefore goes into the `dpa` type, which nothing else uses and
which signup does not require, leaving Terms and Privacy Policy untouched at v1. Each run clears
the re-acceptance requirement on what it published, so no real user is ever blocked by a
verification artefact, and the run prints how many it left behind.

**Consequence:** a real Data Processing Agreement will not start at v1. Acceptable; the alternative
was a delete path into an evidence table.

### 56. Most of the schema is still not in `supabase/migrations/`
**From:** SA-5.4, superseding part of [#29] Â· **Significant**

The database has 40 applied migrations. The repository has 9. SA-5.3's was applied and never
written down at all until SA-5.4 backfilled it from
`supabase_migrations.schema_migrations` — which is the failure mode [#29] describes, happening
again in this session.

Present in the repo: SA-5.1 (Ã—3), SA-5.2, SA-5.3 (backfilled), SA-5.4 (Ã—2), rate limits.
Missing: everything from SA-0.1 through SA-3.9 — 31 migrations covering the entire core schema.

A fresh database cannot be built from this repository. That is a restore problem and an onboarding
problem, not a style one.

**Fix:** dump the remaining 31 from `schema_migrations` (the statements are stored verbatim, as the
SA-5.3 backfill proved) into correctly-named files. Mechanical, and worth doing before anyone needs
a second environment.

### 41. Proration now has a caller — resolved
**From:** SA-3.4 Â· **Built 2026-08-31**

`prorate()` produced the ticket's worked example to the cent and nothing invoked it, so a mid-period
change moved our side, left Whop billing the old plan, and charged nobody the difference.

`lib/billing/planChange.ts` is the missing caller, wired into the change-plan route. On an immediate
change it prorates against the real period length, writes **two** `pending_charges` rows — the old
plan's unused days as a credit, the new plan's remaining days as a charge — and calls
`WhopProvider.setCancelAtPeriodEnd()` so the old membership stops renewing at the old price. The
difference is collected on the next invoice by the period billing run rather than raised as its own
invoice today: one bill instead of two, and nothing is lost by waiting.

Two rows rather than one on purpose. "$122.58 plan change" is something a customer can only accept
or dispute; "$152.61 credited, $275.19 charged" is something they can check.

A downgrade still raises nothing. The ticket is explicit that it is not refunded mid-period, and the
route now records that as the reason rather than silently doing nothing.

---

### 60. ✅ SA-4.7 agent template selection and tenant-owned copies completed
**From:** SA-4.7 Â· **Belongs to:** SA-4.7 Â· **Resolved:** 2026-08-30

Nothing added to the backlog for SA-4.7. The live verification covered onboarding copy creation,
subscription-filtered template discovery, tenant isolation, second-template preview and merge,
idempotent re-application, and tenant-scoped RLS. The repository checks and signed-in browser
screen verification also passed. Platform templates remain immutable inputs; agent edits are saved
only to the tenant-owned copy.

### 61. ✅ SA-4.8 agent-side DNC preflight is now wired
**From:** SA-4.8 (2026-08-30) Â· **Belongs to:** SA-4.8 Â· **Resolved:** 2026-08-30

The agent now has a protected `/app/dialer` screen and `/api/app/dial/preflight` endpoint. Every
preflight checks for an enabled DNC vendor, calls vendors in priority order, falls back when a
vendor is unreachable or returns an unusable response, and fails closed when no vendor can verify
the number. Listed numbers return a clear blocked response. Each scrub attempt and fallback is
recorded in `provider_calls` with only the masked last four digits; credentials and the full phone
number are never retained in the provider log. The pure fallback and response-contract tests pass.

The repository still has no PSTN/calling-provider adapter, so the endpoint returns “ready for your
connected dialer” after a successful scrub rather than pretending to place a telephone call. A
future telephony ticket must invoke this same preflight immediately before handing a number to its
provider.

### 83. Two migration naming schemes now coexist, and a from-scratch rebuild breaks
**From:** the module-4 merge Â· **Blocks a second environment, not production**

`supabase/migrations/` holds 27 files in two incompatible schemes:

- `0000_baseline.sql` â€¦ `0017_period_billing.sql` — the SA-4 line, where `0000_baseline.sql` is a
  **generated dump of the live database** (`npm run db:dump`).
- `20260830010000_sa_5_1_signup_enums.sql` â€¦ `20260830111500_*` — the timestamped SA-5 files.

Two problems, both only visible when rebuilding from nothing:

1. **Ordering is decided by string sort**, so every `00xx` file runs before every `2026â€¦` file.
   That is not the order they were written in, and nothing declares the real dependency.
2. **The baseline already contains the SA-5 objects** — it was dumped from a database that had them
   applied, so it creates `legal_doc_type`, `trial_reminder_kind`, `legal_documents`,
   `legal_acceptances` and `trial_reminders`. The SA-5 migrations then try to create the same
   objects again with unguarded `create type` / `create table`, which errors. The baseline's own
   header says "objects created by the numbered migrations 0001+ are deliberately absent" — true of
   the SA-4 files, not of the SA-5 ones it swallowed.

The live database is fine: it has all of these applied already under their original names. This
only bites a `supabase db reset`, a new staging project, or a disaster recovery.

**Fix:** pick one scheme. The cheapest correct version is to regenerate the baseline *after* the
merge and delete the SA-5 files it now subsumes, leaving `0000_baseline.sql` plus everything that
came after it. Then verify with an actual reset against a throwaway project — this is precisely the
class of problem that is only real when someone tries it.

This supersedes the "9 migrations in the repo" half of [#56]: the baseline dump and
`scripts/dump-schema.mjs` genuinely fixed the missing-schema problem, and replaced it with an
ordering one.


### 87. ✅ Module 4's own verification scripts were re-run after the merge
**From:** the module-4 merge Â· **Resolved:** 2026-09-01

The merged tree was re-verified with `npm run verify:all`. All twenty-two suites now pass, including
the formerly failing configuration route, agent-template, credit-margin, and period-billing
checks. The LA-0 RLS suite is included in that count.

No new backlog item was created for the re-run itself.
### 105. Tenant users have no self-service account recovery — deferred to LA-0
**From:** the SA-4.11 email audit Â· **Deferred by decision on 2026-08-30**

Every account-recovery path for a tenant user runs through an admin. The emails themselves work
and are wired to Google SMTP; what is missing is any way for the user to start one.

**Password reset.** `/app/login` links only to `/pricing` — there is no "Forgot password?". The
reset email, the hashed-token machinery and the `/app/set-password` landing page all exist, and the
only trigger is `POST /api/admin/users/[id]/send-reset`. So an agent locked out at 7am phones
Insurvas, and somebody opens the admin panel for them. Every time.

What is left to build is small: a public route that accepts an email address, issues the token and
sends the existing email, plus the link on the login page. **It must answer identically whether or
not the address exists** — otherwise the form becomes a way to enumerate which of your customers'
emails are registered. `/api/app/auth/login` already does this correctly with a dummy-hash compare;
reuse the shape.

**Email address change.** Same split: the confirmation email goes to the new address and proves
control before the change takes effect, but only `PATCH /api/admin/users/[id]` can start it.

**Security notifications.** Nothing tells a user their password or email address was changed. That
notification is how account takeover gets noticed, and the trigger points already exist in
`app/api/app/auth/set-password` and `app/api/app/auth/confirm-email`. Cheap, and worth doing
alongside the reset.

Deliberately NOT on this list: magic links, OTP, reauthentication prompts, and MFA for tenant users.
No ticket asks for them, and MFA for agents is a product decision rather than a gap — `totp_secret`
exists on `admin_users` only, by design.


### 106. A live invoice is overpaid by 9,900 cents, and the fix does not correct it
**From:** fixing bugs_sa.md M3-4 Â· **Needs a decision, not code**

`admin_settle_invoice_manually` now refuses overpayment, so this cannot happen again. It does not
repair what already happened: `INV-2026-08-0001` has a total of 9,900 cents and 19,800 cents of
successful payments recorded against it. A customer paid twice for one invoice.

Deliberately not corrected automatically. The options are a refund, a credit note against a future
invoice, or voiding the duplicate payment record — and which is right depends on whether the money
actually left their account twice, which the payment provider knows and we do not. Guessing would
either keep money that is not ours or reverse a charge that was legitimate.

**Fix:** confirm with the provider what was actually collected, then use the existing credit-note
path (SA-3.8) or a refund. Both are already built and audit-logged.

---

### 117. ✅ Resolved — LA-1.4 lead CSV import is now shipped
**From:** LA-1.4 Â· **Belongs to:** the later lead-import ticket Â· **Resolved:** 2026-09-04

The `/app/import` page and `/api/app/leads/import` now provide a real CSV import flow. It accepts the
stable template field keys (and existing human-readable labels), converts configured field types,
validates every row and stage before writing, preserves existing leads, and records an audit row for
each imported lead. The agent lead export now uses stable field keys so custom fields survive an
export â†’ import round trip.

Evidence: `npm run verify:lead-import` passed the live Supabase-backed tenant-isolation, forged-session,
wrong-role, custom-field, typed-value, invalid-input, export, and audit checks. The protected browser
route correctly redirects an unauthenticated request to `/app/login`; the authenticated visual run is
recorded in #162.


## ✅ Resolved

*Terse log — details live in git history.*

### 63. ✅ Billing relationships are tenant-scoped in the database
**From:** Module 3 audit Â· **Belongs to:** Module 3 billing integrity Â· **Resolved:** 2026-09-03

Database triggers reject an invoice paired with another tenant's subscription or a credit note paired
with another tenant's invoice. The follow-up trigger migration is table-safe for both row shapes. A
rollback-wrapped live SQL probe rejected both mismatches.

### 94. ✅ Free-day credits use the subscription billing cycle
**From:** SA-3.8 audit Â· **Belongs to:** Module 3 credit-note handling Â· **Resolved:** 2026-09-03

Credit-to-free-days conversion now uses the subscription's monthly, quarterly, or yearly price
through `priceForCycle`, rather than always using the monthly price. Credit-note verification passes.

### 65. ✅ Plan versions retain the complete commercial configuration
**From:** Module 2 audit Â· **Belongs to:** Module 2 plan management Â· **Resolved:** 2026-09-03

Plan version creation now copies features, prices, limits, meters, and available add-ons. The live
`npm run verify:plan-version` suite passed every category.

### 95. ✅ Entitlement refresh failures are no longer swallowed
**From:** SA-2.7 / SA-2.8 audit Â· **Belongs to:** Module 2 entitlement lifecycle Â· **Resolved:** 2026-09-03

Entitlement rebuild failures are logged and rethrown, and credit execution no longer ignores them,
so a source mutation cannot report success while stale access remains cached.

### 96. ✅ Add-on meter credits reach display and enforcement
**From:** SA-2.6 audit Â· **Belongs to:** Module 2 add-ons and metering Â· **Resolved:** 2026-09-03

The resolver, usage display, and meter-capacity check use the same plan-plus-add-on allowance.
`npm run verify:addon-meters` passed plan-only, attached, agreement, and detach checks.

### 154. ✅ Add-on detach is scoped to the subscription URL
**From:** SA-2.6 audit Â· **Belongs to:** Module 2 add-ons Â· **Resolved:** 2026-09-03

The admin DELETE route calls the subscription-scoped detach RPC. A live rollback-wrapped probe
confirmed that subscription A cannot detach subscription B's attachment.

### 155. ✅ Subscription transitions are guarded in SQL
**From:** SA-2.7 audit Â· **Belongs to:** Module 2 subscription lifecycle Â· **Resolved:** 2026-09-03

Locked subscription RPCs reject invalid source states and preserve valid pause/resume behavior.
`npm run verify:transitions` passed crafted invalid transitions and valid admin-route transitions.

### 70. ✅ Archived plans are rejected by subscription APIs
**From:** SA-2.2 / SA-2.7 audit Â· **Belongs to:** Module 2 plan and subscription lifecycle Â· **Resolved:** 2026-09-03

Assignment and change-plan RPCs reject archived or missing plans before writing. The live transition
verifier attempted both archived-plan operations and confirmed the rejection.

### 97. ✅ Individual plans receive their mandatory one-seat default
**From:** SA-2.2 / SA-2.5 audit Â· **Belongs to:** Module 2 plan management Â· **Resolved:** 2026-09-03

The plan-default trigger and backfill ensure an individual plan has `max_seats = 1` unless an
explicit limit exists. The live plan-version verifier confirmed newly-created behavior.

### 98. ✅ Entitlement verification pins reviewed plan contents
**From:** SA-2.8 audit Â· **Belongs to:** Module 2 entitlement verification Â· **Resolved:** 2026-09-03

`verify-entitlements` now pins reviewed Basic, Pro, and Advance feature arrays and asserts all three
plans exist before comparing live snapshots. Exact feature and suspended-read-only checks pass.

### 99. ✅ Admin user edits and token replacement are atomic
**From:** SA-1.3 audit Â· **Belongs to:** Module 1 admin user management Â· **Resolved:** 2026-09-03

Locked database functions now cover profile/role plus email-change edits, invite replacement, and
password-reset replacement. Live duplicate-email and duplicate-token probes confirmed no partial
mutation.

### 100. ✅ Lifecycle changes revoke old user sessions
**From:** SA-1.4 audit Â· **Belongs to:** Module 1 authentication Â· **Resolved:** 2026-09-03

Users carry a session version; lifecycle changes increment it, new tenant/partner tokens carry it,
and guards compare it on every request. The live user-integrity verifier confirmed old-session
rejection after reactivation and fresh-session success.

### 101. ✅ User reactivation enforces state transitions and seat limits
**From:** SA-1.4 / SA-2.5 audit Â· **Belongs to:** Module 1 admin user management Â· **Resolved:** 2026-09-03

`admin_set_user_status` is a locked SQL transition function that enforces allowed states, seat
limits, suspension fields, and session invalidation. Live failure-path checks pass.

### 102. ✅ Owner preservation is enforced by user-management operations
**From:** SA-1.2 / SA-1.3 audit Â· **Belongs to:** Module 1 tenant membership Â· **Resolved:** 2026-09-03

Admin tenant creation forces the first membership to owner, and role changes lock the tenant before
checking the last-owner invariant. The live user-integrity verifier confirmed both behaviors.

### 103. ✅ Credential links require a configured application origin
**From:** SA-1.2 / SA-1.3 audit Â· **Belongs to:** Module 1 authentication links Â· **Resolved:** 2026-09-03

Admin, agent, and partner invite/reset/email-change routes use the server-only configured-origin
helper and validate it before token creation. No route falls back to `request.nextUrl.origin`.

### 104. ✅ Login telemetry retries without blocking authentication
**From:** SA-1.5 audit Â· **Belongs to:** Module 1 authentication observability Â· **Resolved:** 2026-09-03

Login-event inserts and last-login updates check Supabase errors, retry once, and log a visible
server error after retry while preserving the authentication response across admin, agent, partner,
and signup flows.

### 156. ✅ Users list now reads the live subscription plan
**From:** SA-1.1 Â· **Belongs to:** SA-1.1 Â· **Resolved:** 2026-09-03

The `admin_user_list` view and Users plan-filter options now derive `plan_code` from the tenant's
non-cancelled subscription and its `plans` row. The migration is applied live; the current 14 view
rows all match their live subscription plan.

### 89. ✅ Invoice creation and coupon consumption are atomic
**From:** Module 3 audit Â· **Belongs to:** Module 3 invoice and coupon handling Â· **Resolved:** 2026-09-03

The invoice/coupon operation now uses one idempotent database transaction, so a failed coupon
consumption cannot leave an invoice committed without consuming the matching period. The live
coupon verifier passed replay and counter-restoration checks.

### 93. ✅ Whop provider calls carry tenant context and are logged
**From:** SA-3.1 audit Â· **Belongs to:** Module 3 provider observability Â· **Resolved:** 2026-09-03

Whop client construction accepts the tenant context and all known tenant billing, checkout, trial,
credit, invoice, and billing-mode call sites pass it through to provider-call logging. The live
membership lookup verifier passed positive, wrong-plan, unknown-tenant, and no-throw checks.

### 109. ✅ Migration deep semantic verification no longer times out or misreports screening policies
**From:** repository verification audit Â· **Belongs to:** repository verification Â· **Resolved:** 2026-09-01

The deep migration checker now treats policy creation and removal as dependent DDL after the
tenant-only verification role is denied table-creation rights. The LA-1.5 migration completes the
focused deep check with 38 statements checked, 0 missing-object errors and 0 syntax/order errors.
The checker change is committed in `scripts/check-migrations.mjs`; this resolves the earlier #109
false failure without weakening real migration error detection.

### 118. ✅ LA-1.5 screening service and live acceptance completed
**From:** LA-1.5 Â· **Belongs to:** LA-1.5 Â· **Resolved:** 2026-09-01

The fail-closed typed TCPA/DNC screening boundary is implemented in
`lib/compliance/screening.ts`. The committed migration
`20260902160000_la_1_5_screening_service.sql` was applied to the `Insurvas-Saas` Supabase project.
Live SQL verification confirms the three screening tables, RLS, tenant policies, five lead screening
columns and four cache RPCs. `npm run verify:screening` passed session rejection, required phone
field, invalid-phone audit/no-write, DNC warning persistence, primary-to-secondary fallback logging,
cache replay without extra vendor calls or credits, TCPA precedence/no-write, and concurrent cold
cache sharing. The authenticated agent workspace rendered at `/app/leads` with no browser console
errors; desktop and 390px responsive checks showed no horizontal overflow. Nothing remains open for
LA-1.5.

### 119. ✅ LA-1.5 live verification blockers cleared
**From:** LA-1.5 Â· **Belongs to:** LA-1.5 Â· **Resolved:** 2026-09-01

The two temporary verification gaps recorded during implementation are cleared. The migration is
now present in Supabase migration history and the focused verifier no longer reports NOT TESTABLE
YET. The real browser lead workspace no longer shows the missing `agent_leads.screening_outcome`
column error. The verifier and browser evidence now cover the deployed tenant/session path; no
separate deployment-owner handoff remains.

### 110. ✅ LA-1.1 partner records and lifecycle implemented
**From:** LA-1.1 Â· **Belongs to:** LA-1.1 Â· **Resolved:** 2026-09-01

Tenant-scoped partner records, effective-dated commercial terms, partner memberships, lifecycle
transitions, non-destructive history retention, cached-entitlement partner limits, audit rows,
server-side API guards and the responsive Partners screen are implemented. The live migrations
`20260902100000_la_1_1_partner_records_lifecycle` and
`20260902101500_la_1_1_partner_limit_and_offboard_fix` were applied, and the focused live
partner verifier passes the authorization, lifecycle, audit, RLS, history, idempotency and
concurrency checks. The Partners menu entry now points at the built screen.

The partner portal submission path is now implemented by the LA-1.7 intake follow-up below. Two
later-ticket items remain recorded: the separate inbound-transfer webhook is still a placeholder,
and current SA-2.8 plan-limit payloads do not yet populate the exact per-partner limits owned by
LA-1.19.

### 111. 🟡 LA-1.1 provider inbound-transfer adapter remains outside the current app frame
**From:** LA-1.1 Â· **Belongs to:** provider inbound-transfer integration follow-up Â· **Gap recorded:** 2026-09-03

LA-1.1 stores the partner lifecycle atomically and the partner portal submission API enforces active
status and product approval before its fatal lead insert. The separate inbound transfer webhook still
returns `501 Not Implemented`, so that provider-facing adapter remains outside the current app frame.
LA-1.19 now adds and refreshes the per-type partner limits (`max_publishers`,
`max_marketing_partners`, and `max_affiliates`) and its live verifier exercises those limits.

**Fix:** implement the provider-specific inbound-transfer adapter when that integration is in scope,
using the existing tenant, partner-status, product-approval, and entitlement checks. Cost of leaving
it open: a provider cannot yet post a live transfer through the production-facing webhook, although
the existing partner portal operations and subscription-backed limits are protected.

### 112. ✅ LA-1.1 authenticated browser acceptance completed
**From:** LA-1.1 Â· **Belongs to:** LA-1.1 Â· **Resolved:** 2026-09-01

An entitled local owner agent drove the real `/app/publishers` screen. Browser QA created the
partner, added effective-dated commercial terms, edited the partner, approved a product, paused and
resumed the partner, and confirmed visible success notifications and current-term history. The
authenticated screen rendered without browser errors; the existing responsive shell was also
checked at desktop and phone widths. Server verification covers typed offboarding and the remaining
failure/concurrency paths.

### 113. ✅ LA-1.2 partner users and isolated portal access completed
**From:** LA-1.2 Â· **Belongs to:** LA-1.2 Â· **Resolved:** 2026-09-01

Partner users now have separate login and password-invite flows, partner-admin user management,
database-resolved role and membership checks, next-request deactivation, atomic offboarding
revocation, audit rows, partner/tenant isolation and a responsive portal shell. The migration set
`20260902110000_la_1_2_partner_users_portal_access` plus its numbered ambiguity fixes was applied
to live Supabase. The focused live verifier passed session forgery/expiry, cross-partner and
cross-role access, same-token concurrency, agent-route separation, deactivation, reactivation,
offboarding, audit and protected configuration-route checks. Browser QA rendered the authenticated
partner portal with visible controls and no overflow; the temporary QA account was removed.

All LA-1.2 acceptance criteria are PASS for the routes and operations that exist in this ticket.

### 114. ✅ LA-1.2 partner submission surface resolved by the intake implementation
**From:** LA-1.2 Â· **Belongs to:** LA-1.6 / LA-1.7 Â· **Resolved:** 2026-09-01

The partner portal now renders the configured product form, resumes drafts, validates values on the
server, and submits through the current partner session. Paused partners can still open the portal
and read their existing context, but cannot save a new draft or submit a new lead. The live
LA-1.4 verifier exercised the form, draft, submit, audit and isolation paths. The remaining
provider-facing inbound transfer webhook is a separate later integration and remains in #111.

### 115. ✅ LA-1.3 product-line submission assertions resolved by the intake pipeline
**From:** LA-1.3 Â· **Belongs to:** LA-1.7 Â· **Resolved:** 2026-09-01

LA-1.3 now owns the tenant product switches, per-partner approval rows, the reusable server-side
`assertPartnerProductApproved` check, the no-store partner picker endpoint, and the non-null
`agent_leads.product_line` field. The live LA-1.3 verifier proves disabled products disappear from
the picker immediately, existing approval history is retained, cross-tenant configuration is
blocked, and a catalog product can be added without a deployment.

The LA-1.7 intake follow-up now adds the tenant-scoped queue, deal-flow, notification, failure and
alert records. The live verifier proves an unapproved product is rejected before a lead write, the
selected product line matches across lead/queue/deal-flow, duplicate submissions create one lead,
and the notification is queued. A disabled product keeps its approval history and existing lead
data intact; it only disappears from the current picker.

The selected product's tenant template is resolved before the lead insert, and the retry key makes
the write idempotent under repeated or concurrent requests.

### 116. ✅ LA-1.3 authenticated browser acceptance completed
**From:** LA-1.3 Â· **Belongs to:** LA-1.3 Â· **Resolved:** 2026-09-01

The authenticated owner drove the real product controls on `/app/publishers`: Term Life was enabled,
approved for the partner, disabled and restored. The partner picker reflected the change immediately,
and each save showed a visible notification. The responsive partner portal and product-specific form
were also checked with the same isolated tenant/partner session; the live verifier covers the
cross-tenant and forged-session paths.

### 120. ✅ LA-1.6 partner submission form completed
**From:** LA-1.6 Â· **Belongs to:** LA-1.6 Â· **Resolved:** 2026-09-01

The partner submission screen now uses the immutable tenant form definition, gates the form behind
phone-first TCPA/DNC screening, resumes drafts, autosaves on a 30-second interval and page exit,
validates required fields, records DNC acknowledgement, and requires a stored justification for
duplicate overrides. The live migration `20260902161000_la_1_6_submission_guards` was applied to
`Insurvas-Saas`. The focused verifier passed TCPA blocking, DNC warning and acknowledgement,
duplicate detection and override, idempotent double submit, concurrent submit, audit, and draft
definition-version checks. Authenticated browser QA rendered the real screen at desktop and phone
widths with no console errors or horizontal overflow. No new LA-1.6 backlog item remains.

### 121. ✅ LA-1.7 intake write pipeline completed
**From:** LA-1.7 Â· **Belongs to:** LA-1.7 Â· **Resolved:** 2026-09-01

The partner intake path now performs the capability check and lead insert before best-effort work-item,
deal-flow and notification writes. Re-submitting a draft updates the existing lead and repairs missing
downstream artifacts instead of creating duplicates. Every recorded downstream failure receives one
durable open alert through the database trigger, and the service-role reconciliation function reports
partner leads that have neither a work item nor a recorded failure.

Migration `20260902170000_la_1_7_intake_reconciliation.sql` was applied to the live `Insurvas-Saas`
project. The focused live verifier and the complete LA-1 verifier passed product-line consistency,
partner-local deal-flow date, replay idempotency, missing-work-item reconciliation, durable failure
alerts, repair without a second lead, and audit evidence. Authenticated browser QA rendered the real
partner intake form at desktop and phone widths with no console errors or horizontal overflow, and
verified inline validation and sign-out. The development-only failure injection added to the focused
verifier now covers the real API failure contract; no new LA-1.7 backlog item remains.

### 122. ✅ LA-1.8 affiliate tracked links and lightweight intake completed
**From:** LA-1.8 Â· **Belongs to:** LA-1.8 Â· **Resolved:** 2026-09-01

Affiliate links now have tenant-scoped storage, optional campaign attribution, atomic click counting,
active/paused lifecycle behavior, and owner/bookkeeper management APIs. The public short intake form
collects name, phone, state, product interest and consent, runs the existing LA-1.5 TCPA/DNC screening,
and writes through the same LA-1.7 lead, unclaimed queue, deal-flow, notification and audit pipeline.
Attribution is retained on the lead and downstream records; no affiliate-specific copy of the intake
pipeline was created.

Migration `20260902180000_la_1_8_affiliate_links.sql` was applied to the live `Insurvas-Saas` project.
The focused live verifier passed active-link resolution and click counting, immutable attribution,
TCPA blocking, paused-link messaging and management listing. LA-1 regression verification, the
required typecheck/lint/build/test/feature checks, deep migration verification, and fresh-tab browser
QA at desktop and phone widths passed. Disposable QA tenants and compliance vendors were removed.
Nothing remains unmet, deferred or unverified for LA-1.8, so nothing was added to the open backlog.

### 123. ✅ LA-1.9 pipeline and stage configuration completed
**From:** LA-1.9 Â· **Belongs to:** LA-1.9 Â· **Resolved:** 2026-09-01

Tenant-scoped pipelines, ordered stages, tenant-scoped disposition mappings, default seeding,
atomic reorder, safe archiving, canonical lead stage foreign keys, server-side owner guards,
audit logging and the responsive settings controls are implemented. The live migrations
`20260902190000_la_1_9_pipelines`, `20260902200000_la_1_9_pipeline_atomic_ops`,
`20260902210000_la_1_9_revoke_rpc_execute` and `20260902220000_la_1_9_pipeline_fk_indexes` are
applied to `Insurvas-Saas`.

The focused live verifier passed forged and expired session rejection, role enforcement, tenant
isolation, hostile input, default seeding, create/update paths, atomic and concurrent reorder,
in-use archiving, tenant-scoped mappings, disposition movement, cross-tenant mutation rejection
and audit evidence. Live SQL confirms the three operational tables store only non-null
`pipeline_id`/`stage_id` values, and the pipeline RPCs are executable only by `service_role`.
The authenticated owner settings screen was checked in a fresh browser tab at desktop and phone
widths with no fresh console errors; stage selection, editors, mapping controls and mobile card
layout rendered correctly. The required repository checks and the complete LA-1 verifier passed.
Nothing remains unmet, deferred or unverified for LA-1.9, so nothing was added to the open backlog.

### 124. ✅ LA-1.10 transfer leads inbox and atomic claim completed
**From:** LA-1.10 Â· **Belongs to:** LA-1.10 Â· **Resolved:** 2026-09-01

The transfer inbox uses the existing LA-1.7 `lead_queue` as its single work-item source, with
oldest-first filtering, partner/product/state/screening/claim-owner filters, screening and duplicate
badges, and one-second refresh for claim visibility. A service-role-only, row-locked claim RPC makes
simultaneous claims single-winner: the loser receives a clear 409 and cannot retry or steal the row.
The claim flow creates or reuses a verification session, closes stale active calls before opening a
fresh one, tolerates a racing active-call unique violation, and keeps best-effort partner chat
failure outside the claim result. Canonical ownership and the legacy `claimed_by` field stay synced.

The live migration set through `20260902234000_la_1_10_inbox_filter_order.sql` is applied to
`Insurvas-Saas`; RLS, tenant policies, grants, claim/list RPC privileges and foreign-key indexes
were checked live. `npm run verify:transfer-inbox` passed oldest-first/500-row performance (730 ms),
all server filters, simultaneous claims, cross-tenant isolation, assistant-role denial, forged and
expired sessions, hostile input, stale-call recovery, failed-chat resilience and audit evidence.
Authenticated browser QA rendered the real inbox at desktop and phone widths with clean console
logs, working filters, visible claim controls and no horizontal overflow. Nothing was left unmet,
deferred or unverified for LA-1.10, so nothing was added to the open backlog.


- **#79 Configuration Center route verifier** â†’ resolved 2026-09-01. The verifier now exercises the
  shipped top-level admin routes after the Configuration Center hub was removed. Allowed roles
  return 200; denied roles return the app's server-side 307 denial redirect or 403. All 41 route
  and authentication checks passed. The deliberate Payments role boundary remains documented.

- **#82 period billing migration** â†’ resolved 2026-09-01. Migration `0017_period_billing.sql` was
  applied to the live Supabase project. The real period-billing verifier passed invoice assembly,
  overage, add-on, credit, period coverage, idempotency, and empty-period behavior. The fixture was
  corrected to provide the live schema's required `plan_type` and `is_archived` fields.

- **#86 credit-pack margin verification** â†’ resolved 2026-09-01. The verifier now asserts that the
  API exposes the configured cost and current sell price, rather than assuming every meter's cost
  is zero. Vendor-derived cost remains limited to DNC lookups by design. The complete live
  credits-and-limits suite passed.

- **#107 agent-template verification fixture** â†’ resolved 2026-09-01. A follow-up seed migration
  restores the default Term Life template and product access when the original seed ran before the
  catalog existed. The fixture now reports a useful dependency error instead of crashing. The full
  SA-4.7 verification passed, including tenant copies, edits, merges, idempotency, and RLS.

- **#108 LA-0 operational RLS policies** â†’ resolved 2026-09-01. Tenant-scoped read policies and
  `tenant_app` read grants were applied to the LA-0 tables; mutations remain service-role-only so
  API role, entitlement, read-only, and audit gates cannot be bypassed. The direct tenant-role
  verifier passed for two tenants across all 13 tenant-owned tables and active carrier references.

- **#109 deep migration semantic verification** â†’ resolved 2026-09-01. The checker now parses
  block comments correctly, batches statement execution into one PostgreSQL round trip, and
  distinguishes expected tenant-role privilege blocks from dependent DDL errors. The full live
  migration set completed in 5.2 seconds: 931 statements checked, no syntax, ordering, or
  missing-object errors. The 17 dependent DDL checks that cannot run under the tenant role are
  reported explicitly rather than treated as failures. The fast `npm run db:check` path also passed.

- **LA-0.1 agent shell, login and entitlement-driven menu** â†’ completed and verified 2026-08-31.
  The agent plane uses its own `insurvas_tenant_session` cookie and resolves tenant scope and the
  current membership from that session plus the database; admin cookies are rejected by agent APIs
  and tenant cookies are rejected by admin APIs. The single menu data file carries
  `required_feature` and the shell filters it from the cached entitlement. Direct feature URLs use
  the same entitlement guard and show the upgrade prompt, while every existing feature-bearing
  agent API is listed in `lib/entitlements/agentApiPolicy.ts` and checked against a live
  `requireFeature()` call. Plan changes were verified with the same signed session on the next
  page load. Suspended tenants retain read access to their book and receive 403 `read_only` for
  writes. The responsive sidebar, gate screen and suspended banner were exercised in the browser
  at desktop and 390Ã—844; browser logs were clean. `npm run verify:agent-shell` passed all checks.
  The 23 catalog features without an agent API remain intentionally deferred to their module
  tickets because LA-0.1 excludes module content; `npm run check:features` reports them explicitly
  rather than pretending they are unguarded shipped routes. Items moved here from the open list:
  #28 and the browser-verification portion of #74.

- **LA-0.2 in-tenant roles and permissions** â†’ completed and verified 2026-08-31.
  Tenant membership roles are resolved from the session and database on every request; the role is
  not stored on `users`. The single agent menu data set filters by both entitlement and role. Owner-
  only team management supports invitation, role changes, seat counts and exact-tenant audit rows;
  the database RPCs atomically block demoting or removing the last owner. Assistant money access,
  bookkeeper dial access, producer commission scope, duplicate invitations, hostile input, missing
  members, forged or expired sessions, concurrent owner changes and admin/tenant cookie separation
  all passed `npm run verify:tenant-roles`. The browser exercised the real settings screen: an owner
  invited an assistant, changed that member to bookkeeper, saw the role-specific description and
  received visible success feedback. The existing unrelated template-fixture failure remains
  tracked by #107 under SA-4.7; no new LA-0.2 backlog item was needed. Plan-limit enforcement and
  custom roles remain out of scope by the ticket decision.

- **LA-0.3 dashboard shell** â†’ completed and verified 2026-08-31.
  The dashboard now renders a single data-driven tile registry from
  `lib/dashboard/tiles.ts`; tile visibility uses the cached entitlement's effective feature set,
  and the dashboard component does not branch on plan names. The owner setup checklist is driven
  by the tenant's persisted `onboarding_state`, shows five actionable steps with an accessible
  progress ring, and disappears when the state becomes `completed`. Carrier and appointment tiles
  have useful empty-state copy and next actions; no retention, money, chart, trend, or rearrangement
  placeholders were added. Unit tests cover registry shape, feature filtering, roles, incomplete
  onboarding and completion. Browser QA showed the unfinished checklist and tiles, then confirmed
  the checklist disappeared after a same-session state change and the appointment tile/menu entry
  disappeared when its feature was removed. The authenticated dashboard response measured 930ms on
  a warm dev request and 718ms on a warm production request. No schema migration was needed because the existing tenant state and
  entitlement snapshot already provide the required inputs. Nothing added to the backlog for LA-0.3.

- **#73 / M1-1 / M1-2 atomic user-token redemption** â†’ fixed with two service-role-only,
  security-invoker RPCs stored in a repository migration. Password/reset redemption now locks the
  token and commits password, token consumption, and invite membership acceptance together.
  Email change now commits the unique address and token consumption together; a duplicate rolls
  everything back and leaves the token usable. `verify:user-tokens` exercised real concurrent
  requests: **11/11 passed**, and cleanup was confirmed at zero leftover rows.

- **SA-5.4 terms & privacy acceptance** -> verified 45/45 against the running app. Acceptance stores
  a **document id and version**, never a boolean: recording "accepted the terms" and resolving the
  version at read time would silently re-date every historical acceptance the moment a new version
  was published. `legal_acceptances` is append-only by privilege — UPDATE and DELETE are revoked
  from every role including `service_role` — and the script proves it by trying to back-date a
  record and being refused. Published documents are equally immutable; the sole permitted mutation
  is `clear_reacceptance_requirement`, which can only REMOVE an interruption, so a mistaken publish
  cannot lock out every paying customer with no recovery. Two bugs found by the script, not by
  reading: `select max(...) ... for update` is illegal in Postgres so the publish concurrency guard
  never worked (replaced with an advisory lock), and grepping dev-server HTML for a UI string
  matches Turbopack's **inlined component source** rather than the rendered page — which had made
  one assertion vacuously pass. Seeded text is drafts, flagged as such everywhere [#54].

- **SA-5.3 trial management** -> verified 32/32 against the running app. Reminders are defined as
  offsets from the trial's **end**, not its start, which is what makes "extending a trial pushes
  the charge date and every reminder with it" true by construction rather than by remembering to
  move them. Idempotent on `(subscription, kind, trial_ends_at)`, so an extension deliberately
  re-arms them for the new date. Converting early raises a `charge_automatically` invoice and does
  **not** flip the status — the payment webhook does, so there is one path from money to state.
  Two criteria are met by an honest substitute rather than in full: [#52] and [#53].
  The day-13 in-app banner shares `REMINDER_OFFSET_DAYS` with the emails, so the banner turning
  urgent and the final-day email going out are the same moment by definition and cannot drift.
  Verified in a browser: an extension driven through the dialog moved the row to 12/21, re-sorted
  it, and softened its own risk badge — the screen reacting to the new end date, not a cached one.

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
  its `RETURNS TABLE(tenant_id â€¦)` OUT parameter collided with `on conflict (tenant_id)` — so the
  business-profile step threw at runtime. Fixed with `#variable_conflict use_column`; the sibling
  fix in `20260830010200` could not be reused because an ON CONFLICT target must name the column
  bare. Codex's own `verify:signup` script now passes; it was failing before.
- **A review finding of mine that was wrong:** I reported that the app shell did not gate
  unverified users. It does — new users get `pending_verification` and `signupDestination` redirects
  them to `/app/verify-email`. My grep pattern missed the helper names and I drew a conclusion from
  an absence I had not established.
- **#9 No CI pipeline** â†’ `.github/workflows/ci.yml`. Two jobs: `verify` needs no secrets at all
  (typecheck, lint, 159 unit tests, production build) and gates every push and pull request;
  `database` runs all 20 suites via the new `npm run verify:all`, plus the cross-process kill-switch
  check, and skips itself with a notice when the repository has no credentials configured. The
  no-secret build was proven first — no module reads `process.env` at import time, so placeholders
  exercise the same paths as real keys. This closes the "runs in CI" criterion on SA-1.4, SA-2.6
  and SA-4.10.

- **#65 Kill switches fail OPEN** â†’ the decision stands and is recorded here because the entry was
  removed when #63 was closed. If `feature_switches` cannot be read, every feature is treated as ON
  and the error is logged loudly. Failing closed would turn one unreadable table into a total outage
  for every tenant, triggered by exactly the partial failure a deploy produces; entitlements still
  apply, so nobody gains anything unpaid-for. The reasoning also lives in `lib/features/killSwitch.ts`.
  Revisit only if switches ever become a security boundary rather than an incident tool.
- **#70 was a duplicate of #56** and has been removed. Both record the same deliberate deviation —
  Payments staying `super_admin`-only against SA-4.3's stated matrix. #56 says it better and cites
  the 45-case `verify:configuration` run. I grepped before adding it and missed #56 because it
  phrases the decision differently.

- **#52 Every admin screen scrolled sideways below ~870px** â†’ fixed 2026-08-30, and the diagnosis in
  that entry was wrong. It blamed the fixed sidebar and prescribed collapsing it. The real cause was
  two lines: `<main>` is a flex item, so `min-width: auto` stopped it shrinking below its widest
  child, and `tableShell` used `overflow-hidden` so a wide table had nowhere to scroll. A wide table
  therefore pushed main, main pushed the page, and the sidebar slid off the left. Adding `min-w-0`
  to main and switching the table container to `overflow-x-auto` fixed every admin screen at once:
  measured at a 560px viewport, Users went from 652px of page overflow to 0 and Features from 304 to
  0, with the table scrolling inside its own container instead.

- **#68 Six sections kept the old table treatment** â†’ closed 2026-08-30 after actually looking at
  them. The premise was wrong: the entry assumed rows of Save buttons and thin empty states across
  all six, and only one section had a per-row save at all. What the pass found instead was empty
  states that stated a fact without naming the action — most sharply on Compliance sources, where a
  red "dialing is blocked platform-wide" banner sat directly above a table reading "No compliance
  vendors registered", never connecting the two. Those four now name the way out. Everything else on
  those screens was already carrying its weight in the wider layout, so it was left alone.

- **The connection probe counted its own success as a failure** â†’ fixed during the Module 4 UI pass.
  SA-4.2's test asks Whop for a payment id that cannot exist, and the expected 404 was logged as an
  error, so every connection test made the payment health panel look worse. Surfaced within a minute
  of the configuration hub starting to display that number. The probe now declares which statuses
  mean success for it.

### 62. ✅ SA-4.9 credit packs, defaults and usage monitor completed
**From:** SA-4.9 Â· **Verified in live project, 2026-08-30**

The `credit_packs`, `meter_pricing` and `credit_grants` tables were added in migrations
`0012_credit_limits.sql` and `0013_credit_limits_plan_precedence.sql`, applied to the Insurvas
Supabase project, with control-plane RLS and service-role-only access. The existing SA-2.5
`usage_events` / `usage_totals` counters remain the only usage counters. Grants are additive
current-period allowances, and a plan's own allowance wins over a platform default, including an
explicit unlimited (`NULL`) value.

The admin route and screen support independent pack create/edit/archive, per-meter sell price and
defaults, live DNC vendor cost, manual grants with a mandatory reason, invoice-line creation through
the existing custom-invoice path, and a server-side usage grid with 80%/100% alerts. All writes
are server-gated to `super_admin` and `platform_config` and audit-logged; support agents and billing
admins receive 403, and missing, expired and forged sessions receive 401.

The focused `npm run verify:credits-limits` check passed: concurrent grants, immediate capacity and
monitor updates, invoice-line creation, margin data, plan-default precedence, hostile and missing
inputs, audit rows, and a 500-tenant Ã— 6-meter response. Browser QA at
`http://localhost:3000/admin/configuration/credits-limits` passed with visible focus, native
mandatory-reason validation, successful rendering and no console errors. The pack action uses the
existing issued custom-invoice workflow because this repository has no deferred recurring-invoice
queue; it creates the tenant invoice line now rather than changing Whop's provider charge flow.

Nothing added to the backlog for SA-4.9; all six acceptance criteria are covered by the live
verification evidence above.

### 66. ✅ SA-4.10 multi-process propagation verified
**From:** SA-4.10 Â· **Belongs to:** SA-4.10 Â· **Resolved:** 2026-08-30

The prior single-process check could not prove that one server's in-memory cache invalidation was
not required. `npm run verify:switches:multi` now warms two independent production server processes,
toggles through the first, and confirms that the second reads the database-backed change within the
60-second requirement. It also confirms that restoration propagates within the same bound. The
throwaway tenant and switch row are removed after the run; audit rows remain by design.

- **SA-4.2 payment provider status surface** â†’ implemented 2026-08-30. The protected standalone
  Whop status page, safe status API, environment-only credential policy, explicit permission split,
  centralized request logging, connection-test auditing, and actual error categories are in place.
  Live authenticated browser verification remains tracked under [#8].

- **Windows feature-check shutdown assertion** â†’ resolved 2026-08-30. The feature-key checker now
  sets `process.exitCode` and lets Node close normally, so the required command reports its valid
  no-drift result with exit code 0.

- **#49 The settings store had never written a row** â†’ resolved 2026-08-30. The migration was
  applied and the store was exercised end to end in a browser: saving moved `users.invite_expiry_hours`
  72 â†’ 96 and it survived a reload; the audit row carried `{from: 72, to: 96}`; changing
  `billing.refund_approval_threshold_cents` to 10000 changed the Refunds & credits subtitle from
  "$500.00" to "$100.00" on a **different page, in the same running process, with no restart** —
  which proves cache invalidation and that the value reaches its consumer. `tenant_app` is refused
  the table outright (`permission denied for table settings`), so RLS and the REVOKEs hold. Both
  values were then restored to their defaults; the four audit rows are the record of the test.

- **SA-3.9 revenue dashboard** â†’ MRR/ARR/ARPC, churn, plan breakdown and the activation funnel, off
  a nightly `metrics_daily` snapshot that is re-runnable for any past date. Contracted MRR is shown
  beside collected. The later Module 3 audit found that the gap calculation and historical rebuild
  are not financially reliable; that work is reopened in [#51], M3-7 and M3-8. Two funnel steps
  render as *not instrumented* rather than zero, and are excluded from the biggest-drop-off
  sentence so it cannot name a step nobody measures.
- **Payments were only recorded when a subscription already existed** â†’ fixed in SA-3.9. The
  `recordPayment` call sat after an early return in `applyProviderEvent`, so both real charges were
  invisible. Moved before the subscription lookup and the two payments backfilled: money arriving
  is a fact about the tenant, not about our subscription records.

- **SA-3.8 refunds and credit notes** â†’ verified 14/14. The control the ticket exists for is
  enforced twice: the route refuses a self-approval, and so does a database CHECK constraint that
  no code path can route around. Approval was exercised through the real HTTP route with a second
  admin's session, not by writing the row. Credit notes take a `CN-` series from the same gap-free
  counter as invoices, generalised to (series, year, month) rather than duplicated.

- **#40 The void/mark-paid success path was never exercised through the API** â†’ closed by SA-3.7.
  Custom invoices are born *issued*, which finally produced an unpaid invoice; `verify:custom`
  settles one through the real HTTP route with a minted admin session and asserts the subscription
  reactivates and both actions are audit-logged.
- **SA-3.7 custom invoices and manual billing** â†’ verified 18/18. Manual billing pauses the Whop
  membership: confirmed against the sandbox that this flips `payment_collection_paused` to true
  while leaving `status` as "active" — reading `status` would wrongly suggest the pause failed.

- **SA-3.6 coupons** â†’ Whop promo codes are the real discount, mirrored locally for the UI, the
  invoice line and the audit trail. The redemption cap, one-coupon-per-subscription and the
  duration countdown are all enforced in SQL in a single locked transaction, because checking a
  count and then incrementing it lets two admins both claim the last slot. Verified 13/13,
  including that a 3-period coupon consumes exactly three periods and then deactivates itself with
  no scheduled job. **`promo_duration_months: 0` means forever** — checked against the sandbox
  rather than assumed, since Whop's docs never say.

- **#34 Events stored but nothing acted on them** â†’ SA-3.4. Provider events now drive subscription
  status and rebuild the entitlement immediately. Out-of-order delivery is handled by discarding
  any event older than the last one applied, verified with a deliberately stale event that would
  otherwise have reactivated a failing tenant. `payment.failed` keeps FULL access while Whop
  retries; read-only starts only when Whop gives up.

- **SA-3.3 invoice screens** â†’ list with totals strip, detail, print view and void. The strip's
  numbers are derived from the same rows the filters read, so "the overdue filter matches the strip"
  is true by construction rather than by two calculations agreeing. Verified in a real browser
  against real data: mismatched filter 1 = strip 1, overdue 0 = strip 0. `INV-2026-08-0001` renders
  its $99-vs-$198 disagreement, and Void is correctly refused on it because it was paid.

- **SA-3.2 invoice generation** â†’ built and verified. Numbering is gap-free via a counter row
  updated in the invoice's own transaction, **not** a Postgres SEQUENCE — `nextval` does not roll
  back, so a failed invoice would burn its number permanently. Generation is idempotent on
  `(provider, provider_payment_id)`, which is what makes Whop's at-least-once delivery safe. Real
  stored Whop payloads verified both the matched and mismatched reconciliation paths.
- **#37 The two pre-invoice sandbox payments had no invoices** â†’ closed by replay/backfill. The
  $198 Plan A double-charge is retained as a mismatched financial record ($99 expected), and the
  $249 Plan B payment reconciles. Provider payment idempotency prevents replay duplicates.

- **SA-3.1 proven end to end (2026-08-30).** A second sandbox payment on `plan_b` — whose Whop plan
  was created entirely by the corrected code rather than patched by hand — charged **$249.00 for a
  $249.00 plan**, once. The earlier `plan_a` purchase charged $198 for a $99 plan under the
  `initial_price` bug. Tenant resolved automatically from metadata on both `payment.succeeded` and
  `membership.activated`, with no backfill.

- **#33 Whop payload shapes unseen** â†’ closed 2026-08-30 against three real sandbox events.
  `data.metadata.tenant_id` arrives exactly as sent and resolves to the right tenant on both
  `payment.succeeded` and `membership.activated`. The dashboard's own test event correctly resolves
  to **no** tenant — it carries placeholder ids and no metadata.
- **#35 No Whop product** â†’ created `prod_2hPt3oh77ziBp`, business `biz_Pj5jnt92mDCBZN`. Plan A
  monthly maps to `plan_fCpKbKKfCqYZT`.

- **#30 `createCharge` was the wrong shape for Whop** â†’ SA-3.1. The interface now leads with
  `createCheckoutSession()`, and `createCharge` is **optional** — absent on Whop, which never lets
  us originate a charge, present on the dummies so decline and timeout paths stay testable offline.
  The logging decorator attaches it only when the wrapped provider has one, so
  `provider.createCharge` is not falsely truthy for Whop. Reshaped while it still had zero callers,
  as planned.

- **#31 Nothing receives webhooks** â†’ SA-3.1 built `/api/webhooks/whop`: hand-written Standard
  Webhooks HMAC-SHA256 verification (their SDK helper has not shipped), a 5-minute replay window,
  and `webhook_events` unique on `(provider, event_id)`. Deduplication keys on **processed_at, not
  row existence** — Whop reuses the webhook-id across 12 retries, so treating any repeat as a
  duplicate would permanently lose an event we stored but failed to handle. Verified against the
  running app with the real secret: 8/8, including a body altered after signing (401) and rejected
  requests writing nothing to the table.

- **#15 Seats were documentation-only** â†’ SA-2.5 enforces `max_seats` at user creation. Verified:
  blocked at the limit, `inactive` frees a seat, `suspended` keeps one (matching SA-1.4's table).
- **#19 Menu defined but not rendered to agents** â†’ SA-2.8. `/app` now renders
  `buildAgentMenu(entitlement.features)` — the same function the admin preview uses, so the
  preview is accurate by construction.
- **#25 Rolled periods left a stale entitlement** â†’ SA-2.8 put the refresh in SQL
  (`refresh_tenant_entitlement`), so `advance_billing_periods()` refreshes it directly. Verified:
  rollover bumped the cached version 6â†’7 and the plan reverted correctly.
- **#17 `subscriptions` was a stub** â†’ SA-2.7 filled it in: billing cycle, trial end, period
  start/end, queued plan change, cancel-at-period-end, reason. Both decisions SA-2.2 flagged were
  kept deliberately — `plan_id` points at a specific version (that's what makes grandfathering
  work), and one live subscription per tenant is now enforced in `admin_assign_subscription` too.

- **#10 Admin sessions ignored `is_active`** â†’ SA-1.3. `requireAdminRole()` resolves role and
  active state from the DB per request instead of trusting the 12h JWT. Same fix applied to the
  tenant side, which is what makes SA-1.3's "role change applies on next request" true.
- **#5 Failed logins were invisible** â†’ SA-1.5. `login_events` records every attempt for **both**
  planes, not just tenant users as the ticket specified. SA-6.2 inherits the signal.
- **#2 Invited users read as "Active"** â†’ SA-1.4, settled as a deliberate no-change: status is the
  admin lifecycle, invite acceptance is a separate axis with its own badge.
- **#16 Archiving a feature could break a plan** â†’ fully closed by SA-2.3 + SA-2.8.
  `admin_set_plan_features` preserves archived grants, and the shared entitlement/menu path now
  continues enforcing those grants for existing subscribers.
- **#18 Plan pricing not built** â†’ SA-2.4.
- **Audit log pagination** â†’ fixed in the CRM-styling pass; was hard-capped at 100 rows.
- **Sidebar icon crash** â†’ Lucide components were being passed as props from a Server Component;
  now passes a string key resolved on the client.
- **Server-only code in the client bundle** â†’ broke the first Vercel deploy. `tsc` cannot catch
  this class of bug; see [[verify-with-real-build-not-just-tsc]] in memory.

### 67. ✅ SA-4.12 system maintenance and announcements completed
**From:** SA-4.12 Â· **Belongs to:** SA-4.12 Â· **Resolved:** 2026-08-30

The `maintenance`, `announcements` and `announcement_dismissals` tables were added in migration
`0015_system_maintenance_announcements.sql` and applied to the live Supabase project. The System
configuration route now provides independently saved maintenance and announcement controls with
server-side role checks, audit rows, scheduled activation/clearance, tenant-facing banners,
read-only write blocking, locked-mode routing, admin bypass, plan targeting and per-user
dismissals. Onboarding password and email-confirmation writes also receive the same maintenance
response, and dismissal failures are shown to the user.

The focused `npm run verify:system` run passed all checks against the running application, including
401/403 role handling, normal reads, clear 503 read-only writes, locked tenant login/read blocking,
admin access while locked, future and active schedule behavior, announcement targeting, persistent
dismissal, non-dismissible protection and audit logging. `npm run verify:configuration` also passed
all 45 Configuration Center route and permission checks. Browser QA rendered
`/admin/configuration/system` in the signed-in admin session with visible controls and no console
errors.

All five SA-4.12 acceptance criteria are PASS. Nothing was left unmet, deferred or unverified for
this ticket, so nothing was added to the open backlog.

### 68. ✅ LA-0.5 appointment, licence and E&O vault completed
**From:** LA-0.5 Â· **Belongs to:** LA-0.5 Â· **Resolved:** 2026-09-01

The appointment and contract-level vault is implemented with effective-dated appointments,
state licences, E&O policy records, continuing-education records, shared writing eligibility,
90/60/30-day expiry warnings, owner-only APIs, audit rows, and a responsive settings screen.
The migration is `20260901090000_la_0_5_appointment_contract_level_vault.sql` and was applied to
the live Supabase project. The live verifier passed bulk capture for all 40 states, idempotent
and concurrent saves, historical termination behavior, expired-record refusal, warning timing,
hostile input, missing/forged sessions, producer refusal, and audit coverage. The required
TypeScript, lint, production build, 273-test suite, feature-key check, and diff check passed.
Browser QA saw the real settings screen, state-grid selection and clearing, save confirmation,
responsive nested table scrolling without page overflow, and visible keyboard focus. The
The Term Life template API fixture is now covered by the resolved SA-4.7 work recorded under #107
and is not an LA-0.5 gap. Nothing was added to the open backlog for LA-0.5.

### 69. ✅ LA-0.6 contact and household dedupe completed
**From:** LA-0.6 Â· **Belongs to:** LA-0.6 Â· **Resolved:** 2026-09-01

The tenant-scoped contact, household, phone, email, custom-field schema and reversible merge
tables were added in migration `20260901100000_la_0_6_contact_household_model.sql` and applied to
the live Supabase project. The corrective migration
`20260901101500_la_0_6_secondary_phone_dedupe_fix.sql` makes alternate phone rows part of the
duplicate match. The shared weighted duplicate matcher detects misspelled names and additional
phones, keeps spouses at one address separate, auto-merges only high-confidence matches, sends
medium matches to the side-by-side review screen with per-field source choices, and stores
complete merge snapshots so undo restores both original records. Custom fields are validated
against the JSONB schema and survive CSV import/export; spreadsheet formulas are neutralized on
export.

The live `npm run verify:contacts` run passed all seven acceptance areas: probable duplicate
detection, spouse separation, thresholded/manual merge, reversible undo, CSV round-trip,
sub-500ms search over 20,000 contacts, and cross-tenant isolation. It also passed role denial,
missing and forged sessions, duplicate merge refusal, concurrent undo, hostile custom-field input,
and audit-row coverage. The targeted migration check passed all 48 statements. TypeScript, lint,
production build, 275 tests, `npm run check:features`, and `git diff --check` passed. Browser QA
verified the Basic upgrade gate, the same session gaining Duplicate check after an Advance plan
change, the rendered workspace, responsive mobile layout with no horizontal overflow, phone menu
toggle, and no browser console errors. Screenshot evidence is at
`C:\Users\Victus\.codex\visualizations\2026\09\01\la-0-6-contact-workspace.png`.

All LA-0.6 acceptance criteria are PASS. Nothing was left unmet, deferred or unverified for this
ticket, so nothing was added to the open backlog for LA-0.6.

### 125. ✅ LA-1.11 verification panel and progress completed
**From:** LA-1.11 Â· **Belongs to:** LA-1.11 Â· **Resolved:** 2026-09-02

The agent verification panel is driven by the versioned partner form definition, counts only
visible required fields, records corrections with old and new values, preserves progress across a
dropped call and claimant handoff, and blocks concurrent verification. The server route resolves
tenant and role from the session, enforces the inbound entitlement, writes audit history, and
rejects forged, expired, unauthorized, duplicate, and hostile requests. The live migration and
RPC privilege checks, complete acceptance verifier, mandatory repository checks, and authenticated
desktop/mobile browser QA all passed. Nothing remains unmet, deferred or unverified for LA-1.11,
so nothing was added to the open backlog.

### 126. ✅ LA-1.12 disposition vocabulary and configurable wizard completed
**From:** LA-1.12 Â· **Belongs to:** LA-1.12 Â· **Resolved:** 2026-09-02

The tenant-scoped disposition vocabulary, stage-specific graph wizard, editable walk history,
transactional completion reconciliation, tenant DNC suppression, and owner configuration screen
are implemented. The two new agent API routes are included in the authorization inventory, and
the wizard contains no hardcoded navigation graph. The live migration is applied and verified;
the focused live verifier, deep migration check, TypeScript, lint, production build, unit tests,
feature-policy check, and authenticated desktop/mobile browser QA passed. Nothing remains unmet,
deferred, or unverified for LA-1.12, so nothing was added to the open backlog.

### 127. ✅ LA-1.13 daily deal flow completed
**From:** LA-1.13 Â· **Belongs to:** LA-1.13 Â· **Resolved:** 2026-09-02

The tenant-scoped daily deal-flow screen is implemented as one data-driven grid with date,
partner, product, agent and status filters, partner totals, manual outside-system entry, inline
disposition editing, local-date preservation, complete CSV export, and integer-cent money fields.
The API resolves tenant and role from the session, blocks missing or unentitled access, writes
audit rows for creation and edits, rejects cross-tenant and hostile input, and fetches large
filtered result sets in ordered chunks so the 10,000-row grid remains complete and under two
seconds. The numbered migration is applied to the connected Supabase project and the live
schema/index/trigger checks passed. The focused live verifier, deep migration check, TypeScript,
lint, production build, 282-test suite, feature-policy check, and authenticated desktop/mobile
browser QA passed. Nothing remains unmet, deferred, or unverified for LA-1.13, so nothing was
added to the open backlog.

### 128. ✅ LA-1.14 buffer agent flow completed
**From:** LA-1.14 Â· **Belongs to:** LA-1.14 Â· **Resolved:** 2026-09-02

The assistant buffer flow is implemented using the existing LA-0.2 assistant role. A buffer
assistant can claim and verify an inbound transfer, offer it to a named active owner or
producer, and the receiving licensed agent can see the verification progress before accepting.
Acceptance atomically moves the queue ownership, active call and verification session together;
an expired offer returns the transfer to the buffer without losing the call. Partner-channel
claim cards are exactly-once and retries are idempotent. Disposition and commission access remain
server-denied for assistants, and every mutation has tenant scope and audit evidence.

The numbered migrations were applied to the connected Supabase project and the deep migration
check passed. The focused live verifier passed all five acceptance areas plus role, tenant,
hostile-input, forged/expired-session, duplicate-request, concurrency, timeout and audit checks.
The dependent transfer-inbox and verification verifiers passed, as did TypeScript, lint, the
production build, the 282-test suite, the feature-policy check, and authenticated desktop/mobile
browser QA with no console errors. Manager assignment/ETA/ready routing, multi-LA buffer
membership, buffer performance scorecards and buffer-seat billing remain explicitly out of scope
for this ticket and belong to later product work. Nothing was added to the open backlog for
LA-1.14.

### 129. ✅ LA-1.15 Agent Floor completed
**From:** LA-1.15 Â· **Belongs to:** LA-1.15 Â· **Resolved:** 2026-09-02

The Agent Floor is implemented as one tenant-scoped live view of waiting transfers, open calls,
and team availability. It uses `queued_at` and `started_at` for refresh-safe timers, treats an open
`active_calls` row as the only evidence of a live call, and refreshes from a tenant-scoped Realtime
signal rather than polling. Claim, handoff, accept, nudge, verification, and disposition actions
remain available through the existing lead flow; the floor adds the team nudge action at the lead
itself as well. The API derives tenant and role from the session, enforces the inbound entitlement,
audits writes, rejects hostile input, and makes duplicate nudges idempotent under concurrency. The
amber and red wait thresholds are read from the existing admin settings registry, so operations can
change them without a plan-specific branch or a code redeploy.

The live migration, RLS policies, Realtime triggers, focused security/concurrency verifier, deep
migration check, TypeScript, lint, production build, 282-test suite, feature-policy check, and
authenticated desktop/mobile browser QA all passed. Browser QA saw the live subscription and an
availability change with no console errors; stale `last_seen_at` is also re-evaluated client-side
so a closed laptop becomes offline within one minute even when no further event is emitted.
Nothing was left unmet, deferred, or unverified for LA-1.15, so nothing was added to the open
backlog beyond this resolved record.

### 130. ✅ LA-1.16 nobody-claimed escalation is wired to the LA-1.23 worker
**From:** LA-1.16 Â· **Belongs to:** LA-1.23 Â· **Resolved:** 2026-09-02

LA-1.23 now advances unclaimed leads through one durable ladder and writes exactly-once outbox
events. The worker creates the Ray-only `unclaimed_sla_escalation` notification and email at the
escalation rung, then posts the `nobody_claimed` partner card at the partner-notification rung.
The live verifier proved that all four rungs fire once when the scheduler is run twice and that a
claimed lead is never advanced. Platform scheduling and job-failure alert delivery remain tracked
separately in #143 under SA-6.1.

### 131. ✅ LA-1.16 agent-created channels and direct messages are implemented
**From:** LA-1.16 Â· **Belongs to:** LA-1.16 Â· **Resolved:** 2026-09-06

The delivered chat originally provided one automatically-created partner channel and two-way
messages in that channel. It now also has `partner_channel_members` for explicit direct/group
channels, server-side recipient validation and direct-channel deduplication, plus channel creation,
directory, read-state and message controls at `/app/partner-chat`. The live verifier passed direct
channel creation, durable direct messaging, membership checks and cross-plane denial.

### 132. ✅ LA-1.16 attachments have a private upload/download lifecycle
**From:** LA-1.16 Â· **Belongs to:** LA-1.16 Â· **Resolved:** 2026-09-06

The migration now creates the private `partner-chat-attachments` bucket. Both chat APIs validate up
to three 10 MB allowlisted files, clean up failed uploads, store tenant-scoped metadata, and issue
short-lived signed URLs only after channel membership is checked. The live verifier passed upload,
authorized download, and cross-plane denial. Virus scanning is not part of this ticket and remains a
provider/security hardening item if untrusted external uploads are enabled later.

### 133. ✅ LA-1.17 partner lead pipeline completed
**From:** LA-1.17 Â· **Belongs to:** LA-1.17 Â· **Resolved:** 2026-09-02

The partner lead pipeline is implemented with one server-filtered read model, board and table
views, filters, counters, lead detail and timeline, masked form values, and a safe CSV export.
The API derives tenant and partner scope from the partner session, rejects foreign partner
parameters, permits paused partners to read history, and rejects forged, expired, or offboarded
access. The read RPCs are restricted to the service role, and the pipeline change trigger emits
an opaque partner-scoped realtime signal while the UI refreshes its durable read model.

The performance verifier later reproduced a server-side N+1 latest-deal lookup at 5,000 rows. The
read model now paginates on the server, computes complete counters and facets independently of the
page, and enriches only the bounded page with one latest-deal join. `EXPLAIN ANALYZE` fell from
about 3.38 seconds to 77.7 ms on the retained 5,000-lead fixture, and the focused API verifier
proved distinct pagination plus the under-two-second first-page requirement. The UI loads 250
rows at a time and preserves loaded pages during live refreshes.

### 137. ✅ LA-1.20 Notes tab blocker resolved by LA-1.21
**From:** LA-1.20 Â· **Belongs to:** LA-1.21 Â· **Resolved:** 2026-09-02

LA-1.21 replaced the lead-workspace Notes placeholder with tenant-scoped notes, author and
timestamp display, internal/shared visibility, partner-channel synchronization, mention
notifications, cross-lead search, edit history, and timeline tombstones. The live migrations and
focused verifier passed. The prior LA-1.20 blocker is therefore resolved; authenticated browser
verification remains tracked separately in #138 and #139.

### 134. ✅ LA-1.18 partner-quality migration is applied and live-verified
**From:** LA-1.18 Â· **Belongs to:** LA-1.18 Â· **Resolved:** 2026-09-02

The numbered partner-quality migration and its follow-up count-field fix are applied to Supabase
project `iiimdgizjwnihpyrukbu`. The live catalog now contains `partner_quality`; the report and
drill-down RPCs exist and are executable only by `service_role`. `npm run check:features` passes,
and `npm run verify:partner-quality` proves live record-derived counts, exact reconciliation,
zero rows for partners with no leads, exact drill-downs, no cost fields, role and tenant isolation,
session failure handling, hostile-input rejection, and concurrent reads.

### 135. ✅ LA-1.18 authenticated browser QA completed
**From:** LA-1.18 Â· **Belongs to:** LA-1.18 Â· **Resolved:** 2026-09-07

The live migration and API verifier now pass, and the page is present at `/app/partner-quality`.
An authorized disposable agent owner opened `/app/partner-quality` in the real local browser. The
desktop and 390px phone-sized views rendered without console errors or horizontal overflow; the
live partner-quality verifier also passed sorting, date validation, cost disclaimer, zero-partner
rendering, and drill-down behavior.

The former localhost-browser blocker is resolved.

### 136. ✅ LA-1.19 authenticated browser QA completed
**From:** LA-1.19 Â· **Belongs to:** LA-1.19 Â· **Resolved:** 2026-09-07

The live API and database checks for subscription limits pass. A production server and an existing
An authorized disposable agent owner opened the partner capacity UI and settings in the real local
browser at desktop and 390px phone-sized widths. The screens had no console errors or horizontal
overflow, and the live subscription-limit verifier passed cap enforcement, pause/unpause behavior,
downgrade protection, and upgrade messaging.

The former localhost-browser blocker is resolved.

### 138. ✅ LA-1.20 authenticated lead-workspace browser QA completed
**From:** LA-1.20 Â· **Belongs to:** LA-1.20 Â· **Resolved:** 2026-09-07

A production server and an existing agent tab were both available on 2026-09-03, but the in-app
An authorized disposable agent owner opened a real expired lead at `/app/leads/<id>`, verified the
detail tabs, notes, timeline, and `Reopen in queue` action, then confirmed the lead returned to the
workable queue. Desktop and 390px phone-sized checks had no console errors or horizontal overflow.
The live verifier also passed tenant isolation, role gates, hostile identifiers, and partner-session
separation.

The former localhost-browser blocker is resolved.

### 139. ✅ LA-1.21 authenticated notes browser QA completed
**From:** LA-1.21 Â· **Belongs to:** LA-1.21 Â· **Resolved:** 2026-09-07

The live API and database verifier cover note creation, default internal visibility, partner
filtering, visibility reversal, edit history, tombstones, mentions, search, tenant isolation,
role gates, expired/forged sessions, duplicate requests, concurrent requests, and hostile input.
On 2026-09-03 the production server and an existing agent tab were available, but the in-app
An authorized disposable agent owner opened the Notes tab on a real lead, created and edited a note,
and verified the edit-history presentation. Desktop and 390px phone-sized checks had no console
errors or horizontal overflow; the live verifier passed visibility, search, edit, tombstone,
mention, duplicate, concurrency, tenant-isolation, and role-gate behavior.

The former localhost-browser blocker is resolved.

### 140. ✅ LA-1.22 authenticated callback browser QA completed
**From:** LA-1.22 Â· **Belongs to:** LA-1.22 Â· **Resolved:** 2026-09-07

The live callback verifier and protected route checks pass. On 2026-09-03 the production server
An authorized disposable agent owner opened `/app/callbacks`, verified the callback calendar and
completed a fixture callback. Desktop and 390px phone-sized checks had no console errors or
horizontal overflow; the live verifier passed timezone handling, schedule/reschedule/cancel/
complete transitions, idempotency, history, role gates, and tenant isolation.

The former localhost-browser blocker is resolved.

### 141. ✅ LA-1.23 SLA migration is applied and live-verified
**From:** LA-1.23 Â· **Belongs to:** LA-1.23 Â· **Resolved:** 2026-09-02

The SLA migration and its runtime ambiguity fix are applied to project
`iiimdgizjwnihpyrukbu`. Live schema checks confirm both tables, both tenant RLS policies, the
service-role-only functions and no public function grants. `npm run verify:unclaimed-sla` proves
all four rungs fire exactly once across duplicate runs, claimed rows are never expired, expired
leads reopen successfully, and a second reopen is idempotent.

### 142. ✅ LA-1.23 authenticated SLA settings and expired-lead browser QA completed
**From:** LA-1.23 Â· **Belongs to:** LA-1.23 Â· **Resolved:** 2026-09-07

An authorized disposable agent owner exercised the SLA settings validation and save confirmation,
then opened an expired lead and reopened it successfully. Desktop and 390px phone-sized checks had
no console errors or horizontal overflow. The live SLA verifier passed the four-rung exactly-once
ladder, claimed-lead protection, and idempotent reopen behavior.

The former localhost-browser blocker is resolved.

### 143. ✅ LA-1.23 failure alerts and heartbeat monitoring wired
**From:** LA-1.23 Â· **Belongs to:** SA-6.1 Â· **Resolved:** 2026-09-07

The scheduler now records durable success/failure heartbeats in `audit_log`, sends a deduplicated
operator email when processing fails or the heartbeat becomes stale, exposes an authenticated
heartbeat endpoint, and runs through the committed Vercel Cron route `/api/cron/unclaimed-sla`.
Live QA proved unauthorized cron access returns `401`, authorized cron execution returns `200`,
the heartbeat endpoint returns `200 healthy: true`, and the failure path previously delivered an
operator alert through the configured SMTP transport.

The former SA-6.1 dependency is resolved in the application. Production still requires the
documented `CRON_SECRET`, `UNCLAIMED_SLA_SECRET`, and alert-recipient environment variables before
the production deployment is promoted.

### 144. ✅ LA-1.23 escalation is consumed by the LA-1.25 alert center
**From:** LA-1.23 Â· **Belongs to:** LA-1.25 Â· **Resolved:** 2026-09-02

LA-1.25 consumes `agent_notifications`, maps `unclaimed_sla_escalation` to its own event controls,
and provides the in-app toast, browser notification and distinct sound path without duplicating the
source-key event. The live alert verifier proves durable source-key deduplication and per-event
settings. Real browser presentation evidence remains tracked separately in #146.

### 145. 🔵 LA-1.24 authenticated existing-customer browser QA is blocked by the localhost browser policy
**From:** LA-1.24 Â· **Belongs to:** LA-1.24

On 2026-09-03 the production server and an existing agent tab were available, but the in-app
browser rejected the localhost tab claim under its URL safety policy. The inbox row, Agent Floor
card, lead-workspace pre-flight card, manual re-check confirmation, desktop/mobile layout, visible
keyboard focus, and authenticated console could not be driven. The live RPC, API authorization,
persistence, tenant isolation, concurrency, hostile-input, and performance checks pass, but they
do not replace the required authenticated browser evidence.

**Fix:** sign in as an entitled local agent owner, producer, or assistant, open a real lead, verify the pre-flight result and policy-matching disclaimer on the inbox, Agent Floor, and lead workspace surfaces, exercise manual re-check, repeat at desktop and phone widths, inspect console errors and keyboard focus, and capture the finished authenticated screen. Remove this entry only after that browser run is clean.

### 146. 🔵 LA-1.25 authenticated alert-center browser QA is pending an authorized agent session
**From:** LA-1.25 Â· **Belongs to:** LA-1.25

The live settings/API verifier and migration checks pass. The available in-app browser refused
localhost control under its URL safety policy before the authorized agent state could be inspected,
so the finished authenticated alert center could not be driven. Browser notification permission,
denied-permission fallback, notification click-through, DND indicator, sound controls, per-event
persistence in the real UI, console cleanliness, keyboard focus, and desktop/mobile screenshots
therefore remain unverified.

**Fix:** use an approved browser surface that permits localhost, sign in as an entitled local agent
owner, producer, assistant, or bookkeeper, open any `/app` page, exercise the Alert settings panel
and each toggle, grant and deny browser permission in separate runs, create a test alert in a
background tab, click it to open the lead, test DND, mute, volume, and a ten-lead burst at desktop
and phone widths, inspect console errors and keyboard focus, and capture the finished screen.

### 147. 🔴 LA-1.25 and LA-1.22 disagree about callback reminder email
**From:** LA-1.25 Â· **Belongs to:** LA-1.25 / LA-1.22

LA-1.25's channel matrix says callback-due alerts have no email and that email is for escalations only. LA-1.22 explicitly requires configurable callback reminders in-app and by email, and the existing callback reminder worker still sends that email. The alert center correctly does not add another email, but changing the worker here would break the earlier callback ticket without a product decision.

**Fix:** decide whether callback reminder email remains a LA-1.22 exception or must be removed in favor of the LA-1.25 matrix, then update the owning callback worker, tests, and both ticket specifications together. Cost of leaving it open: the UI channels are correct for browser/toast/sound, but routine callback email behavior is not unambiguously aligned with the combined requirements.

### 148. ✅ LA-1 database RPC grants and early tenant-policy advisor findings resolved
**From:** LA-1 module audit Â· **Belongs to:** LA-1.1 / LA-1.4 / LA-1.8 / LA-1.12 / LA-1.15 Â· **Resolved:** 2026-09-03

The live security advisor found direct anonymous/authenticated execution on the LA-1.4 draft RPC
and LA-1.15 Realtime trigger function, a mutable search path on LA-1.12 note rendering, and four
early tenant policies that recomputed session context per row. Migration
`20260903200000_la_1_security_and_rls_advisor_fix.sql` revokes those grants, pins the function
search path, and recreates the policies with initplans. The migration is applied live;
`npm run verify:la1-security` passes and the targeted security/performance advisor findings are zero.

### 149. ✅ LA-1.15 transient Realtime verification failure passed on immediate rerun
**From:** LA-1 module audit Â· **Belongs to:** LA-1.15 Â· **Resolved:** 2026-09-03

One parallel QA run received no Agent Floor Realtime event inside the one-second probe and failed
both delivery assertions. The immediate isolated rerun passed both assertions and the full
LA-1.15 suite. No state transition failed and the durable floor read remained correct. Keep the
one-second probe visible in CI; recurrence would indicate a Realtime reliability issue rather than
an application-state failure.

### 150. ✅ Stale LA-1.16 and LA-1.20 verification fixtures removed
**From:** LA-1 module audit Â· **Belongs to:** LA-1.16 / LA-1.20 Â· **Resolved:** 2026-09-03

Twelve synthetic tenants remained after earlier interrupted checks because the LA-1.16 cleanup
attempted to delete partners before restrictive `partner_users` rows and ignored the failed delete.
The cleanup order now deletes memberships first. All matching `@invalid.test` users and the exact
synthetic tenant-name patterns were inspected, removed, and re-counted at zero.

### 152. 🔵 Shared LA-1 workspace UI needs authenticated browser verification
**From:** LA-1 module UI improvement pass Â· **Belongs to:** LA-1.16 / LA-1.18â€“LA-1.25 Â· **Gap recorded:** 2026-09-03

The agent shell now renders a shared responsive workspace bar on every `(shell)` route, showing the
current menu section, nested-route page context, role, plan, workspace readiness, and read-only state.
The partner portal header now uses the same hierarchy and clearly exposes partner identity, role, and
non-active status. TypeScript, lint, and production build pass, but the in-app browser again refused
to claim the available `localhost:3000` tab under its URL safety policy. Desktop/mobile screenshots,
keyboard focus, console output, and live interaction behavior therefore remain unverified.

**Fix:** use an approved browser surface that permits the local app, sign in with an authorized agent
and partner account, inspect every LA-1 page at desktop and phone widths, and capture screenshots and
console/focus evidence. Cost of leaving it open: the shared treatment is compiled and route-wide, but
its required end-user visual and interaction evidence is still missing.

### 153. ✅ LA-1.13 report-options migration applied and performance verified
**From:** LA-1.13 performance follow-up Â· **Belongs to:** LA-1.13 Â· **Resolved:** 2026-09-03

The report service now receives partner and agent filter options in the same `list_deal_flow_report`
payload, avoiding extra lookup round trips. The committed migration
`supabase/migrations/20260903170000_la_1_13_report_options_rpc.sql` was applied to project
`iiimdgizjwnihpyrukbu` with the privileged Supabase migration tool. Live SQL confirmed the function
embeds the options and grants execution to `service_role`; the focused verifier then measured the
10,000-row filtered page within the two-second contract.

**Resolution:** `npm run verify:deal-flow` passed all checks, including the performance threshold.
The service fallback remains for migration-order safety. Cost before resolution: the report could
exceed the two-second first-page contract under live database latency.

### 84. ✅ SA-4.8 registered fallback and last-vendor confirmation verified
**From:** the PR #8 review Â· **Belongs to:** SA-4.8 Â· **Resolved:** 2026-09-03

The last-enabled DNC vendor confirmation is implemented in the admin screen and enforced again by
the server with `confirm_dnc_block`. `npm run verify:compliance` proves the confirmation response,
the platform-wide blocked state, and the audit trail. `npm run verify:screening` exercises two
registered vendors in priority order, forces the primary failure, and verifies the secondary result
and persisted fallback row. No per-vendor or browser-only bypass remains for these criteria.

### 85. ✅ DNC availability status now reflects recent vendor health
**From:** the PR #8 review Â· **Belongs to:** SA-4.8 Â· **Resolved:** 2026-09-03

`getDncDialingStatus` now evaluates the rolling 24-hour provider-call health for every enabled DNC
vendor. The admin registry also marks an enabled vendor as `Unreachable` and shows the blocked
banner when every enabled vendor has failed observed calls. The focused verifier forced both
registered vendors through failed connection tests and confirmed the unavailable response, while
the static typecheck and production build passed.

### 88. ✅ Webhook completion writes are durable and failure-visible
**From:** Module 3 audit Â· **Belongs to:** Module 3 webhook handling Â· **Resolved:** 2026-09-03

`markProcessed` and `markFailed` now check every Supabase write and require the target webhook row
to exist. A failure to persist completion or failure state cannot be acknowledged as a successful
webhook delivery; the route returns HTTP 500 and Whop can retry. Known-tenant `payment.succeeded`
events already reject a missing invoice instead of marking themselves processed. The live signed
webhook verifier and repository gates pass.

### 90. ✅ Manual settlement is atomic, targeted, and rejects overpayment
**From:** Module 3 audit Â· **Belongs to:** Module 3 manual billing Â· **Resolved:** 2026-09-03

The service-role RPC locks the invoice, sums successful payments, rejects amounts above the
outstanding balance, inserts the payment, settles the invoice, and changes only the invoice's own
past-due or suspended subscription in one transaction. `npm run verify:settlement` drove the real
admin route and passed overpayment rollback, partial payment, final settlement, unrelated
subscription protection, duplicate-reference handling, and the no-overpayment invariant.

### 91. ✅ Coupon plan and billing-cycle restrictions are enforced by the RPC
**From:** Module 3 audit Â· **Belongs to:** Module 3 coupon handling Â· **Resolved:** 2026-09-03

`admin_apply_coupon` now locks the target subscription and coupon, checks `restricted_to_plan_ids`
and `billing_cycle`, and returns named rejection results before creating a redemption. The live
coupon verifier bypasses the UI and confirms both an incompatible-plan and incompatible-cycle
coupon are refused without consuming a redemption.

### 92. ✅ Refund and credit execution have recoverable reconciliation states
**From:** Module 3 audit Â· **Belongs to:** Module 3 credit-note handling Â· **Resolved:** 2026-09-03

Credit-note execution now records an explicit reconciliation state and attempt count. Credits and
waivers apply their balance and mark the note reconciled in one locked transaction, so a retry
cannot apply the same credit twice. Refund execution claims a note in a locked service-role
function, reuses the same provider idempotency key on retry, preserves provider-pending state
when the provider outcome is unknown or local reconciliation fails, and exposes an audited admin
retry route. Definite provider failures are recorded as failed with a reason. The live credit-note
verification passed the failure-state and replay checks.

### 157. ✅ LA-1.17 cold first-page performance is within contract
**From:** LA-1 module audit Â· **Belongs to:** LA-1.17 Â· **Resolved:** 2026-09-03

The partner pipeline RPC pages before display enrichment and uses scoped 16MB `work_mem` for its
5,000-row bounded aggregate window. Two consecutive live runs passed the first-page requirement:
250 rows returned from 5,000+ partner leads in under two seconds, while tenant/partner isolation,
filters, masking, pagination, and fail-closed session checks also passed. The migration is committed
as `supabase/migrations/20260903360000_la_1_17_pipeline_work_mem.sql` and applied to the connected
Supabase project.

### 158. 🔵 LA-1.2 recipient inbox placement confirmation remains open
**From:** LA-1.2 Â· **Belongs to:** LA-1.2 / SA-4.11 Â· **Gap recorded:** 2026-09-03 Â· **Updated:** 2026-09-04

The invitation routes now call the shared email transport, return `delivered`, write an append-only
`email_log` row for sent/failed/skipped attempts, and expose a secure copyable link when delivery
is unavailable. The focused live verifier passed those delivery-result and log checks. The supplied
SMTP configuration was then loaded into the ignored local `.env.local`; `npm run email:test --
rinorgllareva1@gmail.com` authenticated successfully and returned `sent`, with a matching
`email_log` row and provider message id. The recipient must still confirm inbox or spam-folder
receipt, because SMTP acceptance is not proof of mailbox placement.

The requested partner invitation to that same address previously returned `409 This email is already
registered`. The repository now contains an explicit safe path in
`supabase/migrations/20260904100000_la_1_2_existing_account_invites.sql`: existing active accounts
receive a `/partner/accept-invite` link, re-authenticate with their current password, and are
linked to the partner atomically without changing that password. The old `/partner/set-password`
endpoint rejects existing-account invitations, so a leaked or misrouted token cannot replace an
existing password.

The initial migration and the corrective follow-up migration
`supabase/migrations/20260904110000_la_1_2_existing_account_invites_ambiguity_fix.sql` are now
applied to the connected Supabase project. The follow-up qualified the resend invitation and
existing-account membership updates that the first live run found ambiguous.

`npm run verify:partner-users` now passes every LA-1.2 live check, including partner-admin and agent
resend, existing-account sign-in acceptance with the current password, one-time replay rejection,
password replacement protection, role isolation, session revocation, offboarding, and audit coverage.
The only remaining evidence is external: SMTP acceptance was previously proven, but the authorized
recipient still needs to confirm that the invitation arrived in the inbox or spam folder.

**Fix:** have the authorized recipient confirm the test message arrived. Cost of leaving it open:
mailbox placement is not independently verified, although the transport, application workflow,
database migration, and live verifier are green.

### 159. ✅ LA-1.2 partner-admin resend control needs an authenticated browser run
**From:** LA-1.2 Â· **Belongs to:** LA-1.2 Â· **Gap recorded:** 2026-09-03

The owner agent browser screen was rendered at `/app/publishers` with the Portal users invite,
pending-user and offboarded-access states, no console errors, visible validation, and a responsive
390px pass. The partner-admin resend button is covered by the live API verifier, but a browser run
through `/partner` was not repeated because no active authorized partner-admin session was
available; the existing demo partner is offboarded. The missing evidence is not permission to
create or change a real partner account.

**Resolved:** 2026-09-04. An authorized active partner-admin session was verified at `/partner/team`
on desktop and phone widths. The screen showed active, pending and deactivated counts, pending
`Resend invite` controls, visible validation beside the name field, and no console errors or
horizontal overflow. The live partner-user verifier also confirms the resend route and its delivery
result. No real invitation was sent during the browser run.

### 160. ✅ LA-1.1 partner-user team restriction browser QA completed
**From:** LA-1.1 Â· **Belongs to:** LA-1.1 Â· **Resolved:** 2026-09-04

The server-side restriction is implemented and live-tested: partner users cannot open `/partner/team`,
cannot read `GET /api/partner/users`, and cannot invite, resend, activate or deactivate users. The
separate authenticated partner-user browser run is complete. On desktop and a 390px phone-sized
viewport, the Team navigation item was absent, `/partner/team` redirected to `/partner`, the overview
showed the read-only “managed by admin” team notice, there was no horizontal overflow, and the browser
reported no console errors or warnings. The disposable QA user was removed after verification.

The server-side checks remain green: partner users receive 403 for roster, invite, resend, activate and
deactivate operations. No real partner data or invitation was changed during this browser run.

### 161. ✅ LA-1.17 cold pipeline first-page threshold restored
**From:** LA-1.1 adjacent retention QA Â· **Belongs to:** LA-1.17 Â· **Resolved:** 2026-09-05

The partner pipeline route now calls the existing tenant-scoped, bounded
`partner_lead_pipeline_page` database read model instead of downloading up to 5,000 queue rows and
5,000 lead rows into Node for filtering and aggregation. Stage metadata is joined back to the compact
payload for the existing UI contract. Filters, counters, masking, isolation and pagination remain
server-side.

The live LA-1.17 verifier now passes: 250 rows from 5,000+ leads returned under two seconds, followed
by passing load-more pagination, hostile-pagination rejection and offboarded-access checks. The full
LA-1 matrix also passes all 27 suites.

### 162. ✅ LA-1.4 lead CSV import authenticated browser QA completed
**From:** LA-1.4 Â· **Belongs to:** LA-1.4 Â· **Resolved:** 2026-09-04

An authorized disposable agent owner opened `/app/import`, selected a real CSV through the browser
file chooser, saw the file preview, imported an active-field CSV, and received the visible “1 lead
imported” notification. The page reset its upload state after success and reported no console errors
or warnings. An intentionally invalid CSV also preserved the file and showed the row-level error.
The disposable tenant and user were removed after the run; append-only audit rows were retained.

### 163. ✅ CSV import retries are durable-idempotent
**From:** LA-1.4 Â· **Belongs to:** LA-1.4 import hardening Â· **Resolved:** 2026-09-04

The API now stores a tenant-scoped import batch keyed by `Idempotency-Key`, and the UI reuses that key
when retrying after a network error. A completed replay returns the original result without writing
another lead, while two simultaneous identical requests produce one batch. The migration is
`supabase/migrations/20260904120000_la_1_4_lead_import_batches.sql`; the live verifier passed replay,
concurrency, isolation, invalid-input, typed-value, custom-field and audit checks.

### 164. ✅ LA-1.7 real API downstream-failure injection verified
**From:** LA-1.7 Â· **Belongs to:** LA-1.7 Â· **Resolved:** 2026-09-04

The focused verifier now sends a real `POST /api/partner/leads` request with a development-only,
production-disabled work-item failure injection. It proves the endpoint still returns success, the
lead is retained without a queue row, the durable `intake_failure` is written with step `work_item`,
the database creates one open alert, and reconciliation succeeds because the failure is logged. The
disposable tenant is cleaned up after the run. This closes the remaining LA-1.7 verification gap.

### 165. ✅ LA-1.17 cold pipeline first-page performance regression resolved
**From:** LA-1.8 full LA-1 regression Â· **Belongs to:** LA-1.17 Â· **Resolved:** 2026-09-06

The live regression was reproduced with the current 5,002-lead fixture. The bounded database read
itself was fast, but PostgreSQL JIT compilation added several seconds to the cold execution of the
complex JSON read model. The versioned migration
`supabase/migrations/20260906130000_la_1_17_pipeline_disable_jit.sql` disables JIT only for
`partner_lead_pipeline_page`; it does not change the project's global database setting.

The focused verifier then passed twice consecutively with 5,000 partner leads: 250 rows returned
under two seconds on both runs, with isolation, filters, masking, pagination, paused-history access,
hostile pagination rejection, and offboarded-access denial also passing. Temporary profiling rows
were removed from the disposable demo tenant after verification.

### 166. ✅ LA-1.15 Agent Floor Realtime signal passed consecutive live reruns
**From:** LA-1.14 buffer-agent flow integration QA Â· **Belongs to:** LA-1.15 Â· **Resolved:** 2026-09-06

The LA-1.15 Agent Floor verifier initially reported no `floor_changed` event within one second and
no tenant-scoped broadcast during the LA-1.14 integration audit. The live trigger and
`broadcast_la_1_15_floor_change()` definition were then inspected, and the full Agent Floor verifier
passed twice consecutively. Both reruns confirmed the tenant-scoped signal arrived within the
one-second threshold, alongside the existing tenant isolation, role gates, stale-heartbeat,
idempotent nudge, active-call, and suspended-tenant checks.

The transient failure is resolved. Keep the two-run probe in CI so a recurrence is visible. Cost of
leaving the check unmonitored: a future Realtime regression could make Agent Floor users refresh
before seeing a new claim or handoff.

### 167. ✅ LA-1.16 authenticated browser smoke completed
**From:** LA-1.16 Â· **Belongs to:** LA-1.16 Â· **Resolved:** 2026-09-06

An authorized disposable agent owner signed in through `/app/login` and drove the real
`/app/partner-chat` screen. The browser loaded all seeded partner channels and the partner-user
directory without console errors, created a private direct conversation, sent a durable direct
message, sent a partner-channel message with a private attachment, and rendered the signed
attachment link after reload. The attachment-only failure path now stays client-side with the
human message `Add a short message before sending attachments.` and the send button disabled.
The desktop page had no horizontal overflow; the responsive grid uses the existing small-screen
stacking breakpoint. The live verifier separately covers the mobile-safe server and attachment
authorization paths.

### 168. 🟡 LA-1.23 production scheduler environment must be promoted
**From:** LA-1.23 Â· **Belongs to:** SA-6.1 / deployment operations Â· **Gap recorded:** 2026-09-07

The committed Vercel Cron route and authenticated heartbeat are implemented and passed live local
verification. Production execution still depends on setting `CRON_SECRET`, `UNCLAIMED_SLA_SECRET`,
`UNCLAIMED_SLA_ALERT_EMAIL`, and `UNCLAIMED_SLA_HEARTBEAT_SECONDS` in the production deployment,
then promoting a deployment that includes `vercel.json`. Without those environment values, the
production cron fails closed and the operator alert cannot be delivered.

**Fix:** configure the four server-only production variables in the deployment provider, deploy the
current commit to production, and run one authorized cron invocation plus one heartbeat check against
the production URL. Cost of leaving it open: local and preview environments are protected, but
unclaimed-lead escalation is not yet proven on the production scheduler.

### 169. 🔵 Full repository aggregate QA has unrelated live-fixture failures
**From:** LA module audit Â· **Belongs to:** the owning SA/LA verification tickets Â· **Gap recorded:** 2026-09-07

The full `npm run verify:all` run completed with four failures outside the LA-1.18â€“LA-1.23 scope:
compliance-vendor “last enabled DNC vendor” assumptions conflict with existing live vendors, dial
preflight refuses to mutate an already-enabled DNC vendor, credits-and-limits orphan-fixture cleanup
timed out, and LA-1.10 transfer-inbox failed only in the aggregate run. The transfer-inbox suite
passed when rerun individually immediately afterward. No unrelated live vendor state was changed.

**Fix:** make the compliance and dial verifiers create isolated vendor state or assert the existing
state before testing; make credits-fixture cleanup bounded and retryable; then rerun the complete
aggregate suite. Cost of leaving it open: the LA-1.18â€“LA-1.23 focused gates are green, but the
repository-wide green flag remains unavailable.

### 170. ✅ RESOLVED — the LA-1.9 and LA-1.12 remainder followed the pipeline rename
**Recorded:** 2026-09-12 Â· **Resolved:** 2026-09-13

This tracked eight RPCs the application called that did not exist in the database — five in
`lib/pipelines` (`archive_pipeline_stage`, `delete_tenant_pipeline`, `move_lead_to_disposition`,
`reorder_pipeline_stages`, `set_stage_disposition`) and three in `lib/dispositions`
(`complete_disposition`, `record_disposition_answer`, `start_disposition_walk`), each a runtime 500 on
the path that reached it.

Closed by the LA-1.9 and LA-1.12 rename work (`20260912390000`, `20260912430000`, `20260912440000`).
Confirmed independently by `verify-rpc-contract` in the full run of 2026-09-13:

    RPCs called by the application : 132
    Present in the database        : 132
    Missing from the database      : 0

### 171. 🟡 One template per product per version makes duplication impossible
**From:** LA-1.4 audit Â· **Belongs to:** SA-4.6 Â· **Gap recorded:** 2026-09-12

`templates_product_version_compat_idx`, created by `20260911100000_live_runtime_compatibility.sql`,
is `unique (product_code, version)` across the whole table rather than per template. So the platform
can hold only one template per product per version, and `admin_duplicate_template` cannot produce a
second one for a product that already has a row at that version:

    23505 duplicate key value violates unique constraint "templates_product_version_compat_idx"

This is not a fixture artifact. Any operator duplicating a live product template hits it. It became
visible because the demo seed created `Term Life intake` at `term_life` v1, which is now the only
term_life template the catalog can ever hold, and `verify-agent-templates.mjs` stops there.

SA-4.6 says "editing a template already in use creates a new version", so versions are meant to
accumulate per template. An index that is unique on `(product_code, version)` globally contradicts
that: two templates for one product can never share a version number, including version 1.

**Fix:** decide the intended key — most likely the index should not be global, or duplication should
select the next free version for the product — then correct the index and rerun
`verify-agent-templates`. Cost of leaving it open: template duplication is broken in the product,
and LA-1.4 acceptance criterion 6 has no reachable evidence.

### 172. 🟡 A blocked TCPA transfer is recorded nowhere, so LA-1.18 has no source
**From:** LA-1.5 audit Â· **Belongs to:** LA-1.5, LA-1.18, LA-1.6 Â· **Gap recorded:** 2026-09-12

The sixteen-questions decision #9 rules that a litigator transfer is non-billable, is recorded as a
rejected submission with reason `tcpa_block`, counts against that partner's quality statistics, and
never enters deal flow or billing. The partner sees a coded reason and a running count, never a list
of the numbers that were blocked.

None of it exists. `app/api/partner/leads/route.ts:28` returns 422 and writes nothing beyond the
`screening_audit` row. There is no `tcpa_block` anywhere in the codebase and no rejected-submission
table or column. A search across `lib/` and `app/` returns nothing.

The consequence reaches past LA-1.5. **LA-1.18 (Lead quality by partner) has no source for the
metric that depends on this.** A rejected transfer is invisible to quality reporting, so a partner
sending litigator numbers looks identical on the scorecard to one sending clean traffic. That is the
opposite of what the screening service is for.

This is also where decision #11 lands. Undialable rate is computed from scrub results at import, and
it has the same property as this one: it can only be measured if the rejection is recorded when it
happens. Neither figure can be backfilled later from data that was never written.

Worth noting these decisions are not on the Notion pages yet. LA-1.5 fetched 2026-09-12 still shows
its original six acceptance criteria, so anyone reading the board will not see #9 at all.

**Confirmed against the built screen, 2026-09-13 (LA-1.18 audit).** The prediction above was right,
and the scope is now exact: it is two of the three screening figures, not all of them.

    tcpa_litigator   screenPartnerPhone returns allowed:false  ->  422, no lead  ->  column always 0
    invalid_phone    screenPartnerPhone returns allowed:false  ->  422, no lead  ->  column always 0
    dnc              returns allowed:true with a warning       ->  lead created ->  figure is real
    internal_dq      returns allowed:true with a warning       ->  lead created ->  figure is real

`app/api/partner/leads/route.ts` screens before `createPartnerLead`, and `partner_quality_evidence`
selects from `agent_leads`. So LA-1.18's TCPA and Invalid columns read 0 for every partner in every
period, and their drill-downs are empty.

Two things make this worse than a missing feature. First, a zero is not a blank — the screen actively
reports that this partner sent no litigator numbers, which is the opposite of unknown. Second,
`verify-partner-quality` asserts `row.screening.tcpa === 1` and passes, because its fixture inserts
an `agent_leads` row carrying a `tcpa_litigator` screening result — a shape the application has no
path to create. The check is green, the query is correct, and the column is dead. The fixture has
been kept and annotated rather than removed, so the next reader does not mistake green for fed.

**Fix:** decide where a rejected submission lives — most likely its own table, since it has no lead
to hang off — record outcome, reason, partner, timestamp and the masked number, exclude it from
billing, and expose the count to the partner without the numbers. Then LA-1.18 and LA-1.6's on-blur
screening both have something to build on. Cost of leaving it open: partner quality reporting cannot
be built, and every blocked transfer between now and then is unrecoverable data.

### 173. 🟡 Isolation and evidence checks that pass on an empty result set
**From:** LA-1.5 / payment-provider regression Â· **Belongs to:** verification suites Â· **Gap recorded:** 2026-09-12

`[].every(...)` is `true`. An assertion shaped `rows.every((r) => r.tenant_id === expected)` therefore
reports success when the query returned nothing — and for an isolation check, returning nothing is
exactly what a broken fixture, a dropped connection or a destroyed table looks like. The check is
loudest precisely when it should be silent.

This was not theoretical. `verify-payment-provider` asserted

    (orphanCalls ?? []).every((c) => c.tenant_id === null)

to prove the provider call log outlives the tenant it belonged to. `20260912250000` had wrongly given
`provider_calls.tenant_id` ON DELETE CASCADE, so the rows were being deleted rather than orphaned —
and the check passed, vacuously, for exactly that reason. Corrected by `20260912310000`, and the
assertion now requires a surviving row. No data was lost: the table held zero rows until
`20260912290000` made writing to it possible, and no tenant was deleted in between.

Two fixed in this pass:

- `verify-payment-provider.mjs` — requires at least one surviving row. Verified to fail against the
  CASCADE schema before the fix, so it now catches the defect it was hiding.
- `verify-la0-rls.mjs` — an empty result is a legitimate per-table outcome (a tenant may own no rows
  in a given table), so the guard is at run level: `the isolation check actually saw data` asserts the
  tenant that is supposed to own data was observed to have some. Without it, a connection returning
  nothing scored a clean sweep of LA-0.2's isolation evidence. The carriers assertion is guarded
  directly, since reference data is never legitimately empty.

Still unguarded, each reading from a database or API response that could legitimately come back
empty, and each asserting something whose absence matters:

    verify-partners.mjs:120          list is tenant-scoped
    verify-partners.mjs:130          direct tenant_app reads cannot cross tenants
    verify-partner-products.mjs:187  tenant product RLS does not expose another tenant
    verify-partner-users.mjs:109     partner admin sees only the current partner users
    verify-compliance-vendors.mjs:69 stored credentials are ciphertext, not plaintext
    verify-legal.mjs:172             the IP is captured
    verify-unclaimed-sla.mjs:52      all four rungs fire once (Object.values of a possibly empty map)

The `.every()` calls over locally built arrays — `Promise.all` results, literal lists of expected
audit actions — are not at risk, because their length is known at the call site. The rule that
separates them: if the array came from a read, the assertion needs a floor.

**Fix:** add a length floor to each of the seven above, or a run-level "saw data" guard where an
empty set is legitimate per item. Cost of leaving it open: these are tenant-isolation and
credential-at-rest checks. A green run does not currently distinguish "isolation holds" from "the
query returned nothing", which is the difference between evidence and its absence.

### 174. ✅ SUPERSEDED — the orphan-suite wiring, and its first-run baseline
**Recorded:** 2026-09-12 Â· **Superseded:** 2026-09-13 by the first complete `verify:all` run

The wiring half stands and is permanent: `scripts/verify-all.mjs` reads `scripts/` before running
anything and exits 255 if any `verify-*.mjs` is unreferenced. It has now caught three separate
omissions, the most recent being `verify-subscription-idempotency.mjs` on 2026-09-13.

The failure baseline recorded here — 13 of 15 — is superseded. The first run that reached completion
gives the real figure: **25 of 71 suites failed, 742 checks passing, 28 failing.** Six of those
failures were fixture damage rather than product defects and are fixed (backlog 191); the rest are
itemised under 189, 190, 192, 193 and the entries they name.

One correction worth carrying forward. This entry described the guard as complete, and it was not:
its existence check compared listed files against the `verify-*.mjs` scan, so every `check-*.mjs`
entry looked absent and a hard-coded exemption had been added for one filename. The moment two more
`check-*` suites were listed, `verify:all` refused to start and named two files that were present.
The guard now asks the filesystem. A guard with a per-file exemption list is a guard that has already
been wrong once.

### 175. 🟡 Thirty-two organizations-era SECURITY DEFINER functions are client-executable
**From:** SA-0 security reconciliation Â· **Belongs to:** SA-6 / cross-lineage Â· **Gap recorded:** 2026-09-12

A SECURITY DEFINER function runs with its owner's privileges and bypasses row-level security by
design, so a client role holding EXECUTE on one receives whatever that function does, policies or no
policies. Forty-four such functions were executable by `anon` or `authenticated`.

`20260912360000` revoked the twelve this repository declares or calls, including four named
`admin_*`. Thirty-two remain, none of which this repository declares or calls anywhere:

    book_outbound_appointment, check_org_entitlement, claim_appointment_reminders,
    commit_outbound_import, create_partner_intake, get_next_lead,
    get_outbound_setter_scorecard, has_any_role, log_outbound_disposition,
    outbound_agent_campaign_allowed, outbound_agent_campaign_scope, outbound_can_dial_now,
    outbound_can_dial_prospect, outbound_log_lead_event, outbound_return_prospects_to_pool,
    outbound_set_agent_campaigns, prevent_published_plan_version_mutation, reactivate_nurture,
    record_outbound_campaign_credit, record_outbound_campaign_purchase,
    record_outbound_prospect_source, record_outbound_suppression_usage, record_screening_result,
    release_expired_invitation_seats, release_organization_seat, release_outbound_lead,
    schedule_callback, set_outbound_campaign_status, sync_daily_deal_flow_provenance,
    sync_policy_campaign_provenance, update_daily_deal_flow_entry, update_verification_item

They are the organizations-era outbound, seat and provenance surface. Revoking them blind could
break the other product, which is the line this reconciliation does not cross without knowing who
calls them. Some are trigger functions, which do not need EXECUTE granted to anyone at all.

**Fix:** confirm with whoever owns the CRM which of these its client actually calls, revoke the rest
from `anon` and `authenticated`, and drop EXECUTE entirely from the ones that are only ever fired as
triggers. Cost of leaving it open: thirty-two RLS-bypassing entry points reachable with the
anonymous API key.

**Not a finding, recorded so it is not re-raised.** The Supabase advisor reports 86 policy-less RLS
tables and 39 mutable `search_path` functions. Both over-report: 73 of the 86 hold no client grant at
all and the other 13 were revoked by `20260912360000`, and while 256 functions have a mutable
`search_path`, **zero** SECURITY DEFINER functions do — which is the only case where it is an
escalation vector. The advisor does not model grants, so it cannot see that most of what it lists is
already closed. Reconcile against grants before acting on its counts.

### 176. 🔵 SA-0.4 is a triage list, not a gate — its six items need homes
**From:** SA-0 batch review Â· **Belongs to:** several Â· **Gap recorded:** 2026-09-12

SA-0.4 "M0 foundation hardening & follow-ups" is Status `Backlog`, Priority `Medium`, and contains
no acceptance criteria. Its own text says *"None of these block starting M1"* and *"Triage each item
into whichever future ticket it naturally belongs to rather than treating this as one ticket to
build wholesale."* It should not be treated as an acceptance gate ahead of SA-1, and the RLS/grant
hardening done under its name is not in its scope.

Its six findings and where each belongs:

1. **`requireAdminRole()` never re-reads `admin_users.is_active`.** Deactivating an admin does not
   end their existing session; they keep API access for up to the 12h session TTL. Only
   `getCurrentAdmin()` re-checks. Touches every admin route, so it wants its own session-hardening
   pass rather than a drive-by edit. â†’ own ticket.
2. **CI workflow exists, but a hosted run is not evidenced in this checkout.** SA-0.2 and SA-0.3
   both have acceptance criteria reading "automated test that runs in CI". The repository workflow
   is `.github/workflows/ci.yml`; the local checks prove its commands, but hosted-run evidence still
   requires the repository CI host.
3. **`middleware.ts` was on the deprecated convention.** The active checkout now uses `proxy.ts`
   with the same authentication boundary and matcher behavior; the production-build warning is
   cleared. Retain this as historical context only.
4. **Audit log has no pagination**, hard-capped at 100 rows. Fine today; silently hides history once
   SA-1/2/3 produce real write traffic. â†’ SA-0.3 follow-up.
5. **No failed login/2FA visibility.** Only successful admin logins are audited, so a run of failed
   password or TOTP attempts leaves no trail. â†’ SA-6.2 (rate limiting & brute-force), as the page
   itself suggests.
6. **2FA reset is CLI-only** (`npm run reset:totp`). â†’ SA-1 user management, as an audited
   super-admin action.

**Fix:** file 1, 2 and 3 as their own tickets, attach 4 to SA-0.3, 5 to SA-6.2, 6 to SA-1, and close
SA-0.4 as triaged. Cost of leaving it open: SA-1 is being held behind a gate that does not exist,
while item 2 — the one that really does block acceptance language in SA-0.2 and SA-0.3 — stays
unowned.

### 177. 🟡 The transfer inbox misses its one-second budget two runs in three
**From:** LA-1.10 audit Â· **Belongs to:** LA-1.10 Â· **Gap recorded:** 2026-09-12

LA-1.10's fifth acceptance criterion is "the inbox loads in under a second with 500 unclaimed leads".
Three measurements today, same fixture, same volume, same machine:

    1381ms   38% over
    1111ms   11% over
     <1000ms pass

The suite reports a pass or a fail depending on which run you look at, which makes it useless as a
gate in either direction. This is not jitter around a comfortable margin — the query sits directly on
the budget.

`getTransferInbox` builds the list, then `list_buffer_handoffs` runs separately for owner and
producer roles, and the inbox response also computes partner, product, state and claimed-by facet
options from the same rows. Worth measuring which of those dominates before optimising anything.

Recorded as BLOCKED rather than PASS in docs/qa/LA-1-QA-AUDIT.md: a performance guarantee that holds
one run in three has not been demonstrated.

**Profiled 2026-09-13, and the conclusion is not what the failure looked like.** The query cost is
not the problem. Measured against the live project at 503 queue rows:

    list_transfer_inbox     288ms median
    list_buffer_handoffs    165ms median  -- essentially all of it expire_buffer_handoffs
    trivial round trip      194ms median  -- select one row from tenants

That last number is the finding. A PostgREST round trip from this machine to the remote Supabase
project costs ~194ms before any query runs. The route makes roughly three sequential hops -- session
and role resolution, the entitlement lookup, then the inbox reads -- so the floor is ~580ms of
network latency against a 1000ms budget. Next.js itself contributes 3-4ms, confirmed from its own
route timings.

The suite therefore measures the distance between the developer machine and the database, not the
product. In production, app and database sit in one region and a round trip is single-digit
milliseconds; the same code would finish in well under a tenth of the budget.

One real improvement was made rather than only diagnosed: `getTransferInbox` ran
`list_transfer_inbox` and `list_buffer_handoffs` sequentially. They are independent, and the inbox
was already read before the handoff call ran its expiry sweep, so overlapping them weakens no
ordering guarantee. That removed one ~165ms hop and tightened five consecutive runs from
1381/1111ms to 1003-1155ms.

**Fix:** judge this criterion where the answer means something -- a deployed environment, or a
server-side timing assertion that excludes the client round trip. Do not optimise the query against
this measurement; it would be tuning the wrong number. Also worth asking whether
`expire_buffer_handoffs` belongs on every inbox read at all, since it is a write on a read path.

**Original fix note:** profile the inbox read at 500 rows, decide whether the facets belong in the same request,
and re-measure five consecutive runs. Cost of leaving it open: LA-1.10 cannot be called complete, and
the check will keep flipping in `verify:all`.

### 178. 🟡 Buffer handoff offers are created but never listed
**From:** LA-1.10/1.11 work Â· **Belongs to:** LA-1.14 Â· **Gap recorded:** 2026-09-12

`verify-buffer-handoff` fails six checks. The offers themselves are written — `POST
/api/app/inbound/handoff` answers 200 and `buffer_handoffs` holds rows — but the receiving agent's
inbox shows `handoffs: []`, so nothing can be accepted, progress cannot be seen before accepting, and
the timeout return has nothing to return.

Not caused by the `tenant_verification_sessions` rename, checked rather than assumed:
`list_buffer_handoffs`, which produces that list, references **neither** session table.
`offer_buffer_handoff` and `accept_buffer_handoff` were repointed by `20260912400000` and both answer
200. So the reading side is where to look, not the writing side.

Two of the six are a different cause again: "buffer claim posts exactly one idempotent partner card"
and "repeated claim does not post a second partner card" both fail because the fixture tenant has no
`partner_channels` row, so `channelFor()` throws "Partner channel is not available". That is the same
missing row that makes LA-1.10's "partner chat failure does not roll back a successful claim" pass —
one suite's fixture gap is another's deliberate failure injection.

**RESOLVED 2026-09-12.** The cause was not a filter. `list_buffer_handoffs` had been replaced by an
unconditional empty-set stub in `20260911100000_live_runtime_compatibility` and never restored;
`20260912460000` restores it. The two partner-card failures were LA-1.16 triggers missing entirely, fixed
by `20260912470000`. verify-buffer-handoff now passes in full.

**Original fix note:** work LA-1.14 as its own task. Start with `list_buffer_handoffs` and its filter against a
handoff that demonstrably exists, then decide whether the buffer fixture should create a partner
channel or the card path should tolerate its absence. Cost of leaving it open: the buffer-to-licensed
handoff is unverified end to end, and LA-1.14 has never had criterion-level evidence.

### 179. ✅ RESOLVED — lead_notes pointed at the CRM's leads table
**From:** LA-1.14/1.16 work Â· **Belongs to:** LA-1.21 Â· **Recorded:** 2026-09-12 Â· **Resolved:** 2026-09-13

`lead_notes.lead_id` was `REFERENCES leads(id)` — the organizations-era CRM's lead table, not
`public.agent_leads`. Every note this application tried to write raised 23503 on
`lead_notes_lead_id_fkey`, and `verify-lead-notes` failed 7 of its 12 checks on that one constraint.
No lead this application had ever created could carry a note.

This entry asked for ownership to be established before choosing between repointing the key and
renaming the table. It was: `lead_notes` held 2 rows, both with `organization_id` set and `tenant_id`
null, and it carried both lineages' columns. The CRM's table, with ours grafted on.

So the remedy was the rename, not the repoint — `20260913160000` creates `public.tenant_lead_notes`
with `lead_id` referencing `agent_leads`, moves `lead_note_edits` and `lead_note_mentions` onto it,
and leaves the CRM's table and its 2 rows untouched. Repointing the existing key would have changed a
constraint on a table this repository does not own. `verify-lead-notes` now passes 13 of 13.

See backlog 182, entry 7, for the inventory.
### 180. ✅ RESOLVED — every table declaring tenant_app access now has it
**Recorded:** 2026-09-13 Â· **Resolved:** 2026-09-13

29 of 78 tables declared `tenant_app` access the database did not grant. A table needs both a GRANT
and a policy covering `tenant_app`; a policy without a grant fails loudly with 42501, a grant without
a policy returns zero rows silently, and the second is the one that had been happening.

Closed by `20260913100000` (15 tables), `20260913110000` (4 tenant-template tables) and
`20260912490000`. `scripts/check-tenant-app-access.mjs` is wired into `verify:all` and reports, as of
2026-09-13:

    tables this repo declares tenant_app access for : 81
    of those, correct in the live database          : 81
    superseded by a rename, checked at the new name : 7
    INCOMPLETE                                      : 0

Two bugs in the survey itself were fixed before any migration was generated from it, which is why the
first number it produced (29) differed from the real one (19): it did not count `TO PUBLIC` policies,
whose `polroles` is `{0}` and which cover every role, and it looked for renamed tables at their old
names.

### 181. 🟡 Two tenant-plane tables still reference the CRM lead table (was five)
**From:** tenant_app access work Â· **Belongs to:** LA-1.21, LA-1.22, LA-1.23, LA-1.5 Â· **Gap recorded:** 2026-09-13

`public.leads` is the organizations-era CRM table; this application writes `public.agent_leads`.
Five tenant-plane tables carry a `lead_id` foreign key pointing at the wrong one, and all three of
the NOT NULL ones are declared in this repository as
`references public.agent_leads(id) on delete cascade`:

    callbacks          NOT NULL, 0 rows     blocked every write     LA-1.22   FIXED 20260913120000
    lead_sla_events    NOT NULL, 0 rows     blocked every write     LA-1.23   FIXED 20260913120000
    lead_notes         NOT NULL, 2 rows     blocked every write     LA-1.21   FIXED 20260913160000
    screening_audit    nullable, 0 non-null latent                  LA-1.5    open
    screening_results  nullable, 0 non-null latent                  LA-1.5    open

`lead_notes` needed a decision rather than a migration, and it got one. Its two rows reference real
`public.leads` rows, so repointing would have failed validation against them — and those rows belong
to the other product, which settles it: the constraint was never ours to change. LA-1.21 renamed to
`tenant_lead_notes` the way SA-3 renamed invoices (`20260913160000`), leaving the CRM's table and its
two rows exactly as they were.

The two screening columns are nullable and this application has never written them, so the
constraint has never fired. They are wrong rather than broken — worth correcting before something
starts populating them.

**Fix:** repoint the two screening columns when LA-1.5 is next touched — they are the only two left.
Cost of leaving them open: both will fail the first time anything writes them, and because they are
nullable and currently unwritten, the failure arrives with whatever feature starts populating them
rather than with the change that made them wrong.

### 182. ✅ The shared-table collision inventory — eight found, eight resolved
**From:** LA-1 module work Â· **Belongs to:** several Â· **Gap recorded:** 2026-09-13 Â· **Updated:** 2026-09-13

One root cause has produced most of this module's defects: this repository and the organizations-era
CRM share one Postgres schema, and where both declare a table of the same name, the CRM's wins —
because every declaration here is `create table if not exists`, which silently no-ops and leaves the
mismatch invisible until something writes.

SA-3 set the remedy in commit `e7c00ee`: **this application's table moves, the CRM's does not.**
Nothing outside this repository changes. Eight instances found so far:

| # | Table | Collision | State |
|---|---|---|---|
| 1 | `invoices`, `invoice_lines` | CRM's billing tables | **Resolved** — renamed `platform_invoices` (SA-3) |
| 2 | `pipelines`, `pipeline_stages` | `id bigint` vs uuid | **Resolved** — `tenant_pipelines` (`20260912270000`) |
| 3 | `verification_sessions` | `submission_id` NOT NULL â†’ `leads` | **Resolved** — `tenant_verification_sessions` (`20260912400000`) |
| 4 | `disposition_flows` | `id bigint`, `organization_id` | **Resolved** — `tenant_disposition_flows` (`20260912430000`) |
| 5 | `provider_calls` | provider CHECK excluded `whop` | **Resolved** — constraint dropped (`20260912290000`) |
| 6 | `callbacks` | CRM trigger `callbacks_audit_write` writes `audit_logs`, whose `organization_id` is NOT NULL | **Resolved** — `tenant_callbacks` (`20260913160000`) |
| 7 | `lead_notes` | `lead_id` REFERENCES the CRM's `leads`, so no note could ever be written | **Resolved** — `tenant_lead_notes` (`20260913160000`) |
| 8 | `lead_sla_events` | `rung integer` 1â€“4 here vs `rung text` declared; live also has an `action` column carrying the text vocabulary | **Resolved** — `tenant_lead_sla_events` (`20260913170000`) |

`lead_notes` is listed in its own right now rather than as a footnote to backlog 181. It is the same
collision as the rest; it was simply reached through its foreign key instead of its own columns.

**What the sixth and seventh looked like once opened.** Both tables carried *two lineages of columns
at once* — the CRM's originals plus this application's, grafted on by later `add column if not
exists` migrations that believed they were amending their own table:

    lead_notes   organization_id, created_by, deleted_by            the CRM's
                 tenant_id, author_user_id, visibility, edited_at,  ours, added on top
                 idempotency_key
    callbacks    organization_id                                    the CRM's
                 tenant_id, work_item_id, idempotency_key           ours, added on top

Ownership was checked rather than assumed, which is what backlog 179 asked for. `lead_notes` held 2
rows, both with `organization_id` set and `tenant_id` null — the CRM's. `callbacks` held 0 rows. So
there was no data of ours to migrate on either side and nothing of theirs to disturb: the new tables
start empty and correctly shaped rather than inheriting a merged one.

Worth noting what `lib/supabase/database.types.ts` said throughout. Its `lead_notes` and `callbacks`
entries describe **this repository's intended shape** — no `organization_id`, `lead_id` typed as
ours — because they were written from the migration rather than generated from the database. The
types have been describing a table that never existed in that form. Renaming those two entries was
the whole of the type change, and `tsc` then failed loudly on every call site, which is how a typed
client is supposed to behave. (Regenerating instead was considered and rejected: the generated file
is 974KB against the curated 159KB, because it pulls in the CRM's entire surface.)

**The last one, and why it was different.** `lead_sla_events` did not disagree with the CRM about a
type or a foreign key — it disagreed about **which column carries the meaning**. The CRM splits the
ladder into `rung integer` (1â€“4) plus `action text` (`notify`, `warn`, `escalate`, `partner_notify`,
`expire`); this repository puts the name in `rung` and has no `action` column at all. So the
application wrote `'warn'` into an integer and got `22P02`, and even with `rung` typed as text the
CRM's NOT NULL `action` — which nothing here sets — would have refused the insert anyway. There was no
shape both products could share, which is what made the rename the only answer rather than the
preferred one. Resolved by `20260913170000`; the live table had 0 rows, so nothing moved.

A second defect was riding along and would have survived the rename untouched: `run_unclaimed_sla` is
declared twice, and the corrective sorts **earlier** than the file it corrects — see backlog 187 for
the same pattern on `lead_queue_status_check`. The new runner takes the body that actually applies and
the conflict target that was right, which is a combination neither file had.

**A ninth, of a different kind.** `reopen_expired_lead` is a *function* collision rather than a table
one: this repository declares `(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid)` and the database
had only the CRM's `(target_lead_id uuid)`. Ours was simply absent. It is quieter than any of the
table collisions, because a missing overload does not raise `42P01` — the name resolves to the CRM's
function and PostgREST reports "Could not find the function ... in the schema cache", which reads like
a stale cache rather than an absent function. Created as an overload by `20260913190000`; the CRM's
stays. Worth asking whether other declared functions are missing the same way, the way
`check-declared-triggers` asks it of triggers.

**Worth stating once.** All eight were invisible for the same reason, and it is not the collision
itself — it is that `create table if not exists` reports success when it does nothing. A declaration
that silently loses to an existing object is indistinguishable from one that applied. Any future
table this repository adds to this schema has the same exposure until the two products are separated
or the declarations are made to assert their own shape.

### 183. 🔴 26 of 63 declared triggers do not exist in the database
**From:** LA-1.17 criterion 3 Â· **Belongs to:** several Â· **Gap recorded:** 2026-09-13

A trigger function surviving a migration while its trigger does not is the quietest defect this
project produces. The function is present, so nothing reports it missing. The code reads as wired and
runs for nothing — no error, no failed request, no log line.

It has now happened four times, each found by chasing an unrelated symptom:

    tenants_seed_pipelines    new tenants got no pipelines, so no lead could be claimed (LA-1.4)
    LA-1.16's five            no partner ever had a chat channel; messages never broadcast or audited
    two broadcast triggers    the partner board and agent notifications never updated live
    lead_queue_floor_broadcast  the Agent Floor never updated when a lead arrived or was claimed

`scripts/check-declared-triggers.mjs` (new, `npm run check:triggers`, wired into `verify:all`) parses
every `create trigger` in the migrations and compares against `pg_trigger`. **63 declared, 37
present, 26 missing.**

**Six are functional and are restored by `20260913130000`:**

    lead_queue_partner_pipeline_broadcast   LA-1.17  the partner board never updates live
    agent_notifications_broadcast           LA-1.21  a mention never reaches the teammate live
    lead_queue_floor_broadcast              LA-1.15  the floor never sees a lead arrive or be claimed
    lead_queue_sync_owner_columns           LA-1.10  denormalised owner columns drift after a claim
    deal_flow_set_worked_by                 LA-1.13  who worked a deal-flow row is never stamped
    callbacks_assignee_role                 LA-1.22  a GUARD — it refuses a callback assigned to a
                                                     role that may not take one. Fails OPEN, unlike
                                                     the rest, which merely fail to happen.

`verify-agent-floor` has been reporting the third of these correctly all along: "database change
reaches every open floor in under one second" fails with the detail `no event`, because the suite
updates `lead_queue` and waits five seconds for a broadcast nothing sends. Backlog 166 recorded
LA-1.15 realtime as passing on 2026-09-07, so it either regressed or was never true.

**The remaining twenty are `*_touch_updated_at`** on `agent_leads`, `appointments`, `contacts`,
`deal_flow`, `households`, `lead_queue`, `licenses`, `partners`, `products`, `templates`,
`tenant_templates` and others. Lower severity and not zero: `updated_at` on those tables reflects
insert time forever, so anything ordering or filtering by it is reading a column that stopped moving.
Three of the twenty are declared on `pipelines`, `pipeline_stages` and `disposition_flows`, which are
now the CRM's tables — those declarations are superseded by the renames rather than missing, and
`tenant_pipeline_stages` and `tenant_disposition_flows` already carry theirs (`tenant_pipelines` does
not).

**Fix:** restore the `touch_updated_at` triggers where the function exists, per owning task; decide
whether `tenant_pipelines` wants one; and treat the three superseded declarations the way the
tenant_app survey treats renames. Cost of leaving it open: `updated_at` is unreliable across a dozen
tables, and the next missing trigger will be found the same way as the last four — by accident.

### 184. ✅ WITHDRAWN — the "Realtime never joins" finding was an artifact of the check itself
**From:** LA-1.17 criterion 3 Â· **Belongs to:** verification suites Â· **Recorded:** 2026-09-13 Â· **Withdrawn:** 2026-09-13

This entry previously said that a Supabase Realtime channel opened after a suite has done a lot of
HTTP work reports `subscribeStatus: "CLOSED"` with a null error and never joins, and it recommended
placing Realtime assertions early. **That diagnosis was wrong, and the recommendation was useless.**
It is left here rather than deleted because the way it was wrong is the point.

The check recorded the subscriber's state like this:

    channel.subscribe((status, err) => { subscribeStatus = status; ... })

`subscribe()` keeps calling back for the channel's whole life, and `removeChannel()` delivers a final
`CLOSED`. The verdict was read **after** teardown. So `subscribeStatus` read `CLOSED` on every run,
healthy or not — the variable was overwritten on the way out. Every observation the original entry
was built on was this artifact.

It survived four rounds of elimination because each one produced a plausible story. Moving the check
earlier "fixed" it; retrying three times "confirmed" the connection was refused; a standalone probe
subscribing instantly "proved" the process was at fault. What actually settled it was cheap and
should have come first: subscribe to a **different** channel at the same point in the same process.

    DIAG plain generic name:                  SUBSCRIBED
    DIAG generic name + broadcast handler:    SUBSCRIBED
    DIAG partner-pipeline: prefix, random id: SUBSCRIBED
    DIAG partner-pipeline: this partner id:   SUBSCRIBED     <- the exact topic that "could not connect"

Four subscribers on the same credentials, same process, same moment, including the identical topic —
all fine, with the real check reporting CLOSED microseconds later. No theory about sockets survives
that.

**The fix, in `verify-partner-lead-pipeline.mjs`:** latch the success (`everSubscribed = true` when
status is `SUBSCRIBED`) instead of tracking the latest status, and judge before tearing the channel
down. The check now passes run alone and run fourth in a sweep, which the original never did.

**What is worth keeping from this.** A diagnostic field that is itself unreliable is worse than no
diagnostic field, and it is worse in a specific way: it does not merely fail to help, it manufactures
a coherent false explanation and gets believed. This one produced a backlog entry, a retry loop, a
restructured suite and most of a session's debugging, all downstream of a variable being assigned at
the wrong time. The instinct that eventually worked — change one property and compare against a
control, rather than changing the code and re-running — is the one to reach for first when a
measurement disagrees with a direct probe.

The one durable lesson stands on its own: `subscribeStatus !== "SUBSCRIBED"` and "no event" must
report differently, because a harness that cannot connect and a product that does not broadcast are
not the same finding. That distinction is what finally made the real state visible — once the field
was trustworthy, it immediately read `SUBSCRIBED` and the question became a real one.

### 185. 🟡 The lead workspace timeline never reads the note edit history that LA-1.21 records
**From:** LA-1.20 criterion 2 Â· **Belongs to:** LA-1.20 Â· **Gap recorded:** 2026-09-13

LA-1.20's second acceptance criterion is "the timeline shows every state change with actor and time,
and cannot be edited". Three of the timeline's four sources now satisfy the second half at the grant
level -- `audit_log` was already INSERT/SELECT only, and `20260913150000` revoked UPDATE and TRUNCATE
on `verification_field_changes` and `callback_history`. This item is about the first half.

`lead_note_edits` (created by `20260902170000`) records every note revision properly:

    note_id, lead_id, actor_user_id, created_at,
    action ('edited' | 'visibility_changed' | 'deleted'),
    old_body, old_visibility, new_body, new_visibility

Actor, time, before and after, for all three kinds of change. LA-1.21 writes it faithfully --
`lib/leadNotes/service.ts` references it three times, and `verify-lead-notes` asserts an edit lands
there. **The history is complete and correct.**

`lib/leadWorkspace/service.ts` never queries it. Zero references. The timeline instead emits one
event per note:

    addEvent(`note:${note.id}`, note.deletedAt ?? note.editedAt ?? note.createdAt, ...)

so a note contributes a single entry whose timestamp and body both move when it is edited. The
original is replaced by the revision rather than joined by it. A reader sees a note that appears to
have always said what it says now, written at a time that is not when it was written -- while the row
that says otherwise sits one table away, unread.

This is a better problem than it first looked. An earlier draft of this entry claimed the prior body
was not retained anywhere; that was wrong, and checking the schema rather than inferring from the
`update()` call is what corrected it. The fix is a read, not a schema change.

**Fix:** query `lead_note_edits` alongside the other four sources and emit one immutable timeline
entry per revision (`old_body â†’ new_body`, actor, `created_at`), leaving the note's own entry at its
creation time. Consider revoking UPDATE and TRUNCATE on `lead_note_edits` from `service_role` at the
same time, as `20260913150000` did for the other two append-only logs -- nothing writes it after
insert.

**Why this is not fixed here.** The change is small, but it cannot be verified end to end today:
every note-creating path fails on `lead_notes_lead_id_fkey`, because `lead_notes.lead_id` references
the CRM's `leads` table rather than `agent_leads` (backlog 179/181). `verify-lead-notes` currently
fails 7 of its checks for exactly this reason, all of them with that constraint name. Shipping the
timeline read without being able to exercise it would mean asserting behaviour no test can reach, so
it waits on the FK repoint. Cost of leaving it open: the page that exists to answer "what happened
with my application" silently presents edited notes as originals.

### 186. 🟡 The SLA scheduler works the oldest rows in the whole table, so one tenant's backlog starves everyone
**From:** LA-1.23 criterion 1 Â· **Belongs to:** LA-1.23 Â· **Gap recorded:** 2026-09-13

`run_unclaimed_sla` selects its work like this:

    select q.* from public.lead_queue q
    ... where q.status = 'unclaimed'
    order by q.queued_at asc
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
    for update of q skip locked

No tenant filter, no per-tenant fairness — one global queue, oldest first, capped at 500 by default
and 1,000 by ceiling. Every tenant's SLA ladder is therefore advanced out of the same budget, in age
order.

Found by the symptom rather than by reading: LA-1.23's first acceptance criterion is "each rung fires
exactly once per lead, proven by running the job twice", and the fixture's four rungs all came back
**zero**. That reads exactly like a broken ladder. The cause was that 1,502 unclaimed rows sat ahead
of the fixture and the run was capped at 100, so the scheduler never reached it.

The consequence in production is the same shape and worse. A tenant with a few thousand unclaimed
rows consumes the entire run budget, and a second tenant's freshly-arrived transfer — the live
customer this ladder exists for — waits for as many runs as it takes to clear the first tenant's
backlog. The SLA clock keeps running; the scheduler simply is not looking. Nothing reports this: the
job succeeds, reports the work it did, and the starved rows are indistinguishable from rows whose
thresholds have not elapsed.

The task itself anticipated the ingredient without connecting it to the scheduler. Its "why expiry
exists at all" section cites **496 stranded active rows, the oldest queued in May**, pushing the
current day's rows off the end of a query limited to 300. That is this bug, described from the
queue-widget side, a year earlier.

`verify-unclaimed-sla` now dates its fixture to 2020 so it sorts first and the ladder is
deterministic. That is a legitimate fixture — the task is about a lead that *sat* unclaimed — but it
works around the starvation rather than testing it, and the comment there says so.

**Fix:** make the run fair across tenants — a per-tenant cap within the global limit, or round-robin
by `tenant_id` — and have the job report how many rows it could not reach, so exhaustion is visible
rather than silent. Cost of leaving it open: SLA latency for every tenant is set by the largest
backlog in the shared table, and the failure mode is a quiet one.

### 187. 🔴 Five migrations rebuild lead_queue_status_check from scratch, and the last one wins
**From:** LA-1.23 Â· **Belongs to:** LA-1.12, LA-1.14, LA-1.23 Â· **Gap recorded:** 2026-09-13

`lead_queue.status` has been declared five times. Every declaration drops the constraint and recreates
it with a full vocabulary rather than amending it, so the file that sorts last silently decides which
statuses the product supports:

    20260903000000  LA-1.23  9 values, including 'expired'
    20260903100000  LA-1.12  5 values
    20260903120000  LA-1.14  8 values, no 'expired'
    20260903170000  LA-1.23  9 values  <- a corrective, written for exactly this reason
    20260912430000  LA-1.12  8 values, no 'expired'   <- applied last

`20260903170000` exists only to defend against this, and says so in its first line: "later LA-1
migrations rebuild lead_queue_status_check, so preserve the new terminal status". Someone had already
seen the pattern, written the corrective, and explained it.

`20260912430000` is mine, from porting LA-1.12 onto the renamed disposition tables earlier the same
day. I carried that task's constraint forward verbatim without checking what had been added to it
since, which dropped `'expired'` and disarmed the expiry half of LA-1.23. `run_unclaimed_sla` sets
`status = 'expired'`, so the rung failed with 23514 and `verify-unclaimed-sla` threw during setup —
criteria 3 and 4 were unreachable because no row could enter the state they describe.

Restored by `20260913180000` to the union of all five, which is `20260903170000`'s list unchanged.

**This is the fourth instance of one mistake and the second time I have made it** — the first being
LA-1.18's `partner_quality_report`, where a later migration replayed a pre-fix function definition
and dropped two keys. The rule adopted in `20260912440000` — grep `supabase/migrations` for the object
and read every hit in order — is exactly the rule that catches it, and I applied it to the tables I
was renaming and not to a CHECK constraint I was copying along the way.

**Fix:** a constraint that several tasks extend should not be re-declared by each of them. Either
build the vocabulary from one place both tasks reference, or add a check to `verify:all` that asserts
the live `lead_queue_status_check` admits every status any migration has ever declared — the same
shape as `check-declared-triggers`, which found 26 missing triggers by comparing declarations against
the database. Cost of leaving it open: the next task to touch this constraint removes a status some
other task depends on, and the loss surfaces as a runtime 23514 in a scheduled job rather than at
migration time.

### 188. 🟡 agent_notification_settings has no generated type, so its service casts the client to `any`
**From:** LA-1.25 Â· **Belongs to:** LA-1.25 Â· **Gap recorded:** 2026-09-13

`lib/agentAlerts/service.ts` opens with:

    // The generated database types are refreshed from the live project separately; this service keeps
    // the JSON preference boundary narrow while the migration is being promoted.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function db() { return getSupabaseServiceClient() as any; }

Every query in the file — settings read, settings upsert, alert list, both notify helpers — goes
through that cast, because `agent_notification_settings` has no entry in
`lib/supabase/database.types.ts`. The comment says the types are refreshed separately, which has not
happened.

This is the same hole that produced LA-1.18's defect, where `partner_quality_report` came back through
`rpc()` as `Json`, was asserted into `PartnerQualityRow`, and quietly stopped carrying two keys the UI
rendered — for ten days, invisibly, because nothing type-checked the boundary. By contrast, the
LA-1.21/1.22 table renames were caught immediately and completely: renaming two entries in
`database.types.ts` made `tsc` fail on every call site. A typed client is the cheapest defect detector
in this repository, and this file has opted out of it.

`enabled_events` is the part that matters. It is a JSON column holding one boolean per alert event,
and `settingsFromRow` already re-validates it key by key against `AGENT_ALERT_EVENTS` — sensible
defensive code that exists precisely because the type is absent.

**Fix:** add `agent_notification_settings` to the curated `database.types.ts` — by hand, as the
LA-1.21/1.22 rename did, since regenerating pulls in the CRM's entire surface (974KB against the
curated 159KB) — then remove the cast and the eslint suppression. Cost of leaving it open: the one
file governing which alerts an agent receives is unchecked at the boundary, and a column rename or a
dropped key there fails silently at runtime rather than loudly at build time.

### 189. ✅ RESOLVED — SA-3 renamed two tables and repointed almost nothing
**From:** verify:all Â· **Belongs to:** SA-3 Â· **Resolved:** 2026-09-13

Far larger than first recorded, and the first record understated it in a specific way: this was
written up as "the invoice builder writing the CRM's table", as though one function had been
missed. `20260911143000_sa_3_platform_invoices.sql` moved this application's `invoices` and
`invoice_lines` out of the way of the organizations-era CRM's tables of the same name. The tables
moved. Almost nothing that referenced them did.

**Four foreign keys** still pointed `invoice_id` at the CRM's `invoices`: `payments`,
`credit_notes`, `pending_charges`, `period_billing_runs`. So even a correct function could not have
recorded its result.

**Six functions of ours** still read and wrote `public.invoices` / `public.invoice_lines`:
`create_custom_invoice`, `create_invoice_for_payment`, `bill_subscription_period`,
`admin_settle_invoice_manually`, `mark_overdue_invoices`, `enforce_billing_tenant_relationships`.
Ownership was established per object before touching anything — seven other functions naming those
tables are the CRM's and were left alone, as were `invoice_reconciliations` and, despite its name,
`platform_credit_notes`, which carries `organization_id`. That last one is also why our credit
notes are still called `credit_notes`: the name they would have moved to was already taken.

**One guard had been silently disabled.** `enforce_billing_tenant_relationships` branches on
`tg_table_name = 'invoices'`, a name no table of ours answers to any more, and no trigger was ever
attached to `platform_invoices`. The invoice half of that guard had therefore never run at all. It
now runs, which is the first time an invoice's subscription is actually checked to belong to the
invoice's tenant.

**Then two more defects behind it**, each found by running rather than by reading:

*Nothing could add a line to an invoice.* The same SA-3 migration added
`platform_invoice_lines_immutable`, which fires on INSERT as well as UPDATE and DELETE. Both
creating functions insert the header in a final state — `issued`, or `paid` — and then the lines,
so the first line of every invoice hit `invoice_immutable`. The trigger is right and is untouched;
what was wrong is that the functions skipped `draft`, the state that means "still being assembled".
Both now insert as a draft, add the lines, and move to the final state in the same transaction.

*Two sign conventions for one column.* `platform_invoice_lines_amount_sign` requires a discount or
credit line to be negative; `lib/billing/lines.ts` says "a credit line carries a POSITIVE amount,
matching create_custom_invoice". The constraint wins, and not merely for being newer: with reducing
lines stored negative the lines sum to the invoice total, and an invoice whose lines do not add up
to what it asks for is the kind of document a customer disputes and we cannot defend. Normalised at
the boundary, so callers still pass positive amounts and no total moved. `verify:period-billing`
now asserts the sum.

**Result:** all six suites green — `verify:invoices`, `verify:custom`, `verify:credits`,
`verify:settlement`, `verify:coupons`, `verify:period-billing`.

**Migrations:** `20260913202000_sa_3_repoint_invoice_family.sql`,
`20260913210000_sa_3_invoice_lines_assemble_as_draft.sql`,
`20260913220000_sa_3_invoice_line_sign_convention.sql`. These sit alongside
`20260913200000_sa_3_align_billing_rpcs_with_platform_invoices.sql`, which another session wrote
concurrently and which repoints three of the same functions; the two agree, and the repoint
migration was renamed from a colliding `20260913200000` prefix so the order is unambiguous.

**Worth keeping from this one.** Three of the five defects — the FKs, the immutability trigger, the
sign constraint — were introduced by the migration that was supposed to complete the rename, and
each was invisible until something ran. A rename is not finished when the tables have moved; it is
finished when everything that named them has been found. The grep that finds them is
`pg_get_functiondef(p.oid) ~ '(public\\.)?invoices\\M'` together with `pg_constraint` on
`confrelid`, and both are now assertions in the repoint migration rather than a thing to remember.

### 190. 🔴 Nothing reliably records which migrations have been applied, and two are provably missing
**From:** verify:all Â· **Belongs to:** platform Â· **Gap recorded:** 2026-09-13

Two functions this repository declares are absent from the database, found on the same day by
unrelated symptoms:

    reopen_expired_lead(p_tenant_id, p_work_item_id, p_actor)   declared 20260903000000
      Absent. Only the CRM's reopen_expired_lead(target_lead_id) existed, so PostgREST answered
      "Could not find the function ... in the schema cache" and LA-1.23 could not reopen a lead.
      Created by 20260913190000.

    find_contact_duplicates(...)                                restored 20260911140000
      Present, but as the pre-fix definition. `prosrc like '%contact_phones%'` is FALSE against the
      live function, so it scores a phone match only on contacts.primary_phone and never looks at a
      contact's secondary numbers. verify-contacts fails "misspelled surname and second phone are
      detected". Still open.

The second is the more alarming of the two, because someone already fixed it twice. The function is
declared in four migrations: the original, `20260901101500_..._secondary_phone_dedupe_fix`, the LA-0
compatibility bridge that replayed the pre-fix body over it, and
`20260911140000_..._restore_secondary_phone_dedupe`, whose own comment explains the regression and why
it matters — LA-0.6's argument is that phone-only matching catches roughly half of duplicates.
Nothing later redeclares it. **The restore is correct, sorts last, and is not in the database.**

**The bookkeeping, stated carefully.** `supabase_migrations.schema_migrations` holds 211 rows;
`supabase/migrations/` holds 234 files. That gap is NOT 23 unapplied migrations, and should not be
reported as one: applying a file with `supabase db query --linked --file` — the method used
throughout this session — executes the SQL without recording anything, so some of the difference is
migrations that did apply and were never registered. The number is unusable as a measure. What is
usable is the direct evidence above: two functions whose declared behaviour is demonstrably not what
the database does.

**Why this outranks any individual defect it causes.** Every audit row in `docs/qa/` rests on the
assumption that the repository describes the database. It does not, and the difference is invisible
until a suite happens to exercise the exact path. `check-declared-triggers` found 26 missing triggers
by comparing declarations against `pg_trigger`; `check-tenant-app-access` found 29 tables whose
declared grants the database did not have. Both were written for one object class each, both found
real defects immediately, and neither covers functions.

**Fix:** extend the same technique to functions — parse `create ... function` out of the migrations
and compare name, signature and a body fingerprint against `pg_proc`, reporting any that are absent or
whose body differs from the last declaration. Then decide how migrations get applied: either through
`supabase migration up` so `schema_migrations` means something, or with a reconciliation pass that
makes the table honest. Cost of leaving it open: "declared in the repository" continues to mean
nothing in particular, and the next defect of this shape is found the way these two were — by
accident, weeks later.

### 191. ✅ RESOLVED — six suites built users in a way SA-1.2 made impossible
**From:** verify:all, 2026-09-13 Â· **Belongs to:** SA-1, verification suites Â· **Resolved:** 2026-09-13

`fbd319d` (SA-1.2/1.3) made `public.users.id` a foreign key to `auth.users` with no default. Confirmed
at the column rather than assumed: `column_default: null`, `is_nullable: NO`,
`users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)`. Any fixture inserting straight into
`public.users` therefore fails, and `scripts/lib/fixtureUser.mjs` exists to do it Auth-first.

Six suites were migrated to `createFixtureUser` / `deleteFixtureUser`:

    verify-dial-preflight        verify-checkout       verify-period-billing
    verify-user-token-redemption verify-trials         verify-system-maintenance

Two of them reached the legacy RPC rather than inserting directly — see 193.

**The first draft of this entry claimed ten suites and one cause. That was wrong**, and the way it was
wrong is the useful part. The evidence was a grep showing ten failing suites did not import
`createFixtureUser` — which proves only that they do not use the helper, not that they insert users.
Four of the ten (`verify-invoices`, `verify-custom-invoices`, `verify-credit-notes`,
`verify-manual-settlement`) never touch `users` at all; they fail on the invoice builder, backlog 189.
A grep for an absent import is not evidence of a present defect.

**Why the four looked like this one.** They report

    TypeError: Cannot read properties of null (reading '0')

because they destructure `const { data } = await ...` and discard the error, so the real message never
reaches the log. That is why `organization_id` appears exactly once in a 1,330-line run despite five
suites failing on it. The same discarded-error defect is what SA-3's own migration described in
`lib/invoices/queries.ts`, and it is why the billing cluster was misread as a fixture problem.

**Result.** Each of the six previously died in its fixture, reporting nothing about its criteria:

    verify-user-tokens      crash  ->  11/11 pass
    verify-trials           crash  ->  all pass
    verify-dial-preflight   crash  ->  runs; 1 real failure (a live tenant already has a DNC vendor enabled)
    verify-checkout         crash  ->  runs; 6 real failures, incl. a webhook answering 500
    verify-system           crash  ->  runs; 5 real failures, all announcements
    verify-period-billing   crash  ->  runs; reaches billing and hits backlog 189

Four of the six are still red, and that is the point: they are red about their own subject matter now
instead of silent about it. Those failures are new information, not new defects.

### 193. ✅ RESOLVED — admin tenant creation works, on the path that already worked for users
**From:** backlog 191 Â· **Belongs to:** SA-0, SA-4 Â· **Resolved:** 2026-09-13

`public.create_tenant_with_owner` does this:

    insert into users (email, password_hash, name) values (...) returning id into v_user_id;

No `id`. Since SA-1.2 removed the default and added `users_id_fkey â†’ auth.users(id)`, the statement
cannot succeed. `app/api/admin/tenants/route.ts` called it and answered `409 Could not create
tenant` to every failure, so **an administrator could not create a tenant at all**, and the message
gave no indication why. It had presumably been failing since `fbd319d`.

**Fixed without a new RPC.** `admin_attach_user_to_tenant` — the function `POST /api/admin/users`
has been using successfully all along — already creates the tenant when given `p_new_tenant_name`,
with the seat check, the membership and the invitation in one transaction. Create Tenant simply was
not using it. Writing a second Auth-aware provisioning function would have been the obvious move
and the wrong one: two functions that provision an owner eventually disagree about seats, roles or
invitations, and only one of them is the one anybody tested.

The route now creates the Auth identity first, calls that RPC, and compensates by deleting the Auth
user if the attach fails — the same shape, and the same comment, as the users route.

**Two deliberate changes come with it:**

    the owner is invited      no password is typed by an administrator. See backlog 1, which this
                              closes as a side effect.

    the tenant starts active  create_tenant_with_owner opened it `provisioning`, a status nothing
                              subsequently cleared. admin_attach_user_to_tenant opens it `active`
                              with onboarding_state `pending`, which is what the rest of the
                              platform reads.

The generic error is also gone. The old route flattened every failure — including the one that made
creation impossible — into one message, and that silence is why this went unnoticed for so long.

**Verified live**, not inferred:

    HTTP 201
    invite.delivered           true
    tenant_status              active
    onboarding                 pending
    has_auth_identity          true
    no_password_in_our_table   true
    membership_role            owner
    open_invitations           1

The invitation link then loads a set-password page that greets the owner by name and email.

**Worth keeping.** `verify-kill-switches` had diagnosed this exactly, in a comment beside a local
workaround: *"the legacy RPC inserts a public.users row without an Auth id and is no longer
compatible with the live users_id_fkey contract"*. That knowledge sat in one suite and reached
neither the other suites nor the route. A workaround that hides a defect from the thing that has
the defect is worse than a failing test.

**Still owed:** `verify-kill-switches.mjs` and `verify-kill-switches-multi.mjs` still call the
legacy RPC first and fall back when it errors. Nothing in the application calls it any more, so
those two should use the Auth-first path directly rather than trying the broken one each run.

### 192. 🟡 LA-1.13's CSV check passes alone and fails inside verify:all
**From:** verify:all, 2026-09-13 Â· **Belongs to:** LA-1.13, verification suites Â· **Gap recorded:** 2026-09-13

    FAIL CSV export includes the complete filtered result and neutralizes formulas

in the full run; `npm run verify:deal-flow` on its own passes that check, and did so four times today
including twice back to back. So the failure is a property of running it after seventy other suites,
not of the export.

The likely mechanism is in the check's own wording: *complete* filtered result. It asserts the export
contains exactly the rows its filter should match, and `deal_flow` accumulates rows from other suites'
fixtures during a long run — LA-1.18, LA-1.20 and LA-1.22 all write it. A tenant-scoped filter would be
immune; a date- or status-scoped one is not.

Not diagnosed further here, because the fix is probably to scope the assertion to the suite's own
tenant rather than to make the run tidier, and that is a decision for whoever owns LA-1.13.

**Why it is worth an entry rather than a shrug.** This is the shape backlog 184 was about: a check that
reports a product defect when the real cause is what ran before it. The audit row for LA-1.13 says this
criterion passes, and it does — but only in isolation, and the run that most resembles CI is the one
where it does not. A green suite that is green only alone is a weaker guarantee than it appears, and
the next person to see this failure will reasonably read it as a broken CSV export.

**Fix:** scope the assertion to the suite's own tenant, then confirm by running `verify:all` rather
than the suite alone — the only run that can prove it. Cost of leaving it open: one permanently red
check in the full run that is not a real defect, which trains people to skim the failure list.

### 194. 🟡 A verification suite rewound the shared invoice counter and took invoicing down
**From:** backlog 24/27/44 work Â· **Belongs to:** verification suites Â· **Recorded:** 2026-09-13

`invoice_counters` said the next INV number for 2026-09 was 0012. Rows numbered INV-2026-09-0012
and -0013 already existed. Every attempt to create an invoice — any invoice, by anyone — failed on
`duplicate key value violates unique constraint "platform_invoices_number_key"`.

Four defensible steps produced it. As committed at `e7c00ee`, `scripts/verify-coupons.mjs`:

    1. recorded the counter at the start of its run and wrote it back at the end, to leave
       "no gap in the live sequence"
    2. deleted the invoices it had created first, which is what would have made that safe
    3. except those deletes fail — prevent_issued_invoice_mutation refuses to delete an issued
       invoice, and the suite's invoices are `paid`
    4. and the failure is discarded (`await supabase.from(...).delete()` with no error branch),
       so the rewind happened regardless

Repaired by `20260913230000_invoice_counter_repair.sql`, which moves each counter to one past the
highest number actually issued — derived from the rows rather than from a remembered value, and
safe to run again.

`verify-coupons.mjs` had already been fixed in the working tree before this session and no longer
rewinds. `verify-credit-notes.mjs` still did, and now does not: its cleanup drafts its invoices
before deleting them so the delete actually works, reports every cleanup error instead of
discarding it, and only reads the counter.

**Two lessons, and the second is the general one.**

A verification suite may create and remove its own rows. It must not write a counter the rest of
the system is reading — a gap in an invoice sequence costs an explanation, while a rewound counter
costs every invoice after it, including the application's.

And a cleanup that half works is worse than one that fails loudly. Three suites deleted invoices
the immutability trigger was never going to let them delete, and all three discarded the error.
`verify-period-billing` and `verify-coupons` now print cleanup failures.

**Still open:** nothing prevents a future suite from doing the same. The durable fix is to make
`allocate_document_number` refuse to hand out a number that already exists rather than trusting its
own counter, which is a change to a function every invoice path depends on and deserves its own
task. Cost of leaving it: the drift is repaired and the two known causes are fixed, but the
mechanism that allowed it is intact.

### 195. 🔴 Every plan is mapped to a placeholder Whop plan, so checkout 404s for everyone
**From:** manual walkthrough, 2026-09-13 Â· **Belongs to:** SA-4.2, SA-5.2 Â· **Gap recorded:** 2026-09-13

`POST /api/app/checkout/start` answers 500 with `{"error":"Could not open checkout"}` for every
plan and every customer. The server log says what the customer never sees:

    Whop POST /checkout_configurations failed with 404
    { error: { type: 'not_found', message: 'This Plan was not found' } }

`public.whop_plans` maps our plans to the provider's, and every row is a seeded placeholder:

    basic     monthly   plan_demo_m_0
    basic     yearly    plan_demo_y_0
    pro       monthly   plan_demo_m_1
    pro       yearly    plan_demo_y_1
    advance   monthly   plan_demo_m_2
    advance   yearly    plan_demo_y_2

`plan_demo_*` is not a Whop id. Nothing at Whop answers to these, so the provider correctly refuses
to build a checkout for a plan it has never heard of.

**The whole paid funnel stops here.** Pricing, plan selection, signup, legal acceptance and the
verification email all work — verified end to end today — and then the customer cannot pay. The
five failing checks in `verify:checkout` are all this one cause.

**What is NOT broken, which is worth saying precisely**, because it explains why this survived: the
webhook path works completely. `verify:checkout` proves that once Whop confirms a membership, the
subscription is created, it starts in `trialing`, `trial_ends_at` is ~14 days out, the entitlement
is built and the tenant leaves onboarding. So every test that simulates a *completed* payment
passes, and only the step that actually talks to Whop fails. A suite that mocks the provider would
report this product as fully working.

**Fix:** `lib/payments/whop/planMapping.ts` already creates a Whop plan on demand and stores the id
(`createPlan`, then `insert into whop_plans`). The placeholder rows pre-empt that path — the
mapping is found, so it is never created. Deleting the `plan_demo_*` rows would let the real ones
be created on first checkout. That is a one-line data change and a decision about a live payment
provider, so it belongs to whoever owns the Whop account rather than in this audit.

**Cost of leaving it open:** no customer can subscribe. This is the single blocker between a
working signup funnel and revenue.

### 196. 🔴 Advance is mapped to the provider at a price we do not charge — $50/month too high
**From:** manual walkthrough, 2026-09-13 Â· **Belongs to:** SA-4.2, SA-3.2 Â· **Gap recorded:** 2026-09-13

`whop_plans.price_cents` is what the provider would charge. `plan_prices` is what we publish and
what the invoice is built from. For Advance they disagree:

    plan      cycle     provider    ours      difference
    basic     monthly   9900        9900      —
    basic     yearly    99000       99000     —
    pro       monthly   24900       24900     —
    pro       yearly    249000      249000    —
    advance   monthly   49900       44900     +5000   ($50.00 per month)
    advance   yearly    499000      449000    +50000  ($500.00 per year)

The pricing page publishes Advance at **$449.00**. The provider mapping says **$499.00**. Basic and
Pro agree exactly, which is what makes this a data error in one row rather than a units bug.

**Which one would win.** The customer is charged by the provider, so a customer on Advance would
pay $499 having been shown $449 — a real overcharge, not a display bug. Our own invoice would be
built from `plan_prices` at $449, and SA-3.2's reconciliation would then flag the invoice
`mismatched` because the provider total does not equal our total. That reconciliation state is
doing exactly its job, and is the reason this is discoverable at all — see backlog 106, where a
live invoice was found overpaid by 9,900 cents by the same mechanism.

**Currently masked by 195.** Every plan is mapped to a placeholder Whop id, so no checkout opens
and nobody has been charged either price. The moment 195 is fixed by pointing the mappings at real
Whop plans, this becomes live — which is why it is recorded separately and must be fixed *before*
195, not after.

**Fix:** decide which figure is correct, then make one of them match. `planMapping.ts` already
computes a `priceDrifted` flag comparing exactly these two numbers, so the detection exists; what
is missing is anything that acts on it. A check that refuses to open a checkout whose mapped price
disagrees with the published price would have caught this before a customer did.


---

### 197. ✅ RESOLVED — every terminal disposition raised instead of terminating the lead

**Found by** re-running the LA-2.9 suite during the LA-2.13 audit, once an earlier failure in the
same file stopped masking it.

    ERROR: 55000 record "v_sched" is not assigned yet
    DETAIL: The tuple structure of a not-yet-assigned record is indeterminate.
    CONTEXT: PL/pgSQL function complete_dial_disposition ... line 114 at RETURN QUERY

`complete_dial_disposition` assigns `v_sched` only in the cadence branch — the no-answer path. Its
closing statement then read that record through what looks like a guard:

    case when v_new_state = 'retry' then v_sched.due_at else null end

PL/pgSQL hands the whole expression to the SQL engine with `v_sched` as a parameter, so the record
must have a tuple structure before the CASE is ever evaluated. **A branch that is never taken still
has to be describable.** The guard protected nothing.

**Effect.** The dialer could record a no-answer and nothing else. `do_not_call`, `wrong_number`,
`disconnected`, `not_interested`, `did_not_qualify`, `application_submitted`, `sent_to_underwriting`,
`no_payment_method` and `callback_scheduled` all threw — every disposition that *ends* a call. And
because the attempt row, the suppression write and the queue release all happen before the return,
each failure rolled those back too: the lead stayed `claimed` with no attempt recorded. LA-2.9's
criterion is "every disposition schedules or terminates the lead — none leaves it in limbo", and
every terminating one left it exactly there.

**Fixed** in `20260913402000_la_2_9_terminal_dispositions_raise.sql` — two scalars replace the
record read, null unless the cadence branch sets them, which is what the CASE was trying to say.
Verified across all eleven dispositions in the vocabulary plus an unrecognised one.

**Why no suite caught it:** the LA-2.9 suite does walk the vocabulary, but a defect earlier in the
same file (backlog 198) aborted the run before it got there. One red suite hid another.

---

### 198. ✅ RESOLVED — the cadence proposed the same slot on every attempt, for every tenant

`schedule_next_attempt` avoids retrying a lead into a slot it has already failed in, and builds that
list from `tenant_call_attempts` — which records the slot each call **actually happened in**. Every
call made in one working day happens in the same real-world slot, so the list barely moves between
attempts. The slot it *proposed* last time was never written anywhere it would read back, so it
returned the first unused slot — the same one — every time.

**Why the suite had been green.** It passed when `tenant_cadence_rules` held fixture rows with a
preferred slot per attempt number, and that configuration supplied the variation the function could
not. There are **zero** cadence rules in the database today, so the default path runs, and the
default path could never rotate. Every tenant who has not configured a cadence — which is all of
them — got one hypothesis repeated six times and called it a sequence.

**Fixed** in `20260913401000_la_2_8_2_9_two_defects_found_by_regression.sql` — the proposal advances
through the unused slots by attempt number instead of always taking the first. A configured
preference still wins while unused, and a dialled slot is still never proposed while an undialled
one remains.

---

### 199. ✅ RESOLVED — an abandoned lock returned the lead to a pool it could never be drawn from

LA-2.8 criterion 3 is "an abandoned lock returns the lead to the pool". The reclaim at the top of
`serve_next_lead` returned the **work item** — `status` back to `unclaimed`, lock cleared — and left
the **lead** in `lead_state = 'working'`. No tier in `serve_next_lead` matches a working lead.

Probed directly against the live database:

    served first time                     73527921-...
    lead_state after serve                working
    re-served after abandoned lock        0
    queue status after reclaim attempt    unclaimed

So the work item sits in the queue, visible and unclaimed, and can never be handed out. An agent who
claims a lead and walks away does not release it back to his colleagues — he destroys it, silently,
while the queue goes on reporting work it will never serve. Purchased leads, lost one at a time,
with no error anywhere.

**Fixed** in `20260913401000_la_2_8_2_9_two_defects_found_by_regression.sql` — the reclaim now
restores the lead alongside the work item: back to `fresh` if nobody dialled it, back to `retry` due
immediately if there are attempts on it, since the abandoned call is not an attempt.

---

### 200. ✅ RESOLVED — the tenant invite path never checked `max_seats`, for any role

**Backlog #15 records seat limits as enforced "at user creation" by SA-2.5. That is true of the
platform admin's path and was never true of the one tenants use.**

`seat_limit_reached` appears in exactly three functions — `admin_create_user`,
`admin_set_user_status` and `admin_attach_user_to_tenant`. The path a tenant owner uses from their
own team settings page is `tenant_invite_user_with_auth`, which checked `max_buffer_seats` for
assistants and nothing at all for anybody else. There is no trigger on `tenant_users`, so nothing
downstream caught it either.

**Effect.** Any tenant on any plan could invite unlimited seats from their own settings page. Seats
are the primary axis this product is priced on.

**Found** while checking LA-2.12 criterion 5, "setter seats count against the plan limit" — they did
not, and the reason turned out to have nothing to do with setters.

**Fixed** in `20260913385000_la_2_12_invite_counts_a_seat.sql`, for every role rather than as a
setter-shaped special case: a limit that applies to one role and not the others is the same bug in a
smaller costume. It reuses `tenant_current_plan` / `tenant_seats_used`, reads the limit from
`plan_limits` rather than from a number the caller passed, takes the same advisory lock as the rest
of the seat arithmetic so two simultaneous invitations cannot both win the last seat, and raises the
identical `seat_limit_reached:<used>:<max>` string the application has parsed since SA-2.5.
`app/api/app/team/route.ts` now surfaces it as an upgrade prompt.

Verified live: with the limit pinned to current usage, an invitation was refused and **created
nothing** — no membership, no invitation row.

---

### 201. 🔴 The database is over its storage quota and keeps flipping read-only

Encountered twice while running the LA-2.12/2.13 verification suites:

    ERROR: 25006 cannot execute GRANT ROLE in a read-only transaction

`default_transaction_read_only` is being switched on at the project level, then released, then
switched on again. Database size is **805-840 MB**. What is consuming it:

| Table | Size | Rows |
|---|---|---|
| `realtime.messages_2026_09_13` | 375 MB | 1,191,134 |
| `public.disposition_options` | 200 MB | 566,720 |
| `public.disposition_nodes` | 27 MB | 70,840 |
| `public.tenant_pipeline_stages` | 24 MB | 70,840 |
| `public.tenant_disposition_flows` | 23 MB | 70,840 |

Two separate problems.

**One: a single day's Realtime partition is 375 MB.** `realtime.messages_2026_09_13` holds 1.19
million broadcast rows for one day — nearly half the database. Supabase partitions and prunes this
table itself, but something is publishing to it at a rate nothing in this application accounts for.

**Two: 70,840 pipelines' worth of seeded scaffolding.** `tenant_pipeline_stages`,
`tenant_disposition_flows` and `disposition_nodes` each hold exactly 70,840 rows, and
`disposition_options` holds 566,720 — precisely eight per flow. For roughly thirty tenants. Whatever
creates a pipeline plus its stages, flow, nodes and options has run thousands of times, almost
certainly a verification or seed script with no idempotency guard. The exact multiple across four
tables is the signature of a loop, not of use.

**Not caused by the LA-2 work** — those migrations touch none of these tables, and their fixtures
are deleted by their own suites (verified: zero stray rows).

**Left for a decision rather than fixed.** Deleting 1.19 million Realtime rows and 700,000 seeded
scaffolding rows is irreversible and is the owner's call, not a side effect of an audit. The options
are to prune the Realtime partition, find and fix whatever re-seeds pipelines, or raise the storage
tier. Until one of them happens, any suite that writes can fail at random with 25006.


---

### 202. 🔴 The board and the decision log disagree, and the board is losing

**The decision log — *Sixteen Open Questions, Answered*, 2026-09-11 — amends or cancels at least
nineteen tasks. None of those amendments have reached the task pages.** The pages were last edited
2026-09-09, so the log is strictly newer, and anybody picking up a task from the board is reading
superseded requirements.

This is not theoretical. It has already cost work twice in this audit:

**LA-2.15 and LA-2.16 are cancelled and still read `In progress`.** Decision 16 retires both — they
describe the same browser extension and the same field maps as LA-3.12 / LA-3.13 / LA-3.14, written
before the Sell module existed. LA-2.15 is an **L-effort** task that would have meant a Chrome
extension, a second auth model and a second set of field maps, all superseded before a line of it
was written. Its page still carries *"decide the auth model before writing code"* as an open
question; LA-3.12 answered it. Nothing has been built against either — verified: no
`manifest_version`, no content script, no allowlist, no autofill code anywhere in the repository.

**LA-2.12 criterion 4 was scored PASS against wording decision 12 had already replaced.** The
implementation was correct for the sentence on the page and wrong for the product — see entry 203.

**Still unreconciled, and each one is a criterion already scored in the LA-2 audit:**

| Task | Decision | What changes |
|---|---|---|
| LA-2.3 | 3 | The serve-time check never calls a vendor; an outage blocks import, not dialling |
| LA-2.7 | 2 | `delay_interval` is a floor, not an exact time; slot diversity is the hard rule; least-recently-used fallback; the 5-of-7-in-72h criterion becomes a population target |
| LA-2.8 | 1 | A lead **search** exists alongside the queue; search is not a serve and must not consume a cadence attempt; new `inbound return call` disposition |
| LA-2.14 | 14 | The one-record sentence is replaced; lead → case → many applications |
| LA-2.17 | 10 | No nightly snapshot; compute live with incremental rollups |
| LA-2.19 | 11 | Undialable rate replaces dispute rate; claim acceptance rate added, high-is-good |

Decision 2's point about LA-2.7 is worth pulling out because it interacts with a live fix: it says
the fallback when every slot is used should be **least recently used**, and that the engine must
never return "no slot available". Backlog 198 fixed the rotation by advancing through unused slots
by attempt number, which satisfies the spirit but is not LRU. That should be reconciled rather than
left as two similar-sounding rules.

**Fix:** set LA-2.15 and LA-2.16 to `Cancelled` with pointers to the LA-3 tasks, and fold each
decision into the task page it amends. Until that happens, **the decision log is the authority and
the task page is a draft**, and any audit that reads only the page will keep producing confidently
wrong scores.

---

### 203. ✅ RESOLVED — show rate was built to the superseded wording, and would have mispaid setters

LA-2.12's page says *"show-rate per setter is computed from actual appointment outcomes, not
self-reported"*. That was implemented literally last session: a status only a licensed agent may
write, with `mark_appointment_outcome` refusing a setter. Scored PASS.

**Decision 12 had already replaced that criterion**, and it identifies exactly the failure mode the
literal reading produces: the only person who knows whether someone showed is Ray, after the call
— and **people are paid on this number**. If he forgets to mark it, the setter's score is wrong.
Under the shipped version, an unmarked appointment simply vanished from the numerator and the
denominator, so a busy week of admin looked identical to a week of good work.

**Fixed** in `20260913415000_la_2_12_show_rate_amendment.sql`:

- **Automatic.** Any recorded activity on the lead near the slot — a disposition, a note, an
  application case, a deal update — marks it `showed`. Ray dispositioning the call *is* the
  marking; most appointments need zero extra clicks from him.
- **Pending**, an explicit state rather than an absence, with a close-out strip
  (`tenant_appointment_close_out`) showing only what is still inside the three-day window. **Never
  `no_show`** — a missing mark must never silently become a penalty against someone's pay.
- **Coverage beside the rate.** `show_rate_pct` now travels with `closed_out`, `closeable` and
  `coverage_pct`, and `ScorecardRow` carries `coveragePct` next to `showRatePct` so no screen can
  render one without the other to hand. 62% of 31 is a pay decision; 62% of 8 is not, and without
  coverage the reader cannot tell them apart.

Verified live: a dispositioned appointment was inferred `showed` with nobody touching it, a silent
one went to `pending` and not to `no_show`, a five-day-old one dropped off the strip, and the
scorecard read **100% at 1-of-3 coverage**, then **50% at 2-of-3** once a real no-show was recorded.
The setter still cannot write the outcome — that half was not superseded, and it is the reason the
number means anything.

---

### 204. ✅ RESOLVED — an outbound lead could never reach the verification panel

LA-2.14's whole job is an entry point, and there was no door.

`claim_transfer_lead` creates a `tenant_verification_sessions` row; `serve_next_lead` does not. The
panel's own loader **requires** an existing session and never creates one, so an agent working an
outbound lead got `verification_owner_required` no matter what they did. The route was also gated on
the `inbound_transfers` entitlement, so a tenant who had bought the dialer and not inbound transfers
could not have reached it even with a session.

Two more gaps behind it:

- **No deal-flow row exists for an outbound lead, ever.** `writePartnerIntakeArtifacts` writes that
  row at partner-submission time, and an outbound lead has no partner submission — it arrived by
  list import or the post API. LA-2.14's criterion "an outbound sale appears correctly in the daily
  deal flow" had nothing to appear.
- `deal_flow` carried `campaign_id` and not `vendor_id`, and nothing recorded whether a deal came
  from inbound or outbound.

**Fixed** in `20260913410000_la_2_14_outbound_application_handoff.sql`: one idempotent RPC that
creates or resumes the verification session using the identical insert `claim_transfer_lead` uses,
opens or reuses an application case, and ensures the deal-flow row exists. Plus `deal_flow.vendor_id`,
`deal_flow.source`, `tenant_application_cases`, and `tenant_lead_attribution_chain` — which reports
`case_attribution_lost` / `deal_attribution_lost` so a wrong cost figure can be traced to the hop
that dropped the attribution instead of argued about.

This closes the hop LA-2.1 explicitly recorded as blocked on this task.

`lib/outboundApplication/noFork.test.mjs` asserts criterion 1 structurally — one implementation of
the panel, both routes importing it, **identical arguments at both call sites**. Proven
non-vacuous: adding `{ isOutbound: true }` to the outbound call fails the suite.

---

### 205. 🟡 `check-migrations` reported every migration as broken while the database was read-only

`scripts/check-migrations.mjs` validates migrations by running them against the live server and
treating a **permission** error as success — Postgres parses a statement before it checks rights, so
`42501 insufficient_privilege` proves the SQL is syntactically sound. Sound trick, and it stopped
working the moment the project went read-only (backlog 201): DDL then fails with
`25006 read_only_sql_transaction`, which the script counted as a failure.

That is a false alarm arriving at precisely the worst time — the database is full, and the tool that
tells you whether your migration is valid says every file is broken.

**Fixed:** `25006` is now in the expected set, with the reasoning written next to it. It proves the
same thing `42501` does and for the same reason — the statement parsed; a syntax error would have
been raised first.

Note for anyone hitting this: the **deep** check still cannot run read-only, because it creates a
temporary PL/pgSQL function to hold the per-statement exception boundary. Use `--fast`, which uses
savepoints and works.
