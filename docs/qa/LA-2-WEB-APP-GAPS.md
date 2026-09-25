# LA-2 · What is still missing from the web app

**Checked 2026-09-22, against the running application and the live database.** Every claim below was
measured, not inferred from a ticket. The method is at the end so it can be re-run.

All 24 LA-2 tasks are `Completed` on the sprint board except LA-2.15 and LA-2.16, which are
`Cancelled`. **That board status is about the engine, not the screen**, and the gap between those two
things is what this document is. In almost every case the rule is built, enforced server-side and
tested — and there is no surface in the web app from which a human can operate it.

| | |
|---|---|
| **Blocks the module from working at all** | 1 item |
| **A rule exists and cannot be configured** | 5 items |
| **Reporting the module promises and does not render** | 3 items |
| **Present but waiting on a migration** | 3 items |
| **Declined by decision — not gaps** | 13 items, listed so they stop being re-raised |

---

## A. The one that stops the module working

### A1 · Nothing can publish a required disclosure — and the dialer blocks without one

**Severity: outbound dialing is blocked for every state, on every tenant, today.**

`state_disclosures` is the table holding each state's mandated wording. Measured live: **0 rows.**

It appears in exactly one file in the entire repository — the migration that creates it. There is no
seed, no agent route, no admin route, no screen. It carries no `tenant_id`, so it is platform
reference data, and the admin app has `compliance-vendors` (DNC vendor credentials) and nothing for
this.

The dialer treats a missing disclosure as blocking, correctly:

```tsx
// components/app/dialer-workspace.tsx
disabled={… || panel.disclosure.blocking || …}          // Prepare call
disabled={… || panel.disclosure.blocking}               // "I read this disclosure"
{!panel.disclosure.configured && <p …>Dialing is blocked until Compliance publishes the approved wording.</p>}
```

and the server supplies the reason:

> *"No approved disclosure is configured for {state}. Dialing is blocked until Compliance publishes
> one."*

Measured live, as the signed-in owner, against a real lead on a real tenant:

```json
GET /api/app/dialer/panel?lead_id=…     200
{ "disclosure": { "state": "FL", "productCode": "term_life", "configured": false, "blocking": true,
                  "requiredText": "No approved disclosure is configured for FL. Dialing is blocked
                                   until Compliance publishes one." },
  "eligibility": { "allowed": true } }
```

`eligibility.allowed: true` is the important half. The lead is inside its legal calling window, not
suppressed, not a litigator — **everything else says dial it**, and the only thing stopping the call
is wording nobody can publish.

So the compliance gate is doing exactly what LA-2.23 asks — *"some states mandate specific wording, so
that block is visually separate, always visible, and cannot be collapsed"* — and there is no way for
Compliance to publish anything. **The gate is correct and permanently shut.**

**What is needed:** a platform-admin screen under `/admin` for `state_disclosures` — state, product
code, required text, effective-from — plus a seed for the states the product actually sells in. It is
admin rather than tenant because the wording is law, not preference, and one tenant must not be able
to soften it.

---

## B. A rule exists and cannot be configured

Each of these is a table the SQL engine reads on every call and **no application code writes**. All
were confirmed by scanning every `.ts`/`.tsx` under `lib/`, `app/` and `components/` for a write
against the table, and by counting rows live.

| # | Task | Table | App writers | Rows live |
|---|---|---|---|---|
| B1 | LA-2.4 Calling-window engine | `tenant_calling_windows` | **0** | 0 |
| B2 | LA-2.7 Cadence & retry | `tenant_cadence_rules` | **0** | 0 |
| B3 | LA-2.3 Suppression | `tenant_suppression_list` | **0** (RPC side-effects only) | 4 |
| B4 | LA-2.6 Consent artefacts | `tenant_consent_artefacts` | 2 (claim path) | 0 |
| B5 | LA-2.5 Lead-post endpoints | `tenant_vendor_post_keys` | 1 (ingest only) | 0 |

### B1 · No calling-window settings screen

