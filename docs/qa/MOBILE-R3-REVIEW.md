# Mobile app review: Release 3 and the whole Android app against the board (2026-11-25)

This pass compares the Android app in the emulator with the Android board (`docs/design/mobile-v1`).

## Method

- **Mockups:** all 135 Android mockups were rendered headless.
- **App screens:** each was captured from the emulator (Pixel, dark mode) on live demo data, signed in with minted development tokens and no passwords:
  - an Ellery & Fields producer
  - the owner (demo.agent@)
  - the publisher partner admin
- **Comparison:** each board screen was placed beside its app screen.
- **Write safety:** nothing was saved on the production demo tenant. One sheet was opened and typed in, then closed without saving.

Flags: 🟢 passes · 🟡 passes with known gaps · 🔴 blocks release.

## Verdict

| Area | Flag | Why |
|---|---|---|
| Functionality | 🟡 | All reads were verified live and every Maestro flow passes. Write actions (approve payouts, send a lead, complaint reassign/reply, payments) are only unit-tested against a mocked API, because the demo tenant is production. Push and native builds are not set up yet. |
| UI against the board | 🟢 | After this pass's fixes, every captured screen matches its board in layout, type and colour. The remaining differences are data-driven or listed under Gaps. |
| UX | 🟢 | Tabs follow the role, shortcuts never land on a hidden tab, and sheets clear the keyboard and the gesture bar. Every empty state says what to do next. |
| Design system | 🟢 | One kit (`components/ui`, `leads/sheets`) throughout, board tokens, and no hand-rolled colours in the R3 screens. |
| Ready to deploy (Android) | 🟡 | The code is ready. Shipping is blocked only on owner steps: the EAS project, FCM/APNs keys, the push migration paste, app icons, and confirming the bundle ID. |

## Checks run

- **mobile:**
  - `tsc` clean, `eslint` clean
  - `jest` 44 suites, 342 tests, all passing
- **web:**
  - `tsc` clean
  - route registry tests (moneyRoutes, planeIsolation, ag02, appSession) 37/37
  - the partner agent's full `lib/**/*.test.mjs` run: 4612 passing
- **Maestro:**
  - 01 sign-in screen
  - 04 R1 screens
  - 05 R2 screens
  - 06 R3 owner screens (new)
  - 03 producer tab walk (now run with `-ProducerEmail`)
- **Device walks:**
  - producer: 24 screens
  - owner: 23 screens, plus details I2, I6b, G4
  - partner: K1–K6
  - Settings › "Use the producer tabs" in both directions
  - the Add-a-lead shortcut with the Leads tab hidden and shown
  - the Check-a-number shortcut with a heard number

## Fixed in this pass

| Screen | What was wrong | Fix |
|---|---|---|
| G3 Money | The list ran to all 10 waiting rows, pushing the month card off screen. | Four rows, then "Show all N" (board G3). |
| G3b / every sheet | The Android Modal stopped above the navigation bar, leaving an undimmed strip and a double gap. | `statusBarTranslucent` + `navigationBarTranslucent`; the sheet pads itself for the keyboard on Android too (verified typing in Add a lead). |
| C7 Dialer | The server's long refusal reason was drawn as a giant bold title. | Title "Nothing to dial right now", with the reason as the body. |
| C11 / dialer / D3 names | ALL-CAPS carrier names ("WENDELL VICKERY"). | `displayName` applied in `leadName` and in every calls row. |
| D1 Leads (producer) | No pipeline picker or stage chips: the producer's book names no pipeline. | "All pipelines" picker, with pipeline and stage counts from the producer's own rows. |
| G7 My balance | Chip cut off ("Chargebacks bey…"). | "More came back". |
| J3 Settings | "Use the producer tabs" was under This phone with different words. | Moved to Work with "For owners who also sell" (board J3). |
| I6 Complaints | Chip cut off ("Overdue by 23 da…"). | "23 days late". |
| I5b Consent | Chip cut off ("Link only, not clai…"). | "Not claimed". |
| I7 Licences | Expired licences kept the green icon. | Warning icon when expired. |
| G3e P&L | "$349" next to "$150.00" in one list. | Whole dollars throughout, as on the board. |
| K2 Send a lead | Date of birth typed as YYYY-MM-DD. | MM/DD/YYYY with auto slashes; the ISO day is sent. |
| L3 shortcuts | "Add a lead" / "Serve next lead" for an owner on Team · Money landed silently on Home (a hidden tab). "Check a number" pointed at a route that doesn't exist. | Shortcuts follow the tabs actually shown; `/compliance/check-number` prefills the heard number. |
| Tooling | A partner couldn't be walked without a password. | `mint-session.mjs partner --app --link` plus `app/partner/dev-sign-in` (development builds only), and `--tenant` for a tenant's producer. |

