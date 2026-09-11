# LA-0 blockers — what is actually wrong, and who can clear it

Date: 2026-09-11. Companion to `LA-0.1-0.6-QA-AUDIT.md` and `LA-0-NOTION-DELTA.md`.

Read this first. The audit says 21 of 42 acceptance criteria are `BLOCKED`. They are blocked by
**one root cause with three symptoms**, and it is not application code.

---

## The root cause

**`.env.local` points at a database belonging to a different generation of the product.**

Evidence, from `npm run verify:rpc-contract` (new in this pass) against the configured project:

| Measure | Count |
|---|---|
| RPCs the application calls | 131 |
| Of those, present in the database | **27** |
| Missing from the database | **104** |
| Application functions in the database the app never calls | 106 |

The 106 uncalled functions are not dead code. They are a coherent, different application:
`outbound_can_dial_now`, `outbound_set_agent_campaigns`, `reserve_organization_seat`,
`consume_organization_usage`, `get_next_legacy_lead`, `assign_lead`, `approve_commission`,
`resolve_agent_commission`, `transition_insurance_policy`, `transition_talent_candidate`,
`hr_generate_slug`, `chat_sidebar_state`. That is the **organizations-era CRM**, live and in use.

This repository is the **tenant-era SaaS**. The two share one database through the LA-0
compatibility bridge, and that bridge only ever covered the LA-0 slice — which is why exactly the
LA-0 tables (`tenants` 6 rows, `tenant_users` 14, `tenant_entitlements` 6, `contacts` 3) and the
LA-0 RPCs (`find_contact_duplicates`, `save_contact`, `merge_contacts`, `undo_contact_merge`,
`save_field_schema`, `can_write`, `la0_default_entitlement`) are present, while the entire SA plane
and LA-1 plane are absent.

**This is the architectural decision flagged as Part 0.5, and it is not background context. It is
the blocker.** Nothing further can be proven live until it is settled.

A telling detail: the database already has `tenant_invite_user` and `tenant_update_member_role` —
precisely the functions LA-0.2's invitation and role-change criteria need — and the application
calls neither. The bridge drifted in both directions.

---

## Symptom 1 — no user can be created, by any path

`public.users.name` is `NOT NULL` with no default. The auth bridge trigger
`private.handle_new_auth_user()` inserts `full_name` and `display_name` and never `name`, so every
insert into `auth.users` raises `23502`, which Supabase Auth reports as *"Database error creating
new user"*.

`public.users.id` has no default and carries `users_id_fkey` to `auth.users`, so a direct insert is
not a workaround. The 21 existing users predate the trigger.

**Consequence:** every LA-0 live fixture dies at setup, because all of them create a user.
`verify:contacts` fails on `users_id_fkey`; `verify:agent-shell` fails on `users.id` not-null;
`verify:appointment-vault` and `verify:carrier-library` return 401 on every authenticated call
because their fixture user never existed.

**Fix:** `supabase/migrations/20260911120000_auth_user_bridge_name_fix.sql`. Written, parses
(`npm run db:check`), **not applied.**

**Why I could not apply it:** `TENANT_DB_URL` connects as `tenant_app`, which is
`rolsuper = false`, has `has_schema_privilege('private','CREATE') = false`, is not a member of
`postgres`, and cannot alter `public.users` (owner: `postgres`). This is deliberate — see the
header of `scripts/dump-schema.mjs`. `SUPABASE_SERVICE_ROLE_KEY` reaches PostgREST only, which
cannot run DDL. The Supabase MCP connection available in tooling is bound to a different account
(`CRM-DEV`, `Accounting Database Dev`), not this project.

---

## Symptom 2 — `public.features` does not exist

`npm run check:features` could not report this because it aborted first. Two layered problems,
both now handled:

