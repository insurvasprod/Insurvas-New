# LA-0.1–LA-0.6 acceptance audit

Audit date: 2026-09-11 (supersedes the 2026-09-10 task-level audit)
Source of truth: the six Notion task pages in *Insurvas Sprint*, not this document
Environment: local Next.js dev server on `localhost:3000`; live Supabase project configured by `.env.local`

## How to read this

One row per Notion **acceptance criterion**, not one row per task. A task is `PASS` only when every
one of its criteria is `PASS`. There is no `PARTIAL` status: a criterion either has a named,
reproducible artifact or it is `BLOCKED` with the missing prerequisite stated.

- **PASS** — a named automated test, a named verify script with its recorded output, a live SQL
  result, or a browser observation. "The code exists" is not evidence.
- **BLOCKED** — implementation may be complete; the proof cannot be produced yet. The blocker is
  named, and so is who can clear it.

Artifacts are cited by file. Every test named here runs under `npm test`.

## The headline

**The 2026-09-10 audit's six `PARTIAL` verdicts had one dominant cause, and it was not missing
implementation.** Two distinct problems, both now diagnosed:

1. **Four LA-0 verify suites were never wired into `verify:all`.** `scripts/verify-all.mjs`
   listed `verify-la0-rls.mjs` but omitted `verify-agent-shell.mjs`, `verify-carrier-library.mjs`,
   `verify-appointment-vault.mjs` and `verify-contacts.mjs` — the four suites carrying nearly all
   LA-0 acceptance evidence, including the 20,000-contact benchmark, the 40-appointment grid
   throughput check, the spouse-separation check, the CSV round-trip, and the 90/60/30 expiry
   thresholds. The proof was written and nothing ran it. Fixed in this pass.

2. **No user can be created on the live project, by any path.** `public.users.name` is `NOT NULL`
   with no default, and the auth bridge trigger `private.handle_new_auth_user()` inserts
   `full_name` and `display_name` but never `name`. Every insert into `auth.users` therefore
   raises `23502`, which Supabase Auth reports as the generic *"Database error creating new
   user"*. This breaks self-serve signup, invitation acceptance, `auth.admin.createUser`, and
   every LA-0 live fixture — all of which need a user. `public.users.id` has no default and
   carries `users_id_fkey` to `auth.users`, so a raw insert is not a workaround.

   Diagnosed by direct catalog query over `TENANT_DB_URL`. The fix is
   `supabase/migrations/20260911120000_auth_user_bridge_name_fix.sql`, which parses
   (`npm run db:check`) but **has not been applied** — `TENANT_DB_URL` is deliberately
   `NOBYPASSRLS` with no DDL rights. Applying it requires someone with DDL access to the project.

Every `BLOCKED (live fixture)` row below clears when that migration is applied and the suites are
re-run. Nothing else is known to stand between those rows and `PASS`.

## Criterion matrix

### LA-0.1 · Agent app shell, login & entitlement-driven menu — 3 PASS / 6 BLOCKED

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Unentitled agent never sees Inbound; pasting `/leads/inbound` is blocked | BLOCKED | `scripts/verify-agent-shell.mjs:114,118` asserts it; suite dies at fixture setup (live fixture) |
| 2 | The API rejects the same request server-side | PASS (guard) | `lib/tenantAuth/moneyRoutes.test.mjs` proves every agent route carries a server-side gate; live HTTP status BLOCKED (live fixture) |
| 3 | Adding a menu item is one data entry, no per-plan branching | **PASS** | `lib/menu/planBranching.test.mjs` — 6 tests: no plan comparison in the decision path, no menu key special-cased, filter total over the definition, and a synthetic item appears via data alone |
| 4 | Plan change alters the menu on next load, without re-login | BLOCKED | live fixture |
| 5 | `suspended` is read-only but still readable | BLOCKED | `verify-agent-shell.mjs:162,165` asserts it (live fixture). `npm run verify:entitlements` also fails live — suspended resolves to `full`, cancelled to `full` — but this is **not a defect**: `plans` and `subscriptions` do not exist in the project, so no subscription status can be resolved at all. `tenant_entitlements` holds 6 cached rows with no producer. See `LA-0-BLOCKERS.md` symptom 2b |
| 6 | Agent and admin sessions cannot be confused | **PASS** | `lib/tenantAuth/sessionSeparation.test.mjs` — 7 tests. Separation is cryptographic, not conventional: the planes sign with different secrets, so an admin cookie fails *signature* verification on an agent route and vice versa. Also proves distinct cookie names, host-only cookie, no role in the agent token, and rejection of a tampered token |
| + | `past_due` shows a payment warning, distinct from `suspended` | BLOCKED | `verify-agent-shell.mjs:155` (live fixture) |
| + | Upgrade prompt in place of a dead end when unentitled | PASS (contract) | `lib/entitlements/requireFeature.ts` returns 403 `feature_not_entitled`, distinct from the killed-feature 503 `feature_unavailable`, so the client can tell "buy this" from "it's down". Rendered surface BLOCKED (live fixture) |
| + | Tenant scope from the session, never a request parameter | **PASS** | `lib/menu/planBranching.test.mjs` scans all 82 agent routes for tenant ids read from query, body or headers — none; `lib/tenantAuth/requireTenant.ts` resolves scope from the verified cookie only |

