# Getting the verification baseline green

**Written:** 2026-09-13 · **Scope:** the 14 suites failing in the 73-suite run of 2026-09-13
· **Purpose:** turn a run nobody can read into a run that means something, so that LA-2 work can be
trusted.

---

## Why this, before LA-2

Right now `npm run verify:all` reports **14 of 73 suites failed, 929 checks passing, 28 failing**.
That number is the problem, not the 28 checks.

While eleven-ish suites are red for reasons nobody has written down, a new red suite during LA-2
work is ambiguous: it might be the new feature, or it might have been red all along. Every LA-2 task
pays that tax, and the tax compounds — by the end of the module nobody can attribute anything.

A green baseline is worth roughly a day and makes every subsequent task cheaper to verify. It is
also the only honest starting point, because **every LA-1 task marked Completed turned out to have
gaps when its acceptance criteria were actually read.** SA's 42 Completed tasks have never been
scored against criteria at all.

## Current remediation checkpoint — 2026-09-14

The repository is locally regression-green: `npm.cmd test` passes 499/499, TypeScript, lint, build,
and `check:features` pass, and the Next.js middleware convention has been migrated locally to
`proxy.ts`. The shared Supabase project remains the limiting boundary: read-only inventory reports
24 missing application RPCs, 8 incomplete tenant-access declarations, and 25 missing declared
triggers. Authenticated admin QA also reached the mandatory MFA step but cannot be accepted without
a valid disposable authenticator session. These are current evidence boundaries; the historical
baseline numbers below are retained for comparison.

---

## Rules of engagement

These are not style preferences. Each one is here because breaking it cost real time in the audits
that produced this list.

### Diagnosis

1. **Read the acceptance criteria first**, from Notion, before running anything. A suite passing is
   not evidence that the criteria are met — `verify-agent-alerts` passed eight booleans while
   covering none of its six criteria.
2. **Get the real error.** Most failures in this repo surface as
   `TypeError: Cannot read properties of null` because the code destructures `const { data } = await …`
   and discards `error`. Before diagnosing anything, restore the error branch and re-run. The real
   message is almost never what the log first says.
3. **Check the server log, not just the suite output.** `verify:checkout` said
   `{"error":"Could not open checkout"}`; the dev-server log said
   `Whop 404 — This Plan was not found`. The second is the finding.
4. **Suspect the fixture before the product.** Two suites were reported red this week for product
   reasons that were actually fixture pollution: a leftover plan with `sort_order = 0` sorting ahead
   of Basic. Ask "what does this suite pick, and could something else have made that choice wrong?"

### Fixing

5. **Fix at the layer that owns the rule.** If a constraint and the code disagree, decide which is
   correct on the merits and make the other match — do not weaken the constraint to pass a test.
   `platform_invoice_lines_amount_sign` won because lines summing to the invoice total is a property
   worth having, not because it was newer.
6. **Grep the migrations for the object name before writing a new one, and read every hit in order.**
   A later-sorting migration replaying a pre-fix definition has silently reverted work three times in
   this repo. The rule is written into `20260912440000`.
7. **This application's objects move; nothing outside this repo changes.** Establish ownership per
   object (does a migration in `supabase/migrations` create it?) before touching anything the
   organizations-era CRM might own.
8. **Never write shared state from a verification suite.** A suite may create and remove its own
   rows. It must not rewind a counter, toggle a global switch, or edit a production record — see
   backlog 194, where a rewound invoice counter broke invoicing for the whole system.

### Verifying

9. **Every migration carries its own assertions**, and they must fail loudly. A `do $$ … raise
   exception` block that checks the thing the migration claims to have done. Preconditions too:
   refuse to run if the world is not as the migration assumes.
10. **Assert against data, never against the thing under test.** A hardcoded `immutable: true` read
    back as evidence proves nothing. Probe a tenant that actually has partners, not any tenant.
11. **Run the suite alone, then in the full run.** Several suites pass alone and fail in sequence
    (backlog 192). Both results are information; only the second is the baseline.
