# Compliance and Reports: functional QA, 3 Nov 2026

This pass tested every feature in the Compliance area (`lib/compliance/steps.ts`) and the Reports area
(`lib/reports/views.ts`) to see whether it works and whether its figures are right. It covers each
route, detail page, action, filter, export, dialog and background job. A separate pass checks layout
and design-system conformance: see `docs/compliance/FOUNDATION-PASS.md` and the Reports foundation
pass. Defects in screens those sessions were rewriting were sent to them instead of being edited here.

**Sources of "expected":** the Notion sprint tasks LA-6.1–6.8, the Module 6 doc, and LA-1.18, LA-2.13,
LA-2.17, LA-2.18, LA-2.19, LA-3.21, LA-4.18, LA-5.8 and LA-5.9 (read 3 Nov). A one-line checklist per
task is in the session notes folder (`notion-spec-checklists.md`). Code comments and the owner's
recorded decisions also count.

**How each feature was tested:**

- **Code:** the path was read from page to API route to store or RPC.
- **Unit:** the existing node tests were run. Before this pass, 810 of 810 passed across the 93
  compliance and report test files.
- **API:** every GET behind the screens was called with a minted demo-owner session (`curl`/`fetch`, GET only).
- **Data:** figures were recounted from the rows with read-only service-client SELECTs or STABLE RPCs.
  The Supabase MCP refuses this project, so the recounts used a scratch script.
- **Browser:** each step and view was walked on `localhost:3000` in the built-in browser. Anything
  that writes, sends, bills or deletes was left alone (Check a number, Suppress, Record, Log, Verify,
  Delete, Save, Run).

Demo tenant: `d6f3950f…` (Ellery & Fields), as Demo Agent (owner).

