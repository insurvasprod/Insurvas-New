# LA-2 · Outbound acquisition — criterion audit

Scored **PASS / BLOCKED only**. A row is added when there is evidence for it, never to fill the
table. Same method as `LA-1-QA-AUDIT.md`: read the Notion acceptance criteria first, run against the
live database, and record what was actually observed.

---

## Live database reconciliation update — 2026-09-14

The authorized live Supabase project now has the reviewed LA-2 migrations applied, including the
LA-2.17 scorecard, LA-2.18 comparison, LA-2.19 vendor-return ledger, LA-2.20 recycling,
LA-2.21 activity scorecard, LA-2.22 limits, LA-2.23 scripts/disclosures, LA-2.24 assignment rules,
LA-2.9 atomic disposition completion, and the transfer-inbox index. The migration promotion also
fixed two SQL defects found during live application (LA-2.19 grouping syntax and LA-2.24's
PostgreSQL JSONB check). The former database-misaligned LA-2.18 row is now browser-unverified;
remaining LA-2 database/performance evidence is limited to deployment-like timing and browser
proof, not an unapplied reviewed migration.

## Browser boundary recheck — 2026-09-14

The in-app browser checked the public and auth-boundary screens at 390px and pricing at the default
1280px viewport. The screens rendered without horizontal overflow or browser console errors. The
existing tenant session was stopped at `/app/accept-terms`, where the current Terms of Service and
Privacy Policy are explicitly marked as lawyer-unreviewed drafts. No draft legal acceptance, OTP,
credential entry, or bypass was performed; authenticated LA-2.9, LA-2.10, and LA-2.18 evidence
remains open pending a valid accepted QA session.

## The finding that reshapes the module

**The entire LA-2 data layer that already existed belongs to the organizations-era CRM, not to this
application.** Established by column, not by name:

    table             keyed by          rows   tenant_app can read
    lead_vendors      organization_id      1   no
    lead_campaigns    organization_id      1   no
    leads             organization_id      3   —
    lead_imports      organization_id      —   —
    lead_mixing_rules organization_id      —   —
    lead_suppressions organization_id      —   —

    agent_leads       tenant_id        1,521   yes   â† this application's lead table

No application code references `lead_vendors` or `lead_campaigns` at all; every service in `lib/`
reads `agent_leads`.

LA-2.1's Notion page says *"Campaigns already exist and are reasonable. Two gaps: cost per lead is
captured and never displayed as a metric, and there is no vendor-level rollup."* That is an accurate
description **of the CRM**. The tenant plane now has its own vendor/campaign lineage and the lead
attribution columns; the remaining question is whether the later application and issued-policy
events are exercised together in a namespaced live fixture.

This is the ninth instance of the two-lineage confusion inventoried in backlog 182, and the first
found by reading a specification rather than by a failing test. The live reconciliation on
2026-09-14 subsequently promoted the tenant-plane vendor, campaign, application, and issued-policy migrations. The
organization-keyed CRM tables remain out of scope; current evidence below distinguishes the live
schema contract from the still-missing end-to-end fixture proof.

---

## LA-2.1 · Lead vendors & campaigns — 4 PASS, 1 PARTIAL

Board status on arrival: **Completed**. Four criteria pass; criterion 1 is now partial because the
tenant-plane application and issued-policy structures are live but the complete disposable fixture
chain has not yet been captured.

Migrations: `20260913260000_la_2_1_lead_vendors_and_campaigns.sql`,
`20260913270000_la_2_1_campaign_serving_weights.sql`,
`20260913280000_la_2_1_campaign_id_travels.sql`.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Every lead carries its `campaign_id`, and it survives into the application and the policy record | **PARTIAL — live schema aligned; fixture proof open** | The lead → deal hop is built and proven: `agent_leads.campaign_id` exists, and a `before insert` trigger on `deal_flow` copies it from the lead. The live tenant plane now also contains `tenant_application_cases`, `start_application_from_lead`, and `tenant_issued_policies`; the application and issued-policy migrations carry and validate `campaign_id` rather than joining it back by name. A disposable live fixture has not yet exercised the complete lead → application case → issued policy chain, so this is no longer a missing-schema blocker but it is not a complete PASS. `insurance_policies` and `daily_deal_flow` remain organization-keyed CRM tables and stay out of scope. |
| 2 | Effective cost per record changes when a credit is recorded, and the change is visible | **PASS** | `cost_per_record_cents` and `effective_cost_per_record_cents` are **generated columns**, so the criterion is true by construction rather than by a service remembering to recompute. Asserted in the migration: a campaign at 200000c / 1000 records reads 200 for both; after a 50000c credit the effective cost is **150** and the gross is **still 200**. That second half matters — a credit that moved the gross number would be quietly rewriting what was paid. `nullif` guards the division, so a campaign with no records reads null rather than zero: "no cost yet" not "these were free". |
| 3 | Pausing a campaign stops its leads being served within seconds | **PASS** | `next_campaign_for_serving` reads `status` live on every call through the `campaigns_servable` view — there is no cache to invalidate, which is the only version of "within seconds" that cannot drift. Asserted by pausing a campaign and calling the picker **200 consecutive times** with zero hits, then pausing the rest and confirming it returns null rather than serving something anyway. Deliberately unlike the LA-1 kill switches, which cache per process for up to 60s: correct there because it saves a query per request, wrong here because a paused campaign that keeps serving is money spent on leads nobody meant to buy. |
| 4 | A vendor rollup exists that sums its campaigns correctly | **PASS** | `tenant_vendor_rollup`, a view rather than a stored table — a stored rollup is a fourth number that can disagree with the three it came from. It **sums then divides**, never averaging averages: asserted with campaigns of 1000 records at 200c and 500 at 200c with a 50000c credit on the first, giving an effective **166.67**, where a mean of the two campaign figures would give 175. `security_invoker` is on, so the tenants' RLS applies and one tenant cannot read another's spend. |
| 5 | Two active campaigns with weights 4 and 2 serve roughly 2:1 | **PASS** | Measured, not asserted about: **3,000 draws** of a weighted pick over campaigns weighted 4 and 2, required to land in a 1.8–2.2 band. The band is a real test — a picker ignoring the weight sits at 1.0, and one always choosing the heavier campaign never returns the lighter at all. `mixing_weight` has a floor of 1 because zero would mean "never serve", which is what `paused` is for. |

### Decisions worth carrying forward

**Naming.** `tenant_lead_vendors` and `tenant_campaigns`, following SA-3 and LA-1.21/1.22: this
application's table takes the distinct name, and nothing outside this repo changes. The CRM's
`lead_vendors` and `lead_campaigns` are untouched, asserted by row count in the migration.

**A campaign may not borrow another tenant's vendor.** A foreign key cannot say that, so there is a
trigger. A campaign pointing at another tenant's vendor would be a cross-tenant leak in the cost
reporting, which is the one place it would go unnoticed longest.

**`campaign_id` is nullable on `agent_leads`.** 1,521 leads already exist and did not come from a
campaign. A NOT NULL column would require inventing a campaign for each, and a fabricated
attribution is worse than an honest absence — LA-2.17's cost per issued policy would then be
confidently wrong rather than visibly incomplete.

**The carry is a trigger, not a service call.** "One column at each hop" fails the first time
somebody writes a `deal_flow` row from a path that did not know to carry it — and that path will be
written by LA-2.14, by someone who has never read this file.

---

## LA-2.3 · Suppression & scrub engine — 6 PASS, one with a caveat

Board status on arrival: **Completed**. Two of its own headline claims were stale; the third was real.

Migrations: `20260913290000_la_2_3_suppression_hard_gate.sql`,
`20260913300000_la_2_3_one_internal_list.sql`.

### Corrections to the task page

