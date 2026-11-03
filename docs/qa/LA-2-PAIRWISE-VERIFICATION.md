# LA-2 · pairwise verification sweep

Started 2026-09-17. Every LA-2 task checked two at a time against its **Notion acceptance criteria**
— not against its board status, and not against the existing local audit documents, both of which
have been wrong about this module before.

## Scope

The Insurvas Sprint database contains **LA-2.1 through LA-2.24**. There is no LA-2.25. Earlier
passes recorded LA-2.25 as "blocked: no authoritative task record"; the correct answer is that it
does not exist, so it is **N/A** rather than blocked.

## How a criterion is scored here

| Verdict | Means |
|---|---|
| **PASS (live)** | Proven against the deployed database or a passing test, this sweep |
| **PASS (contract)** | Proven by a test that reads the SQL and the TypeScript and asserts they agree |
| **BUILT, deploy pending** | Written and parse-checked; needs DDL authority this session does not have |
| **FAIL** | Checked and found not to work |
| **N/A** | Not in the task inventory |

## Environment facts that bound this sweep

- **No DDL.** The only database credential available is `TENANT_DB_URL`, which connects as
  `tenant_app`: `rolsuper = false`, `has_schema_privilege('public','CREATE') = false`. The Supabase
  MCP returns "permission denied" for `apply_migration` and `execute_sql`. Migrations written here
  are therefore parse-checked and contract-tested, and carry self-verifying `DO` blocks that assert
  their own acceptance arithmetic the moment someone with DDL authority applies them.
- **A second session is editing this working tree**, on LA-1 and partner markets. Gate results
  flicker between runs for reasons that are not this work. Baseline at the start of this sweep was
  **534 tests, 530 pass, 4 fail**, all four in LA-1/partner-markets files. Two of those four are
  LA-2/LA-0 drift guards catching genuine violations in *that* session's new code, which is what
  they were built for.

---

## Pair 1 — LA-2.1 and LA-2.2

### LA-2.1 · Lead vendors & campaigns

| # | Criterion | Verdict |
|---|---|---|
| 1 | Every lead carries its `campaign_id`, and it survives into the application and the policy record | **PASS (live)** |
| 2 | Effective cost per record changes when a credit is recorded, and the change is visible | **PASS (contract)** — was unreachable |
| 3 | Pausing a campaign stops its leads being served within seconds | **PASS (live)** |
| 4 | A vendor rollup exists that sums its campaigns correctly | **PASS (live)**, now visible |
| 5 | Two active campaigns with weights 4 and 2 serve roughly 2:1 | **PASS (live)** |

**c1 — live proof.** `campaign_id` is present at every hop in the deployed database:
`agent_leads` → `tenant_lead_sources` → `deal_flow` → `tenant_application_cases` →
`tenant_issued_policies`. The LA-2 checklist recorded the last hop as the open one; it is closed.

**c3 — live proof.** `campaigns_servable` is
`where status = 'active' and scrub_status = 'scrubbed'`. Pausing sets `status = 'paused'`, so the
campaign leaves the serving view in the same statement. Nothing is deleted. This is also LA-2.3's
hard gate, proven in the same line.

**c5 — live.** `next_campaign_for_serving(p_tenant_id)` is deployed, and its migration carries a
3,000-draw `DO` block asserting the 2:1 ratio, which passed when it was applied.

**c2 and c4 — the real gap was that nothing rendered them.** The tables, the derived cost columns
and `tenant_vendor_rollup` all existed and **no screen read any of them**, so "the change is
visible" had nowhere to be visible and the vendor rollup had no reader. Built this pass:

- `/app/campaigns` — vendor rollup table plus per-campaign cost, pause/activate, and editable
  spend, records purchased and mixing weight, in the Brex portal layer.
- `GET/POST/PATCH /api/app/vendors` — the rollup's first reader.
- `GET /api/app/campaigns` now reads `tenant_campaign_costs` rather than `tenant_campaigns`.
- `PATCH /api/app/campaigns/[id]` accepts the spend fields, so the derived cost can change from
  inside the product. It re-reads through the cost view and returns the recomputed number, so the
  screen shows the change rather than a stale value.

`credits_received_cents` is deliberately **not** editable from this screen. A credit is the outcome
of a vendor return claim (LA-2.19) and must arrive through that ledger; typed into a form it has no
evidence behind it and the effective cost becomes a matter of opinion.

**Security consequence, taken deliberately.** `campaigns/` and `vendors/` were classified
`neutral` in the money-boundary drift guard. They now return spend and cost per lead, so both were
reclassified as **money routes**. An assistant and a setter can no longer reach them, and the menu
entry is owner/producer only — the same boundary the API enforces, so no role sees a screen the API
will refuse.

### LA-2.2 · List import

| # | Criterion | Verdict |
|---|---|---|
| 1 | A vendor file with completely different headers imports without editing the file | **PASS (contract)** |
| 2 | The mapping is remembered and pre-applied on that vendor's next file | **PASS (contract)** |
| 3 | A failure at any step leaves zero rows imported | **PASS (contract)** |
| 4 | The preview shows what will be imported, rejected and suppressed, before anything is written | **was FAIL — now BUILT** |
| 5 | Cost per usable lead is correct after scrub rejections | **was FAIL — now BUILT, deploy pending** |
| 6 | A 20,000-row file imports without the browser running out of memory | **was FAIL — now BUILT, deploy pending** |
| 7 | Normalisation has unit tests | **PASS (live)** |

#### c5 was not implemented at all, and it costs money

Live inspection of `tenant_campaigns` found no `records_rejected`, no `records_usable` and no
cost-per-usable column. Both deployed cost columns divide by `records_purchased`. The task's own
worked example divides by something else:

> $1,750 paid · 5,000 rows · 180 rejected at scrub → 4,820 usable → **$0.363** per usable lead

$1,750 / 5,000 is **$0.350**. The purchased basis understates the cost of a dialable lead by 3.7%
here and by far more on a dirty list — and that number feeds LA-2.17's cost per issued policy,
which decides which vendor gets next month's money. Understating it means buying more of the worse
list.

**Rejections are recorded as evidence rows, not as a counter.** Two reasons, the second deciding:
a counter can drift from what it counts, and the LA-2.1 migration already says so out loud; and
LA-2.2 states the gap between purchased and usable *is* the vendor return claim in LA-2.19. A claim
needs to name which 180 numbers, and "180" is not an answer.

`20260917140000_la_2_2_usable_row_cost_allocation.sql` adds:

- `tenant_campaign_scrub_rejections` — append-only, unique on `(tenant, campaign, phone)` so a
  retried import cannot bill a vendor twice, readable by `tenant_app` and **writable only by the
  service role** (a tenant that could insert rejections could manufacture a credit claim).
- `tenant_campaign_costs` — derives `records_rejected`, `records_usable`,
  `cost_per_usable_record_cents` and `rejected_spend_cents`. A view, because the count is a count
  over another table and a generated column may not contain a subquery.
- `tenant_vendor_rollup` replaced to carry usable rows, still summing before dividing.
- A `DO` block that asserts the task's own example: 5,000 purchased, 180 rejected, 4,820 usable,
  36.3 cents, and that re-recording the same rejections records zero.

#### c4 — a scrub hit rejected the *file*, not the row

`importAgentLeads` threw on the first `dnc` or `tcpa_litigator` outcome, aborting the whole import.
That made the task's own 5,000/180/4,820 outcome unreachable: one litigator in a 5,000-row list
meant **nothing imported** and one row number on screen, and the only way through was to edit the
vendor's file by hand — which is how a suppressed number eventually gets dialed.

Now a definite hit rejects the row, records the evidence and continues. An **outage still fails the
whole file**, because LA-2.3 criterion 4 is that a vendor outage blocks dialing rather than passing
numbers through: `unavailable` means we do not know whether the number is safe. `internal_dq` is
not a rejection — it means the number matches a lead Ray already has, which the duplicate pass
resolves by reusing that lead, and counting it would claim a vendor credit for his own duplicate.

**Ordering is deliberate.** Two RPCs cannot share a transaction, so the rejection evidence is
written *before* the leads. A crash between them then overstates cost rather than understating it,
and an overstated lead cost makes Ray buy less of a list rather than more of a bad one. The ledger
is idempotent, so a retry corrects the count.

#### c6 — three separate defects, all real

