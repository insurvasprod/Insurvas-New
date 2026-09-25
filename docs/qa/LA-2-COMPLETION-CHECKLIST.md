# LA-2.1 – LA-2.19 · What is left before the module is finished

Written 2026-09-13, from the live audit in `LA-2-QA-AUDIT.md`. Every line here is something that was
actually checked — nothing is listed because it sounded plausible.

**Current reconciliation — 2026-09-14.** The reviewed
`20260914193000_la_2_2_import_actor_membership_fix.sql` is now live. `verify:lead-import` passes the
full atomic import/isolation suite, so LA-2.2 is **PARTIAL** rather than database-misaligned; usable-
row accounting, 20k runtime evidence, and authenticated browser proof remain.

**Where the module stands.** Thirteen tasks audited, one never opened, one cancelled. Of the
audited thirteen, **the data and enforcement layers are done and verified against the live
database.** What remains is concentrated in four places, and only the first is large:

| | | Blocks |
|---|---|---|
| **A** | Six screens that do not exist | 9 criteria across 6 tasks |
| **B** | One task nobody has audited (LA-2.2), marked Completed | 7 criteria, and 2 more in LA-2.3 |
| **C** | A decision log the task pages have never absorbed | 4 tasks already scored may be scored wrong |
| **D** | Things that are not code: credentials, legal review, a board edit, a storage bill | 5 criteria |

---

## 0. Do these first — they are cheap and they stop waste

- [x] **Resolve LA-2.15 and LA-2.16 in the repository as `Cancelled`**, pointing at LA-3.12 / LA-3.13 /
      LA-3.14. Decision 16 retired both tasks. Nothing has been built against either; verified across
      the repo (no `manifest_version`, no content script, no allowlist, no autofill code).
- [x] **Update the external planning board** to the same `Cancelled` state. Confirmed live on
      2026-09-22: both task pages read `Status: Cancelled`.
- [ ] **Carry the three rules out of LA-2.15 before it closes.** Decision 16 names them and they are
      worth more than the task: *never guess* (an unsure field is left empty and flagged, never
      filled with a best guess — a silently wrong date of birth is worse than an empty one) and
      *fill, never submit*, both into LA-3.13; *allowlist-only*, confirm it is explicit in LA-3.12.

      **Checked against the live task pages, 2026-09-22 — one of the three did not land, and two
      LA-3 pages are stale against the decision log that retired these tasks.**

      | Rule | Where it should be | State |
      |---|---|---|
      | Never guess | LA-3.13 | **Partly.** Drift detection covers a selector matching **zero** elements — `map_miss`, no fill, `needs_review`, falls back to the copy-assist panel, with an acceptance criterion. LA-2.16's companion rule, *"a selector matching **more than one** element fills nothing and reports it"*, is **not** there, and neither is LA-2.16's *"sensitive fields never appear in a log, a metric or an error report"* |
      | Fill, never submit | LA-3.13 | **No.** Neither LA-3.13 nor LA-3.12 mentions submit at all, and neither carries the acceptance criterion decision 16 asks for (*"asserted by test"*). This is the rule with the liability attached: *"an extension that submits an insurance application unattended is a liability we are not taking on."* |
      | Allowlist-only | LA-3.12 | **Yes, explicit.** *"`activeTab` plus an explicit host allowlist built from configured carrier origins. Never `<all_urls>`"*, with a matching acceptance criterion |

      Both LA-3 pages were last edited **2026-08-27**, two weeks before the decision log. So
      **LA-3.12 is also stale against decision 13**: it still specifies a **15-minute** grant in both
      its hard rules and its acceptance criteria (*"a request at 15:01 returns 401"*), where decision
      13 replaced that with a configurable 60–90 minutes, default 90 — *"a real Final Expense
      application takes considerably longer than 15 minutes"* — and it carries no
      `write_application_fields` scope, which is what LA-2.15's *"corrections flow back"* rule depends
      on. An engineer picking up LA-3.12 today would build the version the decision log already
      rejected.

      None of this is code: nothing has been built against any of these tasks. It is the amendment
      half of decision 16 and decision 13, still unapplied on the board.
