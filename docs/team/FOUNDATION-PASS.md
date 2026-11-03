# Team: split by module, merge what stays, foundation pass (2026-11-03)

The owner asked, via /ui-taste (distill + polish), for the sidebar's **Team** group to be split into
the modules its pages belong to, with what is left merged into one Team page like Accounting,
Compliance and Reports. Every old address still works. Nothing is committed.

Rules followed: [UI-CONSISTENCY](../design/UI-CONSISTENCY.md) §2, §3, §6, §6b, §8a and §11. The
spec is the Notion Agency Module (AG-0 / AG-1) tasks; the checklist pulled from them is in the
session notes as `team-agency-spec-checklists.md`.

## Where each page went

| Old Team item (menu key) | Address (unchanged) | New home | Why |
|---|---|---|---|
| Producers (`team.producers`) | `/app/producers`, `/app/producers/<id>` | **Home › Agency › Producers** (round 2; was Team step 1) | It is the team itself: who writes under your contracts. |
| Hierarchy & Overrides (`team.hierarchy`) | `/app/hierarchy` | **Commissions › Hierarchy & overrides** (round 2; was Team step 2) | It is the team's shape (who reports to whom) and the levels that set each override. |
| Lead routing (`team.routing`) | `/app/lead-routing` | **Leads › Lead flow › Route** | It already rendered as Leads in's Route step (`LeadsInPage step="route"`). Only the menu still filed it under Team, and as a stand-in it showed only without the dialer's routing. Its menu section is now Leads. |
| Payout runs (`team.payouts`) | `/app/producer-payouts` | **Accounting › Producer payouts** | Owner's guidance. Paying people from a ledger is Module 7 work, beside Partner payouts. |
| Commission splits (`team.splits`) | `/app/commission-splits` | **Accounting › Commission splits** | Owner's guidance. It divides money. |
| Producer scorecards (`team.scorecards`) | `/app/producer-scorecards` | **Reports › Producer scorecards** | Owner's guidance. It is a report with a period, like Book scorecards. |
| Application review (`team.review`) | `/app/application-review` | **Sales › Applications › Application review** (a tab) | See below. |

**Application review → Sales, not Compliance.** AG-1.11 samples *submitted applications* and reads
them against LA-3's own submission checks. It never runs a second set of checks. The reviewer then
coaches the producer. It is the sale's own quality loop, so it sits with Cases, Waiting on the
carrier and Quotes, behind the same plan and role (owner and producer). Compliance (Module 6) is
about consumer-protection evidence: consent, DNC and complaints. Putting a coaching queue there
would mix two audiences.

**Kept where it was:** Agency dashboard (`home.agency`) stays the owner's home, and Custom team
access stays in Settings › Team (AG-1.13 says so). Producer pay (AG-1.12) and My pay were already in
Commissions.

Every key, gate and role is unchanged, so saved hidden pages and team-access presets still name the
same pages.

## No Team group (second round, same day)

The owner then said the team should be rearranged somewhere else too. The Team group is gone; its two
remaining pages went to the sections that already ask their question:

| Page | New home | Why |
|---|---|---|
| Producers (`team.producers`, `/app/producers` and below) | **Home › Agency**, the rail's second step after the agency dashboard | The dashboard asks "which of my producers makes me money" for the same people (owner, admin, bookkeeper, a manager over his reports). Not Settings › Team & access: that is owner-only and about logins and seats, while the record is daily work. |
| Hierarchy & overrides (`team.hierarchy`, `/app/hierarchy`) | **Commissions**, the step after Producer pay | It is the rule override money comes from, and its "levels to fix" count is work, not a setting. |

- **Agency steps:** `lib/agency/steps.ts` (overview → `/app/agency`, producers → `/app/producers`
  and below). A producer gets one step, "My record".
- **Frame:** `components/app/agency/agency-page.tsx` on the shared `StepFrame` (same props the Team
  frame had). The dashboard's period switch and Invite producer sit on the title line through
  `StepSlot` (`AGENCY_SLOT`); outside the frame (the `/design/agency` sample) it keeps its own header.