LA-2.4 builds the engine the module doc asks for — federal default, per-state overrides, day-of-week
rules, a holiday calendar, and a tenant-level tightening. `tenant_calling_windows` is the tenant half
and **nothing writes it**, so the tightening cannot be set and the state rules cannot be seen.

The consequence is not a broken call — the federal and state defaults still apply — it is that the
agent cannot *inspect* the rules his business depends on. The module doc's own open question 3 is
*"who maintains the state calling-law table, and a stale table is worse than none because it feels
authoritative."* Today nobody can even look at it.

**What is needed:** a Settings tab showing the resolved window per state, with the tenant tightening
editable and the holiday calendar visible. Read-only for the state rules; editable for the tenant's
own narrowing.

### B2 · No cadence editor — and this contradicts a criterion scored Pass

LA-2.7 criterion 2 is, verbatim: **"Cadence rows can be added, edited and deleted, per campaign."**

The engine is right and the test that covers this criterion is right about what it tests — the rules
are data rather than a hard-coded three-row matrix, and a disposition-specific row beats the catch-all.
But *adding, editing and deleting* is a web-app function, and there is no screen, no route and no
writer. `tenant_cadence_rules` has 0 rows, so every tenant runs on the built-in default.

**This document corrects the earlier audit entry**, which scored criterion 2 `Pass` on the strength of
the engine. The engine passes; the criterion as written does not, because half of it is a UI.

**What is needed:** a cadence editor on the campaign screen — attempt number, delay, disposition
scope, add/remove rows — writing `tenant_cadence_rules`, with the entry validation LA-2.7 already has
(`banana` is refused before it reaches Postgres).

### B3 · No internal DNC management

Ray's own "never call this person again" list is written correctly by three server paths — the import
preflight, the dialer's DNC disposition, and the nurture re-screen, all via `suppress_phone`. What
does not exist is any way to **see, search, add or remove** an entry.

`/app/tcpa` ("TCPA / DNC") is a nav placeholder with `built` unset.

That matters for a specific, likely case: somebody rings in and asks to be removed. There is no path
to honour that request except dialing them and dispositioning the call, which is the opposite of what
they asked for.

**What is needed:** the `/app/tcpa` screen — searchable list, manual add with a reason, and removal
with an audit row.

### B4 · No consent locker

`tenant_consent_artefacts` holds the certificate proving a person asked to be contacted. The dialer
shows the current one read-only on the lead panel. There is no screen to search, review or export
them, and `/app/consent` ("Consent locker") is an unbuilt nav placeholder.

The module doc is unusually direct about why this one matters:

> *"This is the exact thing you are asked to produce when a complaint arrives, and purchased lists
> are where complaints come from."*

A locker you cannot open at the moment you need it is not a locker.

**What is needed:** `/app/consent` — search by phone or name, the artefact with its timestamp, IP,
source URL and landing page, and an export. Also the per-vendor *missing certificate rate*, which the
doc names as a vendor-quality signal and which nothing currently surfaces.

### B5 · No lead-post endpoint management, and no speed-to-lead report

LA-2.5 builds the real-time ingest path and the timing that goes with it. Two halves are missing from
the web app:

- **Endpoint keys.** `tenant_vendor_post_keys` is written only by the ingest service. There is no
  screen to mint a key for a new ping-post vendor, see which keys exist, or rotate one. A vendor
  cannot be onboarded through the product.
- ~~**Speed to lead.**~~ **Corrected 2026-09-22 — this is built, not missing.**
  `tenant_vendor_speed_to_lead` feeds `/api/app/vendors`, and `/app/campaigns` renders a **Speed to
  lead** column with the median and the share dialled within 60 seconds, per vendor. It shows nothing
  today because the view is in `20260917143000`, unapplied — a fifth consequence of the migration
  queue below, not a gap. The open question is placement: LA-2.17 puts it on the vendor scorecard and
  it is on the campaigns screen.

**What is needed:** key management on the vendor screen, and a speed-to-lead panel (median and p90,
per vendor) on True CPA.

