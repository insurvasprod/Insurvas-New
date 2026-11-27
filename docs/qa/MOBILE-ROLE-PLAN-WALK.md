# Mobile app · every role and plan walked (26 November 2026)

**Asked:** "check every single button, every single component… is it redirecting, is it functioning, are we able to
see the data we need from this account, for every role and every plan."

**How:** two Android emulators, Expo Go, the local web server, demo accounts signed in with minted dev sessions (no
passwords). A script opened every Menu row of each account from the Menu, waited 10 s and recorded the screen. It
taps only rows it finds by name and goes back with the Back key. The partner app was opened screen by screen by link.
Read-only: nothing was saved, sent or called (one exception, below).

## Result by account

| Account | Plan | Tabs | Menu rows | Result |
|---|---|---|---|---|
| Owner · Ellery & Fields (demo.agent) | Agency | Home · Team · Money · Inbox · Menu | 39 | 🟢 every row opens its own screen with data |
| Owner · Agency 1-50 (demo.agency50) | Agency 1-50 | Home · Team · Money · Inbox · Menu | 39 | 🟢 |
| Admin · Agency 1-50 (demo.admin) | Agency 1-50 | Home · Team · Money · Inbox · Menu | 39 before fix 3; Quote no longer listed after it | 🟢 |
| Producer · Agency 1-50 (demo.agency50.producer) | Agency 1-50 | Home · Calls · Leads · Inbox · Menu | 18 | 🟢 |
| Manager × 2 (demo.manager, demo.agency50.manager) | Agency 1-50 | Home · Team · Calls · Inbox · Menu | 20 | 🟢 after fix 3 (was 🔴: Consent locker, Complaints refused) |
| Assistant (demo.agency50.assistant) | Agency 1-50 | Home · Calls · Leads · Inbox · Menu | 3 | 🟢 after fix 3 (was 🔴: Consent locker refused) |
| Setter (demo.agency50.setter) | Agency 1-50 | Home · Dialer · Inbox · Menu | 3 | 🟢 |
| Bookkeeper (demo.agency50.bookkeeper) | Agency 1-50 | Home · Money · Book · Inbox · Menu | 13 | 🟢 |
| Retention rep (demo.agency50.retention) | Agency 1-50 | Home · Cases · Book · Inbox · Menu | 5 | 🟢 (no flagged policies in this agency, so empty lists) |
| Owner · Basic (demo.basic) | Basic | Home · Team · Money · Inbox · Menu | 31 | 🟢 retention, P&L and hierarchy hidden by the plan · 🟡 see open item 1 |
| Owner · Ledger (demo.ledger) | Ledger | Home · Team · Money · Inbox · Menu | 9 | 🟢 book and money only, no calls or leads |
| Partner admin (Apex Demo Publisher) | Partner app | Home · Send · Pipeline · Messages · Account | 6 screens | 🟢 own figures, 15-lead pipeline, statements, team of 7 |

Not walkable: Advanced and IMO & FMO (no demo tenant on those plans).

Pages built for a computer (Lead flow, List import, Vendors & campaigns, Quote, Commission ledger, Carrier files,
Statements, Publishers, Hierarchy & overrides, Appointments & setters) open the "works best on a computer" sheet, as
designed (board J2). Partner chat opens the Inbox, where the partner threads live.

## Fixed in this pass

1. **Owner links bounced to Home.** Calendar, Callbacks, Dialer, Incoming and Leads pointed at the Calls and Leads
   tabs, which an owner's bar does not have. Both now also open as pushed screens (`/calls-page`, `/leads-page`), and
   every link (Menu, Home, Search, Inbox, push, shortcuts, widgets) checks the person's tabs first
   (`mobile/src/lib/links.ts` `reachable`, `mobile/src/lib/nav.ts`). Calendar opens the month view.
2. **Owners had no Dialer.** Menu › Today carries Dialer, Callbacks and Incoming transfers, and Leads carries the
   board, when they are not tabs.
3. **Pages the server refuses were offered.** Inside an agency a producer, manager, assistant or setter is refused
   Consent locker, Complaints, Check a number, Lead flow, List import and the other agency screens (AG-0.5,
   `lib/agency/routeScope.ts`). `GET /api/app/me` now returns `menuKeys`, the web sidebar's own list for that person
   (plan, role, extra roles, agency scope, hidden pages, solo mode), and the phone Menu shows only those rows.
4. **Plan.** `/api/app/me` returns the plan's features; tabs and Calls parts follow them (Ledger: no Calls, no
   Leads). A page outside the plan says "Not on your plan", not "We couldn't load".
5. **Header.** On Android the large title sits on the line with search and the profile button.
6. **Back labels** that named the wrong screen ("Back to Calls" on Calendar, "Back to Home" on Cases, "Back to
   Reports" on report pages opened from the Menu).
7. **Development only:** a test sign-in link could not switch a phone that was already signed in (the dev sign-in
   screen sat behind the signed-out door).
8. **Emulator colours** (not the app): the emulator window drew `#08110F` as `#001400` through the PC's graphics
   card. Run it with `-gpu swiftshader_indirect`; the app's own pixels were always the board's.

## Open

1. **Basic and Ledger owners get the agency tabs** (Team · Money) although these are single-agent plans. A solo
   agent probably wants Calls · Leads by default. Owner decision.
2. **Managers see My pay** (the web gives it to them too). Board B8 says a manager's phone shows no money. Owner
   decision: keep the web's rule or hide it on the phone.
3. **The owner's Cases screen is slow:** `/api/app/retention/cases` sent 617 KB and took 6.7 s on the demo book.
4. **Two callbacks were completed by mistake** in Ellery & Fields (17:07 and 17:08 UTC, as demo.agent) by an early
   version of the walk script that tapped by position. The owner chose to leave them.

## Not covered

- Home tiles, chips and Settings rows were not tapped one by one; the walk covered every Menu row and every tab root.
- Write actions (save, send, call, complete) were deliberately not exercised on the demo tenants.
- iPhone and tablet layouts.