1. `MAX_LEAD_IMPORT_ROWS = 2_000` refused a 20,000-row file outright, and
   `import_agent_lead_batch` refused a batch over 2,000. Both are now 20,000, and a test asserts
   they agree — otherwise the server accepts a file the database will reject after the upload.
   One transaction rather than ten chunks, because chunking would contradict criterion 3.
2. `rows.indexOf(row)` was called **five times per row inside a `.map()`** — O(n²), roughly two
   billion comparisons at 20,000 rows. It was also wrong: `indexOf` finds the first structurally
   identical row, so two identical vendor lines were stamped with the same screening result.
3. `previewLeadCsv` parsed the whole file **twice** per call (once itself, then again via
   `parseLeadCsv`), materialised 20,000 typed objects to render three of them, and the component
   called it **on every render, unmemoised**. It now shares one column plan with the write path,
   counts without collecting, and is memoised on the file and the mapping.

The preview also reports **every** bad row, bounded and with a remainder count, instead of throwing
on the first one — Ray previously fixed one row, re-uploaded, and met the next.

### Gate after this pair

| Check | Result |
|---|---|
| `npm test` | 544 tests, 539 pass, **5 fail — all five in the other session's LA-1/partner files** |
| `npm run typecheck` | clean |
| `npm run db:check` | every file parses |
| `npm run lint` | 2 errors, both in the other session's `deal-flow-workspace.tsx` |

New tests: `lib/agentTemplates/usableRowCost.test.mjs`, 10 cases, all passing.

### Deploy-pending list for this pair

- `supabase/migrations/20260917140000_la_2_2_usable_row_cost_allocation.sql`
- `supabase/migrations/20260917141000_la_2_2_twenty_thousand_row_batch.sql`

Until both are applied, `tenant_campaign_costs` does not exist, so `/app/campaigns` and the import
cost lookup will error rather than silently show a wrong number. That is the intended failure
direction: a missing cost basis is visible, a wrong one is not.

---

## Pair 2 — LA-2.3 and LA-2.4

### LA-2.3 · Suppression & scrub engine — hard gate

| # | Criterion | Verdict |
|---|---|---|
| 1 | An unscrubbed campaign serves zero leads, and the dialer explains why | **PASS (live)** |
| 2 | A litigator hit is never servable under any code path — asserted by test | **PASS (test)** |
| 3 | "Do not call" adds the number permanently, and a later import is rejected at scrub | **was FAIL — now BUILT, deploy pending** |
| 4 | A vendor outage blocks dialing rather than passing numbers through | **PASS (live + test)** |
| 5 | Re-scrubbing a campaign suppresses numbers added to a registry since import | **PASS (live)** |
| 6 | Every check appears in the audit record with its raw response | **PASS (test)** |

**c1 — live.** `campaigns_servable` is `where status = 'active' and scrub_status = 'scrubbed'`, and
`serve_next_lead` filters through it. Not a badge: the queue returns nothing.

**c2 — the ordering is the safety property.** `is_phone_suppressed` returns one row for a number
that may be on several lists, ranked `tcpa_litigator → internal → federal_dnc → state_dnc`. If an
internal note outranked a litigator hit, the number would report as "internal" — which an operator
may believe is overridable — when it is never dialable under any circumstance.

**c4 — live.** `markDialClicked` re-screens at the click, not only at panel load, and a vendor error
becomes `DialGateError("dnc_unavailable", 503)`. 503 and 422 are kept distinct: 503 says "we could
not tell", 422 says "we checked and the answer is no". The import side now matches, after pair 1.

#### c3 was failing, and the reason was a second suppression table

There are two suppression stores and `is_phone_suppressed` reads both:

| Table | Holds | Permanence |
|---|---|---|
| `tenant_suppression_list` | federal DNC, state DNC, litigator, invalid | trigger refuses DELETE and key UPDATEs |
| `tenant_do_not_call` | **the internal list — what "do not call" writes** | only a `touch_updated_at` trigger |

`is_phone_suppressed` filters the second on `is_active`, so clearing that flag makes a number Ray
promised never to call again dialable — and nothing stopped it: `tenant_app` holds `update` on the
table and its RLS policy is `for all`.

Nothing in the product does this. Every write is an upsert touching only `lead_id`, `added_by` and
`updated_at`, and **no code path anywhere sets `is_active = false`**. That is what made it worth
closing rather than debating: the capability was open by accident, so nothing is lost by removing
it.

The earlier audit filed this as an open product question — "the spec says permanent, the column
allows deactivation, one of the two is wrong". The task page decides it twice: the suppression
table lists the internal list as *Overridable: No*, and the in-scope bullet says **permanent**. So
the column was wrong. `20260917142000_la_2_3_internal_dnc_is_permanent.sql` refuses DELETE and the
`true → false` transition while still allowing the re-suppression upsert the disposition path
depends on — a permanence rule that broke re-suppression would stop "do not call" recording
anything at all, which is worse than the bug.

### LA-2.4 · Calling-window engine

| # | Criterion | Verdict |
|---|---|---|
| 1 | A hand-crafted API request for a lead outside its window returns nothing | **PASS (live)** |
| 2 | A state with a tighter statute is enforced over the federal default | **PASS (test)** |
| 3 | Sunday and holiday rules are honoured per state | **PASS (test)** |
| 4 | Correct across DST and in `America/Phoenix` — asserted by test | **PASS (test)** |
| 5 | Tenant settings can narrow the window and cannot widen it | **PASS (test)** |
| 6 | The dialer never shows an enabled action on a lead it may not legally dial | **PASS** |

`lib/callingWindow/engine.test.mjs` is 26 cases and covers the criteria directly, including
"a state rule that tries to be LOOSER than federal is ignored", "07:00 in Phoenix is refused in both
January and July — the rule does not drift with DST", "across the spring-forward boundary the answer
follows the wall clock, not the offset", and "a lead with no state is refused, never defaulted to
Eastern".

**c1** is enforced where it cannot be routed around: `serve_next_lead` calls
`tenant_can_dial_now(tenant, state, campaign, at)` inside the SQL, and both `startDialAttempt` and
`markDialClicked` re-check before a number is ever opened.

**c6** — the task page notes the old dialer "shows a red chip and leaves every button enabled". Both
*Prepare call* and *Start call* are now `disabled` on `!eligibility.allowed`, the label becomes
"Dialing blocked", and the server's reason is exposed through `aria-describedby` on a
`role="status"` element.

#### The one open item is legal, not technical

Live: `calling_window_state_rules` holds **52 rows** — 44 carry `source = 'platform_federal_default'`
(08:00–21:00, all days, holidays blocked) and 8 cite a real statute but are marked **(unreviewed)**,
for AL, FL, IN, LA, MS, NJ, OK and WY. Florida correctly excludes Sunday and cuts off at 20:00.

The mechanism is proven; the *data* for 44 states is the federal fallback. That is the legally safe
default rather than a wrong answer, but it is not the same as having reviewed 44 statutes, and the
8 citations need a lawyer's sign-off. Recorded as a named dependency, unchanged from the earlier
audit.

---

## Pair 3 — LA-2.5 and LA-2.6

### LA-2.5 · Real-time lead post API & speed-to-lead

| # | Criterion | Verdict |
|---|---|---|
| 1 | A posted lead is on screen in under 5 seconds end to end, including the scrub | **PASS (server half)** — browser measurement needs credentials |
| 2 | A litigator or duplicate is rejected with a specific reason code the vendor can act on | **PASS (test)** |
| 3 | Real-time leads are served ahead of every list lead regardless of scoring | **PASS (live)** |
| 4 | Speed-to-lead is computed per vendor and **visible** | **was FAIL — now BUILT, deploy pending** |
| 5 | A vendor hammering the endpoint is rate-limited without dropping legitimate posts | **PASS (live)** |
| 6 | A scrub-vendor outage rejects rather than accepting unscrubbed | **PASS (test)** |

**A collision that turned out not to be one.** Both generations of these tables are live —
`vendor_post_keys` / `lead_post_log` / `consent_artefacts` from the organizations-era CRM, and
`tenant_vendor_post_keys` / `tenant_lead_post_log` / `tenant_consent_artefacts` from LA-2. The task's
Data block names the *older* set. `lib/leadPost/service.ts` reads only the `tenant_` generation, so
this is a naming overlap and not a defect like the SA-3 invoices were. Recorded so the next reader
does not have to re-derive it.