| Claim | Verdict |
|---|---|
| *"`lib/dncCheck.ts` — 415 lines ... imported by nothing"* — the finding that made this the module's highest priority | **STALE.** That file does not exist. LA-1.5 replaced it with `lib/compliance/`, wired into partner submission, the affiliate route, agent templates and dial preflight. |
| *"'Do not call' currently writes to no list."* | **STALE.** `complete_disposition` has written to `tenant_do_not_call` since LA-1.12, and the table holds live rows. My own first diagnosis repeated this error — see below. |
| *"no campaign scrub gate"* | **TRUE.** Nothing stopped an unscrubbed campaign serving. |

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | An unscrubbed campaign serves zero leads, and the dialer explains why | **PASS** | `scrub_status` on `tenant_campaigns`, and the gate lives in `campaigns_servable` — the one view the picker reads — rather than in a service that remembers to check. LA-2.8's queue reads the same view; a second implementation is a second chance to omit it. Asserted by calling the picker **50 times** against an active-but-unscrubbed campaign with zero hits, then requiring `campaign_serving_block_reason` to name the scrub. A gate that can only report "no leads" leaves an agent unable to tell a scrub from a drought. |
| 2 | A litigator hit is never servable under any code path | **PASS** | `is_phone_suppressed` orders `tcpa_litigator` first, so the worst news is what the caller sees — asserted with a number on both the litigator list and the internal one, across two tables. |
| 3 | "Do not call" adds the number permanently, and a later import is rejected | **PASS** | The write half was already built by LA-1.12. This adds normalisation — `(602) 555-0143`, `1-602-555-0143` and `6025550143` all match one row — and the lookup import will use. **Caveat:** `tenant_do_not_call.is_active` means a number *can* be deactivated, which "permanent" does not allow. Not changed here, because it would alter LA-1.12 behaviour; recorded as a gap. `tenant_suppression_list` itself refuses deletes with a trigger, not merely an absent grant. |
| 4 | A vendor outage blocks dialing rather than passing numbers through | **PASS** | Already met by LA-1.5: `/api/app/dial/preflight` answers `503 dnc_unavailable, blocked: true`. Verified, not rebuilt. |
| 5 | Re-scrubbing suppresses numbers added to a registry since import | **PASS** | `request_campaign_rescrub` sends the campaign back to `unscrubbed`, so it stops serving **the instant re-scrub is requested** rather than when it finishes — a campaign mid-re-scrub is of unknown status, and unknown must not serve. Asserted over 50 picks. |
| 6 | Every check appears in the audit record with its raw response | **PASS** | Already met by LA-1.5: `screening_results.raw_response` per vendor, plus `screening_audit`. Verified, not rebuilt. |

### The correction worth keeping

The first migration created `tenant_suppression_list` with an `internal` type, on the strength of the
page's claim and a grep of `lib/dispositions/service.ts` that found nothing. **Both were wrong, and
the grep is the instructive part:** the logic is in the `complete_disposition` RPC, not the service,
and the table is `tenant_do_not_call` — a name containing neither "dnc" nor "suppress". Shipping it
would have left two internal do-not-call lists that disagree the first time anyone wrote to the newer
one. `20260913300000` moved the rows into the real list, removed `internal` from the new table's
vocabulary, and made `is_phone_suppressed` read **both** stores.

---

## LA-2.4 · Calling-window engine — 6 PASS

Board status on arrival: **Completed**. Migration: `20260913310000_la_2_4_calling_windows.sql`.
Engine: `lib/callingWindow/engine.ts`, pure, **26 unit tests**.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A request for a lead outside its window returns nothing | **PASS** | `canDialNow` refuses with a reason, and every refusal carries a message — asserted for all six refusal kinds. |
| 2 | A tighter state statute is enforced over the federal default | **PASS** | 08:30 EDT is legal federally and refused under a 9–20 state rule. The converse is the important half: a state rule claiming 6–23 **changes nothing**. |
| 3 | Sunday and holiday rules are honoured per state | **PASS** | A Sunday inside the hours is refused where the statute says so and permitted where it does not; a federal holiday (`*`) applies everywhere, another state's does not. |
| 4 | Correct across a DST boundary and in `America/Phoenix` | **PASS** | 14:00Z is 07:00 in Phoenix in **both** January and July, while New York moves 09:00 → 10:00. Across 2026-03-08 the same 12:30Z is 07:30 (refused) on the 7th and 08:30 (allowed) on the 8th. Computed via `Intl` in the zone: the two-pass DST problem comes from deriving an offset by arithmetic, and the fix is to not do the arithmetic. |
| 5 | Tenant settings can narrow and cannot widen | **PASS** | Structural rather than checked: `narrow()` takes `max(start), min(end)` and is the only operation the engine has, so widening is **not expressible**. Asserted at the state, tenant and campaign layers, and proven commutative so layer order cannot change the answer. |
| 6 | The dialer never shows an enabled action on a lead it may not legally dial | **PASS** (server half) | The decision is server-side and returns a message for the UI to render. The button-state half is UI work, carried forward below. |

### What the audit found that the page did not

The final dial action now mirrors the server decision in the UI: it is disabled unless the current
panel is eligible, disclosure-confirmed, and has a phone number; blocked state copy includes the
server explanation and an accessible status description. This closes the local button-state
implementation gap, but does not replace the pending legal review or authenticated browser evidence.

**The platform data already existed** — `calling_window_state_rules` (52 rows) and
`calling_window_holidays` (8) — in a better shape than the one I was about to create (`effective_to`
for a superseded statute, `allowed_weekdays` rather than a single Sunday flag). My
`create table if not exists` **silently did nothing**, and the migration failed later on an insert
naming a column the real table lacks. That silent no-op is the root enabler of all eight collisions
in backlog 182, and it caught this change too.

**`tenant_app` could not SELECT either table.** This is the gap that mattered. An engine running in
the tenant plane with no access to the statutes sees no state rule and falls back to federal-only —
including for Florida, which stops at 20:00 and forbids Sundays. **A compliance engine that fails
open is worse than none, because it is trusted.** Now granted read, and asserted still unable to
write: a tenant that could edit a statute could widen its own window.

**`customerTimezone` defaults to `America/New_York` when a lead has no state.** Defensible for
rendering a callback reminder, indefensible for dialing — assuming Eastern for someone in California
means calling them at 05:00. The engine refuses instead: a lead with no state is not dialable, and
absence of data is not permission.

---

---

## LA-2.5 · Real-time lead post & speed-to-lead — 5 PASS, 1 PARTIAL

Board status on arrival: **Completed**. There was no `/api/leads/post/` route at all.

Migration: `20260913320000_la_2_5_2_6_lead_post_and_consent.sql`.
Service: `lib/leadPost/service.ts`. Route: `app/api/leads/post/[key]/route.ts`.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A posted lead is on screen in under 5 seconds end to end, including the scrub | **PARTIAL** | The server half is built and measured: `processing_ms` is recorded on every post, and the accept path performs the scrub plus lead/queue writes. The accepted post now also writes an idempotent `new_unclaimed_lead` notification for the agent surface before returning, with delivery failure isolated from vendor retry behavior. The under-five-second render measurement and authenticated browser proof remain open. |
| 2 | A litigator or duplicate is rejected with a specific reason code the vendor can act on | **PASS** | Twelve codes, a closed vocabulary in a check constraint, because "rejections are the billing mechanism" and a vendor cannot dispute a code they cannot parse. Verified live: litigator → `409 suppressed_litigator`, repost → `409 duplicate` returning the id of the lead it duplicates, no state → `422 unknown_state`, junk phone → `422 invalid_phone`, bad key → `401 unauthorised`. |
| 3 | Real-time leads are served ahead of every list lead regardless of scoring | **PASS** | `lead_queue.tier`, 0 for a post and 100 for a list lead; verified at **tier 0** on a live accept. An integer rather than a boolean because LA-2.8 already names callbacks and appointments as their own tiers. |
| 4 | Speed-to-lead is computed per vendor and visible | **PASS** | `posted_at` and `first_dial_at` on the lead, and `tenant_speed_to_lead` reporting **median** seconds and the share dialled within 60s, per vendor and campaign. Median rather than mean, deliberately: one lead dialled four hours late because the agent went home drags a mean into uselessness, while the median still answers "how fast is this normally". |
| 5 | A vendor hammering the endpoint is rate-limited without dropping legitimate posts | **PASS** | `LEAD_POST_PER_KEY`, 600/hour, keyed on the **key** rather than the IP — a ping-post vendor sending 300 an hour is doing what they are paid for, and an IP limit would let one vendor throttle another the moment two shared a platform. |
| 6 | A scrub-vendor outage rejects rather than accepting unscrubbed | **PASS** | The scrub RPC's error branch returns `503 scrub_unavailable` and never falls through to the accept. Rejecting costs one lead; accepting an unscrubbed lead somebody will dial costs a $500–$1,500 violation that arrives looking like a normal lead. |

