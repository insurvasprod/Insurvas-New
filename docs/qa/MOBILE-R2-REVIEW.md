# Mobile Release 2 · Android review against the board

25 November 2026. Each Release 2 screen on the Android emulator (Pixel, API 35, dark mode) was set beside its Android mockup on `docs/design/mobile-v1`. The demo agency's live data was behind every screen. The question for each pair was whether it reads like a premium Android app: Material 3 rhythm, one strong action, calm text and no dead ends.

**Verdicts:**
- **Match:** the structure and look are the board's.
- **Match, data gap:** the screen draws everything the server sends, and the board shows something the server doesn't have yet.
- **Fixed:** I changed the screen during this review.

## Fixed in this review (across many screens)

| Problem seen on the emulator | Why it hurt | Change |
|---|---|---|
| Disabled buttons were the brand green at half strength (Submit, Next question, Save attempt, Pick one, Start application). | They read as a muddy, half-broken green rather than "not yet". | Filled buttons that can't be pressed are now a neutral container with a muted label, as in Material 3 and iOS. A busy button keeps its colour so the spinner reads as "working". (`components/ui.tsx` Button) |
| Names from carrier files were in capitals: "JOSHUA ANDERSON", "DWIGHT MCALLISTER". | They look like shouting beside every other name. | An all-capitals name is shown in title case, keeping Mc/O' ("Dwight McAllister"). Mixed-case names and policy numbers are left as stored. (`lib/format.ts` displayName) |
| Refusing the camera did nothing visible: one toast for a few seconds. | The person is stuck with no way forward. | A dialog explains it, with "Open Settings". (`components/cases/capture.ts`) |
| The case requirement was one run-on line: "…missing on the application. · asked Fri 9 Oct · day 55 of 14". | It's hard to scan, and "day 55 of 14" reads as a bug. | The description stays at body size. When it was asked and how late it is sit on a quieter line below, red once it's past the carrier's date: "33 days past the carrier's 14". |
| The case timeline listed every event (6 or more). | It pushes "Still to come" off the screen. The board shows the latest four. | It shows the latest four, then "Show all N". |
| A retention case past its deadline showed a calm green ring reading "Over". | Green says "fine". | The ring turns the warning red once the date has passed. |
| Application money questions ("Annual earned income") were a plain "Answer" box, and dates had to be typed YYYY-MM-DD. | Neither looks like an insurance app's form. | Money questions show "$" and "Amount" and accept commas. Dates are MM/DD/YYYY with the slashes added as you type, like the lead form. |
| Every application row ended in "attempt 1". | It crowds the product name off the row. | The attempt is mentioned only from the second attempt on. |
| The pipeline list said "1 leads". | Grammar. | It now says "1 lead". |

## Screen by screen

