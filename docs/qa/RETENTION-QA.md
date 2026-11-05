# Retention (Module 5) — functional QA, 2026-11-05

Spec: Notion "🛡️ Module 5 — Retention" and tasks LA-5.1 – LA-5.11 (all Completed). Checklists extracted from Notion
are in the side-session notes (`la-5-spec-checklists.md`); this file is what was tested and how it came out.

**How it was tested.** Walked on the shared dev server (`http://localhost:3000`, 1440×900) as `demo.agent@insurvas.test`
(owner, tenant `d6f3950f…`, "LA-1.25 Alert Demo"). Every page, tab and dialog was opened; dialogs were filled and
**cancelled** (no write button was pressed on live data). Figures were cross-checked with read-only selects through the
service role (the Supabase SQL tool is not permitted in this session). Writes are proven by the unit/contract tests
(`lib/retention/*.test.mjs`, 123 tests, plus the new `qaPass.test.mjs`).

Legend: ✅ pass · 🔧 failed, fixed here · ⚠️ pass with a gap (reason given) · ⛔ not testable here (reason given)

---

## 1. Inventory

| Where | Route | Gate | What it holds |
|---|---|---|---|
| Retention › Save queue (LA-5.3) | `/app/save-queue` | `chargeback_radar`; owner / producer (own) / retention (assigned) | StatStrip (5), toolbar (search, sort, band, carrier, need chips, Refresh), table, row ⋯ menu, dialogs: Log call, Snooze or dismiss, Start the fix (→ servicing request), inline income row |
| Retention › Servicing · Requests (LA-5.4) | `/app/servicing` | `payment_repair`; owner / producer / retention | StatStrip (4), chips Open / Not in the file / Verified / All, change filter, New request, row next-step button, ⋯ Cancel, side panel (request detail), dialogs: New request → request form, step (Mark sent / Carrier is on it / Carrier says done / Cancel), Try again |
| Retention › Servicing · Paper bill → bank (LA-5.5) | `/app/servicing?view=campaign` | as above | StatStrip (4), chips To call / Asked / Converted / Said no / All + Has a phone, dialogs: Log call, Start conversion (→ request form), Talk track (view / owner edit / reset), Worth the hours? |
| Retention › Reinstatement · Cases (LA-5.6) | `/app/reinstatement` | `winback`; owner / producer / retention | StatStrip (4), chips Open / Closed 90 days, "no window" group row, countdown column, dialog: Work the case (reinstate vs sell new, step, owed, months, health, form, reference, needs, note) |
| Retention › Reinstatement · Win-back (LA-5.7) | `/app/reinstatement?view=winback` | as above, not the retention role | StatStrip (4), chips Cooling off / On the list / Stuck / Never call / All, Possible claims table + Mark handled dialog |
| Reports › Retention scorecard (LA-5.8) | `/app/retention-scorecard` | `chargeback_radar`; owner sees all, others own card | StatStrip (5), period chips, rep chips, save-rate-by-reason table |
| Reports › Retention results (LA-5.9) | `/app/retention-results` | `chargeback_radar`; owner | StatStrip (4), period chips, By band / By weight version / By confidence, holdout comparison, verdict line |
| Settings › Retention (LA-5.11) | `/app/retention-settings` | `chargeback_radar`; owner | Tabs Start here / Who works it / Campaigns & win-back / Holdout, one save bar, History, reset per section |
| Settings › Retention › Weights (LA-5.11) | `/app/retention-settings/weights` | as above | Weights table vs Insurvas, Preview, Save as version N |
| Income capture (LA-5.10) | Save queue ⋯, interview + payment steps | owner / producer / retention | `components/app/retention/income-capture.tsx`, `/api/app/retention/income` (access-logged) |
| Book of business › Lapse risk (LA-4.16) | `/app/lapse-risk` | not in Retention (observed facts, Module 5 rule 1) | out of scope; linked from Needs you |
| Admin › Servicing instructions | `/admin/servicing-guides` | super admin | per-carrier how-to shown in the request form |

**APIs:** `/api/app/retention/{save-queue,servicing,campaign,reinstatement,winback,income,settings}`, `/api/app/retention`
(LA-4.16 log), `/api/cron/retention-summary`.

**Background work:** radar refresh (page open when the newest score is a day old or a newer file arrived;
`ensureRadarFresh`, no cron), holdout draw and exit (inside the radar run), owner assignment (`ensureOwners` on load),
`la5-servicing-verify-daily` 07:30, `la5-reinstatement-daily` 07:45, `la5-winback-daily` 08:00 (pg_cron SQL jobs),
win-back release on opening the Win-back view, `retention-summary` (app cron dispatcher, 05:00 UTC).

## 2. Results