**c2 — reason codes.** `suppressed_litigator`, `suppressed_dnc`, `suppressed_internal`,
`duplicate`, `invalid_phone`, `rate_limited`, `scrub_unavailable`. The task's framing is
"rejections are the billing mechanism": a vendor reconciling an invoice needs to know that lead
4821 was refused as a litigator hit, not that something went wrong.

**c3 — live.** `serve_next_lead` puts a lead posted within the last five minutes in priority tier 1
and settles the tier before ranking within it, so a high-scoring list lead cannot overtake a lead
that arrived thirty seconds ago. The current implementation sorts by priority rather than
sub-selecting the minimum — a deliberate performance fix, since naming the CTE twice materialised it
— and the test asserts the property rather than either shape.

**c5 — live.** `LEAD_POST_PER_KEY` is 600/hour **per key**, returning 429 with `retry-after`. Per
key rather than global is the criterion: a global limit would let one vendor's runaway retry loop
lock out every other vendor, which is exactly "dropping legitimate posts".

#### c4 — computed correctly, and nothing had ever read it

`tenant_speed_to_lead` exists, is correct, and a repository-wide search found **no reader outside
the audit document that scored it PASS**. The task says why that is not enough: the number is
"shown to Ray as his own number, because it is a number he can improve". A median nobody sees
improves nothing.

The existing view groups by `(tenant, vendor, campaign)`, so it cannot answer the vendor-level
question: **a median cannot be averaged.** The mean of three campaign medians is not the median of
anything, and one tiny fast campaign would flatter the vendor — the same "average of averages" trap
the LA-2.1 rollup calls out for cost. `20260917143000_la_2_5_2_6_vendor_speed_and_coverage.sql` adds
`tenant_vendor_speed_to_lead`, computing the median over the vendor's own leads, with two
deliberate choices:

- Undialled leads are **excluded** from the median rather than counted as zero seconds, which would
  make a vendor look better the more of its leads went uncalled.
- The share under 60 seconds is over leads **posted**, not leads dialled. Over dialled leads it
  would report 100% for a vendor whose single answered lead was fast and whose other nine hundred
  were never called.

Its `DO` block asserts both: 30s/45s/600s/never gives a median of **45** (not the mean of 225) and
**50%** within 60s over four posted leads (not 66.7% over three dialled).

### LA-2.6 · Consent artefact capture

| # | Criterion | Verdict |
|---|---|---|
| 1 | A certificate is claimed and stored within the provider's expiry window | **BLOCKED** — provider credentials |
| 2 | Certificate presence and age are visible on the lead before it is dialed | **PASS (live)** |
| 3 | Coverage per vendor is **reported** as a percentage | **was FAIL — now BUILT, deploy pending** |
| 4 | A lead with no certificate is flagged, not suppressed | **PASS (test)** |
| 5 | The stored copy survives the provider link expiring | **PASS by design** — needs credentials to prove |
| 6 | Certificates are included in a data export | **was FAIL — now BUILT** |

**c2 — live.** `lib/dialerScripts/service.ts` reads `tenant_consent_artefacts` into the dialer panel
with `provider`, `certificate_id`, `captured_at`, `consent_timestamp` and `capture_status`, and the
panel renders "Consent on file" before the dial.

**c4 — by omission, deliberately.** LA-2.6 puts automatic suppression out of scope — "flag, do not
block — many legitimate lists have none" — so the test asserts that no rejection reason code
mentions consent at all.

#### c6 was failing outright

`csvForLeads` emitted `stage` plus the template field keys and nothing else. For a task whose stated
purpose is that we "can produce it in one click" when a TCPA complaint lands, **the certificate was
the one field the export left out.**

Added `consentForLeads()` and eight columns: provider, certificate id, certificate URL, consent
timestamp, captured at, claimed at, capture status, and whether a stored copy exists. The last one
matters on its own — an unclaimed TrustedForm certificate expires, so "we have a URL" and "we have
the evidence" are different facts, and a row reporting only the URL would look like proof it is not.

The columns are appended **only when the caller asks for them**, so an export that does not need
consent keeps its existing shape and any saved spreadsheet template still opens. One row per lead,
newest capture first, because a lead posted by two vendors carries two certificates.

#### c1 and c5 remain blocked on credentials, unchanged

`capture_status`, `claimed_at`, `stored_ref` and `stored_copy` all exist and `consentClaims.ts`
writes them. *Claiming* a certificate is an authenticated call to ActiveProspect or Verisk, and no
credentials are configured. This is the same blocker the earlier audit recorded; nothing this pass
changes it.

### Where the three vendor answers now live

`/app/campaigns` renders one rollup with a two-tier header — **Cost | Speed to lead | Consent
evidence** — because "is this vendor any good", which is LA-2.1's stated question, is not answerable
from cost alone. A cheap list nobody dials fast, or one that arrives without certificates, is not
cheap. A vendor that has posted no real-time leads shows "—" rather than 0s, which would read as
instant.

### Gate after this pair

| Check | Result |
|---|---|
| `npm test` | 561 tests, 556 pass, **5 fail — the same five in the other session's files** |
| typecheck / lint / `db:check` / `build` | clean / clean / all parse / 215 pages |

New tests: `lib/leadPost/speedAndConsent.test.mjs`, 9 cases, all passing.

---

## Pair 4 — LA-2.7 and LA-2.8

Both tasks are amended by **"Sixteen Open Questions, Answered" (2026-09-11)**, which is newer than
every task page and which the pages have never absorbed. Scored against the amended wording.

### LA-2.7 · Cadence & retry engine with slot rotation

| # | Criterion | Verdict |
|---|---|---|
| 1 | A lead is never retried into a slot it has already failed in, while an unused slot remains | **was FAIL — now BUILT, deploy pending** |
| 2 | Cadence rows can be added, edited and deleted, per campaign | **PASS (live)** |
| 3 | An invalid interval is rejected at entry, not sent to the database | **PASS (live)** |
| 4 | A lead hitting the ceiling moves to nurture and stops being served | **was FAIL (unreachable) — now BUILT** |
| 5 | Changing a cadence affects the next lead served, with no deploy | **PASS (live)** |
| 6 | Five of seven attempts within 72 hours — **population target** (decision 2) | **PASS (default table)** |
| 7 | **Decision 2, new:** the engine never returns "no slot available" — LRU fallback | **was FAIL — now BUILT** |

#### Two defects that were hiding each other

**Every attempt recorded the same slot.** `startDialAttempt` inserted the literal
`slot: "late_morning"` on every attempt ever created, and nothing corrected it later —
`complete_existing_dial_disposition` computes a `v_slot` and then never writes it anywhere.

`schedule_next_attempt` builds "slots this lead has failed in" from `tenant_call_attempts.slot`, and
the serving query refuses a retry whose current slot appears there. So **slot rotation was reading a
history that was not true**: every lead looked as though it had only ever been tried at one time of
day, whatever hour it was actually dialled. Criterion 1 was satisfied against fiction.

The attempt now asks the database, because `current_slot_for_state` already owns the mapping —
including the rule that Saturday at 10am is the weekend slot rather than late morning, which is the
exact gap rotation exists to close.

**And the serving query deadlocks once six slots are used.** There are six slots and the ceiling is
seven attempts. Tier 4 admits a retry lead only when the current slot appears in no prior attempt.
Once a lead has been dialled in all six, every value `current_slot_for_state` can return matches a
prior attempt, so the condition is false at **every hour of every day, forever**. No other tier takes
it — tier 5 needs `fresh`, tier 6 needs `nurture`. The lead sits in `retry` with an elapsed timer and
is never served again, so **attempt seven never happens and it never exhausts to nurture either**. It
is stuck, invisibly, in a state that looks active.

`schedule_next_attempt` *had* a fallback; it was on the wrong side of the gate. The scheduler
happily writes `next_preferred_slot` for attempt seven and the serving query then refuses to act on
it.

The fix reads the slot the scheduler already chose: `next_preferred_slot` is only ever set to an
already-used slot in the scheduler's own all-slots-used branch, so *"the current slot is the one the
scheduler asked for"* **is** the fallback. One column comparison on the hot path — no extra
subquery and no extra function call, which matters because this query is the module's known
performance problem.

The scheduler's fallback was also fixed. It took `v_tried[1]` from `array_agg(distinct ...)`, and
the order of a `distinct` aggregate is unspecified — so the "fallback slot" was whichever the
planner emitted first, neither least-recently-used nor stable. Decision 2 asks for the least
recently used, which is the only choice carrying information: the slot whose evidence is oldest.