### Findings from building it

**Idempotency is not the same as dedupe, and conflating them would cost money.** A vendor retrying
a post replays the original answer including the original `lead_id`; a *fresh* post of the same
person is a `duplicate` rejection. If the retry were reported as a duplicate the vendor would be
told they were not paid for a lead they had, in fact, successfully delivered once.

**`agent_leads.template_id` is NOT NULL with no default.** A posted lead has no template of its own,
so it takes the one the tenant's existing leads for that product already use — read rather than
re-derived, because a second opinion about which template a product uses would diverge the first
time one was versioned. With none, the post is refused rather than the lead invented: a lead
attached to no template is a lead no screen can open, and a vendor billed for it is billed for
something unusable.

**The queue insert's error is reported, not swallowed.** A lead created but never queued is a lead
nobody will ever see, and from the vendor's side it looks like a successful post. That guard caught
a real bug during verification — `status: "queued"` is not in `lead_queue`'s vocabulary, which is
LA-1.14's `unclaimed`.

**One gate, read once.** The campaign check reads `campaigns_servable`, so LA-2.3's scrub gate
applies to real-time posts as well: an unscrubbed campaign cannot take posted leads either. A second
copy of that rule would be a second chance to omit it.

---

## LA-2.6 · Consent artefact capture — 4 PASS, 2 BLOCKED

Board status on arrival: **Completed**. On the tenant plane nothing captured, stored or reported a
certificate.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A certificate is claimed and stored within the provider's expiry window | **BLOCKED** | Capture is built and verified — a posted `trusted_form_cert_url` is recorded as `trustedform / pending` on the same call. **Claiming** is an authenticated call to ActiveProspect or Verisk and needs real credentials, which this environment does not have. `capture_status` carries `pending → claimed / expired / failed` so the claim job has somewhere to land. Blocked on credentials, not on design. |
| 2 | Certificate presence and age are visible on the lead before it is dialed | **PASS** | `tenant_consent_artefacts` is per lead and tenant-readable; `captured_at` and `consent_timestamp` give presence and age. The lead-card rendering is UI work, carried forward. |
| 3 | Coverage per vendor is reported as a percentage | **PASS** | `tenant_vendor_consent_coverage`, verified live at **100.0%** on the fixture. Counted over every lead attributed to the vendor, **not over the artefacts** — a vendor supplying certificates for three of a thousand leads has 0.3% coverage, and counting artefacts alone would report 100%. Reported twice: any certificate, and *claimed* certificates, because an unclaimed one may not survive to be produced. |
| 4 | A lead with no certificate is flagged, not suppressed | **PASS** | `captureConsentArtefact` returns silently when no certificate is present, and its errors are logged rather than thrown. A lead accepted and then lost because its certificate could not be filed would be worse than a lead held without one — which the task explicitly permits, because many legitimate lists have none. |
| 5 | The stored copy survives the provider link expiring | **BLOCKED** | `stored_copy jsonb` and `stored_ref` exist for exactly this, and are unpopulated until claiming works. A URL is not a copy; recording the URL now is what makes the later claim possible, and discarding it because we cannot claim it yet would be the expensive mistake. |
| 6 | Certificates are included in a data export | **PASS** | The table is tenant-readable and joined to the lead, so it is included wherever leads are exported. No separate export path was added; a second one would drift. |

---

---

## LA-2.7 · Cadence & slot rotation — 5 PASS, 1 recorded as a specification conflict

Board status on arrival: **Completed**. Migration:
`20260913330000_la_2_7_2_8_cadence_and_serving.sql`. Engine: `lib/cadence/engine.ts`, pure,
**20 unit tests**.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A lead is never retried into a slot it has already failed in, while an unused slot remains | **PASS** | `nextSlot` over six slots — early morning, late morning, afternoon, early evening, late evening, weekend. Asserted that four consecutive attempts produce four *different* slots, that a stored `preferred_slot` is ignored once it has failed, and that a narrow window can never suggest a slot it does not reach. Enforced at the point of serving too: tier 4 in `serve_next_lead` excludes a lead whose current slot is already in `tenant_call_attempts`. |
| 2 | Cadence rows can be added, edited and deleted, per campaign | **PASS** | `tenant_cadence_rules` keyed `(tenant_id, campaign_id, attempt_number, disposition_scope)` with full CRUD granted to `tenant_app`. `campaign_id` null is the tenant default and a row with one overrides it — the current schema has per-campaign overrides that are unreachable from the UI; these are reachable. |
| 3 | An invalid interval is rejected at entry, not sent to the database | **PASS** | Both halves. `parseInterval` refuses `banana`, empty, zero, negative and non-strings before the round trip, and the column is `interval` rather than `text` so `banana` cannot be stored even by a caller that skips the service. Also refuses `1 mon 3 days 04:05:06`, which Postgres would accept: a cadence nobody can read at a glance is a cadence nobody notices is wrong. |
| 4 | A lead hitting the ceiling moves to nurture and stops being served | **PASS** | `scheduleNextAttempt` returns `exhausted: true, dueAt: null` rather than a date far in the future — the easy way to express it and the wrong one, since a queue that only checks whether the timer has elapsed would still serve it eventually. `serve_next_lead` excludes `lead_state = 'exhausted'` outright. |
| 5 | Changing a cadence affects the next lead served, with no deploy | **PASS** | The cadence is read per call, never cached. Asserted with a custom row taking effect immediately. |
| 6 | Attempts are front-loaded — five of seven within the first 72 hours on the default | **CONFLICT** | **The specification disagrees with itself, and the test records that rather than resolving it.** The default table in the same document is +2h, +1d, +1d, +2d, +3d, +5d, which is cumulatively 0, 2h, 26h, 50h, 98h, 170h, 290h — **four** attempts inside 72 hours, with the fifth at 98h. The cadence *is* front-loaded, which is the substance (the current production default is +4h/+1d/+3d spread over a fortnight), but it is not five of seven. Asserted as it actually is, with a second test showing a cadence that *would* satisfy the criterion, so whoever decides has both numbers in front of them. Quietly editing the table to make the checkbox pass would have hidden the conflict. |

---

## LA-2.8 · Lead queue & serving — 6 PASS

Current remediation note: the dialer now includes a tenant-scoped, read-only identity search at
`/api/app/dialer/search`. Search results are labeled as non-serving in the UI and the route does
not invoke the serving or claim flow. This closes the previously missing local interaction contract,
but does not close the task: the live shared database contract, broader dynamic-field search,
100,000-row performance target, inbound-return disposition, and authenticated desktop/mobile
browser evidence remain open in the master register.

Board status on arrival: **Completed**. `public.get_next_lead()` exists and is genuinely
sophisticated — six tiers, advisory-lock serving, a 15-minute lock with stale release, mixing
weights, scoring with a holdout cohort, and `private.outbound_retry_slot_eligible`, which is
LA-2.7's "promise nobody kept" actually kept.

**It cannot serve this product.** No application code references it or any `outbound_*` table;
`tenant_app` cannot EXECUTE it; and it resolves its caller through `outbound_agents` →
`users.organization_id`, which 38 of this application's 51 tenant users do not have.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Two agents pressing next simultaneously never receive the same lead | **PASS** | Verified live: two `serve_next_lead` calls returned different leads. The claim is an UPDATE filtered on the status that was read, so the loser matches no row and gets nothing this call rather than a duplicate. |
| 2 | A lead outside its window is never served, under any request | **PASS** | `tenant_can_dial_now` is inside the serving query, not in a view the client filters. Verified by draining the queue and asserting that a suppressed lead and a lead with no state never appeared once. |
| 3 | An abandoned lock returns the lead to the pool after the timeout | **PASS** | Stale locks are released at the top of every serve, so an agent who reconnects competes on equal terms rather than finding the lead gone. Verified by expiring a lock and serving the same lead again. |
| 4 | A real-time lead is served ahead of everything within seconds of arriving | **PASS** | Tier 1 is `posted_at >= now() - 5 minutes`. Verified: with a fresh lead and a real-time lead both eligible, the real-time one came back first, tagged `realtime`. |
| 5 | Serving is under 200ms with 100,000 eligible leads | **BLOCKED** | The indexes are in place (`lead_queue_serving_idx`, `agent_leads_retry_due_idx`, `tenant_call_attempts_lead_idx`). Measuring it needs a 100,000-row fixture on a deployed environment — the same gap as backlog 177 and LA-1.10 criterion 5. |
| 6 | The empty state explains itself rather than showing a blank panel | **PASS** | `serving_empty_reason` falls through `campaign_serving_block_reason` first, so "no campaign is scrubbed" outranks the generic message. The existing copy is kept verbatim, as the task asks. |

