# Agency Module (AG-0 / AG-1) — build prompt

Open a session with: `Read docs/agency/AGENCY-BUILD-PROMPT.md and continue from the first task not marked done in §9.`

The spec is Notion, not this file: the doc **"Agency Module 0 — The Agency Foundation (AG-0 / AG-1)"**
(Insurvas Docs) and the **24** Insurvas Sprint rows with Module = AG-0 / AG-1 (AG-0.1 … AG-1.12).
This file records how that spec lands on *this* codebase, the decisions taken where the two disagree,
and the order and rules of the build. Design of every screen: artifact
https://claude.ai/artifact/5wAjX7LGFnuEshKcoFziz7 (Agency Module Design).

---

## 0. What you are building, in four sentences

An agency is **one tenant** holding the carrier contracts; producers are `tenant_users` who write
business under them. The carrier pays and claws back from the agency, the agency pays and claws back
from the producer, and the agency keeps the **override** — the gap between its contract level and the
producer's. AG-0 makes the existing LA-0…LA-8 app safe for many people (roles, a producer filter,
invites, offboarding, lead routing, a dashboard); AG-1 is the money (override engine, payable ledger,
splits, payout runs, statements, scorecards, review, reconciliation). The agency's real exposure is the
**negative balance of a producer who has left** — every money screen exists to show that number.

---

## 1. Rules that override everything else

1. **Notion first.** Before each task, re-read its Notion page. Every change names its task
   (`AG-0.4`) in code comments, migration headers and the eventual commit message. Anything with no
   home in the spec is labelled "outside the spec" and not built.
2. **Do not destroy existing functionality.** Individual-plan tenants must see *zero* behaviour change:
   every agency predicate is a no-op when `plan audience = individual`. No removed guards, routes,
   props or branches. If a change alters behaviour outside the task, stop and say so.
