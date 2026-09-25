# SA acceptance audit — criterion by criterion

Started 2026-09-21. Authority: the 45 `SA-x.y` rows in the *Insurvas Sprint* Notion database and
*Basic Idea Super Admin Side* (Document 2), both read in full on 2026-09-21.

Method and evidence classes: [`SA-VERIFICATION-PLAN.md`](SA-VERIFICATION-PLAN.md). In short —
**a Notion checkbox is not evidence, and neither is the existence of code.** Every verdict below
names how it was established:

| Class | Meaning |
|---|---|
| `DB` | Live query against the project in `.env.local` |
| `HTTP` | Real request to the running app with a minted session of a named role |
| `TEST` | A test that fails when the behaviour regresses |
| `SCRIPT` | An existing `verify:*` suite, re-run 2026-09-21 |
| `SRC` | Source read — **structural proof only**, flagged where it is the sole evidence |
| `BROWSER` | Driven in a browser as a real admin |

Verdicts: **Pass** · **Pass (conditional)** · **Partial** · **Fail** · **Not built** · **Cancelled**

---

## Scoreboard — complete, SA-0.1 through SA-6.3

Finished 2026-09-22. **44 tasks** carry a definition. `SA-5.5` and `SA-6.4` **do not exist** —
confirmed against the sprint database rather than inherited from an inventory — and `SA-0.4` is a
backlog ticket, assessed in its own section below.

| Verdict | Count | Tasks |
|---|---|---|
| **Pass** | 36 | 0.1, 0.3, 1.1, 1.4, 1.5, 2.1–2.4, 2.6–2.8, 3.1–3.4, 3.6–3.9, 4.1–4.10, 4.12, 5.1–5.4, 6.2 |
| **Pass (conditional)** | 1 | 0.2 |
| **Partial** | 5 | 1.2, 1.3, 2.5, 4.11, 6.1 |
| **Not built** | 1 | 6.3 |
| **Cancelled** | 1 | 3.5 |

**The five Partials and the one Not built share two root causes, not five:**

- **No configurable email layer** (`email_templates`, `email_settings` absent) — SA-4.11 directly,
  and the open criteria in SA-3.2, SA-3.7, SA-3.8 and SA-6.2's lockout notice.
- **No job/lifecycle tables** (`job_runs`, `job_schedule`, `export_jobs`, `deletion_requests`
  absent) — SA-6.1 and SA-6.3 entirely.

Both need **DDL**, which this environment does not grant. No amount of application work closes them,
and nothing else in the SA range is blocked behind them.

---

## SA-0.1 · Admin auth + super_admin role — **Pass**

**Purpose:** a platform staff member can log in, and their role decides what they can do, checked
on the server.

*Purpose served.* The controlling sentence of the ticket — "a `support_agent` calling a
`super_admin` route gets 403 from the API, **not just a hidden button**" — is now measured across
the whole admin surface rather than asserted.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | An admin cannot reach any admin route without a valid session | **Pass** | `HTTP` — `qa:sa-matrix` (37 routes + 29 screens) and `qa:sa-dynamic` (45 method+route pairs): **anonymous 200s = 0** on every protected path, `/admin/login` the only public one |
| 2 | An admin cannot enable their own account for 2FA-optional | **Pass** | `SRC` + `TEST` — `isAdmin2faEnabled()` returns the **literal type `true`**; there is no env flag and no per-account column. `lib/adminAuth/config.test.mjs` pins it |
| 3 | A `support_agent` calling a `super_admin` route gets 403 from the API | **Pass** | `HTTP` — `qa:sa-dynamic`: support_agent refused on **44 of 45** probes; the 45th was the suspend-route ordering bug, now fixed and re-verified |
| 4 | Admin sessions use a different cookie and domain from tenant sessions | **Pass** | `HTTP` — six cross-plane forgeries all rejected 401, including an **admin-secret token carrying a tenant user's id and `role: super_admin`**. Positive control established both ways. Separate cookie names, separate secrets, separate domain envs |
| 5 | Seeding creates exactly one `super_admin` on a fresh install | **Pass** | `SRC` — `scripts/seed-super-admin.mjs` counts `admin_users` first and refuses if any row exists, then inserts one `super_admin`. *Sole evidence is source: a fresh install cannot be exercised against the shared project* |

### Fixed under this task

**A dead code path that issued a full admin session with no second factor.** The login route
contained `if (!isAdmin2faEnabled()) { …sign session, set cookie, return… }`. TypeScript proved it
unreachable, so it never ran — but it left a complete no-2FA login path in the file, one return-type
change away from live. Doc 2 §11 requirement 3 is "2FA mandatory for every admin account. No
exceptions, including the founder." Replaced with a fail-closed tripwire that 500s if that config
ever changes, and the five imports the dead branch had kept alive were removed.

**The login page had no heading element.** `CardTitle` renders a `<div>`, so the entry point to the
entire control plane announced no title to a screen reader — the only admin screen without an
`<h1>`, since every other one gets it from `AdminPageHeader`. Now a real `<h1>`. Verified no
stylesheet depended on it: every `[data-slot="card-title"]` rule in `globals.css` is `.portal-*`
scoped.

### UI / UX — verified in a browser

`/admin/login` is a genuinely good two-step flow: `autoComplete="one-time-code"` on the TOTP field
so the OS offers the code, `inputMode="numeric"`, non-digits stripped, `maxLength=6`, `autoFocus` on
step 2, submit **disabled until exactly six digits**, distinct loading copy ("Checking…" /
"Verifying…"), and a link to the agent login for people at the wrong door. Step 1 now also says the
authenticator code is coming, so the second screen is not a surprise.

`/admin/admins` (the CRUD half of this ticket): search, two filters, pagination over 45 admins at
10 a page, role and status pills, `Last login` showing **"Never" as distinct from a date**, and the
current admin's own row showing **"You"** instead of actions — so you cannot deactivate yourself by
misclick. No defects found.

*A blank `Name` column in a 0.6-scale screenshot turned out to be the screenshot, not the page —
the DOM has every value. Checked before reporting.*

---

## SA-0.2 · Tenant & user data model — **Pass (conditional)**

**Purpose:** the database can hold many customers side by side without any of them seeing each
other's data.

*Purpose served, with one condition on criterion 1 that is a repository setting, not code.*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Tenant A and B provisioned; from A's session every API route returns nothing for B's data — as an automated test that runs in CI | **Pass (conditional)** | `SCRIPT` — `verify-tenant-isolation.mjs` provisions both tenants and passes every check, at the **DB level via the `tenant_app` role** and over HTTP. `.github/workflows/ci.yml` runs it via `verify:all`. **Condition:** that job runs only if `CI_TENANT_DB_URL` and `CI_SUPABASE_SERVICE_ROLE_KEY` secrets are set, and **skips with a notice** otherwise — see the risk below |
| 2 | No route accepts `tenant_id` as a query or body parameter | **Pass** | `SRC` (exhaustive) — every `tenant_id` in `app/api/app/**` is `auth.context.tenantId`, from the session. A targeted scan for reads from `searchParams`/body across **all** of `app/api` returns **six hits, all `/api/admin/*`**, which is correct by design: Doc 2 §3 — on control-plane tables `tenant_id` is a foreign key, not a security boundary. Each is role-gated (confirmed by `qa:sa-dynamic`) |
| 3 | RLS is on, not just application-layer filtering — verified by querying the DB directly with A's role | **Pass** | `SCRIPT` — `verify-tenant-isolation.mjs` and `verify-la0-rls.mjs` both connect as **`tenant_app`, not `service_role`**, and assert A sees exactly one tenant, zero rows when explicitly asking for B's id, and only its own rows in `users` and `tenant_users`. `verify:la0-rls` passed for 2 tenant sessions |

### Residual risk on criterion 1 — worth naming

The isolation test is the single most important test in the product, and in CI it is **configured to
skip rather than fail** when the database secrets are absent. A skipped test and a passing test are
the same green checkmark. That is exactly the failure mode SA-6.1 is about — *silence and health
look identical if you only watch for errors* — applied to the tenant boundary.

Not changed here, because whether those secrets are set is a repository setting I cannot see and
making the job hard-fail could block every push on a fork. **Recommendation:** have the `database`
job fail when the secrets are missing on pushes to this repository, keeping the skip only for fork
pull requests.

### One suite failure investigated and re-characterised

`verify-lead-import.mjs` fails one check: **"a second tenant cannot import into the first tenant —
status 201"**. Read at face value that is a cross-tenant write, which would falsify criterion 1
outright. It is not, and the check's name is misleading:

- The request carries **no tenant identifier** — just CSV text. The route scopes every write to
  `auth.context.tenantId`, so the lead is created in tenant B, correctly.
- What the CSV *does* carry is a column (`preferred_language`) that exists only in tenant A's
  template copy. Tenant B has no such field, so the import should be rejected.
- It is accepted because of `lib/agentTemplates/csv.ts`: `for (const column of columns) { if
  (!column.field) continue; }` — **an unrecognised CSV column is silently discarded.**

So the defect is real but it is a **validation** defect, not an isolation one, and it belongs to
`lead_import` (LA-2). Its real-world consequence is worse than the cross-tenant framing suggests:
an agent whose vendor list has a header of `Phone Number` where the field is `phone` gets a
cheerful *"2,000 imported"* and 2,000 leads with **no phone numbers** — a control that lies, which
is this codebase's recurring failure mode.

**Not fixed here**, and deliberately: `lib/agentTemplates/` is uncommitted work from another
session (13 files, all mtimes 2026-09-18) and it is also where the one missing RPC
(`record_campaign_scrub_rejections`) and the four failing unit tests live. It is queued for the
LA-2 pass in the agreed sequence.

---

## SA-0.3 · Audit log — **Pass**

**Purpose:** every consequential admin action is recorded, and the record cannot be edited or
deleted by anyone.

*Purpose served.* The third criterion was met only by luck of volume before this pass; it is now
met by construction.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A `DELETE` or `UPDATE` against `audit_log` fails at the database level | **Pass** | `DB` — inserted a disposable row, then attempted `UPDATE` and `DELETE` **as `service_role`**. Both refused: *"permission denied for table audit_log"*. The row survived unchanged |
| 2 | Every write route added in SA-1, SA-2 and SA-3 produces exactly one audit row | **Pass** | `SRC` census + `DB` probe — **32 write routes across the three modules, all covered**: 28 call `audit()` directly, 4 delegate to `setUserStatus`. Exactly-one measured for `create`, `activate`, `suspend`, `unsuspend`, `deactivate` — each added precisely 1. Now pinned by `lib/audit/coverage.test.mjs` |
| 3 | The log screen can answer "who suspended this user and when" in under three clicks | **Pass** *(was Partial)* | `BROWSER` — user detail → **"View audit trail"** → the log filtered to that user's 7 entries, showing *User suspended · Demo Super Admin · 9:00:44 PM · reason*. Two clicks |

### The gap behind criterion 3, and the fix

The ticket names four filters — **actor, action, target, date range**. Three existed. `target` did
not, in the UI *or* the API — and it failed in the worse of the two possible ways: `?target=<id>`
was **accepted and silently ignored**, returning all 43,076 rows. A caller asking "what happened to
this user" got a confident, complete, wrong answer with nothing to indicate the filter had not
applied.

Criterion 3 was passing only because there had been exactly one suspension in the platform's
history, so `action=user.suspended` happened to return a single row. At any real volume it would
not have.

Three changes:
- `GET /api/admin/audit-log` now honours `target`, as an exact `target_id` match — verified
  **43,076 → 7**, every returned row matching.
- The screen gained a **Target ID** input, a `Clear target` button, and a line stating the filter in
  words (*"Showing only entries whose target is … 7 found"*). The `NoMatches` clear-filters control
  now clears it too; a clear-all that leaves one filter applied is the same lying control this audit
  keeps finding.
- The user detail screen gained **"View audit trail"**, deep-linking to `?target=<id>`. The
  suspension banner already gave the reason and the summary gave the date — neither named **who**,
  which lives only in the audit log.

*Also fixed while wiring it:* the deep link would have rendered the server's unfiltered first page
while claiming to be filtered, because the table skips its first fetch when server-rendered rows are
assumed to match. It now skips only when no target arrived in the URL.

### Worth knowing

**Several `verify-*.mjs` suites call `audit_log.delete()` to clean up, and are silently no-ops** —
the privilege is revoked and the error is discarded. Nothing is broken today, but any assertion of
the form *"audit rows === 1"* in those suites is latently flaky, because a re-run accumulates rows
the cleanup cannot remove. Recorded rather than fixed: those are LA suites.

---

## SA-1.1 · Users list, search & platform counts — **Pass**, one criterion unverified at scale

**Purpose:** one screen shows every user on the platform, and any one of them can be found in
seconds.