- [x] **Resolve the storage retention problem** (backlog 201). Live inspection on 2026-09-14
      identified the producer: older SA-4.9 performance runs retained thousands of disposable
      `SA-4.9 perf%` tenants, and tenant creation correctly cascaded the default pipeline and
      disposition catalog into each one. The current verifier no longer creates a 500-tenant
      performance batch; it only uses one temporary billing fixture and deletes it. The retained
      fixtures were removed after explicit owner approval: 3,000 matching tenants, with zero
      tenant memberships remaining. Managed historical Realtime retention/compaction is separate
      operational follow-up; no managed partition was deleted.

---

## A. The screens — one of them unblocks five criteria

Every one of these has its server half built, enforced and verified. What is missing is rendering.

### A1. The dialer screen — **the single highest-value item in the module**

Blocks **LA-2.9 c1, c2, c6**, **LA-2.4 c6**, and **LA-2.6 c2**. Five criteria, one screen.

- [x] The current screen renders a disabled/blocked dial action from server eligibility, and the
      click endpoint repeats calling-window, suppression, and fresh DNC checks before opening `tel:`.
      The final action is also disabled when the current panel reports `eligibility.allowed: false`
      and exposes the server reason through an accessible status description.
- [x] The customer's local time and resolved timezone are rendered from the server panel; DST logic
      remains covered by the timezone unit tests.
- [ ] Keyboard-only operation for the whole loop in an authenticated browser.
- [x] Certificate presence, provider, and age are rendered on the lead card before the dial when
      `tenant_consent_artefacts` contains evidence.
- [x] Render the selection reason from LA-2.13. `serve_next_lead` already returns
      `selection_reason`, `score` and `cohort`. **Show the reason; do not show the score** until
      somebody can explain it — that is LA-2.13's own warning about `vendor_score`, and the reason
      the old dialer hid it.

The screen is now implemented in `components/app/dialer-workspace.tsx` and its panel contract is
server-backed by `lib/dialerScripts/service.ts`. It is not accepted yet: the authenticated browser
run is still pending, and the new
`complete_existing_dial_disposition` migration is not live-applied. The service deliberately fails
closed rather than updating only the attempt row when the atomic function is unavailable.

### A2. The other four surfaces

- [x] **Setter roster** (LA-2.12 c6) — `tenant_member_roster` gives local time and `on_shift_now`
      per member, computed in that member's own zone. Verified live.
- [x] **Setter scorecard** — `/api/app/scorecard` and `tenant_setter_scorecard` are built and the
      current Activity & scorecard screen renders them.
      **`coveragePct` must render beside `showRatePct`, always.** 62% of 31 is a pay decision; 62%
      of 8 is not, and without coverage the reader cannot tell them apart.
- [x] **The close-out strip** (decision 12) — implemented locally in
      `components/app/appointment-close-out-strip.tsx`, mounted on Activity & scorecard, with
      tenant-scoped GET/POST route guards and explicit Showed/No-show/Cancelled actions. The
      reviewed `tenant_appointment_close_out` view and `mark_appointment_outcome` RPC remain
      unpromoted in the shared project, and authenticated browser evidence is still open.
- [x] **Overdue callback count** (LA-2.10 c5) — `tenant_callbacks.status` carries `missed`, the
      reminder job moves them, and the callback calendar renders separate **Due today**, **Overdue**,
      and **Open callbacks** counts. `verify:callbacks` passes the overdue visibility/counting,
      tenant scope, lifecycle, and idempotency checks. Authenticated desktop/mobile browser evidence
      remains open.
- [ ] **Vendor / campaign management** — `tenant_lead_vendors`, `tenant_campaigns`,
      `tenant_vendor_rollup` and `campaigns_servable` all exist with no screen. `scrub_status` and
      `campaign_serving_block_reason` are the two fields that explain why a campaign serves nothing.

### A3. Two jobs, not screens

- [x] **Appointment reminders** (LA-2.11 c6) — `customer_timezone` and `reminder_sent_at` are on the
      appointment and the availability row carries the agent's zone, so both recipients' zones are
      known. `20260914150000_la_2_11_appointment_reminders.sql` adds an idempotent claim function and
      recipient event ledger; `lib/appointments/reminders.ts` records in-app reminders and uses the
      shared disabled-by-default email transport.