12. **Record the correction when the first diagnosis was wrong.** Backlog 191 and 189 both carry the
    account of how their first draft was wrong, because the way a diagnosis fails is usually more
    reusable than the fix.

---

## The work, cluster by cluster

Ordered by *root causes*, not by suite. Several suites share one cause; two are not work at all.

### Already fixed since the run — re-verify only

`kill switches` is in the runner's list of 14 but was repaired after it ran: it was picking a
leftover fixture plan with `sort_order = 0` and reporting `grants no features`. It now names its
plan and goes straight to the Auth-first path; `npm run verify:switches` exits 0. `system
maintenance` and `credits & limits` had the same picker fault fixed, which is why their entries
below start with "re-run first".

The twelve fixture plans that caused it are archived, and `verify-period-billing` now archives its
own plan when it cannot delete it.

### 0. Not work — confirm and annotate

| Suite | Why it is red | Action |
|---|---|---|
| `npm.cmd run check:triggers` | Red **by design** — backlog 183's missing `*_touch_updated_at` triggers | Confirm the count still matches the declared migration inventory. If it does, leave red and say so in the run's own output. |
| `LA-1.24 existing-customer preflight` | 525.9ms against a 500ms budget, 20,001 contacts | Re-run three times on a quiet system. If it lands under 500ms it was load; if it sits at ~525ms it is backlog 177's sibling and gets its own entry rather than a silent fix. |

**Verify:** these two are explicitly listed as expected-red in the run summary, so nobody re-diagnoses
them next month.

---

### 1. SA-1 user integrity — 7 checks, one cause

```
FAIL deactivation succeeds through the guarded route — {"error":"User not found"}
FAIL reactivation succeeds through the guarded route — {"error":"User not found"}
FAIL repeating the same lifecycle action is refused — {"error":"User not found"}
```

Seven checks, one message. The suite creates a user and the guarded route cannot find it.

**How I check:** create the fixture exactly as the suite does, then query `users`, `auth.users` and
`tenant_users` for that id directly. The likely candidates, in order: the route resolves the user
through a view or a tenant scope the fixture is not in; or the fixture is created without the
membership the route joins on; or `createFixtureUser` is not being used and the row is half-made.

**How I verify:** the three lifecycle checks pass, *and* a deliberately absent user still returns
`User not found` — otherwise the fix has just made the guard permissive.

**Done when:** `verify:user-integrity` exits 0 and the not-found path is still proven.

---

### 2. Offers — 5 checks, one cause

Every failure carries the same tenant id (`2717a03b…`), which says one fixture is wrong rather than
five rules. Backlog 178 already records that handoff offers are created but never listed.

**How I check:** run the suite alone with the error branches restored; read what that tenant's offer
rows actually look like versus what the suite expects. Establish whether 178 is the same defect —
if so, this closes 178 rather than adding an entry.

**How I verify:** the redemption cap and the end-date rule are each proven with a *negative* case,
because a filter that silently returned nothing would pass a weaker check.

---

### 3. Credits & limits — 4 checks

```
FAIL the grant reaches the CACHED entitlement the agent's screen reads — cached included = undefined
FAIL buying a pack actually grants the credits — included went null -> 0; the pack is 100 tcpa_checks
```

`null -> 0` and `undefined` are the interesting parts: the grant is being applied to something the
entitlement cache does not carry, so the agent's screen would show nothing.

**How I check:** grant a credit pack, then read the raw row, the entitlement blob and the usage
monitor in that order. The divergence point names the layer. Note the fixture picker was just
changed to name `basic` explicitly — re-run first, because the previous run used a plan with no
meters at all.

**How I verify:** the same three reads agree after the grant, and the usage monitor's number is the
one the screen reads — not a second query that happens to agree.

---

### 4. Compliance vendors + dial preflight — 3 checks, shared environmental cause

```
FAIL last enabled DNC vendor requires consequence confirmation — status 200
FAIL no enabled DNC vendor blocks the dial — live fixture already has an enabled DNC vendor;
     no vendor state was changed by this script
```

