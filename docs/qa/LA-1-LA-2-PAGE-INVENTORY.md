# LA-1 and LA-2 — every page, and whether it works

**Date:** 2026-09-23 · **Branch:** `redesign/foundations`

Answers the question directly: *which pages should LA-1 and LA-2 have, are they all built, and does
the functionality inside each one actually work.*

Three things are separated throughout, because conflating them is how this module looked finished
while large parts of it could not be used:

- **Built** — the route exists and renders.
- **Functional** — the things the screen offers can actually be done, end to end, by a person.
- **Blocked** — built and functional, but something outside the screen stops it working today.

---

## 1. The pages

### LA-1 · Inbound lead acquisition

| Page | Route | Built | Functional | Notes |
|---|---|---|---|---|
| Transfer inbox | `/app/inbound` | ✅ | ✅ | Claim, disposition, buffer. |
| Agent floor | `/app/floor` | ✅ | ✅ | Who is available, who is on a call. |
| Partner chat | `/app/partner-chat` | ✅ | ✅ | |
| Publishers | `/app/publishers` | ✅ | ✅ | |
| Partner quality review | `/app/partner-quality` | ✅ | ✅ | |
| Duplicates | `/app/duplicates` | ✅ | ✅ | |
| Callbacks | `/app/callbacks` | ✅ | ✅ | |
| Lead workspace | `/app/leads` | ✅ | ✅ | |
| Dashboard | `/app/dashboard` | ✅ | ✅ | Appointment close-out strip added this session. |

LA-1 has no unbuilt pages. The partner plane (`/partner/*`) is separate and complete.

### LA-2 · Outbound lead acquisition

The workflow this module implements, in order:

> CSV import → **lead list** (not a pipeline) → **lead assignment** → **dialer** → **disposition** →
> **pipeline**, with the disposition deciding *which* pipeline.

| Page | Route | Built | Functional | Notes |
|---|---|---|---|---|
| List import | `/app/import` | ✅ | ⚠️ | Import works. Campaign attribution throws — see §3. |
| Lead lists | `/app/lead-lists` | ✅ | ⚠️ | Built this session. Inventory, not progress. Empty until attribution is fixed. |
| Vendors & campaigns | `/app/campaigns` | ✅ | ✅ | Cost per usable lead, speed-to-lead. |
| Lead assignments | `/app/assignments` | ✅ | ✅ | Sticky refusals now reported as refusals, not successes. |
| Dialer | `/app/dialer` | ✅ | ⛔ | Built and correct. **Blocked** — see §3. |
| Calendar | `/app/calendar` | ✅ | ✅ | Built this session. Day/week, both timezones, agent filter. |
| Carrier appointments | `/app/appointments` | ✅ | ✅ | Relabelled — it is carrier appointments, not diary appointments. |
| Lead recycling / nurture | `/app/nurture` | ✅ | ✅ | |
| Deal flow | `/app/deal-flow` | ✅ | ✅ | |
| True CPA | `/app/true-cpa` | ✅ | ⚠️ | Starved of data — see §3. |
| Vendor returns | `/app/vendor-returns` | ✅ | ⚠️ | Same. |
| Scoring | `/app/scoring` | ✅ | ✅ | |
| Activity | `/app/activity` | ✅ | ✅ | Fresh vs recycled performance. |
| **TCPA / DNC** | `/app/tcpa` | ✅ | ✅ | **Built this session.** Was a nav entry pointing at a 404. |
| **Consent locker** | `/app/consent` | ✅ | ✅ | **Built this session.** Same. |
| Settings | `/app/settings` | ✅ | ✅ | Four new tabs this session — see below. |

### Settings tabs (LA-2 configuration)

| Tab | Built | Notes |
|---|---|---|
| Calendar & availability | ✅ | Built earlier this session. |
| **Dialing cadence** | ✅ | **Built this session.** `tenant_cadence_rules` had no writer. |
| **Calling windows** | ✅ | **Built this session.** `tenant_calling_windows` had no writer. |
| **Lead posting** | ✅ | **Built this session.** `tenant_vendor_post_keys` had no writer. |