## Round 2 (same day): the gaps closed, and the manager walked

| Screen | Now |
|---|---|
| G3 Money | The header's one action is the board's calendar: a 12-month picker that reads Profit & loss for that month. Snap a receipt moved to Menu › Add an expense (board G5: "Expenses › Add"). The Money tab carries its gold count badge: the screen's own "Waiting on you" count once it has loaded, otherwise Accounting › To do items marked yours (re-read every minute). |
| I1 Team | "Issued premium ▾" is a dropdown chip (Rank by). "All N" and "On the phone N" come from the inbound floor (`/api/app/agent-floor`, every 15 s); the shared FilterChips gained per-item `on` and `chevron` for this. |
| I7 Licences | The owner's + and Add open "Add a licence": state, resident or non-resident, number, and expiry in MM/DD/YYYY. It posts to the web's own `POST /api/app/appointment-vault/licenses` (owner only). It is unit-tested and was not submitted on the production demo. "Appointed with" was already there, below the fold. |
| J3b Profile | "Add a photo" / "Change photo": camera (front) or photos, square crop, sent to `POST /api/app/profile/avatar`. The photo replaces the initials once it loads. `app.json` now carries the iOS photos permission text. |
| K2 Send a lead | Live transfer / Lead only is the board's pill switch. |
| Tab order | Native tabs drew in declaration order, so a manager saw Home · Calls · Team. They now follow the role's order: Home · Team · Calls (board B8: "Same tabs as the owner, but Money is replaced by Calls"). |
| B8 Floor | A call the server never closed showed "On a call · 128:50:43". Past 4 hours it now reads "since 20 Nov". |

**Manager walk** (demo.agency50.manager@, Agency 1–50):
- **B8 Floor:** matches the board (counts, Right now, Team activity).
- **Team:** no money and no invite; ranked by policies issued; the On the phone chip counts the producer on a call.
- **Calls and Menu:** match the board.
- **Tabs:** Home · Team · Calls · Inbox · Menu.

## Gaps left (🟡, no data or a decision needed)

- **Talk time** (I2, I3, I4b): no route records call duration.
- **Producer goal ring** (I2): drawn as soon as the goals table exists. Its migration is not applied in production, and it can't be applied from here.
- **Licence photo** (I7): no route stores one. The details are saved; the photo is not.
- **I4c Retention scorecard:** the demo shows "Reached 1108 · 100%" because the server counts every worked case as reached. The owner should confirm the definition.
- **J3c:** this phone isn't listed under Signed-in devices when signed in with minted dev tokens (no session row); a real sign-in is listed.
- **K2:** consent proof is stored only when the agency template has a consent field (a server decision).
- **K4:** no Payout details or Notifications rows (no partner routes).
- **Partner sign-out** also ends the browser session (partners have no session rows).
- **Not walked on the device:**
  - retention and bookkeeper homes (no such demo accounts)
  - iOS, tablet, light theme

## Owner steps before the store

1. Create the EAS project (its projectId is needed for push).
2. Add the FCM and APNs credentials.
3. Paste migration `20261124100000`.
4. Replace the template app icons.
5. Confirm the bundle ID `com.insurvas.app`.
6. Decide I4c's "reached" rule, and whether partner consent proof needs a server field.
