# LA acceptance audit — criterion by criterion

Started 2026-09-22, continuing the method of
[`SA-ACCEPTANCE-AUDIT-2026-09-21.md`](SA-ACCEPTANCE-AUDIT-2026-09-21.md). Authority: the `LA-x.y`
rows in the *Insurvas Sprint* Notion database, read directly rather than inherited from the earlier
LA audit documents in this folder.

**A prior QA document is not evidence, and neither is a Notion status.** Both LA-0.1 and LA-0.2 are
marked `Completed` in Notion; that is the claim under test, not the answer.

| Class | Meaning |
|---|---|
| `DB` | Live query against the project in `.env.local` |
| `HTTP` | Real request to the running app with a minted session of a named role |
| `TEST` | A test that fails when the behaviour regresses — **verified by reintroducing the bug** |
| `SCRIPT` | An existing `verify:*` suite, re-run 2026-09-22 |
| `SRC` | Source read — structural proof only, flagged where it is the sole evidence |
| `BROWSER` | Driven in a browser as a real tenant user |

Verdicts: **Pass** · **Pass (conditional)** · **Partial** · **Fail** · **Not built** · **Cancelled**

---

## LA-0.1 · Agent app shell, login & entitlement-driven menu — **Pass** (6 of 6)

**Goal:** an agent logs in and sees exactly the modules their subscription includes — nothing more,
nothing less — with no per-plan code anywhere.

*Goal served.* This is the strongest task the audit has examined so far, and the reason is that the
central rule is enforced by a test of the **negative** claim rather than by review.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | An agent without `inbound_transfers` never sees the Inbound item, and pasting `/leads/inbound` is blocked | **Pass** | `SCRIPT` — *"unentitled inbound URL returns the gate screen"*, *"…is not rendered as a navigation link"* |
| 2 | The API rejects the same request server-side — hiding the menu item is not the protection | **Pass** | `SCRIPT` — *"unentitled inbound read API returns 403"* and *"unentitled inbound API returns 403"*, i.e. both read and write |
| 3 | Adding a menu item is one entry in the data file, with no per-plan branching | **Pass** | `TEST` — `lib/menu/planBranching.test.mjs`, see below |
| 4 | Changing the plan changes the menu on the next page load, without a re-login | **Pass** | `SCRIPT` — *"the same session sees inbound after a plan change"*, then *"the entitled inbound read API returns 200"* |
| 5 | A `suspended` subscription is read-only but still lets the agent read their own data | **Pass** | `SCRIPT` — *"suspended tenant can still read its book"*, *"…can still read inbound data"*, *"…cannot create new work"*, *"concurrent suspended writes are both rejected"* |
| 6 | Agent and admin sessions cannot be confused for one another | **Pass** | `SCRIPT` — *"admin cookie cannot authenticate as a tenant"* and *"tenant cookie cannot authenticate as an admin"*, both directions |

### Criterion 3 is proved the hard way, and that is the point

Notion states the rule twice and in italics — *"Menu defined once, as data. Never write one menu per
plan."* A test that renders the menu and checks the result proves the menu **filters**; it cannot
prove that nothing, anywhere, branches on a plan. `lib/menu/planBranching.test.mjs` proves the
negative instead, by scanning the shell's whole decision path (`lib/menu`, `lib/entitlements`,
`lib/tenantAuth`, `lib/dashboard`, `proxy.ts`) for:

- any comparison against `plan_code` / `planCode` / `plan_version`, or a `switch` on a plan;
- any **menu key** appearing inside a conditional outside the data file, because a key named in an
  `if` no longer gets its visibility from the data;
- any menu item that **no** feature/role combination can reveal, which would be an item needing code
  to appear;
- and, mechanically, it appends a synthetic entry to `AGENT_MENU` at runtime, runs the same exported
  filter, and asserts the item appears — then pops it in a `finally`.

It also carries LA-0.1's in-scope line *"tenant scope resolved from the session, never from a request
parameter"* by walking all 120 agent routes for `searchParams.get("tenant")`, `x-tenant` headers and
`body.tenant_id`. Zero offenders.

Criterion 5 deserves a note too: the suspended case is the one most often implemented as a blanket
403, which would violate the criterion's second half. Here reads and writes are tested separately
and the reads genuinely survive.

---

## LA-0.2 · In-tenant roles & permissions — **Pass** (5 of 6, the sixth not yet enforceable)

**Goal:** inside one agent's account, different people see different things — and the assistant can
do the data entry without ever seeing a commission figure.

The commercial argument is in the ticket and worth restating, because it sets the bar: the assistant
seat is \$29 against a \$49 producer seat, and *"the permission model has to genuinely hide money for
that price to be defensible."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | An `assistant` calling any commission or ledger endpoint gets 403 — **across every money route** | **Pass** | `TEST` + `SCRIPT` — see below |
| 2 | A `bookkeeper` cannot open the dialer or play a recording | **Pass**, with recordings pre-covered | `TEST` + `SCRIPT` — *"bookkeeper could use the dialer"* is asserted false; no recording endpoint exists yet, and the classifier's `/recording/` pattern covers one the day it appears |
| 3 | A `producer` cannot see another producer's commission figures | **Rule correct, not yet enforceable** | See below — now guarded |
| 4 | Demoting the last `owner` is blocked with a clear message | **Pass** | `SCRIPT` — 409 `last_owner`, and *"concurrent last-owner demotions were not both blocked"* asserts the race too |
| 5 | Role changes apply on the next request | **Pass** | `SCRIPT` — promotion then an immediate request on the same session |
| 6 | Seats consumed by role are visible to the owner | **Pass** | `SCRIPT` — asserts `seats.byRole` counts, not merely a 200 |

### Criterion 1 is met by the right kind of test

The criterion says *every* money route, and a hand-written list of HTTP cases stops being true the
moment someone adds the next endpoint. `lib/tenantAuth/moneyRoutes.test.mjs` instead **classifies
all 120 agent routes exhaustively**: every `route.ts` must match a money pattern, a dial pattern, or
an explicit neutral list, and an unclassified route **fails the suite**. So adding a commission
endpoint forces the author to declare which side of the money boundary it sits on before it can
ship.

It fails in both directions — a stale neutral entry naming a deleted route also fails — and it treats
a role argument it cannot read statically as a **leak**, not a pass. It additionally cross-checks the
route guards against `permissions.ts` and against the `AGENT_API_POLICIES` registry, so the three
cannot disagree silently.

**Verified by mutation, not by reading.** Adding `"assistant"` to the ledger route's allowed roles
turned 2 of the 10 tests red (`ledger/route.ts: allows assistant`); restoring it returned them to
green.

### Criterion 3: the rule exists, is tested, and has no callers

`roleCanViewCommission(role, viewerUserId, producerUserId)` in `lib/tenantAuth/permissions.ts`
implements the criterion exactly, and `permissions.test.mjs` asserts producer-A↛producer-B. Checked
across the codebase on 2026-09-22:

```
callers of roleCanViewCommission: (none)
```

It is unenforced rather than wrong. The ledger route is still a frame — it answers `entries: []` to
everyone, and `/app/ledger` renders a header with a disabled *Import statement* button — so there is
no commission figure for the rule to protect. The ledger itself belongs to a later module; building
it is not LA-0.2's job.

**What stood between that and a future leak was a comment** in the route: *"Producers must be
filtered to their own producer_id when ledger rows are added."* This audit has repeatedly found
comments and notes that had quietly stopped being true — SA-0.4's backlog, SA-3.9's funnel note, the
`not_started` claim in two modules. So the comment is now a test:

> `the ledger cannot start returning rows without scoping them to the producer`

While the route still returns the literal empty array it passes quietly. The moment the stub is
replaced with a real query and `roleCanViewCommission` is not referenced, it fails and names the
criterion. **Verified by mutation:** changing `entries: []` to `entries: rows` fails with
*"returns ledger rows but never calls roleCanViewCommission — LA-0.2 criterion 3 requires a producer
to see only their own commission figures"*.

---

## UI/UX: every role gate was a dead end, and one page knew it

Driven in the browser as a real `assistant` in the fully-entitled demo tenant, so that **only the
role** differs from the owner session.

**What works.** The header badge reads *"Assistant access"* rather than *"Owner access"*; the
dashboard tiles drop Commission ledger, Policies, Dialer and Scorecard; the sidebar loses Settings.
The money boundary is visible, not just enforced — which is the \$29-seat argument made real.

**What did not.** Pasting `/app/ledger` produced a correct, clearly worded card:

> *"Commission ledger is not available for your role — Your tenant role does not include commission
> visibility."*

…and nothing else. No icon, no action, no way back. The user has been told they are in the wrong
place and left there.

`RoleGateNotice` has **27 call sites**, and exactly one — the dialer — had thought to append *"Ask
the account owner if you need a different role"* to its own copy. That is the argument for fixing it
in the component, and it is the same argument `FeatureGateNotice` already makes in its own comment
about keeping its branch in one place so no page quietly gets it wrong.

The component now states that the reason is a role and **not** the plan, names who can change it,
and always offers a way out. It deliberately does **not** link to Settings → Team: the roles that
land here cannot open Settings either, and a link that gates a second time is worse than no link.
Nor does it offer an upgrade, which would be a lie — a role is not for sale.

The duplicated sentence was removed from the dialer call site. Confirmed in the browser: the gate
renders with the icon and the new line, and *"Back to your dashboard"* navigates.

---

## State of the suite, after LA-0.1 and LA-0.2

`npm test` — **670 passing, 0 failing**. `typecheck` and `lint` clean. `npm run verify:la0` — all six
LA-0 suites pass in 170.6s. (Current totals after LA-0.3 and LA-0.4 are at the end of this document;
the one failure there is another session's, not this audit's.)

One structural note carried forward: every test in `moneyRoutes.test.mjs` and
`planBranching.test.mjs` opens with `if (!routes) return;`, which passes silently if the route
directory is not found. That is the same shape as the four `agentTemplates` files that had never run
(recorded in the SA audit). It is not firing today — 120 routes are found and classified, proven by
mutation — but a guard that can pass by finding nothing is worth knowing about.

---

## LA-0.3 · Dashboard shell — **Pass** (4 of 5), and one criterion a module had quietly broken

**Goal:** the first screen after login answers one question in three seconds — *am I okay?*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A module adds a tile by registering it, **with no change to the dashboard component** | **Partial — one module broke it, and the break cost a real defect** | `SRC` + `TEST` — see below |
| 2 | Tiles the agent is not entitled to are absent, not greyed or empty | **Pass** | `TEST` — *"tiles filter by entitlement"*, including `visibleDashboardTiles([], "owner") === []`; `BROWSER` — an assistant's grid simply lacks the money tiles |
| 3 | The setup checklist disappears once complete and does not come back | **Pass — after today's fix** | `TEST` + `BROWSER` — see below |
| 4 | Every empty state names the next action | **Pass, enforced by the type** | `SRC` + `BROWSER` — `hint` and `action_label` are **required fields** on `DashboardTile`, so a tile without them does not compile. **But see the finding below** — the field was called `empty_state` and two tiles asserted emptiness as fact |
| 5 | The page loads in under 1 second | **Pass — after today's fix** | `HTTP` — 0.87–0.99s across five runs, **in dev mode** |

### Criterion 3 was failing for two thirds of the platform until today

This is the defect recorded in the SA audit, and LA-0.3 is the ticket that makes it a criterion.
`setupChecklistForState` compared `onboardingState === "completed"`, and the column holds **two
spellings** — `complete` (383 tenants) and `completed` (197). For the 383 the checklist never
disappeared: a permanent *"Get set up — 0 of 5 complete"*, every step outstanding, directly beneath a
header badge reading **"Workspace ready"**. The screen contradicted itself.

Fixed via the shared `isOnboardingComplete()`, with `lib/dashboard/checklist.test.mjs` asserting both
spellings and verified by reintroducing the bug. Confirmed in the browser both ways: with the bug the
card renders, without it the dashboard goes straight to Callbacks.

### Criterion 1 holds for tiles — and the one module that ignored it produced a live bug

The mechanism itself is sound: `DASHBOARD_TILES` is data, the component ends in
`tiles.map((tile) => <DashboardTile … />)`, and no tile key appears in its logic (now asserted).

But the callbacks module did **not** register a tile. It added a bespoke card to the dashboard
component with its own feature check and its own inline role list — exactly what the criterion
forbids. The cost was not stylistic:

```tsx
const available = await effectiveFeatures(entitlement.features, context.tenantId);  // kill-switch aware
…
hasFeature(entitlement, "callback_calendar")   // ← the RAW plan
```

Tiles were gated on `available`; the callbacks card on the **raw entitlement**. Kill switches are
*"consulted BEFORE the entitlement at every enforcement point"* (SA-4.10), and `effectiveFeatures` is
what applies them. So switching `callback_calendar` off platform-wide removed the callbacks **tile**
and left the **card** rendering — and still querying due callbacks. A kill switch that half a screen
ignores is not a kill switch.

The card's render condition had a second divergence: it checked only the feature, **not** the role,
while the tile beside it required `owner`/`producer`/`assistant`. A bookkeeper or setter therefore
saw *"Callbacks due today — No callbacks are due today"*, which is false; they are not permitted any.

Both fixed. `lib/dashboard/tiles.test.mjs` now fails if the dashboard reads a feature off the raw
entitlement again, or if a tile key appears in the component. Verified by reintroducing the
`hasFeature(entitlement, …)` call.

**Observation, not fixed:** the card and the `work.callbacks` tile are now gated identically and
point at the same screen, so callbacks appears **twice** on the dashboard — once as a live card, once
as a static shortcut. That is redundancy rather than a defect, and removing a visible shortcut is a
product decision, so it is recorded rather than acted on.

### Criterion 5 needed a real change, not a re-measurement

First measurement: **1.02–1.48s** across five warm dev requests — over the threshold. The data layer
was 339ms of that, and it was **serial**:

```
entitlement + onboarding   ~170ms   (parallel pair)
kill switches              ~170ms   (awaited afterwards)
```

The kill-switch *query* depends on neither the feature list nor the tenant — only `applyKillSwitches`
does — so it never needed to wait. `loadFeatureSwitches()` now exposes the read, the dashboard fetches
it alongside the entitlement and applies the switches afterwards. Identical behaviour, one fewer
round trip, and **nothing is cached**, which is the property the module's own warning protects.

After: **0.87, 0.95, 0.98, 0.98, 0.99s** — every run under a second in **development**, the
pessimistic case, since a production build carries no Turbopack overhead.

---

## LA-0.4 · Carrier, product & commission schedule library — **Pass** (5 of 5, one vacuously)

**Goal:** the agent says once which carriers they are contracted with and at what level, and every
commission figure is computed from that.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Adding a carrier requires no deploy — it comes from the platform library | **Pass** | `SCRIPT` — *"platform carrier can be added without a deploy"*, *"agent reads platform carriers and products from one library"* |
| 2 | A commission figure anywhere traces back to this table, **never a hardcoded percentage** | **Vacuously true today — now guarded** | See below |
| 3 | Changing a contract level does **not** retroactively rewrite recorded commissions — effective-dated | **Pass** | `SCRIPT` — *"changing the level creates a new effective-dated contract"*; `TEST` — resolution at `asOf` 2026-06-30 returns the old rate, at 2026-08-01 the new one |
| 4 | Two agents on different levels with the same policy get different, correct figures | **Pass** | `TEST` — 6000¢ premium at 10000bp → 6000¢, at 11500bp → 6900¢ |
| 5 | All rates as integers in basis points, all money as integer cents | **Pass** | `SCRIPT` — *"commission schedule saves in integer basis points"*, *"advance rule saves with integer percentages and months"*; `SRC` — `commissionCentsFromSchedule` throws on a non-integer or out-of-range `rate_bp` |

The resolver's best property is one the ticket never asks for: **it refuses to invent a rate.**
`resolveCommissionRate` returns `null` rather than a default when no schedule matches, and that is
asserted. A default here would be a wrong commission figure that looks exactly like a right one.

### Criterion 2 is true because nothing exercises it

Checked across the codebase on 2026-09-22:

- `commissionCentsFromSchedule` — **no callers**
- `resolveCommissionRate` — re-exported from `service.ts`, **no consumers**
- `policies` stores `annual_premium_cents` and **no commission column**
- no commission-entries or ledger-entries table exists

So there is no commission figure anywhere to trace, and no hardcoded percentage either. The library
was built first deliberately — the ticket argues that building it after the features that read it
means retrofitting *"the most load-bearing table in the product"* — and that judgement looks right.

But a criterion that passes because nothing exercises it is worth nothing later. The ledger is where
the first commission figure will surface, so `lib/carriers/resolve.test.mjs` now fails if that route
starts returning rows without deriving them from the schedule. Verified by mutation.

**This is the second LA-0 criterion of exactly this shape** — LA-0.2's producer-scoping rule is the
other — and both now have a guard at the same choke point. Together they mean the first real ledger
query must scope by producer **and** derive from the schedule, or the suite fails and names the
criterion.

---

## Not mine: a dark-mode regression from a concurrent session

`npm test` reports **673 tests, 672 passing, 1 failing**. The failure is
`lib/design/contract.test.mjs` → *"dark mode covers both portal roots"*, naming:

```
app/partner/accept-invite/page.tsx
components/partner/partner-login-form.tsx
components/partner/partner-set-password-form.tsx
```

`app/globals.css` is **staged-modified by another session** working in this tree — many unrelated
admin pages changed in the same window — and their in-progress version no longer carries the
`.dark :is(… portal-partner …)` selector. The consequence is the exact one the test was written for:
a partner with dark mode on gets a white sign-in page and a dark workspace after it.

Left untouched, because editing `globals.css` would collide with their staged work. None of the three
named files, and none of the files this audit changed, are involved.

---

## LA-0.5 · Appointment & contract-level vault — **Pass** (6 of 6)

**Goal:** the system knows exactly which carriers the agent may sell for, in which states, from which
date — and refuses to let them write business they are not appointed for.

The stake is in the ticket: *"Selling without one is illegal and the commission is forfeit."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | `canWrite()` false for a carrier/state pair with no appointment, and for a future effective date | **Pass** | `SCRIPT` *"missing and future appointments are refused"*; `TEST` — NM appointed from 2027 refuses at 2026 and allows at 2027-06-01 |
| 2 | The grid can capture 40 appointments in under two minutes | **Pass** | `SCRIPT` *"one bulk request captures forty appointments"*, *"repeated and concurrent bulk saves are idempotent"*; `BROWSER` — see below |
| 3 | An expired licence or E&O makes `canWrite()` false for every state it covers | **Pass** | `SCRIPT` *"expired licence or E&O refuses writing"*; `TEST` — an expired **licence** kills only its own state, an expired **E&O** kills everywhere at once |
| 4 | Expiry warnings fire at 90, 60 and 30 days **and stop once renewed** | **Pass, both halves** | `SCRIPT` *"expiry warnings are emitted at the configured 90/60/30-day thresholds"*; `TEST` — *"renewing a record stops the old warning"* |
| 5 | Appointments are effective-dated — a policy written last year stays valid when an appointment is later terminated | **Pass** | `SCRIPT` *"historical eligibility remains true before termination and false after it"*, *"an appointment can be terminated without deleting its history"*; `TEST` — true at 2026-01-01, false on and after the 2026-06-01 termination |
| 6 | No module contains its own copy of the eligibility logic | **Pass** | `TEST` — `lib/appointments/singleSource.test.mjs`, see below |

### Criterion 6 is the second negative claim in LA-0 proved properly

Notion: *"A single read-only helper `canWrite(carrier, state, date)` that later modules call — do not
scatter this logic."* Scattered eligibility is how an agent is blocked on one screen and allowed on
another.

`singleSource.test.mjs` walks every `.ts`/`.tsx` under `lib`, `app` and `components` looking for the
tell-tale of a second implementation — a file that *decides* from `terminated_at` rather than merely
displaying it — and excludes only the two owning files. Reading a termination date is fine; branching
on it is not.

It also handles a trap worth naming. **Three unrelated things in this repo are called `canWrite`:**
appointment eligibility, whether the *subscription* may write at all, and component-local role gates.
The test pins the appointment one and separately asserts that `lib/entitlements/types.ts` has not
absorbed it — including that the entitlement module never mentions a carrier. That is a guard against
a name collision quietly becoming a real bug.

### Criterion 2 is a UI claim, so it was checked in the UI

The suite proves the *write path* takes forty appointments in one idempotent request. The criterion
is about a human at a grid, so `/app/settings#states-licences` was driven as an owner. It is what the
ticket asks for and not forty forms: carriers as row headers, **51 state columns**, a checkbox per
cell, a "Find a state" filter, an "Effective from" date applied to the batch, **"Select visible
states"**, and "Clear". Each checkbox carries an `sr-only` label naming the carrier and the state in
full, so the grid is navigable without sight of the column header.

Below the `sm` breakpoint the table is swapped for a two-column checkbox list rather than being left
to scroll — the responsive case is handled deliberately rather than by accident.

---

## LA-0.6 · Contact & household model with dedupe — **Pass** (7 of 7)

**Goal:** one person is one record, no matter how many publishers sell them to us or how many phone
numbers they have.

The ticket's reasoning is the design: *"Matching on phone number alone catches roughly half of
them."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | The same person with two phone numbers and a misspelled surname is detected as a probable duplicate | **Pass** | `SCRIPT` — *"misspelled surname and second phone are detected"* |
| 2 | A husband and wife at one address are two contacts in one household — not merged into one person | **Pass** | `SCRIPT` — *"husband and wife remain separate"* |
| 3 | Auto-merge only fires above the confidence threshold; everything else goes to the agent | **Pass** | `SCRIPT` — *"medium matches wait for agent confirmation"* |
| 4 | A merge can be undone and both original records return intact | **Pass** | `SCRIPT` — *"merge retains source records"*, *"undo restores both originals"*, and *"concurrent undo permits one reversal"* |
| 5 | Duplicate detection over 20,000 contacts returns in under 500ms | **Pass** | `SCRIPT` — *"20,000-contact duplicate search is under 500ms"* |
| 6 | Custom fields survive a CSV import round-trip | **Pass** | `SCRIPT` — *"custom fields survive CSV round-trip"*, plus *"undefined custom field is rejected"* |
| 7 | No cross-tenant match is ever possible, verified by test | **Pass** | `SCRIPT` — *"cross-tenant matching is impossible"*, *"missing tenant membership fails closed"* |

Two properties beyond the criteria are worth recording because they are the ones that usually go
wrong. **Merge is a link, not a deletion** — *"merge retains source records"* is asserted directly,
which is what makes criterion 4 possible at all rather than best-effort. And the **concurrency** case
is tested on both sides: a repeated merge request is refused, and two simultaneous undos permit
exactly one reversal. Criterion 5's 500ms budget exists because *"this runs while a live transfer is
ringing"*, and it is measured against 20,000 real rows rather than asserted.

---

## A dashboard that told an agent their setup was empty while it was full

Found while checking LA-0.5 criterion 2 in the browser, and it belongs to **LA-0.3 criterion 4**.

The appointments grid for the demo tenant was full — carriers down the side, ticks across. The
dashboard two clicks away said:

> ❌ *"No carriers have been added yet. Start with the carriers you are appointed with."*
> ❌ *"No appointments are recorded yet. Confirm your carrier appointments next."*

Measured for that tenant:

```
tenant_carriers    5 rows
appointments      38 rows
licenses           5 rows
```