1. **The message was invisible.** The checker called `process.exit(1)` on its error path while the
   Supabase client still held a handle. On Windows/Node 24 that aborts with
   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` and exit
   code `-1073740791`, destroying the output. The success path at the bottom of the file already
   carried a comment about this exact hazard; the error paths had never been given the same
   treatment. Now fixed: the error is thrown with an actionable message, and the client no longer
   keeps a refresh timer alive.
2. **The actual finding.** `Could not find the table 'public.features' in the schema cache`.
   `public.features` is declared in `supabase/migrations/0000_baseline.sql` and is absent from this
   project. Seven code paths read it: `lib/features/queries.ts`, `lib/publicPlans/queries.ts`,
   `app/api/admin/features/**`, and two verify scripts.

`docs/architecture/task-traceability.md` previously recorded this as "live project exposes
`public.feature_flags`". Nothing in the codebase queries `feature_flags`; that row has been
corrected.

**Fix:** apply the baseline. Same DDL wall as symptom 1.

---

## Symptom 2b — the entitlement source plane is absent, so LA-0.1 criterion 5 is not a defect

Catalog check against the live project (`pg_class`, schema `public`) over the 49 tables this
application uses:

**Present (20)** — the complete LA-0 set: `tenants`, `tenant_users`, `tenant_entitlements`,
`contacts`, `households`, `appointments`, `licenses`, `eo_policies`, `ce_records`, `field_schema`,
`merge_log`, `tenant_carriers`, `commission_schedules`, `advance_rules`, plus `users`,
`organizations`, `admin_users`, `audit_log`, `platform_audit_events`, `invoices`.

**Absent (29)** — essentially the whole SA plane: `plans`, `plan_versions`, `plan_features`,
`plan_limits`, `plan_prices`, `subscriptions`, `payments`, `coupons`, `credit_notes`, `meters`,
`usage_events`, `usage_totals`, `features`, `feature_modules`, `addons`, `legal_documents`,
`legal_acceptances`, `email_log`, `settings`, `checkout_sessions`, `webhook_events`, `whop_plans`,
`business_profiles`, `template_fields`, `tenant_products`, `tenant_credits`, `form_drafts`,
`affiliate_links`, `buffer_handoffs`.

This resolves the one item the audit recorded as a *suspected defect*. `npm run verify:entitlements`
fails four checks, including suspended access resolving to `full` instead of `read_only`. The cause
is now clear and it is not application logic: **`tenant_entitlements` exists and holds 6 cached
rows, but `plans` and `subscriptions` — the source those rows are derived from — do not exist.**
The cache has no producer, so there is no subscription whose status could be read as suspended.

`LA-0.1 criterion 5` is therefore `BLOCKED`, not failing. Re-judge it only once the SA plane exists.

## Symptom 3 — `db:check:deep` cannot replay the chain

`npm run db:check:deep` fails: `credit_notes`, `plan_limits`, `subscriptions` and several functions
do not exist at the point in the sequence where their migrations reference them.

This is **pre-existing and already documented** as backlog #29 — the repo's migrations start at
SA-4.1, and everything SA-0 through SA-3 built exists only inside the live project. `db:check`
(`--fast`) passes because it parses each file independently.

Not a new problem, and not fixable without either the missing historical migrations or a
provisioned-from-scratch project. It is the same root cause seen from the migration side.

---

## What was resolved in this pass, without DDL

| Item | Resolution |
|---|---|
| Four LA-0 verify suites absent from `verify:all` | Wired in, plus a new `npm run verify:la0` |
| 104 missing RPCs invisible to every gate | New `npm run verify:rpc-contract` — fails CI with the list, grouped by owning module |
| `check:features` aborting instead of reporting | Fixed; the real error is now readable and the exit is not an abort |
| 11 role drifts in `agentApiPolicy.ts` | Fixed; registry now matches the deployed guards |
| LA-0.2 criterion 1 had no artifact | `lib/tenantAuth/moneyRoutes.test.mjs` — exhaustive over all 82 agent routes |
| LA-0.1 criterion 6 unproven | `lib/tenantAuth/sessionSeparation.test.mjs` — cryptographic, not conventional |
| LA-0.1 criterion 3 unproven | `lib/menu/planBranching.test.mjs` |
| LA-0.5 criteria 1, 3, 5, 6 unproven | `lib/appointments/singleSource.test.mjs` |
| Stale typecheck/build rows in traceability doc | Corrected — both pass |
| LA-0.6 confidence thresholds undocumented | Read from the deployed RPC and recorded in the audit |

Tests: 294 → 323, all passing. `typecheck`, `lint`, `build`, `db:check` all green.

---

## What has to happen next, in order

Steps 1–2 need someone with DDL access to the project — the Supabase dashboard SQL editor is
enough. Everything after them is mechanical.

1. **Decide the schema question.** Three options, and this is a product/infrastructure call:
   - **(a) Complete the bridge.** Write the ~104 missing functions as compatibility shims over the
     organizations schema. Largest effort, keeps one shared database, and the bridge has already
     drifted once.
   - **(b) Provision a project from this repo's migrations.** Point `.env.local` at it. Cleanest
     for development and for proving LA-0; needs the SA-0–SA-3 migration gap (backlog #29) closed
     first, or a schema dump to seed from.
   - **(c) Converge.** Migrate the organizations app onto tenants. Largest blast radius, only
     sensible answer long-term if both products must share one database.

   My recommendation: **(b) for proving LA-0 now**, and treat (a)/(c) as the separate production
   decision. LA-0's acceptance criteria are about the application's behaviour, and they cannot be
   demonstrated against a database that is missing four fifths of what the app calls.

2. **Apply `20260911120000_auth_user_bridge_name_fix.sql`**, plus `0000_baseline.sql` if going the
   (a) route. Symptom 1 is a live product defect regardless of which option is chosen — user
   creation is broken for real users, not only for fixtures.

3. `npm run verify:rpc-contract` — should reach 0 missing before anything else is trusted.

4. `npm run verify:la0` then `npm test`. 19 blocked criteria are expected to turn green.

5. Re-run `npm run verify:entitlements`. Its 4 failures are explained by symptom 2b — `plans` and
   `subscriptions` do not exist, so no subscription status can be resolved. Re-judge only once the
   SA plane is present.

6. Build the LA-0.3 load-time harness. No number has ever been recorded against the 1-second
   budget.

7. Settle the two criteria that are not buildable as written — LA-0.2 criterion 3 and LA-0.4
   criterion 2 both need a ledger that returns rows. See `LA-0-NOTION-DELTA.md`.

8. The Supabase security-advisor remediation plan. Deliberately not started: every LA-0 criterion
   it touches is blocked upstream, so it would be planning against ground that is about to move.

---

## Honest summary

Things are not going great, and the previous audit's six `PARTIAL` verdicts understated it. But
the news is better than it looks: **almost none of the problem is in the application.** The LA-0
code is in good shape — the guards are real, the permission model genuinely hides money, the
commission maths is integer-clean and effective-dated, the eligibility logic has exactly one
implementation, and the dedupe scoring is sound.

What was missing was the ability to *prove* any of it, because the proof ran against a database
this application does not fit. That was invisible because nothing checked it. Now something does.