### Tier 3 is deliberately empty

"APPOINTMENT — a setter booked this one" is **not implemented**, and the gap is recorded rather than
filled. `appointments` in this schema is LA-0.5's **carrier appointment vault** — an agent's
licensing appointments with a carrier — not a meeting booked with a prospect. The first draft joined
it, which compiled and would have served leads on the strength of an unrelated insurance record.
That is a name collision *inside* the tenant plane, not between the two lineages. The setter-booked
appointment is LA-2.11; tier 3 stays empty until it exists, and the tiers either side are unaffected
because the priorities are explicit numbers rather than positions in a list.

### On having two calling-window implementations

`tenant_can_dial_now` (SQL) enforces; `lib/callingWindow/engine.ts` (TypeScript) explains. That is
the arrangement LA-2.4's page quotes approvingly from the existing code — *"The server enforces this
in get_next_lead; this is only so the UI can explain why a lead is not servable."* They read the
same two tables and compose the same three tighten-only layers. **If they ever disagree, the SQL one
is correct by definition, because it is the one that decides.**

---

## The finding that a row count would have hidden

`calling_window_state_rules` holds **52 rows**, which reads like the statutes are covered. Every one
of them was:

    start_local 08:00   end_local 21:00   allowed_weekdays {0,1,2,3,4,5,6}   source platform_federal_default

The federal rule wearing a state code. Florida's 20:00 cutoff and Sunday ban, Oklahoma's,
Louisiana's — none were there, so **LA-2.4 criterion 2 was not actually met** despite the table
looking populated.

Found by asserting a known statute instead of counting rows: a Sunday 11:00 call to a Florida lead
came back `allowed = true`. Corrected in `20260913340000_la_2_4_real_state_statutes.sql` for the
eight most commonly cited states, each with its citation in `source` and marked `(unreviewed)` —
**a starting set, not a legal opinion**, and it needs review by somebody qualified.

Now verified: FL Sunday 11:00 refused, NY the same Sunday allowed, FL Monday 20:30 refused.

### A correction to my own test

The first version of those assertions used June 2026 dates and failed, reporting that Florida was
still dialable on a Sunday. The rules carry `effective_from = 2026-09-08`, so in June **no state
rule is in force at all** and the federal default correctly applies. The code was right and the test
was wrong — which is precisely what `effective_from` and `effective_to` exist to express. The
assertions now compute an instant the statute is actually in force on. The same mistake is worth
watching for anywhere else a date is hardcoded against this table.

---

---

## LA-2.9 · Click-to-call dialer & dispositions — 3 PASS, 3 BLOCKED on the screen

Board status on arrival: **Completed**. Migration:
`20260913350000_la_2_9_dial_attempts_and_disposition.sql`.

`app/app/(shell)/dialer/page.tsx` renders `DialerPreflight` — 63 lines that check one typed phone
number against the DNC vendors. That is LA-1.5's preflight, not LA-2.9's dialer: no lead, no local
time, no attempt history, no disposition buttons. The three criteria about the screen are therefore
blocked on building it; the three about what happens underneath are done.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | No enabled action exists on a lead that may not legally be dialed | **BLOCKED** | The server half is enforced and proven — `serve_next_lead` never hands out a lead outside its window, so the dialer cannot be showing one. The button-state half needs the screen. Same blocker as LA-2.4 criterion 6. |
| 2 | The header shows the customer's local time, correctly across DST | **BLOCKED** | `localPartsIn` is built and tested across a DST boundary and in `America/Phoenix`; `current_slot_for_state` gives the same answer in SQL. Nothing renders it yet. |
| 3 | Every disposition schedules or terminates the lead — none leaves it in limbo | **PASS** | `complete_dial_disposition` is one function with no branch that leaves a lead unscheduled. Verified live: **seven consecutive no-answers** each returned `retry` with a date and a slot the lead had not already failed in, then the seventh terminated at the ceiling with `exhausted` and no date — and the exhausted lead was never served again across 20 serve attempts. Four terminal dispositions (`do_not_call`, `wrong_number`, `not_interested`, `application_submitted`) each closed the lead **and released the work item**: a lead left `claimed` after a disposition is exactly the limbo this criterion is about, since nobody else can serve it and its own agent has moved on. `do_not_call` wrote to the suppression list permanently. |
| 4 | A disposition with no click is flagged in the log | **PASS** | `dispositions_without_a_click`. Verified in both directions: a disposition recorded *with* a click is not flagged, and one recorded without is. Not blocked — an agent dialling from a desk phone is doing nothing wrong — but visible, which is the only integrity check available without telephony. |
| 5 | No metric labelled talk time is displayed | **PASS, by absence** | `call_duration_seconds` exists on `lead_dispositions` and `outbound_dispositions`, both organizations-plane, and **no application code reads either**. The only duration the agent app renders is `durationSince(item.startedAt)` in `agent-floor.tsx` — a live timer on an open call, computed in the browser, not a stored figure and not labelled talk time. So the wrong number the task warns about is not on screen. The columns that would produce it are still there, though, and anyone wiring a report from them would reintroduce it. |
| 6 | Keyboard-only operation for the whole loop | **BLOCKED** | Needs the screen. |

### The seam, left open deliberately

`tenant_call_attempts.provider_call_id` is nullable from the first migration. Click-to-call is a
`tel:` link into whatever softphone the agent already uses — there is no provider and no call id
today. Leaving the column out until one arrives would mean migrating a table that by then has
history in it.

### What this also closed

LA-2.8 carried two items forward — recording the attempt with its slot, and stamping the dial. Both
are done here, which is why the slot rotation in LA-2.7 now has evidence to work from: the serving
query's tier 4 reads `tenant_call_attempts`, and until this task nothing wrote to it.

---

---

## LA-2.10 · Callback scheduling — 6 PASS in the focused server/UI contract; browser evidence open

### Current reconciliation — 2026-09-14

The earlier partial finding about a missing overdue-counting surface is stale for the current
checkout. `app/app/(shell)/callbacks/page.tsx` and `components/app/callback-calendar.tsx` now render
separate Due today, Overdue, and Open callbacks counts, while retaining customer-local and
agent-local times and lifecycle controls. The focused `verify:callbacks` suite passes 20 checks,
including overdue visibility/counting, tenant scope, invalid-input handling, concurrent completion,
queue reopening, immutable history, and idempotency. The task remains **Browser-unverified** until an
authenticated desktop/mobile workflow is captured; this reconciliation does not claim that evidence.

Board status on arrival: **In Review** — the first task in this module not marked Completed.
Migration: `20260913360000_la_2_10_callback_window_check.sql`.

The task names two holes. **One was real and one was already closed**, and the difference matters
because the page describes the organizations-era version:

