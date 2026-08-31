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

### 53. Nine of the eleven settings the ticket lists were not created
**From:** SA-4.1 · **Decided while building, 2026-08-30**

SA-4.1 names eleven keys under *"Settings needed by the tasks above."* Two of them exist. The store
holds four keys in total — the other two were added because they have real consumers that the
ticket did not anticipate.

**Created, and read by something today:**
`users.invite_expiry_hours` · `platform.default_currency` ·
`billing.refund_approval_threshold_cents` (added, from SA-3.8) ·
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

### 54. Payment credentials remain environment configuration, not database data
**From:** SA-4.2 · **Decided while building, 2026-08-30**

The Whop API key, base URL, webhook secret, product ID and account ID remain in process
environment variables. SA-4.2 deliberately does not add `credentials_enc`, a `mode` column, a
custom encryption helper or a Postgres secret store. A master key for custom encryption would also
live in the environment; moving the ciphertext into a service-role-readable table would widen the
blast radius rather than create a secret manager. The Basic Idea document calls for a real secret
manager, and a database row is not one. Swapping sandbox for production therefore remains a key
and base URL change, not a code change.

**Fix:** none. Keep credentials out of the settings store and database until a real secret-manager
integration is selected.

### 55. SA-4.2 original unchecked criteria not implemented after the Whop-only decision
**From:** SA-4.2 acceptance checklist · **Decision:** Whop-only scope retained on 2026-08-30

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
- **Key changes are audit-logged — NOT IMPLEMENTED UNDER ENV-ONLY CONFIGURATION.** There is no
  in-app key editor, so the application cannot observe or audit an environment-variable change.
  The connection-test attempt is audited instead. Implementing this criterion would require a
  selected secret/configuration manager and an audited application-side change flow.

The original `provider_settings.credentials_enc` / encrypted-at-rest database design is also not
implemented. Credentials intentionally remain in environment variables; see #54. Reopening any
of these NOT APPLICABLE or NOT IMPLEMENTED decisions requires an explicit product-scope change.

### 56. SA-4.3 has a deliberate role-scope deviation and future section saves are pending
**From:** SA-4.3 acceptance checklist · **Decision:** option 1 selected by the user on 2026-08-30

The Configuration Center is implemented as a shared route registry and shell. The role matrix is
intentionally narrower than the raw ticket text: **Payments remains `super_admin`-only** because
it exposes live provider credentials and can perform authenticated provider calls. `billing_admin`
gets Offers & discounts when SA-4.4 is implemented, but does not get Payments. `platform_config`
gets the non-payment, non-offer platform sections. `support_agent` gets no Configuration Center
access and is denied server-side, even if a route is entered directly. The repeatable
`npm run verify:configuration` check exercised all 45 role/route cases, including temporary active
fixtures for `support_agent` and `platform_config`; those fixtures were removed after the run.

The Advanced section currently saves each setting independently and was exercised through the
browser. Payments reuses its existing independent connection-test workflow, and Offers now reuses
the existing independent Coupons workflow. The remaining section
routes are intentionally placeholders owned by SA-4.4 through SA-4.12, so their save behavior is
**NOT TESTABLE YET** and the SA-4.3 criterion *"every section saves independently"* is not fully
complete until those tickets provide their own forms and save actions. The recently changed strip
reads the existing `audit_log`; operational payment connection tests are excluded because they are
health activity, not configuration changes.

**Fix:** implement and verify each section's own form in its owning ticket. Reopen the role matrix
only if the product decision about payment credentials changes.

### 50. The hardcoded-constant sweep is deliberately partial
**From:** SA-4.1 · **Decided while building, 2026-08-30**

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
**From:** SA-4.10 · **Decided with the product owner, 2026-08-30**

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
For SA-4.2 specifically, there were no active `support_agent` or `platform_config` accounts to use
for a live 403 check, and the forced provider-error UI/console-error capture was not exercised;
the success path, `billing_admin` 403, anonymous/expired/forged 401s, and the safe API payload were
verified.

**Verified in a browser so far:** the invoice list, detail and print screens (SA-3.3), and the
SA-4.2 payment-status screen, including the successful connection-test confirmation. The protected
status API's safe-field-only response was also verified through an authenticated HTTP check; the
API cannot be opened as a standalone browser document because the in-app browser blocks raw JSON.

### 57. SA-4.4 live and browser verification completed
**From:** SA-4.4 · **Verified in live project, 2026-08-30**

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
**From:** SA-4.5 · **Verified in live project, 2026-08-30**

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
**From:** SA-4.6 · **Belongs to:** SA-4.7 and the later agent lead-workspace ticket · **Resolved 2026-08-30**

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
**From:** UI verification 2026-08-30 · **Built 2026-08-31**

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
**From:** browser verification, 2026-08-30 · **Needs an operator, not a fix**

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
**From:** reference data export, 2026-08-30 · **Corrected 2026-08-31**

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
**From:** agent app design pass, 2026-08-31 · **Largely closed**

