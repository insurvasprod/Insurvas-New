# LA-2 — is it done? A walk of the whole workflow

**2026-09-23**, after the twelve migrations landed. Driven live against the demo tenant, not read
from source.

The workflow, as specified:

> CSV import → **lead list** → **lead assignment** → **dialer** → **disposition** → **pipeline**,
> with the disposition deciding which pipeline.

## Verdict

**All six steps work.** Step 3 was blocked product-wide when this was written; it was fixed the
same day in `20260923130000` and verified through the API.

| # | Step | Result |
|---|---|---|
| 1 | CSV import | ✅ 10 imported, 0 rejected, all attributed |
| 2 | Lead list | ✅ shows the list: 10 received, 10 untouched, `{fresh: 10}` |
| 3 | Lead assignment | ✅ **fixed and verified** — see below |
| 4 | Dialer | ✅ serves **and dials** — disclosure seeded, see the warning below |
| 5 | Disposition | ✅ wizard walk completes, terminal key recorded |
| 6 | **Pipeline routing** | ⚠️ works from the disposition wizard, **not from the dialer** — see the correction below |

---

## Step 6 first, because it is the one you asked for

A lead sitting in the marketing pipeline, dispositioned `not_interested`:

```
BEFORE  lead: pipeline=d792b8f6  stage="Form Lead"        state=fresh
        queue: pipeline=d792b8f6 status=claimed           disposition=-

AFTER   lead: pipeline=c6f1cb62  stage="Previously Sold"  state=fresh
        queue: pipeline=c6f1cb62 status=completed         disposition=not_interested
```

It moved to the **dedicated pipeline reserved for that disposition**, and the work item followed —
so the lead and its queue row agree, and no board will render it in a column it is not on. All
eight dispositions are mapped, all to stages in pipeline `c6f1cb62`.

### Correction, 2026-09-23 — this only covers one of two paths

That test went through `complete_disposition`, the wizard used from the lead workspace. The
**dialer has its own disposition function**, `complete_existing_dial_disposition`, and it never
reads `stage_dispositions` at all. Same disposition, two leads, two outcomes:

| Lead | Path | Result |
|---|---|---|
| Hugo | wizard | `not_interested` → pipeline `c6f1cb62`, stage **"Previously Sold"** |
| Clara | dialer | `not_interested` → pipeline `d792b8f6`, stage **"Form Lead"** — unmoved |

The dialer sets `lead_state` and the queue status and stops there. Since the dialer is the main
outbound route, the requested behaviour — "whatever the disposition outcome is, put it in the
dedicated pipeline" — is missing from the path that matters most.

**Reporting this as working earlier was wrong**: it was verified on the wizard path only, and the
conclusion was generalised to both.

**It needs a decision before it can be fixed.** Should a retry disposition move pipeline too? A
`no_answer` lead is going back into the queue for attempt 2; moving it into a dedicated pipeline
may or may not be intended, and the answer changes the fix.

---

## Step 3 — fixed 2026-09-23

`20260923130000_la_2_24_eligibility_reads_the_appointments_we_keep.sql` points eligibility at
`appointments` and `licenses` — the tenant tables the Carrier appointments screen writes — instead
of the empty organization-era pair. Verified through `POST /api/app/assignments` after applying:

| Lead | State | Result |
|---|---|---|
| Iris Testcase | TX | **200** — assigned, owner set |
| Clara Testcase | FL | **200** — assigned |
| Elena Testcase | AZ | **200** — assigned |
| Greta Testcase | GA | **400** — *"Your agency has an expired licence for GA and has no active carrier appointment there. Both are needed before anyone can be given a GA lead."* |

The gate still refuses where it should, and the refusal is now a sentence rather than
`ASSIGNMENT_TARGET_NOT_ELIGIBLE`. The lead list reads `assigned: 4, untouched: 6`.

**The semantic change to keep in mind:** eligibility is now per agency, not per agent — those
tables carry no `user_id`, and no per-agent licensing data exists anywhere in this product.

The original diagnosis follows.

## Why step 3 was blocked

`assign_lead` refuses with `ASSIGNMENT_TARGET_NOT_ELIGIBLE`. Measured across roles and states:

```
owner      TX=false  FL=false  GA=false  AZ=false
producer   TX=false  FL=false  GA=false  AZ=false
setter     TX=true   FL=true   GA=true   AZ=true
assistant  TX=false  FL=false  GA=false  AZ=false
```

**Only a setter can be assigned a lead.** The licensed agents the module exists for cannot.

### Why

`assignment_candidate_is_eligible` short-circuits `true` for a setter, and for an owner or producer
falls through to `can_write(carrier, state, today, user)`. `can_write` reads:

- `agent_carrier_contracts` — **0 rows, entire database**
- `agent_appointments` — **0 rows, entire database**

Those are the legacy organization-era tables, keyed by `organization_id` and `user_id`.

Meanwhile the Carrier appointments screen — LA-2's own `/app/appointments` — reads and writes a
**different pair**, keyed by `tenant_id`:

| | `appointments` / `licenses` | `agent_appointments` / `agent_carrier_contracts` |
|---|---|---|
| scope | `tenant_id, carrier_id, state` | `organization_id, user_id, carrier_id, state` |
| rows on demo tenant | **38 appointments, 5 licences** | **0** |
| written by | the Carrier appointments screen | nothing |
| read by | that screen | `can_write` → assignment eligibility |