The dial-preflight message is the suite telling us honestly that it refused to touch live vendor
state — which is correct behaviour and the right instinct (rule 8).

**How I check:** determine whether a *disposable* vendor can be created for the test rather than
mutating the live one. If it can, both suites become self-contained. If the platform genuinely has
one global vendor registry with no tenant scoping, that is a product finding, not a test problem,
and gets an entry.

**How I verify:** run both suites twice in a row. A suite that mutates shared vendor state passes
the first time and fails the second; a self-contained one passes both.

---

### 5. System maintenance — 5 checks, announcements

```
FAIL admin can create an announcement
FAIL active announcement reaches the tenant
FAIL dismissal succeeds
FAIL plan-targeted announcement excludes a different plan
```

The fixture bug is already fixed — this suite used to die on `cycle_not_offered` and now reaches its
criteria. These four are real and untouched.

**How I check:** exercise `POST` announcement through the route with the error branch restored; the
first failure is upstream of the other three, so fix in order and re-run between each.

**How I verify:** the plan-targeting check is the one that matters — it must be proven with a tenant
on a *different* plan, because a targeting bug that showed the announcement to everybody would pass
a check that only looks at the intended tenant.

---

### 6. Agent templates — 1 check

```
FAIL onboarding GET creates a tenant-owned working copy
```

Relates to backlog 171 (one template per product per version makes duplication impossible).

**How I check:** call the onboarding GET and inspect what it writes. If the unique constraint from
171 is what blocks the copy, this is 171 surfacing and should close it.

---

### 7. LA-0.6 contacts & dedupe — 1 check

```
FAIL misspelled surname and second phone are detected — outcome: auto_merged
```

The dedupe returned `auto_merged` with `score 0.8654, confidence high`, where the suite expects the
misspelling to be *detected* rather than silently merged. Backlog 190 records that a dedupe restore
was never applied.

**How I check:** grep `supabase/migrations` for the dedupe function and apply every hit in order
(rule 6). This is the exact shape of defect that rule exists for.

---

### 8. SA-5.1 rate limits — 1 check

```
FAIL the first five are let through to the plan check — got 400, 400, 400, 400, 400, 429, 429
```

The limiter is working (429 after five). The five before it answer **400, not 409** — so the request
is being rejected by validation before it reaches the plan check the suite is measuring.

**How I check:** this is most likely the suite sending a payload that no longer validates — the
signup schema has changed this week. Compare the suite's body against `publicSignupSchema`.

**How I verify:** a deliberately invalid payload still gives 400, and a valid one gives 409. If both
give the same status the check is not measuring anything.

---

### 9. LA-1 database security — `search_path`, and the empty string matters

```
AssertionError: The input did not match the regular expression /search_path=pg_catalog/
  actual:   ''
  expected: /search_path=pg_catalog/
```

Node `assert`, so it throws on the first failure and reports nothing else — this suite may be hiding
further failures behind this one.

**`actual: ''` is the lead, and it has two readings**, which need different fixes:

    the function exists, with no search_path pinned   -> add `set search_path`
    the query returned no row at all                  -> the function is missing entirely

The second is the one to rule out first, because it would be backlog 190 again (two functions were
already found provably missing). Read `scripts/verify-la1-database-security.mjs:34` for which object
it is querying, then check `pg_proc` for that name directly before assuming anything.

**How I check:** establish ownership per function (rule 7). Ours get `set search_path`; the CRM's are
recorded, not touched — backlog 175 covers the 32 organizations-era definer functions.

**How I verify:** re-run and confirm the suite gets *past* this assertion, then read whatever it
reports next. A throwing suite's first pass is never its full result.

---

### 10. SA-5.2 checkout — 5 checks — **NOT MINE TO FIX**

Backlog 195: every plan is mapped to a placeholder Whop id (`plan_demo_m_0`), so the provider answers
`404 This Plan was not found` and no checkout opens for anybody.