- [ ] **Close-out pass on a schedule** — `close_out_due_appointments` is written, idempotent and
      verified; nothing calls it yet.

### A4. LA-2.18 / LA-2.19 — implemented locally, live proof pending

- [x] **Campaign comparison** (LA-2.18) — matched-period validation, side-by-side funnel volumes,
      selectable contact/conversion/cost metric, and plain-English confidence are implemented in the
      True CPA workspace and `tenant_campaign_comparison` RPC. It never chooses a winner or moves budget.
- [x] **Vendor returns and credit ledger** (LA-2.19) — claimable scrub/disposition evidence, tracked
      return windows, draft/submitted/outcome states, evidence CSV, partial credits, and campaign credit
      deltas are implemented in `lead_claims`, `lead_claim_items`, and the vendor-return RPCs.
- [ ] **Deploy and authenticate the proof** — apply both migrations on the reconciled Supabase project,
      load safe tenant fixtures, and verify the comparison and claim flows in an authenticated browser.

---

## B. LA-2.2 · List import — audited 2026-09-14, **PARTIAL**

This task was audited against the current importer and its downstream scrub/cost contracts. The
following local and live-contract gaps are now closed; live/browser evidence and two acceptance
items are still required before the task can pass:

- [x] **Import-time screening is wired.** The importer preflights both meters and calls the screening
      service before the final commit; DNC/litigator outcomes fail closed.
- [x] **Transactional commit.** `import_agent_lead_batch` is the service-only final commit contract;
      lead inserts and source attribution share one database transaction, and within-batch duplicates
      are resolved before commit.
- [x] **Preflight preview.** The browser runs the same parser used by the write path and blocks import
      on an invalid header, stage, or typed value while showing the valid-row count.
- [x] **Normalization.** Phones, dates, state/ZIP, and timezones use one tested contract, including
      the Florida/Tennessee ZIP-prefix corrections and leading-zero ZIP preservation.
- [x] **Column mapping persistence (local contract).** `suggestLeadCsvMappings` supports explicit
      corrected mappings, `tenant_import_mappings` stores one mapping per tenant/vendor/product,
      and the import workspace can save and reuse it. Live migration and authenticated evidence are
      still open.
- [ ] **Cost allocation over usable rows.** `tenant_campaigns` has `total_spend_cents`,
      `records_purchased` and the generated `effective_cost_per_record_cents`, but nothing computes
      usable = purchased − scrub rejections. The gap between the two **is** the vendor return claim
      in LA-2.19, so getting it wrong loses real money.
- [ ] **20,000 rows without the browser running out of memory.** The local parser is bounded to 2,000
      rows per request; a representative 20k browser/runtime benchmark and the task's intended batch
      strategy still need an explicit decision.

The focused implementation evidence is `lib/agentTemplates/csv.test.mjs`,
`lib/agentTemplates/importNormalization.test.mjs`, and `lib/agentTemplates/importBatch.test.mjs`.
The approved additive repair `supabase/migrations/20260914193000_la_2_2_import_actor_membership_fix.sql`
is live and the verifier now passes the atomic import, replay, concurrency, invalid-CSV,
cross-tenant, and audit checks. The verifier harness was also corrected to consume simulator request
bodies. Remaining gaps are usable-row accounting, the 20k benchmark, and authenticated browser proof.

> Audit LA-2.2 before trusting anything downstream of it. LA-2.20 (recycling) and LA-2.6 both depend
> on it, and its board status has already been wrong about everything else in this module.

---

## C. Reconcile the decision log — four tasks may be scored wrong

*Sixteen Open Questions, Answered* (2026-09-11) is **newer than every task page** (2026-09-09) and
amends nineteen tasks. None of those amendments has reached the pages. This has already cost work
twice: LA-2.15 was nearly built, and **LA-2.12 c4 was scored PASS against wording that had already
been replaced** — the implementation was right for the sentence and wrong for the product, and had
to be rebuilt.

