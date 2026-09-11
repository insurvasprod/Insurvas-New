# What the SA module needs to be complete

Derived from the 2026-09-11 SA-0.1 – SA-5.5 recheck. Evidence: `task-traceability.md`,
`supabase-inventory.md`, `security.md`, `../qa/LA-0-BLOCKERS.md`.

Current state: **5 Pass · 7 Partial · 27 Database-misaligned · 1 Browser-unverified · 1 Deferred ·
1 Cancelled · 1 N/A** out of 43 in-range tasks.

Almost none of this is application code. The code for these tasks largely exists; what is missing is
the database it was written against. The work below is therefore mostly **authoring schema as
committed migrations**, not building screens.

---

## Gate 0 — three blockers that gate everything else

Nothing downstream can be verified until these clear.

| # | Item | Why it blocks | Who |
|---|---|---|---|
| 0.1 | **Apply `supabase/migrations/20260911120000_auth_user_bridge_name_fix.sql`** | `public.users.name` is `NOT NULL` with no default and `private.handle_new_auth_user()` never sets it, so every `auth.users` insert raises 23502. No user can be created by signup, invitation, `auth.admin.createUser`, or a fixture. | Needs DDL access. No credential in this repo has it, by design |
| 0.2 | **Decide and execute the schema provisioning** | The repo cannot build a database from its own migrations (`db:check:deep`: 155 problems; `0000_baseline.sql` contributes 59 of them by referencing `payments`, `subscriptions`, `plans`, `provider_settings`, `usage_events`, `legal_documents` in indexes and views it never creates). Option (b) — provision from migrations — was chosen, which means the schema below must be **authored, not dumped**. `npm run db:dump` cannot help: it was generated from a database that already lacked these objects | Engineering |
| 0.3 | **Create `support_agent` and `billing_admin` fixtures** | `admin_users` holds 2 × `super_admin`, 1 × `platform_config`. Two of the four admin roles have never been exercised against the live authorization matrix. Blocked by 0.1 | Engineering, after 0.1 |

---

## SA-0 — Foundation

| Task | Needs |
|---|---|
| SA-0.1 | **Exercise mandatory TOTP end to end** (sessions were minted, never logged in through). Verify session expiry. Complete the role matrix once 0.3 lands |
| SA-0.2 | **`create_tenant_with_owner`** — absent, so no tenant can be provisioned |
| SA-0.3 | ✅ **Pass.** No work |
| SA-0.4 | Backlog by plan. Fold the hardening items from `security.md` into it |

---

## SA-1 — User administration (5 tasks, all blocked on the same objects)

**View/table:** `admin_user_list`

**Functions:** `admin_create_user` · `admin_update_user_with_email_change` · `admin_set_user_status`
· `admin_replace_user_token` · `admin_user_stats` · `admin_login_activity_stats`

Note the database already contains `admin_create_user_projection`, `admin_set_user_state`,
`admin_update_user_profile` and `platform_login_activity_summary` — the organizations-era
equivalents, which the app does not call. Reconcile rather than duplicate where the shape fits.

| Task | Unblocked by |
|---|---|
| SA-1.1 Users list, search & counts | `admin_user_list`, `admin_user_stats` |
| SA-1.2 Create user | `admin_create_user` + gate 0.1 |
| SA-1.3 Edit user & change role | `admin_update_user_with_email_change` |
| SA-1.4 User state lifecycle | `admin_set_user_status` |
| SA-1.5 Login activity | `admin_login_activity_stats` (capture path already works — 40 live events) |

---

## SA-2 — Subscription management (8 tasks) ← **start here**

The deepest dependency in the whole product, and the one that unblocks the most. Completing it also
gives `tenant_entitlements` the producer it currently lacks, which resolves LA-0.1 criterion 5 as a
side effect.

**Tables:** ~~`features`~~ · ~~`feature_modules`~~ · ~~`plans`~~ · `plan_features` · `plan_limits` ·
`plan_prices` · `plan_available_addons` · `plan_meters` · `plan_product_access` · `addons` ·
`addon_features` · `addon_meters` · `meters` · `meter_pricing` · ~~`subscriptions`~~ ·
`subscription_addons` · `subscription_coupons` · `usage_events` · `usage_totals`

**View:** ~~`admin_plan_list`~~

**Correction:** an earlier draft of this list named a **`plan_versions`** table. There is no such
table and nothing in the codebase references one. Versioning lives on `plans` itself as
`(code, version)` rows — `fetchPlanVersions()` selects every row sharing a code and
`admin_plan_list` collapses them to the latest per code.

**Done 2026-09-11** (struck through above): `20260911130000_sa_2_1_feature_catalog.sql` and
`20260911131000_sa_2_2_plans.sql`. `subscriptions` was created as the table only, because
`admin_plan_list` cannot count subscribers without it; its operations remain SA-2.7. Both
migrations parse; **neither has been applied** — that still needs gate 0.1/0.2.

