# Prompt — close out LA-0.1 … LA-0.6 to full acceptance

Paste everything below the line into a fresh Claude Code session in this repository.

---

## Your assignment

`docs/qa/LA-0.1-0.6-QA-AUDIT.md` (audit date 2026-09-10) marks all six LA-0 tasks **PARTIAL**.
Every one of them is marked **Completed** in Notion. Your job is to make those two statements
agree — by finishing the work and proving it, not by editing the audit.

Two obligations, equal weight:

1. **Fix every open item** listed in the audit's "Remaining proof items", plus the additional
   acceptance-criteria gaps enumerated below (the audit's matrix does not cover all of them).
2. **Verify against the source of truth in Notion** — not against the audit. The audit is a
   secondary document. Fetch each Notion task page, read its **Goal**, **In scope**,
   **Out of scope** and **Acceptance criteria**, and check the implementation against that text.
   Where the audit and Notion disagree, Notion wins; where Notion is ambiguous, say so and pick
   the reading that is safest for a paying tenant.

Notion task pages (workspace "Unlimited Insurance", database "Insurvas Sprint"):

| Task | Page |
|---|---|
| LA-0.1 · Agent app shell, login & entitlement-driven menu | https://app.notion.com/p/3c875c44dafd81399a23e2b2689bc247 |
| LA-0.2 · In-tenant roles & permissions | https://app.notion.com/p/3c875c44dafd8180a40cd5d148e77988 |
| LA-0.3 · Dashboard shell | https://app.notion.com/p/3c875c44dafd8116ac52cd5a8b2c4b85 |
| LA-0.4 · Carrier, product & commission schedule library | https://app.notion.com/p/3c875c44dafd81849bc4f442280ecebe |
| LA-0.5 · Appointment & contract-level vault | https://app.notion.com/p/3c875c44dafd8130a052ed7320ac9c5f |
| LA-0.6 · Contact & household model with dedupe | https://app.notion.com/p/3c875c44dafd8186b10ddf1e1c0e474e |

Upstream dependencies to read for context, not to re-verify: SA-0.2 (tenant & user data model),
SA-2.8 (entitlement engine), SA-4.5 (products), SA-4.7 (agent templates).

## Hard rules

- **No destructive database work.** No reset, no broad `DELETE`, no dropping or rewriting
  existing organization/tenant data. Every schema change is a new additive migration in
  `supabase/migrations/` with a timestamped filename, following the existing LA-0 bridge
  migrations. Never edit a migration that has already been applied.
- **Every synthetic fixture row you create must be removed in the same transaction**, exactly as
  the existing isolated live fixture does. Report final fixture-row counts.
- **Do not weaken a guard to make a test pass.** If a test fails because the guard is correct and
  the test is wrong, fix the test and say so.
- **Do not touch secrets.** Never print service-role keys, Supabase project refs, passwords, or
  `.env*` contents into any file, commit, or summary.
- **Evidence standard.** A criterion is `PASS` only with a reproducible artifact: a named
  automated test, a named verify script and its output, a live SQL result, or a browser
  observation with the route and what was on screen. "The code exists" is never evidence.
  If something cannot be proven, mark it `BLOCKED` and state precisely what is missing — do not
  upgrade it to `PASS`.
- **Ask before anything outward-facing.** Do not push, open a PR, send email, or write to Notion
  without explicit approval in chat. Local commits on the current branch are fine.

## Part 0 — baseline, before you change anything

Record results; do not fix yet.

1. `git status` — the working tree currently carries ~60 modified files plus untracked routes on
   branch `codex/la-0-module-audit`. Establish what is in flight before adding to it.
2. Run and capture: `npm run lint`, `npm run typecheck`, `npm test -- --runInBand`,
   `npm run build`, `npm run db:check:deep`, `npm run check:features`.
3. **Resolve a contradiction between two same-dated documents.** `docs/qa/LA-0.1-0.6-QA-AUDIT.md`
   reports `npm run typecheck` and the production build as **PASS**;
   `docs/architecture/task-traceability.md` reports typecheck **failing** on lead-import, partner
   invite, credits monitor and partner-chat queries against `lib/supabase/database.types.ts`, the
   build failing in the TypeScript phase, and `check:features` failing because the app queries
   `public.features` while the live project exposes `public.feature_flags`. Determine which is
   true of the tree as it stands now, fix whichever failures are real, and correct the document
   that is wrong.
4. Run every LA-0 verify script and record pass/fail:
   `npm run verify:agent-shell`, `verify:entitlements`, `verify:carrier-library`,
   `verify:appointment-vault`, `verify:contacts`, `verify:la0-rls`, `verify:tenant-isolation`,
   `verify:user-integrity`.
5. **Architectural decision to surface, not to take unilaterally.** The LA-0 schema is currently
   an additive *compatibility bridge*: each organization is projected as a 1:1 tenant facade via
   `tenants.source_organization_id`. Notion SA-0.2 and every LA-0 data block describe tenants as
   the real model. Write up, in `docs/architecture/database.md`, the two paths — (a) keep the
   bridge permanently and declare it the contract, or (b) converge organizations into tenants with
   a backfill — with blast radius and effort for each, and **stop and ask the user to choose**
   before doing any convergence work. Everything else in this prompt is doable on the bridge.

## Part 1 — LA-0.1 · Agent app shell, login & entitlement-driven menu

Goal per Notion: *an agent logs in and sees exactly the modules their subscription includes —
nothing more, nothing less — with no per-plan code anywhere.*

Work through all six acceptance criteria. The audit only evidenced the first two.

| # | Acceptance criterion | Audit coverage | What you must produce |
|---|---|---|---|
| 1 | Agent on a plan without `inbound_transfers` never sees the Inbound menu item; pasting `/leads/inbound` is blocked by the route guard | proven | Re-confirm with a browser session on a tenant whose entitlement genuinely lacks the feature (not a mocked entitlement) |
| 2 | The API rejects the same request server-side | proven | Re-confirm; assert the status code, not just "blocked" |
| 3 | Adding a new menu item is one entry in the menu data file, with no per-plan branching | **not covered** | A test in `lib/menu/definition.test.mjs` that fails if any menu node is reachable through plan-code branching, plus a repo-wide scan proving no plan code or plan name appears in menu or guard logic |
| 4 | Changing the agent's plan changes the menu on the next page load, **without a re-login** | **unproven** | Live: mutate the tenant's cached entitlement, reload the shell in the same session, capture the menu before and after. No logout in between |
| 5 | A `suspended` subscription renders the app read-only but **still lets the agent read their own data** | **unproven** | Live: set the fixture tenant to `suspended`; prove reads return 200 and writes return 403 across the LA-0 write routes; prove the banner renders; restore state |
| 6 | Agent and admin sessions cannot be confused for one another | **not covered** | Prove an agent cookie is rejected by `/api/admin/*` and an admin cookie by `/api/app/*`; document the cookie names and domain separation. Notion's in-scope text requires a **separate cookie and domain** from the admin panel — state plainly whether the deployed configuration honours that or whether it is a deployment-time gap |

Also in Notion's in-scope list and absent from the audit matrix:

- **`past_due` shows a payment warning** banner, distinct from `suspended`. Prove both states
  render their own banner.
- **An upgrade prompt component shown in place of a dead end** when a feature is not entitled.
  The menu currently distinguishes `built` / `blurb` "coming soon" from unentitled. Prove an
  unentitled route renders the *upgrade* prompt, not a coming-soon page and not a 404.
- Tenant scope resolved from the session, **never from a request parameter**. Add a test that
  fails if any LA-0 route reads a tenant id from the query string, body, or a header.

## Part 2 — LA-0.2 · In-tenant roles & permissions

Goal per Notion: *inside one agent's account, different people see different things — and the
assistant can do the data entry without ever seeing a commission figure.*

The four roles are `owner`, `producer`, `assistant`, `bookkeeper` (`lib/tenantAuth/roles.ts`
already matches the spec). **This is the weakest area of the audit: it contains no role-matrix
evidence at all.** Three of the six acceptance criteria are money- and recording-confidentiality
criteria that were never exercised.

| # | Acceptance criterion | Audit coverage | What you must produce |
|---|---|---|---|
| 1 | An `assistant` calling **any** commission or ledger endpoint gets 403 — *verified by an automated test across every money route* | **not covered** | Build the automated test the criterion names. Enumerate money routes from the filesystem (`app/api/app/ledger`, `policies`, `statements`, `discrepancies`, commission/payout/advance routes, exports) so a newly added money route is covered by default and the test fails if it is unclassified. Assert 403, and assert no commission figure appears in any response body |
| 2 | A `bookkeeper` cannot open the dialer or play a recording | **not covered** | Route-level 403 for dial and recording endpoints, plus the menu and UI absence |
| 3 | A `producer` cannot see another producer's commission figures | **not covered** | Two-producer live fixture inside one tenant; producer A's ledger and policy reads must exclude producer B's figures. This is row-level, not route-level — prove it at the data layer |
| 4 | Demoting the last `owner` is blocked with a clear message | **unproven** | Live fixture: attempt demote and removal of the sole owner; assert the block and capture the user-facing message text |
| 5 | Role changes apply on the **next request**, not the next login | **unproven** | Live: change a role mid-session, issue the next request on the same cookie, prove the new role is in force. `session_version` resolution already exists — prove it end to end |
| 6 | Seats consumed by role are visible to the owner | partial (`11 used · 25 included`) | Prove the breakdown is **by role**, not just a total. Notion explicitly puts *enforcement* against plan limits out of scope — do not build enforcement |

Plus, from Notion's in-scope list:

- Role stored on `tenant_users`, **not** as a column on `users`. Assert this in a schema test —
  one person may later work for two agents.
- **Invite a teammate by email, with a role, from agent settings.** The audit proved invite
  *consumption* only. Prove invite *creation*: the settings UI, the email send, the role carried
  on the invitation, and expiry and revocation behaviour.
- Permission checks layered **after** the entitlement check. Prove the ordering: an unentitled
  account gets the entitlement failure, not a role failure; an entitled account with the wrong
  role gets the role failure.
- **Audit rows.** The audit lists "audit-row assertions" as unproven. Every administrative write
  in this module must leave an append-only audit row; assert row presence and shape.

## Part 3 — LA-0.3 · Dashboard shell

Goal per Notion: *the first screen after login answers one question in three seconds: am I okay?*

| # | Acceptance criterion | Audit coverage | What you must produce |
|---|---|---|---|
| 1 | A module adds a tile by **registering** it, with no change to the dashboard component | **not covered** | Prove the registry is real: add a throwaway tile in a test, assert it renders, assert the diff touches no dashboard component. Remove the throwaway |
| 2 | Tiles the agent is not entitled to are **absent**, not greyed or empty | partial | Assert absence from the DOM on a live unentitled tenant, not just from the tile list |
| 3 | The setup checklist disappears once complete and **does not come back** | **unproven** | Live: complete the onboarding state, prove the checklist is gone, then reload and re-login and prove it stays gone |
| 4 | Every empty state names the next action | partial | Enumerate every LA-0 empty state and assert each contains an action, not "no data" |
| 5 | **The page loads in under 1 second** | **unproven** | A repeatable measurement harness with the number recorded, the tenant's data volume stated, and cold versus warm distinguished. If the budget is missed, fix it or state the number and why it is missed |

## Part 4 — LA-0.4 · Carrier, product & commission schedule library

Goal per Notion: *the agent tells us once which carriers they are contracted with and at what
contract level, and every commission figure in the product is computed from that.*

Notion's data block names `tenant_carriers`, `commission_schedules`, `advance_rules` — all three
are present in `lib/supabase/database.types.ts`. Assert the column sets match the spec
(`contract_level_bp`, `writing_number`, `effective_from`, `is_active`; `product_code`,
`policy_year`, `rate_bp`; `advance_months`, `advance_pct_bp`, `clawback_months`,
`clawback_type`).

| # | Acceptance criterion | Audit coverage | What you must produce |
|---|---|---|---|
| 1 | Adding a carrier requires **no deploy** — it comes from the platform library | partial | Live: insert a platform carrier row, prove it appears in the agent's picker with no code change and no restart, then remove the row |
| 2 | A commission figure anywhere in the product traces back to this table, **never a hardcoded percentage** | **unproven** — the audit calls this out | Two parts: (a) a repo-wide scan for hardcoded commission percentages or rates in calculation paths, with the findings list; (b) an end-to-end trace from `commission_schedules` through to a rendered figure on the ledger or statement surface |
| 3 | Changing a contract level does **not** retroactively rewrite commissions already recorded — schedules are effective-dated | fixture passed | Keep; extend it to a recorded-commission row, not only a schedule row |
| 4 | Two agents on different levels with the same policy get different, **correct** figures | **not covered** | Two-tenant fixture at different `contract_level_bp`, identical policy input, assert both figures against hand-computed expected values |
| 5 | All rates stored as integers in basis points, all money as integer cents | proven | Keep; extend the type assertion to `commission_schedules` and `advance_rules`, not only the columns already checked |

Also: Notion's onboarding requirement is *a searchable carrier list with tick boxes and a level
field, not forty separate forms*. Prove the onboarding step matches that shape.

## Part 5 — LA-0.5 · Appointment & contract-level vault

Goal per Notion: *the system knows exactly which carriers the agent may sell for, in which states,
from which date — and refuses to let them write business they are not appointed for.*

| # | Acceptance criterion | Audit coverage | What you must produce |
|---|---|---|---|
| 1 | `canWrite()` false for a carrier/state pair with no appointment, and for one whose effective date is in the future | fixture passed | Keep |
| 2 | **The grid can capture 40 appointments in under two minutes** | **not covered** | `components/app/appointment-vault-settings.tsx` already has grid and select-all affordances. Prove the throughput: drive the grid in the browser, tick 40 carrier×state cells using the shortcuts, save once, time it, assert 40 rows landed. Notion requires carriers down the side, states across, with a "select all states" shortcut — never forty separate forms |
| 3 | An expired licence or E&O makes `canWrite()` false for **every state it covers** | partial (unit tests only) | Live fixture: expire a licence and an E&O policy, assert `canWrite()` flips false for every affected state and stays true elsewhere |
| 4 | Expiry warnings fire at **90, 60 and 30** days, **by email and in-app**, and **stop once renewed** | **unproven** | `scripts/send-appointment-expiry-warnings.mjs` / `npm run appointments:warn` exists. Prove all three thresholds fire, prove both channels, prove idempotency (a second run does not re-send), and prove renewal stops them |
| 5 | Appointments are effective-dated — a policy written last year stays valid when an appointment is later **terminated** | **unproven** | Live fixture: back-dated policy, then terminate the appointment; assert the historical policy remains valid and `canWrite()` is false only from the termination date forward |
| 6 | **No module contains its own copy of the eligibility logic** | **not covered** | The single helper is `lib/appointments/service.ts` → `canWrite` and `lib/appointments/eligibility.ts` → `canWriteFromVault`. Scan for duplicated eligibility logic and report. Note that `components/app/lead-detail-workspace.tsx:55` defines a local, same-named `canWrite` that is a *role* gate, and `lib/entitlements/types.ts` exports a `canWrite` that is an *entitlement* gate — confirm neither re-implements appointment eligibility, and if the name collision is why nobody noticed, say so and rename for clarity |

## Part 6 — LA-0.6 · Contact & household model with dedupe

Goal per Notion: *one person is one record, no matter how many publishers sell them to us or how
many phone numbers they have.*

Notion's data block names `households`, `contacts`, `contact_phones`, `contact_emails`,
`field_schema`, `merge_log` — all present in the generated types. Assert the many-phone and
many-email model is actually used by the intake path and not bypassed by `contacts.primary_phone`.

| # | Acceptance criterion | Audit coverage | What you must produce |
|---|---|---|---|
| 1 | The same person with two different phone numbers **and a misspelled surname** is detected as a probable duplicate | fixture passed | Keep. Confirm the score is weighted across name, address, DOB and phone — not exact-match on any single field |
| 2 | A husband and wife at one address are **two contacts in one household** — not merged into one person | **unproven** — the audit calls this out | Live fixture: two adults, same address, different first names and DOBs; assert two `contacts` rows and one `households` row, and that auto-merge did not fire |
| 3 | Auto-merge only fires above the confidence threshold; everything else goes to the agent | partial | Prove all three outcomes: high → auto-merge, medium → flagged for confirmation, low → new record. State the threshold values |
| 4 | A merge can be undone and both original records return **intact** | fixture passed | Keep. Assert the merge is a link, not a deletion — source rows survive and `merge_log.reversed_at` is set |
| 5 | Duplicate detection over **20,000 existing contacts returns in under 500ms** | **unproven** — the audit calls this out | Seed 20,000 contacts into an isolated fixture tenant, run `findDuplicates`, report p50 and p95 in ms against the 500ms budget, then remove the fixture. If the budget is missed, add the index or rework the query — this runs while a live transfer is ringing |
| 6 | Custom fields survive a **CSV import round-trip** | **unproven** in the browser | `app/app/(shell)/import/` and `app/api/app/leads/import/` exist. Prove export → import → export is lossless for JSONB custom fields plus their `field_schema` definitions, in the browser, with a schema containing every field type |
| 7 | **No cross-tenant match is ever possible, verified by test** | fixture passed | Keep, and make it a permanent test in the suite rather than a one-off fixture |

Also from Notion: `findDuplicates(contact)` must be **one implementation** that both acquisition
paths call. Prove there is exactly one, and that both paths reach it.

## Part 7 — cross-cutting items the audit left open

1. **Supabase security advisors.** The audit resolved the `platform_outbox_events` RLS gap and
   explicitly deferred the rest: policy-less RLS-enabled tables (the traceability doc counts 53),
   security-definer functions executable by `anon` (28) and `authenticated` (43), six
   mutable-`search_path` functions, extensions in `public`, and disabled leaked-password
   protection. LA-0.2's "no cross-tenant access" and LA-0.6's "no cross-tenant match, ever" both
   rest on this. Produce a prioritised remediation plan in `docs/architecture/security.md`
   separating (a) findings that can break a LA-0 acceptance criterion — fix these now — from
   (b) pre-existing platform findings needing a separate hardening decision. Fix group (a).
2. **Settings panels removed rather than fixed.** The audit removed later-module settings panels
   from the LA settings page because their live schema is not deployed. Confirm nothing an LA-0
   acceptance criterion needs was removed with them, and leave a note in the code saying why each
   is absent and what restores it.
3. **The demo-QA capacity migration** (`20260910140000_demo_qa_entitlement_capacity.sql`) is
   scoped to one named tenant so that 10 members fit a 25-seat entitlement. Confirm it is a
   fixture correction and not masking a seat-counting bug. If seat counting is wrong, fix the
   counter.
4. **Later organization-era modules** (pipeline, buffer) currently sit on LA-0 compatibility read
   models returning a safe empty state. Keep them out of this scope, but state clearly in the
   final report that they are not claimed production-complete.
5. **Wire everything into CI.** Every test and script you add must be reachable from `npm test`
   or a named `npm run verify:*` script, and `npm run verify:all` must include it. Prefer a
   single `npm run verify:la0` that runs the whole LA-0 matrix.

## Deliverables

1. Code, migrations, tests and scripts for everything above.
2. **Rewrite `docs/qa/LA-0.1-0.6-QA-AUDIT.md`** as an acceptance-criterion-level matrix: one row
   per Notion acceptance criterion, not one row per task, each with `PASS` or `BLOCKED` and its
   evidence artifact. A task is `PASS` only when every one of its criteria is `PASS`.
3. A short `docs/qa/LA-0-NOTION-DELTA.md` recording, per task, any place the implementation
   diverges from the Notion text — including anything Notion put **out of scope** that the code
   does anyway, and any criterion whose wording is too vague to test. These are decisions for the
   product owner, not for you to resolve silently.
4. A final run of the full gate: lint, typecheck, `npm test -- --runInBand`, build,
   `db:check:deep`, `check:features`, `verify:la0`, `verify:all`. Paste the real output. If
   anything fails, say so with the output — never summarise a failure as a pass.
5. A commit on the current branch describing what became provable. **Do not push, open a PR, or
   write to Notion without asking first.**

## Definition of done

Every acceptance criterion on all six Notion pages is either `PASS` with a named artifact, or
`BLOCKED` with a precise statement of the missing prerequisite and who can unblock it. No
criterion is left silently unaddressed, and no `PARTIAL` remains as a status — `PARTIAL` is what
this prompt exists to eliminate.

## Report back

- The criterion-level matrix, with PASS/BLOCKED counts per task.
- Anything you found that the audit did not mention.
- The architecture decision from Part 0.5, stated as a question for the user.
- What you deliberately did not do, and why.