Re-read these four against the log before calling any of them finished:

- [ ] **LA-2.3 ← decision 3.** The serve-time check must never call a vendor; it reads our own
      tables only. A vendor outage blocks **import**, not dialling. *Already true in the
      implementation* — but the acceptance criterion still says the old thing, so verify and reword
      rather than assume.
- [ ] **LA-2.7 ← decision 2.** `delay_interval` becomes a **floor**, not an exact time; slot
      diversity is the hard rule; the fallback when all slots are used is **least recently used**.
      ⚠️ **Backlog 198 fixed the rotation by advancing through unused slots by attempt number.
      That satisfies the spirit and is not LRU.** Reconcile the two rather than leaving both.
- [ ] **LA-2.8 ← decision 1.** A **lead search** must exist alongside the queue — Ray needs to pull
      up somebody who just rang him back. Opening a lead through search is **not a serve**: it must
      not consume a cadence attempt, not mark the lead served, not change its queue position. The
      current checkout now has a tenant-scoped read-only identity search at
      `/api/app/dialer/search`, with explicit non-serving UI copy and no serving-RPC call. The
      `inbound return call` disposition and authenticated browser/live performance proof remain
      open.
- [ ] **LA-2.7 c6, the 5-of-7-in-72h conflict.** The spec's own default table gives **four**
      attempts inside 72 hours, with the fifth at 98h. Decision 2 makes it a population target
      rather than a per-lead guarantee. Confirm that reading and reword the criterion.

---

## D. Not code — decisions, credentials and money

- [ ] **State calling statutes beyond the eight seeded.** Forty-four states still run on the federal
      default and the seeded eight are marked `(unreviewed)`. This is legal review, and it is the
      one item here where being wrong is a per-call fine.
- [ ] **ActiveProspect / Verisk credentials** — blocks **LA-2.6 c1 and c5**. Capture is built and
      verified; *claiming* a certificate is an authenticated call. `capture_status` and
      `stored_copy` already exist for the claim job to land in.
- [ ] **`tenant_do_not_call.is_active`** — the spec says a do-not-call entry is permanent; the column
      allows deactivation. One of the two is wrong. Decide, then make them agree.
- [ ] **`call_duration_seconds`** — the columns exist on `lead_dispositions` and
      `outbound_dispositions`, no code reads either, and wiring them to a report would reintroduce a
      talk-time metric that was never true. This remains explicitly deferred: product must choose
      whether to remove or implement the metric. This is separate from the cancelled LA-2.15 /
      LA-2.16 carrier-autofill tasks. Leave the columns alone until the product decision; do not
      half-wire them.

---

## E. Performance — one real number, one environment gap

- [ ] **`serve_next_lead` costs ~388ms at 1,000 queued leads before scoring is involved at all.**
      That is LA-2.8's eligibility query, not LA-2.13's scoring, and it is already far over
      LA-1.10's 200ms target. The per-row cost is `is_phone_suppressed` and `tenant_can_dial_now`
      being called for every candidate. **This is the real performance problem in the module** and
      it is recorded honestly rather than hidden behind the scoring numbers.
- [ ] **LA-2.8 c5: under 200ms with 100,000 eligible leads.** Indexes are in place
      (`lead_queue_serving_idx`, `agent_leads_retry_due_idx`, `tenant_call_attempts_lead_idx`).
      Measuring it needs a 100,000-row fixture on a deployed environment — same gap as backlog 177.
- [ ] **Scoring's p90 tail.** Median cost is **+1.7ms at 200 queued leads and +6.1ms at 1,000**, well
      inside the 50ms budget. The p90 is 547.7ms scored against 405.5ms unscored. Worth a look once
      the baseline above is fixed, not before.
- [ ] **LA-2.5 c1: "on screen in 5 seconds".** The server half is measured — `processing_ms` is
      recorded on every post and the accept path is one scrub RPC plus two inserts. Accepted posts
      now also create an idempotent `new_unclaimed_lead` alert for eligible agent recipients before
      the response returns. The end-to-end render measurement still needs live notification schema
      promotion and authenticated browser evidence.

