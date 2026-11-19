# Server and API speed: 2026-11-12

This is §3 of the "every page opens instantly" plan: the slow shared APIs, the server pages over 2 s, and the script
every page downloads. It follows the 2026-11-10 speed pass (`2026-11-10-speed-pass.md`).

**How it was measured**
- Production build, `next start` with `PERF_TRACE=1`, owner (demo.agent) and producer (devin.okafor) of the demo
  tenant.
- Before and after on the same machine and database, the same day, one after the other.
- APIs: `scripts/perf/api-timings.mjs`, 5 runs each, median.
- Pages: `scripts/perf/page-timings.mjs`, 3 runs, the 24 pages this touches. The results are in
  `2026-11-12-before.json` and `2026-11-12-after.json`.
- New harness pieces:
  - `scripts/perf/trace-api.mjs` prints each request's database calls in start order, so calls that wait on each
    other show as a staircase.
  - `scripts/perf/frame-timings.mjs` gives the time until a page's own title line arrives.
  - `scripts/perf/page-scripts.mjs` lists the scripts a page's HTML asks for, with their sizes.

**What a database call costs here:** every PostgREST call is about 170–200 ms, however small. So a request's time is
mostly how many calls wait on one another, plus a few slow database functions.

## What changed

| | Change | File |
|---|---|---|
| 1 | **Needs you, Policies, Exceptions and Retention settings now stream.** The title line, the rail, the views and the buttons draw at once. The list follows in its own `<Suspense>` with a skeleton of its shape. The view counts fill in when the list lands. | `app/app/(shell)/{needs-you,policies,exceptions,retention-settings}/page.tsx` |
| 2 | **`inChunks` reads three chunks at a time**, not one after another (the same width as `allRows`). It has 41 callers. The dashboard's pending card waited for three reads in a row. | `lib/applications/lists.ts` |
| 3 | **`/api/app/me` takes one round trip to the pooler instead of five.** It used to send BEGIN, the scope, two reads and COMMIT one after another. Now they go as one message, still under the `tenant_app` role with RLS. The ids are checked as UUIDs before they are inlined. | `lib/tenantDb/withTenantScope.ts` (`readTenantScoped`), `app/api/app/me/route.ts` |
| 4 | **Campaigns: the True CPA switch and the scorecard report are read together.** The report (about 1 s) used to wait a round trip for the switch. A switched-off feature still shows nothing. | `lib/campaigns/extras.ts` |
| 5 | **The Supabase browser client loads lazily.** It is about 230 kB: all of supabase-js plus a Node `Buffer` polyfill. It was in the shell on every page, only for the live-transfer card's Realtime subscription. It now loads after that card's first read. The card's 30 s read covers the moment before it subscribes. | `components/app/inbound/live-transfer-card.tsx` |
| 6 | **The notification-preferences panel and its sound settings load lazily.** The panel is fetched when the browser is idle, so opening it never waits. | `components/app/app-top-bar.tsx` |

## APIs (median of 5, ms)

| API | owner before | owner after | | producer before | producer after |
|---|--:|--:|--:|--:|--:|
| `me` | 856 | **324** | **−62%** | 839 | **307** |
| `pending/summary` | 1,082 | **695** | **−36%** | 906 | **743** |
| `campaigns` | 1,417 | **1,162** | **−18%** | — | — |
| `data-in/steps` | 698 | 623 | −11% (noise) | — | — |
| `leads` | 1,884 | 1,747 | −7% (noise) | 1,208 | 1,153 |
| `vendors/cards` | 1,605 | 1,450 | −10% (noise) | — | — |
| `partner-chat` | 1,424 | 1,365 | — | 2,009 | 1,411 |
| `agency/scorecards` | 1,507 | 1,444 | — | 2,536 | 1,425 |
| `contacts/missing-data` | 803 | 863 | — | — | — |
| `compliance/steps` | 539 | 564 | — | — | — |
| `appointments/close-out` | 356 | 364 | — | 380 | 348 |