**Functions:** `admin_update_plan` · `admin_create_plan_version` · `admin_save_plan_version` ·
`admin_save_plan_limits` · `admin_assign_subscription` · `admin_change_subscription_plan` ·
`admin_cancel_subscription` · `admin_set_subscription_pause_state` · `admin_attach_addon` ·
`admin_detach_addon_for_subscription` · `check_meter_capacity` · `record_usage` ·
`rebuild_usage_totals` · `admin_usage_monitor` · `tenant_current_plan` ·
`tenant_current_period_start` · `tenant_seats_used`

| Task | Specific need |
|---|---|
| SA-2.1 Feature catalog | `features`, `feature_modules`. **Also fix the silent-empty route** — `/api/admin/features` returns `200 {groups: []}` with the table absent, so a broken catalog reads as an empty one |
| SA-2.2 Plan CRUD + plan type | `plans`, `plan_versions`, `admin_plan_list`, `admin_update_plan` |
| SA-2.3 Feature picker | `plan_features` |
| SA-2.4 Pricing & billing cycle | `plan_prices` — integer cents only |
| SA-2.5 Limits & metered credits | `plan_limits`, `meters`, `meter_pricing`, `usage_events`, `usage_totals`, `check_meter_capacity`, `record_usage` |
| SA-2.6 Add-ons | `addons`, `addon_features`, `addon_meters`, `plan_available_addons`, `subscription_addons` |
| SA-2.7 Assign / change / cancel subscription | `subscriptions` + the four `admin_*_subscription` functions |
| SA-2.8 Entitlement engine | The rebuild that writes `tenant_entitlements` from plan + subscription. The cache and its consumers already work; only the producer is missing |

---

## SA-3 — Billing & payments (9 tasks, 1 cancelled)

**Tables:** `payments` · `coupons` · `subscription_coupons` · `credit_notes` · `webhook_events` ·
`whop_plans` · `provider_settings`
(`invoices` already exists, 0 rows.)

**Functions:** `create_invoice_for_payment` · `create_invoice_for_payment_with_coupon` ·
`create_custom_invoice` · `bill_subscription_period` · `advance_billing_periods` ·
`mark_overdue_invoices` · `admin_settle_invoice_manually` · `admin_apply_coupon` ·
`consume_coupon_period` · `request_credit_note` · `claim_credit_note_refund` ·
`finish_credit_note_refund` · `fail_credit_note_refund` · `mark_credit_note_provider_pending` ·
`apply_credit_note_balance` · `compute_metrics_for_date`

| Task | Specific need |
|---|---|
| SA-3.1 Payment provider adapter | Partial — sandbox status endpoint works, secrets fingerprinted. Exercise the adapter itself |
| SA-3.2 Invoice generation | `create_invoice_for_payment_with_coupon`, `bill_subscription_period` |
| SA-3.3 Invoice screens | Browser-unverified only. Verify the populated state once an invoice can exist |
| SA-3.4 Record payment → auto-activate | `payments` |
| SA-3.5 Dunning ladder | **Cancelled in Notion.** No work |
| SA-3.6 Discounts & coupons | `coupons`, `subscription_coupons`, `admin_apply_coupon`, `consume_coupon_period` |
| SA-3.7 Custom / manual invoice | `create_custom_invoice` |
| SA-3.8 Refunds & credit notes | `credit_notes` + all six credit-note functions. Keep the ">$500 needs a second approver, never self-approve" rule |
| SA-3.9 Revenue dashboard | `compute_metrics_for_date`; depends on `subscriptions` and `payments` |

Invariants to honour: issued invoices immutable (corrections are credit notes); money in integer
cents; financial records survive a deletion request (anonymised, not purged).

---

## SA-4 — Configuration (12 tasks, 4 already passing)

**Tables:** `template_fields` · `tenant_products` · `tenant_credits` · `credit_packs` ·
`compliance_vendors` · `email_log` · `form_drafts` · `stage_dispositions`

**Functions:** `admin_save_template` · `admin_duplicate_template` · `admin_apply_tenant_template` ·
`admin_update_tenant_template` · `apply_auto_offer_to_subscription` · `purchase_credit_pack` ·
`adjust_tenant_credit` · `prune_email_log` · `set_tenant_product` · `set_partner_product_approval`