### Admin plane

| Page | Route | Built | Notes |
|---|---|---|---|
| Compliance (DNC vendors) | `/admin/compliance-sources` | ✅ | |
| **Disclosures** | `/admin/state-disclosures` | ✅ | **Built this session.** `state_disclosures` had no writer anywhere. |

### Not LA-1 or LA-2

Fifteen nav entries are declared and unbuilt. Thirteen belong to later modules and are correctly
out of scope: `sell.quoting`, `sell.applications`, `sell.draft-dates`, `book.statements`,
`book.discrepancies`, `retention.payment-repair`, `retention.winback`, `insight.persistency`,
`partners.payouts`, `partners.partner-portal`, `accounting.pnl`, `accounting.tax`,
`compliance.litigation`.

The two that *were* in scope — `compliance.tcpa` and `compliance.consent` — are now built.

---

## 2. What was built this session, and why each mattered

All six share one defect shape: **a table with a schema, RLS policies, grants, a tuned index and
readers — and nothing anywhere that could create a row.** Every reader was written to cope with the
absence, so nothing errored and nothing logged. The only symptom was that the setting could not be
found.

| Table | Readers | Writers before | What the absence did |
|---|---|---|---|
| `state_disclosures` | dialer panel, `confirm_call_disclosure` | **none** | Outbound dialing blocked in every state, on every tenant |
| `tenant_cadence_rules` | `schedule_next_attempt`, serving query | **none** | Every tenant ran the built-in cadence and could not see that they were |
| `tenant_calling_windows` | `tenant_can_dial_now` | **none** | The tenant layer of a four-layer tightening rule was permanently absent |
| `tenant_vendor_post_keys` | lead-post endpoint | **none** | No vendor could be given a key; the endpoint was unreachable in practice |
| `tenant_suppression_list` / `tenant_do_not_call` | dialer, screening | three code paths | No screen: a complaint arriving by email could not be actioned |
| `tenant_consent_artefacts` | ingest, claim job, dialer | two code paths | No way to find one certificate months later, which is the only time it is used |

Each is now written, role-gated, audited, and guarded by a mutation-verified test.

**Verified live, not just in source:**

- Disclosure publish → the dialer's exact query finds the row. Re-publishing the same day updates
  in place. Cleanup restored the table to 0 rows.
- Cadence: `2 hours` → stored `02:00:00` → shown back as `2 hours`. `banana` refused by Postgres.
  Cleanup restored 0 rows.
- Suppression: `is_phone_suppressed` returns an array (the service handles it), formatted and raw
  numbers resolve to the same row, a five-digit number is refused. Cleanup verified by re-checking.

**Two findings from those probes, both of which changed the code:**

1. **The cadence unique key does not prevent duplicates.**
   `unique (tenant_id, campaign_id, attempt_number, disposition_scope)` reads like a guarantee, but
   Postgres treats NULLs in a unique index as distinct — and a tenant-default catch-all rule is NULL
   in two of the four columns. Verified: the identical row inserted twice was accepted.
   `schedule_next_attempt` ends with `limit 1` and no tiebreak, so duplicates make the cadence
   *undecided* rather than wrong. The API route's check is currently the only thing preventing it.
   Migration `20260923100000` fixes the constraint with `nulls not distinct`; it parses and is
   **unapplied**.

2. **Three client components imported values from `server-only` modules.**
   Typecheck does not catch this — only the types would have been erased. Found by running a full
   `next build`. Fixed by splitting client-safe constants out of each service.

---

## 3. What is still blocked, and by what

**UPDATE 2026-09-23: all twelve migrations were applied.** Blockers 1 and 2 below are cleared;
Blocker 3 remains, and it was never a migration. Verified after the run:

- `lead_queue` went from 11,543 rows to **214,823** — one per lead. `POST /api/app/dialer/next`
  now serves a lead ("tier 5 · a fresh lead that has never been called"). An imported list is
  dialable for the first time.