Only `me`, `pending/summary` and `campaigns` were changed. The other rows are run-to-run noise; the producer's
`partner-chat` and `scorecards` "before" figures had slow outliers.

## Pages

**When the page itself appears.** This is the time until the page's title line arrives in the stream
(`frame-timings.mjs`, owner, median of 3). Before, these pages sent their title only with the whole page.

| page | frame before (= whole page) | frame after | whole page after |
|---|--:|--:|--:|
| needs-you | 5,294 | **312** | 4,774 |
| exceptions | 2,393 | **245** | 2,206 |
| retention-settings | 2,343 | **254** | 2,387 |
| policies | 2,175 | **225** | 2,189 |
| agency (streamed already) | — | 246 | 4,705 |

**Browser harness ("ready" = all content drawn, ms).** These are the changed pages and the pages that wait on the
changed APIs.

| member | page | ready before | ready after | |
|---|---|--:|--:|--:|
| owner | exceptions | 3,065 | 2,363 | **−23%** |
| owner | needs-you | 5,338 | 4,146 | **−22%** |
| producer | calendar (`me`) | 2,125 | 1,766 | **−17%** |
| owner | policies | 3,085 | 2,610 | **−15%** |
| producer | policies | 1,997 | 1,673 | **−16%** |
| owner | dashboard (`pending/summary`) | 4,695 | 4,025 | **−14%** |
| owner | lead-sources (`campaigns`) | 6,812 | 6,039 | −11% |
| owner | retention-settings | 2,537 | 2,333 | −8% |
| owner | lead-lists | 5,527 | 5,082 | −8% |

- Over all 48 loads, the median went from 2,135 to 2,092 ms and the total from 108.3 s to 104.6 s.
- Pages this pass did not touch moved by ±10–25% from run to run: owner agency +26%, owner profile +42%. Read
  single-page changes under about 15% as noise.
- The full table is from `node scripts/perf/compare.mjs docs/perf/2026-11-12-before.json docs/perf/2026-11-12-after.json`.

## Script weight

`page-scripts.mjs` lists the scripts each page's HTML asks for before it can hydrate:

| | before | after |
|---|--:|--:|
| Shared by every shell page | 1,363 kB (≈420 kB gzip) | **1,129 kB** (≈357 kB gzip) |
| `/app/leads` total | 1,463 kB | 1,232 kB |
| `/app/dashboard` total | 1,423 kB | 1,190 kB |

The browser harness's `jsKb` counts every script downloaded, lazy ones included, so its median barely moves
(1,328 → 1,332 kB). The Realtime client and the preferences panel still download, but after the page is up, not
before it can hydrate.

**What is left in the shared 1.13 MB.** The goal was under 1 MB.
- **React DOM and the Next runtime**, about 380 kB. These are fixed.
- **framer-motion**, 140 kB, pulled in by `sileo` (the toasts).
  - `lib/notify` imports it statically, and two test files (`soundRules`, `suggest`) pin `from "sileo"` and
    `sileo.show(`.
  - Loading toasts lazily would need `notify` to queue calls until the toaster has loaded, and the tests changed to
    match. I left it for that reason.
- **The notification-centre panel.** It shares a module with `useBellCentre`, which the top bar runs on every page.
  Splitting the panel into its own file would let it load on first open.
- **The keyboard-shortcuts dialog.** It renders closed on every page. Mounting it only once it has been opened would
  let it load lazily.

## Second round (same day): the rest of the list

| | Change | File |
|---|---|---|
| 7 | **The Carrier sync rail's "windows not set" count reads the coverage in a lean mode.** It now reads only the carriers and their rules. The layout assignments and then their maps were two reads in a row; those, the commissions desk, the portal settings and Insurvas's guidance are skipped. The carrier pages still read everything. | `lib/pipelineRules/carrierCoverage.ts` (`lean`), `lib/pipelineRules/setupCounts.ts` |
| 8 | **`leads` reads `stage_entered_at` with the leads.** It no longer reads every lead a second time, by id, in 7 chunks. Checked against the database on 150 leads: identical. | `lib/agentTemplates/service.ts`, `lib/agentTemplates/leadWorkFacts.ts`, `app/api/app/leads/route.ts` |
| 9 | **The bell's panel and the keyboard-shortcuts dialog load lazily.** The panel has its own file now; the bell's state hook stays in the shell. The dialog mounts the first time it is opened. Both are fetched on idle, as the preferences panel is. | `components/app/agent-notification-panel.tsx` (new), `agent-notification-centre.tsx`, `app-top-bar.tsx` |