| Screen | Board vs emulator | Verdict | Still open |
|---|---|---|---|
| **E0 Applications** | Same chips, rows, icon tiles and Resume pills. | Match, data gap | The rows can't say "step 5 of 10" or "e-sign sent, not opened" (the list route doesn't send the step), and there is no "Needs signature" group. |
| **E1 Quick quote** | The board shows eight carriers priced from rate tables, cheapest first. On the phone, quotes are typed in from each carrier's tool, inside an application. | Match, data gap | Needs rate tables on the server. Age and Tobacco fields aren't drawn. |
| **E1b Start an application** | Same list and Picked chip. | Match, data gap | Carrier and plan per product need a quote first. The "Finish on a computer" group appears only when the agency sells products the phone doesn't take. |
| **E2 Application · a question** | Same step bar, question size and bottom bar. | Fixed (money and date fields) | — |
| **E2b All steps** | Same sheet: Done, Now and locked rows. | Match | The step names are the web's real ten, not the board's. |
| **E2c Bank details, protected** | Same fields and fingerprint line; Checking/Savings added because a bank draft needs it. | Match | Hiding numbers in screenshots and the app switcher needs `expo-screen-capture` (not installed). |
| **E3 Pick the draft date** | Built; this demo application's earlier steps aren't finished, so I couldn't open it on the device. | Unit tests only | The optimiser works in days of the month, so rows read "The 18th of each month" rather than a calendar date. |
| **E4 Sign and submit** | Same pad, dashed frame and bottom action. | Fixed (disabled button) | The server can't store the signature image. The summary shows only Insured until a quote is chosen. There's no API to send the e-sign link. |
| **E5 Pending cases** | Near-identical: tabs with counts, Needs you, Moving at the carrier. | Match | Chips use the real statuses (Submitted, Pending carrier), not the board's finer Received / Underwriting / Approved. |
| **E6 Case detail** | Same card, Scan and Call buttons, timeline and Still to come. | Fixed (meta line, timeline) | No phone number for a doctor's office. "Still to come" lacks interview and payment dates (not recorded). |
| **E6b Send a scanned document** | Camera pages, order, Send to, note. | Match, gap | The server has no route to receive the pages; the screen says so and keeps them. A real document scanner (VisionKit / ML Kit) needs a custom build. |
| **E7 Daily deal flow** | Same figure tiles and day picker. The demo has no deals in the last 7 days, so only the empty state could be seen. | Match | No "unsigned" data, so there's no Unsigned chip. |
| **F1 Book** | Same search, chips and rows. Health words come from the web ("7 payments behind"). | Match | The filter button is left out. |
| **F2 Policy** | Same title, figure tiles, Policy and Commission cards, Open the case. | Match, data gap | No beneficiary in the data. Call shows only when the policy has a lead. |
| **F2b Commission ledger** | Paid-to-date and at-risk tiles, posted lines. | Match, data gap | No expected as-earned or renewal lines, and no agent/agency split. |
| **F3 Retention cases** | Near-identical: ladder tiles, grouped cases, day chips. | Match | — |
| **F3b Waiting on the carrier** | Same rows and chips. | Fixed (names) | — |
| **F3c Win-back** | Same rows and Ready / Try in chips. | Fixed (names) | Closed to the retention role, as on the web. |
| **F3d Open a retention case** | Built, behind "Views" on Cases; it writes, so it wasn't opened. | Unit tests only | The server opens a case for three reasons only. |
| **F4 Retention case** | Same path, deadline card, carrier quote and steps. | Fixed (ring) | Call can't dial: the dialer works on leads and excludes the retention role. |
| **F5 Log an attempt** | Same outcome tiles, note and switch. | Match, data gap | There's no "Try again" date (a case has no next-attempt field). |
| **F6 Needs you** | Same card, options, Skip and Pick buttons, plus "On the computer". | Match | It pre-picks a client only when the matcher marks one as likely; none in the demo does. |
| **B7 Retention home** | Built; there's no retention-role demo account to open it with. | Unit tests only | No team average (a rep reads only their own cases). |

## Functional checks

- **Mobile:** 222 Jest tests, type check and lint all pass.
- **Web:** 4,601 tests pass and the type check is clean. The production build (`npm run build`) succeeds: 641 pages generated. Turbopack couldn't save its cache because the disk was full; the build itself was unaffected.
- **Maestro on the emulator:** sign-in, the Release 1 walk, the new screens, and `05-release-2-dev.yaml` (every Release 2 list screen, read-only) all pass.
- **`npx expo-doctor`:** 20 of 20 checks pass.
- **On the device:** every list and detail screen loaded live data. The camera prompt and refusal, the step-list sheet and the log-attempt sheet all opened.
- **Not exercised against the live server** (they would write to the demo agency): saving an answer, adding a quote, submitting, sending pages, opening a retention case, logging an attempt, and resolving a Needs you card. These are covered only by unit tests against a fake server.

## Before a store build

| Item | State |
|---|---|
| Production API address | **Fixed now.** The preview and production profiles set `https://app.insurvas.com`, and a release build falls back to it rather than to a development address. |
| Camera permission text (iOS requires it) | **Fixed now** in `app.json` (`expo-image-picker` plugin). |
| Server code the app needs (app sign-in tokens, the Release 2 reads) | **Uncommitted.** It must be deployed to `app.insurvas.com` before any build ships. |
| Push | Migration `20261124100000` isn't applied. FCM and APNs credentials are still needed. |
| App icon and splash | Rendered from the isotype; they show only in a native build (not Expo Go). |
| Bundle ID `com.insurvas.app` | Waiting on the owner's confirmation. |
| A real document scanner, screenshot privacy | Each needs a native module and a custom build. |