---

## C. Reporting and views the module promises and does not render

### C1 · LA-2.11 — no calendar, and no today's appointments

LA-2.11's *Views* section asks for a day and week calendar and today's list on the dashboard. Neither
exists. `/app/appointments` is LA-0.5's **carrier** appointment vault — a different meaning of the
word, and the same collision the LA-2.11 migration had to design around when it named its table
`tenant_appointments`.

Booking, rescheduling and the queue tier all work; the only way to see the calendar is through the
dialer's booking panel.

Not an acceptance criterion, but it is in scope and an agent whose day is built around appointments
cannot see them in one place.

### C2 · LA-2.12 — the setter roster has no dedicated screen

The roster and scorecard render inside `/app/activity`. That is reasonable and it works. Noted only
because the task describes *"let Ray see who is on shift now"* as a standing question, which is a
dashboard-tile shape rather than a report tab.

### C3 · Buffer between appointments is stored, shown, and enforced by nothing

`tenant_agent_booking_policy.buffer_minutes` is saved and surfaced to the slot picker. The overlap
exclusion constraint compares `[start, start + duration)` with no buffer, so two back-to-back
appointments both commit. The new Calendar settings tab says so out loud rather than implying it
works; making it real needs the constraint widened, which is DDL.

---

## D. Built, but waiting on a migration being applied

Three migrations parse and are not applied. Until they are, the web-app behaviour below is wrong
rather than missing.

| Migration | What is wrong until it lands |
|---|---|
| ~~`20260922180000_la_2_12_booking_notice_links_somewhere`~~ | **Withdrawn 2026-09-23 — the fix was the wrong way round.** It repointed the booking notification away from `/app/calendar` because that page did not exist. The link was right and the page was missing; `/app/calendar?appointment=<id>` is now built and highlights the appointment, so the notification works as originally written and the migration was deleted |
| `20260922190000_la_2_14_deal_date_and_policy_attribution` | An outbound sale files against the **UTC** date, so for a Pacific tenant the whole evening calling block lands on tomorrow and is missing from Daily deal flow, which defaults to today. Also extends the lineage view to the issued policy, so a policy that lost its campaign is visible |
| `20260922200000_la_2_18_size_warning_means_something` | The campaign comparison's "sizes differ" warning fires on **any** inequality, so it is on for every comparison and carries no information. Becomes a 2:1 ratio with both counts in the message |
| `20260917146000_la_2_2_imported_leads_reach_the_dialer` | CSV-imported leads are not enqueued, so an imported list cannot be dialled. The dialer honestly reports "Nothing servable" and nothing connects that to the cause. Also carries the `import_agent_lead_source` call, so **LA-2.20's "one lead, many sources"** does not happen either |
| `20260917140000` (`tenant_campaign_costs`) | **Apply this one first.** The import reads `tenant_campaign_costs` before committing and throws when it is absent, so **no lead is ever given a `campaign_id`** — measured: 0 of 214,823. That starves LA-2.17 (no input at any hop, cost per issued policy uncomputable), LA-2.19 (no claimable evidence) and LA-2.20 (`tenant_lead_sources` empty). It is upstream of everything the last three audits measured |

**Correction to an earlier record:** `/api/app/campaigns` and `/api/app/vendors` were previously noted
as returning 500 from unapplied migrations. Both were re-checked live in an authenticated session on
2026-09-22 and **return 200**, as do true-cpa, nurture, assignments, activity, scoring, vendor-returns,
appointments and availability. That note is stale.

---

## E. Declined by decision — do not build these without a new one

From §19 of *Module 2 — Outbound Lead Acquisition*. Listed here so they are not re-raised as gaps in a
future pass. Each is a decision with a stated cost, not an oversight.

Licence and territory filter at import · list health report · cross-vendor duplicate flag ·
test-batch purchasing · inbound caller lookup · outbound lead workspace · global search across
outbound leads · missed-call follow-up queue · manual single-lead entry · daily pacing and goals ·
bulk actions and reassignment · dialable-now by state · outbound lead export.