| API (owner, median of 5) | original | round 1 | round 2 |
|---|--:|--:|--:|
| `data-in/steps` | 698 | 623 | **522** (−25% overall) |
| `leads` | 1,884 | 1,747 | **1,550** (−18% overall) |
| `partner-chat` | 1,424 | 1,365 | 1,355 (unchanged, see below) |
| `agency/scorecards` | 1,507 | 1,444 | 1,457 (unchanged, see below) |

- **Shared shell script:** 1,363 kB at the start, 1,129 kB after round 1, **1,114 kB** now.
- **Page harness, original vs round 2** (`2026-11-12-after-2.json`):
  - The median went from 2,135 to **2,012 ms**, and the total from 108.3 s to **102.3 s**.
  - Owner: book-setup −24%, policies −24%, exceptions −23%, dashboard −17%, needs-you −16%, carrier-files −10%.
  - Producer: policies −20%.
  - Producer leads (+21%) and calendar (+12%) read worse in this run, but their APIs measured flat on their own
    (leads 1,208 → 1,201 ms). That is within the run-to-run noise noted above.

## Third round (same day): the Leads board in pages (owner: "Yes, page the board")

**What was wrong.**
- `/api/app/leads` read every lead in one request.
- PostgREST stops a request at 1,000 rows without saying so, and the demo book holds 15,649 leads on this template.
  The board showed 1,000 of them, mixed across four pipelines.
- The board drew the newest 1,000 of the whole book and then filtered to the pipeline on screen, so a pipeline could
  look nearly empty.
- Its tab counts counted only those 1,000.

**What it does now.**

| | |
|---|---|
| One pipeline, in pages | `?pipeline=<id>&page=<n>`: 500 leads at a time, newest first, ordered by `created_at, id` (the existing `agent_leads_tenant_created_id_idx`), so a page boundary never repeats or skips an import batch. Page 0 opens on the pipeline the board would choose. It also carries the template, the pipelines and `totals`, each pipeline's exact count (one head count per pipeline, read beside the page). A later page carries only its leads. |
| The board | Shows the newest 500 of the pipeline on screen. "Show 500 more" adds the next page, with a quiet line under the board: "500 of 14,091 leads shown, newest first". A pipeline tab reads that pipeline's first page. A refresh after a move re-reads the first page and keeps the older pages already shown. |
| Search | Runs in the database over the template's fields (`values->>field ilike`), so it finds a lead on any page. The tab counts follow the search. |
| Narrowed agency sessions | Unchanged. They read their producers' leads whole by id, every pipeline, and count what they were sent. |
| `listAgentLeads` (whole-book read) | Reads every page, three at a time, instead of stopping at 1,000. |

Files: `lib/agentTemplates/service.ts` (`filterAgentLeadsPage`, `countAgentLeadsByPipeline`, `LEADS_PAGE_SIZE`),
`app/api/app/leads/route.ts`, `components/app/lead-workspace.tsx`.

**Checked live** (prod build, owner, browser pane):
- The tabs read Publisher Transfers 1,506, Marketing Leads 14,091, Affiliate Referrals 1, Sales Pipeline 51.
- The board shows 500 cards; "Show 500 more" brings it to 1,000.
- Switching to Publisher Transfers gives 500 of 1,506.
- A search for "Rosalind" finds 3 leads across the whole book, and the tabs show 3 / 0 / 0 / 0.
- No console errors.
- Through the API, page 1 has no overlap with page 0 and keeps the order. A search for "QA-M" returns 491 leads, all
  matching. The producer still gets their 114 leads whole.