**Environment caveat.** Other sessions were running five `tsc` processes, a full `npm test` and a
second `next dev` at the same time. The shared dev server answered in 1–10 s, sometimes stalled for
up to 2 minutes, and long-lived tabs fell into an HMR refresh loop ("Router action dispatched before
initialization"). A slow load is noted as a failure only when the database itself was slow.

Legend: **PASS** works as specified · **FIXED** was broken and is fixed here · **SENT** a defect in a
screen another session owns, sent to that session · **FAIL** still broken, with the reason · **GAP** the
spec asks for it and it is not built · **n/t** not exercised live, with the reason.

## Summary

| Area | Features | PASS | FIXED | SENT | FAIL | GAP / n/t |
|---|---|---|---|---|---|---|
| Compliance | 47 | 35 | 5 | 4 | 1 (ops) | 2 |
| Reports | 34 | 25 | 3 | 3 | 1 | 2 |

**Fixed in this pass:**

- The TCPA check answer was invisible.
- The suppression reason lost a trailing "s".
- Consent phone numbers showed as raw digits.
- Consent showed "0.0%" beside a non-zero count.
- The consent CSV export stopped at 1,000 rows.
- The Overview hid unchecked calls next to an incident.
- The evidence CSV showed "Â·" in Excel.
- The sales report could stop reading at 1,000 rows.
- The decline cross-tab cells read "n=0" and "n=1".

**Still failing:**

- **Ops (owner's step):** pg_cron gets 401 from every app job (details under C-12), so the
  automatic jobs never run.
- **Database:** "Preview the queue" on Queue scoring times out (R-6).

---

## Compliance

### C-0 · The frame (rail, steps, counts, gates)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-0.1 | Rail lists the seven steps; settings at the foot (owner) | Overview, TCPA / DNC, Consent, Complaints, Deletions, Evidence, Licences & appointments; Compliance settings | **PASS** |
| C-0.2 | Rail counts | `/api/app/compliance/steps` → complaints due/overdue, deletions waiting | **PASS**: `{complaints: 1, deletions: 4}` = 1 overdue FL DOI; 1 to verify + 3 ready |
| C-0.3 | Gates | Owner + producer for Overview, Complaints, Deletions and Evidence; TCPA also for assistant and setter; Consent also for assistant; agency-narrow sessions refused | **PASS** (code; contract tests in `complianceFlow.test.mjs`, `evidenceReport.test.mjs`) |

### C-1 · Overview (LA-6.7)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-1.1 | Consent proof held | "X of Y numbers ↳ N missing" | **PASS** "3,434 of 5,818 · 2,384 missing" = `compliance_dashboard_figures` + gap scan |
| C-1.2 | Campaigns scrubbed in the last 30 days | "a of b" | **PASS** 7 of 22 |
| C-1.3 | Calls outside legal hours | Non-zero is an incident; an uncomputable call says so, never a clean zero | **FIXED**: with 73 outside hours, the tile dropped "28 could not be checked". The footnote now says both (`lib/compliance/dashboardCore.ts`, test in `dashboard.test.mjs`) |
| C-1.4 | Internal DNC list size | Count, never deleted | **PASS** 70 |
| C-1.5 | Screened before transfer | % plus the number only screened at submit | **PASS** 7% = 2 of 27; "25 only at submit" |
| C-1.6 | Deletions and legal holds | Open requests · active holds | **PASS** 4 · 14 (rows: verifying 1 + scheduled 3; holds with no release 14) |
| C-1.7 | Needs you, in severity order | Overdue DOI first, then incidents, then fix-today items, then licence expiries, then deadline coverage | **PASS** 9 rows in that order. Licence days are right: GA 65, SC 62 and FL 8 days expired, OH due in 9 |
| C-1.8 | Every figure clicks through and reconciles | e.g. "4 numbers after DNC" opens those 4 | **PASS** `?focus=called_after_dnc` lists 4 numbers and 5 calls, equal to the scan. Every tile and row links to its fix |
| C-1.9 | Monthly email (cron `compliance-monthly`) | Coverage figures + gap scan; can be switched off | **FAIL (ops)**: see C-12. Code and template present |

### C-2 · TCPA / DNC (LA-2.3, LA-6 reads it)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-2.1 | Suppression list, search, list filter, paging | Every suppressed number; search by digits | **PASS** 78 (70 own). Searching "737" gives 2 of 2 |
| C-2.2 | "Can we call this number?" | Yes/No with the list and reason, per-list table | **FIXED**: the Yes/No headline was a `Callout`, which draws nothing on the page (the no-notice rule sends it to the bell), so only the per-list table showed. It is now the answer itself. The Compliance session then folded it into its TableCard rewrite. Not pressed live: it bills the tcpa_checks meter |
| C-2.3 | Reason text in the answer | Trailing dots/spaces trimmed | **FIXED**: `/[.s]+$/` stripped a trailing letter "s" ("no calls" → "no call"); now `[.\s]` |
| C-2.4 | DNC exemptions tab | List, uses, Record (owner) | **PASS** (0 recorded; `schemaReady: true`) |
| C-2.5 | Screening audit | Every check, newest first, outcome filter, paging, count | **PASS**: 21,122 rows. The page read takes 0.3 s in the database; the 10 s seen was the dev server |
| C-2.6 | Feed health | State per feed, last good answer | **PASS** 1 feed, failing |
| C-2.7 | Tab in the address | `?tab=` opens a tab | **SENT**: reading works; switching never writes it back, so a reload opens Suppression list |
| C-2.8 | Suppress a number | Owner/producer; permanent; confirm | **n/t live** (write). Route and permanence: `suppressionPermanence.test.mjs` PASS |

### C-3 · Consent (LA-2.6)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-3.1 | Tiles: full evidence, text missing, IP missing, oldest record | Counts reconcile to the list | **PASS** 2 / 16,047 / 0 of 16,049 |
| C-3.2 | Small share wording | Never "0.0%" beside a non-zero count | **FIXED** → "under 0.1%" |
| C-3.3 | List: search name/phone, status, source toggles, paging | | **PASS** (16,049 leads, 321 pages) |
| C-3.4 | Phone format | One format, as the rest of the app | **FIXED**: posted leads showed "5055550104" beside "(214) 555-0146" |
| C-3.5 | Coverage by vendor tab | Claimed-copy % per vendor | **PASS** 19 vendors |
| C-3.6 | Certificate detail + link to the evidence report | | **PASS** (code; link `?phone=`) |
| C-3.7 | CSV export follows the filters; whole locker when none | Up to the 10,000 cap, logged | **FIXED**: it stopped at exactly 1,000 rows of 16,049 (the API caps one read at 1,000). It now reads 1,000-row pages with an id tie-break, up to the cap. Contract test `lib/compliance/qaPass.test.mjs` |

### C-4 · Complaints (LA-6.4)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-4.1 | List ordered by days remaining; Not resolved / All tabs; search | | **PASS** 4 open / 6 on record; overdue FL DOI first |
| C-4.2 | Tiles: open, regulator, due within the red threshold, no deadline set | | **PASS** 4 · 1 · 1 · 0 |
| C-4.3 | Detail (`?open=`) | Complainant, policy, agent, partner, deadline, summary, evidence snapshot, checklist, response, status, outcome, owner, notes | **PASS** (all present) |
| C-4.4 | Evidence report attached on creation; download | Frozen PDF | **PASS** 307 to the signed PDF |
| C-4.5 | "N gaps, N records" line | Plural rule | **SENT** "0 gaps, 1 records" |
| C-4.6 | Date format | As other steps | **SENT** ISO "2026-10-13" vs "16 Oct 2026" elsewhere |
| C-4.7 | Unwanted-calls complaint suppresses the number in the same transaction | | **PASS**: the demo complaint's number is on the DNC list with reason "Complaint eb44…: asked not to be called" |
| C-4.8 | Overdue DOI alert | Persistent, loudest thing in the product | **PASS** as a bell alert (owner rule 2026-11-02: no on-page notices); Overview row 1 |
| C-4.9 | Daily deadline email (cron `complaint-deadlines`) | Owner + admin while inside 5 days | **FAIL (ops)**: C-12 |
| C-4.10 | Record / edit / respond | | **n/t live** (writes). `complaints.test.mjs` PASS |

### C-5 · Deletions (LA-6.5)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-5.1 | Open / Ready to delete / Done / All; search; Log a request | | **PASS** 4 · 3 · 1 · 5 |
| C-5.2 | Tiles and hold length | Hold from settings (floor 3) | **PASS** 10 days |
| C-5.3 | Detail with discovery | | **PASS** (GET 200) |
| C-5.4 | Certificate | Only once done | **PASS** 409 "issued once the deletion is done" (none completed on demo) |
| C-5.5 | Automatic purge when the hold ends (cron `deletion-perform`) | Hourly | **FAIL (ops)**: three requests are past their purge date (9 Oct, 26 Oct, 26 Oct) because the job gets 401 (C-12). The owner can still delete them by hand ("Hold over — ready to delete") |
| C-5.6 | Verify / reject / cancel / delete | | **n/t live** (writes). `dataSubject.test.mjs` PASS |

### C-6 · Evidence (LA-6.3)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-6.1 | Book-wide gap scan, 8 categories, undetermined never a pass | | **PASS** after DNC 4 numbers / 5 calls; after complaint 1/2; no consent 2,384/8,663; outside hours 70/73 (+28 undetermined); never scrubbed 4,059; verdict and disclosure 0 |
| C-6.2 | `?focus=` opens a finding's numbers | | **PASS** (C-1.8) |
| C-6.3 | One number: gaps first, timeline, consent | | **PASS** (`?phone=8325550167`: 0 gaps, 1 record) |
| C-6.4 | PDF download | Scope and time on every page | **PASS** `%PDF`, 4 KB |
| C-6.5 | CSV of the timeline | Opens cleanly | **FIXED**: no BOM, so every "·" opened in Excel as "Â·". It now starts with a BOM. Contract test |
| C-6.6 | Every generation logged | | **PASS** (audit in route; test) |

### C-7 · Licences & appointments (LA-0.5)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-7.1 | Appointments, State licences, Carrier trainings tabs; readiness tiles | | **PASS** 46 appointments, 14 licences, 15 blockers |
| C-7.2 | Licence list | Expired licences marked | **PASS** FL and GA Expired |
| C-7.3 | "Renew" from Overview → `?tab=licences&state=GA` | Opens Add licence on GA for an editor | **n/t live**: the page kept reloading under other sessions' HMR before the dialog could be checked. Code reviewed: it opens only for `canEdit`, so a producer gets the tab with no filter |

### C-8 · Compliance settings (LA-6.8)

| # | Feature | Expected | Result |
|---|---|---|---|
| C-8.1 | Read all sections | Gate, complaints, deletions, evidence, dashboard, retention | **PASS** (GET 200) |
| C-8.2 | Deadline coverage sentence | "Deadlines configured for 3 of 14 licensed states…" | **PASS** (Overview row 9) |
| C-8.3 | Retention rules, holds, runs | Platform rules read-only; never-delete locked | **PASS** (GET 200; `retention.test.mjs`, `settings.test.mjs`) |
| C-8.4 | Edits audited | | **n/t live** (writes); tests PASS |

### C-12 · Background jobs: one blocker for the owner

pg_cron calls the app's jobs through `call_app_cron` (20261015500000). `app_cron_status()` on
3 Nov 02:00 UTC shows **401 Unauthorized** on every job that reported a reply:

- `deletion-perform`
- `licence-lapse`
- `notifications`
- `webhooks`
- `unclaimed-sla`
- `callback-reminders`
- `calendar-busy`

The daily jobs (complaint-deadlines, compliance-monthly, retention-summary, period-billing) show a
dispatch with no reply on record. pg_net keeps replies for about 6 hours.

The vault secret `cron_secret` does not match the `CRON_SECRET` of the app at `app_base_url`. This
is a secret, not code. **Owner's step:** set the vault secret to the deployed app's `CRON_SECRET`,
or the other way round. Then check with `select * from app_cron_status();` that the jobs answer 200.
Until then:

- complaint deadline emails, the monthly compliance email and automatic deletions do not run;
- the notification outbox, webhooks, SLA escalation and callback-reminder emails do not run either
  (outside this pass's scope).

---

## Reports

| # | View · feature | Expected | Result |
|---|---|---|---|
| R-0.1 | Rail: eight views, gated by the shell menu; shared `?from&to` carried | | **PASS** |
| R-0.2 | Same default period across views | One "today" | **Note**: Sales counts days in the workspace time zone (to 2 Nov), True CPA in UTC (to 3 Nov). After 7 pm Central the two "Last 90 days" windows differ by a day |
| R-1.1 | **Sales performance**: tiles | Submitted, issued, declined, counteroffered with rate and n/d | **PASS** 28 · 9 (32.1%) · 6 · 5, recounted from `tenant_applications` (declined = declined 2 + declined by client 1 + offer expired 3) |
| R-1.2 | Funnel, Timing, Requirements, Declines, Counteroffers, Premium tabs; Filters; Export CSV per tab | | **PASS** |
| R-1.3 | Decline cross-tab under 5 cases | Raw count, greyed, no % | **FIXED**: cells read "n=0" and "n=1"; now "—" for none and "1 of 2" (`reportRules.ts crossCell` + test) |
| R-1.4 | Rate and median cells under 5 | Same wording | **SENT** (RateCell and MedianCell in the Reports session's file) |
| R-1.5 | Reads every row | | **FIXED**: five reads used `.limit(20_000)`, which the API cuts to 1,000. A book past 1,000 quotes or applications got silently wrong figures (demo has 41). They now read 1,000-row pages in id order. Contract test `lib/reports/qaPass.test.mjs` |
| R-1.6 | Declines by product tier (LA-3.21) | | **GAP**: not built; the data has no product-tier field (product code only) |
| R-2.1 | **Team activity**: tiles vs the prior period; Agents, Call log, Setters, To review; CSV | | **PASS** 155 served, 6 dials, contact rate 66.7% (CSV 200) |
| R-3.1 | **Queue scoring**: scored vs holdout contact rate, weights, period | | **PASS** 5.0% vs 0.0%, "Too few dials" guard |
| R-3.2 | Preview the queue | Next 25 with reasons | **FAIL (database)**: `scoring_queue_preview` hits the 8 s statement timeout on 2 of 3 calls (7.8–8.4 s). Follow-up session wrote `supabase/migrations/20261103200000_m2_scoring_preview_asks_each_rule_once.sql` (rehearsed: identical JSON in 0.6–0.9 s). **Awaits the owner's paste**; still failing live until then |
| R-4.1 | **Book scorecards**: headline in-force premium | | **PASS** $241,684.68 (301 of 872 in force) |
| R-4.2 | Persistency "building" until enough history | Never a computed figure | **PASS** "Building · needs 9 months" |
| R-4.3 | Placement | issued → paid at least once | **PASS** 279 of 529 = 53% |
| R-4.4 | Chargeback ratio | Matched advances only | **PASS** $203.40 / $7,517.17 = 2.7% → "3%"; earlier advances shown apart |
| R-4.5 | Slices, scorecards, drills, CSV | | **PASS** (unit tests `scorecards*.test.mjs`) |
| R-5.1 | **True CPA**: tiles | Net spend, leads, applications, issued, true CPA | **PASS** $12,488.15 · 15,799 · 115 (4.8% of contacted) · 1 |
| R-5.2 | Every funnel figure drills to rows that reconcile | | **PASS**: all eight stages (received 15,799 … issued 1) equal `tenant_vendor_scorecard_drill` totals |
| R-5.3 | Vendor / campaign cards, sort, filters, CSV, attempts curve, contact by slot, speed to lead | | **PASS** (CSV 200) |
| R-5.4 | Percent format | One format | **SENT** "68.75%", "20%", "0%" on one card |
| R-5.5 | Contact rate by hour (LA-2.17) | | **GAP**: by slot only; the RPC has no hourly series |
| R-6.1 | **Partner quality**: tiles vs the prior period, zero rows present, filters, export | | **PASS** 25 sent vs 167 before, recounted from `agent_leads` by day; 30 partners including zero rows |
| R-6.2 | Partner detail | | **PASS** (GET 200) |
| R-7.1 | **Retention scorecard**: per-reason save rate, counts under 10, holdout excluded, blended not the headline | | **PASS** 14 saved of 18 decided = 78% in the footer only; "4 held-out policies left out" |
| R-8.1 | **Retention results**: accuracy by band, under 20 = count; holdout comparison tab | | **PASS** 44 + 62 + 45 + 79 = 230 checked; the bands separate |
| R-9.1 | Readability: date formats | One format | **SENT** five formats across the views |

**Update, later on 3 Nov:** the Reports foundation session fixed R-1.4, R-5.4 and R-9.1 in its own
files:

- True CPA percentages now use one decimal (`Number(value).toFixed(1)`).
- Small samples read "4 of 26", medians "4 cases".
- Period labels use one format through `lib/reports/periodText.ts`: "5 Aug – 2 Nov", with the year
  only when it differs.

That session reports tsc 0 and npm test 3,779 of 3,780 (the one failure was a Compliance test
mid-edit). Here I only spot-checked the source; I did not walk the pages again.

The Compliance foundation session fixed C-2.7, C-4.5 and C-4.6 in its own files, and updated its
dashboard test:

- TCPA / DNC and Licences & appointments keep the open tab in the address (`useUrlTab`).
- The evidence attachment line says "1 record".
- Complaints and Deletions show dates as "16 Oct 2026".

It reports npm test passing 3,780 of 3,780. I did not re-check this here.

## Tests added

- `lib/compliance/qaPass.test.mjs` checks three fixes:
  - the consent export reads past the 1,000-row cap, with an id tie-break;
  - the evidence CSV starts with a BOM;
  - the TCPA Yes/No is never a Callout, and the reason trim is right.
- `lib/reports/qaPass.test.mjs` checks that the sales report reads all five tables page by page.
- `lib/compliance/dashboard.test.mjs` gets a new assertion: an incident still says how many calls
  could not be checked.
- `lib/applications/reportRules.test.mjs` gets the crossCell wording "—" and "4 of 26".

## Checks at the end (3 Nov)

- **Changed files:** eslint is clean (exit 0). `tsc` has 0 errors in them. Its one error is in
  `components/app/agency/review-board.tsx` (TS2322), another session's work in progress.
- **`npm test`:** 3,763 of 3,768 pass, including every new test. None of the five failures comes
  from this pass:
  - hand-callout ratchet (agency files went 1 → 0);
  - orphaned `agency/invite-producer-form.tsx` and `team/team-page.tsx`;
  - the accounting foundation "spec gaps closed" test;
  - two Compliance source contracts that the Compliance foundation session's in-flight rewrites
    break (`evidence-report.tsx`, the Overview tile markup). These were reported to that session.
- **Final browser walk:** every Compliance step and Reports view loaded with demo data. The fixes
  were seen live:
  - Overview: "73 · incident — should be zero · 28 could not be checked";
  - Consent: "under 0.1% of 16,049 leads", and every phone formatted;
  - Sales declines: "1 of 2" and "—".

## Not done, and why

- Every write was left unpressed on the shared demo: Check a number, Suppress, Record a complaint,
  Log a deletion, Verify, Delete, Save settings, Run retention. Each is covered by its unit and
  contract tests instead.
- The Renew → Add licence deep link (C-7.3) was not walked because of the HMR reload loop.
- R-3.2 (queue preview timeout) needs database profiling.
- C-12 (cron secret) is the owner's step.
