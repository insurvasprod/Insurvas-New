# Agent portal page speed — 2026-10-20

Every page under `app/app/(shell)` (78 static pages × owner + producer = 156 page loads), measured on a
production build before and after. Nothing committed.

## Headline

| | before | after |
|---|--:|--:|
| Median time until the main content is drawn | 1,336 ms | **945 ms** |
| Median server time to first byte (the shell every page pays) | 427 ms | **254 ms** |
| Sum of time-to-content over all 156 loads | 312 s | **198 s** |
| Worst page (`/app/exceptions`, owner) | 79 s, never drew | **3.1 s** |

## How it was measured

- `next build` + `next start -p 3100` (never `next dev`). Next 16's dev server writes to `.next/dev`, so the
  build did not disturb the dev server on :3000.
- `scripts/perf/page-timings.mjs`: signs sessions in-process (same claims as `scripts/mint-session.mjs`) for
  `demo.agent@insurvas.test` (owner) and `devin.okafor@qa-demo.insurvas.test` (producer) in **LA-1.25 Alert Demo**.
  Per page, 3 runs, medians:
  - **ttfb / html** — plain fetch with the cookie, `redirect: manual`: first byte, and end of the streamed HTML.
  - **ready** — headless Chrome: time until the main content is drawn (no skeleton, nothing `aria-busy`, no page
    API in flight for 300 ms; background polls excluded), plus LCP and the slowest `/api` call it waited on.
    "never" = not settled within 45 s.
  - Read-only: GETs only; the browser aborts every non-GET a page makes on load.
- `scripts/perf/compare.mjs before.json after.json` builds the table below. Raw data:
  [baseline-2026-10-20.json](baseline-2026-10-20.json), [after-2026-10-20.json](after-2026-10-20.json).
- `scripts/perf/api-timings.mjs` times single API routes; `PERF_TRACE=1` on `next start` logs every database
  request with its duration (filter values masked) — how the remaining hot spots below were found.

**Noise.** The database is a small shared instance and single readings swing 2–5× (a cold RPC at 4.8 s reads 0.6 s
a minute later). Rows that came out worse were re-run on their own: duplicates 1.8 s, servicing 1.1 s, setters
1.1 s, nurture 1.9–2.2 s, owner dashboard 1.5–2.2 s, producer dialer 1.35 s — all at or below baseline. Vendor
returns is ~5 s in both runs (SQL-bound, see below). The baseline's second half (producer rows) ran while
helper sessions were probing the database, so some producer "before" numbers are slightly inflated.

## Most-used screens

| member | page | ttfb before → after | ready before → after |
|---|---|--:|--:|
| owner | dashboard | 522 → 198 | 2,093 → 1,457–2,190 (re-run; html 2,888 → 1,311) |
| producer | dashboard | 432 → 315 | 2,011 → 1,603 |
| owner | leads | 438 → 242 | 3,157 → 2,477 |
| producer | leads | 462 → 272 | 2,931 → 2,365 |
| owner | dialer | 435 → 270 | 2,347 → 1,775 |
| producer | dialer | 391 → 234 | 2,273 → 1,353 (re-run alone; 3,996 in the full run) |
| owner | inbound | 443 → 247 | 2,444 → 1,363 |
| producer | inbound | 420 → 254 | 1,904 → 1,348 |
| owner | applications | 396 → 263 | 972 → 809 |
| owner | policies | 363 → 209 | 1,110 → 945 |
| owner | save queue (retention) | 440 → 221 | 2,725 → 1,252 |
| owner | agency | 410 → 207 | 3,249 → 1,940 |

## Slowest 40 before, with after (ms)