---

## F. Genuinely blocked on later modules — do not attempt these here

Listed so nobody spends a day discovering it.

- [ ] **LA-2.1 c1, the last hop: `campaign_id` → policy.** Lead → application case → deal is now
      built by LA-2.14, and the live tenant plane now includes `tenant_issued_policies` plus the
      attribution trigger from LA-2.17. A namespaced lead → application case → issued-policy fixture
      run is still required. `insurance_policies` is organization-keyed and belongs to the CRM; it
      must not be substituted for the tenant-plane record.
- [ ] **Application attempts inside a case** — LA-3.7 and LA-3.16. `tenant_application_cases` exists,
      carries `campaign_id` and `vendor_id`, and enforces one open case per lead; the attempts
      within it are Module 3's.
- [ ] **Wrong-number / disconnected vendor credit claims** — recorded as dispositions today; the
      claim itself is LA-2.19.
- [ ] **Scoring step two: refit the weights from observed contacts.** Deliberately absent. It cannot
      be done honestly before there are dials to fit to, and shipping a fitted-looking number with
      no data behind it is the exact failure LA-2.13 warns about. The holdout is live and recording
      — let it gather evidence first.

---

## The shape of what is left

| Task | State | What remains |
|---|---|---|
| LA-2.1 | 4 PASS, 1 partial | The live policy structure is present; end-to-end fixture proof remains |
| **LA-2.2** | **PARTIAL — audited 2026-09-14** | **The live membership-bridge repair is deployed and the full import/isolation verifier passes; usable-row accounting, the 20k benchmark, and live/browser proof remain** |
| LA-2.3 | 6 PASS | Import-time scrub execution (LA-2.2); reword per decision 3 |
| LA-2.4 | 6 PASS | Button state (dialer screen); 44 states unreviewed |
| LA-2.5 | 5 PASS, 1 partial | The "on screen" half of 5 seconds |
| LA-2.6 | 4 PASS, 2 blocked | Vendor credentials |
| LA-2.7 | 5 PASS, 1 conflict | Reconcile with decision 2 — floor, LRU, population target |
| LA-2.8 | 6 PASS | Lead search (decision 1); 100k performance |
| LA-2.9 | 3 PASS, 3 blocked | The dialer screen |
| LA-2.10 | 5 PASS, 1 partial | Overdue counting surface |
| LA-2.11 | 5 PASS, 1 partial | The reminder job |
| LA-2.12 | 5 PASS, 1 partial | Roster + scorecard + close-out screens |
| LA-2.13 | 6 PASS | Reason on the dialer; weights refit later |
| LA-2.14 | 5 PASS | — |
| LA-2.15 | **cancelled** | External board update; carry three rules to LA-3.13 |
| LA-2.16 | **cancelled** | External board update; field-map work belongs to LA-3.12 / LA-3.13 / LA-3.14 |
| **LA-2.17** | **implemented locally** | Deploy migration and run authenticated performance proof |
| **LA-2.18** | **implemented locally** | Deploy migration and run authenticated comparison proof |
| **LA-2.19** | **implemented locally** | Deploy migration and run authenticated claim/credit proof |
| **LA-2.20** | **implemented locally** | Deploy migration and run authenticated reactivation/suppression/source proof |
| **LA-2.21** | **implemented locally** | Deploy migration and run authenticated setter/export/100k-row proof |
| **LA-2.24** | **implemented locally** | Deploy migration and run authenticated rule-order, licensing, capacity, sticky-owner, and inactive-return proof |
| **LA-2.25** | **blocked: no authoritative task record** | Provide the direct Notion task page or acceptance contract before implementation |

**If you do three things, do these:** audit LA-2.2 properly, build the dialer screen, and fold the
decision log into the task pages. The first two account for most of what is left, and the third is
what stops the next task being built to a superseded spec.

---

## G. LA-2.20 / LA-2.21 implementation pass