### LA-5.1 / 5.2 · signals and the score
| Expected | Result |
|---|---|
| Score 0–100 + band + "N of 7 signals" inline beside it, never a tooltip | ✅ "82 · Critical / predicted · 4 of 7 signals" |
| Prediction drawn apart from observed risk (dashed outline, "predicted") | ✅ |
| Breakdown sums to the score (audit trail on hover) | ✅ title text lists each contribution + score; sum asserted in radar.test |
| Explanation in plain words, ≤3 contributors | ✅ e.g. "Paper bill in the post. Month 6. A payment bounced and went through on the retry." |
| Seed weights 30/20/20/15/10/3/2 | ✅ Weights page |
| Bands across the book add up | ✅ Settings: 309 critical + 643 high + 146 medium + 8 low = 1,106 = "of 1,106 scored" |
| Missing never filled; low confidence kept off the queue | ✅ "Too little known 9 · kept off the queue" (owner decision 2026-10-14) |

### LA-5.3 · Save queue
| Expected | Result |
|---|---|
| Only in-force, not past due, ≥ high | ✅ buildQueue + radar.test; 13 cards of 1,106 scored |
| StatStrip figures describe the queue | 🔧 **"Critical 309" counted every scored policy (past-due and worked ones too) beside "In the queue 13".** Now the queue's critical count (2), footnote "309 across the book". `buildQueue` returns `critical`. |
| Worth = unearned advance; money shown honestly | 🔧 `money()` cut the cents off (`$0.99` → `$0`); now rounded. ⚠️ 11 of 13 cards have no advance on file (demo ledger), shown as "—" with the reason. |
| Phone visible on the row | ✅ |
| ≤2 fixes, first one startable from the row, second in ⋯ | ✅ "→ Switch them to bank payment · Start the fix · +1 in ⋯" |
| Start the fix opens a pre-filled LA-5.4 request | ✅ dialog reads the policy, method/form from the carrier guide, LA-3.9 day when known. ⚠️ American Amicable has **no servicing instructions** yet ("Insurvas adds them"), so the spec's "render for every seeded carrier" is a content gap for Insurvas staff (Admin › Servicing instructions), not code. |
| Log call: outcome list = spec's six, reason when refused, suggested action | ✅ (cancelled) |
| Snooze / dismiss both require a reason | ✅ button disabled under 3 characters |
| Cooldown 30 d, back early if risk rises | ✅ tests (radar.test, audit.test) |
| Default sort risk × money + 4 secondary sorts | ✅ |
| Days until next draft | ⚠️ column hidden: no card has a draft day (imported books carry none; owner gap noted 2026-10-14) |
| [Call] button | ⚠️ the phone is selectable text with a calling-window reminder; there is no click-to-dial (the dialer owns dialling, consent rules LA-2.3/2.4) |
| "Add income" small affordance | ✅ ⋯ Add income / Change income (not opened: every open writes a permanent access-log row) |
| Pinned reinstatement line | ✅ goes to the bell (no notices on the page) |

### LA-5.4 · Servicing requests
| Expected | Result |
|---|---|
| Four types only | ✅ filter + New request list |
| Status ladder, one next step per row, cancel in ⋯ | ✅ "Carrier is on it", "Mark sent" |
| Verified only by a carrier file | ✅ "Verified 2 · by a carrier file, last 30 days"; guard tested (servicing.test) |
| Can't-prove changes wait and say why | ✅ "American Amicable's file doesn't show the draft day, so this can't be verified from it." |
| Step dialog "They said it was done on" defaults to today | 🔧 used the UTC day (`toISOString`), a day ahead on a US evening; now the local day |
| Dialog names | 🔧 step dialog and request form showed the raw CAPS name; now `personName` like the rows |

### LA-5.5 · Paper bill → bank
| Expected | Result |
|---|---|
| Every in-force mailed-bill policy, biggest premium first; header totals | ✅ 297 policies, $18,119/mo; 2 converted ($131/mo), 292 to go, 2 said no, 1 no bank |
| Converted only when the file shows it | ✅ campaign.test |
| Log call outcomes, decline reason + 180-day cooloff, no-bank → save queue | ✅ (dialog cancelled; tests) |
| Talk track editable by the owner | ✅ dialog |
| Counts not percentages below the sample | ✅ Worth the hours? "Too few on one side to compare yet" |
| Clearing a no-match result | 🔧 "Clear" left "Has a phone" on, so the list could stay empty; now clears it |

### LA-5.6 · Reinstatement
| Expected | Result |
|---|---|
| A case per lapse inside the window; fewest days first; no-window group never guesses | ✅ 6 open, 4 in "No reinstatement window yet" |
| **One case per policy** | 🔧 **Amy Americowalk (AM09990124) showed twice**: a later carrier file moved the lapse date (Dec 24 → Dec 28) and the database opens a case per lapse date, so the older one stayed open forever. The page and the save queue's pinned count now keep only the newest open case per policy (`newestOpenPerPolicy`). The stale row stays in the table; a migration to close it is an owner decision (needs a status for "superseded"). |
| Owed: an estimate labelled, real figure entered | 🔧 **the dialog pre-filled "0" when nothing was quoted, so the first Save wrote `amount_owed_cents = 0`.** Now empty. |
| Reinstate vs sell new side by side | ✅ |
| Reinstated by the file, expired by the calendar, counted apart from declines | ✅ "Last 90 days 6 back · 3 window closed · 0 declined" |
| Countdown 14/7/3, alerts | ✅ tests; ⚠️ no demo case inside 14 days to see it live |
| Data note | ⚠️ the demo's newest lapses are dated Dec 2026 (synthetic files from another session's walk); the sync takes the file's date as given |