**`lib/cadence/engine.ts` is imported by nothing.** 200-odd lines including a `nextSlot` that
already implements `least_recent`. The same pattern LA-2.3's page called its highest-priority
finding for `dncCheck.ts`. It is meant to be the UI-side explainer (the SQL enforces, the TS
explains — the calling-window arrangement), so the *explaining* half is simply unwired. Recorded,
not fixed: wiring it is a dialer presentation change, not a correctness one.

### LA-2.8 · Lead queue & serving

| # | Criterion | Verdict |
|---|---|---|
| 1 | Two agents pressing next simultaneously never receive the same lead | **PASS (live)** |
| 2 | A lead outside its window is never served, under any request | **PASS (live)** |
| 3 | An abandoned lock returns the lead to the pool after the timeout | **PASS (live)** |
| 4 | A real-time lead is served ahead of everything within seconds | **PASS (live)** |
| 5 | Serving is under 200ms with 100,000 eligible leads | **UNVERIFIED** — needs a 100k fixture |
| 6 | The empty state explains itself | **PASS** |
| 7 | **Decision 1, new:** lead search exists, and search is not a serve | **PASS (live)** |
| 8 | **Decision 1, new:** `inbound return call` disposition | **was FAIL — now BUILT** |

**c8 did not exist anywhere.** No `inbound_return_call` in the dialer vocabulary, the SQL or the UI.