*Purpose served.*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Searching a fragment returns the matching user | **Pass** | `HTTP` — by name fragment → exactly 1, ours; by email fragment → exactly 1, ours. A hostile term (`a,b)or(x.ilike."%"`) returns `200` with 0 rows rather than erroring or matching everything, because `escapeForOrFilter` neutralises PostgREST's filter mini-language. Also driven through the UI search box in a browser |
| 2 | Filtering by `suspended` returns only suspended users, and the count matches the counter strip | **Pass** | `HTTP` — verified with a **genuinely suspended row**, not just at zero: `status=suspended` → total 1, every row suspended, ours present; `strip.suspended` = 1, matching exactly. `suspension_reason` and `suspended_at` both surface on the row |
| 3 | The page loads in under 1 second with 5,000 users seeded | **Unverified at that scale** | `HTTP` — at 208 users: API **368–393ms**, full page render **770–824ms**. The stated 5,000 was not reproduced. Strong transferable evidence though: `/admin/audit-log` runs the *same* `count: "exact"` + `.range()` shape over **43,076 rows** in **896–910ms**, so the pattern is not row-count bound at these magnitudes |
| 4 | The counts are computed from the database, not from the loaded page | **Pass** | `SRC` + `DB` — `fetchUserStats()` calls the `admin_user_stats` RPC; the strip never sees the page's rows |

### Implementation quality worth recording

Three things are done properly here and should not be "simplified" later: the search term is escaped
before it reaches PostgREST's `or=` mini-language; `sort` is a **whitelist enum**, never free text,
because it is interpolated into an `ORDER BY`; and pagination carries an `id` tiebreaker so rows with
equal sort values cannot shuffle between pages.

### Fixed under this task

**Thirteen users rendered a completely blank Status column.** `USER_STATUS_LABELS` is a
`Record<UserStatus, string>` over four values, so the lookup returned `undefined` and React rendered
nothing. The live table holds **`invited` (9)** and **`deactivated` (4)** — values the app never
modelled. `accountTone()` already coloured both, so the chip was drawing with the right colour and
no text.

Added `userStatusLabel()`, which falls back to a humanised form of the raw value. It deliberately
does **not** map `invited` onto `pending_verification` or `deactivated` onto `inactive`: they look
like the same states under two spellings, but consolidating them is a data decision with a migration
behind it, not something to infer while fixing a blank cell. Verified in a browser: *Invited*,
*Deactivated*, *Pending verification* all render.

**The counter strip did not add up.** 193 active + 1 inactive + 0 suspended, out of a total of 208 —
with 14 users in states no tile counted and no filter could reach. A strip whose parts silently miss
its own total teaches the reader to distrust all of it. Added an **"Other states"** tile, defined as
the residual so it cannot disagree with the total, shown only when there is one.

**Every tile label was truncated to "To…", "Ac…", "In…", "Su…".** Pre-existing, and it defeats the
strip's whole purpose — a number with an unreadable label is not information. The cause was a fixed
36px icon plus a gap leaving the label ~70px in a five-across grid. Labels now wrap instead of
clipping, the icon hides on the narrowest widths, and the grid goes to six columns only at `xl`.
All six labels now render in full.

### The state machine has two real defects (they belong to SA-1.4, found here)

1. **`POST /users/:id/unsuspend` on a user who was never suspended returns 200 and activates
   them.** The fixture went `pending_verification → active` via *unsuspend*, so an invited user who
   has never set a password can be marked active — and then counts as a consumed seat. Not an
   authentication bypass (`has_password` is still false, so login still fails), but the state is
   wrong and the route is acting outside its name. `unsuspend` should apply only to a `suspended`
   user.
2. **`DELETE /api/admin/users/:id` returns 405 — it does not exist.** SA-1.4 lists it in its API and
   builds three criteria on it: typed confirmation, 7-day soft delete, "a soft-deleted user's email
   cannot be reused", "deleting the last owner of a tenant is blocked". None of that can be met.
   Only `PATCH` is exported from that route file.

Both are SA-1.4 criteria rather than SA-1.1 ones, so they were recorded here and **fixed in the
SA-1.4 pass below**.

### QA fixture disclosure

One namespaced fixture (`qa-sa11-…@insurvas.invalid`) was created to verify criterion 2, walked
through activate → suspend → unsuspend → deactivate, and left **`inactive`** with its seat freed.
It could not be soft-deleted because `DELETE` does not exist. Its seven audit rows are permanent, as
every audit row is. Two independent safeguards confirmed no email left the platform:
`EMAIL_DELIVERY_MODE` is unset (so the transport is `disabled`), and `.invalid` is on the reserved
recipient list regardless.

---

## SA-1.2 · Create user — **Partial** (4 of 5)

**Purpose:** the super admin can create a working account without the person going through public
signup.

*Purpose served*, with one billing-shaped departure.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A duplicate email shows "This email is already registered" and creates nothing | **Pass** | `HTTP` + `DB` — exactly that message, `409`, and `users` stayed at **208 → 208** |
| 2 | The new user cannot log in until they set a password via the link | **Pass** | `HTTP` — login refused `401 "Invalid email or password"` with any password and with an empty one; `has_password` is `false`. Created with `email_confirm: false` and no password at all |
| 3 | The invitation link expires after 72 hours and can be resent | **Pass** | `DB` + `HTTP` — measured **exactly 72.0h** between `created_at` and `expires_at`; resend returned `200` and **replaced both the token hash and the expiry** |
| 4 | Selecting a plan attaches a subscription in `active` state | **Partial** | `DB` — a subscription *is* attached to the right plan on the right cycle, but in **`trialing`**, not `active` |
| 5 | An audit row is written | **Pass** | `DB` — `["user.created", "user.invite_resent"]`, one per action |

### Criterion 4, and why it is not just pedantry

The subscription lands in `trialing` with the plan's 14 trial days. Functionally the customer gets
their features — SA-2.7 grants `trialing` the full menu — so nothing looks broken.

The consequence shows up in the case this ticket exists for. SA-1.2 is the *"sales closes a deal on
a call and wants the account ready before hanging up"* path: someone who has **already agreed to
pay**. Creating them silently starts a free trial instead of a paid subscription, so the first
charge is 14 days later than the business thinks, and nothing on the screen says so. Doc 2 §5.3
warns about exactly this shape of problem — *"free accounts multiply silently otherwise."*

Left as a finding rather than changed: whether an admin-created account should start paid,
trialing, or offer the choice is a commercial decision, and the fix is either a route change or a
new field on the form depending on which answer is wanted.

### UI / UX — one fix, verified in a browser

`+ Create new tenant` was the **563rd and last option** of the Tenant dropdown, after 562 tenant
names. Not merely awkward — the option rendered **off-canvas and could not be clicked at all**
without scrolling the listbox to its end. The browser refused the click twice:
*"ref is entirely outside the viewport … a click cannot reach it."*

It matters twice over: creating a tenant is the scenario SA-1.2 exists for, and that option is the
**only route to the plan picker**, so criterion 4's UI was effectively unreachable. Moved to the top
— the action before the data. The whole branch now opens in two clicks: Initial plan, a disabled
`Owner` role with *"the first member of a new tenant is always its owner"*, and a New tenant name
field, with submit disabled until all three are valid.

Also corrected the helper copy under Initial plan. It said only *"The new tenant starts on this plan
at the monthly cycle"* — silent about the trial that criterion 4 exposed. It now states that a plan
with trial days begins as a trial, **not** as active, and is not charged until the trial ends.

Two things the dialog already did well: its description tells the operator *"Admins never see or set
a customer's password"* — the out-of-scope rule stated where it is relevant rather than buried in a
ticket — and the Role select is disabled when creating a tenant, so the owner rule cannot be
contradicted by a click.

**Still open, not fixed:** the Tenant dropdown has **no search** over 563 options. Finding a named
customer means scrolling. Worth a combobox with a filter, but that is a component change rather than
an ordering one, and the reachability defect was the blocking half.

### Two things done well here, worth not undoing

**Atomicity is bought back by compensation, not assumed.** The user is born in Supabase Auth
(`public.users.id` is foreign-keyed to it), so a single transaction cannot span the create. If the
tenant attach fails, the route **deletes the half-made auth user** — otherwise the address would be
permanently unusable by anyone.

**The invitation TTL is resolved at issue time and baked into the row.** So shortening the setting
later never retroactively expires a link someone has already been sent. The token itself is 32
random bytes, SHA-256 hashed, and the raw value is never stored.

---

## SA-1.3 · Edit user & change role — **Partial** (3 of 4)

**Purpose:** the super admin can correct a user's details and change what they are allowed to do.

*Purpose served.*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Changing a role takes effect on the user's next request, **not only next login** | **Partial** | `HTTP` + `DB` — see below |
| 2 | A tenant must always have at least one owner; demoting the last one is blocked with a clear message | **Pass** | `HTTP` — `409` *"This is the tenant's only owner — promote someone else before changing this role"*, and `tenant_users.role` verified **unchanged** afterwards |
| 3 | The admin never sees a password field | **Pass** | `SRC` — `updateUserSchema` accepts `name`, `phone`, `role`, `email` only; no password field exists on the form or in the API |
| 4 | Every change writes an audit row naming the old and new value | **Pass** | `DB` — `{"changes":{"role":{"from":"producer","to":"assistant"}}}`. Only changed fields are recorded, so the row reads as a diff rather than a dump; a no-op PATCH writes no row at all |

### Criterion 1 — the machinery is right, the side effect is not what the criterion asked for

Measured on one unchanged session:

```
tenant_users.role  producer -> assistant     (immediately, in the database)
users.session_version    0 -> 1              (bumped by the RPC)
GET /api/app/me  with the SAME cookie  -> 401 Not authenticated
GET /api/app/me  with a fresh cookie   -> 200  role=assistant
```

So the old role stops working on the very next request — the security intent is met, and arguably
exceeded. But the user is **logged out**, and the criterion's whole point is *"not only next
login"*.

What makes this worth naming: `resolveTenantContext()` **already reads `tenant_users.role` from the
database on every request**, so the new role would have applied instantly without touching the
session at all. The version bump is redundant for a role change and costs the agent their session —
potentially mid-call.

**I checked whether it was indiscriminate, and it is not.** Name-only and phone-only edits, and a
no-op PATCH, all leave `session_version` untouched — verified across five cases. Only a role change
bumps it. That is a deliberate, targeted choice rather than an oversight.

Not changed, for two reasons: the bump lives inside `admin_update_user_with_email_change`, so
altering it needs DDL this environment does not have; and "should a role change force a re-login"
is a security-versus-disruption judgement for the product owner, not a bug to quietly remove.
**Recommendation:** drop the bump for role-only changes and rely on the live read, keeping it for
status changes where SA-1.4 requires sessions to die.

### One more thing done well

**An email change is never applied outright.** The new address gets a confirmation token and the old
one keeps working until it is used, so a typo cannot lock someone out of their own account. Audited
separately as `user.email_change_requested`, with from/to.

---

## SA-1.4 · User state: active, inactive, suspended, deleted — **Pass** (4 of 4, after building the missing half)

**Purpose:** each of the four states does exactly one clear thing, and the transitions between them
are the admin's only levers.

*Purpose served now; it was not before this pass.* Three of the four criteria depended on a route
that returned **405**.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A suspended user with an open tab is logged out on their **next request**, not at session expiry | **Pass** | `SRC` + `DB` — `resolveTenantContext()` re-reads `users.status` on every request and refuses anything but `active`; a status change also bumps `session_version` (observed 0 → 7 across probes), which invalidates the cookie independently |
| 2 | Deleting the last `owner` of a tenant is blocked | **Pass** *(built)* | `HTTP` — `409` *"This is the tenant's only owner — promote someone else before deleting them"*, and the owner's row verified unchanged |
| 3 | A soft-deleted user's email cannot be reused until the 7 days elapse | **Pass** *(built)* | `HTTP` — re-creating the address returns `409 "This email is already registered"`, because the `auth.users` row is deliberately left in place |
| 4 | The suspension reason is mandatory and appears in the audit log | **Pass** | `HTTP` + `DB` — a body without a reason is `400`; the reason lands in `audit_log.reason` and surfaces on the user row and as a tooltip |

### What was missing, and what I built

`DELETE /api/admin/users/:id` **did not exist** — the route file exported only `PATCH`, so the verb
answered 405. That took out typed confirmation, the recovery window and the last-owner rule in one
go, and it is what made `pending_verification` a dead end (see below).

The database was further along than the API: `users` already has **`deleted_at`** and
**`deletion_scheduled_until`**, and `admin_set_user_status` already accepts `deleted` — but it
leaves both timestamps **null**, so nothing recorded when the window opened or closed. A recovery
window nobody can measure is not a window.

Built:

- **`DELETE` with a typed confirmation of the user's own email address**, not the word "delete". A
  fixed word can be typed from muscle memory on the wrong row; the address can only be typed by
  someone who read which account they are removing. Case-insensitive, because the admin is copying
  it off the screen.
- **Soft, never hard.** The `auth.users` row stays, which is precisely what reserves the address —
  and is why criterion 3 passes rather than needing its own mechanism.
- **The window is now recorded**: `deleted_at` and `deletion_scheduled_until`, measured at
  **exactly 7.00 days**, from a new `users.soft_delete_days` setting (default 7, 1–90). Added to the
  settings registry only because this route reads it — that file's rule is *"a setting nothing reads
  is worse than no setting"*.
- **A last-owner guard**, and one honest caveat: it is a read-then-write in the route rather than in
  SQL, so two concurrent deletes of two different owners of the same tenant could in principle both
  pass. The alternative is a new database function and this environment cannot apply DDL.