- **Gates:** each step keeps its route's rule. Agency dashboard: `agency_dashboard`, owner/bookkeeper
  or a manager. Producers: `team_hierarchy`. The two features are seeded together on agency plans;
  if a plan has only one, the rail shows only that step. Hierarchy on the Commissions rail: `team_hierarchy`
  and owner/bookkeeper or a manager, so a manager now sees Commissions as My pay plus Hierarchy.
- **Counts:** `/api/app/agency/steps` counts producers who cannot submit yet. The hierarchy count
  (no level or a negative spread) moved to `/api/app/commissions/steps`, under `team_hierarchy`
  and the scoped override store; it is left out when that gate refuses.
- **Sidebar:** `team.producers` is a Home item that stands in for the Agency link
  (`sidebar_fallback_for: "home.agency"`), so an owner sees one Agency link, and a plan without the
  dashboard still gets Producers. Its menu roles are owner, bookkeeper and manager: a producer reaches
  their record from **Settings › My profile › My producer record** (`producerRecordId` on
  `GET /api/app/profile`). `team.hierarchy` is a Commissions `groupLink` standing in for the ledger.
  `NAV_GROUPS` has no Team entry; the icon-rail area that held Team and Reports is now Reports.
- **Lighting and trail:** `agencyStepOf` lights the Agency link on Producers, a record, the invite and
  carrier pages; the trail reads "Home › step › record". Hierarchy reads "Commissions › Hierarchy & overrides".
- **Ratchet:** `lib/agency/agencyFlow.test.mjs` (replaces `lib/team/teamFlow.test.mjs`; `lib/team` and
  `components/app/team` are deleted).

## Shared pieces added

- **`components/app/step-frame/step-slot.tsx`:** a title-line slot that a client step fills, for
  buttons that depend on that step's own state (Producer payouts' Commit run). The ids live in
  `components/app/agency/slots.ts`, because a server page cannot read a constant from a
  "use client" file.
- **`StepRail` icons:** `wallet-cards`, `hand-coins`, `user-round-check`, `network` and `banknote`.
  Partner payouts was falling back to the Files icon.
- **`lib/agency/producerHeader.ts`:** reads a producer record's header on the server, with the
  record API's own visibility (`guardProducer`).
- **`lib/agency/rosterFilter.ts`:** the roster's `?status=` filter. It is a plain module for the same
  server/client reason.
- **`lib/agency/reviewStore.ts`:** a review row now carries its `caseId`, so a review can open its
  application.

## Page by page

### Home › Agency › Producers (`/app/producers`)

**What was wrong**
- Its own `PageHeader` sat inside the page instead of a frame.
- "Finish setting up your agency" was a tinted banner over the roster, which breaks the no-notices
  rule (§3).
- Invite producer opened a pop-up form. Pop-ups are for confirming only (§11).
- The strip figures were not links.
- At 1440 the table scrolled sideways: 1,177px of columns in a 1,030px card.
- The spec says every column sorts; none did.

**What changed**
- It renders in the Team frame.
- The banner became a title-line button, **Finish agency setup**. It asks once, then refreshes.
- **Invite producer** is a page, `/app/producers/invite`. A full band shows the band needed and its
  price in place of the form. The old `?invite=1` redirects there, and the agency dashboard links to
  it.
- Strip figures open their rows: `?status=active`, `invited` and `blocked`. A new filter option,
  "Cannot submit yet", is what the rail badge counts.
- Every column sorts (`aria-sort`).
- Columns were tightened: the role moved under the name, beside the email; Submitted and Issued are
  one "This month" column (`1 / 0`, with an (i)); the basis chip became an (i); an invite's expiry
  moved into the Submit column. Measured: 870/870 at 1280 and no sideways scroll at 1440.

**Still worth doing:** "Seats used" could link to Settings › Plan once that page has a stable
anchor.

### Home › Agency › Producers › a producer (`/app/producers/<id>`)

**What was wrong**
- The client drew the header after its fetch.
- Up to four outline buttons sat on the title line (Resend, Suspend or Reactivate, Offboard), plus a
  fifth, Change manager, inside the Details card.
- The tabs sat in a row under the header.
- The Production tab was a card holding two links.
- The Onboarding tab opened on a tinted warning notice.
- Carriers edited in a side panel.

