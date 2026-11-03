# Super Admin SA-6 QA Audit

Updated: 2026-09-14

This audit uses the current task records as the authority. The current inventory defines SA-6.1,
SA-6.2, and SA-6.3. No SA-6.4 task is defined in the task records, repository inventory, or current
traceability document, so no SA-6.4 implementation or acceptance claim is invented.

## Current criterion status

| Task | Status | Evidence | Remaining acceptance gap |
|---|---|---|---|
| SA-6.1 Background job monitor & failure alerts | Partial | Existing period-billing and unclaimed-SLA heartbeat paths remain available; generic job-run monitor, schedule registry, run-now authorization, 90-day retention, and alert delivery are not implemented as one contract. | Requires the six-job scheduler contract, failure/missed-heartbeat alert delivery, idempotency proof for every job, and an authenticated operator browser review. |
| SA-6.2 Rate limiting & brute-force protection | Partial — local implementation verified | Admin and tenant login now run database-backed email+IP limits before credential lookup, return generic 429 plus `Retry-After`, record persistent failed-login counters, clear counters on success, and expose a super-admin-only unlock screen with audit logging. `npm.cmd run verify:sa6-2` passed; the focused suite is 506/506; typecheck and lint pass. | The current acceptance still needs password-reset and verification-resend endpoint replay coverage, configuration coverage for every public/authenticated API rule, and deployment/browser proof of the settings and unlock paths. |
| SA-6.3 Data export & account deletion | Not built | No safe export/deletion request, hold/cancel, purge, anonymisation, certificate, or retention contract was present in the current repository inventory. | Requires a reviewed tenant-table/storage inventory, background export/purge workers, legal retention decisions, and a disposable tenant fixture before any destructive implementation or proof. |
| SA-6.4 | N/A | No current task definition found. | Do not invent scope. |

## SA-6.2 implementation review

- `lib/authProtection/index.ts` enforces the login budget before `admin_users`, `users`, or
  Supabase Auth credential verification. Email and IP buckets are separate and include the actor
  plane in their key.
- Failed-login state is persisted in the existing `rate_limits` table, so it survives process and
  serverless-instance restarts without requiring a new DDL migration. Successful authentication
  clears the matching failure bucket.
- The login response remains `Invalid email or password` for the rate-limited path, and the 429
  response carries `Retry-After` and `Cache-Control: no-store`.
- `/api/admin/security/rate-limits` is restricted to `super_admin`; clearing a counter deletes the
  exact bucket and writes `security.login_unlocked` to the append-only audit log.
- Advanced settings expose bounded, database-overridable security values. Missing override rows
  use coded defaults, and the settings form now falls back to those defaults if a stale server
  response omits a newly registered key.
- Password-reset and verification-resend paths consume their configurable settings. Public plans
  and legacy signup use configurable request caps with `Retry-After` responses.

## Verification record

| Check | Result |
|---|---|
| `npm.cmd test` | 506 passed, 0 failed |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run lint` | Pass |
| `npm.cmd run verify:sa6-2` | Pass: five generic credential responses, sixth/seventh 429, `Retry-After`, persistent counters |
| Authenticated browser | A fresh Super Admin `/admin/advanced` tab rendered all eight implemented Security controls and the Login protection empty state with no browser console errors. The browser input bridge did not expose or accept the value for the password-reset-labeled control; its coded default remains verified by the registry/tests, so interactive browser proof for that one control stays open. |
| Live DDL | No new SA-6.2 migration is required for the current implementation. The configured database role cannot apply arbitrary DDL; existing unrelated migration-audit failures remain unchanged. |

SA-6.2 is therefore implemented and locally/endpoint verified, but it is not promoted to a blanket
production acceptance claim until the remaining endpoint matrix and deployment-level evidence are
available. SA-6.1 and SA-6.3 remain open because their safe acceptance requires additional durable
contracts and external decisions, not because a local-only UI placeholder was treated as complete.