Backlog 196 must be fixed **first**: Advance is mapped at $499 against a published $449. While 195
stands nobody is charged either price; the moment 195 is fixed, the overcharge goes live.

**Owner:** whoever holds the Whop account. This blocks revenue but does not block me.

**How I verify once done:** `verify:checkout` exits 0, and a real checkout URL comes back from the
provider rather than a mocked one.

---

## The loop, per cluster

```
1  read the criteria           Notion first, then the suite's own comments
2  reproduce alone             npm run verify:<suite>, error branches restored
3  find the real error         suite output + dev-server log + the DB
4  decide the layer            migration / service / route / suite fixture
5  fix                         with assertions if it is a migration
6  verify alone                the suite exits 0, and the negative case still fails
7  verify in sequence          re-run after the next cluster, to catch interference
8  record                      backlog entry: what it was, why, and what it cost
```

**Between clusters:** `npm run typecheck`, `npm run lint`, `npm test`. All three clean before moving
on. A cluster is not finished while the next one starts on a dirty tree.

**After every three clusters:** a full `npm run verify:all`, because suites interfere (backlog 192)
and a suite that passes alone is not yet evidence.

---

## Exit criteria

The baseline is green when:

- `npm run verify:all` exits **0**, or exits non-zero **only** on suites listed here as
  expected-red, and the run's summary says which and why.
- `npm run typecheck`, `npm run lint`, `npm test` are clean.
- Every fix has a backlog entry, and every entry whose first diagnosis was wrong says so.
- No suite writes shared state it does not own — verified by running the full suite **twice
  consecutively** and getting the same result. This is the check that would have caught the invoice
  counter, and it is the one I most want in place before LA-2.

That last line is the real exit criterion. A run that is green once is a run that got lucky.

---

## Then, and only then

**LA-2.** With a green baseline, a red suite during LA-2 means LA-2 broke it — which is the entire
point of the exercise.

Carrying forward as known-open, not silently:

| Item | Why it stays open |
|---|---|
| 195 / 196 | Yours — payment provider configuration |
| 183 | 20 missing triggers, deliberate |
| 190 | Nothing records which migrations are applied — the largest systemic risk |
| 7 blocked LA-1 criteria | 4 share one missing browser harness (`context.grantPermissions(["notifications"])`) |
| SA-6.2, SA-6.3 | Never built |
| SA's 42 Completed tasks | Never scored against criteria — the biggest unknown in the project |

That last row is worth a decision of its own, separately from LA-2. It is not urgent and it is not
small, and it is where the unknown risk in this project is concentrated.

---

## Out of scope, deliberately

**The remaining 81-page walkthrough.** The money path has been walked and produced 195 and 196. The
rest is largely covered by suites, and the expensive defects in this codebase have consistently been
structural — a renamed table nothing repointed, a trigger that made invoices impossible, a counter
rewound by a test. None of those are visible by clicking.

If a specific screen is suspected, it gets walked then. Walking all of them on spec is not how this
codebase has yielded its bugs.

---

## Status: deferred, and the baseline recorded as known-red

**2026-09-13.** LA-2 was chosen over this plan. That is a deliberate decision and this document is
the record of what was deferred, not an objection to it.

The eleven suites below were red **before any LA-2 work began**. A red suite during LA-2 that is not
on this list is an LA-2 regression; one that is on it is pre-existing. That distinction is the whole
reason for writing this down now rather than later.

    declared triggers                     red by design (backlog 183)
    offers                                5 checks, one fixture
    agent templates                       1 check, relates to backlog 171
    compliance vendors                    2 checks, shared vendor registry
    dial preflight                        1 check, same cause
    credits & limits                      4 checks, picker fixed, unverified
    system maintenance                    5 checks, picker fixed, announcements real
    LA-0.6 contacts & dedupe              1 check, backlog 190
    LA-1.24 existing-customer preflight   525.9ms against a 500ms budget
    LA-1 database security                search_path assertion, `actual: ''`
    SA-1 user integrity                   7 checks, one cause
    SA-5.1 rate limits                    1 check, likely a stale payload
    SA-5.2 checkout                       5 checks, backlog 195 — owner: Whop account