Both sentences were false. The cause: the tile field was named `empty_state`, and `DashboardTile`
renders it **unconditionally** — there is no count behind it, and never was. Nine of the eleven
entries were already written as standing hints (*"Claiming is atomic…"*, *"Rules are evaluated top to
bottom…"*). Only the two setup tiles took the field name at its word and asserted emptiness as fact.

LA-0.3's own in-scope line asks for the opposite: *"Empty states that say what to do next rather than
'no data'."* The copy led with "no data".

**Fixed by renaming the field to `hint` and rewriting those two sentences**, not by making it
conditional. A real empty state needs a count per tile, and LA-0.3 gives this page a one-second
budget that a fan-out of count queries would spend — the same budget that needed work earlier today.
A sentence that is true whether or not the screen has rows costs nothing and cannot lie.

`lib/dashboard/tiles.test.mjs` now fails on any hint asserting emptiness (`no … yet`, `nothing here`,
`is empty`, `haven't … any`, `none yet`). Verified by restoring the old string: the guard names the
offending tile and quotes it back. Confirmed in the browser — the dashboard now reads *"Start with
the carriers you are appointed with, and record your contract level for each."*

---

## Still not mine: the concurrent session, now in two places

`npm test` — **674 tests, 672 passing, 2 failing**, both in `lib/design/contract.test.mjs`:

- *"dark mode covers both portal roots"* — three **partner auth** files, caused by the
  `.dark :is(… portal-partner …)` selector missing from the in-progress `app/globals.css`.
- *"no button is rendered without a handler, a form, or an explanation"* — a dozen controls in
  `components/design/primitives-showcase.tsx`, a file that is **untracked** and did not exist earlier
  in this audit.

Both belong to another session doing design-system work in this tree. Neither is reachable from any
file this audit changed.

**One collision to report.** That session **rewrote `components/app/dashboard-tile.tsx` mid-audit** —
it is now a `<Link>`-based tile with a chevron and an `aria-label`, where an hour earlier it was a
`Card`. Their rewrite reintroduced `tile.empty_state`, which broke `typecheck` against the renamed
field. Resolved by changing that one token to `tile.hint` and leaving the rest of their markup
untouched. Anyone driving that session should know the field is now `hint`, and why.

---

# LA-1 · Partner acquisition

## LA-1.1 · Partner records & lifecycle — **Pass** (6 of 6, one test strengthened)

**Goal:** Ray can add a lead partner, decide what they are allowed to do, pause them, and eventually
close them down — **without anything being deleted**.

The ticket is unusually direct about why it exists: the legacy system has `call_centers` with 83 rows
and *"no pause or offboard flow at all — centres are created and then live forever. Build the ending,
not just the beginning."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Pausing blocks new submissions within seconds and leaves existing leads workable | **Pass** | `SCRIPT` — *"a paused partner cannot submit a new lead"* (in `verify:dynamic-forms`, not the lifecycle suite); `TEST` — the gate-placement rule, see below |
| 2 | Offboarding revokes every one of that partner's user logins in one action | **Pass** | `SCRIPT` — *"offboarding revokes every partner portal membership"*, and from the other suite *"offboarding revokes every partner user atomically"* with `status='revoked'` plus both timestamps on every row |
| 3 | No partner action ever deletes a lead, a deal-flow row or a message | **Pass — after fixing the test that claimed it** | `SCRIPT` + `TEST` — see below |
| 4 | Changing a payout rate is effective-dated and does not alter past leads | **Pass** | `SCRIPT` — *"commercial terms save in integer cents and are effective-dated"*, *"a new rate appends history instead of rewriting the old rate"*, *"same effective date cannot be silently duplicated"* |
| 5 | Creating a partner is blocked when the plan's partner limit is reached | **Pass** | `SCRIPT` — *"an active partner occupies a plan-limit slot"*, *"plan partner limit rejects another create"*, and the race: *"concurrent creates respect the cached partner limit atomically"* |
| 6 | Every lifecycle change is audit-logged with who and why | **Pass** | `SCRIPT` — *"successful partner writes have audit rows with lifecycle reason"* |

### Criterion 1 is proved, though not where you would look for it

**Corrected 2026-09-22, while auditing LA-1.3/1.4.** This section first said the
blocks-new-submissions half was unproven, on the grounds that `verify-partners.mjs` asserts only
*"pausing is an atomic lifecycle transition"* and `verify-partner-submission.mjs` never mentions
`paused`. Both of those are true, and the conclusion was wrong: **`verify-dynamic-forms.mjs` asserts
it** — *"a paused partner cannot submit a new lead"*, with a lead-count check either side. I had not
read that suite when writing this entry.

So the criterion is covered end to end. What remains true is that the proof lives two suites away
from the task that owns it, which is why it was missed.

The implementation is right, and better than the lifecycle test alone suggests:

- `requirePartner` **re-reads `partners.status` from the database on every request**, so "within
  seconds" is really "on the next request";
- an `offboarded` partner is rejected at the session, before any route runs;
- `app/api/partner/leads/route.ts` answers *"This partner is paused and cannot submit new leads."*

And the split is deliberate. Of the eight writing partner routes, exactly the **three on the
submission path** consult `partnerStatus` — lead POST, form draft, form screen. Chat, notifications
and partner-admin user management do not, which is correct: pausing *"stops accepting new
submissions… existing leads still workable"*, so a paused partner can still discuss a lead in flight
and manage their own people. Offboarding is the hard stop, and it is enforced at the session.

That split is now asserted in three directions — a new writing route must be classified, a
submission route must consult the status, and a deliberately-open route must **not** start consulting
it. Getting "existing leads still workable" wrong by over-gating would fail too.

### Criterion 3's test could not fail

```js
check("offboarding preserves lead history", !retained.error && (retained.data?.length ?? 0) <= 1);
```

`<= 1` is **true when the count is zero**. A test named *"offboarding preserves lead history"* passed
whether the lead survived or was deleted by the very action under test. It also could not distinguish
a surviving lead from one that was never created: the seed insert is conditional on finding an active
`term_life` template, and a miss left nothing to preserve while the check still went green.

Fixed by asserting the setup before the property — a new check, *"a lead exists to survive
offboarding"*, and `=== 1` in place of `<= 1`. Both pass on the live project, so the lead genuinely
does survive offboarding; the guarantee is real, only the proof was hollow.

The criterion is now doubly covered, because the partner plane also **issues no database DELETE at
all** — asserted separately, with `response.cookies.delete()` discounted as a cookie rather than a
row.

---

## LA-1.2 · Partner users & portal access — **Pass** (5 of 5, two criteria made exhaustive)

**Goal:** a closer at a call centre logs in, sees only their partner's world, and submits leads. The
partner admin manages their own people without asking Ray.

This is the task tagged **Security**, and the ticket says why in a box marked *read this twice*:

> *"In the current system, 224 of 280 user accounts are external call-centre staff, and the pipeline
> configuration tables are readable — and deletable — by any authenticated user. Any closer at any
> centre can delete a pipeline stage. This is the worst finding in the code review."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A partner user calling any route outside their partner gets 403 — **across every route** | **Pass — now actually across every route** | `TEST` — see below; the script sampled three |
| 2 | A partner admin cannot invite a user into a different partner, even by editing the request | **Pass** | `SCRIPT` — *"partner admin cannot redirect an invite by editing the request"*; `TEST` — generalised to every route |
| 3 | Deactivation logs the user out on their **next request**, not at session expiry | **Pass** | `SCRIPT` — *"deactivation kills the existing session on the next request"*, and *"offboarded partner session is rejected"* |
| 4 | No partner user can read or write pipeline, product, form or commission configuration | **Pass — now asserted at the table level** | `TEST` — see below |
| 5 | Offboarding a partner deactivates every one of its users atomically | **Pass** | `SCRIPT` — *"offboarding revokes every partner user atomically"*, all rows `revoked` with both timestamps |

### Criteria 1 and 4 said "every route" and were proved against three

```js
check("partner API exposes no configuration or commission route",
  (await api("/api/app/ledger", adminCookie)).status === 401 &&
  (await api("/api/app/carrier-library", adminCookie)).status === 401 &&
  (await api("/api/app/partners", adminCookie)).status === 401);
```

A real check, and not what the criterion says. Three sampled URLs stop being true the moment somebody
adds the fourth — and for the one task whose own ticket calls the gap *"the worst finding in the code
review"*, a sample is the wrong instrument.

`lib/partnerAuth/planeIsolation.test.mjs` is the exhaustive half, in the style of
`moneyRoutes.test.mjs`:

- **all 120 agent-plane routes** must resolve the caller from the tenant session, with six pre-auth
  routes (login, logout, set-password, confirm-email, signup, checkout coupon) allowlisted by name.
  A partner cookie cannot satisfy a tenant guard, so this is criterion 1 as a property of the tree
  rather than of three URLs — and it doubles as an anonymous-access check. It fails in the other
  direction too: a stale allowlist entry naming a renamed route is how an exemption becomes
  permanent.
- **all 21 partner-plane routes** must go through `requirePartner`, with the four partner auth routes
  allowlisted.
- **no configuration or commission table is named anywhere in the partner plane** — fourteen tables
  including `pipelines`, `pipeline_stages`, `dispositions`, `commission_schedules` and `policies`.
  This is the direct answer to the legacy finding, and it is stronger than guarding those surfaces:
  there is nothing there to guard.

**Verified by mutation:** pointing a partner route at `pipeline_stages` fails the table assertion;
removing a partner-id mismatch check fails the scope assertion.

### What the app does better than my first test assumed

Two of my initial assertions failed, and **both were my test being wrong rather than the app**. Worth
recording, because both corrections are findings in their own right.

**Three routes do read `?partner_id=`** — chat, lead export, lead pipeline. I had flagged that as a
missing wall. They read it *only to refuse a mismatch* against `auth.context.partnerId`; the query
always uses the session value. That is better than ignoring the parameter, because a client trying to
scope to another partner gets an explicit 403 instead of quietly receiving its own data. The rule is
not "never read it", it is "never trust it", and the test now says so.

**Five routes I had barred are legitimate.** I forbade any partner route named `products`, `forms` or
`settings`; that failed on the partner's approved-product list (LA-1.3 requires them to know it), the
submission form they render (LA-1.6), and their own profile. The criterion's operative word is
**configuration** — reading the products you are approved to submit is not configuring products. The
test now asserts at the table level instead, which is what the criterion actually protects.

---

## Still not mine: the concurrent session, now in four places

`npm test` — **681 tests, 678 passing, 3 failing**, all in `lib/design/contract.test.mjs`, plus one
lint warning. None is reachable from any file this audit touched:

| Failure | Cause | Owner |
|---|---|---|
| *"dark mode covers both portal roots"* | `.dark :is(… portal-partner …)` missing from the in-progress `app/globals.css` | other session |
| *"no button is rendered without a handler…"* | a dozen controls in `components/design/primitives-showcase.tsx` (untracked, created 01:57) | other session |
| *"no component is orphaned"* | `components/ui/settings-layout.tsx` (untracked, created **08:19 — during this turn**) | other session |
| lint: `'ShieldCheck' is defined but never used` | `components/app/lead-detail-workspace.tsx` | other session |

The design-system work in this tree is live and moving. The dark-mode one is a real user-visible
regression — a partner with dark mode on gets a white sign-in page and a dark workspace after it —
and is worth raising with whoever is driving it.

---

## LA-1.3 · Product configuration & per-partner approval — **Pass** (5 of 5)

**Goal:** Ray decides which products he sells. For each partner he decides which of those they may
submit. A partner approved for Final Expense cannot submit a Term Life lead.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A partner submitting an unapproved product is rejected server-side with a clear reason, and nothing is written | **Pass** | `SCRIPT` — *"an unapproved product is rejected before a lead write"*; the assertion is on the write, not just the status code |
| 2 | Disabling a product hides it from every partner's form immediately | **Pass** | `SCRIPT` — *"disabling a product hides it from the partner picker immediately"*, and *"partner product picker returns only approved enabled products"* |
| 3 | Leads already submitted under a disabled product still open, display and work correctly | **Pass** | `SCRIPT` — *"a previously submitted lead remains readable after its product is disabled"*, plus *"disabling keeps the approval row for later re-enable"* |
| 4 | `product_line` is present and correct on the lead, the queue item **and** the deal-flow row — asserted by test | **Pass** | `SCRIPT` — see below |
| 5 | Adding a product requires no deploy | **Pass** | `SCRIPT` — *"owner can approve an enabled product for a partner"*, *"a second tenant sees the global product only as its own disabled setting"*; products come from the SA-4.5 catalog |

### Criterion 4 is asserted exactly as the ticket demands, against the exact legacy bug

The ticket carries the failure forward as a rule rather than a bug fix:

> *"In the current system the deal-flow row defaulted to Final Expense, so every Term Life submission
> produced a deal-flow row labelled FE while its lead row said TL — and the product filters read the
> deal-flow column."*

`verify-dynamic-forms.mjs` submits a **Term Life** form and then asserts `product_line === "term_life"`
on all three rows — the lead, the queue item, and the deal-flow row — in one check. That is the
precise shape of the old defect: a default would show up as `final_expense` on the third row while the
first two were right. Choosing Term Life rather than Final Expense for the fixture is what makes the
test able to fail.

The join-table modelling the ticket asks for is in place too (`tenant_products`, `partner_products`),
replacing the legacy `can_sell_fe` / `can_sell_tl` boolean pair — *"fine for two products and wrong
for five"*. Disabling preserves the approval row, which is what makes criterion 3 possible.

---

## LA-1.4 · Dynamic lead fields & application form builder — **Pass** (6 of 6, the sixth repaired)

**Goal:** Ray configures, per product, the fields a lead carries and the form a partner fills — with
no deploy.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Adding a field requires no deploy and appears on the partner's form immediately | **Pass** | `SCRIPT` — *"adding fields and a conditional form rule needs no deploy"*, then *"new field appears immediately in the partner form"* |
| 2 | Editing a live form does not change a draft already in progress | **Pass** | `SCRIPT` — *"editing the live form does not rewrite an in-flight draft"*; drafts carry their definition version |
| 3 | A closer who loses their connection mid-form returns to everything they had typed | **Pass** | `SCRIPT` — *"a resumed draft returns every value that was typed"*, *"repeated and concurrent draft saves remain one draft"* |
| 4 | Conditional fields hide and show without a reload, and **hidden fields are not submitted** | **Pass** | `SCRIPT` — *"hidden conditional fields are rejected server-side"*, which is the half that matters: the client hiding a field is a convenience, the server refusing it is the rule |
| 5 | Custom fields survive a CSV export round-trip | **Pass** | `SCRIPT` — *"custom fields survive CSV round-trip"* (LA-0.6 suite, same JSONB-plus-schema storage) |
| 6 | The preview matches the partner's view exactly | **Pass — after repair; see the caveat** | `SRC` + `BROWSER` + `TEST` — see below |

### Criterion 6: the preview drew every field as a text box and said otherwise

The agent-side form studio renders a *Partner preview* panel. It rendered **every** field as a
disabled text `<Input>`, whatever the field's type — while the panel's own caption read:

> ❌ *"The Partner Portal will show exactly these fields."*

The portal does nothing of the sort. `PartnerField` in `partner-portal-workspace.tsx` branches on
`field.type` and renders a select for `boolean`, `single_select` and `multi_select`, a textarea for
`long_text`, and typed inputs with `inputMode` and formatting for `number`, `currency`, `date`,
`phone`, `email` and `ssn`.

So a single-select, a date and a phone number all looked identical in the preview — and the preview
is precisely where Ray would check that he picked the right field type. This is the same shape as the
SA-audit finding about a preview headed more broadly than it rendered.

**Repaired.** The preview now renders one disabled control per field type, and the caption states
what it can actually guarantee: *"The Partner Portal shows these fields, in this order, with these
controls."* Confirmed in the browser against the Term Life form on the demo publisher — 14 controls,
of which:

```
Date of birth   → <input type="date">
State           → <select>
Tobacco use     → <select>
Boolean test    → <select>
Coverage amount → placeholder "$0.00"
Email           → placeholder "name@example.com"
Phone           → placeholder "(555) 123-4567"
```

Every one of those was a plain text box carrying its own label as the placeholder an hour earlier.

**The caveat, stated plainly.** This is now a faithful mirror, not literally the same component, so
"exactly" rests on two lists staying in step. The durable fix is to extract `PartnerField` — already
a clean presentational function of `{ field, value, error, onChange }` — into a module both sides
import. **I did not do that**, because `partner-portal-workspace.tsx` (1,488 lines) was being edited
by another session in this tree at the time; a refactor there would have collided.

Until that extraction, `lib/templates/previewParity.test.mjs` holds the line with three assertions:

- the preview's declared type list must equal `TEMPLATE_FIELD_TYPES` exactly, so a new field type
  cannot be added to the product without the preview being updated — **verified by mutation**,
  removing `multi_select` fails it;
- the caption may not re-assert exactness while the two sides render separately — **verified by
  mutation**, restoring the old sentence fails it;
- the portal must still render those four types distinctly, which is the assumption the first
  assertion depends on.

---

## Suite state

`npm test` — **684 tests, 681 passing, 3 failing**. The three are the concurrent session's design-system
work, unchanged from the previous entry and unreachable from anything this audit touched: the missing
`portal-partner` dark-mode selector, the handler-less controls in `components/design/primitives-showcase.tsx`,
and the orphaned `components/ui/settings-layout.tsx`. One lint warning, also theirs
(`ShieldCheck` unused in `components/app/lead-detail-workspace.tsx`).

---

## LA-1.5 · TCPA & DNC screening service — **Pass** (5 of 6, the sixth unprovable in this environment)

**Goal:** before a partner can submit a lead, the phone number is screened. A TCPA litigator hit
stops the submission. Everything else is recorded and shown.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A TCPA hit makes submit fail **server-side**, and nothing is written | **Pass** | `SCRIPT` — *"TCPA-blocked number is stopped before the form gate"*; the assertion is on the write |
| 2 | A DNC hit submits, and the warning is stored on the lead and visible to the agent | **Pass** | `SCRIPT` — *"DNC screening returns a visible warning that can be acknowledged"*, then *"DNC warning blocks unacknowledged submit, then records acknowledgement on the lead"* |
| 3 | The same number screened twice within the TTL costs one vendor call and one credit | **Implemented; the proof cannot run here** | `SRC` + see below |
| 4 | Simulating a primary vendor failure routes to the secondary and logs the fallback | **Pass** | `TEST` — *"primary failure routes the compliance call to the secondary and records one fallback"*, and *"when every compliance vendor fails, the last error is returned after each fallback"*; `SCRIPT` — *"ordered fallback behavior is covered by deterministic service tests"* |
| 5 | **No compliance decision anywhere in the codebase** is made by matching vendor prose | **Pass — now proved codebase-wide** | `TEST` — see below |
| 6 | Every check appears in the audit record with its raw response | **Pass** | `SRC` — `writeAudit` carries `raw_response` on every path, **including cache hits** |

### Criterion 5 is the one this task is really about, and it is now held down by name

The ticket describes what it is deleting with unusual precision — six overlapping detectors, JSON
walked twelve levels deep, roughly 200 lines existing solely to compensate for an untyped vendor
response — and then names the four functions that must never come back:
`messageIndicatesTcpa`, `deepScanTcpaLitigator`, `deepScanDncPhoneLists`, `collectPayloadRecordChain`.

What replaced them is 24 lines. `parseTypedScreeningResponse` reads named **boolean** fields at the
root or one `data` envelope, and throws on anything else — no prose, no nested record chain, no
truthy string. `screening-contract.test.mjs` proves that module interprets typed answers and fails
closed on a prose-only one.

That is the positive half, and no single module can prove the criterion's *"anywhere in the
codebase"*. `lib/compliance/noProseDecisions.test.mjs` is the other half:

- **none of the four named functions exists** anywhere in `lib`, `app` or `components`;
- **no compliance module reaches a decision from a prose string.** The discriminator is the space: a
  compliance decision keys on an enum (`"tcpa_litigator"`, `"dnc_scrub"`) and those never contain
  one; a sentence does. `error.message` is exempt, because those are our own thrown strings being
  categorised for logging rather than a vendor's answer.

**Verified by mutation, and the first version was not good enough.** Adding
`String(payload).includes("is a known litigator")` to the contract **passed** — the receiver pattern
only matched bare identifiers, and a call expression is exactly how someone would reach for the whole
vendor body. Widened to match the call and inspect what precedes it; the same mutation now fails.

### A fragility the criterion leaves behind, now pinned

`screening.ts` and `service.ts` categorise a screening failure by matching the **text of an Error
thrown in another module** — `"typed screening decision"` comes from `screening-contract.ts`,
`"invalid response"` from `scrub.ts`. This is not a criterion-5 violation: our own string, and the
decision it feeds is a health label, not a compliance outcome. But reword a throw and the branch dies
silently while every test still passes.

All four phrases had a live thrower on 2026-09-22. A third assertion keeps it that way — **verified by
mutation**, rewording the contract's throw to *"Vendor response lacked a boolean verdict"* orphans the
matcher and fails.

### Criterion 3 needs a server this environment does not have

`scripts/verify-screening.mjs` contains exactly the right assertion —

> *"same number and submission within TTL replays without another vendor call or credit"*

— checking both that the credit count is unchanged and that one result row exists. It **refuses to
run**:

```
PRECONDITION NOT MET — this suite cannot prove fail-closed screening while DEMO_SCREENING_MODE is on.
  PORT=3110 DEMO_SCREENING_MODE=false npm start
  APP_BASE_URL=http://localhost:3110 npm run verify:screening
```

That refusal is correct behaviour and worth crediting: the suite declines to report a pass it cannot
earn, which is the opposite of the defects this audit keeps finding.

Running it needs a second server with the flag off. `npm start` needs a build, and a build clobbers
the `.next` directory another session's dev server is using in this tree, so it was not attempted.
**Same blocker as SA-4.8 criterion 1.**

What demo mode does and does not weaken is worth stating, because it bounds what the other criteria
prove. It substitutes **the vendor adapter only**: a typed `{ hit }` / `{ listed }` response keyed off
reserved `555…0001` and `555…0101` numbers, fed through the same `parseTypedScreeningResponse`. It is
opt-in and local-only, and its own comment says it exists so QA gets a deterministic contract
"without turning an unconfigured production environment into an allow path". So the contract,
precedence and gating in criteria 1 and 2 are genuinely exercised; what is untested here is the live
HTTP path and the credit accounting.

---

## LA-1.6 · Partner submission form (the portal screen) — **Pass** (6 of 6)

**Goal:** a closer with a customer on hold can screen the number, fill the form and submit — without
losing anything if the connection drops.

The ticket explains why it is separate from LA-1.4 in one line worth keeping: *"LA-1.4 is the builder
Ray uses. This is the screen the closer uses. They fail differently: the builder fails by producing an
unusable form, this fails by losing work while a customer waits."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A closer who closes the tab mid-form returns to every field they had typed | **Pass** | `SCRIPT` — *"draft saves and returns every typed value with its definition version"*, and *"a resumed draft returns every value that was typed"* |
| 2 | A TCPA-blocked number cannot reach the form at all | **Pass** | `SCRIPT` — *"TCPA-blocked number is stopped before the form gate"*; the gate, not the submit |
| 3 | A DNC warning is visible, acknowledged, and recorded on the resulting lead | **Pass** | `SCRIPT` — all three parts asserted separately |
| 4 | Submitting twice in quick succession creates one lead, not two | **Pass** | `SCRIPT` — *"two quick submissions create one lead"*, and *"submitting the same draft twice creates one lead"* from the other suite |
| 5 | Duplicate override requires a justification and stores it | **Pass** | `SCRIPT` — *"duplicate override requires justification and stores it"* |
| 6 | **No field on this screen is defined in code** — all of it comes from the form definition | **Pass** | `SRC` + `SCRIPT` — see below |

### Criterion 6 holds, and the source shows why

Every match for a lead-field name in `partner-portal-workspace.tsx` is on `field.type`, not on a field
**key**: the component branches on the type system to pick a control and a validator, and takes the
fields themselves from `template.fields` and `section.fields`. There is no `first_name`, no
`date_of_birth`, no `ssn` key literal anywhere in the screen.

The operational proof is LA-1.4's, and it is the stronger one: *"adding fields and a conditional form
rule needs no deploy"* followed by *"new field appears immediately in the partner form"*. A screen
with a hardcoded field list could not pass that pair.

Product, Carrier and State are chosen before the form opens — they are what selects **which**
definition to render, not fields of the lead — so they are chrome rather than a violation. The flow in
the ticket agrees: screening and product selection happen at steps ①–③, and *"the form opens"* at ④.

---

## Suite state

`npm test` — **687 tests, 684 passing, 3 failing**. The three remain the concurrent session's
design-system work, unchanged and unreachable from anything this audit touched.

---

## LA-1.7 · Intake write pipeline — **Pass** (5 of 5, one proof made deterministic)

**Goal:** one submission produces four things, in a defined order, with defined failure behaviour for
each.

This is the best-specified task in LA-1, because it carries the original defect forward verbatim:

> *"In the current system, if step ③ fails, **the lead is submitted successfully, never reaches an
> agent, and nothing says so.** […] A paid live transfer disappears."*
> *"Swallowing must never mean silence."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A forced failure at step ③ still returns success to the closer **and** produces a failure record and an alert | **Pass** | `SCRIPT` — *"real intake request survives a forced work-item failure with durable failure and alert"*; all three halves in one check |
| 2 | No lead can exist without either a work item or a logged failure — verified by the reconciliation job | **Pass** | `SCRIPT` — *"reconciliation reports a lead with no work item or logged failure"*, then *"a durable failure record creates an open alert and satisfies reconciliation"*, then *"the missing work item can be repaired without a second lead"* |
| 3 | Submitting the same draft twice produces one lead | **Pass** | `SCRIPT` — *"resubmitting the same draft updates one lead and repairs without duplicating artifacts"* |
| 4 | `product_line` matches across lead, work item and deal-flow row — asserted by test | **Pass** | `SCRIPT` — the same three-row assertion recorded under LA-1.3 C4, on a **Term Life** fixture so a Final Expense default would fail it |
| 5 | The deal-flow date is correct for an agent working late in their own timezone | **Pass — proof strengthened** | `SCRIPT` + `TEST` — see below |

Criterion 2 is covered in the round rather than at a point, which is what makes it convincing: the
reconciliation job is shown **finding** an orphaned lead, then shown **accepting** one whose failure
was logged, then the repair is shown not to mint a second lead. A job that only ever reported zero
would pass a weaker reading of the criterion.

### Criterion 5 was proved by a test that only worked part of the day

`verify-intake-pipeline.mjs` creates its partner in `Pacific/Honolulu` — deliberately far from UTC —
and compares the stored `local_date` against a date it computes for that zone. That is a genuine
check, and it can only **discriminate while Honolulu and UTC are on different dates**: 00:00–10:00
UTC. For the other fourteen hours the two agree, and a plain UTC implementation would have passed it
unnoticed.

The 2026-09-22 run landed at **08:28 UTC** — UTC date `2026-09-22`, Honolulu date `2026-09-21` — so it
did discriminate. That is luck, not coverage.

The computation was inline in `writePartnerIntakeArtifacts`, so nothing could test it at a fixed
instant. It is now `intakeLocalDate(timeZone, at)` in `lib/dealFlow/localDate.ts` — a pure function,
no `server-only`, called from the same place — with five deterministic tests:

- 22:30 in Honolulu on the 21st stores **2026-09-21** while UTC has already rolled to the 22nd, and
  the test asserts the UTC date really has rolled over, so it cannot pass vacuously;
- the mirror case, 08:00 in Sydney on the 22nd while UTC is still the 21st;
- zero-padded `YYYY-MM-DD`, which is what the `date` column takes;
- both sides of the 2026-11-01 US daylight-saving boundary, and 22:30 on the 1st filed as the 1st;
- every partner timezone in use resolves rather than throwing — a bad zone string makes `Intl` throw,
  and that would fail the intake write rather than the deal-flow row, which is precisely the fatal
  write LA-1.7 says a best-effort step must never endanger.

**Verified by mutation:** hard-coding `timeZone: "UTC"` fails 3 of the 5, at any hour. Both live
suites still pass after the extraction.

---

## LA-1.8 · Affiliate tracked links & lightweight intake — **Pass** (5 of 5)

**Goal:** an affiliate gets a link; anyone arriving through it is attributed to them, and the lead
flows through exactly the same machinery as a call-centre transfer.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A lead arriving through an affiliate link carries that partner id and campaign for its whole life | **Pass** | `SCRIPT` — *"affiliate lead enters the canonical unclaimed pipeline with **immutable** attribution"* |
| 2 | TCPA screening blocks on this path exactly as it does in the portal | **Pass** | `SCRIPT` — *"TCPA screening blocks the affiliate path before a lead write"*; the assertion is on the write, matching the portal's |
| 3 | The affiliate lead appears in the unclaimed queue indistinguishable from a call-centre lead, except for its source | **Pass** | `SCRIPT` — same check as criterion 1: *"enters the canonical unclaimed pipeline"* |
| 4 | A link belonging to a paused partner stops attributing and shows a plain message | **Pass** | `SCRIPT` — *"paused affiliate link stops attributing and shows a plain message"*; both halves |
| 5 | **No code path in LA-1.7 is duplicated for this** | **Pass — now guarded** | `SRC` + `TEST` — see below |

The suite also covers two things the criteria do not ask for and should: *"click count is incremented
atomically under concurrency"*, and *"repeating the same submission is idempotent"* — the affiliate
path inherits LA-1.7's idempotency rather than reimplementing it, which is criterion 5 demonstrated
rather than asserted.

### Criterion 5 is an instruction, which is exactly why it needed a test

> *"One intake pipeline, not three. This task adds an entry point and a shorter form definition. It
> does not add a second lead model, a second work item, or a second disposition path. If you find
> yourself copying LA-1.7, stop."*

It holds today. Both doors — `app/api/partner/leads/route.ts` (the portal) and
`app/api/affiliate/[slug]/route.ts` (the link) — call the same `writePartnerIntakeArtifacts`, whose
own comment states the rule: *"Affiliate submissions call this function too; there must be one
queue/deal-flow/notification path for every source."*

Duplication here would not be untidy, it would be dangerous. LA-1.7's guarantee is that steps ③–⑤ are
best-effort in the **response** and never in the **record** — each failure writes a durable
`intake_failure` row and raises an alert, and a reconciliation job catches any lead without a work
item. A second copy of that pipeline is a second place to forget all of it, and the symptom is the one
LA-1.7 exists to prevent.

`lib/agentTemplates/oneIntakePipeline.test.mjs` holds it down three ways:

- **no API route inserts `lead_queue`, `deal_flow` or `lead_notifications` itself** — those are steps
  ③–⑤, and only the shared writer may create them;
- both known entry points still call the shared writer;
- and, failing in the other direction, the set of callers is pinned at exactly those two — a third
  door is fine, but whoever adds one has to say so here rather than inheriting the durable-failure
  and reconciliation guarantees by accident.

**Verified by mutation:** giving the affiliate route its own `deal_flow` insert fails the first
assertion by name.

---

## Suite state

`npm test` — **695 tests, 692 passing, 3 failing**. The three remain the concurrent session's
design-system work. `verify:intake-pipeline` and `verify:affiliate` both re-run clean after the
`intakeLocalDate` extraction.

---

## LA-1.9 · Pipelines & stages configuration — **Pass** (5 of 6; the sixth needs DDL)

**Goal:** Ray defines pipelines and their ordered stages, one per lead source, and every lead sits on
exactly one stage of one pipeline.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A partner user cannot read or write any pipeline configuration — **403 on every route** | **Pass** | `SCRIPT` — *"non-owner cannot read or write pipeline configuration"*; `TEST` — the LA-1.2 plane guard proves the stronger form: the partner plane has **no** pipelines route and never names a pipeline table |
| 2 | Two tenants can each have a stage called "Submitted" with different mappings | **Pass** | `SCRIPT` — *"same disposition key is tenant-scoped"*, *"tenant isolation hides the other tenant's configuration"* |
| 3 | Reordering stages never leaves duplicate or gapped positions | **Pass** | `SCRIPT` — *"reorder accepts an atomic complete stage set"* and, for the race, *"concurrent reorders finish with no gaps or duplicates"* |
| 4 | Archiving a stage in use keeps existing leads displaying correctly and removes it from pickers | **Pass** | `SCRIPT` — *"archiving an in-use stage preserves leads and removes the stage"*; both halves |
| 5 | **A lead's stage is stored once, as an id** | **Partial — the id is authoritative, but it is still stored twice** | `DB` + `SRC` + `TEST` — see below |
| 6 | A new tenant gets three seeded pipelines automatically | **Pass** | `SCRIPT` — *"new tenant receives all three default pipelines"* |

Criterion 1 is worth noting as the payoff from LA-1.2: the ticket lists *"pipeline configuration is
currently readable and deletable by any authenticated user"* among its traps, and the exhaustive
plane guard built two tasks ago answers it at the table level rather than by sampling routes.

### Criterion 5 is the trap the ticket names, still half-present

> *"Stage is stored twice on every lead — once as text and once as a foreign key — and nothing keeps
> them in sync after the insert. Store the id; derive the name."*

`stage_key` (text) and `stage_id` (FK) both still exist on `agent_leads`, `lead_queue` and
`deal_flow`. Measured live on 2026-09-22:

```
agent_leads  214,819 rows ·  5 with a null stage_id
lead_queue    11,543 rows ·  5 with a null stage_id
deal_flow         19 rows ·  0
```

`stage_key` is uniformly `"new"` on current rows while `stage_id` resolves to the real stage —
including a deal-flow row reading `"new"` whose id resolves to **Submitted**. Frozen at insert,
exactly as predicted.

**Behaviourally the criterion holds**, and that distinction is the point: `stage_key` is written in
one place and **read by nothing**. The authoritative stage is the id, so no screen and no filter can
show a stale stage. What remains is a loaded gun — a plausible `select("… stage_key …")` returns
`"new"` for every row in the database, forever, which is how the original defect behaved.

Dropping the column needs DDL this environment does not grant, and the generated Insert type still
requires it, so the write cannot simply stop either. `lib/pipelines/stageStoredOnce.test.mjs` keeps
it inert instead: nothing may read it back off a lead table, every lead insert must carry a
`stage_id`, and the set of modules writing the text copy is pinned at one.

### A latent defect found by that guard, and fixed

`lib/leadPost/service.ts` — the vendor lead-post path — wrote **neither** `pipeline_id` nor
`stage_id`, on either the lead row or its queue row. Only `stage_key: "new"`. A posted lead would
have landed on no pipeline stage at all.

It is latent rather than live: **no row in `agent_leads` has `posted_at` set**, so this path has never
accepted a lead on this project. Both inserts now resolve a real stage through the same
`resolveRuntimeStage` every other intake path uses, and the resolution is deliberately best-effort —
it throws when a tenant has no default marketing pipeline, and this file's own rule is that a lead
created but never queued *"is a lead nobody will ever see"*. A failure writes what it wrote before
rather than costing the lead.

### Two corrections to my own measurements

Recorded because both were wrong before they were right, and the second changes a conclusion.

**Unstable paging.** My first probe read these tables with `.range()` and **no `order by`**.
PostgREST does not guarantee a stable order without one, and the result — "every one of 214,819 lead
rows has a stage_id" — was wrong; exact counts show five do not. Re-measured with
`count: "exact", head: true`.

**A swallowed error.** My first sync probe destructured only `data` from a query against
`tenant_pipeline_stages`, discarded the `error`, and reported "0 stages" — the exact defect this
audit keeps finding in the product. The column I had selected (`stage_key`) does not exist on that
table; there are 12,898 stage rows.

Those two errors together produced a third: I attributed the five null-stage queue rows to the
lead-post path. They are older rows from elsewhere, with varied `stage_key` values (`quoted`,
`contacted`, `declined`, `issued`), and `posted_at` is null on all of them. The code comment written
on that assumption has been corrected.

---

## LA-1.10 · Transfer leads inbox & atomic claim — **Pass** (5 of 5)

**Goal:** Ray sees every incoming lead, and claiming one gives exactly one person ownership — even
when two people click at the same instant.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Two simultaneous claims: one succeeds, one gets a clear "already claimed by X", no state corrupted | **Pass** | `SCRIPT` — *"two simultaneous claims produce one winner, one clear conflict and one active call"*: one 200, one 409, the loser's message contains "already claimed", `owner_user_id === claimed_by`, and **exactly one** open active call |
| 2 | A claimed lead leaves every other agent's inbox within one second | **Pass, with a flaky measurement** | `SCRIPT` — see below |
| 3 | A failed chat post does not fail the claim | **Pass** | `SCRIPT` — *"partner chat failure does not roll back a successful claim"*, and the audit trail is checked too |
| 4 | Re-claiming after a dropped call works and does not collide with the stale active-call row | **Pass** | `SCRIPT` — *"re-claim closes a stale dropped call and opens a fresh active call"* |
| 5 | The inbox loads in under a second with 500 unclaimed leads | **Pass** | `SCRIPT` — 500 rows in **625–803ms** across three runs, on a dev server |

Criterion 1 is the best-covered assertion in LA-1: it checks the winner, the loser's **message**, the
stored ownership consistency and the active-call count in one check, so a claim that succeeded twice,
or one that raced into two call rows, would fail it. That is the "keep the active-call primitive's
five behaviours" instruction being honoured rather than restated.

### Criterion 2 failed once in three runs, and the cause is the measurement

First run:

```
FAIL claim broadcasts the tenant-scoped inbox invalidation within one second — 1260ms (CLOSED)
```

Two further runs passed. The window starts **before two concurrent claim requests are issued** and
ends when the realtime broadcast arrives, so it measures the dev server's API latency as well as the
broadcast. That latency is not small here: the same suite reports the 500-row inbox at 625ms, 803ms
and 711ms across the three runs, and the failing run was the slowest.

Measuring from the user's action is the right thing for a criterion phrased from the claimer's point
of view, so the test is not wrong — it is simply unable to separate "the broadcast was slow" from
"the dev server was slow", and in this environment the latter dominates. Recorded rather than
silenced: on a production build the API portion largely disappears, but a run here can fail for a
reason that has nothing to do with the criterion.

---

## Suite state

`npm test` — **698 tests, 696 passing, 2 failing**. Both remain the concurrent session's
design-system work (the `portal-partner` dark-mode selector and the handler-less controls in
`primitives-showcase.tsx`). The third failure recorded in the previous entry, the orphaned
`components/ui/settings-layout.tsx`, has since been resolved by that session.

---

## LA-1.11 · Verification panel & progress — **Pass** (5 of 5)

**Goal:** with the customer on the line, the agent walks the application, confirms or corrects every
field, and the system knows exactly how much is done.

The ticket explains why progress is the point: *"When a buffer agent hands a call to Ray, the first
thing Ray needs to know is how much of this is already done. A percentage that is computed rather
than typed is the difference between a smooth handoff and Ray starting again from the customer's
name."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Progress reflects **required fields only**, and reaches 100% exactly when all are confirmed | **Pass** | `SCRIPT` — three checks, and the discriminating one is *"optional confirmation does not change required-only progress"*; plus *"progress reaches exactly 100 when all visible required fields are confirmed"* and *"marking a required field outstanding lowers progress and clears completion"* |
| 2 | A correction updates the lead and leaves an audit trail of the old value | **Pass** | `SCRIPT` — *"correction updates the lead and records old/new values"*, then separately *"verification correction leaves an audit row"* |
| 3 | Re-claiming after a dropped call resumes at the same point with corrections intact | **Pass** | `SCRIPT` — *"a re-claim resumes the same session for the next agent"* and *"reclaimed panel keeps prior correction and progress point"* |
| 4 | The panel renders **any** product's form without product-specific code | **Pass** | `SCRIPT` — *"claimed agent can load the dynamic verification panel"*; `TEST` — no product code appears in the panel, see below |
| 5 | Two people cannot verify the same work item at once | **Pass** | `SCRIPT` — *"two claimants cannot verify one work item at once"*, and the subtler half, *"previous claimant cannot keep writing after handoff"* |

Criterion 1 is well tested in the way that matters: confirming an **optional** field is shown not to
move the number. A progress bar that counted every field would look plausible and would mislead
exactly when it matters, during a handoff.

Criterion 5's second check is the one most implementations miss. Blocking a second concurrent
claimant is easy; revoking the **previous** claimant's write access after the work item moves on is
where a stale browser tab silently overwrites the new agent's corrections.

---

## LA-1.12 · Disposition — one vocabulary + configurable wizard — **Pass** (6 of 6)

**Goal:** every call ends with exactly one recorded outcome, from one vocabulary, and the note that
explains it is composed rather than typed from scratch.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Exactly one disposition vocabulary exists in the codebase — **verified by search** | **Pass, with an overlap recorded for LA-2.x** | `DB` + `TEST` — see below |
| 2 | Two tenants can both have a stage called "Submitted" with different flows, and both wizards load | **Pass** | `SCRIPT` — *"two tenants can have same-named stages with separate flows"*; this is the trap *"one active flow per stage name, globally"* answered directly |
| 3 | No flow logic is compiled into the wizard component | **Pass** | `TEST` — no array-position reads, no tenant keys; see below |
| 4 | "Do not call" adds the number to the suppression list, **and a later submission of that number is warned** | **Pass, both halves** | `SCRIPT` — *"Do not call adds a tenant suppression row"*; `SRC` — screening calls `is_tenant_phone_suppressed` and returns a `dnc` warning, *"This number is on your do-not-call list. Confirm before submitting."*, with an audit row |
| 5 | Editing an earlier answer after completion truncates the path correctly | **Pass** | `SCRIPT` — *"editing an earlier answer reopens and truncates the walked path"*, then *"edited path can be committed again"* |
| 6 | Every one of the seven write targets is updated in one transaction where possible, reconciled where not | **Pass** | `SCRIPT` — *"queue, active call, deal flow, partner channel and audit targets reconcile"*, plus the lead's stage and the DNC row covered by their own checks; and *"two simultaneous completions are serialized and idempotent"* |

The ticket's sharpest instruction is honoured: *"'Do not call' must actually do something. In the
current system it is a label on one row and writes to no suppression list."* Here it writes the
suppression row **and** the suppression is read back at the next intake, which is the half that makes
the first half worth anything.

### Criterion 1 names its own instrument, so the search is the test

Measured live on 2026-09-22: the `dispositions` table holds **4,688 rows across 125 tenants — every
one of them exactly 8**, and the eight are precisely the ticket's table. One vocabulary, tenant-scoped
and editable, as specified.

`lib/dispositions/oneVocabulary.test.mjs` makes the codebase half of the criterion enforceable: a
file naming four or more of the eight keys is declaring a vocabulary, not making a reference, and
only the seed may do it. It fails in the other direction too — a stale allowlist entry is how one of
these stops being reviewed. **Verified by mutation:** a four-key list added to
`lib/verification/progress.ts` fails it.

Two files were examined and cleared rather than flagged, which is worth recording because both look
like duplicates at a glance:

- **`PARTNER_OUTCOME_LABELS`** in `lib/partnerLeads/service.ts` is a nine-key map, but the code reads
  the tenant's real `dispositions` table first and only falls back to this for display. It decides
  nothing; it prettifies an unresolved string.
- **`RECYCLABLE_DISPOSITIONS`** in `lib/nurture/contract.ts` names two keys as references, not a set.

### The overlap that is a finding, and belongs to LA-2.x

`app/api/app/dialer/attempt/[id]/disposition/route.ts` declares its own outcome set:

```ts
z.enum(["no_answer", "voicemail", "busy", "call_dropped", "not_interested",
        "callback_scheduled", "application_submitted"])
```

Three of those (`no_answer`, `voicemail`, `busy`) are not tenant dispositions at all; four share
names with the canonical eight. It consults no tenant configuration, so renaming or disabling a
disposition has no effect on the dialer, and a tenant who adds one cannot use it there.
`components/app/dialer-workspace.tsx` carries the same four names.

This is **not** simply a duplicate: a call *attempt* outcome ("no answer", "busy") is genuinely a
different fact from a work-item *disposition*, and a lead can collect three no-answers before one
"application submitted". What it is, is two vocabularies sharing four key names with nothing marking
which is which — and `RECYCLABLE_DISPOSITIONS` reaching for `no_answer` and `voicemail` shows the
confusion is already live, since neither can ever appear in the tenant's set.

The dialer belongs to LA-2.x. Both files are listed in the guard's allowlist **with the reason
written out**, so the count cannot grow quietly and the exemption cannot outlive the code.

### Criterion 3, and an over-strict assertion of mine

The named trap is specific: *"One specific flow's logic is hardcoded inside the generic wizard,
reading steps by array position."* Neither is present — the wizard walks the configured node graph by
id, and no array-position read exists. **Verified by mutation:** introducing `wizard.nodes[0]` fails
it by name.

My first version of the second assertion also barred **every** disposition key from the component,
and failed on `callback_scheduled`. That was my error, not the code's. The wizard branches on that
key to reveal a date, an assignee and an idempotency key — because it is the one outcome in the
seeded set that creates future work, which LA-1.12's own write-target table acknowledges
("callback sub-type" on the lead) and which `lib/dispositions/service.ts` branches on for the same
reason. A disposition that needs extra fields is not a flow. The exception is narrowed to that one
key and documented; any other key appearing there still fails.

---

## Suite state

`npm test` — **702 tests, 702 passing, 0 failing**. The concurrent session's design-contract
failures (the `portal-partner` dark-mode selector, the handler-less controls in
`primitives-showcase.tsx`, the orphaned `settings-layout.tsx`) have all been resolved by that
session. This is the first fully green run since LA-0.3.

---

## LA-1.13 · Daily deal flow — **Pass** (6 of 6)

**Goal:** at the end of the day Ray opens one screen and sees every deal worked, who worked it, which
partner it came from, and what happened.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Every submitted lead produces **exactly one** deal-flow row | **Pass** | `SCRIPT` + `DB` — see below |
| 2 | The row's date is correct for an agent working late in their own timezone | **Pass** | `TEST` — the five deterministic `intakeLocalDate` cases added under LA-1.7; `DB` — 0 of 19 rows have a null `local_date` |
| 3 | `product_line` is written explicitly, never defaulted | **Pass** | `SCRIPT` — *"a manual outside-system deal creates exactly one deal-flow row with explicit product"*, plus the Term Life three-row assertion recorded under LA-1.3; `DB` — 0 rows with a null `product_line` |
| 4 | Grouping by partner totals correctly and matches the leads table | **Pass** | `SCRIPT` — *"grouping by partner totals matches the filtered rows"*: the totals are checked against the rows, not merely rendered |
| 5 | Editing a field writes an audit entry | **Pass** | `SCRIPT` — *"editing disposition fields succeeds and writes audit"* and, separately, *"the edit has durable audit evidence"* |
| 6 | The grid loads in under two seconds with 10,000 rows | **Pass** | `SCRIPT` — see below |

### Criterion 1, checked in the data as well as the suite

The suite proves the manual path creates exactly one row, and the intake path is covered from the
other side by LA-1.7 — *"one accepted submission creates lead, work item, partial deal-flow row and
queued notification"*, then *"resubmitting the same draft updates one lead and repairs without
duplicating artifacts"*.

Checked independently against live data: **19 deal-flow rows, 0 leads carrying more than one**. The
criterion holds in the records, not only in the fixtures.

### Criterion 6 measures what it claims to

Worth confirming rather than reading, because `deal_flow` holds only 19 live rows and a two-second
budget against 19 rows would prove nothing. The check asserts `total === 10000` and that a
**100-row page** returns in under 2,000ms — so the fixture really is ten thousand rows, and what is
measured is a paged grid over them rather than the whole table.

The CSV export check is a bonus the criteria do not ask for and should: *"CSV export includes the
complete filtered result and neutralizes formulas"* — the second half is spreadsheet formula
injection, which is the standard way an exported lead list becomes an attack on the person who opens
it.

### One deliberate design decision worth recording

*"Deliberately partial at intake. The closer's quote is a claim; the agent's numbers are the truth.
Leaving them empty rather than pre-filling from the form stops a quoted figure being mistaken for a
written one."*

LA-1.7's intake check confirms it writes a **partial** deal-flow row, and this suite confirms the
agent fills the rest at disposition. A pre-filled carrier and premium would be the kind of
plausible-looking wrongness this audit has found repeatedly elsewhere.

---

## LA-1.14 · Buffer agent flow — **Pass** (5 of 5)

**Goal:** an unlicensed member of Ray's team takes the incoming call, runs the verification, and
hands Ray a warm customer with the application mostly filled in.

The ticket is built on a measurement, and it is the best argument in the sprint for deleting a
feature:

> *"The existing system has a full designed handshake — manager assigns, sends an ETA, buffer clicks
> ready, LA clicks ready, transfer sent. It is all in the database as columns and enums. Measured
> over seven days and 336 rows: **every one of those columns was empty.** The ladder exists in the
> schema and has never once run. What actually happens is self-claim. So build only what runs."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A buffer agent cannot record a sale disposition or open any commission screen — 403, verified by test | **Pass** | `SCRIPT` — *"buffer assistant cannot disposition a sale or open commissions"*; `TEST` — see below |
| 2 | Handoff moves ownership, the active call and the verification session together, **atomically** | **Pass** | `SCRIPT` — *"atomic accept moves queue, active call and verification session together"*, then *"ownership follows the accepted handoff"* |
| 3 | The receiving agent sees the verification progress **before** accepting | **Pass** | `SCRIPT` — *"licensed agent sees verification progress before accepting"* and *"handoff offer endpoint exposes progress to the receiving agent"* |
| 4 | An unaccepted handoff returns to the buffer agent rather than being lost | **Pass** | `SCRIPT` — *"handoff offer is durable and leaves the buffer as current owner until acceptance"*, then *"an unaccepted handoff returns to the buffer without losing the call"* |
| 5 | A buffer claim posts the connected card to the partner's channel **exactly once** | **Pass** | `SCRIPT` — *"buffer claim posts exactly one idempotent partner card"* and *"repeated claim does not post a second partner card"* |

### Criterion 1 is where three tasks meet

The buffer agent is the tenant `assistant` role — *"a permission, not a separate user type"*, as the
ticket requires. So the "any commission screen" half is already proved exhaustively by LA-0.2's work:
`lib/tenantAuth/moneyRoutes.test.mjs` classifies all 120 agent routes and asserts no money route
admits `assistant`, with an unclassified route failing the suite. The live check here proves the
disposition half.

That is the payoff from building the guard properly two modules ago: a criterion in LA-1.14 that says
"403 on any commission screen" needs no new test, because the exhaustive one already covers every
route that exists and every route that will exist.

### The state machine is real, and live

Checked directly rather than taken from the suite. `lead_queue.status` holds exactly nine values, and
they sum to the table's 11,543 rows:

```
unclaimed 3,449 · claimed 517 · expired 7,566 · completed 9
buffer_active 0 · handed_pending 1 · la_active 1 · closed 0 · dropped 0
```

All five states LA-1.14 specifies exist, and `handed_pending` and `la_active` each hold a live row —
the handoff has genuinely run, not merely been tested. The closed vocabulary is what LA-1.12 demands
("the work item's status stays a small closed set"), and a comment in `lib/leadPost/service.ts`
confirms the check constraint allows exactly those nine.

**A wording mismatch between two tickets, not a defect:** LA-1.14's diagram ends at `closed`, while
LA-1.12's dispositions close as `completed` or `dropped`. The implementation followed LA-1.12 — 9
rows are `completed`, 0 are `closed`. `closed` is permitted by the constraint and never written. Two
tickets, two words for one terminal state; the dependency won, which is the right outcome.

---

## Suite state

`npm test` — **702 tests, 702 passing, 0 failing**. No code changed this pair: all eleven criteria
already had direct evidence, and the two independent checks I ran against live data (deal-flow
uniqueness, the work-item state vocabulary) agreed with it. Adding a guard here would have been
noise rather than coverage.

---

## LA-1.15 · Agent Floor — **Pass** (5 of 5, one control corrected)

**Goal:** Ray opens one page and runs his whole inbound day from it — every partner, every incoming
call, every person on his team, live.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A lead claimed by someone else leaves the waiting band within one second, on every open floor | **Pass** | `SCRIPT` — *"database change reaches every open floor in under one second"* and *"database change emits a tenant-scoped Realtime floor signal"*; `TEST` — a bounded refresh fallback is kept for when Realtime is unavailable |
| 2 | The floor renders correctly for a brand-new tenant with **no integrations and no data** | **Pass** | `SRC` — see below |
| 3 | Wait timers survive a page refresh and are computed from the **queued time**, not from mount | **Pass** | `SRC` — see below |
| 4 | Every action on the floor is also available from the lead itself — **no floor-only path** | **Pass, after removing a dead control** | `SRC` + `BROWSER` — see below |
| 5 | Presence is honest: someone who closed their laptop shows as offline within a minute | **Pass** | `SCRIPT` — *"stale heartbeat is shown offline"*; `SRC` — `effectiveAvailability` treats a `lastSeenAt` older than 60,000ms as offline regardless of the stored value |

The suite also proves the ticket's first inherited rule — *"`live` is never inferred from the work
item's state… an open active-call row is the only evidence anyone is talking"* — as
*"on-call band uses an open `active_calls` row"*. That is the distinction LA-1.10 insisted on,
enforced one screen later.

### Criterion 2 is satisfied by construction, which is the right way

The rule behind it is quoted from the existing code: *"A filter over an empty table is an empty
floor, and that is the state every new deployment starts in. Any filter depending on an integration
must fail open until that integration has data."*

`eligibilityFor` fails open by shape rather than by special case:

```ts
if (item.preflightStatus === "already_customer" || item.duplicateWarning) return "blocked";
if (item.screeningWarning || item.preflightStatus === "spoken_before")    return "review";
return "eligible";
```

A tenant with no screening vendor has no `screeningWarning` and no preflight status, so every lead
falls through to **eligible** and the floor shows its work. A filter written the other way round —
"eligible only when screening says clear" — would render an empty floor on day one and look like a
dead product. The empty state is also written for a new tenant rather than as "no data": *"New
qualified inbound calls will appear here automatically."*

### Criterion 3 is computed from the server's timestamp

`durationLabel(item.queuedAt, now)` and `secondsSince(item.queuedAt, now)`, with `now` advanced by a
one-second interval. The elapsed time derives from `queuedAt`, which comes from the row, so a refresh
re-derives the same figure rather than restarting from mount. The amber and red thresholds are
`waitThresholds` from the server, not literals, matching *"turn amber then red past a configurable
threshold"*.

### Criterion 4 held, and turned up a control that did nothing

Checked action by action. **Nudge** exists on the lead too (`lead-detail-workspace.tsx` and
`verification-panel.tsx`), **claim** is the inbox's own endpoint, **accept handoff** is LA-1.14's
endpoint, and disposition lives on the lead. No floor-only path — the criterion holds.

But the floor carried a **Listen in** button whose entire behaviour was to explain that it does not
work:

```tsx
onListen={() => toast.info("Listen-in is available when a supervisor joins the live call.")}
```

Enabled, indistinguishable from Claim and Nudge beside it, and revealing its unavailability only
after a click. It is also not one of LA-1.15's in-scope actions — the ticket lists *"claim, hand off,
accept a handoff, nudge someone who has not picked up, close with a disposition"* — so it is an extra
control that promises a capability the product does not have.

This repository already has a sanctioned pattern for exactly this, cited in its own defect register
and implemented in `components/admin/void-invoice-dialog.tsx`: **disabled, with the reason printed
directly beneath**. The button now follows it, and the `onListen` prop is gone rather than left
dangling.

Confirmed in the browser as a real agent: one Listen-in control, `disabled: true`, with *"Available
once a supervisor joins the live call."* beneath it. The three bands render — **Waiting transfers 3,
On calls 4, Available team 0** — and `lib/design/contract.test.mjs` still passes 11 of 11, including
its own *"no button is rendered without a handler, a form, or an explanation"* check.

---

## LA-1.16 · Partner chat & automated notifications — **Pass** (6 of 6)

**Goal:** every partner has a channel; as their leads move, the channel updates itself.

This ticket carries the single best-measured lesson in LA-1:

> *"Over three days, **42 of 91 buffer claims announced nothing** — because only one of the two claim
> buttons posted the card. It read to everyone as 'one buffer agent is broken.'*
> **Notifications belong at the point the state changes, not at the point the button is clicked.**
> Post from the service that owns the transition, never from a component."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A partner user cannot read any channel but their own — 403, verified by test | **Pass** | `SCRIPT` — *"partner endpoint cannot reach an agent-only direct attachment"*; `TEST` — the LA-1.2 plane guard proves the general form: every partner route scopes from the session, and the three that accept `?partner_id=` refuse a mismatch |
| 2 | Each card fires **exactly once** per state change, **from the owning service** | **Pass** | `SCRIPT` — *"the owning claim service emits exactly one server-resolved card"*, *"buffer claim posts exactly one idempotent partner card"*, *"repeated claim does not post a second partner card"* |
| 3 | A chat outage never blocks a claim, a handoff or a disposition | **Pass** | `SCRIPT` — *"partner chat failure does not roll back a successful claim"* (LA-1.10), *"disposition isolates partner outcome-card failures"* (`TEST`), and the handoff suite's equivalent |
| 4 | An unknown card type renders as plain text rather than breaking the channel | **Pass** | `SCRIPT` — *"unrecognised/future card content is stored as readable text"*; `TEST` — *"unknown or future card types remain readable as plain text"* |
| 5 | Card contents are resolved **server-side**; the client sends only identifiers | **Pass** | `SCRIPT` — the claim check asserts *server-resolved* explicitly |
| 6 | Offboarding a partner archives the channel and **keeps its history** | **Pass** | `SCRIPT` — *"offboarding archives the channel and retains history"*, then *"archived channel history remains readable to the data owner"* |

### Criterion 2 is the lesson, and it is enforced where the lesson said to put it

The check is worded to match the diagnosis: *"the **owning claim service** emits exactly one
server-resolved card"* — not "the claim endpoint posts a card". That is the difference between the
fix and the bug: two buttons calling one service cannot diverge, two buttons each posting their own
card did. Idempotency is proven separately on the repeat.

Criterion 5 is the other half of the same idea, and the ticket explains the risk plainly: *"A card the
whole channel reads must not be describable by its caller. The caller sends identifiers; the server
resolves names, carriers and states. Otherwise a client can write anything into a partner-visible
card."* A partner user who could compose their own card text would be writing into a channel every
other user of that partner reads.

### Criterion 4 is covered twice, at both layers

`lib/partnerChat/cards.test.mjs` proves the **parser** degrades to plain text for an unknown type,
and the live suite proves an unrecognised card **stored** in the database reads back as text. That
matches the ticket's rule *"Parsers, not casts. The writer and the reader ship separately"* — the
failure mode it prevents is a channel that a newer server's card renders unreadable to an older
client.

The related rule *"Glyphs are derived, never stored"* — *"a stored emoji freezes today's decision into
every row already written"* — holds in `cards.ts`, where the card type maps to its label and glyph at
read time.

---

## Suite state

`npm test` — **702 tests, 702 passing, 0 failing**. `typecheck` clean. The one remaining lint warning
(`ShieldCheck` unused in `components/app/lead-detail-workspace.tsx`) belongs to the concurrent
session.

---

## LA-1.17 · Partner lead pipeline (their own view) — **Pass** (6 of 6, masking hardened)

**Goal:** a partner logs in and sees every lead they submitted, where each one is, and what happened —
without asking anyone.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Every query is partner-scoped server-side; changing the partner id in a request returns nothing | **Pass** | `SCRIPT` — *"changing partner_id cannot cross the partner boundary"*, *"CSV export rejects a foreign partner id"*, *"stage and outcome filters remain server-side and precise"*; `TEST` — the LA-1.2 plane guard proves the general rule across all 21 partner routes |
| 2 | SSN and banking fields are masked in **every partner view and in the CSV export** | **Pass — and widened** | `SCRIPT` — *"SSN, banking and policy fields are masked in detail"* **and** *"CSV export is partner-scoped and masks sensitive fields"*; `TEST` — see below |
| 3 | The board reflects a disposition within seconds of the agent recording it | **Pass** | `SCRIPT` — *"a disposition reaches the partner board within seconds"* |
| 4 | A paused partner can still read their history | **Pass** | `SCRIPT` — *"paused partners can still read their history"*, which is LA-1.1's pause rule honoured one screen later |
| 5 | An offboarded partner cannot log in at all | **Pass** | `SCRIPT` — *"offboarded partners cannot access the pipeline"*; `SRC` — `requirePartner` rejects an offboarded partner at the session, before any route runs |
| 6 | The board loads in under two seconds with 5,000 leads | **Pass** | `SCRIPT` — *"pipeline loads its first bounded page in under two seconds with 5,000 partner leads"*, plus *"load-more pagination reaches distinct older leads **without hiding the total**"* |

Criterion 6's second half is the one worth noting: paging to hit a latency budget is easy if you also
stop reporting how many rows there are. The suite checks the total survives.

### Criterion 2 is the task, and the pattern had a gap

The ticket files this under *"What the partner must NOT see"* and says the list **is** the task —
*"Get it wrong and the platform leaks."* The entry that is easy to miss is explained rather than
assumed:

> *"Full SSN, banking details and policy numbers — masked, **even though their own closer typed
> them**. A closer typing a routing number into a form is not the same as every user at that partner
> being able to browse it afterwards."*

The implementation is right in shape: masking happens **server-side**, recursively through nested
objects and arrays, and keys on the **field name** rather than the value — a routing number and a
quoted premium are both nine-ish digits, so guessing from the value would either leak the first or
mask the second.

Measured against every template field in the live project: **11 distinct keys, of which exactly one
(`ssn`) is sensitive.** No template has a banking field at all, so the banking half of the mask has
never been exercised by real data. It is pre-emptive — correct for a leak this expensive — and a
pre-emptive pattern has to match the names the product will actually use.

It did not. LA-1.4 specifies the form's Banking section as *"institution, routing number, account
number"*. `routing` and `account_number` matched; **a field keyed `institution` did not** — `bank`
only catches it if someone happens to write `bank_institution`. `iban` and `swift` are the same shape
of miss for an international carrier.

The mask is now `lib/partnerLeads/mask.ts`, a pure module with the three names added and six tests it
never had — `service.ts` is `server-only`, so the only prior coverage was the live check on the one
sensitive field that exists today. The tests pin both directions: the three ticket categories mask,
nesting and arrays mask, keying is on the name not the value — and **ordinary fields do not**, because
over-masking is a regression too. Date of birth is deliberately excluded: it is a normal lead field
the partner's own closer collected.

**Verified by mutation:** restoring the original pattern fails with *"institution reached the partner
unmasked"*. The live suite still reports *"SSN, banking and policy fields are masked in detail"* after
the extraction.

---

## LA-1.18 · Lead quality by partner — **Pass** (5 of 5)

**Goal:** one screen answers the question Ray cannot answer today — *which of my partners sends leads
worth taking?*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Every figure is computed from the deal-flow and lead records, **never hand-maintained** | **Pass** | `SRC` — the service reads only `agent_leads`, `partner_users` and `users`; there is **no stored metrics table**, so every figure is derived at read time; `SCRIPT` — *"counts reconcile against the agent_leads table itself"* |
| 2 | Counts reconcile exactly with the leads table for the same filter | **Pass** | `SCRIPT` — the reconciliation check above, plus *"one lead cannot become two worked leads"* |
| 3 | A partner with zero leads shows as a **zero row, not an absent one** | **Pass** | `SCRIPT` — *"a partner with zero leads remains visible as zero"* |
| 4 | Drilling into any number lands on exactly the leads it counted | **Pass** | `SCRIPT` — three checks: *"drilling a number returns exactly the leads counted"*, *"disposition breakdown drills precisely"*, and the exhaustive *"every cell drills to exactly the number it displays"* |
| 5 | The page states plainly that it does not yet include cost | **Pass** | `SRC` + `SCRIPT` — see below |

Criterion 3 is a small criterion protecting a real mistake: a partner sending nothing this period is
the most interesting row on a quality screen, and a query that inner-joins leads would drop exactly
that partner. Criterion 4's third check is the strong form — not "a drill works" but *every* cell
reconciling with what it displays, so a rounded or double-counted figure fails.

### Criterion 5 is honest copy, and it is guarded at the source

The ticket is unusually careful about this, because the screen's absence is as important as its
content:

> *"**Cost.** True cost per acquisition needs the payout ledger, which is not in LA-1. So this screen
> answers quality, not value — and it should say so on the page rather than implying it has done the
> money maths."*

The workspace renders it unconditionally:

> *"**Lead quality only.** Cost data is not included yet; CPA and partner spend stay in the accounting
> workspace."*

And the feature-gate description on the page above it agrees — *"Compare the quality and conversion of
every partner's leads without cost data."*

The suite guards it by asserting the literal sentence in the component source rather than by scraping
a rendered page, and its own comment explains why that is the right instrument here: the note is a
static, unconditional element, so *"it renders whenever the report renders, and this fails the day
someone deletes it."* The companion check *"the response contains no cost fields"* closes the other
half — the screen cannot quietly start shipping money data that the copy still disclaims.

This is the same class of problem as the dashboard hint and the form-studio preview found earlier in
this audit, and the only one of the three where the product got it right before I arrived.

---

## Suite state

`npm test` — **708 tests, 708 passing, 0 failing** (up 6: the mask tests). `typecheck` clean. The one
remaining lint warning (`ShieldCheck` unused in `components/app/lead-detail-workspace.tsx`) belongs to
the concurrent session.

---

## LA-1.19 · Subscription limits on partners & seats — **Pass** (5 of 5), with no live exposure

**Goal:** the subscription's limits are real. Ray cannot add a twelfth publisher on a plan that
allows ten, and the message tells him what to do about it.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A **hand-crafted API request** to create a partner over the limit is rejected with 403 | **Pass** | `SCRIPT` — *"hand-crafted create over max_publishers is 403 and specific"*, plus *"concurrent creates cannot overrun the cap"* and *"repeating the same create request cannot consume another capacity slot"* |
| 2 | Pausing frees a slot immediately; unpausing over the cap is blocked with a clear reason | **Pass** | `SCRIPT` — *"pausing a partner frees its slot immediately"*, then *"unpausing over the cap is blocked with a reason naming the limit"* |
| 3 | Downgrading below the current count blocks new creation but **breaks nothing existing** | **Pass** | `SCRIPT` — *"downgrade below current usage keeps existing data"* and *"downgrade blocks new creation without deleting history"*; both halves asserted separately |
| 4 | Every limited screen shows current usage against the cap | **Pass** | `SCRIPT` — *"every capped surface reports usage against its cap"*; `BROWSER` — the Partners screen reads *"1 of Unlimited available"* per partner type |
| 5 | The upgrade prompt names the **specific** limit, not a generic message | **Pass** | `SCRIPT` — the word *"specific"* is in the assertion, and criterion 2's check requires the reason to name the limit |

The ticket's rule is honoured where it matters: *"Hiding the button is not enforcement. The API check
is the only real one."* Criterion 1 is asserted against a hand-crafted request rather than a UI
click, and the concurrency case is covered too — two creates racing at the cap is exactly how an
off-by-one becomes a paid-for overage.

The lifecycle rule is also right: *"Paused partners do not count. Offboarded partners do not count…
otherwise Ray can never rotate a bad publisher out for a good one."* Criterion 2 proves the freeing,
and criterion 3 proves a downgrade is not retroactive.

### The enforcement is correct and currently enforces nothing

Measured on the live project:

```
plan_limits          23 rows (one per plan) — max_seats set, every partner cap NULL
tenant_entitlements 116 rows — max_publishers NULL on all 116
plan_meters           0 rows
```

So **no tenant in this project has a partner, affiliate, buffer-seat or partner-user cap.** The
"Unlimited" the Partners screen shows is honest rather than a placeholder, and the code paths in
criteria 1–3 and 5 are exercised only by the suite's own fixture tenant, which sets a cap explicitly.

That is a plan-configuration gap, not a code defect — and it is the **same gap recorded against
SA-2.5**, where `plan_meters` held 0 rows and every metered action was therefore unlimited. One root,
two tables: the 23 plans define `max_seats` and nothing else. Worth stating plainly because a
criterion that passes against a fixture while no real tenant can ever hit it is a criterion whose
first production exercise will be its first real test.

---

## LA-1.20 · Lead workspace page — **Pass** (5 of 5)

**Goal:** open one lead and see everything about it in one place — without clicking between the
inbox, the verification panel, the deal flow and the partner's channel.

The justification is a support story rather than an architecture one: *"When a customer calls back
three days later and asks 'what happened with my application', Ray currently has four screens to
check. This is the page that answers it."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | **Every action** available in the inbox or the Floor is also available here | **Pass** | `SCRIPT` — see below |
| 2 | The timeline shows every state change with actor and time, and **cannot be edited** | **Pass** | `SCRIPT` — *"initial timeline includes submission"*, *"timeline contains the verification correction"*, *"stage change is reflected and appears in timeline"*, and the second half: *"a timeline correction cannot be rewritten in place"* |
| 3 | A correction made during verification is visible **alongside** what the closer originally typed | **Pass** | `SCRIPT` — *"verification correction is shown alongside original value"* |
| 4 | The form renders for any product with **no product-specific code** | **Pass** | `SCRIPT` + `TEST` — see below |
| 5 | A partner user cannot open this page at all — they get LA-1.17 instead | **Pass** | `SCRIPT` — both halves: *"partner session is redirected to the partner surface"* **and** *"partner session cannot call the agent workspace API"* |

Criterion 5 is the right shape. A redirect alone would be navigation, not enforcement — the partner
could still call the API directly. The suite asserts the redirect *and* the 403 behind it, which
together are what "cannot open this page at all" actually means.

### Criterion 1 is derived, not listed — which is why it will keep holding

This is the mirror of LA-1.15 criterion 4, and the same claim from the other end. Rather than
enumerating actions by hand, the check **extracts every `/api/app/...` endpoint referenced by
`transfer-inbox.tsx` and `agent-floor.tsx`** and asserts the workspace calls all of them, with one
documented exemption — the inbox's own listing endpoint, which a single-lead page has no reason to
call.

A hand-written list would have stopped being true the moment somebody added an action to the Floor.
This cannot: adding one to either source screen and not to the workspace fails the check by name.

### Criterion 4, and a better discriminator borrowed from the suite

The live check does not look for product names. It looks for a **decision made from the product
field**:

```js
/(?:if|\?|&&|switch)[^\r\n]{0,80}(?:product_line|product_code)\s*(?:===|==|!==|!=|\.includes|case )/
```

Its own comment explains why that is the stronger instrument: *"a renderer can decide what to draw
from `product_line` without ever writing a product name, and the failure is invisible for every
product that still happens to be handled."*

My guard from LA-1.11/1.12 checked only for product **name literals**, which would have called that
clean. It now carries both discriminators and covers all three lead screens — the verification panel,
the disposition wizard and the lead workspace. Kept alongside the live check rather than instead of
it, because that suite needs a running server while this runs in `npm test`.

**Verified by mutation:** adding `l.product_line === "x"` to the workspace fails it, quoting the
offending expression back.

---

## Suite state

`npm test` — **708 tests, 708 passing, 0 failing**. `typecheck` clean. LA-1.19 and LA-1.20 needed no
product fix; the only change is the widened product-branch guard.

---

## LA-1.21 · Notes & internal comments — **Pass** (5 of 5)

**Goal:** anyone working a lead can write down what happened, and it is obvious who can see it.

The rule the task exists for: *"**Internal is the default.** A note written in a hurry must never
surprise its author by appearing in a partner's channel."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A new note is internal unless the author explicitly changes it | **Pass** | `SCRIPT` — *"new notes default to internal and preserve plain text"* |
| 2 | A partner user cannot see internal notes through **any route — including the export** | **Pass** | `SCRIPT` — *"no partner route exposes an internal note, the CSV export included"*, plus *"partner cannot see an internal note in chat"*; `TEST` — see below |
| 3 | Changing a note from shared to internal **removes it from the partner's view** | **Pass** | `SCRIPT` — *"changing shared to internal removes partner visibility"*; `SRC` — resolved at read time, see below |
| 4 | Deleting a note leaves a tombstone in the timeline, not a silent gap | **Pass** | `SCRIPT` — *"delete leaves a timeline tombstone"* |
| 5 | Mentioning a teammate notifies them within seconds | **Pass** | `SCRIPT` — *"mention creates an immediate durable teammate notification"*, asserting exactly one row for the mentioned user |

The suite also covers *"editing keeps an edit history — notes are evidence"* as *"author edit is
saved with immutable history"*, and the full-text search requirement.

### Criteria 2 and 3 rest on one design decision, and it is the right one

A note reaches the partner plane through exactly **one carrier**: a shared note is posted into the
partner's channel as a `partner_messages` row keyed `lead-note:<id>`. Nothing else crosses.

Both readers of that carrier — the chat and the partner lead detail — **re-resolve the note's current
visibility at read time** rather than trusting the message that carried it:

```ts
notes.filter((note) => note.visibility === "shared" && !note.deleted_at)
```

That is what makes criterion 3 work *retroactively*. The message was legitimately shared when it was
written; flipping the note to internal has to revoke it without deleting history, and re-resolving on
every read does exactly that. Trusting the message would have made criterion 3 unimplementable
without destroying evidence.

And it explains why a three-route sample satisfies an "any route" criterion here, where LA-1.2
needed an exhaustive scan: **`PartnerLeadRow` has no note field at all.** The list, the pipeline and
the CSV export all serialise that type, so none of them can leak a note whatever they do. The only
note-bearing surface is `PartnerLeadDetail.timeline`, and that is filtered.

**What I added.** Those two readers implement the same predicate in two separate services. They agree
today. `lib/leadNotes/partnerVisibility.test.mjs` fails if they stop agreeing, if either stops
re-resolving at read time, or if a note field appears on `PartnerLeadRow` — **verified by mutation on
all three**: dropping `deleted_at` from one reader fails with *"the two partner note readers disagree
about what a partner may see"*, and adding a note field fails naming the export and the pipeline.

### The schema warning was read and answered

> ⚠️ *"The existing system's note table has `author_user_id NOT NULL` combined with
> `ON DELETE SET NULL`. Deleting a user raises an error. Do not carry that forward."*

`tenant_lead_notes.author_user_id` is `not null references public.users(id) **on delete restrict**`,
and the migration explains the choice rather than leaving it to be rediscovered: *"NOT NULL with
RESTRICT is coherent — a user who has written notes cannot be deleted, and says so."*

That is the correct resolution and not merely a different one: notes are evidence, so the author must
survive, and RESTRICT refuses the delete with a clear dependency error instead of erroring on a null
write. In practice it never fires, because SA-1.4's soft delete means users are deactivated rather
than removed.

---

## LA-1.22 · Callback scheduling & calendar — **Pass** (6 of 6)

**Goal:** when a call ends with *"call me back Thursday afternoon"*, the system remembers, reminds,
and puts it in front of the agent at the right moment.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A callback set for "2pm Thursday" fires at 2pm in the **customer's** timezone, verified **across a zone boundary** | **Pass** | `SCRIPT` — *"customer-local callback time is converted and stored as UTC"* and *"the same wall-clock time converts differently across a DST boundary"*; `TEST` — *"the same customer-local time becomes different UTC instants across a zone boundary"* |
| 2 | A due callback appears on the Agent Floor **and** in the due-today list | **Pass** | `SCRIPT` — *"a due callback appears on the Agent Floor, and a future one does not"*; `BROWSER` — the dashboard's "Callbacks due today" card, confirmed under LA-0.3 |
| 3 | An overdue callback stays visible until actioned and is **counted separately** | **Pass** | `SCRIPT` — *"overdue callbacks remain visible and separately counted"* |
| 4 | Rescheduling **moves the reminder** and leaves a timeline entry | **Pass, both halves** | `SCRIPT` — *"rescheduling resets the reminder marker"* and *"rescheduling leaves a timeline entry naming the old and new time"* |
| 5 | Completing a callback returns the lead to a workable state with a fresh disposition | **Pass** | `SCRIPT` — *"completion reopens the lead queue"*, *"completion leaves a fresh workable queue and immutable history"*, and *"concurrent completion requests are race-safe"* |
| 6 | Choosing "Callback scheduled" without setting a date is blocked | **Pass** | `SCRIPT` — *"choosing callback scheduled without a date is blocked"*, and the same for a reschedule |

### Criterion 1 is tested the hard way

The ticket states the rule and the reason together: *"Store the instant in UTC. Display in the
**customer's** timezone with the agent's shown alongside… an agent licensed in 14 states is routinely
three hours from his customer."* The legal edge is real — *"Calling an Arizona customer at 7am Eastern
is both rude and, before 8am local, illegal."*

The assertion is not "a timezone is stored". It checks the **converted instant**: a 14:00 customer-local
callback is asserted to land on `2027-01-03T21:00` UTC — a seven-hour offset, which is the right
answer for that zone in January and the wrong one in July. The suite then reschedules the same
wall-clock time into both halves of the year and asserts the UTC instants differ, so a naive
fixed-offset conversion fails.

The unit test carries the zone-boundary half independently of the database, and
`stateFromLeadValues` derives the customer's zone from their state rather than asking the agent —
which is what stops the agent's own timezone leaking into the calculation.

Criterion 4's first half is the one most easily missed: moving a callback without moving its reminder
leaves a reminder that fires for a time that no longer exists. It is asserted separately from the
timeline entry.

---

## Suite state

`npm test` — **711 tests, 711 passing, 0 failing** (up 3: the partner note-visibility guard).
`typecheck` clean. Neither task needed a product fix.

---

## LA-1.23 · Unclaimed SLA & escalation — **Pass** (6 of 6)

**Goal:** no paid lead ever sits unnoticed, and no queue silently fills with rows nobody will ever
work.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Each rung fires **exactly once** per lead, proven by running the job twice | **Pass** | `SCRIPT` — *"all four rungs fire once on first run and stay once on second run"*, which is the criterion's own method |
| 2 | Claiming at any point stops **the whole ladder** immediately | **Pass** | `SCRIPT` — *"claiming stops every rung, not just expiry"* |
| 3 | Expiry only ever matches unclaimed rows — a claimed lead is never expired underneath someone | **Pass** | `SCRIPT` — *"claimed lead is never expired by scheduler"*, asserting both `status` and a null `sla_expired_at` |
| 4 | Expired leads are readable and reopenable | **Pass** | `SCRIPT` — *"an expired lead is still fully readable"*, *"expired lead can be reopened"*, *"reopening twice is idempotent"* |
| 5 | Changing a threshold takes effect without a deploy | **Pass** | `SCRIPT` — *"raising a threshold takes effect on the next run with no deploy"* |
| 6 | The job reports what it did, **and a failure alerts** (SA-6.1) | **Pass, both halves** | `SCRIPT` — *"the job reports the rungs it fired"*, *"the second run reports no repeat work"*; `SRC` — see below |

The ticket's central instruction — *"Build one scheduler with two thresholds"* — is honoured: one job
advances every rung, rather than the legacy arrangement where *"a 60-second escalation and a 4-hour
expiry belong to two different subsystems that share no code and no vocabulary."* Criterion 2's check
is worded to prove exactly that, since a merged clock would be discovered by claiming stopping expiry
but not escalation.

Criterion 1's mechanism is worth recording because the ticket specifies it: *"Idempotent — each rung
fires once per lead. **The audit row is the already-fired flag.**"* That is why running the job twice
is a sufficient test — there is no separate flag to drift from the evidence.

### Criterion 6 is better served than SA-6.1 led me to expect

`lib/queueSla/job.ts` does three things this criterion needs:

- **records the run** (`recordUnclaimedSlaRun`);
- **alerts on failure** — `alertUnclaimedSlaOperator({ reason: "failed", … })` on both a partial
  failure (*"N SLA side effect(s) failed. The durable events remain available for retry."*) and an
  unhandled exception, each with a **dedupe key** so a job failing every minute does not become its
  own outage;
- **detects a missed run** — `lib/queueSla/heartbeat.ts` carries `heartbeatState(row, now, maxAge)`.

**This revises the SA-6.1 picture.** I graded SA-6.1 **Partial** because `job_runs` and `job_schedule`
do not exist, while noting that `lib/billing/heartbeat.ts` provides a missed-run monitor for period
billing. This is a **second** one, for the SLA job. So the shape is clearer than I recorded: the two
jobs whose silence would be most expensive each carry their own run record, failure alert and
heartbeat. What is missing is the **generic** registry and the monitor screen — not the capability.
SA-6.1's verdict stands; its description was incomplete.

---

## LA-1.24 · Existing-customer pre-flight check — **Pass** (6 of 6)

**Goal:** the moment a lead arrives, the agent knows whether this person is a stranger, someone he has
spoken to before, or an existing customer — before he opens his mouth.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A lead from another tenant is **never** returned, under any input | **Pass** | `SCRIPT` — *"cross-tenant contact is never returned"*, *"missing identity fields fail closed without scanning a tenant"*, *"hostile identity input is treated as data"*; `SRC` — see below |
| 2 | The same person with two phone numbers and a misspelled surname is matched | **Pass** | `SCRIPT` — *"alternate phone and misspelled surname match the household contact"*; the LA-0.6 fuzzy scorer, not phone-only |
| 3 | The check completes in under 500ms against 20,000 contacts | **Pass** | `SCRIPT` — *"the pre-flight check answers in under 500ms against 20,000 contacts"*, and the RPC measured separately |
| 4 | Sold-twice-by-two-partners is flagged **distinctly** from a plain repeat contact | **Pass** | `SCRIPT` — *"two sold leads from two partners are returned distinctly"* |
| 5 | The UI states plainly that policy matching is not yet included | **Pass** | `SCRIPT` — *"the workspace states plainly that policy matching is not included"*; `SRC` — the Agent Floor says the same thing in `screeningNote`: *"Prior contact found. Policy matching is not included yet."* |
| 6 | The result is **stored on the lead**, not recomputed for a dispute months later | **Pass** | `SCRIPT` — *"the result is stored on the lead with the policy disclaimer"*; `SRC` — written to `preflight_status`, `preflight_checked_at`, `preflight_result` |

Criterion 4 matters commercially rather than technically, and the ticket says why: *"the same person
sold to Ray twice by two different publishers in the same week is a billing dispute worth having."*
Criterion 6 is what makes that dispute winnable — a recomputed answer months later is not evidence.

### Criterion 1 is the reason this task is tagged Security, and it is answered at every layer

The finding it replaces is severe:

> ⚠️ *"The existing implementation **searches the entire leads table with no tenant filter** and
> returns SSN last-four, phone numbers, policy numbers, premiums and agent names. The moment a second
> agency exists, that is a cross-tenant data leak with regulated personal data in it."*

The rebuild answers it four ways, and I checked each rather than taking the suite's word:

- **The scan is filtered at its root** — `where l.tenant_id = p_tenant_id`, not filtered afterwards;
- **every join carries the tenant across** — `p.tenant_id = l.tenant_id`, and the same on the lateral
  joins into `deal_flow` and `lead_queue`, so no join can widen the scope;
- **the function is unreachable from the tenant plane** —
  `revoke all on function … from public, anon, authenticated, tenant_app`, so only `service_role` can
  invoke it and the tenant id always comes from the session;
- **`security definer` with `set search_path = public, pg_catalog`**, which closes the search-path
  substitution that a definer function otherwise invites.

There is also a fail-closed guard in the `where` clause: with no phone, no date of birth, no name and
no address, the predicate matches nothing rather than scanning the tenant. That is the
*"missing identity fields fail closed without scanning a tenant"* check, and it is the difference
between a lookup and an export.

### Criterion 5 is honest in both places it appears

The ticket asks for the screen to say what it has **not** checked: *"'Already a customer' needs the
policy record, which arrives in a later module. Until then this task answers 'have I spoken to this
household before' honestly and completely, **and says so** rather than implying it checked for
policies."*

Both surfaces do. The workspace is asserted by the suite, and the Agent Floor's `screeningNote`
composes *"Previous lead from {partner}. Policy matching is not included yet."* — naming the partner
when it knows it, and still disclaiming the part it cannot answer.

That is the third screen in this audit where the product states a limitation rather than implying
completeness — with LA-1.18's cost disclaimer and SA-5.3's engagement signal — and the contrast with
the dashboard hint and the form-studio preview I had to fix is the point: the difference is whether
someone wrote the sentence deliberately.

---

## Suite state

`npm test` — **711 tests, 711 passing, 0 failing**. `typecheck` clean. Neither task needed a product
fix or a new guard: every criterion had direct evidence, and the four independent checks I ran on the
pre-flight scoping agreed with it.

---

## LA-1.25 · Agent alerts away from the Floor — **Pass** (6 of 6)

**Goal:** Ray finds out a lead has arrived even when the Agent Floor is not the tab he is looking at.

The argument for the task, in the ticket's own words: *"A live transfer is worth \$65–\$95 and the
customer is on the line now. **A screen nobody is looking at is not a notification system.**"*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A lead arriving while the tab is in the background produces a browser notification and a sound | **Pass** | `SRC` — `new Notification(…)` when permission is granted, and `playAlertSound` on the batch; both independent of tab focus by construction |
| 2 | Clicking the notification opens that lead **directly** | **Pass** | `SRC` — `notification.onclick = () => { window.focus(); openAlert(alert); }`, and `openAlert` is `window.location.assign(alert.link)` |
| 3 | Denied browser permission degrades to toast plus sound, and offers a clear way to re-enable | **Pass** | `SCRIPT` — *"a denied browser permission still leaves the toast"*, *"…still leaves the sound"*, *"the settings panel offers a way to re-enable browser alerts"*, *"an unsupported browser explains the limitation without offering a dead action"*; `BROWSER` — verified under a genuinely denied permission, see below |
| 4 | Do-not-disturb suppresses sound and browser notifications but **never** suppresses an escalation email | **Pass** | `SCRIPT` — *"do-not-disturb never withholds an alert server-side"* and *"the escalation email path does not read alert settings"*; `SRC` — DND gates the client notification and the sound |
| 5 | **Ten leads arriving at once produce one sound, not ten** | **Pass** | `TEST` — *"a burst of alerts is delivered as one sound batch"*; `SCRIPT` — *"a burst of ten alerts yields a single sound decision"* and *"the sound is played once per batch, not once per alert"* |
| 6 | Every alert type can be turned off individually, and the setting persists | **Pass** | `DB` + `BROWSER` — see below |

### Criteria 3 and 6 were verified in a browser that had already denied permission

The pane reported `Notification.permission === "denied"`, which is precisely criterion 3's scenario,
so the degradation path could be observed rather than inferred. Opening the alert settings showed:

```
New unclaimed leads · Handoffs offered to me · Unclaimed escalations
Callbacks due · Mentions in notes or chat · Partner messages
Do not disturb · Mute sound · Volume
Re-enable browser alerts in browser settings
```

Six independent toggles, one per row of the ticket's alert table, plus the DND and sound controls —
criterion 6 in the interface. The persisted shape agrees: `agent_notification_settings` stores
`enabled_events` as a per-event object with exactly those six keys, and `settingsFromRow` merges each
key over the defaults individually, so an unknown or missing key falls back rather than breaking the
row.

**The re-enable label is the part worth praising.** Once a user has denied notification permission the
browser will not prompt again, so a button offering to "Enable browser alerts" would do nothing and
look broken. The label is permission-aware — *"Re-enable browser alerts in browser settings"* when
denied, an enable action when the permission is still default, and an explanation rather than a dead
action when the browser has no Notification API at all. That is the same discipline as the Listen-in
control I had to fix on the Agent Floor, applied correctly here without prompting.

The DND indicator is equally literal: the header button reads **"Alerts on"**, which answers the
ticket's *"with an obvious indicator so it is never on by accident"*.

### One deliberate decision the criteria do not ask about

```ts
// Browser/lock-screen notifications intentionally avoid lead, policy, and account details.
// The authenticated in-portal toast remains the detailed surface.
new Notification("Insurvas alert", { body: "You have a new portal alert.", tag: alert.id });
```

A browser notification renders on a lock screen, beside whoever is standing near the desk. The
in-app toast carries the customer's name; the OS-level one does not. The criteria are silent on
content, so this is a judgement the implementation made on its own, and it is the right one.

`tag: alert.id` is doing quiet work too: same-tag notifications replace rather than stack, so
criterion 5's coalescing holds at the OS level as well as in the sound decision.

---

# LA-1 complete — 24 tasks

Every task in LA-1 now carries a per-criterion verdict. Totals across the module:

| Verdict | Count | Tasks |
|---|---|---|
| **Pass** | 23 | 1.1–1.4, 1.6–1.18, 1.20–1.25 |
| **Pass, one criterion unprovable here** | 1 | 1.5 (the TTL/credit assertion needs a server with `DEMO_SCREENING_MODE=false`) |

Two criteria are **Partial within a passing task** and both are recorded in place rather than hidden
in the totals: LA-1.9 criterion 5 (`stage_key` still stored beside `stage_id`, inert but present,
dropping it needs DDL) and LA-1.19's enforcement having no live exposure, because no plan in this
project sets a partner cap.

**Product defects found and fixed in LA-1:**

- the form studio's preview drew every field as a text box while claiming the portal *"will show
  exactly these fields"* (LA-1.4);
- the Agent Floor's **Listen in** button was enabled and did nothing but explain itself (LA-1.15);
- the partner mask missed `institution`, a banking key the product's own form spec names (LA-1.17);
- the vendor lead-post path wrote no `pipeline_id` or `stage_id`, latent because that path has never
  run here (LA-1.9);
- `verify-partners.mjs` asserted `<= 1` where it meant `=== 1`, so *"offboarding preserves lead
  history"* could not fail (LA-1.1).

**Guards added**, each verified by reintroducing the fault: partner-plane isolation across all 141
routes, one-intake-pipeline, no-prose compliance decisions, the disposition vocabulary, stage-stored-
once, product-branch rendering, deal-flow local date, preview parity, the partner note mask, and
partner note visibility.

**The recurring shape**, across SA and LA alike: the code is usually right and the **claim about it**
is what drifts — a preview that promises more than it renders, an empty state asserting emptiness
nothing measured, a test whose comparison cannot fail, a criterion proved against three routes where
it says every route. The fixes are mostly sentences and assertions rather than logic.

---

## Suite state

`npm test` — **711 tests, 711 passing, 0 failing**. `typecheck` and `lint` clean apart from one
warning belonging to the concurrent session.

---

# LA-2 · Outbound

## LA-2.1 · Lead vendors & campaigns — **Pass** (4 of 5); the attribution chain reaches one hop

**Goal:** every lead knows which campaign it came from, and every campaign knows exactly what it
cost. *"Without that chain nothing else in this module can compute anything."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Every lead carries its `campaign_id`, and it **survives into the application and the policy record** | **Partial — the first hop holds, the rest is a column with no writer or a table that does not exist** | `DB` + `SRC` — see below |
| 2 | Effective cost per record changes when a credit is recorded, and the change is visible | **Pass** | `SRC` — a **generated** column: `(total_spend_cents - credits_received_cents) / nullif(records_purchased, 0)`; `TEST` — pinned as generated |
| 3 | Pausing a campaign stops its leads being served within seconds | **Pass** | `SRC` — serving reads the `campaigns_servable` view, which is `where status = 'active'`, re-read on every draw |
| 4 | A vendor rollup exists that sums its campaigns correctly | **Pass** | `SRC` — the rollup sums spend and credits and divides once; `TEST` — *"the vendor rollup sums usable rows and divides once, not per campaign"* |
| 5 | Two active campaigns with weights 4 and 2 serve roughly 2:1 | **Pass** | `SRC` — see below |

Criterion 2 is satisfied in the strongest available way. `effective_cost_per_record_cents` is a
`generated always` column, so recording a credit changes it with **no code path that can forget to**.
The guard pins that: turning it into a stored column somebody updates is the obvious optimisation and
would reintroduce precisely the drift the criterion forbids.

### Criterion 5 is implemented in SQL, which is why it looked absent

`mixing_weight` appears nowhere in the TypeScript — only in the generated types — and a previous QA
note recorded that *"campaign mixing weights decided nothing… implemented, tested, and inert."* That
was true and has been fixed: the weighting lives in `next_campaign_for_serving`, a weighted draw over
`sum(mixing_weight)`, called from `serve_next_lead`.

The migration that added it says why a column alone proves nothing — *"`mixing_weight` sitting in a
table is a number nobody reads"* — and the draw is textbook, with the criterion quoted into the code:

> *"A point on the line [0, total), then the first campaign whose running total passes it… with
> weights 4 and 2 the first owns 4/6 of the line and the second 2/6, which is the 2:1 in criterion 5."*

The same view answers criterion 3: only `active` campaigns are in `campaigns_servable`, and it is read
on every draw, so a pause takes effect on the next serve rather than on a cache expiry.

### Criterion 1 reaches exactly one hop, and that is worth stating plainly

Measured on the live project:

```
agent_leads.campaign_id   present, written by lib/leadPost/service.ts   ✓
deal_flow.campaign_id     present, written by NOTHING       0 of 19 rows populated
applications / policies   the tables do not exist
agent_leads overall       0 of 214,819 rows carry a campaign_id
```

The first hop works. The second is a column with no writer, and the rest of the chain is unbuilt —
which the ticket anticipates, since *"onto the application, onto the policy"* depends on modules that
arrive later.

**It is not yet a defect, and the reason matters.** The two callers of `writePartnerIntakeArtifacts`
are a partner submission and an affiliate referral; both carry a `partner_id` rather than a campaign,
so plumbing the field through them would write null forever. The path that does know a campaign —
`leadPost` — writes no deal-flow row at all, and deciding which module closes that belongs to
LA-2.5/2.9 rather than here. Plumbing it now would be motion, not progress.

**What is guarded instead is the direction the damage would come from.** LA-2.17 computes cost per
issued policy from this chain. A reporting query grouping by `deal_flow.campaign_id` while nothing
populates it does not error — it returns a tidy, confident table in which every campaign has zero
attributed deals. `lib/campaigns/attributionChain.test.mjs` fails the day something reads that column
for attribution while nothing writes it, and points at where to close the chain. **Verified by
mutation:** a reporting module selecting `campaign_id` from `deal_flow` fails it by name.

The 0-of-214,819 figure is not alarming on its own — every one of those leads predates LA-2 and came
through the partner path, which has no campaign. It does mean the chain has no live exercise yet.

---

## LA-2.2 · List import — mapping, normalise, transactional commit — **Pass** (7 of 7)

**Goal:** Ray drops a vendor's file in as it arrived and gets a clean, scrubbed, costed set of leads —
**or nothing at all.**

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A vendor file with **completely different headers** imports without editing the file | **Pass** | `TEST` — *"LA-2.2 mappings normalize headers and reject unknown template fields"* |
| 2 | The mapping is remembered and pre-applied on that vendor's next file | **Pass** | `TEST` — *"LA-2.2 mapping storage is tenant-scoped and additive"*; `SRC` — the import screen reads `tenant_import_mappings` by vendor and product |
| 3 | A failure at any step leaves **zero** rows imported | **Pass** | `TEST` — *"LA-2.2 import commit is one service-only database transaction"*, *"the preflight writes no leads, and the commit is a separate call"*, *"database-contract failures use a safe unavailable response"* |
| 4 | The preview shows exactly what will be imported, rejected and suppressed, **before anything is written** | **Pass** | `TEST` — *"the import stages the file and redirects instead of writing it"*, and *"decisions cannot be applied to a different file than the one reviewed"* |
| 5 | Cost per usable lead is correct **after scrub rejections** | **Pass** | `TEST` — *"the usable-row cost basis exists and divides by usable rows, not purchased rows"* |
| 6 | A 20,000-row file imports without the browser running out of memory | **Pass** | `TEST` — *"the row cap is 20,000 in the parser **and in the commit function alike**"* |
| 7 | **Normalisation has unit tests** | **Pass** | `TEST` — four, including the ported ZIP corrections |

### Criterion 7 names its own artifact, and the artifact had never run

The ticket asks for a port and then, pointedly, for the tests: *"Port it — including the Florida and
Tennessee zip-prefix timezone corrections — and then **write the tests, of which there are currently
none**."*

They exist and they are the right ones — *"Florida and Tennessee split-zone ZIP corrections win over
source labels"*, *"normalizes ISO, Excel, and d-mmm-yy dates"*, *"preserves ZIP leading zeroes"*.

They are also the file that **had never executed**. `lib/agentTemplates/importNormalization.test.mjs`
was one of four files recorded in the SA audit as failing to load — `lib/agentTemplates/csv.ts`
imported through the `@/` alias, which the test runner does not resolve, so the whole file errored and
was counted as a single failing test rather than the tests it contains. Criterion 7's artifact existed
and proved nothing until that import was fixed. It runs now, with 23 tests across those four files
where the suite previously counted 4 failures.

### Criterion 4 is the one the ticket cared most about

*"The commit is not transactional. The existing plan document names a half-imported list as a risk to
mitigate, and the implementation produces exactly that — a failure part-way leaves an unknown number
of rows in, with no way to tell which."*

The rebuild stages the file and promotes atomically, and the tests assert the shape rather than the
outcome: the preflight **writes no leads**, the commit is a **separate call**, it is **one
transaction**, and a review cannot be applied to a different file than the one reviewed. That last one
is the subtle half — an atomic commit of the wrong file is still atomic.

*"A number is screened once per file, and the commit reuses the answer"* is worth noting too: it
satisfies LA-2.3's hard gate without paying for the same scrub twice, which is the credit LA-2.19
would otherwise be reconciling.

---

## A test that asserted the product should misbehave

`verify:lead-import` reported one failure:

```
FAIL a second tenant cannot import into the first tenant — status 201
```

That reads like a cross-tenant write, and it is not one. Both fixture tenants are given the **same
plan and entitlement**, both are seeded with the **same default pipelines** (LA-1.9 criterion 6), and
the lead template is platform-wide. A second tenant importing its own file is ordinary operation, and
`201` is the correct answer — every read and write in the import route is scoped to
`auth.context.tenantId`, so it cannot reach another tenant's data.

The check's **name** describes a true property — B must not import into A. Its **assertion** demanded
something else: that B's import be refused. Those are not the same claim, and the one it tested is
wrong about what correct looks like.

It passed until now for an incidental reason — whichever of entitlement, pipeline or template tenant B
happened to lack — and started failing the moment the fixture gave B a complete setup.

Rewritten to measure the property its name always claimed: tenant A's lead count either side of B's
import, and B ending up with the row. It now reads *"a second tenant's import lands in its own tenant
and never in the first"* and passes for the right reason.

This is the second test in the audit that could not have failed correctly — after
`verify-partners.mjs` asserting `<= 1` where it meant `=== 1` — and the inverse of it: that one was
too weak to fail, this one was wrong about what passing meant.

---

## Suite state

`npm test` — **714 tests, 714 passing, 0 failing** (up 3: the attribution-chain guard). `typecheck`
clean. `verify:lead-import` green after the correction.

---

## LA-2.3 · Suppression & scrub engine — hard gate — **Pass** (6 of 6)

**Goal:** no number is ever dialed without having been checked against every suppression list, and the
check is enforced where it cannot be bypassed.

This was *"the highest-priority task in the module"*, and the finding behind it is the most alarming
in the sprint:

> ⚠️ *"`lib/dncCheck.ts` — **415 lines that scrub federal DNC and TCPA litigators against two live
> services — is imported by nothing.** Verified by grep: the only references to it are inside itself.
> The outbound module has its own small internal suppression list and **never checks the federal
> registry at all**, while shipping a working scrubber that nothing calls. A dialer working purchased
> lists with no federal DNC scrub is \$500–\$1,500 per call of exposure, with the fix already
> written."*

**`lib/dncCheck.ts` no longer exists.** The dead scrubber was not re-wired; it was replaced, and the
replacement is reached from the paths that matter.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A campaign that has not been scrubbed serves **zero** leads, and the dialer explains why | **Pass** | `TEST` — *"only a scrubbed, active campaign is servable — **the gate is the view, not a badge**"*; `SRC` — the dialer's status line carries the reason |
| 2 | A litigator hit is **never servable under any code path** — asserted by test | **Pass** | `TEST` — *"a litigator hit outranks every other list, so it can never be hidden behind one"* |
| 3 | "Do not call" adds the number **permanently**, and a later import of it is rejected at scrub | **Pass, both halves** | `TEST` — *"the internal do-not-call list cannot be deactivated, deleted or repointed"*; `SRC` — the import applies *"the same precedence `is_phone_suppressed` uses"* and writes `list_type: "internal"` |
| 4 | A vendor outage **blocks** dialing rather than passing numbers through | **Pass** | `TEST` — *"a screening outage blocks the dial instead of letting the number through"*, and *"the import treats an outage and a definite hit differently"* |
| 5 | Re-scrubbing a campaign suppresses numbers added to a registry since import | **Pass** | `TEST` — *"a campaign can be re-scrubbed, which is how a list that has aged gets re-checked"* |
| 6 | Every check appears in the audit record with its raw response | **Pass** | `TEST` — *"every screening check is audited with the vendor's raw response"* |

### Criterion 1's test is named after the rule, which is why it is convincing

*"Only `scrubbed` campaigns serve leads. **Not a badge, not a warning** — the queue returns nothing."*

The test is called *"only a scrubbed, active campaign is servable — the gate is the view, not a
badge"*. Enforcement is a **view** that serving reads, so an unscrubbed campaign is not filtered out
downstream — it is not in the set at all. A badge would have satisfied a weaker reading of the
criterion and left the queue serving.

Criterion 2 is enforced by precedence rather than by a separate check: a litigator hit **outranks**
every other list inside `is_phone_suppressed`, so it cannot be masked by a lower-priority answer. That
is the same strict-precedence rule LA-1.5 sets for screening, applied to suppression.

Criterion 4 distinguishes two things most implementations conflate: an outage and a definite hit.
Treating "we could not check" as "not on the list" is exactly the \$500–\$1,500 exposure, and the
import is asserted to tell them apart.

Criterion 3's ordering detail is worth recording because it is easy to get backwards: the suppression
is written **after** the commit, *"so a failed commit cannot leave a suppression for a lead that was
never imported"*. The permanent list is the one thing that must not accumulate phantom entries.

---

## LA-2.4 · Calling-window engine — **Pass** (6 of 6)

**Goal:** one function answers *may I dial this person right now*, and the queue simply does not serve
a lead when the answer is no.

What it replaced was two constants:

```ts
export const DIAL_WINDOW_START_HOUR = 9;
export const DIAL_WINDOW_END_HOUR = 20;
```

*"Every state, every day, no exceptions… **no state table, no day-of-week check, no holiday calendar
exists anywhere in the module.** For an agent licensed in fourteen states that is real exposure."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A hand-crafted API request for a lead outside its window returns **nothing** | **Pass** | `TEST` — `serve_next_lead`'s body is asserted to call both `is_phone_suppressed(` and `tenant_can_dial_now(`, so enforcement is inside the function the API calls |
| 2 | A state with a tighter statute is enforced over the federal default | **Pass** | `TEST` — *"a tighter state statute is enforced over the federal default"* **and** *"a state rule that tries to be LOOSER than federal is ignored"* |
| 3 | Sunday and holiday rules are honoured **per state** | **Pass** | `TEST` — *"a state that forbids Sunday calls refuses one inside the hours"*, *"the same Sunday is fine in a state without the rule"*, *"a state holiday is refused, and a federal one applies everywhere"* |
| 4 | Correct across a DST boundary **and in `America/Phoenix`**, which does not observe DST | **Pass** | `TEST` — three cases, see below |
| 5 | Tenant settings can narrow the window and **cannot widen it** | **Pass** | `TEST` — *"a wider candidate cannot widen — this is the whole safety property"*, plus commutativity and the narrowed-to-nothing case |
| 6 | The dialer **never shows an enabled action** on a lead it may not legally dial | **Pass** | `SRC` — see below |

### The narrowing algebra is tested as an algebra

*"The effective window is always the most restrictive of these. **Widening is not expressible.**"*

Rather than testing a few combinations, the suite tests the operation's properties: `narrow` takes the
later start and the earlier end; a wider candidate cannot widen; **narrowing is commutative, so layer
order cannot change the answer**; and a window narrowed out of existence permits nothing. That last
pair is what makes five stacked layers safe — federal, state, holiday, tenant, campaign can be applied
in any order and cannot produce a wider window than any one of them allows.

### Criterion 4 is tested where timezone code actually breaks

Three distinct traps, each with its own case:

- **`America/Phoenix` does not observe DST**, so the same UTC hour moves relative to New York across
  the year — and *"07:00 in Phoenix is refused in both January and July — the rule does not drift with
  DST"*;
- across the spring-forward boundary *"the answer follows the wall clock, not the offset"*, which is
  the two-pass resolution the ticket asked to port — *"the offset depends on the instant, and the
  instant is what we are solving for"*;
- the window is **half-open**: *"21:00 local is outside — 9pm is already too late"*.

And the in-scope rule that a missing state is not a default: *"a lead with no state is refused, never
defaulted to Eastern"*, with an empty or whitespace state treated the same and an unknown state
*"refused rather than guessed"*.

### Criterion 6 is the legacy defect the ticket names, and it is fixed

> *"The current dialer breaks its own rule in one place: outside the window it shows a red chip and
> **leaves every button enabled**."*

It no longer does. Both `Prepare call` and `Start call` carry `disabled={… || !eligibility?.allowed}`,
the primary button's **label changes to "Dialing blocked"** rather than staying "Start call" and doing
nothing, and a `role="status"` line gives the reason — the server's own message when it has one.

That is the same pattern as the sanctioned disabled-with-reason control I had to apply to the Agent
Floor's Listen-in button, and here it was already right. The distinction the ticket draws is honoured
too: the server enforces in `serve_next_lead`, and the UI only explains — *"a compliance rule checked
solely in the browser is a rule that stops applying the moment anything else calls the API."*

---

## Suite state

`npm test` — **714 tests, 714 passing, 0 failing**. `typecheck` clean. Neither task needed a product
fix or a new guard: the 38 unit tests across the calling-window and suppression modules cover every
criterion, and the four independent checks I ran — the dead scrubber's absence, the import's
suppression precedence, the serving function's filters, and the dialer's disabled controls — agreed
with them.

---

## LA-2.5 · Real-time lead post API & speed-to-lead — **Pass** (5 of 6; the fifth-second budget unmeasured)

**Goal:** a lead posted by a vendor is scrubbed, queued at the top and on Ray's screen within seconds —
while the person is still on the website.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A posted lead is on screen in **under 5 seconds end to end**, including the scrub | **Unmeasured here** | The path has never run on this project — see below |
| 2 | A litigator or duplicate is rejected with a **specific reason code the vendor can act on** | **Pass** | `TEST` — *"a posted lead is rejected with a reason code a vendor can act on"*; `SRC` — a closed twelve-value `PostReasonCode` union |
| 3 | Real-time leads are served **ahead of every list lead regardless of scoring** | **Pass** | `TEST` — *"real-time leads outrank list leads **before scoring is consulted**"*; `SRC` — `tier: 0` with the comment *"ahead of every list lead, regardless of scoring. This is the criterion."* |
| 4 | Speed-to-lead is computed **per vendor** and visible | **Pass** | `TEST` — *"speed to lead is computed per vendor over its own leads, not averaged from campaigns"*, *"the vendor page actually reads speed and consent coverage"* |
| 5 | A vendor hammering the endpoint is rate-limited **without dropping legitimate posts** | **Pass** | `TEST` — *"a vendor hammering the endpoint is limited **per key**, not globally"*, which is the "without dropping legitimate posts" half |
| 6 | A scrub-vendor outage **rejects** rather than accepting unscrubbed | **Pass** | `SRC` — the file's own header rule; `TEST` — LA-2.3's *"the import treats an outage and a definite hit differently"* |

The module's two governing rules are written at the top of `lib/leadPost/service.ts` rather than left
implicit, and both are criteria here:

> *"**REJECTIONS ARE THE BILLING MECHANISM.** A litigator hit or a duplicate returned as a rejection is
> a lead the tenant does not pay for. So every exit from this function records a `reason_code` from a
> closed vocabulary, and the log keeps the raw payload — that row is what a vendor's invoice is
> disputed against."*
>
> *"**THE SCRUB FAILS CLOSED.** An accepted lead is one somebody will dial, so an unscrubbed acceptance
> is a \$500–\$1,500 exposure that arrives looking like a normal lead. Rejecting costs one lead;
> accepting costs a lawsuit."*

Criterion 4's test is precise in a way that matters: speed-to-lead is computed **over a vendor's own
leads**, not averaged from its campaigns — averaging an average is the classic way this figure comes
out wrong — and *"a vendor with no real-time posts shows **no speed** rather than zero seconds"*. A
zero there would read as instant dialling rather than as no data, which is the same falsehood this
audit found in the SA revenue funnel.

### Criterion 1 cannot be measured because the path has never carried a lead

```
agent_leads with posted_at set : 0 of 214,819
```

Every lead on this project arrived through the LA-1 partner path. The post endpoint, its keys, its
rate limit and its reason codes are all implemented and unit-tested, and **no vendor has ever posted
to it here**, so the five-second budget has nothing to measure. Recorded as unmeasured rather than
passed: the parts I can check are right, and end-to-end latency including a live scrub is not one of
them.

This is the same shape as LA-1.19's caps and LA-1.17's banking mask — correct, tested, and waiting for
its first production exercise.

---

## LA-2.6 · Consent artefact capture — **Pass** (4 of 6); nothing triggers the claim

**Goal:** for every purchased lead, we hold the evidence that this person asked to be contacted — and
can produce it in one click.

The stake is specific: a TrustedForm or Jornaya certificate is *"the exact thing a regulator or a
plaintiff's lawyer asks for, and **purchased lists are where complaints come from**."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A certificate is **claimed and stored within the provider's expiry window** | **Partial — the claim is implemented and nothing triggers it** | `SRC` + `DB` — see below |
| 2 | Certificate presence and **age** are visible on the lead before it is dialed | **Pass** | `SRC` — the dialer panel's `Consent` type carries `hasCertificate`, `provider`, `status`, `capturedAt`, `consentTimestamp` and **`ageDays`** |
| 3 | Coverage per vendor is reported as a percentage | **Pass** | `TEST` — *"the vendor page actually reads speed and consent coverage"* |
| 4 | A lead with no certificate is **flagged, not suppressed** | **Pass** | `TEST` — *"a lead with no certificate is flagged, not suppressed"*; `SRC` — the capture comment says *"Flagged, never blocking: many legitimate lists have none"* |
| 5 | The stored copy survives the provider link expiring | **Partial — depends on criterion 1** | `SRC` — `stored_copy` is written **only** by the claim |
| 6 | Certificates are included in a data export | **Pass** | `TEST` — *"consent certificates are included in the lead export"* and *"the export keeps its old shape when no consent evidence is requested"* |

### The capture half is right, and it understands the problem

`captureConsentArtefact` runs on every post and on import, and writes `capture_status: "pending"` with
a comment that states the distinction exactly:

> *"`pending` rather than `claimed`: we have a URL, not a copy. An unclaimed TrustedForm certificate
> expires."*

`claimConsentCertificate` is also correct: idempotent (an already-claimed artefact returns early rather
than re-claiming), metered against the plan's `consent_cert_claims` allowance, and it writes
`stored_copy` — the copy that outlives the provider's link.

### What is missing is anything that calls it

```
callers of /api/app/compliance/consent/claim  : none — no UI action, no job, no scheduler
tenant_consent_artefacts                      : 0 rows
```

The endpoint exists and nothing in the product reaches it. A captured certificate would therefore sit
`pending` until the provider's link expires, and `stored_copy` — the whole point of criterion 5 —
would never be written. That is precisely the failure the capture comment names.

**It is latent, not live:** no artefact has ever been captured, because the post path has never run and
no imported list has carried a certificate. And the damage is bounded in a way worth recording,
because I checked it rather than assuming: presence and flagging do **not** depend on the claim.
`hasCertificate` is `Boolean(certificate_id || certificate_url)`, so criteria 2, 3 and 4 keep working
on a `pending` artefact — nothing reports a false zero, which is the failure mode I expected to find.

**I have not fixed it**, and the reason is that the fix is a product decision rather than a missing
line. Claiming can hang off the capture itself, a button on the lead, or a scheduled sweep before
expiry — and they differ in cost, because each claim is metered against a plan allowance. Wiring one
in without that decision would spend a customer's credits on a schedule nobody chose. It is recorded
here as the one open item in LA-2.6.

This is the third instance in the audit of an implemented capability with nothing driving it —
`roleCanViewCommission` with no callers (LA-0.2), `deal_flow.campaign_id` with no writer (LA-2.1), and
now the consent claim with no trigger. In each case the code is right and the wiring is the gap.

---

## Suite state

`npm test` — **714 tests, 714 passing, 0 failing**. `typecheck` clean. No product change this pair:
LA-2.5's open criterion needs production traffic, and LA-2.6's needs a decision about when to spend a
metered claim.

---

## LA-2.7 · Cadence & retry engine with slot rotation — **Pass** (5 of 6); the sixth contradicts its own ticket

**Goal:** a lead that does not answer is tried again at a sensible interval, **in a time slot it has
not failed in yet**, until a configured ceiling.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A lead is **never** retried into a slot it has already failed in, while an unused slot remains | **Pass** | `TEST` — *"a lead is never retried into a slot it has already failed in"*, *"four attempts produce four different slots, not the same one four times"*, *"a preferred slot is honoured only while it is unused"*, and *"once every slot is used, rotation falls back rather than refusing to call"* |
| 2 | Cadence rows can be added, edited and deleted, per campaign | **Pass** | `TEST` — *"a disposition-specific row beats the catch-all for the same attempt"*; the rules are data, not a fixed three-row matrix |
| 3 | An invalid interval is **rejected at entry**, not sent to the database | **Pass** | `TEST` — *"banana is rejected at entry rather than sent to Postgres"*, plus empty, zero, negative, and *"a Postgres interval we cannot read at a glance is refused too"* |
| 4 | A lead hitting the ceiling moves to nurture and stops being served | **Pass** | `TEST` — *"hitting the ceiling returns exhausted, **not a date far in the future**"* |
| 5 | Changing a cadence affects the next lead served, with no deploy | **Pass** | `TEST` — *"a custom cadence takes effect immediately — no deploy, no cached table"* |
| 6 | Attempts are front-loaded — **five of seven** fall within the first 72 hours on the default | **Unmet as worded; the specification contradicts itself** | `TEST` — see below |

Criterion 1 is the promise the ticket says nobody kept: *"The existing retry rule says '+4 hours in a
different time slot'. The dialer's hint text says 'Retry tomorrow, different slot'. **Nothing in the
codebase implements slot diversity.** It is described in two places and built in none."* It is built
now, and tested in all four directions — rotation happens, it prefers unused slots, it respects the
legal window (*"a preferred slot outside the window is ignored rather than scheduled"*), and it
**falls back rather than refusing to call** once every slot is used.

That last one was a real defect, found by a later regression run and fixed: *"the cadence proposes the
same slot forever"*, which the suite now pins as *"the serving query can no longer deadlock when every
slot has been used"*.

Criterion 3's rejection list is worth noting for what it adds beyond the ticket. The ticket asks that
`banana` not reach Postgres; the tests also refuse empty, zero, negative, **and a syntactically valid
Postgres interval that a reader cannot understand at a glance**. The last is a judgement the criterion
does not require and is right: an interval nobody can read is a cadence nobody can audit.

### Criterion 6 is arithmetically impossible against the ticket's own table

The ticket gives both a default table and a criterion, and they do not agree:

```
+2h, +1d, +1d, +2d, +3d, +5d   →  cumulative 0, 2h, 26h, 50h, 98h, 170h, 290h
                                   four attempts inside 72 hours; the fifth lands at 98h
```

I checked the arithmetic independently before accepting the test's claim, and it is right: the table
produces **four**, and the criterion asks for five.

What the implementation did with that is the part worth recording. It follows the **table**, and says
so in the test name — *"the default cadence is front-loaded, but lands FOUR of seven in 72 hours, not
five"* — with the reasoning written out:

> *"Asserted as it actually is rather than adjusted to make the criterion pass: the table and the
> criterion are both in the specification and they disagree, and quietly changing the table to satisfy
> the checkbox would hide that from whoever has to decide."*

A companion test proves a conforming cadence **is** expressible — *"if that is the decision"* — so the
engine is not the constraint. The substance of the criterion is met either way: four of seven inside
three days, against a production default of +4h/+1d/+3d.

**This needs a product decision, not a code change**: tighten the table, or correct the criterion. It
is the only criterion in either module where the specification is self-inconsistent, and the
implementation handled it in exactly the way this audit has been asking of everything else — by
refusing to make a checkbox true at the cost of making a document silently wrong.

---

## LA-2.8 · Lead queue & serving — **Pass** (5 of 6); the 200ms budget cannot be measured here

**Goal:** Ray presses "next" and gets exactly one lead, legally dialable, that nobody else is working,
in the right order.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Two agents pressing next simultaneously **never receive the same lead** | **Pass** | `SRC` — `for update skip locked` in the serving query; `TEST` — the serve route is POST-only *"so a prefetchable GET would take leads out of circulation and hand two agents the same one"* |
| 2 | A lead outside its window is **never served, under any request** | **Pass** | `TEST` — `serve_next_lead`'s body must call `tenant_can_dial_now(` and `is_phone_suppressed(`, so enforcement is inside the function the API calls |
| 3 | An abandoned lock returns the lead to the pool after the timeout | **Pass — after a defect found by regression** | `SRC` — see below |
| 4 | A real-time lead is served ahead of everything within seconds of arriving | **Pass** | `TEST` — *"real-time leads outrank list leads before scoring is consulted"* |
| 5 | Serving is under **200ms with 100,000 eligible leads** | **Not measurable on this project** | See below |
| 6 | The empty state explains itself rather than showing a blank panel | **Pass** | `TEST` — *"an empty queue explains itself, **and the wording comes from the server**"* |

Criterion 6's test carries the better half in its second clause. The ticket says *"the existing code
gets this right — keep the copy"*, and the test asserts the copy comes from the **server**, so the
dialer cannot invent a different explanation for a decision it did not make. That is the same
separation LA-2.4 insists on: the server decides, the UI explains.

### Criterion 3 was broken in a way that looked fine

A migration named `la_2_8_2_9_two_defects_found_by_regression.sql` records it, and the diagnosis is
worth quoting because the failure was invisible:

> *"The reclaim at the top of `serve_next_lead` does return the WORK ITEM: status goes back to
> `unclaimed`, the lock is cleared… The lead itself is left in `lead_state = 'working'`, and no tier
> in `serve_next_lead` matches a working lead. So the work item sits in the queue, visible,
> unclaimed, and permanently unservable. **An agent who claims a lead and walks away does not release
> it back to his colleagues; he destroys it, quietly**, and the queue reports itself as having work it
> will never hand out."*

The fix restores the lead as well as the work item, and distinguishes the two cases properly: a lead
nobody dialled returns to `fresh`, one with attempts returns to `retry` due immediately, *"because the
abandoned call is not an attempt"*.

The header's own lesson is the sharpest statement of this audit's recurring theme that I have read
anywhere in the repository:

> *"a green suite is evidence about the run, not about the code, and both of these went green on
> fixture state rather than on behaviour."*

### Criterion 5 has a harness, and running it here would be the wrong thing

`scripts/bench-serve-next-lead.mjs` exists specifically for this, and it is well built: p95 rather
than a mean *"because a mean hides the tail, and the tail is what an agent actually experiences"*, and
an `explain (analyze, buffers)` alongside, *"because a pass that relies on a warm cache is not a
pass"*.

It **refuses to run without `--i-have-a-disposable-project`**, and this project is not one — it holds
214,819 leads and the fixtures every other suite depends on. Its own safety note explains the second
reason not to force it: serving **claims and locks** work items, and *"a benchmark that locks a
working agent's queue for fifteen minutes is a denial of service on your own floor."* For the same
reason I did not call `serve_next_lead` directly to take a smaller measurement.

What I could check safely is the structural half, and it holds: `lead_queue_serving_idx`,
`lead_queue_tier_idx`, `agent_leads_retry_due_idx` and `tenant_campaigns_serving_idx` all exist, so
the query has the indexes the criterion depends on.

Recorded as **not measurable here** rather than passed or failed. A prior QA document in this
repository notes ~388ms at 1,000 queued leads and marks the criterion UNVERIFIED; I have not
reproduced that figure and do not carry it as a finding, but it is the reason this criterion deserves
a real run on a disposable project before anyone calls it done.

---

## Suite state

`npm test` — **714 tests, 714 passing, 0 failing**. `typecheck` clean. No product change this pair:
LA-2.7's open criterion is a contradiction in the specification, and LA-2.8's needs a disposable
project to measure.

---

## LA-2.9 · Click-to-call dialer & dispositions — **Pass** (6 of 6)

**Goal:** one lead at a time, everything needed to have the conversation, and one press to record what
happened.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | **No enabled action** exists on a lead that may not legally be dialed | **Pass** | `SRC` — both `Prepare call` and `Start call` carry `disabled={… \|\| !eligibility?.allowed}`, the label becomes *"Dialing blocked"*, and a `role="status"` line gives the server's reason (recorded in full under LA-2.4 criterion 6) |
| 2 | The header shows the **customer's** local time, correctly across DST | **Pass** | `SRC` — `localTime()` uses `formatInTimezone` with the zone from `stateFromLeadValues`, the same helpers LA-1.22's tests prove across a zone boundary and a DST change; `TEST` — *"the served lead shows its tier and the server's reason"* |
| 3 | Every disposition schedules or terminates the lead — **none leaves it in limbo** | **Pass** | `SRC` — the migration section is literally headed *"one disposition, one outcome, never limbo"*, and the work item is released either way: `unclaimed` when the lead goes to retry, `completed` otherwise, because *"a lead left `claimed` after a disposition is the limbo"* |
| 4 | A disposition with **no click** is flagged in the log | **Pass** | `TEST` — *"a disposition with no click is still flagged"* |
| 5 | **No metric labelled talk time** is displayed | **Pass, by absence and by guard** | `TEST` — *"no metric labelled talk time is displayed anywhere"*; `SRC` — see below |
| 6 | Keyboard-only operation for the whole loop — dial, disposition, next | **Pass** | `TEST` — *"the whole loop is operable from the keyboard"*; `SRC` — keys 1–7 choose a disposition, N serves the next lead |

### Criterion 5 passes by absence, and the migration insists on saying so

The ticket's warning is specific: *"The existing `call_duration_seconds` measures **how long the lead
card was open**, not how long anyone talked — so every talk-time figure on the current Reports page is
wrong."*

The migration refuses to tick the box quietly:

> *"Criterion 5 PASSES BY ABSENCE, and it is worth writing down why rather than ticking it.
> `call_duration_seconds` exists on `lead_dispositions` and `outbound_dispositions`, both
> organizations-plane, and **no application code reads either**. The only duration the agent app
> renders is `durationSince(item.startedAt)` in agent-floor.tsx, which is a live timer on an open
> call computed in the browser, not a stored figure and not labelled talk time. So the wrong number
> the task warns about is not on screen — **but the columns that would produce it are still there,
> and anyone wiring a report from them would reintroduce it.**"*

That is the same shape as LA-1.9's `stage_key`: a column nothing reads, harmless today, loaded. The
difference is that here a test guards the display side — *"no metric labelled talk time is displayed
anywhere"* — so reintroducing it fails the suite rather than the next reader.

The telephony seam is handled the same way: `provider_call_id` is nullable **from the start**,
because *"leaving the column out until one arrives would mean migrating a table that by then has
history in it"*, and a test pins that *"the seam for a telephony provider is still open"*.

---

## LA-2.10 · Callback scheduling — **Pass** (6 of 6)

**Goal:** the most common productive outcome of an outbound call is a promise to call back. Keeping
that promise, at the right moment, in the right timezone, is the whole task.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A callback set for "2pm Thursday" fires at 2pm in the **customer's** timezone, across a zone boundary | **Pass** | `TEST` — the LA-1.22 suite's *"the same customer-local time becomes different UTC instants across a zone boundary"* and *"the same wall-clock time converts differently across a DST boundary"*, shared implementation |
| 2 | Booking outside the legal calling window is **rejected with a clear reason** | **Pass** | `TEST` — *"the callback window check is patched into the live booking paths, not just written"*; `SRC` — `assert_callback_in_window` |
| 3 | Booking **in the past** is rejected | **Pass** | `SRC` — `if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'`, in every creation and transition RPC |
| 4 | A due callback appears at the top of the queue | **Pass** | `SCRIPT` — *"a due callback appears on the Agent Floor, and a future one does not"*; the callback tier is tier 2 in the serving order |
| 5 | Overdue callbacks are visible and **counted separately** | **Pass** | `SCRIPT` — *"overdue callbacks remain visible and separately counted"* |
| 6 | There is **one** callback implementation shared with LA-1.22, not two | **Pass, with a recorded caveat** | `SRC` — see below |

### Criterion 2's migration separates a real hole from an imagined one

The ticket names two holes. The migration checked both rather than fixing both:

> *"**REAL** — Nothing validates the booked time against the calling window. An agent can promise to
> call back at 03:00 and the system will schedule it, queue it, and hand it to somebody to dial.*
> *"**CLOSED** — 'An agent can book … for last March.' Not on this plane:
> `complete_disposition_with_callback` and `reschedule_callback` both already raise
> `CALLBACK_DATE_PAST`. LA-1.22 fixed it; the task page describes the organizations-era version."*

Two decisions in it are worth keeping. The check went into **the RPCs rather than the service**,
*"because a compliance rule enforced only in TypeScript stops applying the moment anything else calls
the API — and both of these are reachable directly with the service role"* — the same principle
LA-2.4 and LA-2.8 are built on.

And the subtlety that decides whether the rule is usable at all:

> *"The window is evaluated **AT THE BOOKED INSTANT**, not now. 'Thursday 2pm' must be legal on
> Thursday at 2pm in the customer's zone; whether it happens to be legal at the moment of booking is
> irrelevant and would reject most evening bookings made in the morning."*

A naive `canDialNow(now)` would have passed a review, satisfied the criterion's wording, and made the
feature unusable for exactly the bookings agents make most.

### Criterion 6 is true of this product, and the exception is recorded rather than hidden

One table, one management service (`lib/callbacks/service.ts`), one timezone helper, and both entry
points — LA-1.22's inbound disposition and LA-2.10's outbound one — converge on
`complete_disposition_with_callback`. There is no second implementation.

There are, however, literally two sets of functions, and the migration says so rather than claiming a
clean sweep:

```
[CRM]    reschedule_callback(target_callback_id, target_scheduled_at, target_note)
[tenant] reschedule_callback(p_tenant_id, p_callback_id, p_actor, p_callback_local)
```

The `target_*` overloads take no tenant id, write the organizations-era `callbacks` table, and belong
to the legacy CRM — left alone under the SA-3 rule about not touching that product's tables. The
signatures differ in arity **and** parameter names, so PostgREST cannot resolve one when the other was
meant. The note ends: *"criterion 6 asks for one callback implementation and there are literally two —
they just belong to different products."*

That is the right way to report a criterion that is satisfied in substance but not literally, and it
is the opposite of the pattern this audit keeps correcting elsewhere.

---

## Suite state

`npm test` — **714 tests, 714 passing, 0 failing**. `typecheck` clean. Neither task needed a product
fix: every criterion had evidence, and the four things I checked independently — the dialer's disabled
actions, the customer-local-time helper, the past-booking exception and the single callback service —
agreed with it.

---

## LA-2.11 · Appointment calendar & availability — **Pass** (6 of 6), **after two fixes**

**Goal:** Ray's calendar knows when he is available, and anything booked into it is real.

Scored twice. Read against the SQL, five of six criteria pass and the sixth is a caveat. Measured
against the running system, **three of them could not fire at all** — and the reason is one thing.

### The finding: three tables with two readers and no writer

`tenant_agent_availability`, `tenant_agent_blocks` and `tenant_agent_booking_policy` shipped with the
LA-2.11 migration. `DB` — measured on the live project, **0 rows in all three**. `SRC` — the only
references anywhere in `app/`, `lib/`, `components/` or `scripts/` are two *reads*:
`bookableContext` and the reminder job. **Nothing in the product wrote any of them**, and there was
no route, no screen and no seed that could.

That is not a cosmetic gap, because every rule that reads them is written to skip itself when its row
is missing:

```
book_appointment   select av.timezone into v_zone ... limit 1;
                   if v_zone is not null then   <- the working-hours check AND the blocked-time
                                                   check are both inside this branch
                   if v_policy.max_per_day is not null then   <- the daily cap is inside this one
```

So on every tenant in the database:

| What the ticket asks for | What actually happened |
|---|---|
| "No appointment outside Ray's availability" (C2) | the branch never ran |
| "The daily cap is enforced server-side" (C3) | the branch never ran |
| "Reminders fire in the right timezone for each recipient" (C6) | the agent's zone fell back to `"UTC"`, labelled as his |
| LA-2.12 C6, "the roster shows each setter's local time" | `tenant_member_roster` INNER JOINs availability — **0 rows for every tenant** |
| LA-2.12's booking flow | `bookableContext` builds its agent list from availability rows, so the dialer's booking card rendered for nobody |

**One missing editor, five criteria.** Every piece of SQL enforcing them was correct, reviewable, and
unreachable — which is why nothing caught it: a test that reads the migration passes, and so does a
test that reads the route.

### The fix

`components/app/calendar-availability-settings.tsx`, `app/api/app/availability/route.ts` and
`lib/appointments/availability.ts` — a **Calendar & availability** tab under Settings: working hours
per weekday with the member's timezone, blocked time, and appointment length / buffer / daily cap.
Owners configure the team's calendars; anybody else with `calendar.manage` configures only their own,
because rewriting a colleague's hours changes when leads can be booked with them.

Two decisions in it are worth recording:

- **Write order is a safety property here, not a detail.** Every rule fails *open* when its row is
  missing, so a half-applied save that deleted before inserting would leave the agent bookable at any
  hour. Each collection is written before anything is removed; the failure that remains — stale rows
  surviving a failed delete — leaves the calendar *more* restrictive, not less.
- **The empty state says what an empty week does**: *"No hours set. Until they are, an appointment can
  be booked at any time of day that is legal for the customer, and Demo Agent will not appear in the
  roster or in the dialer's booking panel."* The whole defect was invisible because nothing said so.

### Per criterion, re-measured live after the fix

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Two setters on the same slot: one succeeds, one is told it went | **Pass** | `DB` — booked Mon 11:00, then Mon 11:15 gave `APPOINTMENT_SLOT_TAKEN` from the GiST exclusion constraint; Mon 12:00 booked fine. `SRC` — `exclude using gist (tenant_id with =, agent_user_id with =, tstzrange(starts_at_utc, ends_at_utc, '[)') with &&) where (status in ('booked','confirmed'))` |
| 2 | Nothing outside Ray's availability or the customer's legal window | **Pass, after the fix** | `DB` — Mon 03:00 NY gave `APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW`; Mon 19:00 NY (18:00 for a Texan, legal for *them*) gave `APPOINTMENT_OUTSIDE_AVAILABILITY`. The second refusal **was not reachable before this session** |
| 3 | The daily cap is enforced server-side | **Pass, after the fix** | `DB` — cap set to 2, third booking of the day gave `APPOINTMENT_DAILY_CAP_REACHED`. Counted in the agent's own day, not UTC's |
| 4 | An appointment appears in the queue when due, with the setter's notes | **Pass** | `SRC` — tier 3 of `serve_next_lead`, and `v_notes` is selected for `v_priority = 3` and returned as `appointment_notes` |
| 5 | Rescheduling frees the old slot atomically | **Pass** | `SRC` — the old row is moved to `rescheduled` (out of the constraint's `where` clause) **first**, in the same transaction, so a reschedule can never collide with itself and a failed rebooking rolls back holding the original slot |
| 6 | Reminders fire in the right timezone for each recipient | **Pass, and now true** | `SRC` — per-recipient rendering with recipient-level evidence rows and idempotent claiming. The agent's zone comes from availability, so before the fix it was `"UTC"` for everyone |

### Gaps recorded, not criteria

- **`buffer_minutes` is stored, surfaced to the slot picker, and enforced by nothing.** The exclusion
  constraint compares `[start, start + duration)` with no buffer, so two back-to-back appointments
  commit. The editor offers the field and says this out loud rather than implying it works.
- **No day or week calendar view, and no "today's list" on the dashboard.** Both are in LA-2.11's
  *Views* scope; neither is an acceptance criterion. `/app/appointments` is LA-0.5's **carrier**
  vault, a different meaning of the word.
- **Customer reminders do not check consent.** The scope line is *"to the customer, if there is
  consent and a channel"*; the code checks the channel (an email address) and not the consent, though
  `tenant_consent_artefacts` and `consentForLeads` both exist.

---

## LA-2.12 · Setter role & booking workflow — **Pass** (6 of 6), **after the role could reach its own surface**

**Goal:** an unlicensed setter works the queue, qualifies people, and books them onto Ray's calendar.

### The finding: a setter could not open the dialer

`permissions.ts` has granted `setter` the `dialer.use` capability since the role was added, with the
absences written out as the specification. Every route under `app/api/app/dialer/` — nine of them —
admitted `["owner", "producer"]`. `app/app/(shell)/dialer/page.tsx` did the same.

The booking panel lives **inside** that dialer. `/api/app/appointments` admits setters deliberately,
with a comment calling it *"the single route where the setter is the primary user rather than a role
being kept out"* — and the only way to reach it was through a page that answered 403.

So the ticket's flow —

```
setter dials -> qualifies -> books a slot on Ray's calendar
```

— had no door, and the role table's first two *Can* lines, "work the outbound queue" and "record
dispositions", were not true of the product. The permission map and the routes were two copies of the
same statement, and they disagreed; `servedNotBrowsed.test.mjs` pinned the role list **by quoting the
route**, so the test agreed with the bug.

### The fix

Eight dialer routes, the page guard and the nav entry now derive from `dialer.use` rather than
re-listing roles. `rolesWith(permission)` was added to `permissions.ts` so the map is the single
statement. Three deliberate exclusions, each a line of the role table rather than an oversight:

| Withheld from a setter | The line it comes from |
|---|---|
| `/api/app/dialer/search` and the search box | "Cannot see other setters' leads" |
| "Interested — start application" | "Cannot sell, quote, or submit an application" |
| The ad-hoc DNC preflight | a setter dials what the queue serves, not numbers they bring |

Both UI controls are **withheld rather than shown-and-refused** — their routes already answer 403, and
an offered control that always fails is the dead end this audit has been removing elsewhere.

### Per criterion

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A setter gets 403 on any money, quoting or application route — **across every route** | **Pass** | `TEST` — *"a setter cannot reach any money, quoting or application route"* walks every route through a classifier rather than a hand-written list, and fails on an unclassified route, an unreadable role argument and a missing guard alike. The companion test asserts the **absences** in the permission map |
| 2 | A setter cannot see another setter's leads or scorecard | **Pass** | `SRC` — `getScorecard` decides scope from the caller's role and never from a parameter; `/api/app/leads` excludes setters entirely; the dialer's search path is now withheld too |
| 3 | Booking attaches the setter's notes and notifies Ray | **Pass, with one defect fixed** | `SRC` — the notification is written inside `book_appointment`, in the same transaction as the insert, keyed by `source_key`, and skipped when Ray books for himself. **Its link pointed at `/app/calendar`, which does not exist** — see below |
| 4 | Show-rate per setter from actual outcomes, not self-reported | **Pass, amended** | `SRC` — decision 12 supersedes the criterion's wording: activity near the slot infers `showed`, anything else becomes `pending`, pending is excluded rather than counted as a no-show, and **coverage travels beside the rate**. The amendment migration says why, and says it scored the original wording wrong |
| 5 | Setter seats count against the plan limit | **Pass** | `SRC` — and the fix is broader than the criterion: `tenant_invite_user_with_auth` checked `max_buffer_seats` for assistants and nothing for anyone else, so any tenant could invite unlimited seats from their own settings page. Written as a seat check for **every** role, *"because a limit that applies to one role and not the others is the bug again in a smaller costume"* |
| 6 | The roster shows each setter's local time | **Pass, after the LA-2.11 fix** | `DB` — with hours set, `tenant_member_roster` returns `local_label: "Tue 13:36"`, `on_shift_now: false` (Monday-only hours, measured on a Tuesday). Before the editor existed it returned **0 rows for every tenant**, because it INNER JOINs availability |

### Criterion 3's notification links to a page that does not exist

The hard half is right — the notify is inside the booking transaction, so there is no such thing as an
appointment nobody was told about. The link is `/app/calendar?appointment=<id>`, and there is no
`/app/calendar` route: the shell has `appointments` (LA-0.5's **carrier** vault — the same name
collision the LA-2.11 migration had to design around), `callbacks`, `dialer` and twenty-odd others,
and no calendar.

`supabase/migrations/20260922180000_la_2_12_booking_notice_links_somewhere.sql` repoints it at
`/app/leads/<lead_id>` — where the notes, the customer and the history already are, and where LA-2.11's
own reminder job already sends its notification. It rewrites the function's own source the same way the
original notify was inserted, so it cannot restate the booking rules or drift from them. **It parses
and is not applied**, for the same reason as the other unapplied LA-2 migrations.

---

## Guards added

`lib/appointments/calendarHasAWriter.test.mjs` — 7 tests, all mutation-verified in both directions:

- every calendar table the booking rules read can also be **written** (the defect, stated as a rule)
- the editor is reachable — route, settings tab, and the switch arm that renders it, because matching
  the *import* would pass on a file that imports it and renders nothing
- a member with no hours is told what that means
- the buffer is not claimed to do something it does not do
- every dialer route admits **exactly** `rolesWith("dialer.use")`, with `search` named as the one
  deliberate exception
- the page guard and the nav entry derive from the same permission
- a setter is not offered the two controls that would refuse them

`lib/dialerScripts/servedNotBrowsed.test.mjs` — the serving route's declared roles are now compared to
the permission map instead of being quoted from the route. Quoting the route is how the drift survived.

## Suite state

`npm test` — **726 tests, 726 passing, 0 failing**. `typecheck` and `eslint` clean.

Live state left behind: `Demo Agent` on the LA-1.25 demo tenant now has Mon–Fri 09:00–17:00
America/New_York with a 30-minute appointment, a 15-minute buffer and a cap of 8 — deliberately, so
these screens are demonstrable. Every appointment, notification and policy row created while proving
the four refusals above was deleted; `tenant_appointments` is back to 0 rows.

---

## LA-2.13 · Lead scoring & call sequencing — **Pass** (5 of 6), with one fix and one criterion that needs a percentile

**Goal:** the queue serves the lead most likely to answer right now, and can say why.

This is the best-built task in the module. Six migrations, five of them a single honest performance
chase with the measurements written into the headers, and a scorer whose purity is a design property
rather than a claim. One defect, and it is in the half nobody re-reads.

### The finding: "Why this lead?" was permanently empty

The dialer has a card titled *Why this lead?* — criterion 1's whole surface. It read:

```ts
db.from("outbound_scoring_decisions").select("selection_reason, served_at")
  .eq("tenant_id", …).eq("lead_id", …)
```

`outbound_scoring_decisions` is the **legacy CRM's** table, on the organizations plane. It is keyed
by `organization_id` and `prospect_id`, and has neither of the columns being filtered on. Measured
against the live database:

```
outbound_scoring_decisions   ERROR 42703 — column outbound_scoring_decisions.tenant_id does not exist
tenant_scoring_decisions     ok
```

So the query failed on **every call, for every lead, on every tenant** — and the error was swallowed:

```ts
selectionReason: selectionResult.error ? null : …
```

rendered as *"No selection explanation is available for this lead."* A permanent failure wearing the
clothes of an empty state, on the card whose only job is to answer the criterion. The comment above
it said the table was *"optional in older shared-project snapshots"* — a true sentence about a
different table, and the reason nobody looked twice.

The ticket's own warning is what makes this more than cosmetic: *"An agent who cannot see why the
machine chose this person will start ignoring the order — and then the feature is worse than
nothing, because it also removed his own judgement."*

**Fixed** in `lib/dialerScripts/service.ts`: it reads `tenant_scoring_decisions`, the table
`serve_next_lead` actually writes, and a failed lookup is now **raised** rather than rendered as an
absent reason. Only a genuinely missing relation is tolerated, because the panel is
compliance-gated and must still open on a snapshot without LA-2.13 applied.

`DB` — proved after the fix by inserting one decision row and running the panel's exact query:
`{"selection_reason":"fresh lead — QA fixture, LA-2.13 audit"}`. Row deleted afterwards.

### Per criterion

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Every served lead carries the reason it was chosen, in plain language | **Pass, after the fix** | `DB` — real reasons off the live scorer: `["attempt 1 of 7", "never tried in the late morning slot"]`, the exact register the ticket's example uses. The served-lead line always rendered it; the *Why this lead?* card never did |
| 2 | Scoring is a pure function of stored signals | **Pass** | `DB` — 50 live leads scored twice at the same instant: **0 differed**. And the same lead eight hours later scores 47.622 → 47.428, so `p_at` is genuinely an input and the first result is not vacuous. `SRC` — `p_at` is a parameter *"precisely so that 'the same lead at the same instant always scores the same' is a property somebody can test rather than a claim"* |
| 3 | The holdout is real, and its contact rate is reported alongside the scored cohort | **Pass** | `SRC` — decisions are written per serve with their cohort; the screen states the **difference**, the sample size and a noise caveat rather than a verdict: *"Scored is +2.4 points ahead of the plain order, over N served leads. Treat a small sample as noise."* One definition of "contacted" (`is_contact_disposition`) is shared by the score, the cohort statistics and LA-2.12's scorecard, *"because three places computing contacted three ways is how a holdout comparison quietly stops meaning anything"* |
| 4 | Off by default, and can be turned off entirely without breaking the queue | **Pass** | `SRC` — `enabled boolean not null default false`, with the criterion quoted on the line above it. `DB` — the one live settings row is `enabled: false`. With scoring off the serve still returns a tier reason, so criterion 1 does not depend on criterion 4 |
| 5 | Scoring adds under 50ms to serving | **Met at the median; not met at p90; not independently measurable here** | See below |
| 6 | Weights are inspectable and adjustable | **Pass** | `SRC` — rows, not constants: *"a number compiled into a function is neither"*. `scoring_weights_for` overlays a tenant's overrides on `default_scoring_weights()`, so a tenant that has never touched them scores identically to one that reset them. `DB` — 0 override rows live, so every tenant is on the published defaults. `TEST` — *"saving one weight does not mark all seven as overridden"* |

### Criterion 5 needs a percentile before it can be answered

The migration chain is the most honest performance work in the repository, and it is worth keeping
the numbers together:

```
first version        812.7 ms added   (scoring on 1082.0 vs off 269.4, at 200 queued leads)
+ contact counters    89.5 ms
+ candidate cap       ~2 ms per lead
+ one-row score       0.7 ms per lead
+ tier-first order   105 ms at 1,000 queued  ← the cost was never in the scoring
+ `as materialized`   the fourth pass had made it WORSE, 105 → 256.7 ms
```

The fifth pass's header ends without a final figure, and the two prior QA documents record different
halves of the answer rather than contradicting each other:

- **median** +1.7 ms at 200 queued leads and +6.1 ms at 1,000 — comfortably inside the budget;
- **p90** 547.7 ms scored against 405.5 ms unscored — **+142 ms**, which is not.

The criterion does not name a percentile. LA-2.8's own benchmark harness does, and argues for it:
*"p95 rather than a mean, because a mean hides the tail, and the tail is what an agent actually
experiences."* Held to that standard, criterion 5 is not met.

I could not settle it from here. Measuring the delta means serving leads, which claims and locks
them for fifteen minutes; measuring `score_lead` over PostgREST is swamped by a ~236 ms median round
trip, against a function that costs order-1 ms. Recorded as **needs a real run on a disposable
project**, alongside LA-2.8 criterion 5 — and the same completion checklist already names the bigger
number honestly: *"`serve_next_lead` costs ~388ms at 1,000 queued leads before scoring is involved
at all … This is the real performance problem in the module."*

### What the task got right and should not be lost

The score is **never shown to an agent** — only the reason. The ticket's warning about `vendor_score`
(*"do not put a number in front of an agent until you can explain it"*) is honoured in the serving
payload itself, with the reasoning in the code: *"Shown, unlike the score. LA-2.13's own warning is
that a number nobody can explain is worse than no number."*

---

## LA-2.14 · Interested → verification & application handoff — **Pass** (3 of 5); two criteria need a migration applied

**Goal:** someone says yes on an outbound call and the agent moves straight into the same flow an
inbound transfer uses.

The headline rule — *"do not build a second application flow"* — is kept, and kept carefully. There
is no wrapper around the verification service, because *"a wrapper is where an outbound-specific
fork starts, one harmless-looking parameter at a time."* The migration also records that it
implements the **amended** rule from the decision log rather than the task page's *"the outbound lead
and the resulting application are one record, not two"*, because the literal sentence would have made
a lead declined by carrier A and issued by carrier C unrepresentable.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | The verification panel is the same component as inbound, with no outbound-specific fork | **Pass** | `TEST` — *"there is exactly one implementation of the verification panel"*, *"both routes call the panel with identical arguments"*, and *"the verification service takes no outbound-specific parameter"*. The two routes differ in exactly one thing and it is the **entitlement**, because gating the outbound door on `inbound_transfers` would mean a tenant who bought the dialer could not use it |
| 2 | `campaign_id` and `vendor_id` survive onto the application **and the policy record** | **Pass** — ~~Unmet~~, corrected during the LA-2.17 audit | See the correction below |
| 3 | A dropped call resumes with everything already collected | **Pass** | `SRC` — one idempotent call: `on conflict (work_item_id) where ended_at is null do update`, with `resumed` returned. *"There is no separate resume path that has to be kept in step with starting — it is the same call, returning what already exists"* |
| 4 | The deal-flow row is indistinguishable in structure from an inbound one, except for its source | **Pass, with one column** | `SRC` — same table, same columns, `source` added with a check constraint and existing `manual_entry` rows backfilled to `'manual'`. The one difference is `local_date`, which is criterion 5's problem below |
| 5 | An outbound sale appears **correctly** in the daily deal flow | **Unmet — it files against the UTC date** | See below |

### Criterion 5: the outbound deal files against UTC's day, not anybody's

`start_application_from_lead` inserts into `deal_flow` without `local_date`, so the column default
applies:

```sql
local_date date not null default current_date     -- 20260911100000
```

`current_date` is the session's date, which for every connection this product makes is **UTC**.

This is the exact bug LA-1.7 criterion 5 names — *"the deal-flow date is correct for an agent working
late in their own timezone"* — and that `lib/dealFlow/localDate.ts` was extracted to prevent. The
inbound and manual paths both compute it with `intakeLocalDate(timeZone)`. This path was added later,
in SQL, could not reach that helper, and silently took the UTC default.

It is not an edge case for *this* feature. For a tenant on US Pacific time, UTC has already rolled
over from 17:00 local — **the entire evening calling block**, which is when outbound dialling
happens. The agent closes a sale at 19:00, opens Daily deal flow (which defaults to today), and it is
filed against tomorrow.

### Criterion 2: the chain stops one hop before the question it exists to answer

> **Corrected on 2026-09-22, during the LA-2.17 audit, before the migration was applied.** What
> follows is accurate about `tenant_policies` and **wrong in its conclusion**. LA-2.17 had already
> built the policy hop, in a *different* table — `tenant_issued_policies`, carrying `campaign_id`,
> `vendor_id`, `application_case_id` and `deal_id`, with `enforce_issued_policy_attribution()` as a
> before-trigger — and its migration states plainly why it did not extend the table I looked at:
> *"the old `policies`-looking tables belong to the organization-era CRM or to the E&O vault and
> cannot answer this question."*
>
> `tenant_policies` is the serviced book of business, maintained by hand and containing policies
> written long before this product existed. Attribution on it would have been a **second chain
> answering the same question as the first**, and two chains that can disagree about which campaign
> produced a policy is worse than one that sometimes says "unknown". I was about to introduce
> exactly the drift this audit exists to remove.
>
> The criterion is **Pass**. What survives of the finding is smaller and still real: the lineage view
> `tenant_lead_attribution_chain` stopped at `deal_flow`, so a policy that lost its campaign was
> invisible. `20260922190000` now ends that view at `tenant_issued_policies` and adds nothing to
> `tenant_policies`. Its `local_date` half is unaffected and still needed.
>
> What remains genuinely open belongs to LA-2.17 criterion 1, not here: **nothing writes
> `tenant_issued_policies`.** 0 rows, no `from("tenant_issued_policies")` anywhere under `lib/` or
> `app/`. Recording an issued policy is the Sell module's job.


The application half is built, and well: `tenant_application_cases` carries `campaign_id` and
`vendor_id`, `deal_flow` gained both, and a trigger carries the vendor from the campaign rather than
joining it, *"because a campaign can be re-pointed at another vendor and the cost a deal was acquired
at does not change when it is."*

The policy half was never built. Measured live, `tenant_policies` holds exactly: `id`, `tenant_id`,
`policy_number`, `insured_name`, `carrier`, `product`, `effective_date`, `annual_premium_cents`,
`status`, `renewal_date`, `source`, `created_at`, `updated_at`.

**No `campaign_id`. No `vendor_id`. No `lead_id`. No application-case link.** Nothing joins a policy
to anything that produced it, and `tenant_lead_attribution_chain` — the view that exists to trace
precisely this — stops at `deal_flow`.

So the sentence the task page gives as the reason the criterion exists — *"the lead keeps its
`campaign_id` all the way through — **this is what makes cost per issued policy computable**
(LA-2.17)"* — is false at the last hop. Cost per **deal** is computable today. Cost per **issued
policy** is not, and that is the number being sold.

### The migration, and why it does not stop at the columns

`supabase/migrations/20260922190000_la_2_14_deal_date_and_policy_attribution.sql` — **parses, not
applied**:

1. `deal_local_date(tenant, agent, lead_values, at)`: the agent's own timezone from LA-2.11's
   availability, then the customer's state timezone, then UTC. Patched into the existing insert by
   rewriting the function's own source, so this migration does not become a second copy of the
   handoff's rules.
2. `tenant_policies` gains `lead_id`, `application_case_id`, `deal_flow_id`, `campaign_id`,
   `vendor_id`; `carry_attribution_to_policy()` fills whatever the caller did not from whatever link
   it did give; `tenant_lead_attribution_chain` gains the policy leg and `policy_attribution_lost`.

The trigger is the part that matters. Issuing a policy from an application case belongs to the Sell
module, which this task puts out of scope — so adding the columns alone would have produced exactly
the defect this same audit found in LA-2.11 three hours earlier: **a column with no writer**. With
the trigger, the day a policy write arrives the attribution is carried by construction rather than by
somebody remembering.

---

## Guards added

`lib/dialerScripts/selectionReasonIsReal.test.mjs` — 5 tests, all mutation-verified:

- **no tenant-plane query filters a legacy organizations-plane table by `tenant_id`** — the general
  form of the defect, walking all **189** tables the pre-2026-09-11 snapshot keys by
  `organization_id`. Verified on its own: restoring `outbound_scoring_decisions` fails this test
  without help from the specific one
- the dialer panel reads the decisions table this product writes
- a failed selection-reason lookup is raised, not rendered as an absent reason
- the outbound deal files against somebody's local date, not UTC's
- the attribution chain reaches the policy

A note on building it: the first draft of the general scan reported five innocent files, because its
300-character window crossed statement boundaries — `db.from("users")` on one line of a `Promise.all`
and `.eq("tenant_id", …)` on the next belong to two different queries. Tightened to stop at the next
`from(`. A guard that cries wolf gets its allowlist padded until it means nothing.

## Suite state

`npm test` — **731 tests, 731 passing, 0 failing**. `typecheck` clean.

Live state: one `tenant_scoring_decisions` row was inserted to prove the panel fix and deleted; the
table is back to 0 rows. Nothing else was written.

---

## LA-2.15 · Carrier autofill browser extension — **Cancelled**
## LA-2.16 · Per-carrier field maps — **Cancelled**

Both are `Status: Cancelled` on the sprint board, retired by **decision 16** of *Sixteen Open
Questions, Answered* as duplicates of **LA-3.12 / LA-3.13 / LA-3.14**, *"written during the outbound
module, before the Sell module existed."*

So the question for this pair is not whether thirteen acceptance criteria hold. It is whether the
**cancellation was executed**, and decision 16 gives three obligations to check it against.

### 1. "Do not build the cancelled scope" — **held**

Verified across the repository: no extension directory, no `manifest.json`, no content script, no
`carrier_forms` and no `carrier_field_maps` in any source file, migration or the generated types —
so nothing in the live schema either. The only carrier routes are LA-0.4's commission library, which
is a different thing wearing a similar word.

### 2. "Anything already built needs reviewing against LA-3.12's auth model before it ships" — **nothing to review**

Follows from the above. Worth recording *why* this obligation exists rather than just ticking it,
because the risk is not behind us — it is ahead. LA-2.15's retired page still carries this, verbatim,
under a construction-sign heading:

> 🚧 **The open question to settle first.** The extension needs the verified lead, which means an
> authenticated channel from the browser to our API. **Session sharing, a short-lived scoped token,
> or device pairing** — decide before writing code.

LA-3.12 answered it: short-lived scoped grants, origin-bound, single-application scope, revocation
checked against the store rather than inferred from the token, SSN and bank numbers never in the bulk
payload. A tidy retired spec with a schema block in it is exactly the sort of document somebody
builds from, and the LA-2 design is the one that was rejected **on security grounds**.

That is what the guard below is for.

### 3. "Do not lose these three things" — **one of the three did not land**

Decision 16 names three rules worth more than the tasks that carried them, and says where each must
go. Checked against the live LA-3 pages on 2026-09-22:

| Rule | Destination | State |
|---|---|---|
| **Never guess** | LA-3.13 | **Partly.** Drift detection covers a selector matching **zero** elements — `map_miss`, no fill for that field, `needs_review`, falls back to LA-3.14's copy-assist panel, with a matching acceptance criterion. Better than LA-2.16's version, because it names the fallback |
| **Fill, never submit** | LA-3.13 | **No.** Neither LA-3.13 nor LA-3.12 mentions submit anywhere, and neither carries the criterion decision 16 asks for — *"the agent presses submit themselves, always, asserted by test"* |
| **Allowlist-only** | LA-3.12 | **Yes, explicit** — *"`activeTab` plus an explicit host allowlist built from configured carrier origins. Never `<all_urls>`"*, with an acceptance criterion |

"Fill, never submit" is the one with the liability attached, and LA-2.15 says why in a single
sentence: *"An extension that submits an insurance application unattended is a liability we are not
taking on."* It now exists in no live task.

Two of LA-2.16's own criteria also failed to survive into LA-3.13:

- *"A selector matching **more than one** element fills nothing and reports it."* LA-3.13 handles the
  zero-match case only. A selector that resolves to two elements is the ambiguous case *"never
  guess"* is actually about.
- *"Sensitive fields never appear in a log, a metric or an error report."* LA-3.13 gates **publishing**
  on sensitive entries being verified, and forbids sending values to the model, but never says they
  stay out of logs.

### A second finding, outside this pair but found by it

Both LA-3 pages were last edited **2026-08-27** — two weeks before the decision log. So decision 16 is
not the only amendment that never reached them. **LA-3.12 is stale against decision 13 as well:**

```
LA-3.12 today   "15-minute expiry. Not renewable in place."
                "A grant token expires exactly 15 minutes after issue; a request at 15:01 returns 401."

decision 13     "Lengthen the grant to 60–90 minutes … A real Final Expense application takes
                 considerably longer than 15 minutes. Nobody walked through the timing."
```

And LA-3.12 carries no `write_application_fields` scope, which decision 13 adds and which LA-2.15's
*"corrections flow back"* rule depends on.

An engineer picking up LA-3.12 today would build the fifteen-minute grant the decision log already
rejected, and no write-back path at all. That is the same failure this audit keeps finding in code —
**the artefact is right and the claim about it has drifted** — one layer up, in the specification.

### Verdict

| Task | Verdict |
|---|---|
| LA-2.15 | **Cancelled, correctly.** Nothing built; board status correct; one of its three preserved rules is missing from its successor |
| LA-2.16 | **Cancelled, correctly.** Nothing built; board status correct; two of its criteria did not survive into LA-3.13 |

Neither needs code. What is outstanding is **board edits on four task pages**, which this pass did not
make unilaterally because the sprint board is a shared workspace rather than this repository:

1. LA-2.15 and LA-2.16 — add the pointer note decision 16 asks for (*"status `Cancelled`, with a note
   naming the superseding tasks"*). Both read `Cancelled` with no indication of what replaced them.
2. LA-3.13 — absorb *fill, never submit* with its test-asserted criterion, the multi-match rule, and
   the sensitive-fields-never-logged rule.
3. LA-3.12 — apply decision 13: 60–90 minute configurable grant (default 90), the reason store-checked
   revocation matters more at that length, and the `write_application_fields` scope.

`docs/qa/LA-2-COMPLETION-CHECKLIST.md` records all of this, and its *"update the external planning
board"* item is now ticked — that half was done by an earlier pass and confirmed live here.

### Guard added

`lib/carriers/cancelledAutofillStaysCancelled.test.mjs` — 3 tests, mutation-verified, plus a control:

- the retired LA-2.16 schema (`carrier_forms`, `carrier_field_maps`) is not built — and the
  **control** confirms LA-3.13's `carrier_field_map_entry` passes, so the guard fails in both
  directions rather than banning the shape of the correct implementation
- no extension manifest requests `<all_urls>`, which is LA-3.12's allowlist rule and LA-2.15's
  inert-off-the-allowlist rule expressed as the one artefact that would betray either
- no source file attributes work to a cancelled task

It exists because decision 16's *"review against LA-3.12's auth model before it ships"* has no
enforcement today, and the thing it guards against is a spec that still reads as buildable.

## Suite state

`npm test` — **734 tests, 734 passing, 0 failing**. No product code changed: there was none to change.

---

## LA-2.17 · Cost analysis & vendor scorecard — **Pass** (5 of 7); one criterion absent, two unverifiable on this data

**Goal:** one screen answers *which vendor should I buy from again?*

This is a well-built instrument pointed at an empty room, and the two halves of that sentence need
separating carefully, because they score differently.

### The instrument

Decision 10 — *"drop the snapshot, compute live"* — is applied, and the payload **says which mode it
is in**: `"live": true, "snapshot": false, "generated_at": …`. A report that states its own freshness
is the right answer to the decision's concern that *"a report that is right as of 3am, with a
footnote, is a report he will second-guess."*

Decision 11 is applied too. The grid renders **undialable rate** and **claim acceptance rate** as
separate columns rather than the dispute rate the task page still lists — the metric the decision log
says *"does not survive thirty seconds of thought."*

### The empty room, measured

| | |
|---|---|
| `agent_leads` | **214,823** |
| …carrying a `campaign_id` | **0** |
| `deal_flow` carrying a `campaign_id` | **0** |
| `tenant_call_attempts` | 0 |
| `tenant_application_cases` | 0 |
| `tenant_issued_policies` | 0 |
| `tenant_campaigns` / `tenant_lead_vendors` | 6 / 6, with $8,565 of spend recorded |

The chain begins at `agent_leads.campaign_id`, and **not one of 214,823 leads has one**. Six campaigns
declare 28,200 records purchased and $8,565 spent, against zero leads received. Every rate on the page
is therefore `null` — and `null`, not `0`, which is the difference between an honest empty report and
a wrong one.

### Per criterion

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Cost per issued policy is computed per vendor and per campaign, **correctly** | **Pass structurally; it has never had an input** | `SRC` — `tenant_issued_policies` carries `campaign_id`, `vendor_id`, `application_case_id` and `deal_id`, with `enforce_issued_policy_attribution()` refusing a mismatched row. `DB` — 0 rows, and **no application code writes the table**: no `from("tenant_issued_policies")` under `lib/` or `app/`. The formula is right; the Issued column will read 0 until LA-3 records a policy |
| 2 | Figures reconcile exactly with the leads and deal-flow tables for the same filter | **Not falsifiable here** | `DB` — the report says `leads_received: 0`, the drill-through returns 0 rows, and the raw table agrees. Every hop is 0 = 0, which is consistent and proves nothing. Needs a tenant with attributed leads |
| 3 | A vendor credit changes effective cost, and the change is visible | **Pass** | `SRC` — `net_spend_cents = total_spend_cents − credits_received_cents`, rendered as **Net spend** beside **True CPA**, with `claim_count`, `amount_claimed_cents` and `amount_credited_cents` on the same row |
| 4 | **Speed to lead is reported for real-time vendors** | **Built; blocked on a migration** — ~~Unmet, absent entirely~~, corrected during the LA-2.21 audit | See the correction below |
| 5 | Every figure drills through to the rows behind it | **Pass** | `HTTP` — the vendor/campaign cell is a button calling `/api/app/true-cpa/leads` with the same vendor, campaign and period; returns 200 with a `rows` array matching the figure |
| 6 | The page loads in under 2 seconds with 12 months of data | **Pass on the window; not on the volume** | `HTTP` — a 12-month window, five runs from an authenticated session: **788, 965, 518, 548, 524 ms**, median 548. That is the twelve-month *range*, on a tenant with no attributed leads. The query shape is live rather than snapshotted, so volume is the thing left to test |
| 7 | Nothing on the page is labelled talk time | **Pass, and it says so** | `SRC` — *"No talk-time metric is used"* on the grid, and the slot card reads *"Feeds dialing decisions without exposing talk-time"* |

### Criterion 4, corrected

> **Corrected on 2026-09-22, during the LA-2.21 audit.** I searched `lib/vendorScorecard/`, the
> LA-2.17 migration and the True CPA component, found nothing, and wrote "absent entirely". It is
> built, and it is on a different screen:
>
> - `tenant_vendor_speed_to_lead`, read by `/api/app/vendors`
> - `type Speed = { vendor_id, posted_leads, dialled_leads, median_seconds, dialled_within_60s,
>   dialled_within_60s_pct }`
> - a **Speed to lead** column on `/app/campaigns`
>
> which is exactly what the criterion asks for — *"median, and share dialed within 60 seconds"*, per
> vendor. The criterion says *reported*, not *reported on this page*, so it is **met in substance**.
>
> What is true: **the view does not exist on the live project.** It belongs to
> `20260917143000_la_2_5_2_6_vendor_speed_and_coverage`, which is unapplied, and the vendors route
> tolerates its absence by design — *"columns to the rollup, or has not created the speed view at
> all, must not take the vendor list"* — so the column renders empty rather than erroring. That makes
> speed to lead the **fifth** consequence of the pending migration queue, not a gap in LA-2.17.
>
> The placement is still worth a decision: LA-2.17's in-scope list puts speed to lead on the vendor
> scorecard, and it is on the campaigns screen. That is a product call about where Ray looks, not a
> missing feature.
>
> **Three corrections in three turns, all the same mistake**: searching the place a task *points* at,
> finding nothing, and concluding absence — when the thing was built next door under another task's
> name (`tenant_issued_policies` for LA-2.14, the fresh-versus-recycled card for LA-2.20, this). The
> module is cross-wired enough that "not here" is never evidence of "nowhere", and each of these was
> caught only by looking once more.

### What criterion 4 still needs

Speed to lead is not a missing column on a report. LA-2.5 measures the arrival-to-first-dial interval
and the module doc is emphatic about why: on a real-time lead *"calling within the first minute versus
half an hour later is the difference between a conversation and a voicemail"*, and of the old system,
*"the timestamp exists and is never used."*

That sentence is still true of the new one at the reporting layer. `tenant_lead_post_log` exists and
holds 0 rows; nothing aggregates it. LA-2.17 asks for **median and share dialed within 60 seconds, per
vendor** — a panel on this page and a field on the scorecard row.

### A correction to this audit's own LA-2.14 entry

Two tasks ago I recorded LA-2.14 criterion 2 as **Unmet**, on the finding that `tenant_policies`
carries no campaign or vendor. That is true of `tenant_policies` and the conclusion was wrong: LA-2.17
built the policy hop in `tenant_issued_policies` and its migration says why it deliberately left the
other table alone. The entry is corrected in place, the criterion is **Pass**, and the migration I had
drafted no longer adds attribution columns to the book of business — it now ends the lineage view at
`tenant_issued_policies` instead. Finding it before applying the migration is the only reason this is
a correction rather than a second attribution chain in the schema.

---

## LA-2.18 · Campaign comparison — **Pass** (4 of 5); one warning fires so often it says nothing

**Goal:** compare two campaigns and know whether the difference is real.

The task's whole argument is that a table with two rows invites a $2,000 decision on noise. The
implementation takes that seriously in the place it matters most — it **refuses** rather than warns:

```sql
if (p_to_a - p_from_a) <> (p_to_b - p_from_b) then
  raise exception 'campaign_comparison_periods_must_match';
if extract(isodow from p_from_a) <> extract(isodow from p_from_b) then
  raise exception 'campaign_comparison_weekdays_must_align';
```

with the reasoning in the header: *"so a small campaign cannot be made to look better by comparing
its Tuesday with somebody else's holiday weekend."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Comparing campaigns of **very different sizes** produces an explicit warning, not a verdict | **Unmet as worded** | See below |
| 2 | Periods are matched by length and day-of-week alignment | **Pass** | `SRC` + `DB` — both refusals above, server-side; the live function raises `campaign_comparison_campaign_not_found` on a bogus id, so it is deployed |
| 3 | The confidence statement is in plain English and correct | **Pass** | `SRC` — a two-proportion z-test at 1.96, rendered as *"With 518 and 197 observations, this difference is unlikely to be chance"* or *"The observed difference is not yet distinguishable from normal variation at the 95% level."* `cost_per_issued` gets its own sentence refusing the causal claim the others do not make: *"the cost difference is directional, not proof that one campaign caused the better result"* |
| 4 | Volumes are visible at every stage of both funnels | **Pass** | `SRC` — a **Side-by-side funnel volumes** table with A volume, B volume, difference and both rates per stage, and the header line carries *"N matched days · X observations in A · Y in B"* |
| 5 | A comparison with too little data says what is needed | **Pass** | `SRC` — *"Too few comparable observations to tell these apart yet — needs about 143 more in the smaller sample"*, with `needed_for_200` also returned as a number so the screen is not the only place that knows |

### Criterion 1: a warning that is always on

```sql
'size_warning', case when m.leads_a <> m.leads_b then '…' else null end
```

Any inequality. Two campaigns essentially never have identical lead counts, so **4,000 against 3,999
gets the same warning as 4,000 against 30** — which means the warning is on for every comparison
anybody will ever run, and the reader learns to scroll past the one case where it mattered.

The criterion says *very different*. This is the same shape as several findings earlier in this audit:
a signal that cannot be off carries no information.

`supabase/migrations/20260922200000_la_2_18_size_warning_means_something.sql` makes it a **2:1 ratio**
and puts both counts in the message, so "very different" has a stated meaning:

> *"Campaign sizes are very different — 4,000 leads against 30. Compare the rates and costs, not raw
> volume, and treat the smaller arm as the limit on what this can show."*

It patches only that expression, and asserts afterwards that the two matched-period refusals survived
the edit. **It parses and is not applied** — the fourth in the pending queue.

## Suite state

`npm test` — **734 tests, 734 passing, 0 failing**. `typecheck` clean. The one guard changed is
`selectionReasonIsReal.test.mjs`, whose policy-chain test now asserts the chain ends at
`tenant_issued_policies` **and not** at `tenant_policies` — so the second attribution path cannot be
reintroduced by a future pass making the same mistake I did. Mutation-verified in both directions.

---

## LA-2.19 · Vendor returns & credit ledger — **Pass** (5 of 6); the sixth was deleted by decision 11

**Goal:** claim back the money paid for leads that were never dialable, in one click, before the
return window closes.

This is the best-constrained schema in the module. The claim's state machine is enforced by check
constraints rather than by the service, so the ledger cannot be put into a shape that does not mean
anything:

```sql
check (status = 'draft' or submitted_at is not null)
check (status not in ('accepted','rejected','partial') or resolved_at is not null)
check (status <> 'rejected' or nullif(btrim(coalesce(rejection_reason,'')),'') is not null)
check (amount_credited_cents >= 0 and amount_credited_cents <= amount_claimed_cents)
check ((status in ('accepted','partial') and amount_credited_cents > 0) or status not in ('accepted','partial'))
```

### Per criterion

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Every claimable lead is captured **automatically** from scrub results and dispositions | **Pass** | `DB` — `create_vendor_return_claim` raises `LEAD_CLAIM_NO_CLAIMABLE_LEADS` rather than letting a claim be invented; the items are derived from evidence, not entered |
| 2 | The return window is tracked per vendor and **warns before it closes** | **Pass** | `SRC` — `days_remaining` is computed from `created_at + vendor.return_window_days`; the badge turns destructive at **≤ 3 days**, reads *"Closes today"* at zero and *"Expired"* past it, per lead |
| 3 | An accepted credit adjusts campaign spend, and effective cost changes **visibly** | **Pass — proved live** | `DB` — see below |
| 4 | The evidence export contains enough for a vendor to verify without asking questions | **Pass** | `SRC` — an **Evidence CSV** link per claim (`/api/app/vendor-returns/claims/{id}?format=csv`); `TEST` — *"vendor return evidence export includes a summary and safe evidence rows"* and *"scorecard CSV quotes cells and neutralizes spreadsheet formulas"*, so the pack a vendor opens cannot carry a formula injection |
| 5 | **Dispute rate per vendor appears on the scorecard** | **Superseded — and correctly so** | See below |
| 6 | A partially accepted claim records the amount **actually credited**, not the amount asked for | **Pass — proved live** | `DB` — a partial claim stores `{"status":"partial","amount_claimed_cents":5000,"amount_credited_cents":1800}`; crediting 9000 against 5000 claimed is **REFUSED** by check constraint; a `rejected` claim with no reason is **REFUSED** |

### Criterion 3, measured end to end on a real campaign

```
campaign "Apex FE Q3 List"   spend 181500   credits 0
before                     : total 181500 · credits 0    · net 181500
after a $50.00 credit      : total 181500 · credits 5000 · net 176500
after cleanup              : total 181500 · credits 0    · net 181500
campaign credits restored  : yes
```

The credit moved **True CPA's own `net_spend`**, not just a column on the claim — the delta trigger
maintains `tenant_campaigns.credits_received_cents` on insert, update *and* delete, and the scorecard
computes `net_spend = total_spend − credits_received`. Deleting the claim reversed it exactly, which
is the half that usually is not built.

One behaviour found on the way and worth recording as a feature rather than a bug: a resolved claim
raises **`LEAD_CLAIM_OUTCOME_IMMUTABLE`** on any attempt to change its outcome. An accounting record
that can be silently rewritten is not a ledger, and the product's own path — draft → submit → record
the vendor's answer — is the only way to reach a resolution.

### Criterion 5 was right to disappear, and one instruction from its replacement was missing

Decision 11 deleted dispute rate, and the argument is the sharpest in the decision log:

> *"It measures claims Ray made, not bad leads the vendor sold. A vendor who credits readily invites
> more claims and scores worse; a vendor who refuses everything scores clean."*

A behavioural metric about the buyer wearing the costume of a quality metric about the seller. It is
**gone** — no occurrence anywhere in `lib/`, `app/`, `components/` or the migrations — and both
replacements are built and on the True CPA grid:

| Metric | Question | Direction |
|---|---|---|
| Undialable rate | Is their product any good? | Low is good |
| Claim acceptance rate | Are they decent to deal with? | High is good |

**The directions were not on the screen**, which decision 11 asks for twice — *"with their directions
stated on the screen"* and *"the two metrics answer two different questions and must never be blended
into one score."* Two bare percentages side by side are read the same way: 18% undialable and 18%
claim acceptance look consistent, and are bad twice.

Fixed in `components/app/true-cpa-workspace.tsx` — each column header now carries its direction and
the question it answers, and the card says the two are never combined into one score. Pinned by
`lib/vendorScorecard/metricDirections.test.mjs`, which also fails if dispute rate returns — the most
likely way it comes back is somebody reading the LA-2.19 task page, **which still lists it**.

---

## LA-2.20 · Lead recycling & nurture — **Pass** (6 of 6), and none of it can run yet

**Goal:** a lead that hit the ceiling six months ago is worth calling again, without importing it as
a stranger.

The task's open question — *"is a lead re-imported six months later the same lead with a second
campaign, or a new lead?"* — is answered the way it recommends, in the schema: **one lead, many
sources**, via `tenant_lead_sources`, keyed by **phone** because *"a phone is the stable identity
available in the current lead template, while names and email addresses can change."*

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A reactivated lead keeps its full attempt history **and shows it** | **Pass** | `SRC` — `reactivate_nurture` sets `attempts_made = 0` and touches no `tenant_call_attempts` row: *"attempt rows are never deleted; the lead's serving counter resets while the immutable attempt history remains the audit trail."* `lead_attempt_history` is read by the lead workspace and rendered on the lead detail and in the dialer |
| 2 | A number suppressed since the original campaign is **never** reactivated | **Pass** | `SRC` — the candidate query carries `and not (select s.suppressed from is_phone_suppressed(…) s)`, and the service re-screens every candidate afterwards, suppressing any that come back blocked |
| 3 | Every reactivated lead is re-scrubbed **before being served** | **Pass** | `SRC` — the campaign is set to `scrub_status = 'scrubbing'` in the same call, and LA-2.3's hard gate means a campaign that is not `scrubbed` serves nothing. The screening result is recorded per lead through `complete_nurture_reactivation` |
| 4 | Re-importing an existing person produces **one lead with two sources** | **Pass, in an unapplied migration** | `SRC` — the import's default decision is `existingLeads: "attach"`, and the commit pushes `{lead_id, campaign_id, source_key}`; `import_agent_lead_batch` calls `import_agent_lead_source` per item with the campaign, the cost and the source key. That call is in `20260917146000`, which has not been applied |
| 5 | The recycle cap is enforced | **Pass** | `SRC` — `and coalesce(l.recycle_count, 0) < v_rule.max_recycles`, default 3, with the allowed dispositions defaulting to `no_answer` and `voicemail` only |
| 6 | Recycled contact rate is reported **separately** from fresh | **Pass** | `SRC` — a *"Fresh vs recycled performance"* card on `/app/activity` with served, clicked, contacts and contact rate per source type, and *"this is contact evidence, not talk time"* said on the card |

Criterion 6 is the one I nearly scored wrong: there is no recycled-versus-fresh panel on the nurture
screen, and the report lives on the activity screen LA-2.21 owns. Looking only where the task points
would have produced a false gap.

### The thing that matters more than any of the six

Measured live: `tenant_lead_sources` **0 rows**, `tenant_campaign_recycle_rules` **0 rows**,
`tenant_nurture_reactivations` **0 rows**. Nothing has ever recycled anything, and the reason is not
in LA-2.20 at all.

---

## One unapplied migration is starving four tasks

This turn joined up a chain that earlier entries saw only pieces of. Reading the import commit:

```ts
if (plan.campaignId) {
  const campaign = await db.from("tenant_campaign_costs").select(…)
  if (campaign.error)
    throw new Error(`Could not read the cost for this campaign, so nothing was imported: …`);
```

and measured live: **`tenant_campaign_costs` does not exist** — it belongs to `20260917140000`,
unapplied. So:

```
tenant_campaign_costs missing
   └─► every campaign-attributed import throws before it commits
       └─► no lead is ever given a campaign_id        ← 0 of 214,823, measured
           ├─► tenant_lead_sources stays empty        ← LA-2.20 criteria 4 and 6 have no data
           ├─► no claimable evidence accrues          ← LA-2.19 has nothing to claim on
           └─► True CPA has no input at any hop       ← LA-2.17's headline number is uncomputable
```

The code already knows about this failure, in a comment written from a browser pass: *"Observed in
the browser pass: a valid, selected campaign returned 'Choose a valid campaign' on commit"* — which
is why the error message was improved to name the real cause. The cause is still there.

Four of the five pending migrations now have a named consequence. `20260917140000` is the one to
apply first: it is upstream of everything measured in the last three audits.

## Suite state

`npm test` — **736 tests, 736 passing, 0 failing**. `typecheck` and `eslint` clean. Live state: one
claim was created on a QA campaign to prove criterion 3 and deleted; `lead_claims` is back to 0 rows
and the campaign's credits are back to 0.

---

## LA-2.21 · Activity log & agent scorecard — **Pass** (5 of 6); one not measurable here

**Goal:** *"Opened / dialled / logged are three different numbers, and the gaps between them are the
point."*

The screen is built on that sentence rather than around it. `served`, `clicked` and `logged` are
three columns on the scorecard, and the contact rate comes back `null` rather than `0%` when there
is nothing to divide — measured on the live tenant:

```
Demo Agent   served 11   clicked 0   logged 0   contact null%
```

Eleven leads served, none dialled, none dispositioned, and the screen says so in three numbers
instead of one zero.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Served, clicked and logged are shown **separately and never conflated** | **Pass** | `DB` — above, from `tenant_activity_report` on real rows |
| 2 | Zero-click dispositions are **visibly flagged** | **Pass** | `SRC` + `DB` — the report builds `integrity_flags` from three cases, and all three the task names are there: `zero_click_disposition`, `served_never_dispositioned`, `impossibly_fast_disposition` (`card_open_seconds < 5`, against the task's *"a card open for four seconds"*). Live, **11 of 11 rows carried a flag**, all `served_never_dispositioned`, and the UI renders each flag as a badge |
| 3 | Every grid exports to CSV **without a row cap** | **Pass by inspection** | `SRC` — `if p_export then` is a separate branch with **no `limit`**; the paged branch alone carries `limit v_size offset …`. The live tenant has 11 rows, so the export cannot be *demonstrated* to be uncapped, only read |
| 4 | The log loads in under 2 seconds over **100,000 rows** with pagination | **Not measurable here** | `DB` — 561 ms paged and 198 ms exporting, on **11 rows**. That says nothing about 100,000. Pagination is real (`p_page`, `p_page_size` clamped to 500) and the volume is the thing left to test |
| 5 | **A setter sees only their own scorecard** | **Pass — proved live** | `DB` — see below |
| 6 | No metric on the page is labelled talk time | **Pass** | `SRC` — the column is `card_open_seconds`, the rename the task asks for by name, and the page says *"not talk time"* twice |

### Criterion 5, proved rather than read

The RPC does it twice, and the second one is what makes it hold:

```sql
if p_actor_role = 'setter' then p_agent_user_id := p_actor_user_id; end if;
…
and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
```

The first line rewrites the parameter; the predicate is repeated on **every** query in the function,
so a caller that got past the first still cannot read somebody else's rows. Exercised live by asking
as a setter for a different agent's activity:

```
setter asking for another agent's rows: 11 returned, 0 belonging to somebody else
```

### A discrepancy I chased and did not find

`tenant_lead_activity` holds 13 rows and the report returned 11, which looks like an activity log
losing rows — the report inner-joins `agent_leads`, so activity for a deleted lead would vanish
silently. It is not that: **the other two rows belong to a different tenant.** Filtered properly,
the table holds 11 for this tenant and the report shows all 11. Recorded because the check is worth
repeating on a tenant with deleted leads, which this one does not have.

---

## LA-2.22 · Outbound subscription limits — **Pass** (4 of 5), after a fix

**Goal:** the outbound module respects the plan's limits and says so plainly.

All five limit keys are wired at real enforcement points, in routes rather than in the UI, which is
the task's own rule — *"hiding the button is not enforcement."*

| Limit | Enforced in |
|---|---|
| `max_active_campaigns` | `api/app/campaigns` POST and `[id]` PATCH — and only on `status === "active"`, so pausing frees a slot |
| `max_setter_seats` | `api/app/team` and `team/[userId]` |
| `monthly_leads_imported` | import preflight **and** commit |
| `dnc_scrub_lookups` | import preflight and the agent-template service |
| `consent_cert_claims` | `lib/compliance/consentClaims.ts` |

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A hand-crafted request over any limit is rejected with 403 | **Pass** | `SRC` — `assertOutboundLimit` throws `OUTBOUND_LIMIT_REACHED:<key>:<usage>:<limit>` from the route handler, before the write; `TEST` — *"LA-2.22 declares every outbound cap and meter"* |
| 2 | Pausing a campaign frees a slot **immediately** | **Pass** | `SRC` — the check runs only when the incoming status is `active`, and the usage counts active rows, so the slot is free on the next request with no batch in between |
| 3 | Exhausted scrub credits block the import and **never produce a dialable unscrubbed lead** | **Pass** | `SRC` — the meter is checked in the preflight, before the commit; LA-2.3's hard gate means an unscrubbed campaign serves nothing regardless, so the two failures cannot combine into a dialable lead; `TEST` — *"LA-2.22 import is batch-preflighted and records usage idempotently"* |
| 4 | **Every limited screen shows usage against the cap** | **Unmet — fixed** | See below |
| 5 | The upgrade prompt names the specific limit hit | **Pass** | `SRC` — the raised code carries the key, the usage and the limit, and `UpgradePrompt` takes `limitKey`, `usage` and `limit` rather than a generic message |

### Criterion 4: the usage was on a screen where no campaign is created

`max_active_campaigns` usage was rendered on **Team & access**, under Settings. Campaigns are created
on **Vendors & campaigns**, and `components/app/campaign-workspace.tsx` contained **zero** mentions
of a limit, a cap or a quota.

So Ray met the limit as a 403 on the one page that could have warned him — which is precisely the
failure the task's own rule describes: *"the UI exists so the product does not feel broken."*

The route had been returning the data all along — `{ campaigns, limits: await
outboundLimitSnapshot(tenantId) }` — and nothing read it. Fixed by rendering it in the page header,
with the behaviour that is otherwise discovered by trial:

> *Active campaigns: **3 of 5** active. Paused campaigns do not use a slot.*

and at the cap, as a `role="alert"`:

> *Active campaigns: **5 of 5** active — pause a finished campaign to free a slot, or upgrade your plan.*

That sentence is criterion 2 made visible. The rule that paused campaigns do not count is the thing
that makes rotating a finished campaign out for a new one possible, and until now nothing said it.

---

## Correction: LA-2.17 criterion 4 was wrong

Auditing this pair turned up that **speed to lead is built**, and I had recorded it as *"absent
entirely"* two turns ago. It is on `/app/campaigns` — `tenant_vendor_speed_to_lead` →
`/api/app/vendors` → a **Speed to lead** column carrying the median and the share dialled within 60
seconds, per vendor, which is exactly what the criterion asks for. The criterion is met in substance
and the entry is corrected in place.

What is true is narrower and joins the queue below: **the view does not exist on the live project**,
so the column renders empty. The vendors route tolerates that by design rather than erroring.

**Three corrections in three turns, all the same mistake.** `tenant_issued_policies` for LA-2.14, the
fresh-versus-recycled card for LA-2.20 (caught before writing), and this. Each time I searched where
the task points, found nothing, and concluded absence — when the thing was built next door under
another task's name. In a module this cross-wired, "not here" is never evidence of "nowhere".

## The pending queue now has five named consequences

```
20260917140000  tenant_campaign_costs        → no lead ever gets a campaign_id (0 of 214,823)
                                              → True CPA, LA-2.19 and LA-2.20 all starve
20260917143000  tenant_vendor_speed_to_lead  → the Speed to lead column renders empty
20260917146000  imported leads → lead_queue  → an imported list cannot be dialled, and
                                                LA-2.20's "one lead, many sources" never runs
20260922180000  booking notice link          → every booking notification is a 404
20260922190000  outbound deal date + lineage → an outbound sale files against the UTC date
20260922200000  comparison size warning      → the warning fires on any difference
```

`20260917140000` remains the one to apply first: it is upstream of three of the others' symptoms.

## Suite state

`npm test` — **736 tests, 736 passing, 0 failing**. `typecheck` and `eslint` clean. No shared state
was written this turn; the activity checks are reads.

---

## LA-2.23 · Scripts, rebuttals & required disclosures — **Pass** (5 of 6); the sixth cannot fire

**Goal:** the right words in front of the agent while the call is live — and any disclosure the law
requires him to read.

The task's central design point is honoured: *"the disclosure block is visually separate, always
visible, and cannot be collapsed away."* It is a separate warning-bordered Card, rendered on `panel`
alone with no collapse control and no dismiss, while the script editor beside it is the collapsible
one. The optional thing collapses; the mandatory thing does not.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Variables resolve from the live lead — **no placeholder text ever appears on screen** | **Pass** | `SRC` — `value.replace(/\{\{…\}\}/g, (_, key) => variables[key] ?? "")`. An unknown key becomes an **empty string**, never a visible `{{…}}`. See the authoring note below |
| 2 | The disclosure block for the lead's state is visible and **cannot be dismissed** | **Pass** | `SRC` — its own Card, no collapse, and `panel.disclosure.blocking` disables *Prepare call*, *Start call* and the confirmation button together |
| 3 | Reading confirmation is recorded **against the call attempt** | **Pass** | `SRC` — `POST /api/app/dialer/attempt/{id}/disclosure` carries the state and product code, keyed to the attempt row, and the dial button stays disabled until `confirmed` |
| 4 | Editing a script takes effect on the next lead served, **with no deploy** | **Pass** | `SRC` — a Script editor in the dialer with a textarea per section and *"Save a new version without changing scripts already used on calls"*; the attempt records `script_id` and `script_version`, so a call is pinned to the version it used while the next lead gets the new one |
| 5 | Rebuttals are reachable in one click while a call is in progress | **Pass** | `SRC` — the rebuttal library is rendered in the same panel, keyed by objection, with the six defaults present including *"how did you get my number"* |
| 6 | The panel does not push the phone number or the disposition buttons off screen | **Pass** | `SRC` — phone, disclosure and dispositions are separate Cards in the dialer's own grid rather than stacked below the script; the script panel scrolls inside itself |

### Criterion 1 is met by a mechanism that makes authoring hazardous

`variables[key] ?? ""` is exactly right **on the call** — an agent must never read `{{first_name}}`
aloud, and a blank is less wrong than a placeholder.

While writing the script it is a trap. The supported set is `first_name`, `state`, `age` (and their
`lead.` forms). Anything else — `{{spouse_name}}`, `{{carrier}}` — does not warn, does not fail to
save, and does not render. It **disappears**, and the agent reads a sentence with a hole in it on a
live call. The editor is the only place an author could learn which keys exist, and it named none.

Fixed: the Script editor now says which variables resolve and what happens to the rest —

> Save a new version without changing scripts already used on calls. Variables: `{{first_name}}`,
> `{{state}}`, `{{age}}` — anything else is replaced with nothing rather than shown.

Pinned by `lib/dialerScripts/scriptAuthoring.test.mjs`, whose third test runs in the direction that
matters: **every variable the editor advertises must be one the resolver actually builds**, because
advertising a key that resolves to nothing is the same defect with the blame moved.

### The gap that is not a criterion, and is the reason none of this can run

`state_disclosures` holds **0 rows**, and nothing in either the agent app or the admin app can write
one. LA-2.23's own scope says where it belongs — *"per state, maintained platform-side alongside the
calling-law table (SA-4)"* — and that screen does not exist.

So criterion 2 passes on a block that always reads *"No approved disclosure is configured for FL.
Dialing is blocked until Compliance publishes one"*, and criterion 3 records a confirmation that can
never be given, because the button that gives it is disabled by the same flag. Recorded in full as
item **A1** of `docs/qa/LA-2-WEB-APP-GAPS.md`; it remains the single thing stopping outbound dialing.

---

## LA-2.24 · Lead assignment rules — **Pass** (6 of 6); the licensed path has never been exercisable

**Goal:** leads reach the right person automatically, and nobody is handed more than they can work.

The task names what was wrong before — *"capacity is displayed and never used"* — and the fix is
structural rather than procedural: `agent_capacity.current_open` is maintained by a trigger on
`lead_queue` for insert, update of `owner_user_id`/`status`/`disposition`, and delete. It is derived,
so it cannot drift from the thing it counts.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | A licensed agent is **never** assigned a lead in a state he cannot write | **Pass — proved live** | `DB` — see below |
| 2 | An agent at capacity is **skipped**, and the lead goes to the next eligible person | **Pass** | `SRC` — `assign_lead` reads `agent_capacity` and passes over a full candidate rather than queueing behind them, which is the task's point: *"an agent holding 400 assigned leads he will never reach is worse than an unassigned pool"* |
| 3 | Rules evaluate in order and the first match wins, **deterministically** | **Pass** | `SRC` — `assignment_rules` is indexed `(tenant_id, is_active, priority, id)` and walked in that order, with `id` as the tiebreak so two rules at the same priority cannot swap between calls |
| 4 | Sticky dispositions keep a lead with its current owner | **Pass** | `SRC` — an actively owned item returns `{"sticky": true, "reason": "Active ownership is sticky until disposition"}` and is not moved; an explicit target is the deliberate manual-reassignment path. The task flagged this as *"display-only; make it real"* — it is real |
| 5 | An inactive assignee's leads return to the pool **automatically** | **Pass** | `SRC` — `return_inactive_assignments()` is a trigger on the user row, not a job somebody has to run; it clears `status`, `claimed_by`, `owner_user_id` and `owner_role` together |
| 6 | Changing a rule affects the next assignment, with no deploy | **Pass** | `SRC` — rules are rows read at assignment time; the migration's own note: *"the next assignment call will then use the current rules and capacity"* |

### Criterion 1, exercised rather than read

`assignment_candidate_is_eligible` called directly against the live database:

```
 ok setter, licensed product required    -> false   a setter may not be handed a lead that must be sold
 ok setter, no licence required          -> true    a setter may work any lead they only qualify
 ok producer, no state on the lead       -> false   no state means no licence check — refuse
 ok bookkeeper                           -> false   not an assignable role at all
 ok assistant                            -> false   not an assignable role at all
```

Five determinate cases, five correct answers. The licensing question defers to LA-0.5's `can_write`
rather than reimplementing it, which is what keeps the appointment, licence and E&O rules in one
place.

### The licensed path has never run on this project

The sixth case — a producer in Texas — returns **false**, and so does every other state tried
(TX, FL, CA, NY, AZ, OH, GA, NC, PA, IL). The tenant has **38 carrier appointments** and five active
carriers, including an active TX one, so the blocker is the per-user half of `can_write`: the licence
or the E&O policy, neither of which this fixture's owner has.

That makes criterion 1 **provably satisfied** — he cannot write anywhere, so he is assigned nothing —
and it means `assign_lead`'s licensed branch has **never been exercised end to end** here. The same
"well-built instrument, empty room" shape as LA-2.17. A tenant with a licence and an E&O policy on
file is what it would take to test the other direction, and that is a fixture, not a fix.

### A note on my own method

Reading that result, I first wrote a probe that selected `appointments` columns that do not exist and
**discarded the error**, getting `null` back and nearly concluding the table was empty. That is the
exact defect this audit has corrected in the product twice — a swallowed query error rendered as an
absence. Caught on the re-read; the table is keyed by tenant, carrier and state with no user column
at all, which is what sent the first probe wrong.

## Suite state

`npm test` — **739 tests, 739 passing, 0 failing** (3 new). `typecheck` and `eslint` clean. No shared
state was written; every LA-2.24 check is a read of a `stable` function.
