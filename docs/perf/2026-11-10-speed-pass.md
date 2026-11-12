# Speed pass — 2026-11-09/10

The aim: pages fast enough that the motion work (PR #61) is never spoiled by loading. The owner's choices were to show
the last-seen data at once and refresh behind it, and to cover every page.

## What changed

**Repeat visits are instant** (no network wait for anything already seen in this tab):

- **`lib/client/resource-cache.ts` + `use-resource.ts`.** A per-tab cache that shows the last answer and refreshes
  behind it (stale-while-revalidate). It de-duplicates in-flight requests and keeps a newer answer over an older one.
  - The main lists persist in `sessionStorage` so a reload is instant too. Those copies are filed under user and
    workspace (`ResourceScope`).
  - The cache is cleared on sign-out, on a workspace switch and on a new sign-in.
  - Hydration is safe: `seed()` gives nothing until the document has hydrated.
- **28 client workspaces read through it.** Among them: Leads, Callbacks, Calendar, the dialer queue, Partner chat,
  Publishers, Campaigns, Import, Duplicates, Assignments, Nurture, Scoring, Deal flow, TCPA, Consent, Partner quality,
  True CPA, Activity, the agency boards and the carrier bucket. A change always asks again (`fresh`).
  - Forms and live screens are left on their own fetches on purpose: Settings editors, Needs you decisions, the
    inbound floor.
- **Hover to prefetch data.** `IntentLink` warms the page's reads (`lib/client/route-resources.ts`) as well as the
  route.
- **Server-rendered pages:**
  - `experimental.staleTimes` (dynamic 30 s) keeps a visited page in the router.
  - `components/app/background-refresh.tsx` refreshes it in place when it was served from that cache.
- **Rail badge counts** (`step-rail`, `leads-in-rail`) reuse an answer up to 20 s old instead of asking on every step.

**First visits are faster** (production build, both demo roles, 164 page loads):

| | before (2026-11-09) | after (2026-11-10) |
|---|--:|--:|
| Median time to content | 1,678 ms | **1,450 ms** |
| Median server time to first byte | 249 ms | 229 ms |
| Loads over 1 s / over 2 s | 159 / 66 | 113 / 48 |

The biggest server-render wins (HTML, ms):

| page | before | after |
|---|--:|--:|
| policies | 4,147 | 2,221 |
| needs-you | 5,682 | 4,067 |
| policy-matching | 1,777 | 926 |
| ledger | 2,097 | 1,318 |
| book-setup | 2,350 | 1,680 |
| accounting-settings | 1,172 | 630 |
| producer agency | 2,503 | 1,902 |

How these were done:
- independent reads overlap instead of running in series;
- large reads fetch three pages at a time (`allRows` in `lib/ingestion/pages.ts` and the store-local pagers);
- the session's scope and entitlement are reused from the auth step, not read again;
- per-request `cache()` where one page read the same book twice (scorecards, ledger at risk, agency time zone).

**Measurement note:** the harness now treats the shell's own widgets (live-transfer card, workspace list) as background
reads, as it already did for notifications. So time-to-content is not strictly like for like; the HTML and API columns
are.

**The owner Dashboard (Overview), fixed 2026-11-10:**

| | before | after |
|---|--:|--:|
| Whole page (prod build, owner) | 22–57 s | 3.2–3.9 s |
| Overview frame on screen | same as the whole page | 0.6–0.7 s |
| Requests per load | about 340 | about 305 |

- It ran every module's full view loader at once only to show their needs and one figure each. The loaders now take
  `forOverview` (`components/app/home/views/view-props.ts`) and skip what only their own view draws:
  - Leads: the newest-leads list and the donut's names.
  - Book: files, recent changes, chargebacks.
  - Accounting: trend, deposits, balances, recent money.
  - Retention: chargebacks avoided.
  - Compliance: the screening chart, the last check, recent evidence.
- The compliance feeds read health for every compliance vendor on the platform, enabled or not: 76 requests per
  load. `enabledFeedHealth` (`lib/compliance/service.ts`) reads the enabled scrub feeds only and shares the answer for
  30 s (it is platform data). The dial gate still reads afresh.
- Each Overview row is its own `<Suspense>` with a skeleton of its height, so calls, money and Today land first and the
  needs strip and the module figures follow.
- Still left: about 305 requests per load. They are mostly id-chunked name lookups (`contacts`, `policy_current`,
  `agent_leads`) that grow with the book, plus the 28 per-day head counts of the 14-day call series.

## Not done: the honest list
- **Still 2–3 s APIs:**
  - `campaigns` (Lead sources, Campaigns, Lead lists)
  - `leads` (2.1 s)
  - `agency/scorecards` and `agency/dashboard` (1.5–1.7 s)
  - `partner-chat` (1.5 s)
  - `nurture` (1.5 s)
  - `dialer/queue` (1.2 s)
- **Every cold load also pays about 1 s of script download and hydration** (1.3–2.8 MB of JS per page). That is why
  pages whose server time is about 250 ms still read as about 2 s cold. Repeat visits avoid it.
- One agent change was reverted: the dialer's campaign read. It added a third read, and a test protects "exactly two
  tenant-filtered reads".

## Files

- **Baseline:** `docs/perf/2026-11-09-baseline.json`
- **After:** `docs/perf/2026-11-10-after.json`
- **Harness:** `scripts/perf/page-timings.mjs`
- **Guards:** `lib/client/resourceCache.test.mjs`
