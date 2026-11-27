# Mobile app vs the board · screen-by-screen gaps (26 November 2026)

Source of truth: `docs/design/mobile-v1` (135 screens, A0–M8). Each section below compares every board screen's
Android drawing and notes with the app code, and lists what differs (board has → app has). Board paths are
shortened: `a:`…`f:` = `screens-a.js`…`screens-f.js`; app paths are under `mobile/src/`. Verdicts:
MATCH / DIFFERS / MISSING; severity high = visibly different or missing.

## Totals

| | Screens |
|---|---|
| Match the board | 5 (A0, A4, C10, D5, L3) |
| Differ | 128 |
| Missing | 2 (E1 Quick quote, L4 Working offline) |
| **Board total** | **135** |

Real bugs found on the way: E6b sends scans to a route that does not exist (404); I7's Add button and toast scroll
with the list; M8 Update needed is never triggered by any server answer; I5 Check a number is offered to setters and
assistants, whom the server refuses.

**One decision for the owner.** Every auditor flagged the Android header: the board puts the large title on its own
30px line, and on 2026-11-26 the owner asked for it on the action line. The app follows the owner for now.

## A · Getting in, B · Home by role

| Board id | Title | App file(s) | Verdict | Severity |
|---|---|---|---|---|
| A0 | First open | app/welcome.tsx | MATCH | – |
| A1 | Sign in | app/sign-in.tsx | DIFFERS | med |
| A2 | Your sign-in code | app/two-factor.tsx | DIFFERS | low |
| A3 | Turn on alerts | app/turn-on-alerts.tsx | DIFFERS | med |
| A4 | Face ID next time | components/getting-in/biometric-offer.tsx | MATCH | – |
| A5 | Accept an invite | app/accept-invite.tsx | DIFFERS | med |
| A6 | Check your email | app/check-email.tsx | DIFFERS | low |
| A7 | Pick a workspace | app/pick-workspace.tsx | DIFFERS | med |
| B1 | Home · producer | app/(tabs)/index.tsx | DIFFERS | high |
| B2 | Home · agency owner | components/home3/home-owner.tsx | DIFFERS | med |
| B3 | Home · setter | app/(tabs)/index.tsx, lib/roles.ts | DIFFERS | high |
| B4 | Search everything | app/search.tsx | DIFFERS | med |
| B5 | Home · assistant | app/(tabs)/index.tsx | DIFFERS | high |
| B6 | Home · bookkeeper | components/home3/home-bookkeeper.tsx | DIFFERS | high |
| B7 | Home · retention | components/retention/retention-home.tsx | DIFFERS | high |
| B8 | Home · manager | components/home3/home-manager.tsx | DIFFERS | med |
| B9 | Get set up | components/home3/setup-screen.tsx | DIFFERS | med |

**Every large title (owner decision, kept).** The board draws the Android title on its own 30px line under a 64px
action bar. On 2026-11-26 the owner asked for the title on the action line, so the app keeps that on purpose.

**A1 Sign in.** Extra "Sign in as a partner" link (board: one app, the account decides). Fingerprint button only shows
an alert → board signs in.
**A2.** Subtitle names the account's email on the board ("…for jordan@elleryfields.com").
**A3 Turn on alerts.** Board: five fixed rows with phone copy (transfer waiting, callback in 5 min, case changes at
the carrier, policy at risk, partner messages off) → app lists every server event (up to ~17) with server labels.
**A5 Accept an invite.** Inviter avatar + "Dana invited you to Ellery & Fields" → app "You're invited to {org}" (API
has no inviter). Per-role sentence after "You'll join as a Producer" missing. Password strength word missing.
**A6.** Copy "We sent a sign-in link to X" → app "If X has an Insurvas account…" (privacy wording; owner to approve).
**A7 Pick a workspace.** "Partner portals" group missing; row meta "Producer · 18 people" (headcount) missing; "Last
used" should be remembered, not the current one.

**B1 Home · producer.** **"This week" section missing** (Dials, Talk time, Applications, Issued premium tiles with link
Activity). **"November goal" ring card missing.** Schedule mixes appointments with callbacks → app callbacks only.
Needs-you tiles hidden at zero → board always four. "Payment missed" detail "Save by 2 Dec"; "Case needs a doc"
detail "Corebridge · APS".
**B2 Home · owner.** First tile "Approve payouts · 4 · $18,240 · due Fri" → app "To approve". Strip tiles hidden at
zero. Chargebacks chip "3 policies" → "N producers". Producers ranked by premium dollars → app by issued count. Inbox
badge red ("alert") → app gold.
**B3 Home · setter.** **Tabs: Home · Dialer · Callbacks · Inbox · Menu** (Callbacks badge) → app has no Callbacks tab.
**"Appointments you set" section missing** (rows with Scheduled/Showed chips). Ring and tiles vanish when the
scorecard fails or no target.
**B4 Search.** Fixed chips All · Leads · Policies · Cases · Pages. "Retention cases" group missing. Status chips on rows
("Overdue", "In force", "8 days left"). Policy number in mono.
**B5 Home · assistant.** **"Your handoffs" section missing** (offered/accepted rows with Waiting/Accepted chips).
**"Today" tiles missing** (Calls verified, Handed off, Avg to hand off, Accepted). Screen is nearly empty.
**B6 Home · bookkeeper.** Subtitle "November books · close on the 5th". Tiles hidden at zero → board four always.
Large Empty block when nothing waits → not drawn. **"Cash this month" six-bar chart + "Deposited $121,400" missing.**
Rows waiting on the owner never shown (app filters to own items).
**B7 Home · retention.** Ring "23 saved of 41 worked · team average 48%" → app "saved of decided · closed without a
save". Ring shows a percentage. Subtitle time of last file. Gold "Call the next case" always shown. Retry-callback
rows in "Call today". Cases tab badge.
**B8 Home · manager.** "Wrapping up" status missing; row order on a call → wrapping up → away → ready. Applications tile
disappears on failure.
**B9 Get set up.** "Add your licences" step missing. "Invite your team" meta "3 people · takes a minute". Extra "Fine-
tune later" group. Progress counts alerts. No entry from the owner's Home.

**Server data the board needs (A, B):** inviter name; workspace headcount and partner portals; weekly
dials/talk/apps/issued and the goal (scorecard, goals); appointments on Home (`/api/app/appointments` exists);
payouts due day, producer premium dollars; search retention cases and statuses; the assistant's handoffs and daily
counts (no API); books close day and weekly deposits (no API); team save-rate average, file time, retry callbacks;
wrapping-up state on the floor; a licences setup step.

## C · Calls

| Board id | Title | App file(s) | Verdict | Severity |
|---|---|---|---|---|
| C1 | Incoming calls | app/(tabs)/calls.tsx | DIFFERS | med |
| C1b | Transfer details | components/inbound/transfer-details.tsx | DIFFERS | low |
| C1c | Inbound team | app/call/team.tsx, inbound/model.ts | DIFFERS | med |
| C2 | A transfer rings | inbound/ringer.tsx, lib/push.ts | DIFFERS | high |
| C3 | Caller profile | app/call/[workItemId].tsx, inbound/profile.tsx | DIFFERS | low |
| C4 | Verification | inbound/verify.tsx | DIFFERS | med |
| C4b | Offer a handoff | inbound/handoff-sheet.tsx | DIFFERS | low |
| C5 | Correct a field | inbound/correct-sheet.tsx | DIFFERS | low |
| C6 | Finish the call | inbound/finish.tsx | DIFFERS | med |
| C7 | Dialer | calls.tsx, dialer/head-card.tsx, checks.ts | DIFFERS | med |
| C7b | Compliance details | dialer/checks-sheet.tsx | DIFFERS | low |
| C7c | Read the disclosure | call-sheet.tsx | DIFFERS | high |
| C7d | Script and rebuttals | dialer/script-screen.tsx | DIFFERS | low |
| C7e | Dialer queue filters | dialer/queue-sheet.tsx | DIFFERS | med |
| C8 | Back from the call | call-sheet.tsx | DIFFERS | med |
| C8b | Book an appointment | calendar/book-appointment.tsx | DIFFERS | high |
| C9 | Schedule a callback | calls/callback-picker.tsx | DIFFERS | med |
| C10 | Dialing blocked | calls.tsx, call-sheet.tsx | MATCH | – |
| C11 | Callbacks | calls.tsx | DIFFERS | low |
| C12 | Callback detail | calls/callback-detail.tsx | DIFFERS | med |
| C13 | Calendar | app/calendar.tsx | DIFFERS | low |
| C13b | Appointment | app/appointment/[id].tsx | DIFFERS | med |