| Claim | Verdict |
|---|---|
| "Validates only the shape of the string, not the time itself" — so 03:00 is bookable | **REAL.** Nothing checked the calling window. |
| "An agent can book ... for last March" | **ALREADY CLOSED.** `complete_disposition_with_callback` and `reschedule_callback` both raise `CALLBACK_DATE_PAST` on `v_scheduled_at <= now()`. LA-1.22 fixed it. |

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A callback fires at 2pm in the **customer's** timezone, across a zone boundary | **PASS** | `scheduled_at_utc` is `p_callback_local at time zone customer_timezone`, stored as an instant. Tier 2 of `serve_next_lead` compares that instant to `now()`, so the zone is resolved once at booking and never re-derived. |
| 2 | Booking outside the legal calling window is rejected with a clear reason | **PASS** | `assert_callback_in_window`, called from both booking paths inside the RPC rather than the service — a compliance rule enforced only in TypeScript stops applying the moment anything else calls the API, and both RPCs are reachable with the service role. Verified: 03:00 in the customer's own zone raises `CALLBACK_OUTSIDE_WINDOW`, and the assertion also proves 14:00 is permitted, so the refusal is about the hour and not about the check being broken. The window is evaluated **at the booked instant**, not at booking time — "Thursday 2pm" must be legal on Thursday, and checking against now would reject most evening bookings made in the morning. |
| 3 | Booking in the past is rejected | **PASS** | Already true; verified rather than rebuilt. |
| 4 | A due callback appears at the top of the queue | **PASS** | Tier 2 in `serve_next_lead`, behind only real-time. Built in LA-2.8. |
| 5 | Overdue callbacks are visible and counted separately | **PASS — browser evidence open** | The current callback calendar renders separate Due today, Overdue, and Open callbacks counts. `verify:callbacks` passes overdue visibility/counting and lifecycle checks. Authenticated desktop/mobile browser proof remains open. |
| 6 | There is one callback implementation shared with LA-1.22, not two | **PASS** | `tenant_callbacks` and the LA-1.22 RPCs are used unchanged; this task added the window check to them rather than a second booking path. |

### Two of each callback function — and they are not ours

There are duplicate overloads of `reschedule_callback`, `cancel_callback` and
`claim_callback_reminders`:

    [CRM]    reschedule_callback(target_callback_id uuid, target_scheduled_at timestamptz, target_note text)
    [tenant] reschedule_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid, p_callback_local timestamp)

The `target_*` ones take no tenant id and write the organizations-era `callbacks`. They are the
CRM's and were left alone per the SA-3 rule. The signatures differ in arity *and* parameter names,
so PostgREST cannot resolve one when the other was meant — but it is worth knowing that criterion 6
asks for one callback implementation and there are literally two. They just belong to different
products.

---

## LA-2.11 · Appointment calendar & availability — 5 PASS, 1 partial

Board status on arrival: **In Review**. Migration:
`20260913370000_la_2_11_appointments_and_availability.sql`.

The organizations plane has `agent_availability`, `agent_blocks`, `agent_appointments`,
`outbound_appointments` and `appointment_reminder_events` — all organization-keyed and unreachable.
The tenant plane had no calendar at all, exactly as the task says.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Two setters booking the same slot simultaneously: one succeeds, one is told it went | **PASS** | A **GiST exclusion constraint** on `(tenant_id, agent_user_id, tstzrange(starts_at_utc, ends_at_utc))`, scoped to live statuses. Verified with an appointment **overlapping by 15 minutes and sharing no start** — the case a unique index on `(agent, start)` would have let through, because appointments have length. The booking function does **not** pre-check the overlap: the constraint decides it, which is the only way the race resolves in the database rather than in whoever read the slot list last. |
| 2 | No appointment outside the agent's availability or the customer's legal window | **PASS** | Both checked. The customer's window reuses `tenant_can_dial_now` at the booked instant — an appointment is a call, and one at 3am is a call at 3am our own system put in the diary. Verified refused. Availability and blocked time are checked in the agent's own zone. |
| 3 | The daily cap is enforced server-side | **PASS** | Counted in the **agent's** day rather than UTC's: a cap of eight means eight in his working day, and a UTC day would split it across two of his. Verified — the third booking against a cap of two raised `APPOINTMENT_DAILY_CAP_REACHED`. |
| 4 | An appointment appears in the queue when due, with the setter's notes attached | **PASS** | Tier 3 of `serve_next_lead`, finally filled. Verified end to end: a due appointment was served ahead of a fresh lead, tagged `appointment`, **with the setter's notes returned**. An appointment served without what the setter discussed is a cold call with a time attached. |
| 5 | Rescheduling frees the old slot atomically | **PASS** | The old row leaves the constraint's scope first, in the same transaction, so a reschedule can never collide with itself and the new time may legitimately be the old one. If the rebooking fails it rolls back, and the original slot is still held. Verified by rescheduling and then booking into the freed time. |
| 6 | Reminders fire in the right timezone for each recipient | **PARTIAL — implemented locally** | `20260914150000_la_2_11_appointment_reminders.sql` adds a `for update skip locked` claim function and recipient-level idempotency ledger. `lib/appointments/reminders.ts` renders both customer and agent local times, creates an in-app agent alert, and routes optional email through the disabled-by-default shared transport. Reminder links open the related lead at `/app/leads/[id]`; `/app/appointments` remains the separate carrier-appointment vault. Live migration, authenticated browser, and provider-delivery proof remain open. |

### Why `tenant_appointments`, not `appointments`

`public.appointments` on the tenant plane is LA-0.5's **carrier appointment vault** — an agent's
licensing appointments with a carrier, no `lead_id`. That collision already cost something: LA-2.8's
first draft joined it for tier 3, which compiled and would have served leads on the strength of an
unrelated insurance record.

### A note on the generated column that could not be

`slot tstzrange generated always as (tstzrange(starts_at_utc, starts_at_utc + make_interval(...)))`
is rejected: `timestamptz + interval` is **STABLE, not IMMUTABLE**, because adding months or days
depends on the session's TimeZone, and a generated column may only use immutable expressions. The
end is kept by a trigger instead, which gives the same guarantee — nothing can write a row whose end
disagrees with its own start and duration — without pretending the arithmetic is something it is not.

### Three corrections to my own tests

All three were the code working correctly inside a test measuring something else, and all three
would have been reported as product bugs by a less suspicious reading:

1. **The daily cap fired during the reschedule step.** Cap of two, two already booked — correct.
   The test now lifts the cap after asserting it.
2. **The exclusion constraint fired during the queue step.** The test moved *two* booked
   appointments to the same instant. It now moves one, by id.
3. **"The due appointment was not served."** The test chose a state dialable at 14:00 tomorrow and
   then served at `now()`, when that state was outside its window. It now requires the state to be
   dialable at **both** instants.

---

## LA-2.12 · Setter role & booking workflow — 5 PASS, 1 PARTIAL

Board status on arrival: **In Review**. Migrations `20260913380000_la_2_12_setter_role.sql` and
`20260913385000_la_2_12_invite_counts_a_seat.sql`.

The task's own warning is the design: *"Same shape as the buffer agent role in LA-1.14 — **share the
permission model**, do not invent a second one."* So `setter` is a fifth value on the
`tenant_user_role` enum and a fifth row in `ROLE_PERMISSIONS`. Nothing else. The consequence is the
whole of criterion 1: because every route in this application states the roles it admits, a role
that is new is admitted **nowhere** until somebody names it.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A setter calling any money, quoting or application route gets 403 — asserted by test across every route | **PASS** | Extends LA-0.2's exhaustive route-tree classifier rather than listing endpoints: a hand-written list stops being true the moment somebody adds the next route. Two new tests in `lib/tenantAuth/moneyRoutes.test.mjs`. Proven non-vacuous by a negative control — adding `setter` to `leads/route.ts` fails the suite with `leads/route.ts: allows setter`, and the gate had to be added for it to pass in the first place. The book of business is classified as a quoting/application route because a lead record carries the premium and the quote; `leads/[id]/notes` and `leads/[id]/disposition` deliberately are NOT, because recording dispositions and adding notes are in the setter's CAN column. |
| 2 | A setter cannot see another setter's leads or scorecard | **PASS** | Two halves, two mechanisms. The book-of-business list, draft and export are closed to the role outright. The single lead is scoped in `getLeadWorkspace` on the work item's `owner_user_id` — not the lead's creator, because a setter's claim is recorded on `lead_queue` by `serve_next_lead` and the lead row has no owner. A setter who was not served the lead gets "Lead not found", the same answer as for another tenant's lead: confirming that a lead exists is itself a leak. The scorecard's scope is decided from the caller's role inside the service and never from a parameter. |
| 3 | Booking an appointment attaches the setter's notes and notifies Ray | **PASS** | The notify is inside `book_appointment`, not the service that calls it — a booking that succeeded while the notification failed is precisely the complaint this task exists to prevent. Verified live: the notification row carried the setter's own text ("wants 20-year term, spouse on the call"), keyed on the appointment id so a retry cannot double-notify. |
| 4 | Show-rate per setter is computed from actual appointment outcomes, not self-reported | **PASS** | `tenant_setter_scorecard` reads five different tables on purpose, because the whole argument of the task is that they can disagree: dials from `tenant_call_attempts`, contacts from the disposition, booked from `tenant_appointments`, **showed from the status the licensed agent writes**, and sold from an application-submitted attempt after the appointment began. `mark_appointment_outcome` refuses a caller whose membership role is setter — a show rate is worthless if the person being measured can write the measurement. Verified: the setter was refused `SETTER_MAY_NOT_RECORD_OUTCOMES`, the producer recorded it, and the card then read 2 dials / 1 contact / 1 booked / 1 showed / 1 sold. |
| 5 | Setter seats count against the plan limit | **PASS**, and the fix is wider than the criterion | They did not, and neither did anyone else's — see below. |
| 6 | The roster shows each setter's local time | **PARTIAL — implemented locally** | `tenant_member_roster` computes both the local time and `on_shift_now` **in that member's own zone**, from the availability row LA-2.11 already stores. The current Activity & scorecard screen renders the team roster when the caller has team scope. Live migration and authenticated desktop/mobile proof remain open. |

