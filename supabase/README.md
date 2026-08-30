# Database migrations

**The rule: a schema change is a file in `migrations/`, committed alongside the code that uses it.
Never applied only to the live project.**

## Why this directory exists, and why it starts at 0001

It doesn't contain the whole schema. Everything built before SA-4.1 — every table, view, RLS
policy, grant, `REVOKE`, and all ~35 functions — was applied straight to the Supabase project and
exists nowhere else. That is [`docs/backlog.md` #29](../docs/backlog.md), and it is still open.

Three consequences, in the order they will hurt:

1. **A fresh clone cannot run.** The TypeScript here is a client of a schema it does not contain.
2. **The security-critical half has never been reviewed.** The `REVOKE`s that make `audit_log` and
   `usage_events` append-only, and the `tenant_app` `NOBYPASSRLS` role that makes tenant isolation
   real rather than application-layer, have never appeared in a diff.
3. **There is no rollback.** No record of what a migration changed means nothing to revert.

SA-3 has since added `invoices`, `payments`, `credit_notes`, `coupons` and `metrics_daily` — the
financial tables — under the same conditions.

## Closing the gap

The live database **does** have a `supabase_migrations` schema (a connection as `tenant_app` is
refused with *permission denied for schema supabase_migrations*, which proves it is there rather
than absent). If the earlier work was applied through tooling that records into it, the backfill is
an export rather than a hand-written reconstruction:

```bash
supabase db pull
```

Verify whatever comes out by replaying it into a scratch project from empty and running
`npm run verify:tenant-isolation` and `npm run verify:entitlements` against the result. Both must
pass on the replayed schema, not just on the original.

## Naming

`NNNN_short_description.sql`, four digits, sequential. One logical change per file.

Files are forward-only. To undo something, write the next migration.