**C1 Incoming.** `sliders` action missing. "Next transfer rings this phone · 2 ahead of you" (queue position). Card
always shown. Handoff row "from Sam (assistant)" / "Verification 9 of 12 done". Not on the board: on-call card at
top, "Showing the N longest" line.
**C1b.** Duplicate line names the match ("Walter Brooks, (478) 555-0133, Contacted 4 Oct by Sam Lee"). Note card is
the partner's own sentence ("From Summit Media"), no time-ago. Three ticks only.
**C1c Inbound team.** Subtitle "Next transfer goes to Sam Lee". "Next" / "2nd" rotation chips. "Wrapping up · outcome
screen" row. Assistant verifying listed under Not taking calls. Lines "Off today", "Away since 11:20".
**C2 A transfer rings.** **Full-screen call-style notification on the lock screen with Take call / Pass** → app
in-app modal only. **"Callback in 5 minutes" notification with Open / Snooze 10 min** missing.
**C3.** "From" row is partner · campaign ("Apex Leads · FE-Florida-2"); footer "2 min ago · first call with us". Extra
partner key/value list and Notes card.
**C4 Verification.** "Continue to Application" goes to step 3 of 4 on the phone → app sends it to the computer page.
Assistant footer "Hand to a licensed agent" not drawn. "Read it back to her".
**C4b.** Qualifier line "Licensed in Georgia for final expense, ready now" missing.
**C5.** Compound beneficiary edited as Full name / Relationship (dropdown) / Share → app one field at a time, chips.
**C6 Finish the call.** After saving opens **Daily deal flow** → app back to Calls. "You get a reminder 5 minutes
before" consequence missing. Toast, not inline line.
**C7 Dialer.** "Apps 2" figure chip missing. Ticks: Consent, DNC clear, Not suppressed, In window, **Not a client**.
Up next rows: "Callback" info chip with "callback 3:00", "Later" chip with "window opens 11 am PT".
**C7b.** "Not already a client" check missing; extra "Valid number", "Licensed in …".
**C7c Read the disclosure.** Shown **when the customer answers**, with a call timer "On the call 0:04" → app before
dialing. Link "He didn't answer · voicemail" missing. Detail "Texas · outbound disclosure v4 · 31 words".
**C7d.** `pencil` edit action (saves a new script version) missing. Footer "Script v12 · updated by Dana 14 Nov".
**C7e.** "Lead type" chips (Fresh, Aged, Callbacks, Recycled) and "Callable now only" switch missing.
**C8.** Disclosure chip "Read at 0:09". Snackbar **Undo**. Interested tile first and full width.
**C8b Book an appointment.** "With" line "Ava Kim · licensed in GA". **Method switch Phone / Video / In person, "Where"
field, "Text Linda a reminder the day before" switch missing.** Licensed producers only.
**C9.** "Remind me 5 minutes before" switch missing. "Anyone on the team can take it" in every picker.
**C11.** Extra "Later" group. **Setter tabs include Callbacks**; assistant Calls "same as producer" (app gives no dialer,
following the server's dialer roles).
**C12.** Sub-line product · city, state. History mixes callback set, calls with length and outcome, lead arrival.
**C13.** Appointment row "Appointment · Zoom · set by Lena (setter)".
**C13b.** "Running late" outline button beside Start application. Method in sub-line. "18 min drive".

**Server data the board needs (C):** queue position and rotation order; wrap-up state; handoff "9 of 12"; duplicate
who/when; native ring push with actions; Apps count; lead-type and callable-now filters; not-a-client check for the
dialer; disclosure version; script editing; callback reminder; appointment method, place, SMS reminder; meeting
method and drive time; running-late note; mixed callback history; campaign name and partner sent time.

## D · Leads, E · Sales

| Board id | Title | App file(s) | Verdict | Severity |
|---|---|---|---|---|
| D1 | Leads · list | app/(tabs)/leads.tsx | DIFFERS | low |
| D2 | Leads · board | components/leads/board.tsx | DIFFERS | med |
| D3 | Lead page | app/lead/[id].tsx | DIFFERS | high |
| D3b | Lead · conversation | components/leads/tabs.tsx | DIFFERS | med |
| D3c | Lead · nurture | components/leads/tabs.tsx | DIFFERS | high |
| D3d | Lead · verification | components/leads/tabs.tsx | DIFFERS | low |
| D4 | Lead · activity | app/lead/[id].tsx, leads/parts.tsx | DIFFERS | med |
| D5 | Lead · more actions | components/leads/actions.tsx | MATCH | – |
| D5b | Hand off a lead | components/leads/actions.tsx | DIFFERS | med |
| D6 | Move to a stage | components/leads/move-sheet.tsx | DIFFERS | med |
| D7 | Add a lead | components/leads/add-lead.tsx | DIFFERS | high |
| D8 | Filter leads | components/leads/filters.tsx | DIFFERS | med |
| D9 | Same person? | app/lead/same-person/[id].tsx | DIFFERS | high |
| D10 | Vendor | app/vendor/[id].tsx | DIFFERS | low |
| E0 | Applications | app/application/index.tsx | DIFFERS | med |
| E1 | Quick quote | — (only a step inside a case) | **MISSING** | high |
| E1b | Start an application · product | app/application/start.tsx | DIFFERS | low |
| E2 | Application · a question | components/applications/interview.tsx | DIFFERS | med |
| E2b | Application · all steps | components/applications/steps-sheet.tsx | DIFFERS | high |
| E2c | Bank details, protected | components/applications/bank-details.tsx | DIFFERS | med |
| E3 | Pick the draft date | components/applications/draft-date.tsx | DIFFERS | high |
| E4 | Sign and submit | components/applications/sign.tsx | DIFFERS | med |
| E5 | Pending cases | app/cases/index.tsx | DIFFERS | low |
| E6 | Case detail | app/cases/[caseId]/index.tsx | DIFFERS | med |
| E6b | Send a scanned document | app/cases/[caseId]/scan.tsx | DIFFERS | high (upload route does not exist) |
| E7 | Daily deal flow | app/deal-flow.tsx | DIFFERS | med |

**D1.** Row chip colour follows the meaning (New brand, Needs review warn, Assigned info) → app always brand stage
name. "Mine · All" both green links.
**D2.** Exact lane counts (server `stageTotals` already sent, unused). Card line says what's next ("Wants $15k ·
callback Thu", "Quote sent · AMAM $48/mo", "Overdue 2 h"). Long-press goes straight to D6. Extra "Load more".
**D3 Lead page.** **Six tabs, ending "Application" → app five.** Tab bar visible with the Schedule/Call bar above it.
"What happens next" readiness checklist: Consent on file, Coverage amount picked, Beneficiary named, Bank for the
draft → app three other items. "Start application" always. Lineage card "Where she came from", Vendor · Campaign ·
Source · Cost with cents. ⋯ always.
**D3b.** Logged email cards ("Email · Your quote… · opened twice") and composer attach icon missing.
**D3c Nurture.** **Pause and End nurture buttons missing.** Plan card titled with the recycling plan, mixed touches
(calls, email the quote again, back to the shared pool). "Goes back in Ava's queue at 9 am her time".
**D3d.** Group title "Checked on 23 Nov by Ava Kim · 10 of 12".
**D4.** Team / only me choice on notes. Attach icon. Event wording "Moved to Interested", "Call · 8:04", "disclosure read
at 0:07".
**D5b.** Agent value "Jordan Reyes · licensed in GA". "Why" reason field.
**D6.** "Quote" picker field. Explain line "Her callback on Thu stays." Toast with Undo.
**D7 Add a lead.** Duplicate check on phone + date of birth **before saving**, inline warning with "Open existing" /
"Save lead" → app saves first then sends to D9. Draft kept on the phone too.
**D8.** "Callable now only" switch. "Show 64 leads" exact.
**D9 Same person?** Primary button "Same person" links the records (older owner kept) → app only opens the other lead.
**D10.** No way in from Menu (no vendor list on the phone).
**E0.** Chip and group "Needs signature". Draft line "step 5 of 10 · Health". Signature rows "E-sign sent 1:58 pm · not
opened" / "Signature rejected by carrier", chips Resend / Sign again.
**E1 Quick quote — missing.** Standalone screen from Menu: header Quote + history; Age, State, Coverage, Tobacco; Level /
Graded / Guaranteed; "8 carriers · monthly" priced from rate tables with rate class, first "Best"; footer; "Apply with
American Amicable" carries the pick into E1b.
**E1b.** Back "Quote". "For Linda Okafor · 68 · Georgia · $15,000". Picked row shows its quote. Footers and computer-row
meta wording. Computer product emails the link.
**E2.** Ten steps where Health is 5 of 10. Answers queue offline.
**E2b.** Steps: Verify, Quote, Eligibility, Personal details, Health, Medications, Beneficiary, Payment, Review, Sign →
app a different ten. Current step "Now · 3 of 7".
**E2c.** In-app biometric sheet; numbers blurred in screenshots and the app switcher (no capture protection today).
Extra Checking/Savings switch, computer link, Back/Next bar, header action.
**E3 Draft date.** Calendar dates ("Fri 18 Dec · 2 days after her deposit · usually clears"), a "Risky" deposit-day
option, "Use Fri 18 Dec", "Pick another date" → app days of the month plus extra income fields.
**E4.** "Sign · 10 of 10". "First draft: Fri 18 Dec". Signed time with "ET". Send the e-sign link from the phone.
**E5.** At-carrier chips Received / Underwriting / Approved, not issued. "signature missing".
**E6.** "$71.40/mo" with cents. "Call the office" (APS). Still-to-come rows: Phone interview, Payment first draft,
Policy delivery.
**E6b.** Document scanner with crop (ML Kit) → app camera. **Upload goes to a route that does not exist (404).** "Send
to" value "Corebridge · requirement APS · CB-4471902".
**E7.** "Written today" (written deals only). Chip "Unsigned". Deals detail "3 need a signature". Rise bold, no colour.

**Server data the board needs (D, E):** what's-next line on list rows; readiness checklist; logged emails; per-lead
recycling plan with pause/end; verifier name; only-me notes; licence state on agents; handoff reason; quote on a move;
move undo; duplicate check from raw values; server-side filter counts and callable-now; same-person link; application
step, e-sign sent/opened/rejected; premiums from rate tables; draft calendar dates and risky option; send e-sign
link; detailed carrier status; office phone and interview date; requirement document upload; signature status per
deal.

## H · Inbox & chat, I · Team, reports & compliance, J · Menu & settings

| Board id | Title | App file(s) | Verdict | Severity |
|---|---|---|---|---|
| H1 | Inbox · alerts | app/(tabs)/inbox.tsx | DIFFERS | high |
| H2 | Inbox · messages | app/(tabs)/inbox.tsx, lib/chats.ts | DIFFERS | med |
| H3 | Partner chat | app/chat/[threadId].tsx, partner/agent-chat.tsx | DIFFERS | med |
| H4 | Notification settings | app/notifications.tsx | DIFFERS | high |
| I1 | Team | components/team/team-tab.tsx | DIFFERS | low |
| I2 | Producer | components/team/producer-screen.tsx | DIFFERS | med |
| I3 | Reports | components/team/reports-screen.tsx | DIFFERS | high |
| I4 | Sales performance | components/team/report-screens.tsx | DIFFERS | high |
| I4b | Team activity | components/team/report-screens.tsx | DIFFERS | high |
| I4c | Retention scorecard | components/team/report-screens.tsx | DIFFERS | med |
| I4d | Callbacks kept | components/team/report-screens.tsx | DIFFERS | low |
| I4e | Partner quality | components/team/report-screens.tsx | DIFFERS | med |
| I5 | Check a number | components/team/compliance-screens.tsx | DIFFERS | med |
| I5b | Consent proof | components/team/compliance-screens.tsx | DIFFERS | med |
| I6 | Complaints | components/team/complaints-screens.tsx | DIFFERS | low |
| I6b | Complaint | components/team/complaints-screens.tsx | DIFFERS | med |
| I7 | Licences and appointments | components/team/compliance-screens.tsx | DIFFERS | med (FAB scrolls with the list) |
| I8 | Partner (agency side) | components/team/partner-screen.tsx | DIFFERS | high |
| J1 | Menu | app/(tabs)/menu/index.tsx, menu/pages.ts | DIFFERS | med |
| J2 | Opens on a computer | app/computer.tsx | DIFFERS | med |
| J3 | Settings on the phone | app/settings.tsx | DIFFERS | med |
| J3b | Edit profile | app/profile.tsx | DIFFERS | low |
| J3c | Signed-in devices | app/devices.tsx | DIFFERS | low |
| J4 | Help and guides | app/(tabs)/menu/help.tsx | DIFFERS | low |
| J5 | Switch workspace | app/workspaces.tsx | DIFFERS | med |

**H1 Alerts.** Read alerts stay in the list (only unread get the dot) → app drops them. **Swipe left: Snooze (info),
Read (green)** missing. Alerts/Messages switch always shown with counts → app only for owner/producer. Header only
listCheck + settings.
**H2 Messages.** Pencil and FAB start a new message → app hands off to the computer. Search searches chats. Groups
first. Messages for everyone in a chat.
**H3 Partner chat.** Header phone + moreH missing. Attach a document or a photo (camera, files) → app photo library.
Send button always green.
**H4 Notification settings.** Board groups Calls / Sales and book / Messages / Quiet hours with its own rows (Transfer
waiting "Ring like a call, even on silent", Callback in 5 min, Someone handed a call to you, Case changed at the
carrier, A policy is at risk, Commission statement posted, Partner chat, Team floor) → app the server's registry groups
and labels. **"Let transfers through" quiet-hours switch missing.** Quiet hours editable on the phone.
**I1 Team.** "All 18" chip with a team-picker chevron. "On the phone now", always shown.
**I2 Producer.** Header msg + moreH. "Goal passed on 19 Nov". Third tile "Talk time 31h". Chargebacks "None in 90
days". Goal ring always for the owner.
**I3 Reports.** Calendar (period) action. **Cards: Sales performance, Team activity, Book scorecards, Retention
scorecard, Partner quality → Book scorecards missing** (persistency API exists), extra Callbacks kept card. Team
activity card "Talk time per producer, daily · 1h 52m". Retention "Saved this month · 23 of 41 · 56%" with sparkline.
Partner "Sold per 100 leads". Computer row "True CPA, Lead sources, Queue scoring, Hierarchy".
**I4 Sales performance.** Sliders action. **Funnel "From lead to policy": Leads, Contacted, Quoted, Applied, Issued,
each bar opens its list.** Days-to-issue monthly bar chart missing. Decline rows open.
**I4b Team activity.** Tile "Talk time 41h 10m". Group "By person · talk time", meta "142 dials · 31 contacts · 4 apps",
setter rows labelled.
**I4c.** This month (app 180 days). "Save rate by reason" (Draft returned, Bank closed, First payment missed, Can't
afford it) → app by step.
**I4d.** Extra line and empty state; chip logic.
**I4e.** "Sold per 100 leads · November", meta "62 leads · 2 returned"; every row opens I8.
**I5 Check a number.** Meta "Checked 9:41 am · Tampa, FL · mobile". Open to setters and assistants → server refuses
them (preflight owner/producer).
**I5b Consent proof.** **Consent words box and "Verbal yes on the call" card with play button missing.** "Expires 18
Nov 2027" row.
**I6.** "Closed lately" meta uses the summary.
**I6b Complaint.** Header moreH. Sub-line with carrier name. "What he said". Log rows: assignment and call-back history
→ app status events.
**I7 Licences.** **FAB "Add" with a camera (photo of the licence)** → app plus, no photo. **FAB and toast scroll with
the list (bug).** Adding for everyone; licences are the person's own.
**I8 Partner.** **Tiles Sent, Sold "9.9 per 100", Owed "$4,315 · Due 5 Dec", Returns** → app Sent, Submitted,
Transfers, Disqualified. Deal group "Per sold lead $95", "Per live transfer $35", "Return window 7 days". msg opens
this partner's thread → app Inbox.
**J1 Menu.** Phone pages shown with laptop marks: Appointments & setters, Vendors & campaigns, Quote, Commission ledger.
"Carrier appointments" label. Header only search.
**J2 Computer hand-off.** Second button **"Put it in my bell on the web"** missing.
**J3 Settings.** "Saved for offline · 2 drafts" row missing. **Appearance (Dark/Light/System) not settable.** Rows always
shown. Working hours and Two-step on the phone.
**J3b.** Small type and spacing; time zone value.
**J3c.** "trusted till 24 Dec". "Sign out everywhere else" always.
**J4.** "Usually answers within an hour". Footer build number. Board guide titles.
**J5.** Handshake icon and Partner workspaces. Meta "Owner · 2 alerts".

**Server data the board needs (H, I, J):** read alerts and snooze; partner contact phone; notification events for
transfer ring, case changed, policy at risk, statement posted, team floor, and a let-transfers-through flag; talk
time; goal-passed date; lead/contacted funnel steps and monthly days-to-issue; save rate by reason and a month period;
sold per 100 and returns; number city and line type; preflight for setters/assistants; consent wording, expiry and
verbal-yes recording; complaint carrier and history; licence photo storage and a person's own licences; partner owed
and due, both rates, return window; a bell row for oneself; trusted-until; workspace alert counts and partner
memberships.

## F · Book & retention, G · Money

All 22 screens have app code; none matches exactly.

| Board id | Title | App file(s) | Verdict | Severity |
|---|---|---|---|---|
| F1 | Policies | app/(tabs)/policies.tsx, components/book/policies.tsx | DIFFERS | med |
| F2 | Policy | app/book/[carrierId]/[policyNumber]/index.tsx, components/book/policy.tsx | DIFFERS | med |
| F2b | Commission ledger | app/book/…/ledger.tsx, components/book/ledger.tsx | DIFFERS | high |
| F3 | Retention cases | app/(tabs)/ladder.tsx, components/retention/cases-screen.tsx | DIFFERS | low |
| F3b | Waiting on the carrier | components/retention/waiting-screen.tsx | DIFFERS | low |
| F3c | Win-back | components/retention/win-back-screen.tsx | DIFFERS | high |
| F3d | Open a retention case | components/retention/new-case-sheet.tsx | DIFFERS | high |
| F4 | Retention case | components/retention/case-screen.tsx | DIFFERS | high |
| F5 | Log an attempt | components/retention/log-attempt-sheet.tsx | DIFFERS | high |
| F6 | Carrier sync · needs you | components/book/needs-you.tsx | DIFFERS | med |
| G1 | My pay | components/money/my-pay.tsx | DIFFERS | med |
| G2 | Pay statement | components/money/statement.tsx | DIFFERS | med |
| G3 | Money · owner | components/money/money-tab.tsx | DIFFERS | med |
| G3b | Partner payouts | components/money/sheets.tsx | DIFFERS | low |
| G3c | Vendor bill | components/money/bill.tsx | DIFFERS | low |
| G3d | Bank deposit | components/money/deposit.tsx | DIFFERS | med |
| G3e | Profit & loss | components/money/pnl.tsx | DIFFERS | med |
| G4 | Approve team payouts | components/money/sheets.tsx | DIFFERS | med |
| G5 | Snap a receipt | components/money/device.ts, expense.tsx | DIFFERS | high |
| G6 | Add expense | app/money/expense.tsx, components/money/expense.tsx | DIFFERS | high |
| G7 | My balance | components/money/balance.tsx | DIFFERS | high |
| G8 | Pay issues | components/money/pay-issues.tsx, app/(tabs)/moneytab.tsx | DIFFERS | med |

**F1 Policies.** Header `sliders` action missing. Fourth chip is "Charged back" (count) on the board → app "Behind".
"/mo" suffix on every row → board only on the first. Not on the board: "Show more · N left", laptop icon on
hand-entered rows.

**F2 Policy.** Missing "Beneficiary" row. Issued tile detail "Month 9 of 12 chargeback window" → app "9 of 12 months
paid · chargeback window". Next draft detail "Last 3 drafts cleared" → "N months paid". Status source uses the short
carrier code ("AMAM file · 14 Nov") → app full file name. Commission card is not a link on the board → app opens F2b.
"Call Maria" and "Open the case" always shown → app hides them by role / when missing ids.

**F2b Commission ledger.** Missing future lines ("As earned · month 10 · Expected" chip, "Renewal · year 2 · Starts
Mar 2027 · —"). Missing the **Split** group (writing agent % of advance; Agency override %). Meta "AMAM statement · 14
Mar" → app file name. Not on the board: footer note, "Held" chip.

**F3 Retention cases.** Sub "last file 6:02 am" (time) → date. Paperwork tile detail "Address, bank, beneficiary" →
"Beside the ladder". Pending lapse detail chip "3 this week" always. Short carrier codes. Cases tab badge (9) missing.
Not on the board: groups "Past the carrier's date / Later / No carrier window", Views sheet.

**F3b Waiting on the carrier.** Short carrier code in meta. Request kinds "Reinstatement paid", "Beneficiary updated"
missing (app has 4 change types). Proven rows name the outcome ("Draft cleared · Transamerica file 21 Nov"). Group
"Proved by a file this week" (app shows all).

**F3c Win-back.** Board gives it to the retention role on the Cases tab → server answers 403, app shows "isn't part
of your role" (rule conflict, needs a server change). Meta price comparison "TA $62 → AMAM $49", "called 2× · no
answer" missing. Chip "Can't write" → app "Stuck".

**F3d Open a retention case.** Five reasons (Changed banks, Can't afford it, Moved, Wants to cancel, Beneficiary
change) → app three (Wants to cancel, New payment date, Carrier needs something). Label "What she said" → "What they
said".

**F4 Retention case.** "Call Ruth" goes through the dialer → app copy-number dialog. Deadline label "Lost on" at
pending lapse → "Lapses on". Source line with file row number missing. Four steps on the board → app three, worded
differently.

**F5 Log an attempt.** Outcomes: Reached her, No answer, Left voicemail, Wrong number, She'll call the carrier → app
six different ones. **"Try again" date field missing.** "Mark 'Send the change' as done" drawn on → app off/hidden.
Not on the board: "What you did" chips.

**F6 Needs you.** Short carrier code chip. Candidate lines "Born 2 Jul 1961 · lead in Applied · Jordan Reyes" → app
"Born 07/02/1961 · N of 6 match · …". "Neither · a sale no carrier had / Opens a new policy from this row" → app
different words and button. Not on the board: "All N on the computer".

**G1 My pay.** Header `download` missing. Sub "paid on the 5th" → "paid in early December". Meta wording for As
earned and Chargebacks differs. Not on the board: Pay plan row; statements not capped at 3.

**G2 Pay statement.** As earned is one summary row on the board → app a row per line. Line meta and Paid detail
wording differ. Not on the board: Adjustments group.

**G3 Money · owner.** Waiting-on-you rows always carry an amount → app chips on danger rows. P&L figures whole
dollars → app cents. "vs October at this point". Deposit meta/chip without cents. Not on the board: "Nothing waits
on you", "Show all", "on the computer", "Owed by carriers" group.

**G3b Partner payouts.** Title "November partner payouts". Meta "41 sold × $95 · 12 transfers × $35". Clawback row
"Clawback: 1 returned lead" + chip "Returned". Extra sentence in the note.

**G3c Vendor bill.** Due "Fri 27 Nov"; paid with "ACH · Truist ••4471". Extra Invoice row.

**G3d Bank deposit.** Short lines titled "George Patel · Advance · $128.40" → app policy number. Extra footer.

**G3e Profit & loss.** Five category roll-ups (Leads · 4 vendors, Team pay · 6 people, Dialer and phone lines,
Office and equipment, Software) → app one row per source line. "vs October at this point". Extra footer.

**G4 Approve team payouts.** Row meta "80% of advance · 14 policies", "Setter · 25 appointments" → app plan model text.
Extra "How you'll pay them" chips.

**G5 Snap a receipt.** Full-screen camera with edge-found frame, tip, Cancel / shutter / Auto → app system camera, no
edge finding, no reading. Expenses › Add opens the camera first → app opens the form first.

**G6 Add expense.** Bottom sheet over Money → app full-screen page. "Receipt read" block with filled fields and Retake
→ app typed by hand. Paid with a saved card ("Visa ••4471") → app method list. Category "Office & equipment".

**G7 My balance.** "Owed to you on 5 Dec". Row "Your share of November commission". **Row "Advance from the agency ·
Repaid in full" missing.**

**G8 Pay issues.** Board draws it as the bookkeeper's Money tab → app shows the owner Money screen there. Card line
"18 items · 4 never paid, 14 paid short".

**Server data the board needs (F, G):** Charged back chip; beneficiary and "drafts cleared"; expected ledger lines and
the agent/agency split; last-file time; file row number; lead id on a retention case; next-attempt date and "She'll
call the carrier"; reinstatement/beneficiary request kinds; win-back for the retention role, price comparison, call
attempts; five retention reasons; candidate stage/agent/policy; agency pay day and advance balance; client + line type
on short deposit lines; bank account on bills; P&L category roll-ups; payout plan % and counts; receipt reading and
saved cards.

## K · Partner app, L · Phone-only extras, M · States

| Board id | Title | App file(s) | Verdict | Severity |
|---|---|---|---|---|
| K1 | Partner home | components/partner/home.tsx | DIFFERS | med |
| K1b | Partner home · affiliate | components/partner/home.tsx | DIFFERS | low |
| K2 | Send a lead | components/partner/send.tsx | DIFFERS | high |
| K2b | Live transfer | components/partner/send.tsx (SentCard) | DIFFERS | high |
| K3 | Partner pipeline | components/partner/pipeline.tsx | DIFFERS | med |
| K3b | Partner · a lead | components/partner/lead.tsx | DIFFERS | med |
| K4 | Partner payouts (Account) | components/partner/account.tsx | DIFFERS | med |
| K5 | Partner messages | components/partner/messages.tsx | DIFFERS | low |
| K6 | Partner team | components/partner/team.tsx | DIFFERS | med |
| L1 | Home-screen widgets | widgets/* | DIFFERS | med |
| L2 | A call in progress | components/inbound/on-call-bar.tsx | DIFFERS | high |
| L3 | Shortcuts from the app icon | components/native/quick-actions.ts | MATCH | – |
| L4 | Working offline | — (no offline queue) | **MISSING** | high |
| L5 | Ask Siri or Google | components/native/intents.ts | DIFFERS | med |
| L6 | Tablet | components/native/split.tsx | DIFFERS | low |
| M1 | Loading | ui.tsx Loading, states.tsx Skeleton | DIFFERS | med |
| M2 | Nothing here yet | ui.tsx Empty, calls.tsx | DIFFERS | med |
| M3 | Couldn't load | ui.tsx Failed, states.tsx CouldntLoad | DIFFERS | med |
| M4 | Not in your plan | states.tsx NotInPlan, ui.tsx Failed | DIFFERS | med |
| M5 | Light theme | theme/tokens.ts | DIFFERS (tokens match) | low |
| M6 | Account paused | states.tsx, suspended-cover.tsx | DIFFERS | high |
| M7 | Locked after a pause | app/locked.tsx | DIFFERS (logic) | med |
| M8 | Update needed | states/update-needed.tsx | DIFFERS (never triggered) | med |

**K1 Partner home.** "You're owed · Paid on 5 Dec". Four tiles always. Latest rows say what happened ("Transferred 2:09
pm · Jordan took it", "agency is reviewing", "returned: wrong number") → app "Sent {day} · outcome". Avatar 26px; tab
pill 60px, badge position; fixed partner tab labels.
**K1b Affiliate.** Sub "Affiliate · Ellery & Fields". Earned "Revenue share". Link row "elleryfields.com/r/bp-fe · 41
referrals", titled product · channel.
**K2 Send a lead.** `history` action. **Live transfer switch actually sends a live-transfer flag** (app: does nothing).
Field order and two-column rows: First | Last, Phone, Date of birth | State, Product, Consent proof, Note. Consent proof
value "TrustedForm · 7f3c…a19e", attach the call recording.
**K2b Live transfer.** Sub "70 · AL · final expense". "Waiting for an agent to claim · 4 ready". **Single "Cancel
transfer" button** (no cancel route). Shown the moment a live transfer starts.
**K3 Pipeline.** "Returned" chip. Row meta live state ("On a call with Jordan · 2:09 pm", "Applied · at the carrier",
"Callback Fri", "Agency is reviewing"). Search as header action.
**K3b A lead.** Lines "Returned · wrong number" and billing state "Not billed · within the 7-day window". Timeline
groups attempts ("Called 3 times · 20–21 Nov"). Timeline sizes.
**K4 Account.** "Next payout · 5 Dec". Breakdown "41 sold leads × $95 + 12 transfers × $35". "Paid 5 Nov · bank
transfer". **"Payout details · Regions ••0912" and "Notifications" rows missing.**
**K5 Messages.** Pencil (new message) action. Building icon on every row. Badge size.
**K6 Team.** "Invited · not joined" + Invited chip. "sent 120 this month". **Rows open (resend / revoke)**.
**L1 Widgets.** Goal never shown (goals API unused). Push-driven refresh. Fixed dark look, radius 28, sizes, "10:30 his
time (CT)".
**L2 A call in progress.** **Android ongoing notification** → app in-app card on Calls only; dialer calls never show.
"Term life · TX · attempt 3 · disclosure read".
**L4 Working offline — missing.** Notes, outcomes and application answers save on the phone and send in order when
back; "Offline · 3 to send" chip; "Saved on this phone · sends when you're back online"; network listener.
**L5.** Spoken answer card ("Robert Chen at 11:30 … Open / Call now"); lock-screen rule.
**L6 Tablet.** Narrow list pane, compact card on the right; portrait lock prevents two panes.
**M1 Loading.** A sheen, not an endless pulse; reduced motion; six rows.
**M2 Nothing here yet.** Callbacks: calCheck, "No callbacks today", "You're clear until Thursday, 10:00 am (Patricia
Moore). Serve the next lead while it's quiet.", primary "Serve next lead".
**M3 Couldn't load.** "We couldn't load incoming calls", says what still holds ("Transfers are still being held for you
for 60 seconds").
**M4 Not in your plan.** "Retention isn't in your agency's plan", names the owner, "Your book and policies stay open as
before.", "Tell Dana" button; read the `feature_not_entitled` code.
**M5.** Appearance switch in the app.
**M6 Account paused.** Home stays readable with a "Read only" chip and a disabled Start calling; reason and who fixes it;
tabs stay visible (app covers the whole app on suspension). Partner app has no paused handling.
**M7.** Lock delay set by the agency. **App-switcher cover, never client data** (none today).
**M8 Update needed.** Never triggered (no 426 / app_update_required from any route); partner session ignores it;
over-the-air updates (expo-updates) not installed.

**Motion in the board (index.html 71, 165–170; M1):** frame first, skeleton only after 180 ms with a sheen; calm-premium
tokens 120–360 ms rises and fades, nothing endless, no glow or gradients; native pushes and sheets use the platform's
spring; one haptic on Claim, Call and Save outcome, a warning buzz when dialing is blocked; reduced motion turns every
transition into a fade. **No launch animation is drawn** — designing one is new work within these rules. Today: splash
hidden with no fade, blank canvas while starting, default stack animations, Reanimated installed but unused, endless
pulse skeletons, a light haptic on every primary press.

**Server data the board needs (K, L, M):** partner-side claimer, callback and review state; scheduled pay date; payout
breakdown; payment method and payout bank; returns and billing window; live-transfer flag, cancel route, agents-ready
count, age/state on lead detail; per-user sent counts; widget data endpoint and refresh push; outbound call state;
callback interest text; owner name in pause/plan errors and a notify-owner route; an update-required answer.

## Progress · 26 November 2026 (build round 1)

**Done (built, typechecked, 404 unit tests, seen on the emulator):**
- **Header** on every screen follows the board: large title on its own 30 px line (owner decision).
- **Homes B1–B9** rebuilt to the board: producer (This week, goal ring, mixed schedule, four tiles always),
  owner (Approve payouts with total, producers by premium dollars, Get set up card while unfinished), setter
  (ring and tiles always, Appointments you set), assistant (Your handoffs, Today tiles), bookkeeper (four tiles,
  Cash this month chart, rows waiting on others), retention (saved of worked, team average, file time, gold button
  always), manager (board row order, tiles always), Get set up (licences step, board count). Tab bar: Cases badge,
  red Inbox badge for alerts.
- **Plans:** a solo owner on a plan that sells gets Calls · Leads and the producer home; a solo Ledger owner gets
  Money · Book, a book-and-commissions home (In force, Behind, Carrier decisions, Pay issues, Carriers owe you,
  Files) and Pay issues as the Money tab.
- **Motion:** launch cover (the mark's ribbons fade in, wordmark rises, cover fades out), content rise on every
  screen, loading sheen instead of the endless pulse, reduced motion turns all of it into fades, one haptic rule.
- **States:** M2 Callbacks empty state, M3 wording on Calls.
- **Bugs:** I5 Check a number shortcut only for roles the server allows; I7 Add button floats.

**New read-only server answers:** `/api/app/home/producer`; `/api/app/inbound/handoff?mine=1`;
`/api/app/accounting/bank?deposits=`; `/api/app/retention/cases` adds `lastFileAt`, `team`; `/api/app/nav/counts`
adds `retention.save-queue`; `/api/app/setup?phone=1`; `/api/app/me` adds `plan`, `menuKeys`, `solo`.

**Needs the owner or a migration (left out, not faked):** setter Callbacks tab (server and web refuse setters);
talk time (no call lengths until a phone provider); team payouts due day; application signature status; the
books' close day; retention retry callbacks (no next-attempt date); "wrapping up" on the floor; "For Dana to
approve". The owner home's Approve payouts tile calls the payouts read, which runs the ledger sync each time.

**Next:** C Calls, D Leads, E Sales (incl. E1 Quick quote, E6b upload route), then F–J, then K–M.

## Progress · 27 November 2026 (build round 2: C Calls, D Leads, E Sales)

**Done (472 unit tests, server policy tests, seen on the emulator):**
- **Calls (C1, C7–C12):** dialer Apps figure, five ticks incl. Not a client, priority and callback chips, Lead type
  filters and Callable now; compliance list as drawn; script editing from the phone (new version); C8 "Read at",
  Interested first; reminder switch and team option in every picker; no "Later" group; callback history mixes calls
  and lead arrival. C7c: the server requires the disclosure before the dial, so it is read beside Call (the tap
  records it), and after the dial the board's screen shows with the call timer and the voicemail link.
- **Inbound, calendar, appointments (C1b–C6, C8b, C13, C13b):** named duplicate, partner's own note, three ticks;
  team grouping and "Verifying for"; lock-screen Take call / Pass and Open / Snooze buttons (server push now names
  them); partner · campaign, sent time; Continue opens the phone's own application; compound corrections; Finish
  opens Daily deal flow with the reminder line; licensed producers only, "licensed in GA"; setter role on rows.
- **Leads (D1–D10):** chips by meaning, exact lane counts, what-next card lines, long-press to Move; six tabs with
  Application, readiness checklist, lineage with cents; verifier name; licence state and reason on hand-off;
  duplicate check before saving with Open existing; Callable now filter; Same person recorded as the web's Clean
  does; vendor list from Menu.
- **Sales (E0–E7):** Needs signature, step on drafts; Quick quote screen (carriers and limits, no premiums — no
  rate tables exist); ten board steps; answers queue offline; bank details covered when leaving the app; calendar
  draft dates with Risky; Sign 10 of 10; cents on cases; Still to come rows; **E6b upload fixed** (new route);
  Written today, Unsigned.

**New / extended server reads:** dialer queue and panel, callbacks history, inbound caller and disposition,
appointments and calendar, leads list / detail / record / preflight (same person, pre-save check), quoting catalog,
requirement documents upload, push button sets.

**Needs schema, a phone provider or the owner (left out, not faked):** queue position and rotation; wrap-up state;
"Later · window opens" rows (SQL function); call lengths and answered moment; outcome and move Undo; meeting method,
place and SMS reminder on appointments; running-late note; drive time; logged emails and attachments on leads;
per-lead nurture pause/end; only-me notes; quote on a move; premium rate tables; e-sign status; detailed carrier
status; APS office phone; Android screenshot blocking and the document scanner (new dev build); setter Callbacks
tab. The dialer's "Not a client" check answers yes/no for numbers outside a narrow producer's scope (owner to
confirm).

## Progress · 27 November 2026 (build round 3: F Book & retention, G Money, H Inbox, I Team & reports, J Menu & settings)

**Done (521 unit tests, server isolation and policy tests, seen on the emulator):**
- **Book & retention (F1–F6):** Charged back chip and filter sheet; beneficiary, chargeback-window month, drafts
  cleared; ledger expected lines and the agent / agency split; cases grouped as drawn with the file time; reinstatement
  requests and this-week proofs; win-back calls and "Can't write"; five reasons on a new case; Call through the dialer
  with its checks; Log an attempt with five outcomes and a Try again date (saved on the case timeline); Needs you
  candidate lines and "Open a new policy".
- **Money (G1–G8):** pay day read from history, statements capped at 3, board meta; statement summary rows; owner Money
  in whole dollars with "at this point"; partner payouts and team payouts as drawn; bill due day; deposit lines name the
  client; P&L five roll-ups; camera-first expense as a bottom sheet; My balance with the agency advance; the
  bookkeeper's Money tab is Pay issues.
- **Inbox & chat (H1–H4):** read alerts stay listed, swipe Snooze / Read (snooze kept on the phone, as the web bell does),
  the switch always shown; new message / group from the phone, chat search, groups first; chat menu and camera attach;
  notification settings in the board's groups with editable quiet hours.
- **Team, reports & compliance (I1–I8):** team picker, "On the phone now"; producer message button and goal-passed date;
  Reports period and Book scorecards; lead-to-policy funnel with each bar opening its leads, days-to-issue bars, decline
  lists; retention scorecard by reason; consent words; complaint carrier and history; own licences; partner owed / due and
  its chat thread.
- **Menu & settings (J1–J5):** phone pages without the laptop mark ("Carrier appointments"); Appearance Dark / Light / System
  in the app; Saved for offline; two-step sign-in set up on the phone; agency time zone; sign out everywhere else; build
  number; workspace alert counts.
- **Fixed in integration:** win-back call counts scoped to the producer's visibility (AG-0.4).

**Needs schema, native modules or the owner (left out, not faked):** short carrier codes; beneficiary-change requests;
board-exact retention reasons; win-back price comparison; dialer and win-back for retention reps (the web refuses);
bank account on bills; receipt reading (no OCR) and saved cards; in-app camera / document scanner and document attach
(new dev build); "Setter · 25 appointments" pay; server-side alert snooze; partner phone; a bell row for oneself; partner
workspaces in Switch workspace; "trusted till"; talk time; number lookup (city, line type); call recordings (verbal yes);
complaint reassignment target and call history; licence photo storage; partner returns and two rates; editing working
hours on the phone; the board's gendered copy (no gender stored for contacts).

## Progress · 27 November 2026 (build round 4: K Partner app, L Phone-only extras, M States) · all 135 screens worked

**Done (584 unit tests, server isolation / policy / partner-plane tests, seen on the emulator):**
- **Partner app (K1–K6):** owed tile with its pay date; latest rows say what happened ("Transferred 2:09 pm · Jordan took
  it"); four tiles always; fixed tab labels and sizes; affiliate sub and link row; Send a lead in the board's field order
  with two-column rows, consent proof value, and the live-transfer flag actually sent; live-transfer card with "N ready";
  pipeline live meta and Returned chip; grouped attempts; account breakdown, Payout details, Notifications; new message;
  team sent counts, Invited chip, resend / remove access.
- **Extras (L1, L2, L5, L6):** widgets show the goal, fixed dark look, refresh on push; call-in-progress card for dialer
  calls too with the board's detail line and an Android ongoing notification (Outcome / Add a note / Callback);
  spoken-answer card for "next callback" with the lock-screen rule; tablet compact card and narrower list pane.
- **Offline and states (L4, M1–M8):** outbox for notes, call outcomes and application answers, sent in order when back;
  "Offline · N to send" on every header; M3 / M4 decided from the server's code with module-named plan messages; paused
  agency keeps its tabs with a Read only chip and dimmed write buttons; app-switcher privacy cover; Update needed now
  triggers from the server (`MOBILE_MIN_APP_VERSION`, off when unset; see `.env.example`).
- **Fixed in integration:** the call route reads the lead through the agency lead guard (AG-0.4); Calls shows the call card
  above every part; the dialer posts / clears the ongoing notification; push taps open the call's move.

**Needs schema, native modules or the owner (left out, not faked):** partner Cancel transfer, payout bank name and last
four, returns window and billing line, per-statement payment method, live-transfer routing on the agency side; widget
background refresh and Inter Tight figures (new dev build); a ticking call timer, Live Activity, spoken answers and
Siri intents (native); naming the owner and "Tell Dana" on plan messages; Home readable for a suspended agency (the server
refuses every read); agency lock-delay setting; Android FLAG_SECURE; over-the-air updates (expo-updates). The partner
lead detail's timeline still carries the agent's full name (the phone shows the first name).

## Overall status (27 November 2026)

All 135 board screens were rebuilt against their drawings and notes, in four rounds, with tests and an emulator look.
What remains is listed under each round's "Needs schema, native modules or the owner" and falls into four kinds:
**data the database doesn't hold yet** (talk time, e-sign status, rate tables, short carrier codes, payout bank, returns),
**native modules that need a new development build** (camera / document scanner, screenshot blocking, background widget
refresh, call timers, Siri / Google speech), **a phone provider** (call lengths, answered moment, recordings), and **owner
decisions** (setter Callbacks tab, win-back and the dialer for retention reps, gendered copy, the "Not a client" check
across producers, demo names).

## Re-audit · 27 November 2026 (six independent read-only reviewers, all 135 screens)

Each reviewer read the board entry (notes + Android drawing) and the current code, without seeing the build rounds' claims
first. "Listed-known" items (schema, native build, phone provider, owner decision) are not repeated here.

**Matches outright or except listed-known:** about 100 of 135. **Still differing:** 31. **Bugs found:** 40-odd.

### Still differing (board → app)
- **A · B:** A1 fingerprint only alerts (+ partner link); A2 email in subtitle; A3 rows not the board's (use the
  notification-prefs BOARD mapping); A5 inviter, role sentence, password strength; A7 partner portals, headcount,
  remembered choice; B2 Issued/Chargebacks tiles hide on failure; B3 ring hidden on load/fail; B4 fixed chips, retention
  cases, status chips, mono policy number; B7 "worked" still counts saved+lost; B9 alert order.
- **C:** C1 handoff row drops "(assistant)" and shows "N% done" not "9 of 12 done · 3 min ago"; C3 a fifth "already a lead"
  check; C6 "(… yours)" dropped when clocks match + extra toast; C7b no certificate id, no "this week"; C13/C1c no tab bar
  and no "Calls" back label; C13b product where the board has method.
- **D · E:** D3 no tab bar under the lead page; D8 "Show N leads" not exact; D10 back label "Menu"; E1b carrier on rows,
  footer wording, back label, answers carry-over. (D9 older owner not kept: deliberate, matches the web.)
- **F · G:** F2 extra ⓘ; F2b expected-line date meta; F3 extra "Later" group and "0 this week" chip; F3b "New bank" wording
  and "sent to" for address; F5 defaults; G3b clawback meta contradicts the "Returned" chip.
- **H · I · J:** H4 "Transfer waiting" mapped to new_lead, "Let transfers through" missing, rows dropped/extra; I3 Retention
  sparkline and "of worked", Book scorecards opens only the computer; minor H1/I1/I2/I4c/I6b/I8/J3.
- **K · L · M:** K1b link row title/URL and Earned tile; L1 no iOS widget (Android first); L5 lock-screen rule unreachable
  (`/ask` inside the signed-in guard); M6 no reason on Home for a read-only agency, most write buttons not dimmed, no partner
  pause reason; M8 four uploads skip the app-version header; motion: reduced motion still slides in sheets, RouteSheet,
  nested stacks, chat bubbles; ~15 haptics outside the rule; no buzz on a server-side dial block.

### Claimed closed but not done
Reminder switch + team option missing in three pickers (C6 Pick…, call card Callback, lead Schedule); C7b compliance list;
reduced motion "everywhere"; "one haptic rule"; L5 lock rule; privacy cover; paused-agency dimming; B2/B3/B7.

### Bugs
- **Navigation:** dead `/team` links on owner and manager homes; Calendar/appointment back with no fallback on a cold
  open; `computer.tsx` non-/app path falls back to the dashboard; inbox links ignore the role; "Appointments & setters" and
  "Calendar" both open `/calendar`; B7 "Call the next case" opens the case, not the dialer; B5 "Take the next caller"
  without the incoming part.
- **Gating:** Menu "Check a number" open to roles the server refuses; Calls shows Call when the plan has no dialer;
  win-back offered to retention reps in the Views sheet; setter label missing for managers.
- **Money:** `advance_paid` handled differently on G1 and G7; Needs you capped at 50; expense saved message lost; G2 method
  lowercased; G3 month not passed to P&L; G3d chip vs button amounts; G3e last-day "so far"; G8 dangling separator.
- **Calls:** false "Not rescheduled" when only the hand-over fails; call card books the callback in the phone's zone when the
  lead has none; script not reachable before "I read it"; "Away" chip never shown; vendor list swallows the true-cpa failure;
  push "Take call" without a work item claims the longest waiting caller.
- **Security / data:** privacy cover sits under RN modals and iOS modal screens and races on Android; the 5-minute lock
  opens with no check when biometrics are off or not enrolled; outbox items survive a cold start with "Keep me signed in" off
  and flush under the next person's token; a workspace switch flushes the old workspace's items with the new token; "Use
  password" on the lock screen discards the same person's unsent items; legacy answer keys not cleared; queued saves look like
  normal saves (`isQueued` unused); ongoing-call notification survives sign-out.
- **Other:** K2b keeps polling after the claim; Calls runs two ongoing-call pollers; the agency Welcome can flash before the
  partner app; dead `PHONE_STEPS`; stale comments (`ring-push.ts`, `team-tab.tsx`, `links.ts`).

## Re-audit fixes · 28 November 2026

Four fixers (homes/inbox/team/menu · money/book/retention · calls/leads/sales · states/security/partner/motion) plus an
integration pass fixed the re-audit list above. Checks: mobile tsc + eslint clean, jest 77 suites / 594 tests; server tsc
clean, push / route-policy / isolation / dialer-script tests 133/133. Emulator: owner Home, All 4 → Team, `/ask` locked card.

**Fixed:** dead `/team` links (and a pushed Team for an owner on the producer tabs); Check a number gated to owner/producer
with `outbound_dialing` (menu + app shortcut); inbox and search links role-aware; computer sheet for non-/app paths; setter
label for managers; B2 tiles and B3 ring always drawn; B4 search chips and policy rows; B9 order; A2 email; A3/H4 one board
mapping; A5 role sentence + strength; I3 "of worked"; paused reason on every home (incl. retention); B7 Call the next case
starts the dialer (via `/dialer/pick` → CallSheet). Money: one `advance_paid` helper, Needs you pages past 50, expense
toast, method label, month to P&L, "so far" only while open, deposit chip = lines, separator, win-back gated; F2/F2b/F3/
F3b/F5/G3b as drawn. Calls: reminder + team switches in every picker (`afterBooking`), certificate ref in C7b (server
`consentView.certificateRef`, first4…last4), back fallbacks, honest reschedule alert, no phone-zone fallback, script from
the disclosure step, `canDial` honours the plan, Away chip, vendor failure card, C1 title, C3 four ticks, C6 both clocks
and no toast, C13 back label. Queued offline saves show "Saved on this phone" and skip follow-ups. Security: lock always
checks (passcode fallback; no screen lock → Sign in), outbox tagged by user + tenant, legacy answer keys cleared, ongoing
notification dismissed on sign-out, privacy cover above sheets (Android Modal, per-layer on iOS, in every RN Modal), four
uploads through `formRequest` (M8), `/ask` outside the guard, launch cover waits for the partner session, K2b poll stops,
K1b Earned = unpaid published statements, partner paused reason, `write` on ~45 write buttons, reduced motion fades in
sheets / nested stacks / chat, haptics only at Claim · Call · Save outcome · blocked dial, one ongoing-call poller.
Server: the intake transfer alert (`new_unclaimed_lead`, Settings › Inbound "new transfer") now rings on the calls
channel with Take call · Pass.

**Still open, needs data or a server change:** C1 "9 of 12 done" (only a percentage exists); C13b method; D8 exact count
(new filtered counts on agent_leads); E1b per-product carrier and premium; K1b product · channel and short link; A5 inviter;
A7 portals/headcount/remembered workspace; H4 "Let transfers through" (quiet hours have no exception); I3 sparkline series;
I2 90 days; H1 mark unread; transfer push carries no work item; I1 chip styling, J3 rows (not done); policy number mono
(Row needs rich text). **Native build:** expo-screen-capture (FLAG_SECURE / iOS switcher protection), iOS widgets.
**Owner decisions:** B7 "worked" definition (board's own figures imply saved + lost); partner users seeing money (K1/K1b);
whether Call buttons count as writes while paused; "Appointments & setters" target (now Team activity); I5 note says
setters/assistants may check a number but the server refuses; plus the earlier list (demo names, setter Callbacks tab,
win-back/dialer for retention reps, gendered copy, "Not a client" across producers, A6 wording, J4 support promise).

## Functional test on the emulator · 27 November 2026

Demo producer in Ellery & Fields (`d6f3950f…`), Android emulator, against the local server. Test writes on demo and QA records are listed at the end.

**Built for this pass**
- **Application: Save draft, and Mark ready waits.** Review and Sign list every step before Review that is not finished. Each step is one tap away: computer steps open the exact web step, phone steps go to that step on the phone. Mark ready stays off until the list is empty, and Sign shows the list instead of the signature pad. **Save draft** sends any answer still waiting for signal, then says what is left and gives the web link to continue on (`continuePath`: the first computer step left). The web workspace shows everything filled on the phone; checked live on Rosa Sizemore's case.
- **Interview numbers are checked before saving.** A height outside 36–96 in, a weight outside 50–700 lb, or a negative count is refused (`numberRangeError`). Found live: "6464" was saved as the height, and neither the phone nor the server stopped it.
- **Transfer outcome "Callback scheduled" for a caller with no settled zone.** The phone said "book the callback from the computer". It now asks which zone, then sends `callback_timezone` with the outcome, which the server already accepts.
- **Calendar times match the callbacks list.** The calendar used the phone's zone and the list used the agent's saved zone, so a callback showed at 4:00 in one and 9:00 in the other. Both now use the saved zone.
- **Back button names the client** on Payment, the draft date, Review and Sign. It read "Back to Back".

**Passed**
- Callbacks: Reschedule (overdue 22 → 21; it lands on Mon 30 at 10:00 am their time, stored as 15:00 UTC); the reminder permission prompt; Monday's list.
- Calendar: month dots, and the day list after the fix.
- Application: quote (only appointed carriers can be picked, and the reasons show), the 5 eligibility questions, 15 health questions, medications, Finish interview, and the Review gate. Save draft, then the web shows the same answers; edited on the web, and the summary updated.
- Transfer call: caller profile, verification 6 of 6 (each saved as tapped), Continue to Application, then the outcome walk. Callback scheduled with a picked zone was stored as 30 Nov 22:00 UTC, America/Chicago. After saving, the app opens Deal flow.
- Dialer: outside the window the queue says why (NC opens 9:00 am ET), and Call on an Arizona lead is refused by the server ("not licensed in AZ").

**Not tested yet:** the dial → outcome loop in the dialer. The calling window was closed (about 5 am ET), and this producer is licensed only in NC and TN. Run it after 9:00 am ET on an NC or TN lead.

**Seen, not changed**
- The lead page chip says "Clear to call" while dialing is refused (licence, window). It is the number-screening result in the web's words; "Number clear" or folding in the licence and window would need the web changed too.
- A transfer claimed on 25 Sept and never closed kept an "on a call since 25 Sept" bar and a timer reading 1509:14:09. The app shows unclosed calls on purpose; the timer could show the date after 12 hours.
- A brief flash of a second outcome list ("How did the call end?") while an outcome question saves.
- "(11:00 pm yours)" on the transfer finish step uses the phone's zone, not the saved one; the same fix as the calendar.
- Once, the Incoming tab rendered blank (content at opacity 0) right after a hot reload. It did not come back in three tries, so most likely a dev-reload artefact.
- Bank numbers on Payment were not typed: no bank numbers, real or made up, go into production records from this side.

**Test writes (demo and QA data):**
- Callback for Minnie Hargrove moved to Mon 30 Nov, 10:00 am ET.
- Rosa Sizemore's application: Gerber Life quote ($25,000, $61.40/mo, level), eligibility, health and medication answers; height corrected to 5′4″ on the web. Still a draft.
- QA lead QAm1c Slastop7261: verification confirmed, an application case opened, and the 25 Sept transfer closed as Callback scheduled for Mon 30 Nov, 4:00 pm CT.