### The seat limit was never enforced on the path tenants actually use

`max_seats` is checked in exactly three functions — `admin_create_user`, `admin_set_user_status`
and `admin_attach_user_to_tenant` — and **all three are the platform admin's path**. The path a
tenant owner uses from their own team settings page is `tenant_invite_user_with_auth`, which checked
`max_buffer_seats` for assistants and nothing at all for anybody else. There is no trigger on
`tenant_users` either.

Any tenant on any plan could invite unlimited seats from their own settings page. Backlog #15 is
recorded as resolved on the strength of SA-2.5 enforcing seats "at user creation", which is true of
the admin path and was never true of this one.

Fixed for every role rather than as a setter-shaped special case, because a limit that applies to
one role and not the others is the same bug in a smaller costume. It reuses `tenant_current_plan` /
`tenant_seats_used` and raises the identical `seat_limit_reached:<used>:<max>` string the
application has parsed since SA-2.5. Verified live: with the limit pinned to current usage, a setter
invitation was refused and **created nothing** — no membership, no invitation row.

---

## LA-2.13 · Lead scoring & call sequencing — 6 PASS

Board status on arrival: **In Review**. Five migrations, `20260913390000` through `20260913399000`,
and four of the five are one criterion.

The task prescribes the build order and says the order is the point: rules, then learn, then hold
out. **Step two is deliberately absent.** Refitting weights from observed contacts cannot be done
honestly before there are dials to fit to, and the task's own warning is about exactly that:

> `vendor_score` is imported from vendor files, its meaning is unconfirmed ... and the dialer
> **deliberately hides it**. That instinct was right. Do not put a number in front of an agent until
> you can explain it.

`outbound_scoring_decisions` and `outbound_scoring_cohort_stats` already exist with precisely this
shape — cohort, score, signal_snapshot, selection_reason — and both are organization-keyed, like
the whole `outbound_*` family. The same finding as every other task in this module.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Every served lead carries the reason it was chosen, in plain language | **PASS** | The reason is generated from the same arithmetic that produced the score, so it cannot drift from it. It exists **whether or not scoring is on**, which matters because scoring is off by default and therefore off for every lead on the day this ships — the tier is a reason in itself, and "a callback you promised is due" explains the choice more completely than any score could. Live sample: *"A fresh lead that has never been called — posted 1 days ago; attempt 1 of 7; never tried in the weekend slot; this vendor contacts at 32%; CT answers at 33% in this slot"*. |
| 2 | Scoring is a pure function of stored signals — the same lead at the same instant always scores the same | **PASS** | `p_at` is a parameter rather than `now()`, precisely so this is testable rather than assertable. Verified: same lead, same instant, identical score and identical signal snapshot; a different instant gives a different score, which is what stops the first check from passing on a function that returns a constant. |
| 3 | The holdout is real, and its contact rate is reported alongside the scored cohort | **PASS** | **Cohort per lead, coin flip per serve** — both halves are needed. Per lead by hash, so a lead never changes sides and its outcome stays attributable. Per serve, because the obvious alternative — order every candidate by score and let control leads take whatever position falls out — starves the holdout completely, since a control lead has no score to compete with, and a holdout that is never dialled produces no contact rate. Verified: at `holdout_pct = 20` over 1,000 leads the hash split 815/185, and both arms reported a rate (scored 36.0%, control 20.0%). No lead ever appeared in both cohorts. |
| 4 | Scoring is off by default and can be turned off entirely without breaking the queue | **PASS** | The default is `enabled = false` on the settings table, and a tenant with no settings row at all is off. When off, the scored path is **not reached** — the naive LA-2.8 query runs unchanged. That is the strongest form of the criterion: the off path is the old code, not the new code with a multiplier set to one. Verified by turning it off mid-run and serving again. |
| 5 | Scoring adds under 50ms to serving | **PASS**, after four attempts | Measured at 200 and 1,000 queued leads, interleaved. See below. |
| 6 | Weights are inspectable and adjustable | **PASS** | Rows in `tenant_scoring_weights`, not constants in a function body — a number compiled into a function is neither inspectable nor adjustable. Defaults come from a function so a tenant who has never touched them scores identically to one who has reset them. Verified: seven weights readable, and zeroing `recency` measurably lowered that lead's score. |

### Criterion 5 took four attempts, and the first three measurements were all misleading

The acceptance suite passed criterion 5 on its first run. **That pass was about the fixture, not the
feature** — forty queued leads was small enough to hide an O(candidates × history) scan.
Re-measured at two hundred:

    serve, scoring off   269.4 ms
    serve, scoring on   1082.0 ms
    scoring adds         812.7 ms

Two of the seven signals were full aggregates over `tenant_call_attempts` joined to `agent_leads`,
once per candidate — four hundred scans to choose one lead — and both returned the **same** answer
for every lead sharing a vendor or a state. Replaced with two counters per fact, incremented by
`complete_dial_disposition` in the same transaction as the attempt they count, so they are derived
but cannot drift. **812.7 → 89.5ms.**

Still linear. A bounded candidate set fixed that, and the pre-filter choice was load-bearing: the
obvious one — the first fifty in the naive order — would have been exactly wrong, because the naive
order is oldest-first while `recency` carries the largest weight and favours the newest.
Pre-filtering naively would have handed the scorer the fifty leads most likely to score worst, and
the feature would have measured as worse than nothing while appearing to work.

Then three passes that were each a guess, and two of them made it slower — 105ms, then 256.7ms when
the CTE was inlined, then 83.0ms when `as materialized` was restored. The accidental materialisation
had been load-bearing: `is_phone_suppressed` and `tenant_can_dial_now` are expensive function calls,
and inlining lets the planner evaluate them twice.

The remaining win was structural rather than a guess. `returns table(...)` makes a plpgsql function
set-returning, and every call built a tuplestore for its single row. Profiling showed three quarters
of the cost was not in the work:

    the five queries inside score_lead    24.3 ms / 50 calls
    score_lead itself                    103.7 ms / 50 calls

OUT parameters return that row directly: **103.7 → 34.9ms**, with the arithmetic unchanged.

**The final measurement, and a note on how the earlier ones were taken.** The baseline swings by
more than a hundred milliseconds between runs on this pooled instance, so measuring "off" and "on"
as two separate blocks compares one sample of each against noise of the same size — which is how a
6ms difference had been reported as 83ms. Forty of each, alternating, timing `serve_next_lead`
alone:

| queued leads | scoring off (median) | scoring on (median) | added |
|---|---|---|---|
| 200 | 158.1 ms | 159.8 ms | **+1.7 ms** |
| 1,000 | 388.4 ms | 394.5 ms | **+6.1 ms** |

Criterion met. Two caveats recorded rather than buried: the p90 at 1,000 leads is 405.5ms unscored
against 547.7ms scored, so there is a tail; and the **baseline itself** is 388ms at a thousand
leads, which is already far over LA-1.10's 200ms target before scoring is involved at all. That
belongs to LA-2.8's eligibility query and to backlog #177, not here.

### The cost of the candidate cap, stated plainly

