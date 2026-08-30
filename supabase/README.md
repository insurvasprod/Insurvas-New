# Database migrations

**The rule: a schema change is a file in `migrations/`, committed alongside the code that uses it.
Never applied only to the live project.**

## Why this directory used to start at 0001

It didn't contain the whole schema. Everything built before SA-4.1 — every table, view, RLS policy,
grant, `REVOKE`, and all the functions — had been applied straight to the Supabase project and
existed nowhere else. That was [`docs/backlog.md` #29](../docs/backlog.md).

`0000_baseline.sql` closes it. The file is generated, not hand-written:

```bash
node --env-file=.env.local scripts/dump-schema.mjs
```

`supabase db pull` would have been the obvious tool and could not be used: the only credential this
repository holds is `TENANT_DB_URL`, whose role is deliberately `NOBYPASSRLS` with no DDL rights,
and the Supabase CLI wants an owner connection. Catalog reads are open to every role, so the dump
reconstructs the schema from `pg_class`, `pg_attribute`, `pg_constraint`, `pg_policies` and friends
instead. It skips anything the numbered migrations already create, so `0000` and `0001+` compose
rather than collide.

What it recovered: **45 tables, 23 enums, 57 indexes, 5 views, 47 functions, 61 foreign keys, 3
policies, and the grant/revoke state of 50 tables.**

### The three sections that matter more than the tables

**Roles.** `tenant_app` is created here. Nothing in the repository created it before — it was made
by hand in the dashboard, so a fresh database had no such role and the app's own connection string
pointed at nothing. It is `NOBYPASSRLS`, which is the only reason the policies below have any
effect. `service_role` bypasses RLS entirely, so anything reached with the service key is
unprotected by definition and must go through the admin plane. No password is emitted; set one out
of band and put it in `TENANT_DB_URL`.

**Row level security.** All 45 tables have RLS enabled. Only three carry policies — `tenants`,
`tenant_users` and `users`, each scoped by the `app.tenant_id` session setting. The other 42 are
RLS-enabled with *no* policy, which is deny-all for any role that does not bypass. That is the
design, not an omission: the agent app reaches exactly three tables directly and everything else
through the admin plane.

**Grants.** Emitted as `REVOKE ALL` followed by exactly the grants the live database has. The
revoke is the point. `audit_log` is append-only because it has `INSERT` and `SELECT` and no
`UPDATE` or `DELETE` — a property that lives in the grant table, not in a trigger. An additive
restore would hand those back and nobody would notice.

## Reference data

`0016_reference_data.sql` seeds `feature_modules` (9), `features` (27) and `meters` (6).

These are a contract with the source tree rather than customer data: `scripts/check-feature-keys.mjs`
asserts that every feature key named in TypeScript has a row, so an empty table is a failing check
rather than an empty screen. Regenerate with:

```bash
node --env-file=.env.local scripts/dump-reference-data.mjs
```

Plans, prices and coupons are deliberately **not** seeded. They are commercial decisions that
legitimately differ between a developer's database and production, and they are created through the
admin UI.

## Checking a migration before it runs

```bash
node --env-file=.env.local scripts/check-migrations.mjs
```

This parse-checks every file against a real PostgreSQL server without changing anything, and it
works despite the connection having no DDL rights — because Postgres parses and analyses a statement
*before* it checks permissions, so the two failures have different SQLSTATEs:

| Code    | Meaning                | Verdict                          |
| ------- | ---------------------- | -------------------------------- |
| `42601` | syntax error           | a real failure                   |
| `42P01` | undefined table        | wrong order, or a typo           |
| `42704` | undefined object       | missing type or role             |
| `42501` | insufficient privilege | parsed and analysed fine — good  |

Every statement runs inside a savepoint that is rolled back immediately, and the whole run is
wrapped in a transaction that is rolled back at the end. Nothing is ever committed.

**What this does not prove:** that the migrations produce the right schema when actually applied.
Only replaying them into an empty scratch database with an owner connection proves that, and then
running `npm run verify:tenant-isolation` and `npm run verify:entitlements` against the
result — both must pass on the replayed schema, not just on the original. That replay has not been
done. It is the one step still owed on #29.

## Running the database suites in CI

`.github/workflows/ci.yml` has a `database` job that runs all twenty suites plus the cross-process
kill-switch check. It skips itself with a notice when the repository has no credentials configured.
To enable it, set these repository secrets:

| Secret                              | From                                       |
| ----------------------------------- | ------------------------------------------ |
| `CI_SUPABASE_URL`                   | `NEXT_PUBLIC_SUPABASE_URL`                 |
| `CI_SUPABASE_SERVICE_ROLE_KEY`      | `SUPABASE_SERVICE_ROLE_KEY`                |
| `CI_TENANT_DB_URL`                  | `TENANT_DB_URL`                            |
| `CI_ADMIN_SESSION_SECRET`           | `ADMIN_SESSION_SECRET`                     |
| `CI_TENANT_SESSION_SECRET`          | `TENANT_SESSION_SECRET`                    |
| `CI_COMPLIANCE_VENDOR_ENCRYPTION_KEY` | `COMPLIANCE_VENDOR_ENCRYPTION_KEY`       |
| `CI_WHOP_*`                         | the four Whop values                       |

**Point these at a dedicated database, not production.** The suites create tenants, subscriptions
and invoices and clean up after themselves; a failure mid-run leaves rows behind.

## Naming

`NNNN_short_description.sql`, four digits, sequential. One logical change per file.

Files are forward-only. To undo something, write the next migration.