`kill switches` was in the run's list of 14 and has since been fixed; it exits 0.

Baseline for comparison: **14 of 73 suites failed, 929 checks passing, 28 failing, 1835.7s.**

---

## Follow-up audit — 2026-09-13

The plan was executed against the correct checkout. The aggregate run now passes **63 of 73
suites**; ten remain red. Focused reruns passed the scoped fixes for user integrity, credits and
limits, system maintenance, rate limits, agent templates, contacts, partner chat, invoices,
payments, coupons, credit notes, subscription transitions, legal acceptance, and feature
consistency. The remaining ten aggregate failures are recorded in
[`docs/qa/SA-0.1-SA-5.5-QA-AUDIT.md`](SA-0.1-SA-5.5-QA-AUDIT.md).

The remaining red results are not all application defects: the live DDL role cannot apply pending
additive migrations; the shared DNC registry already contains an enabled vendor; the Whop account
does not contain the configured placeholder plan IDs; aggregate sequential load exceeds two
performance budgets; and 20 declared touch triggers remain absent from the live database. No shared
vendor, billing counter, or unrelated record was mutated to make the run green.

The repository baseline is locally healthy: `npm.cmd test` passes 439/439, TypeScript passes, lint
passes, the production build passes with the existing middleware deprecation warning, and
`npm.cmd run check:features` passes with 28 active features and no catalog/menu/API drift. This
follow-up is a factual reduction of the red baseline, not a full acceptance of SA-0.1 through
SA-5.5; the task classifications and missing browser/live evidence remain in the audit report.

The read-only `qa:sa-matrix` verifier was hardened on 2026-09-13. It now fails when the local
application cannot be reached or when required role sessions are unavailable. Its prior false-green
behavior (exit 0 with only `ERR fetch failed` probes and missing support/billing sessions) is fixed;
the current run correctly exits non-zero until the app listener and role fixtures are available.

## Remediation continuation — 2026-09-14

The focused follow-up continued into the remaining LA-1 workflows. `verify:partners`,
`verify:partner-users`, `verify:partner-products`, `verify:verification`, `verify:deal-flow`,
`verify:buffer-handoff`, `verify:agent-floor`, `verify:partner-quality`, and
`verify:subscription-limits` now pass against namespaced fixtures. The partner-quality verifier was
corrected to use PostgreSQL UTC date semantics, matching the live `created_at::date` predicate;
the report itself was not weakened.

The current red paths are isolated and remain open: screening/affiliate-dependent flows fail closed
because `consume_meter_capacity` is absent from the shared project; offers use the older live
precedence function; the live disposition-note function lacks its pinned search path; transfer-inbox
timing exceeds the target in the remote shared environment; compliance/dial tests are blocked by an
already-enabled shared DNC vendor; and checkout is blocked by the Whop placeholder-plan mapping.
These are recorded in [`MASTER-GAP-BLOCKER-REGISTER.md`](MASTER-GAP-BLOCKER-REGISTER.md), with no
shared-state mutation or unsafe migration used to make the suite green.

Fresh aggregate checkpoint (2026-09-14): `verify:all` completed 73 suites with 57 passing and 16
remaining red. The red suites are `RPC contract`, `tenant_app access`, `declared triggers`, `offers`,
`compliance vendors`, `dial preflight`, screening-dependent LA-1.4/1.5/1.6/1.7/1.8 flows,
`LA-1.10 transfer inbox`, `LA-1.24 existing-customer preflight` under aggregate contention,
`LA-1 database security`, and `SA-5.2 checkout`. The focused LA-1.24 rerun passes its 20,000-contact
under-500-ms gate, so its aggregate result is retained as performance/environment evidence rather
than a confirmed query regression. The intake verifier now exits cleanly with the screening
prerequisite failure instead of throwing a secondary TypeError.