| Task | Acceptance criterion | Evidence/status |
|---|---|---|
| LA-2.20 | Full attempt history retained and visible | **PASS locally** — `lead_attempt_history` is append-only and lead detail renders every attempt after a recycle reset. |
| LA-2.20 | Suppressed numbers never reactivated | **PASS by design/static review** — reactivation applies the suppression gate and re-screens every candidate before serving. Authenticated DB proof needs the migration applied. |
| LA-2.20 | Reactivated leads are re-scrubbed | **PASS locally by code path** — the campaign remains `scrubbing` until per-lead screening completes; DNC/litigator hits are suppressed and blocked. |
| LA-2.20 | One person, multiple campaign sources | **PASS locally by code path** — normalized-phone import reuses the lead and adds a campaign source row with campaign cost attribution. |
| LA-2.20 | Recycle cap enforced | **PASS by database guard** — `recycle_count < max_recycles` is enforced inside `reactivate_nurture`. |
| LA-2.20 | Recycled contact rate reported separately | **PASS locally by code path** — `tenant_recycle_performance` and the activity workspace separate fresh and recycled served/clicked/contact rates. |
| LA-2.21 | Served/clicked/logged remain separate | **PASS locally** — queue-claim and attempt triggers populate separate timestamps; a missing click remains missing. |
| LA-2.21 | Zero-click visibly flagged | **PASS locally by code path** — activity rows expose `zero_click_disposition` when a disposition has no click timestamp. |
| LA-2.21 | Every grid exports CSV without a row cap | **PASS locally by code path** — CSV mode omits SQL pagination and applies tenant/role/filter boundaries. |
| LA-2.21 | Paginated read path | **PASS by design/static review** — indexed server-side pagination caps page size at 500; a 100k-row runtime benchmark still needs a reachable database. |
| LA-2.21 | Setter sees only own scorecard | **PASS by database guard** — the report forces setter agent scope to the authenticated actor. |
| LA-2.21 | No talk-time metric | **PASS** — the field and UI label are `card_open_seconds`; no `talk_time` label is introduced. |

Local code checks passed during this pass: `npm run typecheck`, `npm run lint`, focused nurture tests,
and the production build. Authenticated browser and migration-runtime proof remain environment-dependent:
the local Supabase endpoint is unavailable (`ECONNREFUSED 127.0.0.1:54322`) and protected pages redirect
to login without credentials.

## I. LA-2.24 / LA-2.25 implementation pass

| Task | Acceptance criterion | Evidence/status |
|---|---|---|
| LA-2.24 | Licensed agent never receives a lead in a state they cannot write | **PASS by database guard/static contract** — candidate selection calls `public.can_write()` for every owner/producer candidate; term-life rules also exclude setters. Authenticated SQL proof needs the migration applied. |
| LA-2.24 | Agent at capacity is skipped and the next eligible agent is tried | **PASS by database transaction/static contract** — the candidate capacity row is locked, `current_open` is recomputed from open queue ownership, and full candidates are skipped. |
| LA-2.24 | Rules run in priority order and first match wins deterministically | **PASS locally by static contract** — active rules sort by `priority, id`, and the first matching rule exits the evaluator. |
| LA-2.24 | Sticky dispositions keep the lead with its current owner | **PASS by database guard/static contract** — active undispositioned ownership returns the current owner without automated reassignment; explicit reassignment requires a reason. |
| LA-2.24 | Inactive assignee leads return to the pool automatically | **PASS by database trigger/static contract** — user status changes return open owned work to `unclaimed`, end active calls, and append an `auto_returned` event. |
| LA-2.24 | Changing a rule affects the next assignment without deploy | **PASS locally** — authenticated `PUT /api/app/assignments` persists rules and `POST` calls the transaction-backed next assignment operation. |
| LA-2.24 | In-scope rest days, unassigned pool and reassignment reasons | **PASS by code path/static contract** — tenant rest-day settings gate a new owner by household/phone key; pool return and reassignment reasons are append-only assignment events. |
| LA-2.25 | Authoritative goal, scope, and acceptance criteria | **BLOCKED** — Notion search found no LA-2.25 page or task record. No requirements were invented. |

The implementation map is `supabase/migrations/20260913490000_la_2_24_lead_assignment_rules.sql`,
`lib/assignment/service.ts`, `app/api/app/assignments/route.ts`,
`components/app/assignment-workspace.tsx`, and `/app/assignments`. The focused contract suite is
`lib/assignment/la224.test.mjs`.

