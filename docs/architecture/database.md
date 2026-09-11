# Database architecture and the schema decision

Updated: 2026-09-11, from the SA-0.1 – SA-5.5 recheck.
Companion documents: `supabase-inventory.md` (what is there), `security.md` (how it is protected),
`../qa/LA-0-BLOCKERS.md` (how the gap was found), `task-traceability.md` (what it costs per task).

## The situation, stated plainly

The configured Supabase project hosts **two generations of the product on one database**:

- the **organizations-era CRM** — live, in use, ~308 tables, with its own outbound dialing, HR and
  talent, insurance-policy and commission modules; and
- the **tenant-era SaaS** in this repository, which was grafted on through the LA-0 compatibility
  bridge.

The bridge covered the LA-0 slice only. That is why all 14 LA-0 tables are present and 29 of the
tables the SA plane needs are not, and why 104 of 131 RPCs the application calls do not exist.

It also drifted in both directions: the database already contains `tenant_invite_user` and
`tenant_update_member_role` — exactly what LA-0.2's invitation and role-change criteria need — and
the application calls neither.

## The decision

Three options were put to the product owner on 2026-09-11. **Option (b) was chosen: provision a
project from this repository's migrations.**

| Option | Shape | Cost |
|---|---|---|
| (a) Complete the bridge | Write ~104 compatibility shims over the organizations schema | Largest ongoing effort; the bridge has already drifted once |
| **(b) Provision from migrations** ← chosen | Build a database from this repo, point `.env.local` at it | Cleanest for proving SA and LA-0; requires closing the migration gap first |
| (c) Converge | Migrate the organizations CRM onto the tenant model | Largest blast radius; touches a live product |

Option (b) leaves the production question open deliberately. It does not migrate or endanger the
live CRM; it gives this application a database that matches it.

## What option (b) requires

`npm run db:check:deep` reports **155 problems**. The repository cannot build a working database
from its own migrations today.

The gap is the SA-0 through SA-3 schema. Per backlog #29 the numbered migrations start at SA-4.1,
and everything the earlier modules built has only ever existed inside a live database.
`0000_baseline.sql` was meant to close this — it is a 445-statement generated dump — but it reports
59 of those 155 problems itself, because it references `payments`, `subscriptions`, `plans`,
`provider_settings`, `usage_events` and `legal_documents` in indexes and views it never creates. It
was generated from a database that already lacked them, so `npm run db:dump` cannot rescue it.

**Therefore the missing schema has to be authored, not dumped.** Approximately 29 tables plus their
constraints, indexes, policies and the ~104 functions.

### This is the SA work, not a detour

The tables that have to be authored map one-to-one onto the SA tasks:

| Migration work | Tasks it completes |
|---|---|
| `features`, `feature_modules` | SA-2.1 |
| `plans`, `plan_versions`, `plan_features`, `plan_prices`, `plan_limits`, `addons` | SA-2.2 – SA-2.6 |
| `subscriptions`, `subscription_addons`, `subscription_coupons` | SA-2.7 |
| entitlement rebuild from the above | SA-2.8 — gives `tenant_entitlements` the producer it currently lacks |
| `admin_user_list` and the `admin_*` user RPCs | SA-1.1 – SA-1.5 |
| `payments`, `coupons`, `credit_notes`, invoice generation | SA-3.2 – SA-3.9 |
| `settings` name reconciliation, `template_fields`, `credit_packs`, `compliance_vendors`, `email_log` | SA-4.4, 4.6, 4.8, 4.9, 4.11 |
| `checkout_sessions`, `legal_documents`, `legal_acceptances`, `trial_reminders` | SA-5.1 – SA-5.4 |

Authoring SA-2.x first is the highest-leverage start: it is the deepest dependency, and it turns
the LA-0 entitlement cache from an orphan into a produced artifact — which unblocks LA-0.1
criterion 5 as a side effect.

## Invariants to preserve when building the new schema

Carried forward from the SA-00 build plan and from what the live LA-0 bridge already gets right:

- **Money is integer cents. Rates are integer basis points.** Enforced today in
  `lib/carriers/resolve.ts`, which rejects non-integer basis points at runtime.
- **Issued invoices are immutable.** Corrections are credit notes.
- **Append-only audit.** `prevent_platform_audit_mutation` is deployed and should be reproduced.
- **The entitlement object is the whole contract.** The agent app reads one cached JSON blob and
  never queries a plan, subscription or price. `tenant_entitlements` already has this shape.
- **Suspension preserves read access** to the customer's own book of business.
- **Kill switches are evaluated before entitlements**, and produce a different code so the client
  shows a maintenance notice rather than an upgrade prompt. Implemented in
  `lib/entitlements/requireFeature.ts`; keep it.
- **RLS on every table, and no grants to `anon` or `authenticated`.** The live project currently
  satisfies both (0 RLS-disabled tables, 0 client grants) — that invariant is worth an explicit
  test so it cannot regress.
- **Tenant scope comes from the session, never a request parameter.** Asserted by
  `lib/menu/planBranching.test.mjs` across all 82 agent routes.

## Known blocker on the current project

`public.users.name` is `NOT NULL` with no default, and the auth bridge trigger
`private.handle_new_auth_user()` never populates it, so no user can be created by any path. Fix
written at `supabase/migrations/20260911120000_auth_user_bridge_name_fix.sql`; not applied, because
no credential in this repository has DDL rights. This blocks the `support_agent` and
`billing_admin` fixtures the SA role matrix needs, and it blocks signup and invitation acceptance
for real users.