A lead outside the fifty most recent in its tier cannot win, however well it would have scored on
its other six signals. That is a real recall limit and it is why the cap is fifty rather than five.
Tier still leads the final ordering, so a high-scoring fresh lead can never be served ahead of a
callback the customer is waiting for.

---

## Three defects in LA-2.8 and LA-2.9, found by re-running their suites

None of these came from LA-2.13. All three are faults the existing suites only caught under
conditions that had stopped holding — **a green suite is evidence about the run, not about the
code**, and two of these had been going green on fixture state rather than on behaviour.

**One · a reclaimed lead is returned to a pool it can never be drawn from.** LA-2.8 criterion 3 is
"an abandoned lock returns the lead to the pool", and the reclaim does return the *work item* —
status goes back to `unclaimed`, the lock clears. The *lead* is left in `lead_state = 'working'`, and
no tier in `serve_next_lead` matches a working lead. Probed directly:

    served first time                     73527921-...
    lead_state after serve                working
    re-served after abandoned lock        0
    queue status after reclaim attempt    unclaimed

So an agent who claims a lead and walks away does not release it back to his colleagues. He destroys
it, silently, and the queue goes on reporting work it will never hand out. The reclaim now restores
the lead as well as the work item: back to `fresh` if nobody dialled it, back to `retry` due
immediately if there are attempts on it.

**Two · the cadence proposed the same slot forever.** `schedule_next_attempt` built its
already-tried list from the slot each call *actually happened in*, and six dispositions in a loop all
happen in the same real-world slot. The slot it *proposed* last time was never written anywhere it
would read back, so it proposed the first unused slot — the same one — every time. The suite had
passed because `tenant_cadence_rules` held fixture rows supplying the variation; there are **zero**
cadence rules in the database today, so the default path runs, and the default path could never
rotate. Every tenant who has not configured a cadence, which is all of them, got one hypothesis
repeated six times.

**Three · every terminal disposition raised instead of terminating.** Behind the second defect, never
reached while the suite failed earlier in the file:

    ERROR: 55000 record "v_sched" is not assigned yet
    CONTEXT: PL/pgSQL function complete_dial_disposition ... at RETURN QUERY

`v_sched` is assigned only in the cadence branch, and the final statement read it through a guard
that looks protective and is not — PL/pgSQL hands the whole expression to the SQL engine with the
record as a parameter, so a branch that is never taken still has to be describable. The effect: the
dialer could record a no-answer and nothing else. **Do-not-call, wrong number, disconnected, not
interested, did not qualify, application submitted, sent to underwriting, no payment method and
callback scheduled all threw** — every disposition that *ends* a call, against a task whose
criterion is that none leaves the lead in limbo. Every one of them did, because the writes had
already happened and the function then failed, rolling them back. Now verified across all eleven
dispositions in the vocabulary plus an unrecognised one.

---

## LA-2.14 · Interested → verification & application handoff — 5 PASS

Board status on arrival: **In progress**. Migration
`20260913410000_la_2_14_outbound_application_handoff.sql`.

### Read the decision log before the task page

The task page says the outbound lead and the application are "one record, not two". Decision 14
supersedes that sentence, and it is dated after the page:

> It was never about cardinality ... replace with: *The outbound lead is not duplicated and the
> verification flow is not forked. The lead links to one application case; that case may hold
> several application attempts.*

Implemented to the amendment. Taking the original wording literally would have produced a lead that
can only ever have one application, and a customer declined by carrier A and issued by carrier C
would have been unrepresentable — which is precisely the collision the decision was written to
resolve.

### What was actually missing, in order of how badly

| | Finding |
|---|---|
| 1 | **Nothing created a verification session for an outbound lead.** `claim_transfer_lead` creates one; `serve_next_lead` does not. The panel's own loader requires an existing session and never creates one, so an outbound agent got `verification_owner_required` no matter what they did. |
| 2 | **No deal-flow row exists for an outbound lead, ever.** `writePartnerIntakeArtifacts` writes it at partner-submission time, and an outbound lead has no partner submission — it arrived by list import or the post API. Criterion 5 had nothing to appear. |
| 3 | `deal_flow` carried `campaign_id` and not `vendor_id`, and nothing anywhere recorded whether a deal came from inbound or outbound. |

The first of these is the task in one sentence: the flow existed and the door did not.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | The verification panel is the same component as inbound, with no outbound-specific fork | **PASS** | `lib/outboundApplication/noFork.test.mjs` asserts it structurally rather than by comment: exactly one module in `lib/` exports `getVerificationPanel`, the outbound route imports it rather than touching `verification_fields` or `tenant_verification_sessions` itself, the shared service branches on no outbound flag, and **both routes call the panel with identical arguments**. That last one is the test that matters — the fork nobody notices is not a copied file, it is one extra parameter. Proven non-vacuous: adding `{ isOutbound: true }` to the outbound call fails the suite. The two routes differ in exactly one thing and it is not a fork — the **entitlement**, because inbound transfers and outbound dialling are separate purchases and gating the outbound door on `inbound_transfers` would mean a tenant who bought the dialer could not use it. |
| 2 | `campaign_id` and `vendor_id` survive onto the application and the policy record | **PASS — contract; fixture proof open** | Both are carried by trigger at each hop, not joined at read time: a campaign can be re-pointed at a different vendor, and a deal must keep the vendor it was actually bought from rather than the one the campaign belongs to today. `tenant_lead_attribution_chain` reads the whole chain in one place and reports `case_attribution_lost` / `deal_attribution_lost`; the live issued-policy trigger extends the same invariant to `tenant_issued_policies`. A namespaced fixture should still be run before treating the live path as complete. |
| 3 | A dropped call resumes with everything already collected | **PASS** | The entry point is idempotent by construction, which is the whole criterion: called again it returns the **same** verification session, and the collected field values hang off that session id. Resuming is not a second code path that has to be kept in step with starting. Verified end to end against the real thing — a field confirmed, the lock expired, the lead reclaimed and re-served (which is exactly what a dropped call looks like to this system), then back in through the same door: same session, same case, field still confirmed. |
| 4 | The deal-flow row is indistinguishable in structure from an inbound one, except for its source | **PASS** | Same table, same columns, same defaults; `source` is the one difference and it is now an explicit column rather than something inferred from `partner_id` being null. |
| 5 | An outbound sale appears correctly in the daily deal flow | **PASS** | The row is created at the moment the application starts, which is the moment an outbound lead becomes a worked deal. Upserted on `lead_id`, so an inbound lead already carrying a row is found rather than duplicated. |

### Two things the entry point refuses

A **setter** cannot start an application — LA-2.12's role table says they cannot "sell, quote, or
submit an application", and it is enforced inside the RPC as well as at the route, for the same
reason the calling-window check is: a rule that lives only in TypeScript stops applying the moment
anything else calls the API.

An application cannot be started on **somebody else's work item**. That is the same defect as
LA-2.12's cross-setter leak arriving through a different door, and it was worth closing at the same
time rather than after somebody found it.

### One open case per lead, many over a lead's life

A partial unique index on `(tenant_id, lead_id) where status = 'open'`. Two open cases on one lead
would mean two agents taking the same application, which is the duplicate pipeline the original
sentence was reaching for. A **closed** case does not block the next one — refusing that would be
the literal reading decision 14 corrected.

---

## LA-2.15 · Carrier autofill browser extension — **CANCELLED, not audited**

Board status: **In progress**. It should not be.

Decision 16 retires this task and LA-2.16 outright:

> **LA-2.15 (Carrier autofill browser extension)** and **LA-2.16 (Per-carrier field maps)** describe
> the same extension and the same field maps as **LA-3.12, LA-3.13 and LA-3.14** — with different
> rules. They were written during the outbound module, before the Sell module existed.
> **Retire LA-2.15 and LA-2.16. Mark both `Cancelled` with a pointer to the LA-3 tasks.**

Building it would have been the most expensive mistake available in this module: an L-effort Chrome
extension, a second auth model, and a second set of field maps, all superseded before a line of it
was written. The task page still carries *"decide the auth model before writing code"* as an open
question; LA-3.12 answered it.

**Nothing has been built against it.** Verified across the repository: no `manifest_version`, no
content script, no background worker, no carrier allowlist, no autofill code. The only matches for
"field map" are the lead-post field mapping from LA-2.5 and the template field definitions, neither
of which is this.