The module doc names **the licence and territory filter** as the one to revisit first: it is the only
item that costs money on every import, is invisible while it happens, is a legality question rather
than a convenience, and is small — `canWrite()` already exists in LA-0.5.

Two more are decisions rather than gaps and are recorded elsewhere in the audit:

- **LA-2.15 / LA-2.16** (carrier autofill extension and field maps) are `Cancelled`, superseded by
  LA-3.12 / LA-3.13 / LA-3.14. Nothing is built and nothing should be. Pinned by
  `lib/carriers/cancelledAutofillStaysCancelled.test.mjs`.
- **Click-to-call only** — no provisioned numbers, no local presence, no recording. §10 of the module
  doc lists the four things that costs, and the seam is open (`provider_call_id` is nullable from the
  start).

---

## F. Suggested order

The ordering is by what unblocks the most, not by effort.

1. **A1 — the disclosure publisher.** Nothing else in the module can be used until dialing is
   possible. Admin screen plus a seed.
2. **D — apply the three migrations.** They are written; two of them fix wrong numbers rather than
   missing ones, which is worse.
3. **B2 — the cadence editor.** It is a stated acceptance criterion and the only one in LA-2 that is
   unmet purely for want of a screen.
4. **B5 — lead-post keys.** A ping-post vendor cannot be onboarded without it, and real-time leads are
   the highest-value kind.
5. **B3 and B4 — the DNC list and the consent locker.** Both are compliance surfaces that are needed
   at the moment a complaint arrives, which is the worst moment to discover they do not exist.
6. **B1 — calling-window settings.** The defaults are safe, so this is inspection rather than
   enforcement.
7. **C1 — the calendar views.** Real, and the least likely to hurt anybody.

---

## Method

Everything above is reproducible.

- **Board statuses** — SQL against the sprint data source, filtered to `Module = 'LA-2'`. 24 rows: 22
  `Completed`, 2 `Cancelled`.
- **Table row counts** — `select count(*)` through PostgREST with the service role, against the
  project in `.env.local`.
- **"No app writer"** — every `.ts`/`.tsx` under `lib/`, `app/` and `components/`, excluding
  `database.types.ts`, scanned for `from("<table>")` followed within one statement by `.insert(`,
  `.upsert(`, `.update(` or `.delete(`. The window stops at the next `from(` so a write on the
  following line of a `Promise.all` is not miscounted as a write to the table above it.
- **Route health** — fetched from an authenticated browser session, not curl, so a 401 is not mistaken
  for a working screen.
- **Nav coverage** — `lib/menu/definition.ts`; an entry without `built: true` has no page behind it.

---

## G. The workflow, hop by hop

Added 2026-09-23. The outbound journey as stated by the product owner, each hop checked against the
build:

```
CSV import ──► LEAD LIST ──► LEAD ASSIGNMENT ──► DIALER ──► DISPOSITION ──► PIPELINE
```

| Hop | State |
|---|---|
| **CSV import** | Built — `/app/import`, with mapping, preflight, review and a transactional commit. **Broken in practice**: the commit reads `tenant_campaign_costs`, which does not exist, so a campaign-attributed import throws before it writes. 0 of 214,823 leads carry a `campaign_id` |
| **Lead list** | **No screen.** See below |
| **Lead assignment** | Built as **rules**, not as a list — `/app/assignments` configures match order, capacity and rest days. Nothing shows a set of leads to act on |
| **Dialer** | Built, and setters can now reach it. **Serves nothing** until `20260917146000` lands: imported leads are never enqueued into `lead_queue`, and `serve_next_lead` reads only `lead_queue` |
| **Disposition** | Built — one vocabulary, eight outcomes, `counts_as_work_completed` and `closes_as` as columns |
| **Pipeline** | Built, and **now routes per disposition** — see `20260922220000` |

### The lead list has no screen, and that is the one structural gap