Twenty-four of the thirty agent menu items had no route. Next answered every one with its default
404, so a customer on a plan granting Quoting or Statements saw a sidebar where most of it was
broken — features they were paying for, promised in the navigation, leading nowhere.

Closed by `app/app/(shell)/[section]/page.tsx` plus `components/app/coming-soon.tsx`. A static
segment beats a dynamic one, so the six real screens are untouched and the catch-all only ever runs
for the rest. It decides in this order: not in the menu → 404, which is correct; in the menu but not
granted → the existing gate notice; granted but unbuilt → "on the way". Entitlement is checked
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

**Not verified in a browser.** Every one of these screens sits behind a login and this session could
not mint a session cookie (#72). Mockups of the implemented design are at
`design/AgentApp.design.html`; they are drawn from the code, not photographed from it.

---

### 75. The entitlement blob should carry the plan's display name
**From:** agent app design pass, 2026-08-31 · Minor

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

## ⚪ Tech debt

### 51. The settings cache only invalidates on the instance that wrote
**From:** SA-4.1 · Minor, bounded

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

### 24. Nothing *schedules* the billing run
**From:** SA-2.5, narrowed by SA-2.7, widened by #44 on 2026-08-31 · **Belongs to:** SA-6.1

`npm run bill:periods` now does the whole rollover in the right order: bill the period that ended,
then advance it. Verified end to end except for the part that needs the migration applied.

What is still missing is a **scheduler**, and the stakes went up. Before #44 an unrun job meant a
queued downgrade applied late. Now it means invoices are never raised — add-ons go unbilled, overage
is free, and a mid-period upgrade's difference sits in `pending_charges` forever. A job that
silently never runs still looks identical to a healthy one.

SA-6.1 should schedule it **and** alert on missed runs. `period_billing_runs.ran_at` is the natural
signal: no row in the last N days for a subscription whose period has ended means the job is not
running, and that query is cheap.

Meanwhile `POST /api/admin/billing/run` lets a billing admin trigger it from the app, so the run is
something a person can see and check rather than an SSH session away. That is not a substitute for
a scheduler.

---

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

### 37. Already invoiced — this entry was stale
**From:** SA-3.2 · **Checked and closed 2026-08-31**

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
**From:** SA-3.2 (2026-08-30) · Minor

UPDATE is revoked on every column of `invoices` except the lifecycle ones, and `invoice_lines`
refuses UPDATE and DELETE outright. But `invoices` itself can still be DELETEd by the application.

Deleting a financial record is worse than editing one, and the correct operation is already
built — `void`. DELETE is currently retained only so verification scripts can clean up after
themselves; the same tension as `usage_events`, resolved the other way. Before real customers,
revoke it and give the test scripts a dedicated path.

### 29. One step still owed: the baseline has never been replayed into an empty database
**From:** end-of-SA-2 push · **Mostly closed 2026-08-30**

The original of this entry said the schema existed nowhere but project `iiimdgizjwnihpyrukbu`. That
is no longer true. `supabase/migrations/0000_baseline.sql` now carries **45 tables, 23 enums, 57
indexes, 5 views, 47 functions, 61 foreign keys, 3 policies and the grant/revoke state of 50
tables**, generated by `npm run db:dump`, and `0016_reference_data.sql` seeds the three catalogs the
code asserts against. The `tenant_app` role is created by a migration for the first time.

`supabase db pull` could not be used: the only credential this repo holds is `TENANT_DB_URL`, whose
role is deliberately `NOBYPASSRLS` with no DDL rights, and the CLI wants an owner connection. The
dump reads the catalog instead, which any role may do.

All 17 files parse against a real PostgreSQL server (`npm run db:check`).

**What is still owed:** parsing is not applying. Nobody has replayed `0000` → `0016` into an empty
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
**From:** SA-3.1, resolved in SA-4.2 · **Decision:** keep dormant by user on 2026-08-30

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
**From:** SA-3.3 (2026-08-30) · Minor

The ticket asked for filters on status, tenant, date range and overdue-only. The screen has status,
overdue-only and mismatched-only; **tenant and date range are supported by `GET /api/admin/invoices`
but have no control**. Both are a couple of inputs once there are enough invoices for filtering to
matter — with two rows it would be furniture.

### 47. A provider checkout creates no subscription on our side
**From:** SA-3.9 (2026-08-30) · **Significant — found by the dashboard**

Your tenant has paid twice through Whop checkout and has **no subscription row**. `subscriptions`
is empty; `membership.activated` arrived twice and did nothing, because `applyProviderEvent`
updates an existing subscription and never creates one.

Consequences, all visible on the revenue screen: contracted MRR is $0 while $447 has been
collected, active customers is 0, there is no plan breakdown, and the entitlement engine has
nothing to resolve — so a paying customer would get no features.

An admin assigning a plan by hand is the only path that currently produces a subscription. Either
`membership.activated` should create one from the plan metadata Whop returns (which carries
`insurvas_plan_id` and the cycle, so everything needed is already on the event), or self-serve
checkout should be closed off until it does.

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

### 46. Credit is applied automatically — resolved
**From:** SA-3.8 · **Built 2026-08-31**

The ticket's criterion was "an unused credit balance is applied to the next invoice automatically
and shown as its own line". It was unmet because on automatic billing there was no invoice of ours
to apply it to.

#44 created one. The period billing run applies the balance as a `credit` line on the period invoice
and deducts it — inside the same transaction that raises the invoice, because deducting afterwards
means a crash in between gives the discount away twice.

Clamped to the bill, deliberately. Credit larger than the charges does not produce a negative
invoice, and does not evaporate either: what could not be spent stays on the balance. When credit
covers the charges completely, the run records that it happened and raises no invoice at all.

`redeemCreditAsFreeDays()` remains for the case where there is no invoice to discount, and still has
no button. That is a convenience now rather than the only mechanism.

---

### 44. The period billing run exists — one step left
**From:** SA-3.7 · **Built 2026-08-31**

The job now exists: `npm run bill:periods`. For each subscription whose period has ended it gathers
attached add-ons, metered overage above the effective allowance, and any charge parked by a
mid-period plan change, applies the tenant's credit balance, and raises one invoice for the lot —
then advances the periods.

Three decisions worth knowing:

- **Bill, then roll, in one command.** Usage is keyed by `period_start`, so after
  `advance_billing_periods()` runs, "this period's usage" means the new empty bucket. Billing after
  the roll would charge everyone for zero overage forever and look healthy doing it. The two cannot
  be scheduled apart because they are one script.
- **Idempotent by primary key, not by a check.** `period_billing_runs (subscription_id,
  period_start)` is written in the same transaction as the invoice. A check in application code
  would race two concurrent runs; a primary key cannot.
- **Overage is skipped for hard-capped or unpriced meters.** A hard cap means the usage was refused
  at the door, so billing it would charge for something we blocked; an unpriced meter means an
  operator has not priced it, and inventing a price to bill a customer is worse than billing
  nothing.

**Still owed:** `supabase/migrations/0017_period_billing.sql` has not been applied — no credential in
this repository can run DDL. Until it is, `npm run verify:period-billing` stops with a clear message
and the run has never executed against a real database. The arithmetic is covered by 19 unit tests
and the migration parses against a real server; neither of those is the same as having run.

---

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

### 41. Proration now has a caller — resolved
**From:** SA-3.4 · **Built 2026-08-31**

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
**From:** SA-4.7 · **Belongs to:** SA-4.7 · **Resolved:** 2026-08-30

Nothing added to the backlog for SA-4.7. The live verification covered onboarding copy creation,
subscription-filtered template discovery, tenant isolation, second-template preview and merge,
idempotent re-application, and tenant-scoped RLS. The repository checks and signed-in browser
screen verification also passed. Platform templates remain immutable inputs; agent edits are saved
only to the tenant-owned copy.

### 61. ✅ SA-4.8 agent-side DNC preflight is now wired
**From:** SA-4.8 (2026-08-30) · **Belongs to:** SA-4.8 · **Resolved:** 2026-08-30

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

---

## ✅ Resolved

*Terse log — details live in git history.*

- **#9 No CI pipeline** → `.github/workflows/ci.yml`. Two jobs: `verify` needs no secrets at all
  (typecheck, lint, 159 unit tests, production build) and gates every push and pull request;
  `database` runs all 20 suites via the new `npm run verify:all`, plus the cross-process kill-switch
  check, and skips itself with a notice when the repository has no credentials configured. The
  no-secret build was proven first — no module reads `process.env` at import time, so placeholders
  exercise the same paths as real keys. This closes the "runs in CI" criterion on SA-1.4, SA-2.6
  and SA-4.10.

- **#65 Kill switches fail OPEN** → the decision stands and is recorded here because the entry was
  removed when #63 was closed. If `feature_switches` cannot be read, every feature is treated as ON
  and the error is logged loudly. Failing closed would turn one unreadable table into a total outage
  for every tenant, triggered by exactly the partial failure a deploy produces; entitlements still
  apply, so nobody gains anything unpaid-for. The reasoning also lives in `lib/features/killSwitch.ts`.
  Revisit only if switches ever become a security boundary rather than an incident tool.
- **#70 was a duplicate of #56** and has been removed. Both record the same deliberate deviation —
  Payments staying `super_admin`-only against SA-4.3's stated matrix. #56 says it better and cites
  the 45-case `verify:configuration` run. I grepped before adding it and missed #56 because it
  phrases the decision differently.

- **#52 Every admin screen scrolled sideways below ~870px** → fixed 2026-08-30, and the diagnosis in
  that entry was wrong. It blamed the fixed sidebar and prescribed collapsing it. The real cause was
  two lines: `<main>` is a flex item, so `min-width: auto` stopped it shrinking below its widest
  child, and `tableShell` used `overflow-hidden` so a wide table had nowhere to scroll. A wide table
  therefore pushed main, main pushed the page, and the sidebar slid off the left. Adding `min-w-0`
  to main and switching the table container to `overflow-x-auto` fixed every admin screen at once:
  measured at a 560px viewport, Users went from 652px of page overflow to 0 and Features from 304 to
  0, with the table scrolling inside its own container instead.

- **#68 Six sections kept the old table treatment** → closed 2026-08-30 after actually looking at
  them. The premise was wrong: the entry assumed rows of Save buttons and thin empty states across
  all six, and only one section had a per-row save at all. What the pass found instead was empty
  states that stated a fact without naming the action — most sharply on Compliance sources, where a
  red "dialing is blocked platform-wide" banner sat directly above a table reading "No compliance
  vendors registered", never connecting the two. Those four now name the way out. Everything else on
  those screens was already carrying its weight in the wider layout, so it was left alone.

- **The connection probe counted its own success as a failure** → fixed during the Module 4 UI pass.
  SA-4.2's test asks Whop for a payment id that cannot exist, and the expected 404 was logged as an
  error, so every connection test made the payment health panel look worse. Surfaced within a minute
  of the configuration hub starting to display that number. The probe now declares which statuses
  mean success for it.

### 62. ✅ SA-4.9 credit packs, defaults and usage monitor completed
**From:** SA-4.9 · **Verified in live project, 2026-08-30**

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
inputs, audit rows, and a 500-tenant × 6-meter response. Browser QA at
`http://localhost:3000/admin/configuration/credits-limits` passed with visible focus, native
mandatory-reason validation, successful rendering and no console errors. The pack action uses the
existing issued custom-invoice workflow because this repository has no deferred recurring-invoice
queue; it creates the tenant invoice line now rather than changing Whop's provider charge flow.

Nothing added to the backlog for SA-4.9; all six acceptance criteria are covered by the live
verification evidence above.

### 66. ✅ SA-4.10 multi-process propagation verified
**From:** SA-4.10 · **Belongs to:** SA-4.10 · **Resolved:** 2026-08-30

The prior single-process check could not prove that one server's in-memory cache invalidation was
not required. `npm run verify:switches:multi` now warms two independent production server processes,
toggles through the first, and confirms that the second reads the database-backed change within the
60-second requirement. It also confirms that restoration propagates within the same bound. The
throwaway tenant and switch row are removed after the run; audit rows remain by design.

- **SA-4.2 payment provider status surface** → implemented 2026-08-30. The protected standalone
  Whop status page, safe status API, environment-only credential policy, explicit permission split,
  centralized request logging, connection-test auditing, and actual error categories are in place.
  Live authenticated browser verification remains tracked under [#8].

- **Windows feature-check shutdown assertion** → resolved 2026-08-30. The feature-key checker now
  sets `process.exitCode` and lets Node close normally, so the required command reports its valid
  no-drift result with exit code 0.

- **#49 The settings store had never written a row** → resolved 2026-08-30. The migration was
  applied and the store was exercised end to end in a browser: saving moved `users.invite_expiry_hours`
  72 → 96 and it survived a reload; the audit row carried `{from: 72, to: 96}`; changing
  `billing.refund_approval_threshold_cents` to 10000 changed the Refunds & credits subtitle from
  "$500.00" to "$100.00" on a **different page, in the same running process, with no restart** —
  which proves cache invalidation and that the value reaches its consumer. `tenant_app` is refused
  the table outright (`permission denied for table settings`), so RLS and the REVOKEs hold. Both
  values were then restored to their defaults; the four audit rows are the record of the test.

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

### 67. ✅ SA-4.12 system maintenance and announcements completed
**From:** SA-4.12 · **Belongs to:** SA-4.12 · **Resolved:** 2026-08-30

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

---

## Related

Items 9, 11, 12 are also captured in the Notion ticket
[SA-0.4 · M0 foundation hardening & follow-ups](https://app.notion.com/p/3ca75c44dafd8109b624e2a2387b2cfe).
This file is the working copy; keep both in step when triaging.