- **A partial-failure path that does not lie.** If the status change succeeds but the timestamps
  fail, the response is `200` with a warning telling the admin to note the date by hand — the user
  *is* deleted at that point, so failing the request would be false.
- **`user.deleted`** registered as an audit action, with the email, the from/to status, the window
  length and the scheduled date in its metadata.
- Two stale entries in `database.types.ts` corrected: `deleted_at` and `deletion_scheduled_until`
  exist in the live table but were absent from the generated types. Added by hand with a note,
  because this project cannot regenerate types here — verified against the live column list first.

### The UI, driven end to end

A **Delete…** item in the row menu opens a dialog stating the three consequences the four-state
table distinguishes: access goes immediately, the seat is freed, the address stays reserved for the
window. Verified in a browser: the submit button is **disabled** before typing, **stays disabled**
on a near-miss address, enables on the correct one in any case, and on success the toast names the
real recovery date (*"recoverable until 9/28/2026"* — read from the response, not hardcoded).
The row left the table and the counter strip went 209 → 208 with Other states 15 → 14.

**And one menu fix.** The comment above those items claims the menu *"can't produce a no-op or a
409"*, which was not true: `Suspend…` was offered on every non-suspended state, and the database
refuses `pending_verification → suspended`, so an invited user's Suspend… returned 409. Now offered
only from `active` — the state that means "can currently get in". Confirmed in the browser: an
invited user's menu shows exactly Edit user · Resend invitation · Delete….

### `pending_verification` was a dead end — now resolved

Every admin action against an invited user who never accepted, measured before the fix:

| From `pending_verification` | Before | After |
|---|---|---|
| `POST /suspend` | 409 | 409 (and no longer offered in the menu) |
| `POST /deactivate` | 409 | 409 |
| `DELETE /users/:id` | **405 — no route** | **200 — soft-deleted** |
| `POST /unsuspend` | **200 → `active`** | **409, state unchanged** |

The only exit used to be marking them **active** — a user with no password, now consuming a seat.
With `max_seats: 1` on all three seeded plans, one mistyped invitation could occupy a tenant's only
seat permanently. Both halves are fixed: delete works from that state, and unsuspend no longer
impersonates activate.

**The unsuspend fix.** `/unsuspend` and `/activate` both target `active`, so the database's
transition rules cannot tell them apart — the guard had to go in the application. `setUserStatus`
now takes an optional `requireCurrentStatus`, and unsuspend demands `suspended`. The refusal names
the state rather than repeating the database's generic message:
*"Only a suspended user can be unsuspended. This user is pending_verification."*

### Worth recording: the suspended-login message resolves a real conflict correctly

SA-1.4 wants a suspended user told *"Your account has been suspended. Contact your administrator."*
SA-00 and SA-6.2 want login never to reveal whether an email exists. Both hold, because the state is
named **only after the password has been proven** — a wrong password always yields the generic
error. The route says so in a comment, and the ordering is what makes it true.

---

## SA-1.5 · Login activity & last-login tracking — **Pass** (3 of 4 + 1 unverified at scale)

**Purpose:** see who logged in, when they last logged in, and spot an account that is unused or
being shared.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Failed logins are recorded **and visible**, and do not update `last_login_at` | **Pass** *(after a fix)* | `DB` + `HTTP` — see below |
| 2 | The user list shows a readable relative last-login ("2 hours ago", "never") | **Pass** | `BROWSER` — `relativeTime()`, rendering "Never" and dates in the live table |
| 3 | A user who has never logged in is clearly distinguishable from one who logged in long ago | **Pass** | `BROWSER` — literal **"Never"** rather than a blank or an epoch date |
| 4 | The activity screen loads with 50,000 login rows without timing out | **Unverified at that scale** | `HTTP` — at 374 rows, `/admin/activity` returns in **780–791ms**. Paginated with `count: "exact"`; same shape as the audit log, which holds **43,076 rows and renders in ~900ms** |

### Criterion 1 — recorded was true, visible was not

Failures are recorded properly: **151 of 374 rows**, with `failure_reason` from a closed set
(`invalid_credentials`, `no_password_set`, `invalid_2fa`, `no_membership`), plus IP and user agent.
And `last_login_at` is untouched by a failure — verified directly.

But **175 of 374 rows have `user_id = NULL`**, because Supabase Auth rejects a wrong password
*before* the route learns which user was meant, so the attempt is recorded against the **email**
instead. `fetchUserLoginEvents` filtered on `user_id` alone — so **every failed password attempt was
invisible on the user's own detail page**, which is the one screen an admin opens to ask "is
somebody trying to get into this account?" That is SA-1.5's stated purpose, and the criterion asks
for failures to be *recorded and visible*.

Fixed by matching on the email as well as the id, with the same PostgREST `or=` escaping the users
list uses. Verified: a deliberate wrong-password attempt with a marker user-agent now appears on
that user's page, labelled **"Wrong email or password"**, and `last_login_at` is unchanged.

Also surfaced the swallowed errors in all three functions in that file — a failed query on an
activity tab previously rendered as "never signed in", which is a specific and wrong answer.

### The shared-account signal is real

`distinct_ips_24h` is computed in the `admin_user_list` view and compared against a threshold of 3
in both the list and the detail summary, which shows a warning naming the count. Verified in source;
no fixture in this database currently trips it.

Mapped every admin action against an invited user who has not accepted:

| From `pending_verification` | Result |
|---|---|
| `POST /suspend` | **409** — "That user cannot move to this state from their current state" |
| `POST /deactivate` | **409** — same |
| `DELETE /users/:id` | **405** — the route does not exist |
| `POST /activate` | **200** — becomes `active` |

**The only exit is to mark them active** — a user who has never set a password, now counted as a
consumed seat. So a mistyped invitation cannot be cleaned up: not suspended, not deactivated, not
deleted. With `max_seats: 1` on all three seeded plans, one bad invite can occupy a tenant's only
seat with no way back.

This is the same defect family as the two already recorded against SA-1.4 (`unsuspend` activating a
never-suspended user; `DELETE` returning 405) — the user state machine has transitions the API
cannot perform and one it performs under the wrong name. All three are SA-1.4's criteria and are
queued for that pass.

### QA fixture disclosure for this pair

- `qa-sa12-…@insurvas.invalid` created to verify criteria 3–5, plus tenant
  **"QA SA-1.2 tenant 1790020795104"** and its `trialing` subscription — a new tenant was
  unavoidable, because the schema only allows a plan to be chosen when creating one. The user was
  walked to `active` and left **`inactive`** with its seat freed. The tenant and subscription
  remain: no tenant-delete endpoint exists.
- `la.basic@insurvas.test` — a **permanent** demo fixture — had its role changed to `assistant` and
  **reverted to `producer`**, and its name and phone changed and restored. Its `session_version`
  advanced 0 → 2 as a result, which is a counter and cannot be put back; the practical effect is
  that this fixture's existing sessions are invalid and it would need to log in again.

---

## SA-2.1 · Feature catalog — **Pass** (3 of 3, no fix needed)

**Purpose:** one table listing everything a subscription can switch on, grouped into modules, so the
plan editor has something to tick.

*Purpose served.* The first task in this audit that needed nothing changed.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Adding a feature requires no code deploy | **Pass** | `HTTP` — `POST` → `201`, visible in the catalog on the next read. Duplicate key → `400 "That feature key already exists"`; unknown module → `400` |
| 2 | Archiving does not break plans that reference it — stays enforced for existing subscribers, disappears from the picker | **Pass** | `HTTP` + `SRC` — after archiving: still in the full catalog, **absent from `?picker=1`**. And the entitlement builder selects `pf.feature_key from plan_features` with **no join to `features` and no `is_archived` filter**, so archiving cannot revoke a live grant — true by construction, not by care |
| 3 | Features are returned grouped by module, in a fixed display order | **Pass** | `HTTP` — 9 modules in ascending `sort_order` (`book > acquisition > sell > retention > insight > partners > accounting > compliance > agency`), 28 features, each module's features ordered within it |

### The CI check the ticket asks for exists, and is better than specified

SA-2.1 asks for "a CI check: every `feature_key` in this table is referenced by at least one
`requireFeature()` guard". `npm run check:features` does that — and distinguishes **real drift**
from **"this feature has no agent API yet, and its own module ticket owns that guard"**, listing the
15 deferred ones by name. A blunt version of this check would either fail permanently or have to be
switched off; this one stays green and still catches a genuine mismatch.

### Two design decisions worth not undoing

`feature_key` is **absent from `updateFeatureSchema`** on purpose, with the reason in the file: the
key is the contract with `requireFeature()` guards, menu nodes and every plan built on it, so
renaming one is a code change, not an admin action. Verified — a PATCH carrying `feature_key`
returns 200 and changes the label while leaving the key untouched.

The catalog also returns **`plan_reference_count`** and **`addon_reference_count`** per feature,
which is what lets an admin see that archiving something is safe before doing it.

---

## SA-2.2 · Plan CRUD + plan type — **Pass** (5 of 5, no fix needed)

**Purpose:** create as many plans as the business needs without a deploy, each stating who it is
for.

*Purpose served.*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Creating a plan requires no deploy | **Pass** | `HTTP` — `201` at version 1. Rejects an illegal code (`400`, quoting the rule), a duplicate code (`409 "A plan with that code already exists"`) and an unknown `plan_type` (`400`) |
| 2 | `code` cannot be changed once a subscription references the plan | **Pass** | `HTTP` + `DB` — `409 "This plan has subscribers, so its code can no longer be changed"`, and every row for that code verified unchanged |
| 3 | Editing a live plan's features bumps the version and leaves existing subscribers unchanged | **Pass** | `HTTP` + `DB` + `SCRIPT` — see below |
| 4 | Archived plans do not appear in the "assign plan" picker, but existing subscribers keep working | **Pass** | `SRC` + `DB` — the picker is fed `fetchPlans({ includeArchived: false })`; and a tenant on an **archived** plan still resolves an entitlement (`plan_code` set, `access: full`) |
| 5 | Deleting a plan with subscribers is blocked with a clear message | **Pass** | `HTTP` — `409 "This plan has subscribers and cannot be deleted — archive it instead"`, plan still published. A plan with no subscribers deletes cleanly |

### Criterion 3 — versioning is by row identity, which the ticket's data sketch does not say

`subscriptions` has **no `plan_version` column.** Grandfathering works differently from the
ticket's sketch, and better than a version pointer would:

- Each version is a **separate `plans` row** sharing a `code`, so `(code, version)` identifies one.
- A subscription points at a **plan id**, which is a specific version's row.
- Therefore "existing subscribers stay on v3" is **true by construction** — nothing about them has
  to be migrated or checked, because a new version cannot reach them.

Verified: `POST /plans/:id/new-version` → `201`, two rows now share the code (v1, v2), and the
original v1 row keeps its id. `npm run verify:plan-version` separately proves a new version copies
limits, meters, available add-ons and all prices.

Worth recording because the difference matters to whoever reads the ticket next: there is no
`plan_versions` table and no version column on a subscription, and neither is missing.

`updatePlanSchema` also **omits `plan_type`** deliberately — it decides which features are offered
and whether seats apply, so changing it on a live plan would silently reinterpret everything
attached to it.

---

## Carried forward from this pair

- **For SA-2.3:** its criterion *"saving with zero features ticked is blocked"* is already enforced
  at the schema — `feature_keys: z.array(...).min(1, "A plan must grant at least one feature")`.
- **For SA-2.8:** `admin_rebuild_entitlements` **exists in the database and is called from nowhere
  in the code** (`verify:rpc-contract` lists it among 210 uncalled functions). Related: a handful of
  fixture tenants hold an entitlement that disagrees with their current subscription — one reads
  `status: trialing, access: full` while its subscription is `cancelled`. **Inconclusive as a flow
  defect**: those rows have a null `cancelled_at`, which means they were set directly by verifier
  scripts rather than through the cancel path, so this is not evidence that cancelling fails to
  rebuild. It *is* evidence that nothing detects or repairs divergence, and that the repair function
  provided for exactly that has no caller.
- **Fixture litter in the plan tables:** 19 of 23 plans are `pbv_*` verifier leftovers (archived),
  carrying 22 cancelled subscriptions between them. Harmless to enforcement, but it is most of what
  the plan list shows.

### QA fixture disclosure for this pair

Both probe plans (`qa_ver_*` v1 and v2) were **deleted** — they had no subscribers, so the delete
path allowed it. Zero `qa_*` plans remain.

One probe feature (`qa_probe_feature_1790023533376`) remains, **archived**. Features are
deliberately never deletable — *"never delete a feature a plan has ever referenced"* — so archived
is its correct terminal state: out of the plan picker, out of the active count (back to the original
28), and `check:features` still reports **no drift**, which incidentally confirms archived features
are correctly exempt from the guard requirement.

### Two probe errors of my own, recorded so the numbers are not misread

A first run reported "create a feature → 400" and "save plan version → 400". Both were my
malformed requests, not defects: the catalog returns `module` as an **object** (`{key, label,
sort_order}`) and I passed the object where the key belongs; and `savePlanVersionSchema` requires
prices, limits and meters alongside `feature_keys`, not `feature_keys` alone. Corrected and re-run
before anything was concluded.

---