### LA-5.7 · Win-back
| Expected | Result |
|---|---|
| Band, reason, how we know, callable-from | ✅ "A payment failed; they never said no · Inferred from payments · Fair · Callable from Dec 30, 2026" |
| Inferred never strong | ✅ (Fair) + winback.test |
| Never-call can't be released; deceased → possible claim | ✅ tests; no live example |
| Release to the Win-back list, scrub before dialling | ✅ "On the Win-back list 3"; scrub reminder goes to the bell |
| Retention role does not see Win-back | ✅ page gate (`canWinback`) |

### LA-5.8 · Scorecard
| Expected | Result |
|---|---|
| Save rate per reason, blended never alone | ✅ six reasons + "All reasons" row |
| Under 10 decided → counts | ✅ "2 of 4 saved" |
| Unreachable apart from lost | ✅ |
| Totals add up | ✅ 36 cases = 1+11+8+1+3+12; saved 13, lost 4 → 76% |
| Holdout excluded | ✅ "4 held-out policies left out" |
| Rep sees own card only | ✅ la5_8_9_11.test (not walked as a rep: no rep login minted) |

### LA-5.9 · Results
| Expected | Result |
|---|---|
| Accuracy by band on unworked policies, 90 days | ✅ 230 checked: critical 39%, high 35%, medium 18%, low 0% |
| Under 20 → count | ✅ rule tested; every band here ≥ 44 |
| Holdout on/off, share, emergency leaves | ✅ "On · 10% · 1 held back now · Left on past due 23" |
| Says when a difference isn't meaningful | ✅ verdict line + tests |

### LA-5.10 · Income
| Expected | Result |
|---|---|
| Optional, three entry points, access logged, role gates | ✅ income.test + audit.test; ⛔ not opened live (each view writes a permanent log row) |
| Coverage line with count, share and impact | ⚠️ "Income known 0 of 1,106 · worth up to 10 points" — count and impact, the share is only in the tooltip |

### LA-5.11 · Settings
| Expected | Result |
|---|---|
| Bands, queue threshold, live consequence line | ✅ "Today your queue would hold 13 cards…" |
| Weights versioned with preview | ✅ (not saved) |
| Who works it: owners per queue, strategy, hand-over days | ✅ "1 rep: Ruth Alvarez" |
| Win-back cool-offs: affordability 365 d default, 180-day floor, typed confirm | ✅ |
| Holdout explanation before the switch, 20% ceiling, exposure threshold | ✅ |

### Background jobs
| Job | Result |
|---|---|
| Radar refresh on open | ✅ "Scored Nov 5, 2026" |
| Servicing verification | ✅ 2 verified by a file |
| Reinstatement sync | ✅ cases reinstated/expired today |
| Win-back sync + release | ✅ 3 released |
| `retention-summary` (app cron) | ⚠️ dispatched 05:00 UTC today, no HTTP status recorded; see the known `cron_secret` mismatch (compliance-reports QA) |

## 3. Fixed in this pass

| File | Change |
|---|---|
| `lib/retention/queue.ts`, `queueStore.ts`, `components/app/save-queue-board.tsx` | Critical tile = the queue's critical cards; footnote = across the book; money rounded |
| `lib/retention/reinstatement.ts`, `reinstatementStore.ts` | `newestOpenPerPolicy`: one open case per policy on the page and in the pinned count |
| `components/app/reinstatement-board.tsx` | owed field empty when nothing was quoted (was "0" → saved $0); title via personName |
| `components/app/servicing-board.tsx` | confirmed-on defaults to the local day; dialog name via personName |
| `components/app/servicing-request-dialog.tsx`, `winback-board.tsx` | names via personName |
| `components/app/paper-bill-campaign.tsx` | no-match Clear also clears "Has a phone" |
| `lib/retention/qaPass.test.mjs` | 7 tests pinning the above |

## 4. Open, for the owner

1. **Superseded reinstatement cases** stay open in the table (hidden on screen now). A migration could close them, but it needs a new status ("superseded") or reuse of `expired`. Which?
2. **Servicing instructions** are empty for the demo's carriers; Insurvas staff fill them in Admin.
3. **Draft day** is unknown for imported books, so "Next draft" and Sign 1 stay empty (gap from 2026-10-14).
4. **A [Call] button** (spec card) is not built; dialling stays in the dialer. Build a "Call" that opens the dialer on this client?