- `npm run verify:la2-deployment` passes, including its own "a CSV-imported lead can reach the
  dialer" consequence check.
- `/api/app/vendors` no longer emits a pending-migration schema-gap notice.
- Internal DNC deactivation and deletion are both refused (`23514`); a duplicate tenant-default
  cadence rule is refused (`23505`).
- `security_invoker` survived both view rebuilds — checked by connecting as `tenant_app` and
  counting distinct tenants per view. One, as it must be.

**Resolved 2026-09-23 by re-importing a list.** Ten leads now carry a `campaign_id`, and the
chain holds at every hop: `tenant_lead_sources` records 350¢ and `csv:2` per lead, the lead-list
screen shows the list, and True CPA reports `effective_cost_per_lead_cents: 350` for it — exactly
$35.00 / 10. `attribution_warnings: 0`.

Two caveats. The tenant-wide True CPA cost per lead reads **$860**, which is arithmetically right
and practically misleading: it divides all seven campaigns' spend by the only ten attributed leads.
It will settle as the other lists are re-imported. And re-importing surfaced a separate defect —
see [LA-2-SCRUB-GATE-HAS-NO-KEY.md](LA-2-SCRUB-GATE-HAS-NO-KEY.md): **attributing a lead makes it
undialable**, because `serve_next_lead` lets `campaign_id is null` through unconditionally but
requires an attributed lead's campaign to be `scrubbed`, and nothing in the product ever marks a
campaign scrubbed.

**Previously true:** leads carried no `campaign_id` (0 of 214,823). The table whose absence made the
campaign-attributed import throw now exists, but nothing re-ran the import, so True CPA and vendor
returns stay empty until a list is imported again. That is now a data step, not a schema one.

The original text follows for the record.

### Blocker 1 — imported leads cannot be dialled
`20260917146000_la_2_imported_leads_reach_the_dialer.sql`.
`serve_next_lead` reads only `lead_queue`, and CSV import never enqueues. Import works; the dialer
honestly reports "Nothing servable" and nothing connects the two. **This is the one that makes the
module's main path untestable end to end.**

### Blocker 2 — nothing carries a campaign
`20260917140000` creates `tenant_campaign_costs`. It does not exist, so the campaign-attributed
import path throws, so **0 of 214,823 leads carry a `campaign_id`**. True CPA, vendor returns and
the lead-list screen all starve from this one cause.

### Blocker 3 — no disclosure is published
Not a migration. The publisher now exists at `/admin/state-disclosures`, and the table is empty.

**This is deliberately left empty.** Publishing the approved wording for a product and its states
is a compliance decision, not one to invent. The dialer's block is correct behaviour and the fix is
for someone with the authority to publish real text — which they can now do. Seeding placeholder
legal copy that agents would read aloud to consumers would be worse than the block.

### Verified against the live schema, 2026-09-23

Checked by asking PostgREST for its published surface, not by reading notes. Definitively unapplied,
proven by the object being absent:

- `20260917140000` — `tenant_campaign_costs` returns PGRST205. **This is Blocker 2.**
- `20260922210000` — `active_calls.provider_call_id` is not in the schema.
- `20260923100000` — the identical cadence row inserted twice was accepted.

Confirmed **applied**: `20260917143000` (the consent-coverage view exists and holds 6 rows).

The rest `create or replace` functions that already existed under the same name, so their state
cannot be told apart from outside without SQL access. Re-applying them is harmless — every file is
`create or replace` / `if not exists` — so the ordered file below simply runs all twelve.

### Ready to apply

`docs/qa/pending-migrations-2026-09-23.sql` — all twelve concatenated in dependency order
(2,154 lines). Order matters: `146000` backfills rows that `140000`'s table makes attributable,
and `100000` de-duplicates before it tightens a constraint.

```
supabase db query --linked --file docs/qa/pending-migrations-2026-09-23.sql
```