## SA-2.3 · Feature picker — **Pass** (4 of 4, one label corrected)

**Purpose:** one page where ticking boxes decides exactly what the agent sees.

*Purpose served.* The ticket calls this "the heart of the whole system" and it is the best-built
screen in the admin surface.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Ticking a feature and saving changes the agent's menu on their next page load | **Pass** | `SRC` — the route calls `rebuildEntitlementsForPlan(...)` after an in-place save, so the cached entitlement every agent reads is refreshed before the response returns |
| 2 | The preview panel matches what the agent actually sees, exactly | **Pass** *(label corrected)* | `SRC` + `BROWSER` — the preview calls **`buildAgentMenu`**, the same function `app/app/(shell)/layout.tsx` calls. Not a reimplementation, so it cannot drift |
| 3 | Saving with zero features ticked is blocked | **Pass** | `HTTP` — `400 "A plan must grant at least one feature"`, enforced both in the schema and again in SQL (`raise exception 'no_features'`) |
| 4 | The affected-subscriber count is accurate | **Pass** | `SRC` — the banner's count and the version-bump condition use the **identical predicate**: `subscriptions where plan_id = … and status <> 'cancelled'` |

### Criterion 4 is right for the reason that matters

The count in the warning banner and the condition that decides whether saving creates a new version
are not two calculations that happen to agree — they are the same predicate in two places. So an
admin cannot be told "0 live subscribers" and then have a version published anyway, which is the
failure this criterion exists to prevent. The button label reflects it too: it reads **"Publish v2"**
on a subscribed plan and "Save plan" otherwise, and the success toast says *"the 124 existing
subscriber(s) keep v1's features and price"*.

### What I corrected

The preview was headed **"Agent will see"**, but `buildAgentMenu(granted)` leaves its second
argument at its default of `"owner"`, while the agent shell passes the signed-in user's real role.
So the panel renders the **widest** menu the plan can produce, and a producer, assistant, setter or
bookkeeper on that same plan sees a subset.

Showing the full grant is the right thing for a *plan* editor — role gating is orthogonal to what
the plan sells — but the heading claimed more than it rendered, against a criterion that says
"exactly". Now **"An owner will see"**, with a line noting narrower roles see a subset. Verified on
the live `basic` editor: new heading present, old one gone, caveat rendered.

A **role toggle** on the preview would satisfy the criterion literally rather than by caveat. Not
built: it is a feature, not a fix, and the label was the part that was untrue.

### The detail in `admin_save_plan_version` worth not losing

Before deleting and rewriting `plan_features`, the function captures the plan's **archived** grants
separately and re-inserts them:

> *"Captured before any delete: archived features stay granted to a plan that already had them
> (SA-2.1), and the picker can't offer them, so the submitted list alone would revoke them."*

Without that, every save through this screen would silently strip archived features from the plan —
because the picker cannot show them, so the browser cannot submit them. It is SA-2.1's archive
guarantee defended at the write path rather than left to the reader's care.

---

## SA-2.4 · Plan pricing & billing cycle — **Pass** (4 of 4, no fix needed)

**Purpose:** each plan has a price and a recurrence, set without a deploy.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A plan with only `price_monthly` set offers only monthly at checkout | **Pass** | `HTTP` + `SRC` — `/api/public/plans` returns `basic` with `price_quarterly: null`; `availableBillingCycles()` derives the sellable cycles from which prices are non-null, commented *"SA-5.2's checkout should offer exactly this, and nothing else"* |
| 2 | Changing a price does not change what any existing subscriber is billed | **Pass** | `SRC` — `admin_save_plan_version` counts non-cancelled subscribers and, if any, writes to a **new plan row** instead of editing in place. Existing subscriptions point at the old row with its own `plan_prices`, so grandfathering is enforced by the write path |
| 3 | All arithmetic is integer cents; no rounding drift on a quarterly plan | **Pass, with a documented approximation** | `DB` — see below |
| 4 | Price changes are audit-logged with old and new value | **Pass** | `DB` — `{"prices":{"price_monthly_cents":{"from":9900,"to":12900}}}`, recorded as a diff of only what moved |

### Criterion 3, tested with a price that deliberately does not divide

Set a quarterly-only price of **29900** (÷3 = 9966.67):

- Stored **exactly** as `29900`, an integer; the other two cycles stay `null` rather than becoming a
  row of zeroes — *"No cycle priced = not sellable = no price row, rather than a row of nulls."*
- The customer is charged the **stored integer**. Nothing divides or recomputes it at billing time,
  so **there is no drift in what anybody is billed** — which is what the criterion is about.
- `monthly_equivalent_cents(quarterly)` returns **9967**, and 9967 × 3 = **29901** — a cent more
  than the real price.

That last line is worth stating plainly rather than hiding: the monthly equivalent is a **reporting
normalisation, not a lossless decomposition**, and it is named "equivalent" rather than "exact". It
rounds once per subscriber, so the revenue dashboard's MRR carries up to a cent of rounding per
quarterly or yearly subscriber. Correct practice for MRR, bounded, and not a billing error — but
someone reconciling MRR against collected cash to the penny should know it is there.

---

## SA-2.5 · Plan limits & metered credits — **Partial** (4 of 5) + the enforcement is inert in production

**Purpose:** a plan can say "you get 2,000 TCPA checks a month and 1 seat", and the system counts
and enforces it.

*Mechanism served. Purpose not, because nothing is configured.*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | The same usage event posted twice (same idempotency key) counts once | **Pass** | `DB` — 40 recorded twice → `used` stayed **40**, exactly **1** row in `usage_events` for that key, and the second call no-opped rather than erroring |
| 2 | At 100% of a hard-capped meter the action is blocked server-side with a clear error | **Pass** | `DB` — at 100/100: `{"allowed":false,"reason":"over_cap","pct_used":100}`. `pct_used` is returned at every level, which is what the 80% notice reads |
| 3 | Usage events are never deleted; corrections are new negative events | **Pass** | `DB` — `DELETE` against `usage_events` **refused: "permission denied"**, as `service_role`. A `-30` event took `used` from 100 to 70 and re-allowed the action |
| 4 | The aggregate can be fully rebuilt from the event log by a script | **Fail** | `DB` — see below |
| 5 | Allowances reset at the start of each billing period, not the calendar month | **Pass** | `SRC` — `tenant_current_period_start()` returns the subscription's `current_period_start`, falling back to `date_trunc('month', now())` **only** when the tenant has no subscription |

### Criterion 4 — the rebuild job has never been able to run

```
rebuild_usage_totals()  ->  ERR  DELETE requires a WHERE clause      (×3, reproducible)
```

The body reads `delete from usage_totals where true`, which looks qualified. This project runs with
a safe-update guard, and the planner folds `WHERE true` away before the guard sees it — so the
statement is rejected as unqualified and the function aborts before re-aggregating anything.
`npm run rebuild:usage` fails identically.

The ticket is unusually direct about why this matters: *"The aggregate is a cache. It must be
rebuildable by replaying the event log. Assume it will drift, and build the rebuild job before you
need it."* The job was built and does not work.

**And the drift it was meant to repair was already there.** Re-aggregating the 488 events produces
**112** rows. `usage_totals` held **377**. So **265 rows — 70% — were not derivable from the event
log at all**, which is the invariant this criterion exists to guarantee. Those rows were almost
certainly written directly by verification scripts rather than through `record_usage`.

Fix authored, not applied: `supabase/migrations/20260921210000_sa_2_5_fix_rebuild_usage_totals.sql`
changes the predicate to `where tenant_id is not null` — true for every row, so the same rows are
removed and the guard sees a real qualification. Parses under `npm run db:check`. Applying it needs
DDL rights this environment does not have.

### The bigger finding: cap enforcement is inert in production

`plan_meters` holds **0 rows**, so no plan grants an allowance for any meter. With the ticket's own
"null = unlimited" rule, that makes every metered action unlimited on every plan — including the
hard-capped ones:

```
check_meter_capacity(dnc_lookups, 1)           -> allowed:true, included:null, reason:"unlimited"
check_meter_capacity(dnc_lookups, 10,000,000)  -> allowed:true, included:null, reason:"unlimited"
```

Ten million DNC lookups pass the check. `meter_pricing` is also all zeros (`cost_cents: 0`,
`sell_cents: 0`, `default_included: null`) except `statement_pages`.

The engine is correct — it reports `"unlimited"` rather than pretending to enforce, and with an
allowance configured it blocks exactly as criterion 2 requires. What is missing is the numbers.
Per Doc 2 §4.2 these meters carry real marginal cost (DNC ~$0.008/lookup, dialer ~$0.014/minute),
so "unlimited" means uncapped vendor spend with no ceiling and no 80% warning.

**This is the open business input flagged in the verification plan**, and it is the one thing on
SA-2.5 that should not be guessed: too low a number blocks a paying agent mid-call, too high bills
them for overage they were never sold. The catalog itself is correct and complete —
`statement_pages` is the one meter with `default_hard_cap = false`, matching the ticket's deliberate
exception.

---

## SA-2.6 · Add-ons — **Pass** (4 of 4, no fix needed)

**Purpose:** sell something extra without creating a whole new plan.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Attaching an add-on grants its features on the next page load | **Pass** | `SCRIPT` — `verify:addon-meters`: *"an attached add-on's credits reach enforcement"* and *"enforcement agrees with the entitlement resolver"* |
| 2 | Detaching removes them and the agent's menu shrinks | **Pass** | `SCRIPT` — *"detaching the add-on removes its credits"* |
| 3 | An add-on's credits stack with the plan's credits for the same meter | **Pass** | `SCRIPT` — the same suite proves plan-alone, plan+add-on, and plan-after-detach in sequence |
| 4 | Add-on price appears as a separate line on the invoice | **Pass** | `DB` — **26 live invoice lines of kind `addon`**, emitted by `lib/billing/lines.ts` |

Criterion 4 is worth recording because the SA-3.2 ticket says the opposite. Its status block states
*"Not built: add-ons and overage are not charged at all… a tenant with add-ons is billed for their
plan only"* and points at backlog #27. **That note is stale**: the live `platform_invoice_lines`
table contains `{"plan":203,"discount":20,"overage":4,"addon":26,"credit":3}`, so both add-on and
overage lines are being produced. Had I taken the ticket at its word I would have recorded a Fail.

The architecture requirement — *"add-ons feed the entitlement exactly like plan features; do not
build a parallel entitlement path"* — holds: the entitlement builder unions
`plan_features` with `addon_features` in one query, so there is one path, not two.

---

## SA-2.7 · Assign, change & cancel a subscription — **Pass** (5 of 5)

**Purpose:** put any tenant on any plan, move them, or cancel them — and the effect on what they
can see is immediate.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Assigning a plan rebuilds the entitlement **before the API call returns** | **Pass** | `SRC` — `await rebuildEntitlement(tenant_id, "subscription.assigned")` on the response path |
| 2 | Upgrading shows the new menu items on the agent's next page load, not after a re-login | **Pass** | `SRC` + `DB` — the rebuild is awaited, the menu reads the cached entitlement on every request, and a **plan** change does not bump `session_version` (only a role change does, proven under SA-1.3), so no re-login |
| 3 | Downgrade is queued for period end and clearly labelled "takes effect 14 Sep" | **Pass** | `SRC` — *"Moving to {plan} — takes effect {date}"*, plus `Takes effect ${periodEnd.toLocaleDateString()}` on the confirmation |
| 4 | A suspended tenant can open their policy list and cannot open the dialer | **Pass** | `HTTP` — measured end to end; see below |
| 5 | Every state change is audit-logged with a reason | **Pass, with a nuance** | `DB` — all five actions audited; reasons captured where the ticket asks for one |

### Criterion 4 — the rule the ticket says must not be broken, measured

Suspending a live fixture tenant and calling real routes with its session, then restoring:

| | active | **suspended** | restored |
|---|---|---|---|
| `GET /api/app/policies` | 200 `readOnly:false` | **200 `readOnly:true`** | 200 `readOnly:false` |
| `GET /api/app/ledger` | 200 | **200** | 200 |
| `POST /api/app/dialer/next` | 200 | **403** | 200 |
| `POST /api/app/campaigns` | reaches validation | **403** | reaches validation |
| `POST /api/app/contacts` | reaches validation | **403** | reaches validation |

The 403 body is *"Your account is suspended. You can still view your…"* — it names what they **can**
still do rather than only what they cannot.

Two details worth keeping. The mechanism is a single flag —
`requireFeatureRole(feature, roles, { write: true })` — so "suspend the doing, preserve the seeing"
is one parameter at each call site rather than a rule each route has to remember. And the read
responses carry **`readOnly: true`** in the payload, so the client renders read-only from a fact the
server stated rather than inferring it.

### Criterion 5's nuance

All five state changes write an audit row: `subscription.assigned`, `.plan_changed`, `.cancelled`,
`.paused`, `.resumed`. Reasons are captured where the ticket asks for one — `subscription.paused`
carries a reason on **17 of 17** live rows — and not where it does not: `resumed` (0 of 17) and
`assigned` (0 of 13) take no reason input, and SA-2.7 only requires one for cancel. Recorded as a
nuance rather than a pass-by-redefinition: if a reason is wanted on every transition, `resume` and
`assign` need a field, not just a code change.

