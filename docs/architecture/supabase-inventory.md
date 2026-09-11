# Supabase inventory — live project

Collected: 2026-09-11 by `npm run qa:inventory`, catalog reads only through `TENANT_DB_URL`
(`tenant_app`: not superuser, `NOBYPASSRLS`, no `CREATE` on `private`, owns nothing in `public`).
Regenerate with:

```bash
npm run qa:inventory -- --out inventory.json
```

The project reference, connection string and keys are deliberately absent from this document.

## Totals

| Object | Count |
|---|---|
| Tables in `public` | 308 |
| Views and materialized views | 13 |
| Functions in `public`, excluding extension-owned | 135 |
| Foreign keys | see `inventory.json` |
| Triggers on `public` and `auth` | see `inventory.json` |
| Extensions installed in `public` | 2 (`btree_gist`, `pg_trgm`) |

308 tables is far more than this application uses. The project hosts **two generations of the
product at once**: the tenant-era SaaS in this repository, and an organizations-era CRM that is
live and in use. The evidence is in the function inventory below.

## The application-to-database contract

`npm run verify:rpc-contract` measures it directly:

| Measure | Count |
|---|---|
| RPCs this application calls | 131 |
| Present in the database | **27** |
| **Missing** | **104** |
| Application functions in the database this app never calls | 106 |

Those 106 are not dead code. They are a coherent other product: `outbound_can_dial_now`,
`outbound_set_agent_campaigns`, `reserve_organization_seat`, `consume_organization_usage`,
`get_next_legacy_lead`, `assign_lead`, `approve_commission`, `resolve_agent_commission`,
`transition_insurance_policy`, `transition_talent_candidate`, `hr_generate_slug`,
`chat_sidebar_state`.

A `supabase.rpc("x")` against a function that does not exist is not a compile, type or lint error —
`lib/supabase/database.types.ts` is hand-maintained and can declare a function nobody created. It is
a runtime 500. `verify:rpc-contract` is the guard; run it before trusting any other result.

## Tables this application needs

Checked against `pg_class`. 20 present, 29 absent.

### Present (20)

The complete LA-0 set, plus the identity and audit spine:

`tenants` · `tenant_users` · `tenant_entitlements` · `contacts` · `households` · `appointments` ·
`licenses` · `eo_policies` · `ce_records` · `field_schema` · `merge_log` · `tenant_carriers` ·
`commission_schedules` · `advance_rules` · `users` · `organizations` · `admin_users` · `audit_log` ·
`platform_audit_events` · `invoices`

Row counts (service role, RLS bypassed): `tenants` 6 · `tenant_users` 14 ·
`tenant_entitlements` 6 · `users` 21 · `contacts` 3 · `invoices` 0 · `admin_users` 3 active.

### Absent (29)

Essentially the whole SA plane:

`plans` · `plan_versions` · `plan_features` · `plan_limits` · `plan_prices` · `subscriptions` ·
`payments` · `coupons` · `credit_notes` · `meters` · `usage_events` · `usage_totals` · `features` ·
`feature_modules` · `addons` · `legal_documents` · `legal_acceptances` · `email_log` · `settings` ·
`checkout_sessions` · `webhook_events` · `whop_plans` · `business_profiles` · `template_fields` ·
`tenant_products` · `tenant_credits` · `form_drafts` · `affiliate_links` · `buffer_handoffs`

Also absent and referenced directly by failing admin routes: `admin_user_list`, `credit_packs`,
`compliance_vendors`.

**Note on `settings`:** `/api/admin/settings` returns 7 live rows despite `public.settings` being
absent, so that route reads a differently-named table. The SA-4.1 settings store works; the name in
`database.types.ts` does not match the deployed one. Worth reconciling.

## The auth bridge

`public.users`:

- `id` — no default, `NOT NULL`, foreign key `users_id_fkey` → `auth.users`
- `name` — `NOT NULL`, no default
- also carries legacy `users_role_id_fkey` → `roles`, `users_organization_id_fkey`,
  `users_team_id_fkey`, `users_call_center_id_fkey` from the organizations era

Trigger `on_auth_user_created` → `private.handle_new_auth_user()` inserts `id`, `email`,
`full_name`, `display_name`, `status`, `active` — **but never `name`**. Every insert into
`auth.users` therefore raises `23502`, surfaced by Supabase Auth as *"Database error creating new
user"*. No user can be created by any path: signup, invitation acceptance, `auth.admin.createUser`,
or a test fixture.

Fix written and parsing but **not applied**:
`supabase/migrations/20260911120000_auth_user_bridge_name_fix.sql`. Applying it needs DDL access,
which no credential in this repository has, by design.

## Migration chain

| Check | Result |
|---|---|
| `npm run db:check` (parse each file) | **Pass** |
| `npm run db:check:deep` (replay in order) | **Fail — 155 problems** |

`0000_baseline.sql` is a 445-statement generated dump intended to close backlog #29, and it reports
59 problems on replay: it references `payments`, `subscriptions`, `plans`, `provider_settings`,
`usage_events` and `legal_documents` in indexes and views it never creates. It was generated from a
database that already lacked them, so regenerating it with `npm run db:dump` will not help.

**Consequence:** the repository cannot currently provision a working database from its own
migrations. Closing that gap means authoring the SA-0 – SA-3 schema as committed migrations — which
is the same work as the SA-1, SA-2 and SA-3 tasks themselves.

## Security posture

See `docs/architecture/security.md`. Headline: 0 tables with RLS disabled, 0 tables granted to
`anon` or `authenticated`, 0 mutable-`search_path` functions, and 6 `SECURITY DEFINER` functions
executable by `PUBLIC` that need review.