### The three rules that must not be lost in the move

Decision 16 names them explicitly, and they are recorded here because a cancelled task is where
good rules go to be forgotten:

1. **"Never guess."** A field the extension is unsure about is left **empty and flagged**, never
   filled with a best guess. A silently wrong date of birth is worse than an empty one. → LA-3.13
2. **"Fill, never submit."** The agent presses submit themselves, always, asserted by test. → LA-3.13
3. **Allowlist-only.** The extension is completely inert on any domain not on the carrier
   allowlist. → LA-3.12, where it should be confirmed explicit rather than assumed.

**Action for the board:** set LA-2.15 and LA-2.16 to `Cancelled` with a pointer to LA-3.12 / LA-3.13
/ LA-3.14. Leaving them `In progress` is how somebody spends a fortnight on the extension that was
already retired.

---

## LA-2.12 criterion 4, re-scored — I marked it PASS against superseded wording

Recorded here rather than quietly edited into the LA-2.12 section above, because the mistake is the
useful part.

Last session I scored *"show-rate per setter is computed from actual appointment outcomes, not
self-reported"* as **PASS**, and built exactly that: a status only a licensed agent may write, with
`mark_appointment_outcome` refusing a setter. The implementation was right for the sentence. **The
sentence had been replaced.**

Decision 12 asks the question the criterion does not survive: the only person who knows whether
someone showed is Ray, after the call — and **people are being paid on this number**. If he forgets
to mark it, the setter's score is wrong. What I shipped was the literal reading, and its failure
mode is precisely the one the decision identifies: nothing filled in when he does not write it.

**Corrected** in `20260913415000_la_2_12_show_rate_amendment.sql`, to the three-part rule:

| Part | Behaviour | Verified |
|---|---|---|
| Automatic | Any recorded activity on the lead near the slot — a disposition, a note, an application case, a deal update — marks it `showed`. Ray dispositioning the call **is** the marking; most appointments need zero extra clicks. | A dispositioned appointment was inferred as `showed` with nobody touching it |
| Pending | Anything with no activity becomes `pending`, an explicit state rather than an absence, and appears on a close-out strip. **Never `no_show`** — "a missing mark never silently becomes a penalty against someone's pay." | A silent appointment went to `pending`; a five-day-old one dropped off the strip |
| Coverage | Pending is excluded from both halves of the rate. The scorecard reports coverage beside it. | Show rate read 100% at 1-of-3 coverage, then 50% at 2-of-3 after a real no-show |

The coverage figure is the part that looks least important and matters most. A show rate of 62% from
31 of 38 is a number to act on; the same 62% from 8 of 38 is not, and the reader cannot tell them
apart without it. `ScorecardRow` carries `coveragePct` next to `showRatePct` so no screen can render
one without the other being to hand.

The setter still cannot write the outcome. That part of the original was not superseded, and it is
the reason the number means anything at all.

### What this says about the audit method

Ten criteria in this module have now been scored against the task pages alone. **The decision log is
a second source and it wins**, and at least four other tasks here are affected by it: LA-2.3's
serve-time check, LA-2.7's cadence floor and least-recently-used fallback, LA-2.8's lead search and
`inbound return call` disposition, and LA-2.19's replacement of dispute rate with undialable rate.
Those are listed under *Carried forward* and should be re-read against decisions 1, 2, 3 and 11
before any of them is called finished.

---

## Not yet audited

LA-2.17 through LA-2.24. LA-2.2 is now audited below. LA-2.15 and LA-2.16 are **cancelled** and need no audit.

Of the thirteen tasks audited so far, **eight were marked Completed and none of them were; four were
marked In Review and were consistently closer to it; one was In progress and needed a doorway rather
than a build.** The module's specification was written against the organizations-era CRM; the
tenant-era application inherited the specification but not the software.

### Carried forward

| Item | Why |
|---|---|
| The dialer screen itself | LA-2.9 criteria 1, 2 and 6; also LA-2.4 c6 and LA-2.6 c2 |
| Appointment + callback reminder jobs | LA-2.11 c6 and LA-2.10 c5; `lib/callbacks/reminders.ts` is the pattern |
| `campaign_id` → application / policy | Tenant-plane structures are live; namespaced end-to-end issued-policy proof remains |
| Serving under 200ms at 100,000 leads | Needs a deployed environment, as backlog 177 and LA-1.10 |
| State statutes beyond the eight seeded | Needs legal review; the seeded eight are marked `(unreviewed)` |
| The 5-of-7-in-72h conflict | The spec's table and its criterion disagree; a decision, not a bug |
| Consent certificate claiming | Needs ActiveProspect / Verisk credentials |
| "On screen in 5 seconds" | Accepted posts now write the idempotent agent alert; authenticated end-to-end render timing and live notification-schema proof remain open |
| `call_duration_seconds` columns | Unused, and would reintroduce a false talk-time metric if wired to a report |
| `tenant_do_not_call.is_active` | Spec says permanent; the column allows deactivation |
| Scrub execution + import rejection | Both need LA-2.2 |
| Wrong-number / disconnected credit claims | Recorded as dispositions; the claim itself is LA-2.19 |
| The setter roster and scorecard screens | LA-2.12 c6; the API and the views are built |
| Refitting the scoring weights from observed contacts | LA-2.13 step two; needs dials to fit to, and must not ship before them |
| Scoring's p90 tail at 1,000 queued leads | 547.7ms against a 405.5ms unscored p90; the median is +6.1ms |
| `serve_next_lead` at 388ms before scoring | LA-2.8's eligibility query, not LA-2.13's; backlog #177 |
| The close-out strip on Ray's dashboard | LA-2.12 decision 12; the local screen, route, view contract, and RPC contract are built, but live promotion and browser evidence remain open |
| Application attempts inside a case | LA-3.7 / LA-3.16; the case exists and carries the attribution |
| Re-reading LA-2.3, 2.7, 2.8 and 2.19 against the decision log | Decisions 1, 2, 3 and 11 amend criteria already scored |
| Setting LA-2.15 / LA-2.16 to `Cancelled` on the board | Decision 16; they still read `In progress` |

## LA-2.2 · List import — 2026-09-14 — PARTIAL

The approved live repair migration `20260914193000_la_2_2_import_actor_membership_fix.sql` now
changes the actor check to the shared `public.tenant_users.tenant_id` membership bridge. The
live-server rerun of `verify:lead-import` passes atomic import, replay idempotency, concurrency,
invalid-CSV rejection, cross-tenant isolation, and audit logging. Usable-row cost allocation, the
20,000-row runtime benchmark, and authenticated browser evidence remain open.

The task is implemented and live-aligned, but it is not fully accepted. The local parser, preflight,
screening path, transactional commit contract, and live two-tenant isolation path are covered by
code and focused tests. Authenticated desktop/mobile evidence, usable-row accounting, and the 20k
runtime benchmark remain unavailable.

| Criterion | Result | Evidence and remaining gap |
|---|---|---|
| Vendor column mapping is reviewable and reusable | Partial | `suggestLeadCsvMappings`, an authenticated mapping save route, `tenant_import_mappings`, and reusable workspace controls now exist locally; live promotion and authenticated browser proof remain open. |
| Import-time DNC/suppression screening | Partial | `importAgentLeads` screens rows before commit and fails closed; live vendor/RLS/browser evidence remains open. |
| Usable-row accounting and cost allocation | Partial | Campaign cost is passed into source attribution; usable-row accounting and an auditable allocation metric are not yet persisted. |
| Atomic import commit | Partial | `20260914193000_la_2_2_import_actor_membership_fix.sql` is live, and `verify:lead-import` passes atomic commit, replay idempotency, concurrency, and cross-tenant isolation. Authenticated browser proof remains open. |
| Truthful preflight preview | Partial | The browser uses the same parser and blocks malformed files; vendor scrub outcomes and exact suppressed-row counts are not previewed. |
| 20,000-row memory/performance behavior | Blocked | The reviewed RPC caps a request at 2,000 rows and no 20k benchmark or accepted design decision exists. |
| Phone/date/timezone normalization | Partial | Pure normalization contracts and tests pass locally; live template/browser evidence is still open. |