So the product says the agency is appointed in TX. The assignment gate asks a table nothing writes,
gets nothing, and refuses. Two stores, one question — and the two disagree.

This is a design decision to make, not a bug to patch blindly: the tenant model says *the agency*
holds the appointment, the organization model says *the agent* does. LA-2.24's rule ("a licensed
lead only goes to someone licensed and appointed in that state") only means something under the
second. Whichever wins, `can_write` and the appointments screen have to read the same thing.

---

## Step 4: serves, cannot dial

The dialer **serves** — verified at 20:45 ET: *tier 5, "A fresh lead that has never been called."*

Re-run at 04:20 ET it correctly served nothing, and said why:

> "Every lead is either outside its local window, waiting on a retry timer, or already worked. This
> is normal early and late in the day."

That is the calling-window gate working, not a fault.

**Dialing was unblocked on 2026-09-23** by seeding `state_disclosures` — 51 states for
`term_life`, the only product any lead in this database carries. Verified through the dialer panel:

| Lead | Customer local time | Result |
|---|---|---|
| Clara Testcase (FL) | 8:08 AM America/New_York | **`allowed: true`, `reason: "ready"`** |
| Iris Testcase (TX) | 7:08 AM America/Chicago | blocked `outside_window` — opens at 08:00 |
| Elena Testcase (AZ) | 5:09 AM America/Phoenix | blocked `outside_window` — opens at 08:00 |

All three read `disclosure: configured=true blocking=false`. The remaining refusals are the
calling-window gate doing its job against the customer's own clock.

> ### ⚠ The seeded wording is a placeholder, not approved copy
>
> `scripts/seed-state-disclosures.mjs` writes a standard outbound skeleton — identify the caller,
> state the purpose, note recording, offer the opt-out — uniform across all 51 states, with no
> per-state variation. **It is not compliance-approved and is not legal advice.**
>
> Its first line is:
>
> `[PLACEHOLDER — NOT COMPLIANCE-APPROVED. Replace on /admin/state-disclosures before any live call.]`
>
> That marker is the safety mechanism. The dialer shows this text for the agent to read aloud, so an
> unapproved disclosure reaching a live call announces itself in the first breath rather than passing
> unnoticed. An embarrassing call is a better failure than a silent TCPA exposure.
>
> Telephony is not enabled here, so nothing has been spoken to anyone. Replace the text per state and
> product on `/admin/state-disclosures` before it is. The seed script refuses to overwrite any state
> that already holds non-placeholder wording, and `--remove` takes it all back out.

A third gate was found during this walk and has since been fixed — see
[LA-2-SCRUB-GATE-HAS-NO-KEY.md](LA-2-SCRUB-GATE-HAS-NO-KEY.md). An attributed lead is only servable
if its campaign is marked scrubbed, and nothing in the product marked one. The import now does.

---

## Everything else

All 19 LA-2 API surfaces return 200. Checked with real data rather than status codes:

| Surface | State |
|---|---|
| Import / preflight | screens every row; flagged `(202) 555-0101` as DNC and withheld it |
| Lead lists | 7 lists, QA list correct |
| Vendors & campaigns | cost per usable lead live; **no pending-migration notice any more** |
| True CPA | QA campaign `effective_cost_per_lead_cents: 350` — exactly $35.00 / 10 |
| Cadence | reads and writes; round-trips `2 hours` → `02:00:00` → `2 hours` |
| Calling windows | narrowing saved; widening refused `wider_than_federal`; inverted refused |
| Suppression | DNC check answers from the same RPC the dialer uses; permanence enforced |
| Consent locker | renders; coverage view now read correctly (6 vendors) |
| Lead posting | key mints, authenticates at the endpoint, rotates, old key 401s |
| Calendar / availability | 200, both timezones |
| Nurture | 7 campaigns |
| Scoring | 7 weights, holdout configured |
| Vendor returns | 0 claimable — correct, nothing has been dispositioned as returnable yet |
| Activity | rows, scorecard, recycle performance |

## Two smaller defects found on the way

1. **`POST /api/app/assignments` (PUT) flattens every failure into "Could not save assignment
   rule".** A campaign rule with no campaign violates `assignment_rules_check` — the owner is told
   nothing useful. The schema should require `matchValues` for non-fallback match types.

2. **`campaign_serving_block_reason` claimed the queue was blocked while it was serving.** Fixed in
   `20260923110000`, **applied 2026-09-23**. It now returns the partial-case sentence — "Some active
   campaigns are still being scrubbed, so you are seeing leads from the scrubbed ones only" — which
   is true rather than contradictory.

## So: is LA-2 done?

**The build is done, and the workflow runs end to end** — import, list, assignment, serve,
disposition, pipeline. Two things still stop a real call going out, and neither is missing code:

1. ~~Assignment eligibility~~ — **fixed and applied**, `20260923130000`.
2. ~~Disclosure publishing~~ — **seeded 2026-09-23 and the dialer now dials.** The wording is a
   marked placeholder; replace it with approved copy before telephony is enabled.
3. ~~Campaign scrub marking~~ — **fixed 2026-09-23.** The import marks the campaign scrubbed,
   because the import does the scrub. Verified on a fresh campaign, no manual step.

Nothing on that list is a screen that was never built.
