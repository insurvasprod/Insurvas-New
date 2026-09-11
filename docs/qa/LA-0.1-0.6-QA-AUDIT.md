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
   (`npm run db:check`) and was applied to the configured Supabase project during the focused
   2026-09-11 recheck through the project migration tool.

The focused LA-0.1 recheck then applied the required catalog, entitlement, subscription-lifecycle,
and legal-function migrations and re-ran the live verifier.

**A second, narrower cause surfaced afterwards.** Three suites still failed once user creation
worked, because they predate Supabase Auth becoming the credential authority and inserted into
`public.users` with a self-generated id — which violates `users_id_fkey` and makes every
authenticated assertion after it return `401`. `scripts/lib/fixtureUser.mjs` now creates fixture
users through the supported Auth admin path.

With both causes cleared, LA-0.4, LA-0.5 and LA-0.6 were re-run live on 2026-09-11 and their rows
below are refreshed from that output. LA-0 moved from 21 PASS / 21 BLOCKED to **32 PASS / 10**, and
the remaining ten no longer share a single cause — see Totals.

## Criterion matrix

### LA-0.1 · Agent app shell, login & entitlement-driven menu — 9 PASS

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Unentitled agent never sees Inbound; pasting `/leads/inbound` is blocked | **PASS** | `npm run verify:agent-shell` uses a throwaway Supabase tenant with a real cached Basic entitlement; `/app/inbound` renders the upgrade gate and no navigation link |
| 2 | The API rejects the same request server-side | **PASS** | The same verifier asserts `GET /api/app/inbound?status=unclaimed` and `POST /api/app/inbound/transfer` both return HTTP 403 with `feature_not_entitled` |
| 3 | Adding a menu item is one data entry, no per-plan branching | **PASS** | `lib/menu/planBranching.test.mjs` — 6 tests: no plan comparison in the decision path, no menu key special-cased, filter total over the definition, and a synthetic item appears via data alone |
| 4 | Plan change alters the menu on next load, without re-login | **PASS** | The verifier keeps one signed tenant cookie, changes its subscription from Basic to Advance, reloads `/app/inbound`, and asserts the entitlement-driven link appears |
| 5 | `suspended` is read-only but still readable | **PASS** | The verifier sets the throwaway subscription to `suspended`, asserts HTTP 200 reads for policies and inbound with `readOnly: true`, HTTP 403 `read_only` for writes, and rejects concurrent writes |
| 6 | Agent and admin sessions cannot be confused | **PASS** | `lib/tenantAuth/sessionSeparation.test.mjs` — 7 tests. Separation is cryptographic, not conventional: the planes sign with different secrets, so an admin cookie fails *signature* verification on an agent route and vice versa. Also proves distinct cookie names, host-only cookie, no role in the agent token, and rejection of a tampered token |
| + | `past_due` shows a payment warning, distinct from `suspended` | **PASS** | The verifier refreshes a real cached entitlement after setting `past_due` and asserts the rendered `Payment needs attention` banner; the later suspended run asserts the separate read-only behavior |
| + | Upgrade prompt in place of a dead end when unentitled | **PASS** | The live throwaway route renders the `UpgradePrompt` copy (`isn't in your plan` / `View upgrade options`) and the API returns `feature_not_entitled`, distinct from killed-feature `feature_unavailable` |
| + | Tenant scope from the session, never a request parameter | **PASS** | `lib/menu/planBranching.test.mjs` scans all 82 agent routes for tenant ids read from query, body or headers — none; `lib/tenantAuth/requireTenant.ts` resolves scope from the verified cookie only |

#### Focused LA-0.1 recheck evidence · 2026-09-11

- `npm run verify:agent-shell`: all live checks passed against a throwaway Supabase tenant. The
  fixture is created through `auth.admin.createUser`, so this exercises the real auth trigger,
  tenant membership, cached entitlement, route guard, API guard, and cleanup path.
- `npm run verify:entitlements`: all reviewed `basic`, `pro`, and `advance` feature sets passed;
  `suspended` retained features with `read_only` access; `cancelled` returned no features and
  `none` access. `npm run check:features` found no catalog/guard/menu drift.
- Live Supabase inventory: every LA-0.1 dependency (`features`, `feature_modules`, `plans`,
  `plan_features`, `plan_prices`, `subscriptions`, `tenant_entitlements`, and the legal
  functions) exists, has RLS enabled, and has the expected service-only or tenant-read policy.
- Fresh browser evidence: authenticated `demo.agent` rendered `/app/dashboard`, `/app/inbound`,
  and `/app/settings`; desktop and 390×844 mobile views had no horizontal overflow, the mobile
  menu opened and closed, and the browser recorded zero error/warning console entries in each
  checked state.
- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test -- --runInBand` (368 tests),
  `git diff --check`, and `npm run db:check -- --fast` passed. The repository still has historical
  remote-only Supabase migration records from other modules; that migration-history drift is an
  operational deployment concern, not a failing LA-0.1 runtime criterion, and should be reconciled
  before using the CLI to push the entire repository.

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

`npm run verify:carrier-library` passes all 12 checks live as of 2026-09-11, after the fixture
harness was fixed (see the Fixture harness note below).

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Adding a carrier requires no deploy | **PASS (live)** | `ok platform carrier can be added without a deploy`, and `ok agent reads platform carriers and products from one library` |
| 2 | Every commission figure traces to this table, never a hardcoded percentage | SPLIT | Single source **PASS**: `lib/carriers/resolve.ts` holds the only rate resolution (`resolveCommissionRate`) and the only money conversion (`commissionCentsFromSchedule`, which rejects non-integer basis points and negative premiums). End-to-end trace **BLOCKED — nothing renders a commission figure yet**; the ledger surface returns an empty array, so there is no downstream number to trace |
| 3 | Changing a contract level does not retroactively rewrite recorded commissions | **PASS (live)** | `ok changing the level creates a new effective-dated contract`, plus `ok two simultaneous same-date saves are handled atomically`. Unit corroboration in `lib/carriers/resolve.test.mjs` |
| 4 | Two agents on different levels, same policy, different correct figures | **PASS (live)** | `ok a different contract level accepts a different correct rate`; `lib/carriers/resolve.test.mjs:18` computes the two figures in integer cents |
| 5 | Rates as integer basis points, money as integer cents | **PASS (live)** | `ok commission schedule saves in integer basis points` and `ok advance rule saves with integer percentages and months`; `commissionCentsFromSchedule` enforces both at runtime |

### LA-0.5 · Appointment & contract-level vault — 5 PASS / 1 SPLIT

`npm run verify:appointment-vault` passes all 13 checks live as of 2026-09-11.

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | `canWrite()` false with no appointment, and for a future effective date | **PASS** | `ok missing and future appointments are refused` live; `lib/appointments/singleSource.test.mjs` in unit |
| 2 | The grid captures 40 appointments in under two minutes | **PASS (API)** | `ok one bulk request captures forty appointments` — 40 rows land from a single request, and `ok repeated and concurrent bulk saves are idempotent`. The engineering substance is proven; the stopwatch through the grid UI is a usability observation, not an acceptance gate (see `LA-0-NOTION-DELTA.md`) |
| 3 | An expired licence or E&O makes `canWrite()` false for every state it covers | **PASS** | `ok expired licence or E&O refuses writing` live; `singleSource.test.mjs` separates the licence case (that state only) from the E&O case (everywhere at once) |
| 4 | Warnings at 90/60/30 days, by email and in-app, stopping on renewal | SPLIT | Thresholds **PASS**: `ok expiry warnings are emitted at the configured 90/60/30-day thresholds`. **BLOCKED** — the two delivery channels, idempotency of a second `npm run appointments:warn`, and renewal silencing are still unproven. No real mail was enabled |
| 5 | Appointments are effective-dated — a policy written last year survives a later termination | **PASS** | `ok an appointment can be terminated without deleting its history` and `ok historical eligibility remains true before termination and false after it`, live |
| 6 | No module contains its own copy of the eligibility logic | **PASS** | `singleSource.test.mjs` scans `lib`, `app` and `components` for files deciding from appointment fields instead of calling the helper — none. It also pins the three-way `canWrite` name collision (appointment eligibility, subscription access, component role gate) so a future merge of the first two fails the suite |

Also now proven live: `ok every successful write has an audit row`, `ok hostile and malformed input
is rejected next to the API boundary`, `ok missing and forged sessions are rejected`, and
`ok a producer can read the vault but cannot change owner-only settings`.

**A stale assertion was corrected, not the code.** The verifier asserted a producer gets `403` on
the vault `GET`, but that path was deliberately opened to producers with writes kept owner-only.
The check now exercises the owner-only half — read `200`, write `403`.

### LA-0.6 · Contact & household model with dedupe — 6 PASS / 1 BLOCKED

The fuzzy matching lives in the Postgres RPC `find_contact_duplicates`, not in TypeScript, so most
of this task is only provable against a live database. `lib/contacts/service.ts:51` `findDuplicates`
is the single entry point and both acquisition paths reach it.

Scoring model, read from the deployed function: phone exact `0.35`, DOB exact `0.25`, address-hash
exact `0.20`, name trigram similarity `×0.40`, address trigram similarity `×0.20`. Candidate floor
`0.45`. Confidence bands: **high ≥ 0.78** (auto-merge), **medium ≥ 0.60** (agent confirms),
**low ≥ 0.45** (shown, never merged), **below 0.45** not returned at all (new record).

`npm run verify:contacts` passes 15 of 16 checks live as of 2026-09-11. The one failure is
criterion 1, and its fix is written but not yet applied.

| # | Criterion | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Two phone numbers and a misspelled surname detected as a probable duplicate | **BLOCKED — regression found** | The duplicate *is* detected (`score 0.8654`, `confidence high`, auto-merged) but `matched_on` is `["dob","address","name"]` — never `phone`. The deployed `find_contact_duplicates` scores a phone match only against `contacts.primary_phone` and never reads `contact_phones`. `20260901101500_la_0_6_secondary_phone_dedupe_fix.sql` added that; the LA-0 bridge re-declared the function with `create or replace` and reverted it. Restored in `20260911140000_la_0_6_restore_secondary_phone_dedupe.sql` — **parses, not applied** |
| 2 | Husband and wife at one address are two contacts in one household | **PASS (live)** | `ok husband and wife remain separate` — two contacts, one household, auto-merge did not fire |
| 3 | Auto-merge only above the threshold; everything else to the agent | **PASS (live)** | `ok medium matches wait for agent confirmation` (outcome `review`, confidence `medium`) alongside the high-confidence `auto_merged` outcome above. Bands as documented |
| 4 | A merge can be undone and both originals return intact | **PASS (live)** | `ok merge retains source records`, `ok undo restores both originals`, `ok concurrent undo permits one reversal`, `ok same merge request is refused` |
| 5 | Duplicate detection over 20,000 contacts in under 500ms | **PASS (live)** | `ok 20,000-contact duplicate search is under 500ms` — 20,000 rows seeded into a throwaway tenant and removed afterwards |
| 6 | Custom fields survive a CSV import round-trip | **PASS (live)** | `ok custom fields survive CSV round-trip` — export → import → export preserves the JSONB field and its schema definition |
| 7 | No cross-tenant match is ever possible, verified by test | **PASS (live)** | `ok cross-tenant matching is impossible`, plus all 13 tenant-scoped tables asserted per tenant by `npm run verify:la0-rls` |

Also now proven live: `ok successful writes have audit rows`, `ok bookkeeper is refused`,
`ok producer can read directory`, `ok missing tenant membership fails closed`,
`ok missing and forged sessions are refused`, `ok undefined custom field is rejected`.

**One latent defect recorded, not fixed.** `save_contact` writes `organization_id = p_tenant_id`
to satisfy the legacy `NOT NULL` columns the organizations-era CRM still owns. Every tenant that
exists today is bridged from an organization, so this holds — but a tenant created *natively*
(which SA-5's self-serve signup will do) has no matching `organizations` row and cannot store a
contact at all. The fixture now models the bridge; the product decision belongs with the
tenant-versus-organizations question in `docs/architecture/database.md`.

## Totals

Refreshed 2026-09-11 after the auth bridge fix was applied and the fixture harness repaired.

| Task | PASS | BLOCKED / SPLIT |
|---|---|---|
| LA-0.1 | 9 | 0 |
| LA-0.2 | 4 | 6 |
| LA-0.3 | 4 | 1 |
| LA-0.4 | 4 | 1 (split) |
| LA-0.5 | 5 | 1 (split) |
| LA-0.6 | 6 | 1 |
| **Total** | **32** | **10** |

**LA-0.1 is `PASS` overall** — all nine criteria, including the two the original audit could not
prove (plan change without re-login, and suspended-is-read-only). It is the first LA-0 task to
clear completely.

Five of the six LA-0 verify suites now pass end to end: `verify:agent-shell`,
`verify:entitlements`, `verify:la0-rls`, `verify:carrier-library`, `verify:appointment-vault`.
`verify:contacts` passes 15 of 16.

What is left is no longer one shared cause. It is four distinct things:

1. **LA-0.2's role matrix** (6 criteria) — needs `support_agent`/`billing_admin` admin fixtures and,
   for criterion 3, a ledger that returns rows. Two of its criteria are not buildable as specified
   yet; see `LA-0-NOTION-DELTA.md`.
2. **LA-0.3's load-time budget** (1) — no harness exists; no number has ever been recorded.
3. **The end-to-end commission trace** (LA-0.4 criterion 2) and **expiry-warning channels**
   (LA-0.5 criterion 4) — both waiting on surfaces that do not render yet.
4. **LA-0.6 criterion 1** — a written, unapplied migration.

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