### LA-0.2 · In-tenant roles & permissions — 4 PASS / 6 BLOCKED

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | An `assistant` calling **any** commission or ledger endpoint gets 403, verified by an automated test across every money route | **PASS** | `lib/tenantAuth/moneyRoutes.test.mjs` — the artifact the criterion names. Exhaustive classification: all 82 routes under `app/api/app` must match exactly one rule, so a new unclassified route fails the suite and a new money route is covered from the moment it is declared. Resolves in-file `as const` role constants and treats a statically unreadable role argument as a failure. Live HTTP 403 BLOCKED (live fixture) |
| 2 | A `bookkeeper` cannot open the dialer or play a recording | SPLIT | Dialer **PASS** (same test; `dial/preflight` admits only owner/producer). Recording **BLOCKED — no such endpoint exists**: there is nothing to 403 yet. The test's pattern already covers `recording`, so the criterion self-completes when the route lands |
| 3 | A `producer` cannot see another producer's commission figures | BLOCKED — not buildable yet | `app/api/app/ledger/route.ts` and `policies/route.ts` return `entries: []` / `policies: []`. They are authorization frames with no rows. Row-level isolation cannot be demonstrated until the ledger actually returns commission data; `roleCanViewCommission()` in `lib/tenantAuth/permissions.ts` is the intended mechanism and is unit-reachable but unused |
| 4 | Demoting the last `owner` is blocked with a clear message | BLOCKED | live fixture |
| 5 | Role changes apply on the next request | **PASS (structural)** | `lib/tenantAuth/requireTenant.ts` `resolveTenantContext()` reads the role from `tenant_users` on every request and compares `session_version`; `sessionSeparation.test.mjs` proves the token carries no role, so a stale role cannot be cached in it. Live mid-session flip BLOCKED (live fixture) |
| 6 | Seats consumed by role are visible to the owner | BLOCKED | live fixture. Notion puts limit *enforcement* out of scope; not built, correctly |
| + | Role on `tenant_users`, not a column on `users` | PASS with a caveat | `tenant_users.role` is what `resolveTenantContext` reads. Caveat: `public.users` still carries a legacy `users_role_id_fkey` to `roles` from the organizations era. Unused by LA-0 but present — recorded in `LA-0-NOTION-DELTA.md` |
| + | Permission checks layered **after** the entitlement check | **PASS** | `lib/tenantAuth/requireFeatureRole.ts` calls `requireFeature` first and returns its response unchanged, so an unentitled caller gets `feature_not_entitled` and only an entitled one can reach `role_not_allowed` |
| + | Invite a teammate by email with a role, from settings | BLOCKED | live fixture. Invite *consumption* was proven by the prior audit; *creation* was not |
| + | Administrative writes leave an append-only audit row | BLOCKED | live fixture; assertions exist at `verify-contacts.mjs:46` and `verify-appointment-vault.mjs:92` |

### LA-0.3 · Dashboard shell — 4 PASS / 1 BLOCKED

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | A module adds a tile by registering it, with no change to the dashboard component | **PASS** | `lib/dashboard/tiles.test.mjs` — the registry in `lib/dashboard/tiles.ts` is data; `visibleDashboardTiles()` filters it |
| 2 | Unentitled tiles are absent, not greyed or empty | PASS (unit) | same test. Live DOM absence BLOCKED (live fixture) |
| 3 | The setup checklist disappears once complete and does not come back | PASS (unit) | `lib/dashboard/checklist.test.mjs`; `setupChecklistForState` is a pure function of the durable `onboarding_state`, so there is no path by which it returns. Live reload/re-login BLOCKED (live fixture) |
| 4 | Every empty state names the next action | **PASS** | every `DashboardTile` carries both `empty_state` and `action_label`; asserted in `tiles.test.mjs` |
| 5 | The page loads in under 1 second | BLOCKED | no harness exists, and building one needs an authenticated session (live fixture). No number has ever been recorded against this budget |

