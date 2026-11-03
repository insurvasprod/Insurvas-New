# LA-0 — where the implementation and the Notion text diverge

Date: 2026-09-11. Companion to `LA-0.1-0.6-QA-AUDIT.md`.

These are product-owner decisions, not engineering choices to settle quietly. Each item says what
Notion asks for, what the code does, and what the decision is.

---

## 1. Two criteria are not buildable as written today

### LA-0.2 criterion 3 — "A `producer` cannot see another producer's commission figures"

`app/api/app/ledger/route.ts` and `app/api/app/policies/route.ts` are authorization frames that
return `entries: []` and `policies: []`. The route comments say so explicitly: *"the ledger module
is still a frame, but its authorization boundary exists now."*

The criterion is row-level. With no rows, it cannot be satisfied or falsified — the mechanism
(`roleCanViewCommission()` in `lib/tenantAuth/permissions.ts`) exists and is correct in isolation,
but nothing calls it because nothing returns commission data.

**Decision needed:** accept this criterion as deferred to the module that implements the ledger, or
descope it from LA-0. It cannot be closed inside LA-0 as scoped.

### LA-0.4 criterion 2 — "A commission figure anywhere in the product traces back to this table"

Same cause. The single source of truth is real and tested (`lib/carriers/resolve.ts`), and there is
no hardcoded percentage anywhere in a calculation path. But "a commission figure *anywhere in the
product*" presumes a rendered figure, and there is none.

**Decision needed:** split this criterion — the "never a hardcoded percentage" half is `PASS`
today; the "traces end to end" half belongs with the ledger.

---

## 2. Notion is silent where the code makes a policy choice

### `permissions.ts` and the route guards disagree about three routes

`lib/tenantAuth/permissions.ts` is the product's own statement of who may do what. Three routes do
not match it, and the routes are what a customer actually gets:

| Route | Guard | `permissions.ts` says | Effect |
|---|---|---|---|
| `app/api/app/leads/export/route.ts` | `requireFeature` only — no role gate | `exports.run` is owner and bookkeeper only | an `assistant` can export the entire lead book as CSV |
| `app/api/app/leads/route.ts` | `requireFeature` only | `leads.manage` excludes `bookkeeper` | a `bookkeeper` can read and create leads |
| `app/api/app/leads/draft/route.ts` | `requireFeature` only | as above | as above |

None of these is an LA-0.2 criterion-1 violation: lead data is not commission data, and the new
`lib/tenantAuth/moneyRoutes.test.mjs` classifies them as neutral deliberately. But the lead export
is the kind of thing an agency would consider confidential, and the menu hides these from the wrong
roles — which LA-0.1 criterion 2 tells us is not protection.

**Not changed on purpose.** Adding a role gate to `leads/route.ts` would break the assistant's
documented core workflow ("data entry, lead management"). Tightening `leads/export` would not, and
is probably right. Both are product calls.

### `public.users` still carries a legacy role column

LA-0.2 requires the role on `tenant_users`, "not as a column on `users` — one person may later work
for two agents." `resolveTenantContext()` correctly reads `tenant_users.role`, so the criterion's
intent holds.

But `public.users` still has `users_role_id_fkey` referencing a `roles` table, left from the
organizations era. It is unused by LA-0 and harmless today; it is also exactly the column the
criterion warns about, sitting one query away from being used again.

**Decision needed:** drop it as part of the tenant/organizations convergence, or document it as
permanently dead.

---

## 3. Notion asks for something that does not exist yet

### LA-0.2 criterion 2, second half — "cannot play a recording"

There is no call-recording endpoint anywhere in `app/api`. The bookkeeper half of this criterion
that concerns the dialer is provable and passes; the recording half has no surface to refuse.

`moneyRoutes.test.mjs` already matches `/recording/`, so the day such a route appears it is covered
without anyone remembering to come back. That is the most that can be done now.

**No decision needed** — just do not read the dialer pass as covering recordings.

---

## 4. A criterion whose wording cannot be tested as written

### LA-0.3 criterion 5 — "The page loads in under 1 second"

No environment, data volume, network condition, or cold/warm distinction is specified, and a
dashboard's load time depends on all four. The number is also unmeasured: nothing in this repo has
ever recorded one.

**Recommendation:** restate as a measured budget — for example "p95 server response under 1s for a
tenant with 10,000 contacts, warm, measured locally" — so that it can pass or fail rather than be
asserted. Until then it is untestable, not merely unproven.

### LA-0.5 criterion 2 — "The grid can capture 40 appointments in under two minutes"

Two minutes is a human-throughput claim, so it depends on who is typing. The bulk API already does
40 rows in one request, which is the engineering substance. The timed run is worth doing once as a
usability observation, but it should not gate acceptance on a stopwatch.

**Recommendation:** keep the 40-rows-in-one-request assertion as the criterion, and record the
timed run as a usability note.

---

## 5. Things Notion put out of scope that the code does anyway

Checked, and there is nothing to report. Specifically:

- **LA-0.2, "custom roles or per-permission toggles" (out of scope)** — `TENANT_PERMISSIONS` is a
  fixed compile-time list mapped from four fixed roles. No runtime configurability exists.
- **LA-0.2, plan-limit enforcement (out of scope)** — seat counts are reported, never enforced.
- **LA-0.3, "charts and trend lines" and placeholder tiles (out of scope)** — the registry holds
  exactly two tiles, both LA-0 setup tiles. No retention or money tile placeholder exists.
- **LA-0.6, "cross-tenant matching — never"** — enforced in the RPC's own `where` clause.
- **LA-0.4, "rate tables and quoting maths" (out of scope)** — `lib/carriers/resolve.ts` resolves a
  stored schedule and converts to cents. It does not quote.

---

## 6. One process finding, not a spec divergence

The six tasks are all marked **Completed** in Notion. On the evidence in
`LA-0.1-0.6-QA-AUDIT.md`, none of them meets its own acceptance criteria yet — 21 of 42 criteria
are blocked, and one blocker (no user can be created on the live project) means the agent
application's signup and invitation paths do not work in this environment at all.

The gap was not sloppy implementation. It was that four verify suites carrying most of the proof
were never added to `verify:all`, so nobody found out. The `verify-all.mjs` header already
described this exact failure happening once before — *"ten of the twenty-one had simply never been
run"* — which suggests the wiring step needs to be part of the definition of done for a suite, not
a follow-up.

**Recommendation:** move the six Notion statuses off Completed until the audit shows them green,
and add "wired into `verify:all`" to the checklist for any new verify suite.