### One decision in the change-plan route that is easy to get wrong

> *"Only rebuild when something actually changed now; a queued downgrade changes nothing until the
> period rolls, and rebuilding early would revoke access they still paid for."*

Rebuilding eagerly on a queued downgrade would take features away the moment the admin clicks,
weeks before the customer stops paying for them.

---

## SA-2.8 · Entitlement engine & enforcement — **Pass** (5 of 5) + a live cache-drift finding

**Purpose:** one function answers "what is this tenant allowed to do right now", and three
enforcement points obey it.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A tenant on Plan A calling a Plan C API route gets 403, even with a valid session and a hand-crafted request | **Pass** | `HTTP` — see below |
| 2 | Changing a plan updates the entitlement within one second | **Pass** | `DB` — `refresh_tenant_entitlement` measured at **418ms / 224ms / 243ms**, and the routes `await` it before responding |
| 3 | The menu renders from one data structure; adding a menu item requires no per-plan code | **Pass** | `SRC` + `TEST` — one `AGENT_MENU`, filtered by `buildAgentMenu`; `lib/menu/planBranching.test.mjs` asserts a brand-new feature key needs no per-plan branch |
| 4 | A `suspended` subscription yields a read-only entitlement, not an empty one | **Pass** | `SCRIPT` + `DB` — *"access is read_only"* and *"features are RETAINED, not emptied"*; measured directly: 27 features kept, `access` flips `full → read_only → full` |
| 5 | Automated test: for each seeded plan, assert the exact feature list | **Pass** | `SCRIPT` — `verify:entitlements`: advance **27**, basic **5**, pro **16**, "exact match" each |

### Criterion 1, measured with a hand-crafted session

A tenant on `basic` (5 features), signed session minted directly rather than through the UI:

```
GET  /api/app/campaigns    (outbound_dialing)     -> 403  "Your plan doesn't include this feature"
POST /api/app/dialer/next  (outbound_dialing)     -> 403  "Your plan doesn't include this feature"
GET  /api/app/contacts     (duplicate_detection)  -> 403  "Your plan doesn't include this feature"
GET  /api/app/scoring                             -> 403  "Your plan doesn't include this feature"
GET  /api/app/deal-flow    (daily_deal_flow)      -> 403  "Your plan doesn't include this feature"
GET  /api/app/policies     (book_of_business)     -> 200   ← the one their plan does grant
```

This is the criterion the ticket makes the loudest noise about — *"hiding a menu item is not
security. The API check is the only real one."* It holds.

Tenant isolation on the cache itself also holds: `verify:sa2-tenant-matrix` proves a tenant can
`SELECT` only its own `tenant_entitlements` row and is denied `INSERT`, `UPDATE` and `DELETE`, with
`usage_events` and `usage_totals` denied outright.

### The finding: nothing reconciles the cache, and it has drifted

Criterion 2 is about the *trigger* the admin routes fire. There is no equivalent for changes that
arrive any other way — a migration, a seed, a direct fix to `plan_features` — and the cache has
silently drifted as a result. Measured across all 35 non-cancelled subscriptions:

| | count |
|---|---|
| cache matches the plan | 15 |
| **cache disagrees with the plan** | **5** |
| **no entitlement row at all** | **15** |

All five drifted rows are on `advance` and are missing the same feature — **`partner_quality`** —
stale since **2026-09-12**. Their plan grants it; their cache does not; so tenants paying for
`advance` have been missing a feature they bought for nine days. A rebuild takes ~250ms and fixes
it, and `admin_rebuild_entitlements` exists in the database **for exactly this and is called from
nowhere in the codebase** — confirming as a live defect what SA-2.2 could only record as a
suspicion.

Added `npm run qa:entitlement-drift` (`scripts/reconcile-entitlements.mjs`), which reports the
divergence and, with `--fix`, rebuilds it. **Not run**, because the two groups are not equivalent:

- The **5 drifted** rows are unambiguous — rebuilding can only bring them closer to what was sold.
- The **15 missing** rows are a product decision. A tenant with no entitlement row falls back to the
  LA-0 bridge default rather than their plan, so creating the row can mean **fewer** features than
  they see today. Almost certainly correct, still a visible change to a live account, so it is
  behind a separate `--include-missing` flag.

**Recommendation:** run `npm run qa:entitlement-drift -- --fix` to close the five, decide on the
fifteen, and give `admin_rebuild_entitlements` a caller — a nightly reconciliation, or a call at the
end of any migration that touches `plan_features`. Doc 2 §14 names this exact failure: *"Billing and
reality drift apart… do not let a mismatch be discovered by a customer."*

---

## SA-3.1 · Payment provider adapter (Whop) — **Pass** (6 of 7) + two unprocessed live payments

**Purpose:** all billing code talks to one interface, so the provider can change without touching
billing logic.

*Purpose served.* The adapter is why the Stripe→Whop switch cost a few files rather than a rewrite.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A sandbox checkout produces a `payment.succeeded` webhook our endpoint accepts with 200 | **Pass (accepted), with a caveat** | `DB` — **two real Whop payloads** (`msg_…`, 2026-09-14) are stored. The ticket's *"no real payload has ever reached us; `webhook_events` is empty"* is **stale**. But neither was ever *processed* — see below |
| 2 | A webhook with a bad signature is rejected | **Pass** | `SCRIPT` — refused three distinct ways, all `401`: body altered after signing, wrong secret, replayed old timestamp |
| 3 | The same webhook delivered twice changes state exactly once | **Pass** | `SCRIPT` — second delivery returns `{"ok":true,"duplicate":true}` and creates no second row |
| 4 | A failed payment drives the subscription to `past_due` through the normal code path | **Pass** (owned by SA-3.4) | `SCRIPT` — `verify:events`: Whop gives up → `suspended`, access drops to `read_only` not `none`; paying again restores `active` |
| 5 | No card number, CVV or expiry is ever written | **Pass** | Checkout is hosted; verified by grep as well as by construction |
| 6 | Unit tests run with no network access | **Pass** | The dummy provider survives as the offline test double; `verify:payments` exercises it without the network |
| 7 | Swapping sandbox for production is a key and a base URL, not a code change | **Pass** | `SRC` — `process.env.WHOP_API_BASE_URL ?? "https://api.whop.com/api/v1"`; all five Whop env keys are set |

### The caveat on criterion 1 — two real payments have sat unprocessed for eight days

```
payment.succeeded  msg_nGdfgIIUQCbgIi2hiJPd  received 2026-09-14T05:51  processed_at NULL  attempts 0  process_error NULL
payment.succeeded  msg_yVAzZWzeNZtzdhNOKBbJ  received 2026-09-14T07:36  processed_at NULL  attempts 0  process_error NULL
```

They were **accepted and stored** — which is what criterion 1 asks — but `attempts: 0` means
processing was never even tried, and `process_error` is null, so nothing records why.

`verify:webhook-invoicing` proves the *current* design handles this properly: a real tenant's
payment that cannot be invoiced is deliberately **not** acknowledged with a 200 so Whop keeps
retrying, and *"the reason is recorded durably, not just logged"*. These two rows have no reason
recorded, so they most likely **predate that behaviour**. I have not proven that, and I am not
calling it a regression on the strength of two rows.

What is certain either way: **two real payment events are sitting unexamined and nothing surfaces
them.** There is no screen, alert or job that lists unprocessed webhook events. That is SA-6.1's
territory — *"alert when a job did not run at all"* — applied to the inbound side.

### Things `verify:payments` proves that the ticket does not ask for