| | before | after |
|---|--:|--:|
| `/api/app/leads` owner (median of 5) | 1,550 ms, 817 kB, 38 calls | **1,359 ms, 387 kB, 30 calls** |
| `/api/app/leads` producer | 1,201 ms | 1,141 ms |
| Leads page ready, owner | 2,671 ms (1,000 leads, wrong counts) | **2,344 ms** (exact counts) |
| Leads page ready, producer | 2,135 ms | 2,236 ms (unchanged path; noise) |

**What the owner should know.**
- The column badges and the Unassigned / annualised figures count the leads loaded, not the whole pipeline. The line
  under the board says how many are shown.
- The filters under Filters (product, stage, submitter, outcome, dates) and the Table's scopes narrow the loaded
  leads. Search is the one control that reaches every lead.
- Moving the rest server-side, so the badges and figures are exact across 14k leads, is the next step if it is
  wanted. It needs per-stage counts, and PostgREST aggregates are off on this project (`PGRST123`), so it wants either
  an RPC (DDL, for the owner to paste) or one head count per stage.

## Not done, and why: what is left needs a product, schema or owner decision

- **`leads`.** Paged in round three (above). What is left is the exact per-stage figures across the whole pipeline,
  which needs counts the database can group: an RPC, or aggregates switched on.
- **`partner-chat` (1.3–1.5 s, 360–490 kB).**
  - Its reads are already overlapped and attachment signing is already one request per page.
  - What remains is three dependent waves: channels, then each message's lookups, then signed URLs. There is also the
    size: every channel's recent messages come back at once.
  - Sending the list without message bodies, and loading a thread when it is opened, would fix both. That is a change
    to the chat screen.
- **`agency/scorecards` (1.4 s).**
  - The critical path is `policy_current`, paged: the first page, then the rest three at a time.
  - Requesting pages 2–4 before page 1 answers would save a wave on large books. But on small books it sends ranges
    past the end, and an OFFSET there still scans, which is the fan-out this pass must not add.
  - The other reads already start beside it.
- **`data-in/steps` (~520 ms).**
  - The floor is now the auth round trip plus `rpc/trace_problems` (about 340 ms, below).
- **`vendors/cards` and `campaigns` on Lead sources, Campaigns and Lead lists.**
  - Each is 1.1–1.5 s alone but 2.2–3.6 s on the page, where six APIs start at once and fight for the database.
  - The floor is the scorecard functions below.
  - They cannot share one scorecard report: Campaigns asks for the last 90 days, Vendors for all time.
- **framer-motion (140 kB) in the shell, via `sileo` toasts.**
  - Making it lazy needs `notify` to queue toasts until the toaster has loaded.
  - Two test files pin `from "sileo"` and `sileo.show(`, so it needs the owner's nod.
- **`contacts/missing-data`, `compliance/steps`, `appointments/close-out`.** These are two or three calls deep and
  under 0.9 s. There is nothing left to overlap.
- **The slow database functions (below).** They could not be EXPLAINed from here:
  - The Supabase MCP refuses this account.
  - The `tenant_app` pooler role sees no tenant rows.

## For the owner: the slow database functions

No index or DDL was added (read-only rules). These functions are now the floor of the slowest APIs. Each is worth an
`EXPLAIN (ANALYZE, BUFFERS)` as the service role, not `tenant_app`, because RLS hides index use there:

| function | time per call | used by |
|---|--:|---|
| `tenant_vendor_scorecard_report` | ~1.0 s | campaigns, vendors/cards, True CPA |
| `tenant_campaign_funnel` | ~0.78 s | campaigns |
| `vendor_undialable_rates` | ~0.70 s | vendors/cards |
| `vendor_returns_candidates_summary` | ~0.65 s | vendors/cards |
| `trace_problems` | ~0.34 s | data-in/steps (every Book of business / Carrier sync page) |

If any of these scans a whole table per tenant, a partial or composite index on `(tenant_id, …)` is the likely fix.
Paste the plan here before writing the migration.