What that cost: a customer Ray rang yesterday rings back today. He finds them through lead search —
which exists, and correctly does not serve or claim — and takes the call. To record it he had to
pick from the outbound vocabulary, and every one of those options increments `attempts_made`
(spending one of the lead's seven attempts on a call the lead never made), runs the cadence
(rewriting the retry schedule from a slot the *customer* chose), and completes or requeues the work
item (moving the lead's position). Decision 1 forbids all three in the sentence that creates the
disposition.

There was also no way to reach it: the dialer's `prepareAttempt` returned early in search mode, and
`startDialAttempt` required a claimed work item — which a search-opened lead can never have, because
search does not claim. Both now split on the inbound case; every outbound attempt still requires a
claim.

The disposition is handled **before anything is mutated** and returns the lead's cadence exactly as
it stood, so a caller cannot mistake "unchanged" for "cleared". A `DO` block asserts the branch
precedes the attempt counter — if that ever inverts, an inbound call silently shortens the cadence
and nothing fails visibly.

**c5 remains unverified**, unchanged from the earlier audit: measuring it needs a 100,000-row
fixture on a deployed environment. The known figure is ~388ms at 1,000 queued leads, and the cost is
`is_phone_suppressed` and `tenant_can_dial_now` running per candidate. This pass deliberately did
not add a third per-row call for exactly that reason.

### A correction to pair 2, and a conflict that needs an owner decision

**Decision 3 supersedes LA-2.3 criterion 4**, which was scored PASS in pair 2 against the old
wording:

> Change the acceptance criterion "a vendor outage blocks dialling rather than passing numbers
> through" to **"a vendor outage blocks import; already-scrubbed campaigns continue to serve."**
> ... "At serve — check against our own tables only ... There is no third party in the path."

Measured against that, the current behaviour is wrong: `markDialClicked` calls
`performDncDialPreflight`, which calls `assertDncVendorAvailable()` and then makes a **live HTTP
call to the scrub vendor on every dial click**. A vendor outage 503s the entire dialling floor —
precisely the failure decision 3 was written to remove.

**But SA-4.8 specifies fail-closed dialling**, and a prior review confirmed that behaviour as
correct: "every branch I could find fails closed." The two specs genuinely contradict, across
modules, on a control where being wrong costs $500 to $1,500 per call.

This was **not** changed. The synthesis both specs support:

> The dial-time check reads **cached** vendor results plus the internal DNC list — decision 3's own
> list of local sources. A cache miss still blocks, because a number with no scrub result was never
> scrubbed and that is a campaign-gate failure. No vendor is called, so an outage cannot stop
> dialling, and nothing unscrubbed becomes dialable.

That needs a product/compliance decision rather than an engineering one.

### Gate after this pair

| Check | Result |
|---|---|
| `npm test` | 569 tests, 561 pass, **8 fail — all eight in the other session's LA-1 files** |
| typecheck / `db:check` / `build` | clean / all parse / 215 pages, exit 0 |
| `npm run lint` | 1 error, in the other session's `LeadPreviewPanel` |

New tests: `lib/cadence/rotationAndQueue.test.mjs`, 8 cases, all passing.

---

## Pair 5 — LA-2.9 and LA-2.10

### The finding that dominates this pair, and the module

**`serve_next_lead` had been correct and deployed for weeks, and nothing called it.**

Of the **152 RPCs this application invokes, it was not one** — and neither was `score_lead` nor
`next_campaign_for_serving`. The dialer's only lead source was `GET /api/app/leads?limit=100`, a
browsable list, and it auto-selected `loaded[0]`.

LA-2.8 names this as the one thing that must not happen, and says why:

> "He does not pick from a list. The system decides, he dials. That is what makes cadence, scoring
> and window enforcement mean anything — **the moment he can browse, all three become
> suggestions.**"

Everything downstream followed from that single missing call:

| Built, tested, and inert | Because |
|---|---|
| Priority tiers 1–6 (LA-2.8) | never evaluated, so a real-time lead could not jump the queue |
| Atomic serve-and-lock | never executed, so two agents *could* open the same lead |
| Cadence timer + slot rotation (LA-2.7) | written on every disposition, read by nobody |
| Campaign mixing weights (LA-2.1 c5) | `next_campaign_for_serving` never called, so weights decided nothing |
| Lead scoring + holdout (LA-2.13) | `score_lead` runs only inside the serve, which never ran |

This also explains why pair 4's slot-rotation deadlock was not yet biting: nothing served, so no
lead ever reached the state that deadlocks.

**Corrections to earlier pairs in this sweep.** Two verdicts were right about the SQL and wrong
about the product, and are restated here:

- **LA-2.1 c5** ("two campaigns weighted 4 and 2 serve roughly 2:1") was scored PASS (live) on the
  migration's own 3,000-draw assertion. The function is correct; nothing called it, so campaigns did
  not interleave in the product. Now reachable.
- **LA-2.8 c1 and c4** were scored PASS (live) on the SQL being atomic and tier-ordered. Both were
  true of the function and false of the product for the same reason.

### What was built

- `serveNextLead()` in `lib/dialerScripts/service.ts` — the missing call.
- `POST /api/app/dialer/next` — POST, not GET, because the serve claims the work item and locks it
  for fifteen minutes; a prefetchable GET would take leads out of circulation and hand two agents
  the same one. An empty queue answers **200 with `served: null`** and the reason, because LA-2.8 is
  explicit that an empty queue is normal several times a day and a 404 would make the screen treat a
  working system as broken.
- The dialer now serves on load and after every disposition, renders the tier and the server's
  selection reason, shows the lock expiry, and keeps the lead list only as the search path.

### LA-2.9 · Click-to-call dialer & dispositions

| # | Criterion | Verdict |
|---|---|---|
| 1 | No enabled action exists on a lead that may not legally be dialed | **PASS** |
| 2 | The header shows the customer's local time, correctly across DST | **PASS (test)** |
| 3 | Every disposition schedules or terminates the lead — none in limbo | **PASS (live)** |
| 4 | A disposition with no click is flagged in the log | **PASS (live)** |
| 5 | No metric labelled talk time is displayed | **PASS (live)** |
| 6 | Keyboard-only operation for the whole loop — dial, disposition, next | **was FAIL — now BUILT** |

**c5 — live.** No `talk_time` anywhere; the field is `card_open_seconds`, which is the rename the
task asked for. The task's point stands and is now true: the number measures how long the card was
open, and it is labelled as such.

**c4 — live.** `case when a.disposition is not null and a.clicked_at is null then
'zero_click_disposition'` — the only integrity check available without telephony, kept.

**c6 — the loop did not exist.** Every control was already a real `<button>`, so tab-and-enter
worked; what was missing was a loop an agent can run all day, and a **"next"** action at all. `n`
serves the next lead, `d` records the dial, `1`–`7` pick a disposition in render order. Guarded on
the event target, because a shortcut firing mid-keystroke would replace a search query with a served
lead. The hint is on the disposition card, because an undiscoverable shortcut may as well not exist.

### LA-2.10 · Callback scheduling

| # | Criterion | Verdict |
|---|---|---|
| 1 | A callback fires at 2pm in the **customer's** timezone, across a zone boundary | **PASS (live)** |
| 2 | Booking outside the legal calling window is rejected with a clear reason | **PASS (live)** |
| 3 | Booking in the past is rejected | **PASS (live)** |
| 4 | A due callback appears at the top of the queue | **PASS (live)**, and now reachable |
| 5 | Overdue callbacks are visible and counted separately | **PASS (live)** |
| 6 | One callback implementation shared with LA-1.22, not two | **PASS (live)** |

**c4 was PASS-in-SQL and unreachable-in-product** for the same reason as everything else above: tier
2 of `serve_next_lead` puts a due callback behind only real-time, and nothing served. Now reachable.

**c2 — a correction against myself.** I initially recorded this as failing, because neither
`complete_disposition_with_callback` nor `reschedule_callback` contains a window check *in the
migration that defines them*. That was wrong. `20260913360000_la_2_10_callback_window_check.sql`
installs `assert_callback_in_window` and patches it into both live function bodies with a `DO` block
that rewrites them by string replacement — so the check is invisible to a grep of the defining
migration. Verified live:

| Function | Window check |
|---|---|
| `assert_callback_in_window` | present |
| `complete_disposition_with_callback` | present |
| `reschedule_callback(p_tenant_id, p_callback_id, p_actor, p_callback_local)` — tenant | **present** |
| `reschedule_callback(target_callback_id, target_scheduled_at, target_note)` — CRM | absent, correctly |

The second overload writes the organizations-era `callbacks` table and is left alone under the SA-3
rule. I had written a replacement trigger migration and **deleted it**: a second enforcement path
raising a different error code for the same condition is strictly worse than one.

**The lesson, recorded because it will recur.** Grepping the migration that *defines* a function
does not tell you what the function does. Several migrations in this repository patch live bodies by
string replacement. The authoritative source is `pg_get_functiondef` against the deployed database —
the same lesson as "ask `pg_class`, not a HEAD request", in a new costume. A test guarding this
check has been added so it cannot silently vanish.

**c6 — genuinely one implementation.** `tenant_callbacks`, `lib/callbacks/service.ts`,
`callback-calendar.tsx` and the booking RPCs all come from
`20260913160000_la_1_21_22_tenant_notes_callbacks.sql` — LA-1.22's migration — and LA-2 reuses them.
The two `reschedule_callback` overloads are not two implementations of this feature; they belong to
two different products.

### Gate after this pair

| Check | Result |
|---|---|
| `npm test` | 580 tests, 572 pass, **8 fail — the same eight in the other session's LA-1 files** |
| typecheck / `db:check` / `build` | clean / all parse / compiles |

New tests: `lib/dialerScripts/servedNotBrowsed.test.mjs`, 11 cases, all passing.

### Still unverified for this pair

- **LA-2.8 c5** — under 200ms with 100,000 eligible leads. Needs a 100k fixture on a deployed
  environment. Now that the query is actually on the hot path, this matters more than it did.
- **Authenticated browser proof** of the served loop and the keyboard shortcuts. The build compiles
  and the contracts are pinned; nobody has watched it run.

---

## Pair 6 — LA-2.11 and LA-2.12

### Three more finished mechanisms with no callers

The pattern from pair 5 repeats, and this time it takes out an entire workflow:

| Function | Callers before this pass |
|---|---|
| `book_appointment` | **0** |
| `reschedule_appointment` | **0** |
| `close_out_due_appointments` | **0** |
| `appointment_had_activity` | 0 (called only inside the close-out pass) |

`book_appointment` is the most complete function found unreachable so far. It already enforces
**every** LA-2.11 acceptance criterion:

- the customer's legal calling window **at the booked instant** — "an appointment is a call, and an
  appointment at 3am is a call at 3am that our own system put in the diary";
- the agent's working hours, accounting for the appointment's duration;
- blocked time, by `tstzrange` overlap;
- the daily cap counted **in the agent's own day**, not UTC's, because a cap of eight means eight in
  his working day and a UTC day would split it across two of his;
- the slot race left to an **exclusion constraint**, with a comment saying why: "a check here would
  read a slot list that is already stale by the time the insert runs";
- and it notifies Ray idempotently, only when somebody else did the booking.

None of it could happen. LA-2.12 is named for a workflow — *"setter dials → qualifies → books a slot
on Ray's calendar"* — whose last step **did not exist in the product**. A setter could work the
queue and record dispositions, and could not book.

Also worth recording: `/app/appointments` renders the **carrier appointment vault** (which carriers
and states an agent is appointed to write — LA-0.5 licensing). That is a different thing from
LA-2.11's booking calendar, and the naming collision is why the gap was easy to miss.

### LA-2.11 · Appointment calendar & availability

| # | Criterion | Verdict |
|---|---|---|
| 1 | Two setters booking the same slot: one succeeds, one is told it went | **PASS (SQL)** — now reachable |
| 2 | No booking outside the agent's availability or the customer's legal window | **PASS (SQL)** — now reachable |
| 3 | The daily cap is enforced server-side | **PASS (SQL)** — now reachable |
| 4 | An appointment appears in the queue when due, with the setter's notes | **PASS (live)** — reachable since pair 5 |
| 5 | Rescheduling frees the old slot atomically | **PASS (SQL)** — now reachable |
| 6 | Reminders fire in the right timezone for each recipient | **PASS (test)** |

**c4** was already tier 3 of `serve_next_lead` returning `appointment_notes`, and pair 5's fix is
what made it reach a screen.

**Still missing: the day/week calendar view.** LA-2.11 lists "Day and week calendar" and "Today's
list on the dashboard" under Views, and `book_appointment`'s own notification links to
`/app/calendar?appointment=…` — a route that does not exist, so the notification is a dead link.
The booking path and every server rule are now reachable; the calendar *screen* is the remaining
piece and is recorded rather than half-built.

### LA-2.12 · Setter role & booking workflow

| # | Criterion | Verdict |
|---|---|---|
| 1 | A setter calling any money, quoting or application route gets 403 — across every route | **PASS (test)** |
| 2 | A setter cannot see another setter's leads or scorecard | **PASS (live)** |
| 3 | Booking attaches the setter's notes and notifies Ray | **was FAIL — now BUILT** |
| 4 | Show rate from actual outcomes — **amended by decision 12** | **was FAIL — now BUILT** |
| 5 | Setter seats count against the plan limit | **PASS (live)** |
| 6 | The roster shows each setter's local time | **PASS (live)** |

**c3 — built.** `POST/PATCH/GET /api/app/appointments`, plus a booking panel in the dialer, because
that is where the setter actually is: a calendar screen they would have to navigate to after hanging
up is not the workflow the task describes. Two deliberate choices:

- **`booked_by` is always the signed-in user**, never a value from the body. LA-2.12 measures
  setters on booked-versus-showed, so a client that could name its own booker could attribute its
  bookings to somebody else — the measurement marking itself.
- **No rule is re-implemented in TypeScript.** The window, availability, blocks, cap and overlap all
  stay in the RPC, and a test asserts the service and route never mention `tenant_can_dial_now`. The
  overlap in particular *cannot* be decided outside the database without reintroducing the race.

Each of the seven codes the function can raise now maps to a sentence a setter can act on, and an
**unrecognised** failure is a 503 rather than a 400 — an unknown error is ours, and telling a setter
to fix their input would be wrong. `APPOINTMENT_SLOT_TAKEN` reads as "that slot was taken while you
were booking it", which is criterion 1's own wording: *one succeeds, one is told it went*.

**c4 — the close-out pass had no caller, so decision 12 never ran.** Decision 12 replaced "somebody
marks every appointment" with a three-part rule whose first two parts live entirely inside
`close_out_due_appointments`: activity near the slot marks `showed` automatically, and anything past
with no activity is parked at `pending` — **never `no_show`**, because "a missing mark never silently
becomes a penalty against someone's pay."

Unrun, appointments sat at `booked` forever: never inferred as shown, never parked as pending, so
the close-out strip was permanently empty and the show rate was computed over hand-marked
appointments only. Now wired as `POST /api/internal/appointment-close-out` (same secret and shape as
the other internal jobs) and `npm run appointments:close-out`. A failure for one tenant is collected
and the loop continues — one tenant's bad data must not stop every other tenant closing out.

### A mistake I made and corrected

I wrote `lib/appointments/closeOut.ts` with the Write tool without checking whether it existed. **It
did**, and I overwrote it — it held `listCloseOutAppointments` and `markCloseOutOutcome`, used by
`app/api/app/appointments/close-out/route.ts`. The tool result said "updated", not "created", and I
missed that.

The file was **untracked**, like much of LA-2, so git could not restore it. I reconstructed both
functions from the live contract — `tenant_appointment_close_out`'s columns, the
`mark_appointment_outcome` signature, the four error codes the route maps, and the field names the
close-out strip component reads. Its own pre-existing test file, `lib/appointments/closeOut.test.mjs`,
**passes unchanged**, including its assertion that the view and the lead lookup are both tenant-scoped.
That is good evidence the reconstruction is faithful rather than merely type-correct, but it is a
reconstruction, and some original comment prose will differ.

### The string-replacement pattern, again

`agent_notifications` does not appear in the migration that *defines* `book_appointment` — LA-2.12's
migration patches it into the live body afterwards, exactly as the callback window check is
installed. My first test asserted against the defining migration and failed for that reason.
Second time this sweep. The test now follows the notification to whichever migration adds it.

### Gate after this pair

| Check | Result |
|---|---|
| `npm test` | 590 tests, 582 pass, **8 fail — the same eight in the other session's LA-1 files** |
| typecheck / lint / `build` | clean / clean / compiles, both new routes present |

New tests: `lib/appointments/bookingReachable.test.mjs`, 10 cases, all passing.

---

## Module 2 §5 and §6 — the chain made usable

Requested directly: create vendors, create campaigns, connect the two, and make the import extract
columns from any CSV, check DNC/TCPA **and duplicates**, then hand the decision to a person on a
separate screen before anything is written.

Scored against **Module 2 — Outbound Lead Acquisition**, §5 (vendors, campaigns, lists) and §6
(getting a sheet into the system), which is where both requests are specified.

### §5 · Vendor → campaign → list → leads had no forms

```
VENDOR ────┬──► CAMPAIGN ────► LIST (import) ────► LEADS
           │      one purpose        one file
           └──► CAMPAIGN ...
```

Both ends of that chain were **API-only**. `POST /api/app/vendors` and `POST /api/app/campaigns`
existed; nothing in the product called either. A tenant could not create the vendor they buy from,
nor the campaign that carries its cost — and §5's rule is that *"every lead knows its campaign, and
every campaign knows its cost"*. Without a campaign every imported lead is free, which empties cost
per record, cost per usable record and cost per issued policy all at once.

Built on `/app/campaigns`:

- **New vendor** — name, lead type, return window, terms. The return window is the clock on a
  vendor credit claim, so the form says to take it from the contract rather than guess.
- **New campaign** — picks its vendor from a list rather than accepting free text, because a
  campaign outside the vendor hierarchy is invisible to the rollup. Takes spend, records purchased
  and mixing weight in the same form.
- **Created as a draft, deliberately.** A campaign serves leads only when it is active *and*
  scrubbed; creating one active would put an empty, unscrubbed campaign straight into the serving
  view.
- An empty state that points at the first step rather than dead-ending.

### §6 · The import now stops and asks

The documented pipeline is eight steps, and ④⑤⑥ all happen **before** ⑧:

```
④ validate    show him what is wrong BEFORE he commits
⑤ dedupe      against this file, and against everything he already has
⑥ SCRUB       federal DNC · litigator · state DNC · his own list
⑧ commit      transactional — all of it or none of it
```

All three used to run *inside* the commit. Ray learned what his file contained from a toast after it
had been dealt with on his behalf — and could not answer the only question he actually has at that
moment: *there are 180 numbers I cannot dial and 40 people I already have; what do you want me to do
about it?*

**`POST /api/app/leads/import/preflight`** now runs ④⑤⑥ and writes **nothing**. It parses and maps
the vendor's own headers, normalises, validates row by row, dedupes inside the file and against
every existing lead, screens each distinct number once, and stages the result. Then it redirects to
**`/app/import/review/[batchId]`**, where each group is a card with its own choice:

| Group | Choice |
|---|---|
| Ready to import | — |
| **TCPA litigators** | none. Never importable, never dialable, recorded as claimable evidence |
| **Not a real number** | none. Recorded as claimable |
| **On a do-not-call list** | leave them out · **or** import and suppress permanently |
| **People you already have** | add this campaign to the existing lead · **or** skip |
| **Repeated inside this file** | keep the first · **or** skip every repeat |
| **Rows that need correcting** | none. Fix the file and upload again |

The running total moves as the choices change, because a number that does not respond is not an
explanation of what an option does. `PUT` on the same route commits with those decisions.

#### Four things that were not obvious

**The scrub runs once.** Screening at preflight and again at commit would bill the tenant's scrub
allowance twice for one file (LA-2.22). The answers are staged and the commit reuses them, so the
outcome the person was shown is exactly the outcome acted on. The allowance is checked against the
count of **distinct numbers**, because two rows for one number are one lookup.

**No new table.** The plan is staged in `agent_lead_import_batches`, which already exists and
already carries this file's idempotency key; `status = 'processing'` is the honest state for a
request that has started and not finished. That matters because this session cannot apply
migrations — the feature works against the deployed database as it stands.

**The file crosses the redirect in the browser tab.** Twenty thousand rows is megabytes: too big
for a query string, and storing it server-side would duplicate every lead record into a jsonb column
for one screen. So the *plan* is server-side and tenant-scoped, and only the file travels, in
`sessionStorage`. A `csvHash` guard means decisions made about one file can never be applied to
another. Re-uploading the same file returns the existing plan rather than scrubbing it again.

**A DNC number is never made dialable.** The options are "leave them out" or "import and suppress" —
the second keeps the record as vendor-credit evidence and writes the number to the internal
do-not-call list permanently. There is deliberately no third option, and the screen says so rather
than leaving people hunting for it: Module 2 §8.1 permits dialling a listed number only "with a
documented prior relationship or written consent", and a checkbox on an import screen is neither. A
litigator is not a choice at all.

A suppression that fails to write is reported loudly and by number, because a lead imported as
suppressed whose suppression did not land is a dialable DNC number — the one outcome this path
exists to prevent.

### Gate

| Check | Result |
|---|---|
| `npm test` | 603 tests, 593 pass, **10 fail — all ten in the other session's LA-1/partner files** |
| `npm run lint` | **0 errors** |
| typecheck / `db:check` / `build` | clean / all parse / compiles, both new routes present |

New tests: `lib/agentTemplates/importReview.test.mjs`, 13 cases, all passing.

### Not done, and worth saying

- **Nobody has watched this run.** The build compiles and the contracts are pinned; the flow needs
  an authenticated browser pass.
- **The cost view is still deploy-pending.** `tenant_campaign_costs` does not exist until
  `20260917140000` is applied, so the commit's cost lookup and `/app/campaigns` will error until
  then — deliberately, because a missing cost basis is visible and a wrong one is not.

---

## Pair 7 — LA-2.13 and LA-2.14

### LA-2.13 · Lead scoring & call sequencing

| # | Criterion | Verdict |
|---|---|---|
| 1 | Every served lead carries the reason it was chosen, in plain language | **PASS** — reachable since pair 5 |
| 2 | Scoring is a pure function of stored signals | **PASS (live)** |
| 3 | The holdout is real, and its contact rate is **reported** alongside the scored cohort | **was FAIL — now BUILT** |
| 4 | Scoring is off by default and can be turned off entirely without breaking the queue | **was half-true — now BUILT** |
| 5 | Scoring adds under 50ms to serving | **PASS (measured earlier)** — +1.7ms at 200 leads, +6.1ms at 1,000 |
| 6 | Weights are **inspectable and adjustable** | **was FAIL — now BUILT** |

**Four scoring objects, zero readers.** `tenant_scoring_settings`, `tenant_scoring_weights`,
`tenant_scoring_decisions` and `tenant_scoring_cohort_stats` were all deployed and **none was read
by the application**. Two criteria are about precisely that, and the task says why c3 matters more
than it looks:

> "Without a holdout, the model's value is a claim rather than a measurement. Ray will ask whether
> it works. *Contact rate 14.2% scored versus 11.8% control, over 4,000 dials* is an answer. *It
> uses machine learning* is not."

A view nobody reads cannot answer that, however correct the SQL is. Criterion 4 was also only
half-true: scoring was off by default and there was no way to turn it **on**, so the feature was
unreachable in both directions.

Built `/app/scoring` (Insight → Queue scoring) plus `GET/PUT /api/app/scoring`:

- **The holdout comparison first**, because "is it working" is the question. Scored versus plain
  order, contact rate each, contacts and served counts named, and the difference stated in points
  over a named sample — with "treat a small sample as noise" on the screen rather than a verdict.
- **The seven signals from the task's own table**, each with its weight, and each marked whether it
  is the platform default or a local override. The effective weights come from
  `scoring_weights_for`, the same function `score_lead` reads, so the screen cannot show one number
  while the queue ranks by another.
- Only signals the scorer knows about can be saved; an unknown one would sit in the table looking
  like it did something.
- The holdout is capped at 50%, because a control arm larger than the treatment arm measures the
  naive order more precisely than the thing being tested.
- Owner and producer only. The weights decide the order of a setter's own queue, and vendor contact
  rate is one of the signals.

**The score is still never shown to an agent** — only the reason. That is LA-2.13's own warning
about `vendor_score`: "Do not put a number in front of an agent until you can explain it."

### LA-2.14 · Interested → verification & application handoff

| # | Criterion | Verdict |
|---|---|---|
| 1 | The verification panel is the same component as inbound, with no outbound-specific fork | **PASS (live)** |
| 2 | `campaign_id` and `vendor_id` survive onto the application and the policy record | **PASS (live)** |
| 3 | A dropped call resumes with everything already collected | **PASS (live)** |
| 4 | The deal-flow row is indistinguishable in structure from an inbound one | **PASS (live)** |
| 5 | An outbound sale appears correctly in the daily deal flow | **was unreachable — now BUILT** |

**The route was already right, and nothing called it.** `POST /api/app/outbound/application` calls
`getVerificationPanel` and `updateVerificationField` — the identical functions the inbound route
calls, with no outbound parameter and no second implementation. It refuses a setter at the route and
again inside the RPC. Every criterion was satisfied *in the route*.

There was no "Interested — start application" action anywhere in the dialer. The task is named for
that entry point, and it was a door with no handle: the only way to end a good call was to pick
`application_submitted` from the disposition list, which closes the lead without opening anything.

Added as its own card, visually separate from the dispositions because it is not one — it opens the
sell flow rather than closing the call.

### Reachability sweep across the rest of the module

Given the pattern — five finished mechanisms found with no callers — the remaining tasks were
checked the same way before assuming anything:

| Task | Key objects | Reached? |
|---|---|---|
| LA-2.17 | `tenant_vendor_scorecard_report`, `tenant_vendor_scorecard_leads` | yes |
| LA-2.18 | `tenant_campaign_comparison` | yes |
| LA-2.19 | `lead_claims` via `create_vendor_return_claim`, `vendor_returns_report`, `vendor_return_metrics` | yes |
| LA-2.20 | `reactivate_nurture`, `tenant_recycle_performance` | yes |
| LA-2.21 | `tenant_activity_report`, `tenant_setter_scorecard` | yes |
| LA-2.22 | `assertOutboundLimit` / `outboundLimitSnapshot` | yes, 8 callers |
| LA-2.23 | `tenant_scripts`, `tenant_rebuttals` | yes |
| LA-2.24 | `assignment_rules`, `assign_lead`, `agent_capacity` | yes |

**LA-2.15 and LA-2.16 are cancelled** by decision 16, superseded by LA-3.12 / LA-3.13 / LA-3.14.

So the unreachable-mechanism pattern is confined to what this sweep has now closed: LA-2.1's cost
surface, LA-2.5/2.6's speed and consent views, LA-2.8/2.9's serving, LA-2.11/2.12's booking and
close-out, LA-2.13's scoring, and LA-2.14's entry point. The later tasks are genuinely wired.

### Gate after this pair

| Check | Result |
|---|---|
| `npm test` | 613 tests, 603 pass, **10 fail — all ten in the other session's LA-1/partner files** |
| `npm run lint` | **0 errors** |
| typecheck / `build` | clean / compiles, both new routes present |

New tests: `lib/scoring/reachable.test.mjs`, 10 cases, all passing.

---

## Browser pass — every LA-2 screen, driven in an authenticated session

Run on 2026-09-17 against `localhost:3000` as an **owner** of `LA-1.25 Alert Demo`, the one demo
tenant holding all 27 features. Session minted with `scripts/mint-session.mjs`, which exists for
exactly this and had never been used against these screens.

Everything below was found by **using** the product. None of it was visible from the source, and two
of the five defects contradict comments I had written in the same files.

### Migrations: still not applied, and now definitively so

| Path | Result |
|---|---|
| `TENANT_DB_URL` | `tenant_app`; `rolsuper=false`, no role memberships, `has_schema_privilege('public','CREATE')=false`; `create table` fails `42501` |
| Supabase MCP | authenticated to org `umxhebnarfrcavkpxcmz` (`CRM-DEV`, `Accounting Database Dev`). This project is `iiimdgizjwnihpyrukbu` in org `plqfeoaxrhfwklxxkgej` — `list_migrations` returns "You do not have permission" |
| Supabase CLI | the link survives (`supabase/.temp/project-ref`, `linked-project.json`) but the binary is not installed and `~/.supabase/` holds only telemetry — no access token |
| Browser session | no Chrome connected, so no authenticated dashboard either |

One thing did change: `default_transaction_read_only` is now **off**, so backlog #201's read-only
condition has lifted. The migrations fail on privilege alone.

Their effect is visible and correctly reported:

    GET /api/app/campaigns  500  Could not find the table 'public.tenant_campaign_costs'
    GET /api/app/vendors    500  column tenant_vendor_rollup.records_rejected does not exist

### 1. 🔴 An imported list could never be dialled

The most serious finding of the sweep, and the one that needed a browser to see.

A four-row CSV imported cleanly — "2 imported", the right two rows kept, the DNC row withheld, the
repeat collapsed. The dialer then said **"Nothing servable"** with both leads sitting in
`agent_leads`.

`serve_next_lead` selects `from lead_queue q join agent_leads l on l.id = q.lead_id`. The queue is
the work-item table and it is the only thing the server reads. Verified against the **live**
database, not the source, because string-replacement migrations have made grep unreliable here twice:

| Question | Answer |
|---|---|
| triggers on `agent_leads` | `stamp_lead_nurture_entry`, `touch_agent_template_updated_at` — neither enqueues |
| live functions that `insert into lead_queue` | **none** |
| live `import_agent_lead_batch` mentions `lead_queue` | **false** |

Two application paths enqueue — `lib/leadPost/service.ts` (a vendor POST, tier 0) and
`lib/agentTemplates/intake.ts`. CSV import was never one of them, so Module 2 §5's
VENDOR → CAMPAIGN → LIST → LEADS chain ended one step short of the dialer.

**This was latent before LA-2.8 and the dialer hid it.** The old dialer read
`/api/app/leads?limit=100` and auto-selected `loaded[0]`, so imported leads appeared — in the wrong
order, ignoring cadence and the priority tiers, but they appeared. Moving onto `serve_next_lead` was
right, and it turned a silent ordering bug into a visible empty queue. Stated plainly because the
regression is mine.

Fixed by `20260917146000_la_2_2_imported_leads_reach_the_dialer.sql`, which enqueues **inside**
`import_agent_lead_batch` rather than in TypeScript after the RPC — the review screen promises
"Committed as one transaction — all of it or none of it", and a second round trip would make "leads
written, queue rows missing" reachable with nothing to roll back to. It also backfills every lead
that has no work item, and asserts both facts in a `do` block. Pinned by
`lib/cadence/rotationAndQueue.test.mjs`.

Not verifiable end-to-end until it is applied: enqueuing the two fixture leads by hand was correctly
refused as a direct write to a shared tenant outside the product's own code path.

### 2. 🟠 Changing one scoring weight marked all seven as overridden

Changed `recency` 25 → 30, saved, reloaded, and every signal came back `OVERRIDE`.

The form posts all seven signals each time and `saveScoringSettings` upserted each one, so
`tenant_scoring_weights` — an *override* table — gained a row for six values nobody had chosen. That
erases the single distinction the `DEFAULT` badge exists to draw, and the one my own test asserts.

Now compared against `default_scoring_weights()` (the same defaults `scoring_weights_for` merges):
only genuine differences are stored, and setting a weight back to its default **deletes** the
override rather than pinning the default as though it had been chosen — which is what keeps "revert
this one" reachable. Proven live: all-defaults → 0 overrides (the delete path cleared the six I had
pinned), one change → exactly one.

### 3. 🟠 A failed load was reported as an empty vendor list

With the migrations missing, `/app/campaigns` toasted the real reason and then rendered
**"No vendors yet. Add one to start attributing lead cost."** — the same sentence a tenant who has
genuinely bought nothing sees. Once the toast faded the screen was confidently wrong.

The comment above the `load` already said this must not happen: *"Reported, never swallowed into an
empty list... those need different answers."* The intent was right and the implementation stopped at
the toast. Both sections now check the failure first, and the "start with a vendor" nudge no longer
fires when we simply could not look.

### 4. 🟡 A finished import looked like a lost one

After a successful commit, pressing Back or refreshing the review URL produced the bare framework
404. `loadPreflight` returns null once the commit overwrites `response`, and the page could not tell
"never staged, or not yours" from "already imported".

`importBatchState` now distinguishes them. A foreign or unknown id still 404s — the branch is reached
only after the row is confirmed to be this tenant's, so a batch id still is not a way to probe for
someone else's.

### 5. 🟡 Two smaller ones

- **"1 row need attention"** in the import validation summary. Now "1 row needs / 2 rows need".
- **`mint-session.mjs` minted a session for a deactivated user.** It filtered on role but not on
  status, and `resolveTenantContext` drops a session whose user is not `active` — so the token
  verified fine and bounced to the login page with nothing saying why. Now filtered on the same
  conditions the request path enforces, with `--email` for targeting a tenant.

### What worked, verified by use

**The import review flow — the feature this module was asked for — works end to end.**

    upload  →  5 rows, 465 B, every column mapped "Exact"
    validate → "4 rows ready", "1 row needs attention", commit disabled while unreadable
    preflight → dnc 1 · ready 2 · duplicate_in_file 1 · totalRows 4
    review   → per-bucket decisions, row tables, the DNC refusal stated
    commit   → "2 imported"

- `CleanTwo` imported, `DupeA` imported as the first of the pair, `DupeB` dropped, `CleanOne`
  withheld for the DNC hit — the default decisions honoured exactly.
- Re-uploading the same file returned the **same `batchId`**, so `preflight:${csvHash}` idempotency
  holds and the file is not screened, or billed, twice.
- The orange "No campaign was selected, so these leads will carry no cost" warning renders where it
  is needed.
- There is no option anywhere to dial a DNC number, and the screen says why.

Also confirmed: `/app/scoring` renders all seven signals and persists; the dialer serves via
`POST /api/app/dialer/next` (200, `served: null`, plain-language reason) and makes **zero** calls
while idle — no retry loop on a lock-taking endpoint; `/api/app/appointments` 200; both new sidebar
entries are live; the Brex tokens resolve to `--portal-canvas: #fcfcfd` in light and `#101215` in
dark with `--portal-primary: #ff5900` in both; the review screen has no horizontal overflow at 375px.

The `aside` is `position: fixed; top: 0` at full height — a blank band seen while scrolling was a
pane compositing artifact, not a layout defect.

### Still unverified, and why

| Item | Blocker |
|---|---|
| Dialer serve → disposition → booking → start application | needs a queued lead; migration unapplied and the manual enqueue was correctly refused |
| Vendor and campaign creation forms | `/api/app/vendors` and `/api/app/campaigns` 500 until `20260917140000` |
| Import committing **with** a campaign | needs `record_campaign_scrub_rejections` and `tenant_campaign_scrub_rejections` |
| LA-2.8 c5, 100k leads under 200ms | needs a 100k fixture |

### Gate

| Check | Result |
|---|---|
| `npm test` | 619 tests, **609 pass**, 10 fail — all ten in the concurrent session's LA-1/partner files (`lib/partnerMarkets/service.ts`, `partners/[id]/*` routes), none in LA-2 |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run typecheck` | clean |
| `npm run db:check` | every file parses, including `20260917146000` |

Seven migrations now await DDL authority: `20260917140000` through `146000`.

---

## 6. 🟠 A pending migration took out a whole page that could still do most of its job

`/app/campaigns` rendered two "could not be loaded" panels and nothing else, while three vendors and
four campaigns sat in base tables the page never tried to read. Reported honestly — finding 3 above
is what made it say so rather than claiming "No vendors yet" — but still useless.

What is actually deployed, checked column by column:

| Object | State |
|---|---|
| `tenant_campaigns` | present, **and `cost_per_record_cents` / `effective_cost_per_record_cents` are generated columns** |
| `tenant_vendor_rollup` | present, minus `records_rejected`, `records_usable`, `cost_per_usable_record_cents` |
| `tenant_vendor_consent_coverage` | present |
| `tenant_campaign_costs` | missing (42P01) |
| `tenant_vendor_speed_to_lead` | missing (42P01) |

So the purchased-cost basis was already in the database as generated columns, and the page was
withholding it over the *usable* basis it could not compute. Both routes now fall back:

- **Campaigns** read the view, and on a schema gap read `tenant_campaigns` instead, returning the
  usable-basis fields as `null`.
- **Vendors** degrade per panel. The vendor list comes from a base table and is never taken down by a
  derived view; the rollup retries without the three pending columns; speed reports itself absent.

`lib/supabase/schemaGap.ts` draws the line. It is deliberately narrow — a missing relation or column
and nothing else. `42501`, `57014`, `23505`, `23503`, `08006`, `PGRST301` and a bare `fetch failed`
all still 500, and that is the assertion the test file spends most of its length on: if this ever
matched a permission denial, a real fault would render as a politely degraded screen and nobody would
find out.

**No money is re-derived.** Every column in either path is stored or generated in the database. A
second implementation of cost arithmetic in TypeScript is precisely what `tenant_campaign_costs`
exists to prevent, and the test asserts the fallback contains no division.

An unknown count renders `—`, never `0`. Zero rejected rows is a measurement — "we scrubbed and lost
nothing" — and printing it for an unknown would invent a clean bill of health for a scrub that never
ran. The vendor-credit prompt is guarded the same way.

The gaps are named once at the top of the page rather than as a dash in eleven cells that each look
like a bug, and styled distinctly from the failed-load state because the two have different fixes.

### Demo data

Created through the product's own API, not by direct writes:

    Apex Lead Partners    list      14d    $2,735.00 / 7,300 records
      Apex FE Q3 List       active   $1,815 / 5,000 = 36.3c   weight 4   (LA-2.2's worked example)
      Apex Medicare T65     active   $920 / 2,300   = 40.0c   weight 2
    Redwood Direct        realtime   7d    $2,400.00 / 400
      Redwood Live Transfer active   $2,400 / 400   = $6.00   weight 3
    Meridian Data Co      aged       0d    $250.00 / 5,000
      Meridian Aged 90d     paused   $250 / 5,000   = 5.0c    weight 1

Active weights total 9, so the serving shares render 44% / 22% / 33%.

### 7. 🟡 A valid campaign was blamed for a missing view

Importing with a campaign selected returned `400 "Choose a valid campaign"`. The campaign was fine;
`tenant_campaign_costs` was not deployed. Both call sites now separate a failed *read* from an absent
*campaign*, and the read failure classifies as a **503** with "No leads were created" — which is what
`classifyImportFailure` was already built to say.

### Where imported leads go, and how a campaign is attached

Recorded because it was asked and the answer is not obvious from any one file:

- Imported leads land in **`/app/leads`**, the lead workspace board, in the pipeline stage named by
  the CSV's `stage` column. With `20260917146000` applied they also get a `lead_queue` row, which is
  what makes them dialable.
- **`campaign_id` is set once, at import, from the "Campaign source" dropdown, and nothing anywhere
  changes it.** That is LA-2.1's rule — it records what was paid, so editing it later would rewrite
  cost-per-lead history.
- `tenant_lead_sources` is the additive side: one row per (lead, campaign) with its own cost, unique
  on that pair. Re-importing a number under a different campaign attaches an attribution instead of
  duplicating the lead. That is the "one person, many campaign sources" model LA-2.20 decided.
- **There is no way to attach a campaign to leads already imported.** The only route today is to
  re-import the same file with the campaign selected and let dedup attach it. Whether a late
  attachment should backdate cost is a money decision and is not made here.