| member | page | ready before | ready after | Δ | html before | html after | Δ | slowest API before → after |
|---|---|--:|--:|--:|--:|--:|--:|---|
| owner | exceptions | never (skeleton) | 2,338 | **-95%** | 79,219 | 3,102 | **-96%** | auth/workspaces 559 → auth/workspaces 555 |
| owner | evidence-report | 5,385 | 4,065 | **-25%** | 7,156 | 6,974 | -3% | (server-rendered; compliance_gap_summary) |
| owner | publishers | 5,233 | 1,950 | **-63%** | 401 | 201 | **-50%** | partners/{id}/products ×33 2,990 → partners 1,451 |
| owner | assignments | 5,109 | 3,329 | **-35%** | 787 | 369 | **-53%** | assignments 3,809 → 2,611 |
| producer | activity | 5,025 | 1,270 | **-75%** | 468 | 213 | **-55%** | activity 3,625 → 794 |
| owner | lead-lists | 4,385 | 3,455 | **-21%** | 697 | 284 | **-59%** | lead-lists 3,721 → 2,980 (≈1.2 s more once the migration is in) |
| owner | vendor-returns | 4,048 | 5,281 | +30% | 543 | 322 | **-41%** | vendor-returns 3,256 → 4,775 (SQL; noise) |
| owner | scorecard | 3,882 | 1,388 | **-64%** | 5 | 2 | | activity 2,564 → 884 |
| owner | agency | 3,249 | 1,940 | **-40%** | 415 | 380 | -8% | agency/dashboard 2,496 → 1,198 |
| owner | leads | 3,157 | 2,477 | **-22%** | 440 | 244 | **-44%** | leads/pipeline-context 2,472 → leads 1,991 |
| owner | settings | 3,123 | 1,982 | **-37%** | 1,102 | 581 | **-47%** | agency-profile 1,163 → 807 |
| producer | partner-chat | 3,002 | 2,832 | -6% | 371 | 251 | **-32%** | partner-chat 2,268 → 2,308 |
| owner | producers | 3,000 | 1,694 | **-44%** | 422 | 395 | -6% | agency/dashboard 2,342 → 979 |
| producer | calendar | 2,997 | 2,331 | **-22%** | 411 | 363 | **-12%** | appointments 1,146 → 1,127 |
| owner | campaigns | 2,943 | 1,737 | **-41%** | 435 | 255 | **-41%** | campaigns 2,209 → 1,155 |
| producer | leads | 2,931 | 2,365 | **-19%** | 463 | 274 | **-41%** | leads 2,259 → 1,912 |
| owner | vendors (→ campaigns) | 2,913 | 1,792 | **-38%** | 4 | 1 | | campaigns 2,025 → 1,213 |
| producer | producers | 2,902 | 1,749 | **-40%** | 433 | 351 | **-19%** | agency/scorecards 1,304 → producer detail 727 |
| owner | tcpa | 2,893 | 1,474 | **-49%** | 509 | 271 | **-47%** | suppression 2,026 → 920 |
| owner | dashboard | 2,093 | 2,630 | (noise, re-run 1,457–2,190) | 2,888 | 1,311 | **-55%** | pending/summary 1,253 → 1,823 / 668 |
| producer | save-queue | 2,816 | 1,196 | **-58%** | 2,682 | 1,142 | **-57%** | (server-rendered) |
| producer | callbacks | 2,789 | 1,499 | **-46%** | 486 | 228 | **-53%** | callbacks 1,691 → 833 |
| owner | nurture | 2,788 | 3,586 | (noise, re-run 1,873–2,232) | 582 | 269 | **-54%** | nurture 2,205 → 1,396–1,736 |
| owner | retention-settings | 2,769 | 1,407 | **-49%** | 2,070 | 994 | **-52%** | (server-rendered) |
| owner | partner-chat | 2,755 | 2,309 | **-16%** | 460 | 220 | **-52%** | partner-chat 2,032 → 1,783 |
| owner | save-queue | 2,725 | 1,252 | **-54%** | 2,448 | 1,188 | **-51%** | (server-rendered) |
| producer | scorecard | 2,600 | 1,428 | **-45%** | 4 | 1 | | activity 1,782 → 791 |
| owner | calendar | 2,597 | 2,063 | **-21%** | 392 | 219 | **-44%** | appointments 1,092 → 1,019 |
| owner | floor | 2,571 | 1,786 | **-31%** | 461 | 247 | **-46%** | agent-floor 1,387 → 1,312 |
| producer | my-pay | 2,493 | 1,775 | **-29%** | 444 | 214 | **-52%** | agency/my-pay 1,670 → 1,224 |
| owner | activity | 2,476 | 2,076 | **-16%** | 469 | 306 | **-35%** | activity 1,635 → 1,475 |
| owner | inbound | 2,444 | 1,363 | **-44%** | 445 | 249 | **-44%** | inbound/today 857 → 630 |
| owner | consent | 2,422 | 1,751 | **-28%** | 425 | 277 | **-35%** | consent 1,227 → 1,122 |
| producer | floor | 2,397 | 2,119 | **-12%** | 548 | 270 | **-51%** | agent-floor 1,223 → 854 |
| owner | callbacks | 2,356 | 1,485 | **-37%** | 377 | 217 | **-42%** | callbacks 1,577 → 963 |
| owner | dialer | 2,347 | 1,775 | **-24%** | 437 | 272 | **-38%** | dialer/queue 1,617 → 1,292 |
| producer | dialer | 2,273 | 3,996 → 1,353 alone | | 393 | 607 → 234 | | dialer/queue 1,401 → 3,524 (contention) |
| producer | producer-scorecards | 2,195 | 1,473 | **-33%** | 426 | 262 | **-39%** | agency/scorecards 1,528 → 756 |
| owner | scoring | 2,098 | 1,086 | **-48%** | 432 | 261 | **-40%** | scoring 1,188 → 633 |
| owner | reinstatement | 2,009 | 1,064 | **-47%** | 2,035 | 1,134 | **-44%** | (server-rendered) |