| Task | Specific need |
|---|---|
| SA-4.1 Settings store | ✅ **Pass** — but **reconcile the table name**: `/api/admin/settings` returns 7 live rows while `public.settings` is absent, so the route reads a differently-named table than `database.types.ts` declares |
| SA-4.2 Provider config screen | Partial — exercise the failure simulator |
| SA-4.3 Configuration Center hub | Partial — several linked sections are themselves 500 (offers, credits, compliance) |
| SA-4.4 Offers & promotion rules | Offers backing tables, `apply_auto_offer_to_subscription` |
| SA-4.5 Product catalog | ✅ **Pass.** No work |
| SA-4.6 Product templates | `template_fields`, `admin_save_template`, `admin_duplicate_template` — template currently readable but not editable |
| SA-4.7 Agent template selection | `admin_apply_tenant_template`, `admin_update_tenant_template`. Templates are **copied, not linked** |
| SA-4.8 Compliance vendor sources | `compliance_vendors`. Keep "all vendors off ⇒ dialing blocked, no exceptions" |
| SA-4.9 Credit packs & usage monitor | `credit_packs`, `tenant_credits`, `purchase_credit_pack`, `adjust_tenant_credit` |
| SA-4.10 Kill switches | ✅ **Pass.** No work |
| SA-4.11 Email configuration | `email_log`, `prune_email_log`. Do not enable real sending during QA |
| SA-4.12 Maintenance & announcements | ✅ **Pass.** No work |

---

## SA-5 — Signup & trial (4 tasks)

**Tables:** `checkout_sessions` · `signup_selections` · `business_profiles` · `legal_documents` ·
`legal_acceptances` · `trial_reminders`
**View:** `current_legal_documents`

**Functions:** `self_serve_signup` · `self_serve_signup_with_subscription` · `claim_rate_limit` ·
`complete_signup_email_verification` · `refresh_signup_verification` ·
`save_signup_business_profile` · `create_subscription_from_checkout` · `extend_trial` ·
`publish_legal_document` · `clear_reacceptance_requirement` · `record_legal_acceptance` ·
`outstanding_legal_documents`

| Task | Specific need |
|---|---|
| SA-5.1 Pricing page & self-serve signup | The three signup functions + gate 0.1. Keep "login must not reveal whether an email exists" |
| SA-5.2 Hosted checkout & trial start | `checkout_sessions`, `signup_selections`, `create_subscription_from_checkout`. Card required at signup, charged on day 15; checkout hosted by the provider — no card field in this codebase |
| SA-5.3 Trial management | `trial_reminders`, `extend_trial` |
| SA-5.4 Terms & privacy acceptance | `legal_documents`, `legal_acceptances`, `current_legal_documents` |
| SA-5.5 | **N/A — does not exist.** M5 is SA-5.1–5.4 |

---

## SA-6 — Ops & safety (out of the requested range, all `Planned`)

SA-6.1 background job monitor · SA-6.2 rate limiting (`claim_rate_limit` is already called by
signup and absent) · SA-6.3 data export & account deletion.

The SA-00 plan flags one resequencing worth taking: **SA-6.1 guards work that goes live in M3.**
Invoicing and dunning are cron jobs; a silent failure means nobody is billed and nobody notices for
a month. Consider pulling it next to SA-3.2.

---

## Cross-cutting fixes (independent of the schema work)

| # | Item | Source |
|---|---|---|
| C1 | **Review and revoke the 6 `PUBLIC`-executable `SECURITY DEFINER` functions** — `initialize_verification_items`, `update_verification_progress`, `set_partner_user_status`, `update_partner_status`, `outbound_enforce_agent_campaign`, `validate_outbound_provenance`. All have fixed `search_path`; four are state mutations and need an ownership check | `security.md` |
| C2 | **Stop swallowing error causes.** `/api/admin/users`, `/plans`, `/subscriptions`, `/offers` return only `"Could not load X"`. `credits-limits` and `compliance-vendors` name the real cause — match them | matrix probe |
| C3 | **Fix the silent-empty features route** — a missing catalog must not render as an empty one | matrix probe |
| C4 | **Mobile: the fixed bottom-left user badge overlaps content** — covered "Admins by role" on the dashboard and the "Catalog" row in the open drawer at 375×812 | browser |
| C5 | **Pin the zero-grant invariant** with a test that fails if any `public` table gains an `anon`/`authenticated` grant while it has no policy. 54 tables are currently closed only because no grant exists | `security.md` |
| C6 | **Move `btree_gist` and `pg_trgm` out of `public`** at the next rebuild | `security.md` |
| C7 | **Keep `npm run verify:rpc-contract` green.** It is the guard that would have caught all of this: 131 RPCs called, 27 present | `supabase-inventory.md` |

---

## Suggested order

1. Gate 0.1 — apply the auth trigger migration
2. Gate 0.2 — decide how the schema gets provisioned, then author **SA-2** first
3. Gate 0.3 + C1 — role fixtures and the definer lockdown
4. SA-1 → SA-3 → SA-4 remainder → SA-5
5. C2–C7 alongside, none of them blocking
6. Re-run `verify:rpc-contract`, `qa:sa-matrix`, `qa:inventory`, `npm test`, and rewrite
   `task-traceability.md` from the new evidence

Sequencing note: SA-2 before SA-1. SA-1's screens are cheaper, but SA-2 is what unblocks the
entitlement producer, the agent app's plan enforcement, and every M3 task.