Functional, code-review, and QA checks for this pass: focused LA-2.24 contract tests (6 passing),
`npm test` (468 passing), `npm run db:check`, `npm run typecheck`, `npm run lint`, and `npm run build`
pass. Unauthenticated HTTP smoke testing confirms `/app/assignments` redirects to `/app/login` on the
running local production instances. Authenticated browser/database proof and Supabase semantic/RLS
execution remain unavailable because Postgres is not listening at `127.0.0.1:54322`; those are named
environmental blockers, not claimed acceptance failures. LA-2.25 remains blocked because no authoritative
task record was found.

## Consolidated remediation status — 2026-09-14

The current cross-module queue is [`MASTER-GAP-BLOCKER-REGISTER.md`](MASTER-GAP-BLOCKER-REGISTER.md).
The refreshed live inventory now reports 165/165 application-called RPCs and 86/86 declared triggers;
the remaining database finding is the declared-types/live-shape collision inventory; the reviewed
LA-2 migrations are live. LA-2.9 has a server-gated dialer workflow and an
additive transactional disposition contract; authenticated desktop/mobile evidence remains open.
LA-2.10's callback counts are present and its focused verifier passes, while browser proof remains
open. LA-2.2 is now live-aligned after the membership-bridge repair; later LA-2 scope remains subject to the documented performance, provider,
legal, storage, and task-definition blockers.

## H. LA-2.22 / LA-2.23 implementation pass

| Task | Acceptance criterion | Evidence/status |
|---|---|---|
| LA-2.22 | Hand-crafted requests over a limit return 403 | **PASS by API and database guard** — `assertOutboundLimit` returns a named 403 response; setter and active-campaign mutations also have tenant-scoped constraint triggers. |
| LA-2.22 | Pausing a campaign frees its slot immediately | **PASS by design/static review** — active usage counts `status = 'active'`; pause is a status mutation and the trigger rechecks the same count. |
| LA-2.22 | Exhausted scrub credits block import without dialable unscrubbed leads | **PASS by code path** — the whole batch preflights scrub capacity, each DNC lookup is atomically capped/idempotent, screening happens before insert, DNC/litigator results are rejected, and only then `agent_leads` is written. |
| LA-2.22 | Limited screens show usage against cap | **PASS locally** — lead import and team settings render usage/cap; campaign GET returns the active-campaign snapshot for its screen/API consumer. |
| LA-2.22 | Upgrade prompt names the specific limit | **PASS locally** — responses include `limit_key`, `limit_label`, current usage, cap, and an upgrade message. |
| LA-2.23 | Script variables resolve from the live lead | **PASS locally** — server rendering replaces first name, state, and age values and the UI renders only resolved section text. |
| LA-2.23 | State/product disclosure is visible and cannot be dismissed | **PASS by code path** — the disclosure is a separate always-rendered card; missing approved wording produces a blocking message and disables preparation/dialing. |
| LA-2.23 | Reading confirmation is recorded against the attempt | **PASS by API/SQL path** — `confirm_call_disclosure` binds tenant, agent, attempt, state, product, and timestamp; dialing and disposition also require the recorded timestamp. |
| LA-2.23 | Script edit applies to the next lead without deploy | **PASS locally** — the dialer editor writes a new version and reloads the panel; version selection occurs at panel-load time. |
| LA-2.23 | Rebuttals are reachable in one click | **PASS locally** — all six required objection keys render as one-click expandable buttons. |
| LA-2.23 | Guidance does not push phone/disposition controls off screen | **PASS locally** — script content is independently scrollable and phone/disposition controls remain in a separate card. |

Verification after the final hardening pass: `npm test` (462 passing), `npm run typecheck`,
`npm run lint`, `npm run build`, focused `lib/outboundLimits/la222223.test.mjs`, and
`npm run db:check` all pass. Live Postgres execution and authenticated tenant proof remain blocked
until Supabase is available at the configured local endpoint (`127.0.0.1:54322`).