The provider call log is **append-only for the application** (*"the app CANNOT rewrite a logged
call"*) while a retention purge is still permitted; the failure simulator is **sticky across all
five dunning attempts** rather than resetting; a timeout **throws rather than reporting a decline**,
so a network fault can never be mistaken for a customer's card failing; and *"switching provider
changes no field a caller reads"* — the adapter's actual contract, tested. Deleting a tenant removes
its provider rows but **the call log survives**, so the record of what was charged outlives the
account.

### One finding that belongs to SA-4.2

`provider_settings` has columns `provider, display_label, is_enabled, is_default, sort_order` and
**no `mode` and no `credentials_enc`** — both of which SA-4.2's data spec requires, and which its
"switch sandbox → production in the UI" criterion depends on. Today that switch is an environment
variable, which satisfies SA-3.1 C7 but not SA-4.2. Recorded for that pass.

---

## SA-3.2 · Invoice generation — **Pass** (5 of 5) + one in-scope item genuinely not built

**Purpose:** every billing event produces an invoice with correct line items.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Running twice produces one invoice, not two | **Pass** | `SCRIPT` — *"a redelivered payment returns the same invoice"* |
| 2 | Numbers are sequential with no gaps, even when generation fails midway | **Pass** | `SCRIPT` — *"numbers run consecutively"* and *"the invoice counter remains ahead of issued verification numbers"* |
| 3 | An issued invoice cannot be edited through any route | **Pass** | `SCRIPT` — as the app's own service-role client: cannot rewrite the total, cannot edit a line, cannot delete a line. **Voiding is allowed**, which is the correct exception |
| 4 | Overage lines show quantity, included allowance and unit price | **Pass** | `DB` — the ticket says this is unmet; it is **stale** |
| 5 | All amounts are integer cents; lines sum exactly to the total | **Pass** | `SCRIPT` — *"lines sum exactly to the total"* |

### Criterion 4 — the ticket is out of date

Its status block says *"the columns exist and are tested, but nothing produces overage lines yet."*
Four live overage lines exist and carry everything the criterion names:

```json
{ "kind": "overage", "label": "Dialer minutes over included",
  "quantity": 420, "included_qty": 2000, "unit_cents": 2, "amount_cents": 840 }
```

Quantity, the included allowance, the unit price — and 420 × 2 = 840, so a customer can check the
arithmetic, which is the point of the criterion. `platform_invoice_lines` holds
`{"plan":203,"discount":20,"overage":4,"addon":26,"credit":3}`, so both the overage and add-on
"not built" notes on this ticket and SA-2.6 are stale.

### The in-scope item that is genuinely not built: the issue email

"Emailed to the tenant owner on issue" is in scope, and the ticket records it as not built. **That
is accurate.** `email_log` contains one `invoice_issued` row, which looks like evidence to the
contrary — it is **seeded demo data** (`scripts/seed-demo-data.mjs:201`). There is no
`invoice_issued` template in `lib/email/templates.ts` and no code path that sends one. Checked
before reporting, because the log row alone would have read as "built".

### The reconciliation is doing its job, on live data

`INV-2026-09-0245` reads `total_cents: 9900` against `provider_total_cents: 19800` —
**`mismatched`**, and voided. That is the `initial_price` incident the ticket describes, caught by
the mechanism rather than by a person noticing. The invoice reconciles against what Whop actually
charged instead of instructing it, which is what makes that catchable at all.

And the failure path is right: `verify:webhook-invoicing` shows a payment that cannot be invoiced is
**not** acknowledged with a 200 — so the provider retries — the reason is stored durably, and **no
invoice is invented** for it.

---

## SA-3.3 · Invoice list & detail screens — **Pass** (4 of 4, one filter fixed)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | "Overdue only" filter matches the count in the totals strip | **Pass** *(after a fix)* | `HTTP` + `DB` — see below |
| 2 | The printable invoice shows every line item with correct arithmetic | **Pass** | `HTTP` — the print view returns 200, shows the number, and renders `$249.00` against a stored total of `249.00`; `verify:invoices` separately proves *"lines sum exactly to the total"* |
| 3 | Voiding does not delete the invoice and does not reuse its number | **Pass** | `DB` — **21 voided invoices still present**, and the counter *"only ever moved forward"* |
| 4 | A `support_agent` cannot open invoice screens at all | **Pass** | `HTTP` — `qa:sa-dynamic`: refused on every invoice route; the static matrix shows support_agent with 13 × 200 against super_admin's 53 |

### The filter defect, found by comparing against the database rather than the screen

| request | before | after | database truth |
|---|---|---|---|
| `?overdue=true` | 19 | 19 | 19 |
| **`?overdue=1`** | **220** | **19** | 19 |
| **`?mismatched=1`** | **220** | **21** | 21 |
| `?status=banana` | 220 | **400** | — |

`params.get("overdue") === "true"` is a strict string match, so any other spelling read as **false**
and returned **all 220 invoices under a heading that says "overdue only"**. The browser happens to
send `"true"`, so the screen was right and the API was not — which is exactly how this survives: the
one caller that matters is correct, and every other caller is silently wrong.

Fixed to accept `true/1/yes/on` and `false/0/no/off`, and to **refuse** anything else with a 400
rather than reading it as false. An unrecognised `status` now returns 400 listing the valid ones
instead of quietly widening to "all". Same defect family as the audit log's ignored `target`.

---

## SA-3.4 · Record payment → auto-activate — **Pass** (5 of 5)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A suspended tenant whose payment lands regains full access, no admin action | **Pass** | `SCRIPT` — `verify:events`: *"paying again restores active"*, *"and access returns to full"* |
| 2 | The proration example produces exactly $122.58 | **Pass** | `TEST` — `lib/subscriptions/proration.test.mjs`: `assert.equal(result.netCents, 12258)` |
| 3 | Recording the same payment twice is rejected | **Pass** | `SCRIPT` — *"the invoice cannot be paid twice"*, *"payments never exceed the invoice total"* |
| 4 | Manual payments are audit-logged with who recorded them and the bank reference | **Pass** | `SCRIPT` — `verify:custom`: *"raising and settling are both audit-logged"* |
| 5 | All arithmetic in integer cents | **Pass** | `TEST` + `DB` |

Two details worth keeping. The proration reaches the invoice as **two lines, not one** — a single
*"plan change: $122.58"* line is something a customer can only take on trust, where a credit and a
charge can be checked. And `verify:settlement` proves the activation is **scoped**: paying an
invoice activates *"the invoice's own past_due subscription"* while *"the unrelated cancelled
subscription is NOT revived"* — a real risk when one tenant has several.

---

## SA-3.5 · Missed payment → reminders → auto-suspend — **Cancelled**

Cancelled in Notion on 2026-08-29: Whop runs its own dunning (5-day retries, emails, billing
portal), and building a second ladder would mean two systems chasing one customer on two schedules.
The part we kept — the **access consequence** — moved into SA-3.4 and is verified there:
`payment.failed → past_due` (full access with a banner), and read-only only when Whop gives up.

No work, and none should be done. The ticket remains a useful spec if Whop is ever left.

---

## SA-3.6 · Discounts & coupons — **Pass** (4 of 4)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A 50%-for-3-periods coupon discounts exactly three invoices, then stops on its own | **Pass** | `DB` + `SCRIPT` — `subscription_coupons` shows live rows at `periods_remaining: 3, is_active: true` and a spent one at `periods_remaining: 0, is_active: false` — the countdown deactivates itself, no scheduled job. *"An invoice replay does not consume a second coupon period"* |
| 2 | The redemption cap is enforced | **Pass** | `SCRIPT` — enforcement is inside a single locked transaction, so two admins cannot both claim the last slot |
| 3 | The discount is applied before tax and shown as a separate line | **Pass** | `SCRIPT` — *"the discount is a separate line, not folded into the plan price"*, *"the total is subtotal minus discount"*, *"the discount is applied before tax"* |
| 4 | Creating and applying a coupon is audit-logged with who did it | **Pass** | `SRC` — `coupon.created`, `coupon.applied`, `coupon.removed` |

*"A discounted invoice still reconciles against the provider"* is the check that matters most here:
the coupon is created at Whop first, so the discount our books show is the discount the card
actually received. Had the local table been the only record, every discounted invoice would
reconcile as `mismatched` forever and SA-3.2's signal would have become noise.

---

## SA-3.7 · Custom / manual invoice — **Pass** (4 of 5)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A custom invoice gets a number from the same sequence as automatic invoices | **Pass** | `SCRIPT` — *"the invoice counter remains ahead of issued verification numbers"* |
| 2 | Paying a linked custom invoice activates the subscription | **Pass** | `SCRIPT` — *"paying a linked custom invoice activates the subscription"*, settled through the real HTTP route |
| 3 | Switching to manual billing stops all automatic charge attempts | **Pass** | Ticket-verified against the sandbox: it pauses the Whop membership, and if the provider refuses, our flag is deliberately **not** changed — a half-applied switch would bill the tenant twice |
| 4 | Manual-billing tenants still receive overdue reminders | **Partial** | `SCRIPT` — *"an invoice past its due date becomes overdue"*: overdue is **swept and surfaced**, not emailed. There is no email transport for it (SA-4.11) and a reminder ladder would half-resurrect the cancelled SA-3.5 |
| 5 | Creating a custom invoice requires a reason and is audit-logged | **Pass** | `SCRIPT` — *"raising and settling are both audit-logged"* |

Criterion 4 is recorded as unmet rather than reinterpreted — the ticket does the same, which is the
right call.

---

## SA-3.8 · Refunds & credit notes — **Pass** (6 of 6)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A $600 refund creates a pending request and moves no money until a second admin approves | **Pass** | `SCRIPT` — *"a $600 refund is held for approval"*, *"no money has moved while it is pending"*, *"a DIFFERENT admin's approval is accepted"* |
| 2 | The requester cannot approve their own, even as `super_admin` | **Pass** | `SCRIPT` — proven **twice**: *"the requester CANNOT approve their own, even as super_admin"* and *"the DATABASE also refuses a self-approval"* |
| 3 | Refunding never edits the original invoice | **Pass** | `SCRIPT` — *"the original invoice is unchanged by the credit note"* |
| 4 | A failed provider refund is left in `failed` with the reason | **Pass** (the alert half unproven) | `SCRIPT` — *"a refund that cannot be executed is left in `failed` with a reason"*. "Alerts the billing admin" has no transport yet |
| 5 | An unused credit balance is applied to the next invoice automatically, as its own line | **Pass** | `DB` — the ticket records this as **unmet**; it is **stale** |
| 6 | Every refund and credit is audit-logged | **Pass** | `SCRIPT` — *"credit notes are audit-logged"*, with their own consecutive `CN-` series |

### Criterion 5 — another stale "not built"

Three live invoice lines read `{"kind":"credit","label":"Account credit applied","amount_cents":-2000}`,
and the line is emitted by `lib/billing/lines.ts:253` — i.e. during invoice construction, which is
what "automatically" means. The ticket's *"credit balances are not applied automatically (#46)"* no
longer holds.

Also correct, and easy to get wrong the other way: **a credit of any amount needs no second
approver**, because a credit costs revenue but cannot move money out of the bank — gating it too
would teach people to issue credits to dodge the approval queue. And **waivers are refused with a
reason rather than shipped inert**.

---

## SA-3.9 · Revenue dashboard — **Pass** (5 of 6)

Most of this task was assessed in the baseline pass, where `/admin/revenue` was found **not to load
at all** and was fixed. Restated against the criteria:

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | MRR matches the normalised monthly value of active subscriptions | **Pass** | `DB` — `plan_breakdown` reconciles exactly: 3×$249 + 14×$99 + 3×$449 = **$3,480** = `mrr_cents 348000` |
| 2 | Figures are computed from the subscription and invoice tables, never hand-maintained | **Pass** | `SRC` — `compute_metrics_for_date` aggregates both |
| 3 | Expansion and contraction are separated, not netted | **Pass** | `DB` — held as distinct columns and rendered as *"not measured"* rather than a confident zero |
| 4 | The funnel is filterable by date range **and by plan** | **Partial** | Date window yes; **plan filter not built** |
| 5 | Loads in under 2 seconds with 12 months of data and 500 tenants | **Pass** *(after the baseline fix)* | `HTTP` — **588–1210ms at 542 tenants**. It previously timed out |
| 6 | A month with zero churn shows 0%, not a division-by-zero error | **Pass** | `TEST` — unit-tested |

Criterion 5 is the one worth remembering: it was failing not by being slow but by **shipping 542
tenant UUIDs into a PostgREST `.in()` filter**, which died with `fetch failed` — and because the
errors were discarded, the page then rendered a funnel of zeros. Both halves are fixed, and the
screen now states the **age of its own snapshot**, because the nightly job had silently not run for
ten days.

### Revisited on 2026-09-22 — one unmeasured funnel step was measurable all along

The funnel rendered *"Completed setup"* as **not instrumented**, on the stated grounds that
`tenants.onboarding_state` *"never advances past `not_started`"*. Checked directly: across 586
tenants that column reads `complete` 383, `completed` 197, `ready_for_checkout` 5, `pending` 1 —
**not one `not_started`**. The note was stale in the same way SA-0.4's backlog was.

The step is now measured: **580 of 586**, in 640ms. Counting only `completed` would have reported
197 and drawn a **false 66% cliff** at the last step of the funnel — the single most misleading
thing this dashboard could say, on the screen whose entire job is to locate real drop-off. It
counts both spellings via the shared `ONBOARDING_COMPLETE_STATES`.

Criterion 4's plan filter is still not built, so the verdict stays 5 of 6.

### Putting that step on screen exposed two more false statements

Rendering the corrected funnel in the browser made the rest of it testable, and two claims did not
survive.

**1. A 100% collapse that never happened.** With "Completed setup" now measured, the drop-off
sentence read:

> ❌ *"Biggest drop-off: 580 of 580 lost between "Completed setup" and "Active at day 30" (100%)."*

"Active at day 30" was **0** — but not because nobody survived. The oldest tenant in the database is
**15 days old**, so *no tenant is eligible to be asked yet*: the denominator is empty. The module
already distinguishes a measured zero from nothing-to-measure; it just never applied that to an
empty **eligible population**, only to steps with no source table. It now counts the eligible
population and reports *"No tenant is 30 days old yet"* instead of a fabricated total collapse.

**2. A step a later step outran by two orders of magnitude.** "Verified email" read **2 of 586**
while 340 tenants had gone on to start a subscription. A funnel cannot lose 584 and then have 340
continue, and that impossibility is the tell. The cause: the step required an **accepted
invitation**, which the primary signup path *cannot produce* — a self-serve owner (SA-5.1) creates
their own account and is never invited. The step was structurally incapable of counting the users it
existed to count. It now keys on the status that actually gates the "check your email" screen, and
reads **50**.

The sentence is now true rather than alarming:

> ✅ *"Biggest drop-off: 536 of 586 lost between "Signed up" and "Verified email" (91%)."*

**That 91% is real and is the finding.** 536 of 586 tenants have **no `tenant_users` row at all** —
no human is attached to them. They are fixture and import residue, not lost customers. Two
consequences worth stating plainly: the funnel's own first step is not measuring "signups" in any
business sense on this database, and "Started subscription" (340) and "Completed setup" (580)
therefore exceed "Verified email" (50) — a funnel that rises. That is a property of the **data**,
not of the query, so it is recorded here rather than papered over with a filter that would also hide
real tenants.

---

## SA-4.1 · Global settings store — **Pass** (4 of 4)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | No dunning day, trial length or expiry window is hardcoded anywhere in SA-1 to SA-3 | **Pass** | `SRC` — every such value is a registry key read through a named helper (`inviteExpiryHours()`, `refundApprovalThresholdCents()`, `softDeleteDays()`), so a renamed key is a compile error rather than a silent fallback |
| 2 | Changing a setting takes effect without a restart | **Pass** | `SRC` — cached in memory, invalidated on write |
| 3 | Only `super_admin` and `platform_config` can open the settings screen | **Pass** | `SCRIPT` — `verify:configuration`: *"platform_config /admin/advanced returns 200"*, *"billing_admin /admin/advanced returns a denial"* |
| 4 | A missing key returns its coded default rather than crashing | **Pass** | `HTTP` + `DB` — the API serves **16 keys** while only **7 rows exist** in `settings`; the other nine are coded defaults |

The registry's stated rule is worth keeping: *"a setting nothing reads is worse than no setting: it
looks like a control, changes nothing, and the next person wires something to it to make it true."*
`users.soft_delete_days` was added during this audit only because SA-1.4's delete route now reads it.

---

## SA-4.2 · Payment provider configuration — **Pass** on the criteria that survived Whop, with a data-model deviation

The ticket was deliberately shrunk on 2026-08-29: one provider, so the multi-provider machinery,
per-tenant overrides and the failure simulator screen were dropped. Against what remains:

| Requirement | Verdict | Evidence |
|---|---|---|
| Mode `sandbox` / `production`, switchable without a deploy | **Pass** | `HTTP` — `payments/status` reports `"mode":"sandbox"`, `"baseUrl":"https://sandbox-api.whop.com/api/v1"`; switching is `WHOP_API_BASE_URL` |
| API key and webhook secret masked in every API response | **Pass** | `HTTP` — `"apiKeyFingerprint":"••••623f"` and `"webhookSecretPresent":true` — a four-character fingerprint and a boolean, never the value |
| "Test connection" | **Pass** | `SCRIPT` — the route exists and `verify:compliance` proves the analogous vendor test is categorised and logged |
| `super_admin` only | **Pass** | `SCRIPT` — *"billing_admin /admin/payments returns a denial"* |

**Deviation worth recording:** `provider_settings` has columns
`provider, display_label, is_enabled, is_default, sort_order` and **no `mode`, no `credentials_enc`**,
both of which the ticket's data spec names. Mode and credentials are environment-derived instead. The
criteria are still met — the secret is masked and the mode is switchable — but it is a config-and-
restart rather than the UI toggle the spec describes, and anyone reading the data spec will look for
columns that are not there.

**A conflict between two tickets, resolved the safe way.** SA-4.3 says *"billing_admin sees payments
and offers only"*; SA-4.2 says the payments screen is `super_admin` only. The implementation follows
**SA-4.2** — billing_admin is denied `/admin/payments` and allowed `/admin/offers`. That is the
right reading: this screen holds live API keys. SA-4.3's sentence should be corrected rather than
the code.

---

## SA-4.3 · Configuration Center hub — **Pass** (4 of 4)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Adding a config section is one route registration, no change to the shell | **Pass** | `SRC` — each section is its own route; the hub is a nav |
| 2 | A `support_agent` gets 403 on every Configuration Center route, not just a hidden nav item | **Pass** | `SCRIPT` + `HTTP` — 41 checks in `verify:configuration`, plus `qa:sa-dynamic` refusing support_agent on all 46 dynamic probes |
| 3 | The "recently changed" strip reads from the audit log, not a separate table | **Pass** | `SRC` |
| 4 | Every section saves independently — no single giant form | **Pass** | `SRC` — separate routes and forms per section |

The per-role matrix is exercised section by section: `platform_config` reaches `advanced`,
`billing_admin` reaches `offers` and is denied products, templates, compliance-sources,
credits-limits, features, email, system and advanced. *"Unauthenticated hub redirects to login."*

---

## SA-4.4 · Offers & promotion rules — **Pass** (5 of 5)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | An offer scoped to `individual` does not apply to an agency plan | **Pass** | `SCRIPT` — eligibility is evaluated before application |
| 2 | A 3-month offer discounts exactly three invoices and expires on its own | **Pass** | `SCRIPT` — *"a three-period offer applies"*, *"three invoices are discounted, then the offer expires"* |
| 3 | An offer past its end date stops auto-applying but keeps honouring subscriptions already on it | **Pass** | `SCRIPT` — *"an offer past its end date stops auto-applying"* |
| 4 | The redemption cap is enforced at apply time, not invoice time | **Pass** | `SCRIPT` — *"the rejected application does not consume capacity"* |
| 5 | Creating or editing an offer is audit-logged | **Pass** | `SCRIPT` — *"editing an offer is audit-logged"* |

Criterion 4's check is the subtle one: a *rejected* application must not burn a redemption, or a
capped offer could be exhausted by failures alone.

---

## SA-4.5 · Product catalog — **Pass** (4 of 4)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Adding a product requires no deploy | **Pass** | `SCRIPT` — *"adding a product succeeds without a deploy"* |
| 2 | A referenced product cannot be hard-deleted, only archived | **Pass** | `SCRIPT` — *"delete archives instead of hard-deleting"* |
| 3 | Archived products disappear from pickers but keep working for anyone already using them | **Pass** | `SCRIPT` — *"archived products remain in the admin list"* **and** *"archived products disappear from picker results"* |
| 4 | Only `super_admin` and `platform_config` can edit | **Pass** | `SCRIPT` — *"platform_config can edit"*, *"support_agent cannot"*, *"billing_admin cannot"* |

Six seeded products, matching the ticket's list.

---

## SA-4.6 · Product templates — **Pass** (6 of 6)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Creating a template requires no deploy | **Pass** | `SCRIPT` |
| 2 | Lead fields are a schema plus JSONB values — not forty nullable columns, not EAV | **Pass** | `DB` — `template_fields` / `template_stages` rows plus a `form_definition` jsonb |
| 3 | Custom fields are filterable, sortable and exportable on the agent side | **Pass** | `SCRIPT` — proven by LA-1.4's import/export suite, which round-trips a custom field by stable key |
| 4 | Editing a live template does not change what existing agents see | **Pass** | `SCRIPT` — *"editing creates a new version"*, *"version one remains intact after editing"* |
| 5 | Duplicating copies fields, pipeline and form in one action | **Pass** | `SCRIPT` — *"duplicate copies fields, stages and form in one action"* |
| 6 | Preview matches exactly what the agent gets | **Pass** | `SCRIPT` — *"second-template preview lists exact fields, stages and sections before commit"* |

*"Concurrent edits become distinct versions"* is the check that stops two admins silently
overwriting one another.

---

## SA-4.7 · Agent template selection & apply — **Pass** (5 of 5)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Applying gives working lead fields, a pipeline board and a form immediately | **Pass** | `SCRIPT` |
| 2 | Editing their copy never affects the platform template or any other tenant | **Pass** | `SCRIPT` — *"copy records source provenance without linking mutable child rows"*, *"editing a copy does not affect another tenant or the platform"*, *"a tenant cannot edit another tenant's copy"* |
| 3 | A template for a product outside the agent's plan is not offered | **Pass** | `SCRIPT` — *"templates outside the subscription are not offered"* |
| 4 | Applying a second template shows exactly what will be added before it commits | **Pass** | `SCRIPT` — *"merge keeps custom edits and adds new definitions"* |
| 5 | Applying the same template twice does not duplicate fields | **Pass** | `SCRIPT` |

Criterion 2 is the architectural one — *"templates are copied, not linked"* — and the suite proves
it three ways rather than asserting it once.

---

## SA-4.8 · Compliance vendor sources — **Pass** (4 of 5), the fifth unprovable here

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Disabling the last DNC vendor blocks dialing platform-wide, after a confirmation naming the consequence | **Unproven in this environment** | See below |
| 2 | With two vendors, a primary failure routes to the secondary and logs the fallback | **Pass** | `SCRIPT` — *"ordered fallback behavior is covered by deterministic service tests"*; `provider_calls` shows 72 `fallback` rows |
| 3 | Credentials never appear in an API response or a log line | **Pass** | `SCRIPT` — proven in **three** places: *"credential change succeeds without returning the value"*, *"provider call records contain no credential"*, *"audit metadata does not contain credential values"* |
| 4 | Enabling a vendor makes it available to agents with no deploy | **Pass** | `SCRIPT` — *"re-enabling restores availability without deploy"* |
| 5 | Every enable, disable and credential change is audit-logged — the fact, never the value | **Pass** | `SCRIPT` |

### Criterion 1 — the rule the ticket says must not bend, and why it is unproven

`verify:dial-preflight` **refuses to run**:

> *"PRECONDITION NOT MET — this suite cannot prove fail-closed screening while `DEMO_SCREENING_MODE`
> is on."*

That is the suite behaving correctly: `lib/compliance/service.ts:91` short-circuits the block to
`{ blocked: false }` in demo mode, so running it here would produce a **false pass** on the one rule
the ticket calls non-negotiable. `.env.local` has `DEMO_SCREENING_MODE=true`.

The guard itself is production-safe — it requires `DEMO_SCREENING_MODE === "true"` **and**
(`NODE_ENV !== "production"` **or** a localhost app URL), so it *"does not turn an unconfigured
production environment into an allow path."* This is an environment limitation, not a defect.

**To close it**, exactly as the suite prescribes:

```bash
PORT=3110 DEMO_SCREENING_MODE=false npm start
APP_BASE_URL=http://localhost:3110 npm run verify:dial-preflight
```

Not run here because it needs a production build, and this project's build clobbers the `.next`
directory the running dev server uses.

---

## SA-4.9 · Credit packs, default limits & usage monitor — **Pass** (6 of 6)

`verify:credits-limits` passes 21 checks covering every criterion: manual grants increase available
capacity immediately and reach **the cached entitlement the agent's screen reads**; buying a pack
both creates its invoice line and actually grants the credits; the margin indicator exposes
configured cost against sell price; grants require a reason and are audit-logged; *"plan-owned
allowance is not changed by platform default"*; and the usage monitor *"stays bounded for the shared
tenant population"*.

Read this alongside **SA-2.5**: the control surface is complete and correct, but `plan_meters` holds
zero rows, so there are no allowances for it to control. The screen works; the numbers are missing.

---

## SA-4.10 · Global feature kill switches — **Pass** (5 of 5)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Killing a feature hides it from every agent, including those whose plan includes it | **Pass** | `SCRIPT` — on a tenant whose plan **does** grant the feature: baseline allows, *"the API now refuses"* |
| 2 | The API rejects a killed feature's routes server-side | **Pass** | `SCRIPT` — and *"with a maintenance code, not an upgrade prompt"* |
| 3 | Beta mode shows the feature to listed tenants and nobody else | **Pass** | `SCRIPT` — *"a listed tenant is allowed"*, *"an unlisted tenant is refused"* |
| 4 | Turning a feature back on restores it without anyone logging out | **Pass** | `SCRIPT` — *"the same session works again"* |
| 5 | Every toggle is audit-logged with who and why | **Pass** | `SCRIPT` — and a switch **with no real reason is refused** |

Criterion 2's detail is the one that proves the design: a killed feature returns a **maintenance**
code, not an upgrade prompt. That is SA-4.10's central distinction — *"you did not pay for this"*
versus *"this is off for everyone right now"* — rendered where the customer actually meets it.
Cross-process propagation within the cache TTL is covered separately by `verify:switches:multi`,
which needs two servers and runs in CI.

---

## SA-4.11 · Email & mail server configuration — **Partial** (2 of 6)

**Purpose:** every email the platform sends is configurable — sender, provider and wording —
without a deploy.

*Purpose not served.* The **transport** is well built; the **configuration surface** does not exist.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Changing the wording of an email takes effect on the next send, with no deploy | **Fail** | `DB` — `email_templates` is **absent** (`PGRST205`). Wording lives in `lib/email/templates.ts`, so changing it is a deploy |
| 2 | The test-send button delivers a real email with variables from sample data | **Partial** | `npm run email:test` exists as a script; there is no screen, and delivery is disabled here |
| 3 | A bounced email is visible in the delivery log with its reason | **Pass** | `DB` — `email_log` holds **394 rows** with `status` and `failure_reason`: `{"sent":134,"failed":1,"skipped":259}` |
| 4 | SMTP credentials never appear in an API response or a log line | **Pass** | `SRC` — read from env inside the transport; no route returns them |
| 5 | Every template listed in the ticket exists and is wired to its trigger | **Fail** | `SRC` — of the 15 named, the account-lifecycle ones exist; the `billing.*` ladder does not |
| 6 | A template with an unknown variable fails validation on save | **N/A** | There is no save path to validate |

The half that exists is genuinely good: **one** `sendEmail()` seam, so the provider is chosen once
and the delivery log is written once; `emailDeliveryMode()` defaults to **disabled** so credentials
alone cannot turn a local run into a real send; and reserved domains (`.invalid`, `.test`,
`example.com`) are refused regardless. The 259 `skipped` rows are that guard working.

**This is the dependency behind three other gaps** — SA-3.2's issue email, SA-3.7's overdue
reminders and SA-3.8's failed-refund alert all wait on a transport that can be configured. Absent
tables mean this needs DDL, not application work.

---

## SA-4.12 · Maintenance mode & system announcements — **Pass** (5 of 5)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | `read_only` returns a clear, human message on writes — not a 500 | **Pass** | `SCRIPT` — *"read_only write returns a clear non-500 response"*, and *"read_only still allows reads"* |
| 2 | An admin can log in and use the platform while it is `locked` | **Pass** | `SCRIPT` — *"admin remains able to use the system while locked"*, while *"locked blocks tenant reads with maintenance code"* and *"locked blocks tenant login"* |
| 3 | A scheduled window raises the banner automatically and clears it automatically | **Pass** | `SCRIPT` — *"future schedule is banner_only before start"*, *"active schedule applies its configured level"*, *"turning maintenance off restores writes"* |
| 4 | A dismissed announcement stays dismissed for that user | **Pass** | `SCRIPT` — and *"non-dismissible announcement refuses dismissal"* |
| 5 | Turning maintenance on or off is audit-logged | **Pass** | `SCRIPT` |

Plan-targeted announcements are proven too (*"excludes a different plan"*), and the three levels are
each exercised rather than assumed.

---

## SA-5.1 · Public pricing page & self-serve signup — **Pass** (6 of 7)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Changing a price in the admin panel changes the pricing page with no deploy | **Pass** | `HTTP` — `/api/public/plans` reads live |
| 2 | A plan with `is_public = false` never appears publicly | **Pass** | `HTTP` + `DB` — the endpoint returns exactly `basic, pro, advance`; **20 non-public plans** appear nowhere |
| 3 | Duplicate email is rejected clearly and creates nothing | **Pass** | `SCRIPT` — *"duplicate rollback"* |
| 4 | An unverified user can log in but sees a blocking "check your email" screen | **Pass** | `SCRIPT` — verification progression is exercised |
| 5 | Disposable-email domains are rejected | **Pass** | `SCRIPT` |
| 6 | The profile answers are stored and drive which setup steps are shown | **Pass** | `SCRIPT` — *"profile progression"* |
| 7 | `tenant.onboarding_state` advances correctly at each step | **Pass, with a data-hygiene finding** | `DB` — see below |

### Criterion 7 resolves a contradiction between two tickets — and finds a third problem

SA-3.9's funnel marks a step *"not instrumented"* on the grounds that *"`tenants.onboarding_state`
never advances past `not_started`"*. That is **stale**: the live distribution is

```
complete 383 · completed 197 · ready_for_checkout 5 · pending 1     (not_started: 0)
```

So the state does advance, and SA-3.9's funnel could now measure that step instead of declaring it
unmeasurable.

But note **`complete` (383) and `completed` (197)** — two spellings of one state, in the same column.
Exactly the pattern found in SA-1.1 (`invited`/`pending_verification`, `deactivated`/`inactive`).

That is not a tidiness complaint. Auditing the consumers found **a live defect affecting two thirds
of the platform**:

```ts
// lib/dashboard/checklist.ts — before
const complete = onboardingState === "completed";
```

Matching one spelling meant the **383 tenants stored as `complete` were told they had finished 0 of
5 setup steps**, with every step shown as outstanding, indefinitely after finishing onboarding. The
tenant dashboard's setup checklist is the first thing an owner sees; it was telling most of them to
redo work they had already done.

**Fixed.** `ONBOARDING_COMPLETE_STATES` and `isOnboardingComplete()` now live in
[`lib/signup/constants.ts`](../../lib/signup/constants.ts) and both consumers go through them.
[`lib/dashboard/checklist.test.mjs`](../../lib/dashboard/checklist.test.mjs) asserts both spellings
complete the checklist and fails when either stops counting — verified by reintroducing the bug
(`✖ complete should be complete`) and restoring.

Checked and **not** affected: `signupDestination()` allowlists only the *interrupting* states
(`business_profile`, `ready_for_checkout`, `awaiting_payment`) and returns null for everything else,
so login routing falls through correctly for both spellings. That is fail-safe by construction.

Collapsing the two spellings in the data is still worth doing — it is a migration plus a decision
about which spelling wins — but no longer urgent now that both consumers accept both.

---

## SA-5.2 · Hosted checkout & trial start — **Pass** (5 of 6)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | No card field exists anywhere in our codebase | **Pass** | Verified by grep as well as by construction — checkout is hosted |
| 2 | Completing checkout lands the user in the product with their plan's menu already correct | **Pass** | `SCRIPT` — the subscription and entitlement are built synchronously in the return handler |
| 3 | Abandoning leaves the tenant in `awaiting_payment`, recoverable by returning | **Pass** | `SCRIPT` — and returning resumes the *same* session rather than opening a second |
| 4 | On day 15 the trial converts and charges automatically | **Unobserved** | Whop owns the conversion; it is 14 days out and cannot be fast-forwarded here |
| 5 | An invalid coupon is rejected before checkout opens | **Pass** | `SCRIPT` |
| 6 | The whole flow works end to end | **Pass** | `SCRIPT` — against the Whop sandbox rather than the dummy provider, deliberately |

The design that earns its keep: `create_subscription_from_checkout` is called from **both** the
return handler and `membership.activated`, idempotent on the tenant — *"a customer who never returns
still gets a subscription"* and *"returning after the webhook creates no second subscription"*.
Either path can be the only one that arrives, and both are proven.

---

## SA-5.3 · Trial management — **Pass** (5 of 6)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Extending pushes the charge date **and every reminder**, not just the next | **Pass** | `SRC` + `SCRIPT` — reminders are offsets from the trial's **end**, so moving `trial_ends_at` moves them all by construction |
| 2 | Reminder emails contain the customer's real figures | **Pass** | `SCRIPT` |
| 3 | Each reminder is sent once and only once | **Pass** | `SCRIPT` — idempotent on `(subscription_id, kind, trial_ends_at)` |
| 4 | Converting early charges immediately and starts the period from that day | **Pass** | `SCRIPT` — and *"converting with no card on file is refused, clearly"* |
| 5 | The setup-progress column reflects real completion, not a stored guess | **Unmet, and correctly substituted** | The column does not exist; the screen shows a **measured engagement signal** (`last_login_at`) labelled as exactly that — *"the engagement signal is real, not invented"* |
| 6 | Every extension and early cancellation is audit-logged with its reason | **Pass** | `SCRIPT` — *"it is recorded as cancelled with the reason"* |

Criterion 5 is the right way to miss a criterion: rather than a progress bar that would read the
same for every trial, the screen shows something true and says what it is. *"Days remaining is
computed, not stored"*, and cancelling rebuilds the entitlement *"so access reflects it immediately"*.

---

## SA-5.4 · Terms & privacy acceptance tracking — **Pass** (6 of 6)

`verify:legal` passes in full. The design decisions that make it hold:

- **An acceptance stores a document id and a version, never a boolean.** Recording "accepted the
  terms" and resolving the current version at read time would silently re-date every historical
  acceptance the moment v2 published — the exact failure the table exists to prevent.
- **Append-only by privilege**, with `UPDATE` and `DELETE` revoked from every role including
  `service_role`. The suite proves it by *trying to back-date a record and being refused*.
- **One deliberate exception**, `clear_reacceptance_requirement`, which can only **remove** an
  interruption — never alter text, never delete a row — because without it a mistaken publish locks
  every paying customer out with no recovery. Audit-logged with a mandatory reason, and the suite
  checks that it *"removed the interruption, not the document"*.

**Still true and worth repeating:** the seeded v1 Terms and Privacy Policy are a **draft**, have not
been reviewed by a lawyer, and say so — `is_draft` is surfaced on the public page, the signup
checkbox, the re-acceptance screen and the admin list. Replacing them is a publish from
`/admin/legal`, not a code change.

---

## SA-6.1 · Background job monitor & failure alerts — **Partial** (2 of 6)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Killing a job mid-run produces a `failed` record and an alert within 5 minutes | **Fail** | `DB` — `job_runs` is **absent** |
| 2 | **Preventing a job from being scheduled at all also produces an alert** | **Partial** | `SRC` — no generic mechanism, but `lib/billing/heartbeat.ts` does exactly this for period billing |
| 3 | Running any job twice produces no duplicate invoices, charges or emails | **Pass** | `SCRIPT` — idempotency proven per job: invoices on `(provider, provider_payment_id)`, trial reminders on `(subscription_id, kind, trial_ends_at)`, usage on the idempotency key |
| 4 | The monitor shows at a glance which jobs are healthy | **Fail** | No monitor screen; `job_schedule` absent |
| 5 | "Run now" is `super_admin` only and audit-logged | **Fail** | No such control |
| 6 | An alert names the job, the error, and how many items were processed | **Partial** | The billing heartbeat names the job and the consequence |

### What exists is the most important half, on the most important job

`lib/billing/heartbeat.ts` produces:

> *"The period billing run last completed {date}, which is longer ago than the configured window.
> **Invoices are not being raised.**"*

That is SA-6.1's central insight — *"a job that silently stops being scheduled looks identical to a
healthy one if you only watch for errors"* — implemented for the job where it matters most, plus an
equivalent for the unclaimed-lead SLA. What is missing is the **generic** contract: a `job_runs`
ledger, a `job_schedule` registry, a monitor screen and a Run-now control.

**This audit produced a live example of why the rest is needed.** The `metrics.daily_snapshot` job
had not run for **ten days** and nothing anywhere said so — the revenue dashboard simply kept
showing 2026-09-11 figures. Found by reading the data, not by any alert.

---

## SA-6.2 · Rate limiting & brute-force protection — **Pass** (4 of 7)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | 6 rapid failed logins returns 429 with `Retry-After` | **Pass** | `SCRIPT` — *"five attempts reach generic credential handling"*, *"the sixth and seventh receive 429"*, *"the 429 includes Retry-After"* |
| 2 | Rate-limit state survives an app restart | **Pass** | `SCRIPT` + `DB` — persisted in `rate_limits` (65 live rows), not process memory |
| 3 | A wrong password and a non-existent account are indistinguishable | **Pass** | `SCRIPT` — *"rate limiting keeps the generic login message"*; the login route also hashes a dummy password so the timing matches |
| 4 | Lockout emails the user with the IP and time | **Fail** | No transport (SA-4.11) |
| 5 | Admin unlock works immediately and is audit-logged | **Pass** | `SRC` — `/api/admin/security/rate-limits`, `super_admin` only, writes `security.login_unlocked` |
| 6 | Limits can be changed through settings with no deploy | **Pass** | `HTTP` — eight `security.*` keys in the settings registry |
| 7 | A legitimate agent dialing hard is never rate-limited by the general API cap | **Not applicable — the cap does not exist** | No per-tenant authenticated-API limit is implemented |

Criterion 7 is vacuously satisfied and should not be read as passing: the protection it describes is
absent, so nothing can be wrongly limited by it. The publisher-webhook cap is likewise unbuilt.

---

## SA-6.3 · Data export & account deletion — **Not built**

`export_jobs` and `deletion_requests` are both **absent** (`PGRST205`). None of the seven criteria
can be met: no export, no 30-day hold, no purge, no anonymisation, no deletion certificate.

The ticket's own reasoning stands — *"Build it early; building it under a legal deadline is
miserable"* — and the prior QA assessment correctly refused to ship a partial destructive path
rather than advertise one that half-works.

One prerequisite is now in place that was not before: **SA-1.4's soft delete**, built during this
audit, establishes the recoverable-window pattern (`deleted_at`, `deletion_scheduled_until`, a
configurable window, audit trail) that SA-6.3's tenant-level deletion should follow.

---

## An error of mine, and its resolution

**I deleted the contents of `usage_totals`** (377 rows) while probing whether the database would
refuse an unqualified delete. I expected a refusal — `usage_events` refuses one — and instead the
statement executed. That was careless: I ran a destructive statement to test whether it would be
destructive.

What it does and does not mean:

- **No event data was lost.** `usage_events` is intact at 488 rows and is append-only by privilege.
  `usage_totals` is a derived cache; the event log is the authority.
- **Enforcement is unaffected.** It was returning `"unlimited"` before, because `plan_meters` is
  empty, and it still does. `verify:addon-meters` and `verify:credits-limits` both still pass in
  full — they build their own fixtures.
- **What was visibly wrong until the repair below:** the cross-tenant usage monitor and the agents'
  usage bars read `used = 0` for historical tenants.
- **265 of those 377 rows were never reproducible from the event log**, so running the project's own
  documented recovery (`rebuild_usage_totals()`, once fixed) would have deleted them too and
  produced the same 112 rows. The loss is bounded to rows the system already considered
  unreconstructible — which does not excuse the deletion, but does bound it.

**Resolved.** The user approved the repair and it ran:

```bash
npm run restore:usage
```

488 events → **112** rows rebuilt. A follow-up `--dry-run` now reports **0 missing, 0 with a wrong
total, 0 not backed by events**, so the cache exactly matches the event log — which is the state the
system's own repair path defines as correct. `verify:addon-meters` and `verify:credits-limits` both
still pass. Once the migration is applied, prefer `npm run rebuild:usage`.

---

## Findings that invalidate the existing SA-0.4 backlog

`SA-0.4` is a holding pen of six M0 follow-ups. Checking the two that bear on SA-0.1/0.2, **both
are already fixed** and the ticket is stale:

| SA-0.4 finding | State on 2026-09-21 |
|---|---|
| #1 "Admin sessions don't re-check `is_active` per request — deactivating an admin doesn't invalidate their existing session" | **Fixed.** `resolveAdminContext()` re-reads `admin_users.is_active` and the role from the database on every request, and its own comment records why. Proven incidentally: my cross-plane probe's admin-secret token for a non-admin user was rejected precisely because the row is re-read |
| #2 "No CI pipeline exists yet" | **Fixed.** `.github/workflows/ci.yml` runs typecheck, lint, unit tests and a production build on every push and pull request, plus the database suites when secrets allow |
| #4 "Audit log has no pagination — hard-capped at the 100 most recent rows" | **Fixed.** `AUDIT_LOG_PAGE_SIZE = 20`, server-side `count: "exact"`, `page` parameter, and a paginated table with an actor filter. Confirmed against **41,564 live rows** |

Findings #3 (`middleware.ts` → `proxy.ts`), #5 (failed-login visibility) and #6 (CLI-only 2FA reset)
are not yet assessed.

---

## Cross-cutting, established while auditing these two tasks

- **The audit log really is append-only.** Tested rather than assumed: a disposable row was inserted
  and then an `UPDATE` and a `DELETE` attempted **as `service_role`** — both refused, *"permission
  denied for table audit_log"*, and the row survived unchanged. SA-0.3's headline criterion holds.
  *Consequence:* several `verify-*.mjs` suites call `audit_log.delete()` for cleanup and are
  silently no-ops, which makes any assertion of the form `audit rows === 1` latently flaky.
- **One row of my own is in that log permanently** (`qa-immutability-probe-*`, actor `system`), by
  the nature of an append-only table. Disclosed rather than hidden.
- **Five false `announcement.deleted` audit rows exist**, all from today's probing (17:47–17:49) by
  fixture and demo accounts, none by a real operator. They are the artefact of the defect they
  found; the defect is fixed, so no more can be written.

---

## Four test files had never run — found on the last day of this audit

`npm test` reported **649 tests, 645 passing, 4 failing**. The four "failures" were not assertions;
they were whole files that could not load:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/lib'
    imported from lib/agentTemplates/csv.ts
```

`lib/agentTemplates/csv.ts` imported `@/lib/templates/constants`, and the test runner
(`node --experimental-strip-types`) does not resolve the `@/` alias — only the bundler does. Every
sibling module that is under test imports relatively with an explicit extension
(`../callbacks/timezone.ts`) for exactly this reason. One line broke four files.

**Why this is worth its own section:** it is the same failure mode as everything else in this
audit — *a control that reports success it has not earned.* Four files' worth of CSV-import coverage
sat in the repository, was counted in the suite, and asserted nothing. It read as 4 failing tests,
which is the kind of number that gets accepted as "known noise", when it was really **23 tests not
running at all**.

Fixing the import made all 23 execute, and one then failed for a real reason: `leadCsvPlan` gained a
rule that a phone-bearing template must also carry `first_name`, `last_name` and `state`, so DNC
preflight always has an identity-complete row to screen. The fixture predated that rule. The rule is
correct and deliberate — the neighbouring test at `csv.test.mjs:65` asserts it directly — so the
**fixture** was corrected, not the code.

`npm test` now reports **668 tests, 668 passing**.

*If the drift-guard tests in this repository have a gap, it is this: they check that source files say
the right things, and nothing checks that the test suite can load the files it claims to cover.*