**What changed**
- The header is read on the server: the name, the status chip and one facts line (role, manager,
  hired).
- Tabs are on the title line as links: `?tab=overview|carriers|onboarding|money`. Onboarding turns
  red while he cannot submit.
- Buttons: at most two, plus **More**.
  - The two are the status step that fits (Resend invite, Suspend or Reactivate) and Change manager.
  - More holds Offboard, Open their policies and Compare on the scorecards. The last two are what
    the Production tab held, so that tab is gone; `?tab=production` lands on Overview.
- Each step is still its confirm pop-up. Offboarding keeps its frozen-balance and chargeback-window
  figures and the typed OFFBOARD (AG-0.7). After a step the header re-reads on the server.
- Overview adds Phone. When nothing was written this month it says so in place of a skeleton that
  never ended.
- **Onboarding:** the notice became the card's own title, "They can't submit yet · 2 items missing".
  "Carriers tab" is now a link.
- **Carriers:** Edit opens a page, `/app/producers/<id>/carrier/<carrierId>`, for the level and
  writing number from a date, and appointments by state. Hierarchy's **Set level** goes straight
  there.

**Still worth doing**
- Editing name, NPN and hire date: the PATCH route exists (owner only), but no screen calls it.
  Adding an Edit details page would cover the spec's "profile" line. It is not built yet.

### Commissions › Hierarchy & overrides (`/app/hierarchy`)

**What was wrong**
- It had its own header.
- At 1280 the last column was cut off: a "Change manager" button on every row.
- "Set level" opened the producer's Overview, not the level.
- The basis chip widened a header.

**What changed**
- It renders in the Team frame.
- The strip adds Producers (and carrier count). Missing levels and Negative spreads open
  `?issues=1`.
- **Set level** opens that carrier's page.
- Other rows get a row **More**: Change manager (the dated confirm, AG-0.3) and Change level.
- A negative spread is a short "Negative" chip, with the full sentence in its title.
- The override's basis moved into an (i).
- Measured 870/870 at 1280.

### Accounting › Producer payouts (`/app/producer-payouts`)

**What was wrong**
- It was under Team.
- It had its own header and its tabs in a row of their own.
- A toolbar-only card with the date fields showed even when no balance was negative.
- Commit opened a custom dialog.

**What changed**
- It is an Accounting step.
- New run and Runs are title-line tabs (`?tab=runs`).
- **Commit run** sits on the title line through `StepSlot`.
- The period and Refresh sit on whichever card comes first.
- Commit is the shared `ConfirmDialog` with fields (paid on, how, reference), as Accounting's other
  mark-paid steps are.
- A run's producer name opens its statement.

**One producer-pay system (owner, later on 2026-11-03).** AG-1.7 already wrote to LA-7.5's tables,
so the two screens now become one. This step and Commission splits stay. The Accounting session
retires Producer splits and My balance, redirecting them here and to My pay.

LA-7.5's two corrections were added here, on their existing routes:
- **Void run:** the row's More on the Runs tab.
- **Write off the balance:** a negative-balance row's More on New run.

Both are confirm pop-ups that need a reason. They show only where the plan has Profit & loss and
the person keeps the books, which is those routes' gate. I opened the void confirm and cancelled
it; neither action was run on live data.

### Accounting › Producer payouts › Statement (`/app/producer-statements/<run>`)

**What was wrong:** the client fetched the statement and drew its own header.

**What changed**
- It is read on the server under the same rules as its API: a producer sees his own, a manager
  never sees a report's, owner and bookkeeper see any.
- For owner and bookkeeper it is a record of Producer payouts: the period as the title, the
  producer, agency and payment as facts, and Download PDF.
- A producer reaches it from My pay, so his trail says "Commissions › My pay".

**Still worth doing:** for a producer, the sidebar lights Accounting rather than Commissions on this
address.

### Accounting › Commission splits (`/app/commission-splits`)

**What was wrong**
- It had its own header.
- New split opened a side panel with a tinted error box.
- An existing split could not be changed from the list.
- The pool rule was a subtitle.