3. **Extend, never duplicate.** One invite flow (LA-8.6), one ledger (LA-7.5's), one payout engine
   (LA-7.4/7.5), one persistency calc (LA-5.8), one placement calc (LA-4.18), one cost engine (LA-7),
   one set of application checks (LA-3). §4 lists them. A parallel table is a failed task.
4. **Money is integer cents, rates are integer basis points**, in intermediate sums too. Money out is
   negative; a balance is `SUM(amount_cents)` with no branch; negative balances are never clamped.
5. **Absent, not guessed.** A missing level/number/config yields `null` and a visible prompt — never
   0, never the agency's level, never the owner.
6. **Small-sample rule.** Under the threshold show a count (`14/16`), never a percentage. Reuse the
   existing LA-4 threshold constant; do not invent one.
7. **Three truths.** `expected` / `reported` / `received` are never summed together. Every producer
   money figure on screen carries its basis label. Payouts pay on `reported`.
8. **Effective dating.** Levels, writing numbers, hierarchy: look up *as of the policy's effective
   date*. Changes close the old row and insert a new one — never UPDATE history.
9. **Scope from the session**, never a request parameter. Passing `producer_id=B` changes nothing.
10. **Never commit or push unless the owner asks.** The tree is shared with other sessions' uncommitted
    work (see memory: uncommitted tree) — touch only what the task needs.

---

## 2. Decisions taken (spec ↔ code). The owner may overturn any; each is reversible.

| # | Conflict | Decision |
|---|---|---|
| D1 | Spec puts `producer_id` on every business table. The code already attributes rows by **user id** (`policy_current.agent_user_id`, `commission_entry.agent_user_id`, `cost_entry.producer_user_id`, `leads.owner_user_id`, `lead_assignments.assigned_to_user_id`, `dialer_calls.agent_user_id`, `producer_*.producer_user_id`, …). | A `producer` row is unique on `(tenant_id, user_id)`. The spec's "producer_id" on business rows **is the producer's user id in the column that table already has**. No `producer_id` column is added where a user-attribution column exists; `visible_producer_ids` returns **user ids**. The `producer` table owns status, can_submit, hire/offboard dates. |
| D2 | Spec adds `plan.audience`. The `plan_type` enum already has `individual / agency_no_teams / agency_with_teams / management`. | Audience is **derived**: `individual → individual`, `agency_* → agency`. One SQL function `tenant_plan_audience(tenant_id)` and one TS helper. No new plan column. |
| D3 | Spec says RLS "is the one that protects us". The app reads through the **service-role client** (≈411 files), which bypasses RLS. | The **application helper is the enforced boundary** for app reads; RLS policies are added for every `tenant_app` connection as defence in depth; the AG-0.5 audit tests the *routes*, which is what actually ships data. Say this plainly in the audit report. |
| D4 | LA-7.5 `producer_split` pays a % of the agency's commission; AG pays by contract level (pool) with the override off the top. | For **agency-audience** tenants the AG-1.3 engine computes the pool from contract levels; `producer_split` is narrowed to "two producers share one policy" (AG-1.6) and applies to the pool. Individual tenants keep LA-7.5 unchanged. |
| D5 | Spec names `producer_payable_entry`; LA-7.5 built `producer_ledger_entry`. | **Evolve `producer_ledger_entry`** (add `basis`, `source_raw_row_id`, `policy_id`, `carrier_id`, AG entry types `earned / advance_paid / chargeback / adjustment / payout`). "producer_payable_entry" is a spec label only. Producer runs stay `producer_payout_run` (`payout_run` is LA-7.4's). |
| D6 | `one_seat_rule` counts invited as a seat; AG-0.6 says it does not. | For **agency** audience, a seat is held by every accepted, working member — producers **and** assistants, bookkeepers, setters, retention and the owner (module doc §6: "assistants consume a seat inside the band"; owner confirmed 2026-10-20). Invited members and offboarded producers (after their period ends) hold none. Individual plans keep `one_seat_rule`. |
| D7 | The invite route 409s any existing email; spec allows one user in two tenants. | The invite attaches an **existing** auth user to the new tenant instead of refusing; an email already in *this* tenant is still refused. |
| D8 | Bands vs plan `max_seats`. | Three agency plans (`agency_50` $999, `agency_150` $2,499, `agency_unlimited` $4,999), `plan_type = agency_with_teams`, `max_seats` 50 / 150 / null. Band change = plan change through SA-3 (upgrade prorated now, downgrade end of period). `agency.seat_band` mirrors the plan. |
| D9 | Menu groups max 8 items. | New **Team** section (7 nodes). Attribution queue + Producer reconciliation live under **Commissions**. |
| D10 | Spec's Maria ledger reads `+810 advance_paid −720 chargeback = −720` (that is +90). | Signed entries: `earned +810`, `advance_paid −810`, `chargeback −720` → **−720**. The unit test encodes this. |
| D11 | Spec roles include `admin`, `manager`; enum lacks them — and 44 live SQL functions gate on `tenant_users.role`, so new enum values would be admitted by none of them. | They are **titles on the join row**: `tenant_users.agency_role` (`admin` rides on role `owner`, `manager` on `producer`). Every existing gate keeps working through the base role; `ROLE_PERMISSIONS` is keyed by `MemberRole` (the 7 + setter) so the matrix is still one table; `titleWithholds()` + `refuseWithoutBilling()` keep billing from an admin. The billing owner is the owner with no title; a trigger keeps at least one. `admin` = the agency's **System admin** (not Insurvas Super admin). Titles exist only on agency-audience tenants. |

---

## 3. Environment facts (do not rediscover)

- **No DDL from here.** Write each migration, rehearse the **whole file** in a rolled-back transaction
  as `tenant_app` (functions pointed at `pg_temp`, grants stripped), run `npm run db:check`, and hand
  it to the owner to paste into the Supabase SQL editor. Verify afterwards with
  `scripts/verify-applied-migrations.mjs` / marker queries — never trust "applied".
- Migrations for this module use the range **`20261018100000`–`20261018399999`**, one file per task.
- Write-guarded tables need the explicit `revoke insert, update, delete, truncate … from service_role,
  tenant_app` plus a static test asserting the line (service_role gets ALL by default).
- SQL-editor pastes may store CRLF; anchor in-place patches on single lines.
- Node tools: run `tsc`, `eslint`, `npm test` from **PowerShell** (Bash lacks node on PATH for npx).
  Check exit codes, not grep output. Tests are `lib/**/*.test.mjs` under `node --test`.
- `tsc` misses the client/server boundary — shared constants for client components go in a
  `constants.ts` without `server-only`. Run `npm run build` once at the end of a screen batch.
- Pooler (`TENANT_DB_URL`) is transaction mode: `set_config(..., true)` inside a transaction only.
- Python on Windows writes CRLF — use the Edit tool.

---

## 4. What already exists — extend these

| Thing | Where |
|---|---|
| Roles, matrix as data | `lib/tenantAuth/roles.ts`, `lib/tenantAuth/permissions.ts` (`ROLE_PERMISSIONS`, `rolesWith`) |
| Route guards | `requireTenant(roles)`, `requireFeatureRole(feature, roles, {write})`, pages `guardPage(feature)` |
| Tenant RLS session vars | `lib/tenantDb/withTenantScope.ts` (`app.tenant_id`, `app.user_id`) |
| Agency identity | `agency_profiles` (legal_name, dba, npn, tax id), `agency_profile_history` |
| Producer identity / licences | `tenant_user_producer_profiles`, `tenant_user_licensed_states`, `licenses`, `appointments` |
| Agency contract level + writing number | `tenant_carriers.contract_level_bp / writing_number / effective_from` (LA-0.4) — becomes the **agency level** |
| Lead assignment | `lead_assignments`, `lead_assignment_events`, `assignment_rules`, `lib/assignment/{autoRoute,service,licenceLapseJob}.ts` |
| Commission ledger | `commission_entry` (entry_type already allows `override`), `raw_rows`, `policy_current` |
| Producer splits / ledger / runs | `producer_split`, `producer_ledger_entry`, `producer_payout_run`, `lib/accounting/producerStore.ts`, `producersCore.ts`, `/app/producer-splits`, `/app/my-balance` |
| Publisher payouts | `payout_run`, `payout_run_item`, `lib/accounting/payoutStore.ts` |
| Team & seats (LA-8.6) | `components/app/team-settings.tsx`, `app/api/app/team/**`, RPC `tenant_invite_user_with_auth`, `one_seat_rule` |
| Scorecards | LA-4.18 `lib/ingestion/scorecards`, `/app/book-scorecards`; LA-5.8 `lib/retention/scorecardStore`; LA-7 cost per policy |
| Licence gate | `lib/compliance/transferGate*.ts` (LA-6.2) |
| Application checks | LA-3 `lib/applications/*` |
| Menu | `lib/menu/definition.ts` (`buildAgentMenu(granted, role)`, ≤8 per group); `npm run check:features` |
| Role homes | `lib/dashboard/roleHome.ts` (`ROLE_HOMES: Record<TenantRole,…>`) |
| Plans | `plans.plan_type` enum (D2), SA-2 catalogue, SA-3 lifecycle |

---

## 5. Design and interaction — every screen

Follow `docs/design/UI-CONSISTENCY.md` exactly and the mockups in the design artifact.
- One `PageHeader` (title + one sentence + actions). No eyebrow, breadcrumb or explainer card; only
  one-line actionable alerts.
- At most one `StatStrip` (3–6 tiles). Lists are `TableCard` with `DataToolbar` inside (search →
  filters → actions → Refresh), `Pager`. Detail beside a list = `DetailPanel`; confirms = `Dialog`;
  several lists = `ViewTabs`. Buttons 36px (`size="sm"` only in table rows). Text 12/14px. No hex.
- **Think through the interaction for every screen before writing it** and note it in the task's
  test or comment: who opens it (each role's variant), the empty state, loading, error, the
  disabled/forbidden state and its message, what each action writes, what confirms first, what the
  person sees after (toast text names the outcome), keyboard focus, phone width.
- Every null is visible (`—` + "Set level"), every negative is red, every money figure has a basis
  label, every count under the threshold is a count.
- Copy is plain and specific: "Lapses on these 16 policies after today will be charged to the
  agency, not to Maria Ruiz." Refusals name the missing item ("Your E&O certificate is missing").

---

## 6. Build order (strict for the first five)

```
A  0.1 → 0.2 → 0.3 → 0.4 → 0.5 (RELEASE GATE: nothing in B–D ships until it passes)
B  0.6  0.7  0.8  0.9  0.10  0.12
C  1.3  1.4  1.5  1.6  1.12  1.7  1.8
D  1.1  1.10  1.2  0.11  1.9  1.11
```
If AG-1 must shrink: drop 1.11, then 1.10. Never drop 1.5, 1.7, 1.8.

---

## 7. Amendments carried with their tasks

LA-4.3/4.4 writing number captured, missing → raise (with 1.4) · LA-7.5 splits on the pool (1.6) ·
LA-8.6 becomes producer admin, band seats (0.6) · LA-6.2 reads `producer.can_submit` per producer
(1.10) · LA-5.8 + LA-4.18 producer dimension (1.9) · LA-1.x/2.x queues read assignment (0.10) ·
SA-2 keys + retire seat cents, SA-3 band change, SA-5 band/seats/producers (0.12).

---

## 8. Per-task loop

1. Re-read the Notion task. 2. List the files/tables it touches (extend §4). 3. Write the migration
(if any) with a header naming the task, its "Done when", and a self-check DO block. 4. Write the
lib code (pure core in a `*Core.ts` testable by `node --test`, store/IO separate). 5. Write the
tests the task's "Done when" names, literally. 6. Write the API route (declared feature + roles from
`rolesWith`). 7. Build the screen per §5. 8. Run typecheck, lint, tests (PowerShell). 9. Rehearse
the migration whole-file. 10. Update §9 and the task's status line below. Do not mark Notion done —
the owner does that after the migration is live.

---

## 9. Status

| Task | Title | State |
|---|---|---|
| AG-0.1 | Agency + producer records, plan audience | built · 20261018100000 · ag01 tests |
| AG-0.2 | Roles and permission matrix | built · 20261018110000 · titles (D11) · ag02 tests |
| AG-0.3 | Producer hierarchy, effective-dated | built · 20261018120000 · ag03 tests |
| AG-0.4 | Row-level producer visibility | built · 20261018130000 · ag04 tests |
| AG-0.5 | Producer isolation audit — RELEASE GATE | static gate PASSES 2026-10-19: 476 API routes + server pages, 285 reachable, 0 unscoped (baseline empty); pages walked; OWN_ONLY list (4, test-proven) · LIVE check PASSED 2026-10-19: producer A, assistant, manager — 0 of B's rows across 730 API variants (with producer_id spoofing) + 111 pages; temp agency cleaned |
| AG-0.6 | Seat bands, invitations, accept flow | built · 20261018140000 · accept-invite route · ag06 tests |
| AG-0.7 | Suspend and offboard, frozen balance | built · 20261018150000 · ag07 tests |
| AG-0.8 | Solo → agency backfill | built · 20261018160000 · ag08 tests |
| AG-0.9 | Contract levels and writing numbers | built · 20261018155000 · ag09 tests |
| AG-0.10 | Lead assignment and routing | built · 20261018170000 · ag10 tests |
| AG-0.11 | Agency dashboard | built · /app/agency · ag11 tests |
| AG-0.12 | Retire per-seat plan, seed keys | built · 20261018180000 (parse-checked only: data writes) · Notion per-seat text still to strike |
| AG-1.1 | Producers screen | built · /app/producers, /app/producers/[id] |
| AG-1.2 | Hierarchy & Overrides screen | built · /app/hierarchy |
| AG-1.3 | Override engine | built · overrideCore · ag11 tests (worked example + property) |
| AG-1.4 | Statement attribution + disagreement queue | built · 20261018200000 · /app/attribution |
| AG-1.5 | Producer payable ledger | built · 20261018210000 · rehearsed money assertions |
| AG-1.6 | Splits on top of the override | built · 20261018205000 · /app/commission-splits |
| AG-1.7 | Payout run | built · 20261018220000 · /app/producer-payouts |
| AG-1.8 | Producer statement | built · /app/producer-statements/[runId] (+PDF), /app/my-pay |
| AG-1.9 | Producer scorecards | built · /app/producer-scorecards |
| AG-1.10 | Onboarding checklist → can_submit | built · 20261018240000 · onboarding tab + submit gate |
| AG-1.11 | Application Review | built · 20261018250000 · /app/application-review |
| AG-1.12 | Three-truths reconciliation guard | built · 20261018230000 · /app/producer-reconciliation · static guard |

"built" = code and migration written, unit-tested and rehearsed (2026-10-18); none of it is live until the owner pastes the bundle; nothing is committed.

Performance follow-up 2026-10-19 (AG-0.5, uncommitted): deal flow, the activity log and the contact directory page a
multi-agent scope in SQL — 20261019400000 / 410000 / 420000, LIVE (bodies verified against the files). Null scope
sends the unchanged call; a scoped call never falls back to an every-agent path. Alert poll: one queue read, scope
cached 30s. Static proof: lib/agency/scopedInSql.test.mjs.

Live 2026-10-18: all 17 AG migrations applied and verified read-only (99 objects, 14 scope policies, every in-place patch, grants, 0.12 seeds, bucket). Follow-up outside the 24 tasks: 20261018260000 backfills producer rows for the 3 agency tenants that pre-date the module — rehearsed, awaiting paste.

Follow-up 2026-10-19 (AG-0.10, dialer): agency producers are served by serve_next_lead again (pool closed by 20261019100000; the app-side tier-order serve is removed), and a refused lead that was assigned stays assigned with the reason in its history. 20261019300000 stops serve_top scanning the pool when it is closed — rehearsed, awaiting paste.