### Also unapplied
`20260917141000` (20k import batch), `20260917142000` (internal DNC permanence),
`20260917144000` (slot rotation deadlock), `20260917145000` (inbound return call),
`20260922190000` (outbound deal date + policy attribution),
`20260922200000` (size warning threshold), `20260922210000` (inbound telephony seam),
`20260922220000` (disposition routes to its own pipeline),
`20260923100000` (cadence uniqueness — new this session).

All parse (`npm run db:check`).

---

## 4. Browser pass

Driven in an authenticated session as the demo owner, against the live project.

| Screen | Result |
|---|---|
| `/app/tcpa` | Lists the 2 suppressed numbers with counts. Checking `(512) 555-0101` returned **"do not call · Requested removal on a recorded call"** — the same RPC the dialer calls. |
| `/app/consent` | Renders empty, correctly. **The coverage panel was wrong and is fixed** — see §6. |
| Settings → Dialing cadence | "The built-in cadence is running", with the actual schedule spelled out. Saved 6 rules → flipped to "Your cadence is running. 6 rules stored." Round trip exact: `2 hours` → `02:00:00` → `2 hours`, `@weekend` preserved. Cleared → back to 0 rows. |
| Settings → Calling windows | Reads real statutes. Wider-than-federal → **400 `wider_than_federal`** with a plain reason. Inverted → **400 `inverted_window`**. Valid narrowing saved; cleared back to none. |
| Settings → Lead posting | Minted a key for Apex Lead Partners. **A garbage key gets 401 from the post endpoint; the minted key gets past auth** and fails on the payload instead. Rotation retired the old key (401) while the new one stayed live, field map carried over. |
| `/admin/state-disclosures` | **Not verified in a browser.** Every row in `admin_users` has `is_active = false`, so a minted admin token verifies and then bounces to `/admin/login` saying nothing. Activating a shared admin account is not a change to make unasked. The screen's data layer *was* verified directly against the live table (publish → the dialer's exact query finds it → re-publish updates in place → withdraw), and the page compiles in `next build`. |

Everything written during this pass was removed afterwards and the removal re-checked:
`tenant_cadence_rules` 0, `tenant_calling_windows` 0, `tenant_vendor_post_keys` 0,
`state_disclosures` 0, `tenant_do_not_call` back to its 2 pre-existing fixtures.

One fix came out of the browser pass that no test would have caught: the calling-window panel's
"only show states that differ" filter listed **all 52**, because every state carries `noHolidays`
and the filter counted it. The comment above it claimed the opposite. The universal rule is now
stated once and the list shows the six states that actually narrow the hours.

---

## 5. A bug in this session's own work

The consent locker reported *"the reporting view has not been created on this deployment yet"*.
That was **false**. `tenant_vendor_consent_coverage` is deployed and holds six rows. The query
asked for `claimed_pct`; the view's column is `claimed_coverage_pct`. The 42703 fell into
`coverageAvailable: !coverage.error`, which turned any failure at all into a calm sentence sending
the reader off to check a migration.

That is the exact defect this audit exists to find — an error collapsed into a reassuring message —
written into the screen built to catch it. Now: only PGRST205 counts as "not deployed", anything
else throws, and `lib/consent/coverageFailsLoudly.test.mjs` fails in both directions.

Worth recording alongside it: the probe I wrote to check whether `tenant_campaign_costs` exists
used `head: true`, which returned no error and a null count, and I read that as "present". It is
not present. **Third time this session** that a swallowed query error nearly became a false claim.

---

## 6. State of the tree

- Tests: **775 passing, 0 failing**.
- Typecheck: clean.
- ESLint: clean.
- `next build`: clean.
- Live shared state: restored. Every probe cleaned up after itself and the cleanup was verified by
  re-reading, not assumed.

New mutation-verified guards:
`lib/stateDisclosures/hasAPublisher.test.mjs`, `lib/cadence/hasAnEditor.test.mjs`,
`lib/entitlements/everyReaderHasAWriter.test.mjs`.

The last of those took three attempts to make honest. The first version passed with the
calling-window writer deleted, because the same file mutates a different table. The second passed
with every cadence `insert` deleted, because a `.delete()` remained. Both were found by trying to
break the guard rather than by reading it.
