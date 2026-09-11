# Security posture — live project

Collected: 2026-09-11 via `npm run qa:inventory` (catalog reads only, through the deliberately
unprivileged `TENANT_DB_URL` role) plus the read-only admin surface matrix `npm run qa:sa-matrix`.
No secret, key or project reference appears in this document.

## Summary

| Check | Result |
|---|---|
| Tables with RLS disabled | **0** |
| Tables with RLS enabled but no policy | 54 |
| Tables granted to `anon` | **0** |
| Tables granted to `authenticated` | **0** |
| `SECURITY DEFINER` functions executable by a client role | **6** |
| `SECURITY DEFINER` functions with a mutable `search_path` | **0** |
| Extensions installed in `public` | 2 (`btree_gist`, `pg_trgm`) |
| Anonymous access to a protected admin surface | **0 of 62 probed** |

The posture is materially better than the earlier revision of this document described. Three of
its findings have been remediated and one was overstated.

## Corrections to the previous revision

- It reported **RLS disabled on `platform_outbox_events`**. Fixed — no table in `public` now has
  RLS disabled.
- It reported **28 `anon`-executable and 43 `authenticated`-executable security-definer
  functions**. Now 6, all granted to `PUBLIC`.
- It reported **six mutable-`search_path` functions**. Now zero.
- It reported **53 RLS-enabled tables with no policy** as a headline risk. The count is now 54, but
  the framing was misleading — see below.

## The 54 policy-less tables are closed, not open

A table with RLS enabled and no policy denies every row to any role subject to RLS. It becomes a
risk only if a client role also holds a grant on it. **No table in `public` is granted to `anon` or
`authenticated`** — both counts are zero. Client roles therefore cannot reach these tables by any
path, policy or not.

This is a defence-in-depth observation and a maintenance hazard (the day someone adds a grant, 54
tables become reachable at once), not a live exposure. It should be tracked, not treated as an
incident.

The list spans both product generations: `admin_users`, `audit_log`, `login_events`,
`payment_providers`, `platform_announcements`, `platform_billing_outbox` from this application, and
`outbound_*`, `calling_window_*`, `carrier_*` from the organizations-era CRM sharing the database.

## Finding 1 — six `SECURITY DEFINER` functions executable by `PUBLIC` (highest risk)

These run with the owner's privileges and bypass RLS by design, and every database role can call
them:

| Function | Belongs to |
|---|---|
| `initialize_verification_items` | verification workflow |
| `update_verification_progress` | verification workflow |
| `set_partner_user_status` | partner administration |
| `update_partner_status` | partner administration |
| `outbound_enforce_agent_campaign` | organizations-era outbound module |
| `validate_outbound_provenance` | organizations-era outbound module |

All six have a fixed `search_path`, which removes the classic hijack. The remaining question is
whether each validates the caller's right to the rows it touches — four of the six are named as
state mutations (`set_…`, `update_…`, `initialize_…`), which is the shape that matters.

**Recommended:** review each for a tenant/ownership check, then
`revoke execute … from public, anon, authenticated` and grant only to `service_role` unless a
client genuinely needs to call it. This mirrors what `20260903200000_la_1_security_and_rls_advisor_fix.sql`
already did for the LA-1 functions.

## Finding 2 — authorization boundary verified and holding

From 62 read-only probes across 6 sessions:

- Every protected admin API returned `401` to an anonymous caller; every protected screen
  redirected. The only anonymous `200` is `/admin/login`.
- A **tenant** session cookie returned `401` on every admin API — the planes do not interchange.
  Corroborated cryptographically: `lib/tenantAuth/sessionSeparation.test.mjs` proves the two planes
  sign with different secrets, so a cross-plane cookie fails signature verification rather than a
  name check.
- `platform_config` received `403` on all 13 customer and billing endpoints and `200` on the 7
  configuration endpoints. Least privilege is real here, not nominal.

## Finding 3 — two admin roles cannot be tested because they do not exist

`admin_users` holds 3 active rows: 2 × `super_admin`, 1 × `platform_config`. There is no
`support_agent` and no `billing_admin`. Their authorization behaviour is therefore **unverified**,
and cannot be verified until user creation works (see `docs/qa/LA-0-BLOCKERS.md`).

An untested role is not a safe role. Two of the four admin roles in `lib/adminAuth/roles.ts` have
never been exercised against the live authorization matrix.

## Finding 4 — error messages leak nothing, but also say nothing

`/api/admin/users`, `/plans`, `/subscriptions` and `/offers` return `{"error":"Could not load X"}`,
discarding the underlying cause. Good for disclosure; bad for operations — a missing table, a
permission fault and a network error are indistinguishable. `credits-limits` and
`compliance-vendors` return the real cause and are the better model for an admin-only surface.

## Finding 5 — secret handling is correct on the surfaces checked

`/api/admin/payments/status` returns the provider key fingerprinted (`••••<4 chars>`), reports
`webhookSecretPresent: true` without the value, and runs in `sandbox` mode. No real payment, email,
telephony, carrier or tax integration was enabled during this recheck.

## Finding 6 — extensions in `public`

`btree_gist` and `pg_trgm` are installed in `public`. Standard advisory finding, low severity;
moving them to a dedicated schema is a rebuild-time decision, not a live fix — `pg_trgm` backs the
LA-0.6 duplicate-detection index.

## Priority

1. Review and lock down the six `PUBLIC`-executable `SECURITY DEFINER` functions.
2. Create `support_agent` and `billing_admin` fixtures and complete the role matrix (blocked on
   user creation).
3. Preserve the zero-grant invariant deliberately — add a check that fails if any `public` table
   gains an `anon` or `authenticated` grant while it has no policy.
4. Give the four generic admin error paths the same cause-reporting as `credits-limits`.
5. Extensions out of `public` at the next rebuild.