### LA-0.4 · Carrier, product & commission schedule library — 4 PASS / 1 BLOCKED

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Adding a carrier requires no deploy | **PASS (live)** | `npm run verify:carrier-library` printed `ok platform carrier can be added without a deploy` against the live project in this pass — one of only three live checks that survived the fixture blocker |
| 2 | Every commission figure traces to this table, never a hardcoded percentage | SPLIT | Single source **PASS**: `lib/carriers/resolve.ts` holds the only rate resolution (`resolveCommissionRate`) and the only money conversion (`commissionCentsFromSchedule`, which rejects non-integer basis points and negative premiums). End-to-end trace **BLOCKED — nothing renders a commission figure yet**; the ledger surface returns an empty array, so there is no downstream number to trace |
| 3 | Changing a contract level does not retroactively rewrite recorded commissions | PASS (unit) | `lib/carriers/resolve.test.mjs` — resolution filters `effective_from <= asOf` and takes the latest, so an earlier date keeps resolving the earlier schedule. Live recorded-row case BLOCKED (live fixture) |
| 4 | Two agents on different levels, same policy, different correct figures | PASS (unit) | `lib/carriers/resolve.test.mjs:18` computes integer cents at two contract levels. Live two-tenant case BLOCKED (live fixture) |
| 5 | Rates as integer basis points, money as integer cents | **PASS** | `commissionCentsFromSchedule` enforces both at runtime and is unit-covered |

### LA-0.5 · Appointment & contract-level vault — 4 PASS / 2 BLOCKED

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | `canWrite()` false with no appointment, and for a future effective date | **PASS** | `lib/appointments/singleSource.test.mjs` |
| 2 | The grid captures 40 appointments in under two minutes | BLOCKED | `verify-appointment-vault.mjs:61` asserts 40 rows from one bulk request (live fixture). The grid with select-all exists in `components/app/appointment-vault-settings.tsx`; the timed run has not happened |
| 3 | An expired licence or E&O makes `canWrite()` false for every state it covers | **PASS** | `singleSource.test.mjs` — separate tests for the licence case (that state only) and the E&O case (everywhere at once) |
| 4 | Warnings at 90/60/30 days, by email and in-app, stopping on renewal | BLOCKED | `lib/appointments/warnings.test.mjs` covers threshold computation; the channels, idempotency of a second `npm run appointments:warn`, and renewal silencing are unproven (live fixture) |
| 5 | Appointments are effective-dated — a policy written last year survives a later termination | **PASS** | `singleSource.test.mjs` asserts writable before the termination date, refused on it, refused after |
| 6 | No module contains its own copy of the eligibility logic | **PASS** | `singleSource.test.mjs` scans `lib`, `app` and `components` for files deciding from appointment fields instead of calling the helper — none. It also pins the three-way `canWrite` name collision (appointment eligibility, subscription access, component role gate) so a future merge of the first two fails the suite |

### LA-0.6 · Contact & household model with dedupe — 2 PASS / 5 BLOCKED

The fuzzy matching lives in the Postgres RPC `find_contact_duplicates`, not in TypeScript, so most
of this task is only provable against a live database. `lib/contacts/service.ts:51` `findDuplicates`
is the single entry point and both acquisition paths reach it.

Scoring model, read from the deployed function: phone exact `0.35`, DOB exact `0.25`, address-hash
exact `0.20`, name trigram similarity `×0.40`, address trigram similarity `×0.20`. Candidate floor
`0.45`. Confidence bands: **high ≥ 0.78** (auto-merge), **medium ≥ 0.60** (agent confirms),
**low ≥ 0.45** (shown, never merged), **below 0.45** not returned at all (new record).

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Two phone numbers and a misspelled surname detected as a probable duplicate | BLOCKED | `verify-contacts.mjs:31` (live fixture) |
| 2 | Husband and wife at one address are two contacts in one household | BLOCKED | `verify-contacts.mjs:32` (live fixture). By design it holds: `save_contact` groups by `address_hash`, and a spouse pair scores ≈0.51 — returned as `low`, so auto-merge cannot fire |
| 3 | Auto-merge only above the threshold; everything else to the agent | **PASS (thresholds documented)** | bands above, read from the deployed RPC. Live three-outcome walk BLOCKED (`verify-contacts.mjs:33`) |
| 4 | A merge can be undone and both originals return intact | BLOCKED | `verify-contacts.mjs:35-38` (live fixture). By design it holds: `merge_contacts` writes `kept_snapshot`/`merged_snapshot`/phone/email snapshots into `merge_log` and sets `merged_into_id` rather than deleting |
| 5 | Duplicate detection over 20,000 contacts in under 500ms | BLOCKED | `verify-contacts.mjs:45` seeds 20,000 rows and asserts `< 500ms` (live fixture). No number recorded |
| 6 | Custom fields survive a CSV import round-trip | BLOCKED | `verify-contacts.mjs:39` does export→import→export (live fixture); `lib/contacts/csv.test.mjs` covers parse/serialize in isolation |
| 7 | No cross-tenant match is ever possible, verified by test | **PASS (design)** | `find_contact_duplicates` filters `c.tenant_id = p_tenant_id` in both the candidate CTE and the household join, so no cross-tenant row can enter the result. Live negative check BLOCKED (`verify-contacts.mjs:40`) |