**What changed**
- It is an Accounting step with a strip: Shared policies, Producers sharing, Added this month.
- The pool rule, and how this differs from Producer splits, is the (i).
- **New split** (title line) and **Change** (row) open a page, `/app/commission-splits/new`,
  prefilled for a change. The second share is the rest of the first, so it is always 100%.
- The premium preview runs the same integer engine as the database.

**Spec conflict, not changed:** AG-1.6's prose says the pool uses the writer's level. Its code block
says "the HIGHER of the two". The code and database use the writer's level, and that is what the
screen states.

**Data seen:** demo policy 0119689565 (American Amicable) is split 70/30 with Marisol Vance as the
writer, but she has no level on American Amicable. Its pool cannot be computed until one is set.
The form says "set the writer's level first".

### Reports › Producer scorecards (`/app/producer-scorecards`)

**What was wrong**
- It sat under Team with its own header and a This quarter / Last quarter switch.
- It had no export.
- At 1280 the table was 961px in an 870px card.

**What changed**
- It is a Reports view. It uses the shared PeriodPicker, first in the toolbar, and `?from&to` rides
  along to the other views.
- A strip shows the team's totals (submitted, issued, chargebacks, advance at risk); it is hidden on
  a producer's own row.
- Export CSV.
- A producer's name opens his policies.
- Header tips moved to the title's (i) and column titles.
- To fit 1280: Month 4 and Month 13 are one column; "Cost/persisting" reads "Cost/alive", with the
  full meaning in its title. A cohort without enough history says "Building" (spec wording), with
  its ready date in the title. The CSV keeps every column separate.
- A producer sees the view titled "My scorecard".

**Data seen:** Demo Agent shows 19 submitted against 41 issued in 90 days. Issued comes from the
carriers' files, submitted from in-app applications, so a book imported from carriers issues more
than it submits. This is expected, but worth a word in the (i) if owners ask.

### Sales › Applications › Application review (`/app/application-review`)

**What was wrong**
- It sat under Team.
- It had its own header and its own tab row.
- A row opened a side panel holding the review form.

**What changed**
- It is the fourth tab of Applications.
- The Applications tabs moved onto the title line, which also fixes Cases, Waiting and Quotes.
- To review, Reviewed and By producer are toolbar chips (`?show=`).
- A row opens the review's own page, `/app/application-review/<id>`:
  - Header: the producer, the status chip, and carrier · sampled date and rate · reviewed date.
  - Buttons: **Send back to fix** and **Pass**. More holds **Fail** (it asks once) and **Open
    application**.
  - Below: the submission's checks, the error types and the note.

**Still worth doing**
- Opening the list calls `agency_review_sample`, which draws the sample. That is a write on read,
  as before.
- The review list is capped at 500 rows.

## Checks

- `npx tsc --noEmit -p .`: 0 errors.
- eslint on every changed file: clean.
- `npm test`: **3,780 of 3,780** on the final run.
  - On the first run, 3 of 3,775 failed: two Compliance tests (files this pass never touched, being
    edited by the Compliance sessions at the time) and the `hand-callout` baseline, which this pass
    lowered (5 agency files to 0).
- The table width at 1280 was measured in the browser: Producers, Hierarchy and Scorecards are all
  870/870 with no sideways scroll.
- Console: the one server/client error, from calling `rosterFilterOf` on the server, was fixed by
  moving it to `lib/agency/rosterFilter.ts`. A hydration mismatch on the shell's sidebar wrapper
  (`AgentShellLayout`) also shows; it is not from this pass.
- Walked on the dev server as the demo owner, at 1440×900 and 1280×800: Producers, a producer
  (Overview, Carriers, Onboarding, Money), a carrier page, Hierarchy, the Statement, Producer
  payouts (New run, the Commit confirm opened and cancelled, Runs), Commission splits, the Change
  split form with a typed preview (not saved), Producer scorecards and Application review.
- Nothing was saved, sent or paid. No migration was needed.

## Not done

- No producer- or manager-session walk. The minted session is the owner's.
- Edit details (name, NPN, hire date) has an API but no screen.
- The AG-1.7 / LA-7.5 producer-run overlap is the owner's call.