The full 156-row table: `node scripts/perf/compare.mjs docs/perf/baseline-2026-10-20.json docs/perf/after-2026-10-20.json`.

## What changed

**The shell (every page).** The producer scope (`agency_visible_user_ids`) was read after the shell's batch and,
cold, was a 3-trip chain (current plan → plan type → scope). It now starts inside the batch, and the plan
audience is one RPC (`tenant_plan_audience`, the function RLS already uses; old two-step kept as fallback).
TTFB 427 → 254 ms median.

**Every scoped API (~70 GET routes).** React `cache()` does not memoise inside route handlers, so each route paid
auth, *then* the scope, *then* its work. `requireFeatureRole(…, { prefetchScope: true })` now reads the scope in the
auth round trip; `scopeFor(auth.context)` returns it from a WeakMap keyed by that request's own context object
(never shared across requests or sessions). The isolation gate is unchanged at 0.

**N+1 and serial reads, by screen.**
- Exceptions: two queries per open item, one item after another (~900 trips) → batched by distinct key; the 343
  last-name lookups → 14 multi-name reads; and the contact-label read (~900 ids in one URL) was **failing outright**
  after 9 s, so every contact name on that page was blank — now chunked.
- Publishers: one request per partner on load (33) → the open partner's products load when it is opened.
- Activity & scorecard: dispositions, refused dials and the page offset now start beside the report RPC.
- Leads: pipeline-context's stage-drift pages ran one after another (7 trips) → concurrent; lead facts in one wave.
- Agency dashboard, scorecards, reconciliation, overrides, review, ledger, producer routes: serial stages merged
  (the ledger sync still runs before what depends on it).
- Dashboard pending card: counted with the labels it never shows skipped (5 lookups).
- Retention (save queue, settings, reinstatement, win-back, paper bill, scorecard, results), ledger, rate card,
  policy book: loaders roughly halved; outputs checked byte-identical on 38 loader calls.
- Campaigns, nurture, callbacks, consent, inbound today, agent floor, partner quality, security events, settings
  audit, deal-flow funnel, P&L, tax, discrepancies, servicing: serial awaits merged / chunk loops made concurrent.

Checks after all changes: `tsc` 0, eslint clean on changed files, `npm run agency:gate` 477 routes / 0 unscoped,
`npm test` 3,153 / 3,153, `next build` passes.

## Migration to apply (paste in the SQL editor)

| file | what | proof |
|---|---|---|
| `supabase/migrations/20261020100000_perf_lead_list_inventory.sql` | `lead_list_inventory(tenant)`: the Lead lists screen's per-list counts in one call instead of reading every list lead (16 pages). execute → service_role only. | Rehearsed whole-file, rolled back (`rehearse-chain.mjs`: 5/5, 0 fail). Parity on the demo tenant: 21 lists, 15,784 leads, **0 mismatches**; 0.45 s vs 5.9 s. `check-migrations` parses it; its self-check fails only because it is not applied yet. |

The app works without it (falls back to the old read and remembers "not applied" for 5 minutes).

## Still slow — needs SQL (no DDL authority here)

| where | cost | what |
|---|---|---|
| Vendor returns, and the Lead lists "claimable" column | 1.1–8 s | `vendor_returns_candidates_summary` / `vendor_returns_report` → `vendor_return_candidates` |
| Evidence report (owner) | 1.2–8 s + ~1 s | `compliance_gap_summary`, then six `compliance_gap_numbers` |
| Assignments / Lead routing | 0.6–4.6 s | `assignment_insights` — a per-member loop calling `assignment_candidate_is_eligible` per licensed state |
| Partner chat | ~0.9 s | 33 channels × newest-200 messages; wants one "latest N per channel" function |
| Activity | 1.5 s / 0.9 s | `tenant_activity_report`, `tenant_recycle_performance`; refused dials filter `audit_log` on a jsonb key with no index |
| Consent locker | 0.3–2.2 s | `tenant_vendor_consent_coverage` view |

### SQL round (2026-10-20, later) — four migrations to paste, rehearsed + parity-proven, NOT applied

Paste in order (each file is self-contained, `begin … commit`, with a self-check that raises if anything is off):