The product owner's model separates the two deliberately: *"the lead list is different from the
pipelines."* The list is **inventory** — what was bought, what is left, what has not been touched.
The pipeline is **what happened to it**.

Today there is no such screen. `agent_lead_import_batches` exists but is an idempotency ledger —
key, status, response — not a browsable list of what a batch contained. Imported leads land in
`agent_leads` and appear in `/app/leads`, which is organised **by pipeline**. So the only way to look
at a list is through the view the model says is a different thing.

What a lead-list screen would need, in that model:

- One row per import batch: vendor, campaign, when, how many bought, how many usable after the scrub
- Drill into a batch: the leads it contained, and their current state — never dialled, in progress,
  exhausted, suppressed
- The handle assignment works from, so "assign these 400 to these three people" has a place to happen

That is a screen, not a fix, and its shape is a product decision — so it is recorded here rather
than built.

---

## H. Three screens checked against their own documentation

Added 2026-09-23, at the product owner's request: lead assignment, lead recycling, appointments.

### Lead assignment — one refusal was announced as a success

Everything LA-2.24's rule chain describes is on the screen: all five match types (campaign, state,
language, product, fallback), priority, assignees, per-person capacity, rest days, and the licensing
constraint. Two things were not right.

**A sticky lead reported as reassigned.** `assign_lead` refuses in two ways and only one is an error.
No eligible assignee — everyone full, or nobody licensed for the lead's state — raises
`NO_ELIGIBLE_ASSIGNEE` and surfaces correctly. **Sticky ownership returns HTTP 200** with the lead
exactly where it was and `"reason": "Active ownership is sticky until disposition"`. The screen
parsed that body and discarded it, then said the reassignment succeeded.

That is the one case where the screen claimed a lead moved and it had not — and it is the case that
matters most, because sticky means somebody is on the phone with that customer right now. Fixed: the
refusal is surfaced with the server's own reason. The same check was added to the new lead-list
screen, which would otherwise have counted a sticky lead among the assigned.

**Assigning requires typing a work-item UUID.** There is no list to act on — the pool actions take a
UUID by hand. That is what `/app/lead-lists` now exists for.

### Lead recycling — complete, and it never said whether it works

Every rule LA-2.20 asks for is configurable: wait days, maximum recycle count, and the allowed
dispositions. `RECYCLABLE_DISPOSITIONS` is `["no_answer", "voicemail", "not_interested"]`, so
**`do_not_call` is not offerable** — the task's "DNC never" is structural rather than a validation.
Re-scrub on reactivation is there, with the screening result per lead, and the eligible count is
shown before anything runs.

The gap was the last line of the task's own scope: *"recycle performance reported: contact and
conversion rate of recycled versus fresh."* It **is** reported — on Activity & scorecard, which
LA-2.21 owns — and nothing on the recycling screen said so. The person setting a recycle rule had no
route to the only number that says whether recycling is worth doing. A pointer now sits under the
page title.

### Appointments — the word means two different things, and the nav picked the wrong one

| | |
|---|---|
| **Fixed** | The nav item **"Appointments"** pointed at LA-0.5's carrier vault — which carriers the agent is appointed with, plus licences, E&O and CE. Anyone looking for their customer calendar landed on licensing records. Relabelled **"Carrier appointments"**. The collision has cost something before: LA-2.8's first draft joined `public.appointments` for its appointment tier and would have served leads on the strength of a licensing record |
| **Open** | **No day or week calendar.** LA-2.11's *Views* scope asks for one; booking happens in the dialer and there is nowhere to see the diary |
| **Open** | **No "today's appointments" on the dashboard.** The only appointment tile there is a setup-checklist item for the carrier vault |
| **Open** | **The close-out strip is on Activity, not the dashboard.** Decision 12 is specific — *"appears in a short strip at the top of his dashboard the next morning: three appointments, three buttons each. Ten seconds."* It works where it is, so this is a placement decision rather than a defect, but it is not where the decision put it |

The three open items are all "where Ray looks", which is a product call rather than a bug, so they
are recorded here rather than moved.