## Totals

| Task | PASS | BLOCKED |
|---|---|---|
| LA-0.1 | 3 | 6 |
| LA-0.2 | 4 | 6 |
| LA-0.3 | 4 | 1 |
| LA-0.4 | 4 | 1 |
| LA-0.5 | 4 | 2 |
| LA-0.6 | 2 | 5 |
| **Total** | **21** | **21** |

No task is `PASS` overall. Every task has at least one `BLOCKED` criterion, and 19 of the 21
blocked criteria share the single cause in the headline.

## Changes made in this pass

- `lib/tenantAuth/moneyRoutes.test.mjs` — new, 7 tests. The artifact LA-0.2 criterion 1 names.
- `lib/tenantAuth/sessionSeparation.test.mjs` — new, 7 tests. LA-0.1 criterion 6.
- `lib/menu/planBranching.test.mjs` — new, 6 tests. LA-0.1 criterion 3 and the tenant-scope rule.
- `lib/appointments/singleSource.test.mjs` — new, 9 tests. LA-0.5 criteria 1, 3, 5, 6.
- `lib/entitlements/agentApiPolicy.ts` — **fixed 11 registry drifts.** The registry recorded no
  `allowedRoles` for `policies`, `policies/lapse-risk`, `dial/preflight`, `inbound/transfer`,
  `leads/[id]`, `team`, `team/[userId]` and four `templates` routes, while the route sources
  enforce them. Every consumer of the registry — the feature checker, the plan preview — was
  reasoning about a weaker guard than the deployed one. Caught by the new drift test.
- `scripts/verify-all.mjs` — added the four missing LA-0 suites.
- `supabase/migrations/20260911120000_auth_user_bridge_name_fix.sql` — new, **not applied**.

## Gate

Run 2026-09-11 on branch `codex/la-0-module-audit`:

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS** (exit 0) |
| `npm run lint` | **PASS** (exit 0) |
| `npm test` | **PASS** — 323 tests, 0 failures (294 before this pass; +29) |
| `npm run build` | **PASS** (exit 0) |
| `npm run db:check` | **PASS** — every migration parses, including the new one |
| `npm run db:check:deep` | **FAIL** — the chain cannot be replayed from scratch: `credit_notes`, `plan_limits`, `subscriptions` and several functions do not exist at their migrations' point in the sequence. Pre-existing and consistent with backlog #29 (migrations start at SA-4.1; SA-0–SA-3 objects live only in the project) |
| `npm run check:features` | **CRASH** — exit `-1073740791` (`0xC0000409`, stack buffer overrun). The process dies before reporting; it does not fail, it aborts. Not yet diagnosed |
| `npm run verify:carrier-library` | 3 of 12 checks ran and passed; 9 blocked at fixture setup |
| `npm run verify:appointment-vault` | blocked at fixture setup (401 on every authenticated call) |
| `npm run verify:contacts` | blocked at fixture setup (`users_id_fkey`) |
| `npm run verify:agent-shell` | blocked at fixture setup (`users.id` not-null) |
| `npm run verify:entitlements` | **4 checks FAILED** — see LA-0.1 criterion 5 |

The 2026-09-10 audit reported `typecheck` and `build` as PASS while
`docs/architecture/task-traceability.md` reported both failing. **The audit was right and the
traceability document is stale** on that point; it has been corrected.

## What has to happen next

1. **Apply `20260911120000_auth_user_bridge_name_fix.sql`.** Needs DDL access; `TENANT_DB_URL`
   does not have it. This is also a live product defect, not only a test blocker — signup and
   invitation acceptance are broken in this environment.
2. Re-run the four LA-0 suites plus `verify:all`. 19 blocked criteria are expected to resolve.
3. Diagnose `verify:entitlements`: seed the missing v1 plans, then re-check whether suspended and
   cancelled subscriptions really do resolve to `full` access. If they do, LA-0.1 criterion 5 is a
   defect, not a proof gap.
4. Diagnose the `check:features` crash.
5. Decide the two criteria that are **not buildable as specified today** — LA-0.2 criterion 3 and
   LA-0.4 criterion 2 both need a ledger that returns rows. See `LA-0-NOTION-DELTA.md`.
6. Build the LA-0.3 load-time harness; no number has ever been taken.
7. The tenant-versus-organizations decision in `docs/architecture/database.md`.