| file | what | parity (demo tenant) | in-DB time, old → new (median of 7, production-like copies) |
|---|---|---|---|
| `20261020200000_perf_vendor_returns.sql` | `tenant_calendar_zone` stops scanning all 1,196 zone files per call (known-name constant from `pg_timezone_names`, scan as fallback); `vendor_claimable_leads` reads wrong-number attempts once instead of a LATERAL per lead; `vendor_return_candidates` `plan_cache_mode = force_custom_plan`; new `vendor_claimable_lead_counts` for the Lead lists column | all 4 functions vs live RPC identical; old vs new identical for whole tenant, every campaign, every vendor; zone predicate identical on 22 edge values | summary 698 → 303 ms · candidates 540 → 296 · report 477 → 294 · claimable_leads 427 → 285 · per-vendor summaries (19) 7.8 → 3.1 s |
| `20261020210000_perf_assignment_insights.sql` | eligible states as one set-based query (was 3 members × 14 states of `assignment_candidate_is_eligible`); unlicensed count hash-joins the tenant's lead states (52k → 16.5k buffers) | identical vs live for since = 1/7/30/365 days; self-check replays the old loop | warm 197–231 → 178–180 ms (incl. ~140 ms round trip); the count statement alone 1.8 s → 0.19 s cold |
| `20261020220000_perf_compliance_gap_book.sql` | new `compliance_gap_book` (summary + every line's numbers from ONE `compliance_gaps` run); `compliance_gaps` `plan_cache_mode = force_custom_plan` | book = summary + numbers exactly, whole book (limit 300) and a range (limit 5) | summary + 6 numbers calls 3.5 s → book 0.88 s; range 2.7 s → 0.43 s |
| `20261020230000_perf_partner_chat_latest_messages.sql` | new `partner_chat_latest_messages` (newest 200 per channel + read_at, one jsonb; ties keep ctid order as the PostgREST read did) | 33/33 channels, 745 messages identical to the 66 PostgREST reads, incl. read_at | 66 parallel reads 449 ms → one call 173 ms |

**The generic-plan finding.** A plpgsql `RETURN QUERY` is custom-planned 5 times per connection, then may switch to
a generic plan. PostgREST keeps its connections, so production runs mostly on the generic plans. For
`compliance_gaps` nine calls on one connection took 1268, 441, 395, 411, 423, **1016, 886, 2580, 8534 ms** — that is
the Evidence report's "1.2–8 s". With `force_custom_plan` on the function: ~0.4 s every call. `vendor_return_candidates`
350 → 490 ms after call 5; `assignment_insights` is *faster* generic, so it is left alone. Other plpgsql RPCs on hot
paths likely have the same cliff (not checked).

**The timezone finding.** `pg_timezone_names` reads every zone file: ~48 ms warm, 380–500 ms on a fresh backend,
per call. Ten more functions still use it (incl. `outbound_can_dial_now`, `schedule_callback`, `deal_local_date`) —
they could use `timezone_names_known()` the same way once 200000 is live.

App changes (uncommitted, each falls back while its function is missing, remembers "missing" 5 min):
`lib/leadLists/service.ts` (`vendor_claimable_lead_counts`), `lib/compliance/evidenceReport.ts` (`compliance_gap_book`
for an owner's scan), `lib/partnerChat/service.ts` (`partner_chat_latest_messages`). `lib/leadLists/poolAndClaims.test.mjs`
accepts the perf file as the latest definition of `vendor_claimable_leads`.

API timings, production build on :3100, owner demo.agent, 5 runs — **before** (functions not live, fallback paths):
vendor-returns 2,114 ms · lead-lists 1,595 · assignments 718 · partner-chat 1,415. Re-run after the paste:
`node --env-file=.env.local scripts/perf/api-timings.mjs --runs 5 /api/app/vendor-returns /api/app/lead-lists /api/app/assignments /api/app/partner-chat`.
The Evidence report was timed in the database only: its route and page write a `compliance_report_log` row per load.

## Found on the way, not fixed (correctness)

- **Announcements never match plan-targeted audiences:** the shell's `subscriptions?select=plans(plan_type)` embed
  returns HTTP 300 (ambiguous relationship) on every page render.
- **PostgREST's 1,000-row cap silently truncates** several reads written as `.limit(5000)` / `.limit(50000)`:
  agency scorecards' lead spend allocation and submissions (`lib/agency/scorecardStore.ts`), the pipeline
  stage-drift count (`lib/pipelines/views.ts`), recorded sales awaiting a policy (`lib/ingestion/policyBookStore.ts`).
- `pnlStore` drill / `taxStore`: reads of commission_entry, commission_account_entry, expense by id have no
  tenant filter (ids come from tenant-filtered reads; unchanged).
- The `in()`-list URL limit (~10 KB) that broke Exceptions can hit any `.in("id", ids)` without chunking.
