# Simplify the whole app (round 1, plan only)

Status: **plan and mockups, nothing built.** Written 2026-11-18. Board: [mockups.html](mockups.html), built by
[build-mockups.mjs](build-mockups.mjs) on the Settings r8 kit. The redesign canvas artifact is at its file cap
(memory: dashboards-by-role, 512 files), so this round follows roles-r1 and lives in the repo.

**Who it is for:** non-technical salespeople. Whatever they are trying to do should be obvious.
**What must not change:** every feature stays (section 8 maps each one to its new home), and the app stays premium.

Sources read: `lib/menu/definition.ts`, `lib/menu/sidebar.ts`, every `lib/*/steps.ts` (agency app and admin),
`lib/settings/sections.ts`, `lib/adminNav/build.ts`, `components/partner/partner-sidebar.tsx`,
`lib/search/actions.ts`, `docs/design/UI-CONSISTENCY.md`, `docs/qa/QA-PASS-2026-11.md`, and the memory notes
on roles, solo mode, navigation, the one-line table rule, gold and the role-dashboard and partner audits.
Usage counts: the Supabase connection listed no projects in this session, so **no usage SQL ran**. Click counts
below come from the code paths (menu → page → control), not from timing real users.

---

## 1. What is there today

| Plane | Pages (`page.tsx`) | Menu today |
|---|---|---|
| Agency app `/app` | 204 | Home + 7 areas (Work, Leads, Partners, Book, Money, Reports, Compliance) + Retention + Settings. An owner sees about 30 links, folded into 10 groups. 7 modules also have a step rail inside the page (Accounting 9, Commissions 7, Compliance 7, Carrier sync 9, Leads in 6, Retention 5, Agency 4), and Reports has 10 views. |
| Admin console `/admin` | 56 | Dashboard, Customers (Tenants, Users), and four "areas" with rails: Billing (12 pages), Catalog (15), Monitoring (6), Platform (9). |
| Partner portal `/partner` | 14 | Overview, Submit new lead, Lead pipeline, Daily deal flow, Messages. Partner admins also get Commissions, Team performance and Team access. |

**Roles:** owner (admin title), manager title, producer, setter, assistant, bookkeeper, retention; admin
super_admin, support_agent, billing_admin, platform_config; partner_admin, partner_user. **Plans:** individual (solo
mode hides team pages), agency tiers, single-module plans (e.g. Ledger only). Menu items carry `required_feature`,
`required_roles`, `teamOnly` and `AGENCY_OWNER_ONLY_KEYS`.

**Already in place (keep, don't rebuild):**
- Ctrl K search (`app-top-bar.tsx`) over leads, policies, lists, partners, pages, settings and 12 actions.
- A `New` menu (Lead, Application, Callback, Lead list, Partner, Carrier statement).
- Wizards: the application (10 steps in 4 stages), the call outcome (`disposition-wizard`), the inbound call bar
  (5 steps), Connect a vendor (4), Add a carrier (3), sign-up (5).
- 10 route sheets for "New…" (complaint, expense, vendor bill, invite producer and others).
- Guide me, but only on pages that hold a setup step.
- Hidden, not greyed, by role and plan; solo mode.

## 2. Each role's top 10 jobs, with clicks today → after

Counted from the sidebar with the right group closed. "After" uses the A picks.

### Producer (agent)
| # | Job | Today | After | How |
|---|---|---|---|---|
| 1 | Start calling | 1 (gold button on Home) or 3 (Work › Dialer › Serve next) | 1 | Home's gold Start calling stays |
| 2 | Record a call result | 4–6 (outcome list, question steps, Save) | 2 | Six big answers with keys 1–6; step 2 only when needed |
| 3 | Call back a lead that is due | 4 (Work › Callbacks › row › Call) | 1 | A Do next row's "Call now" |
| 4 | Add a lead by hand | 4 (New › Lead › form › Save) | 4 | A three-question sheet; Save and call dials at once |
| 5 | Quote a lead | 5 (Lead › Start application › verify › interview › quote) | 3 | Lead page "Start a sale"; the quote step can be reached on its own (Sales › Quotes) |
| 6 | Finish a half-done application | 4 (Work › Applications › row › step) | 1 | Do next "Continue" lands on the step |
| 7 | Answer a carrier request on a pending case | 4 (Work › Applications › Pending tab › row) | 1–2 | Do next row, or Sales › Waiting on carrier |
| 8 | See my pay | 3 (Money › Commissions › My pay) | 1 | Money opens on My pay |
| 9 | Find a client or policy | 2 (Ctrl K) or 4 (Book › Policies › search › row) | 2 | Ctrl K (unchanged), now also cases |
| 10 | Save a policy at risk | 4 (Retention › Cases › row › action) | 2 | Do next "Start save" → a 3-question sheet |

### Owner (agency)
| # | Job | Today | After |
|---|---|---|---|
| 1 | See if the agency is healthy | 2 (Home › Agency) | 1 (Home › Agency tab) |
| 2 | Import a lead list | 4 (Leads › Lead flow › Import a list › sheet) | 2 (Leads › Import a list) |
| 3 | Hand out leads | 4 (Leads › Lead flow › Route step) | 2 (Leads › Hand out) |
| 4 | Upload a carrier file | 4 (Commissions › Statements › Import › form) | 2 (Money › Upload carrier file, 4-step sheet) |
| 5 | Fix a short payment | 4 (Money › Commissions › Pay issues › row) | 1 (Do next) |
| 6 | Pay the team | 5 (Money › Commissions › Team payouts › month › approve) | 2 (Do next "Pay the team" → 3-step sheet) |
| 7 | Handle a complaint before its deadline | 4 (Compliance › Complaints › row) | 1 (Do next) |
| 8 | Invite a producer | 4 (Home › Producers › Invite › sheet) | 2 (Business › Invite someone) |
| 9 | Change the pipeline stages | 4 (Settings › Leads & calling › Pipelines & outcomes) | 3 (Settings › Leads card, or Ctrl K "pipeline") |
| 10 | Upgrade the plan | 3 (Settings › Plan & billing › Change plan) | 3 (Settings › Your business) |

### The other roles
| Role | Job | Today | After |
|---|---|---|---|
| Setter | Book an appointment for an agent | 3 (Work › Dialer, then book in the call) | 2 (Home Start calling, then key B) |
| Assistant | Take the next inbound caller | 2 (Work › Inbound › Take) | 1 (Do next "Take next caller") |
| Bookkeeper | Match a bank deposit | 4 (Money › Accounting › Bank › row) | 2 (Money › To do row) |
| Retention | Work the save list | 3 (Retention › Cases › row) | 1 (Do next "Start saving") |
| Manager | See who on my team is behind | 3 (Home › Agency › table) | 1 (Do next names them) |
| Partner | Send a lead | 2 (Submit new lead › form) | 2 (Send a lead › 2-step sheet) |
| Partner | See what happened to my leads | 2 (Lead pipeline, or Daily deal flow) | 1 (My leads; Today is a tab) |
| Partner admin | See my payout | 2 (Commissions › Coming up) | 1 (Do next or Money) |
| Admin staff | Find a customer and refund them | 5 (Customers › Tenants › row › Billing › Refunds & credits) | 3 (Ctrl K → Customer › Refund or credit) |
| Admin staff | See what is broken | 3 (Monitoring › Jobs & services) | 1 (Admin home Do next) |

## 3. Where a salesperson hesitates today

| # | Hesitation | Where | Fix in this plan |
|---|---|---|---|
| 1 | Too many places to start. 10 groups and ~30 links for an owner; "Work", "Book", "Data in" and "Carrier sync" don't say what's inside. | Sidebar | §4 menu by job, ≤ 7 items |
| 2 | Two navigations on one page: a step rail **and** a sub-page bar. People miss the bar (owner, 2026-11-09). | Accounting, Commissions, Compliance, Carrier sync, Leads in, Retention, Reports | §5 one sub-page bar; the rails go |
| 3 | Jargon: Disposition, Attribution, Discrepancies, Nurture, Card moves, Agent codes, True CPA, Persistency, Holdout, Override, Reconciliation, Servicing. Each appears in 6–26 `.tsx` files. | Everywhere | §7 renames |
| 4 | The same thing under two names, or one name for two things: "Waiting on the carrier" (Retention) vs "Pending cases" (Sales); "Lead routing" twice; "Lapse risk" under Carrier sync but worked in Retention; "Needs you" for four different queues. | Menu | §6 merges + §7 renames |
| 5 | Home doesn't say what to do next. The live Overview is one layout for every role and scrolls; `ROLE_HOMES` is computed but used only on `/app/design/home`. | `/app/dashboard` | §5 Do next per role |
| 6 | Dead ends: a role's menu link opens a "your owner does this" gate (Lead routing, fixed in the QA pass); the assistant's "Import a list" leads to a gate; empty Compliance tab for setter/assistant. | Role audit 2026-11-18 | §4 hide by role, `firstOpenable` honours owner-only keys |
| 7 | Money leaks to roles that should see counts only (manager "My recent business $", retention all in $). | Dashboards | §4 money from the `money.view` permission |
| 8 | A long form where a question would do: Add a lead, Carrier statement import, Team payouts, the partner's full submit form. | Sheets, pages | §5 wizards |
| 9 | Empty pages with no next step (say what to do; offer the button). | Lists | §5 empty-state rule |
| 10 | Guide me appears only on setup pages. | All | Guide me on every page, with "What do you want to do?" |
| 11 | Partners: affiliates can't see their links; every partner type gets the full form; pipeline names of other types leak. | `/partner` | §4 partner menu by type |
| 12 | Admin: four "Workspace" landing pages before the real page; 15 catalog pages in one rail. | `/admin` | §4 admin menu, Do next home |

## 4. The new menu, per role (pick 1)

**A · Jobs menu (recommended).** One flat list, verbs a salesperson would say. Each item opens on its first tab.
**B · Two groups.** The same items under "My work" (Home, Call, Leads, Sales, Clients) and "Run the office"
(Money, Business).

| Item | What it holds (its sub-page bar) | Owner / admin | Manager | Producer | Setter | Assistant | Bookkeeper | Retention |
|---|---|---|---|---|---|---|---|---|
| **Home** | Today (Do next) · Agency · Compare / My results | ✓ | ✓ no $ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Call** | Dialer · Inbound · Callbacks · Calendar · Chat · Floor · Setters | ✓ | ✓ | ✓ | Dialer, Calendar, Do-not-call check | Inbound, Callbacks, Calendar, Do-not-call, Consent | — | — |
| **Leads** | My leads · Board · Bring in · Hand out · Duplicates | ✓ | own team | My leads, Board | — | Leads, Board | — | — |
| **Sales** | In progress · Waiting on carrier · Issued · Quotes · Today's sales · Spot checks | ✓ | own team | ✓ (no Spot checks) | — | — | — | — |
| **Clients** | Policies · To save · Changes sent · Win back · At risk · Carrier files · To check | ✓ | own team | Policies, To save, Changes sent, Win back | — | — | Policies, Carrier files, To check (no contact details) | To save, Changes sent, Win back, At risk |
| **Money** | To do · Carrier money · Team pay · Bills & costs · Profit · More ▾ (Tax, Commission history, Lead refunds, Shared policies) | ✓ | My pay | My pay · My balance · Lead refunds | — | — | ✓ | — |
| **Business** | Team · Partners · Reports · Compliance | ✓ | Team, Reports (no $) | — | — | — | Reports, Partners | — |
| Footer | Guide me · Settings · your name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

- **Solo owner (individual plan, no other caller):** same as owner, without Floor, Setters, Hand out, Team pay and
  the Team tab. They come back automatically when a setter or agent joins (existing `isSoloWorkspace`).
- **Single-module plans:** an item shows if any of its tabs is granted, as `sidebar_fallback_for` does today.
  A Ledger-only owner sees Home, Clients, Money.
- **Hide, never grey.** Keep `required_feature`, `required_roles`, `teamOnly` and `AGENCY_OWNER_ONLY_KEYS`. Fix
  `firstOpenable`/dashboard views to honour owner-only keys, extra roles and hidden pages. Take `noMoney` from the
  `money.view` permission, not from `role === "manager"`.
- **Counts** stay on the items (gold): Call = callbacks due + callers waiting; Clients = to save; Money = to do.
- **Phone:** bottom tabs are the first four items + More.

**Admin console** (5 items, same pattern): Home (Do next: failing jobs, failed payments, trials ending, refund asks
· Revenue) · Customers (Customers, People) · Billing (To do, Subscriptions, Invoices, Refunds & credits,
Discounts, More) · Catalog (Plans, Features, Products, Carriers, Carrier files, More) · System (Jobs, Sign-ins,
Audit log, Rules, Mail, Admins, More; Monitoring + Platform together). The four "Workspace" pages become each
item's first tab. Role gates unchanged (`SECTION_ACCESS`, `buildAdminNav`).

**Partner portal, by partner type** (needs `partner_type` in `resolvePartnerContext`): Home (Do next) · My leads
(All, Need details, Sold, Today (was Daily deal flow), Drafts) · Links (affiliates only, new: reads
`affiliate_links`) · Chat · Money (admin: Invoices, Coming up) · Team (admin: People, Performance). One primary
button everywhere: **Send a lead**, a two-step sheet whose fields follow the partner type.

## 5. One page pattern, everywhere (picks 2–5)

1. **Title line:** trail, title, (i), the sub-page bar, then one primary button on the right. (As UI-CONSISTENCY
   §2/§8b today.)
2. **Sub-page bar only.** Every step rail becomes tabs on the title line: at most 6, the rest under **More ▾**.
   Settings keeps its section list, because it is a directory, not steps. *This reverses the "in one page" rails
   (2026-10-30, 11-02) and answers the question the owner left open on 2026-11-09. Pick 3.*
3. **List:** the one-line table (≤ 6 columns, one StatusChip, a verb › at the end), ToggleChips over it, the pager
   at the foot.
4. **Record page:** a status line in plain words ("Payment missed · grace ends Friday · $560 at risk"), tabs
   (Overview · … · History), and the next step as the primary button. **No side panel for reading a record**:
   `DetailPanel` uses become the record page with ‹ › between records.
5. **Overlays** (refines §11): dialog for a short edit or a call result; right sheet for a quick create or a wizard of
   ≤ 4 steps (keeps `RouteSheet`, so Back closes it); full page for a long wizard (application); toast to confirm,
   with Undo.
6. **Home = Do next.** 3–5 jobs, most urgent first, each with one button that does the job; only the top one is
   green. Snooze menu per job (later today, tomorrow, next week, done, not mine). Figures and charts sit under it.
   Uses the existing `ROLE_HOMES`/`kpiCards` and the Needs-you counts. *B: a timeline of the day in clock order.*
7. **Empty states** say what the page is for, what to do, and offer that button (6 drawn on the board).
8. **Guide me on every page.** A sheet: "What do you want to do?" lists the page's 3–5 jobs, each with short
   steps and **Show me** (runs the existing guide bar). Today's setup steps remain its first answers.
9. **Premium through restraint (unchanged rules):** glass ribbon, one gold feature button a page, calm motion
   (§18), 44px targets, one-line tables, icons always with labels, 12/14px text, light and dark.
10. **Fast for power users:** Ctrl K stays and adds cases, applications and customers (admin). Shortcut keys
    listed under `?`: G H / G C to go, N L add a lead, N S start a sale; in the dialer Space call/hang up,
    1–6 call result, S skip, B callback, M mute.

## 6. Pages that merge or move

| Today | Becomes |
|---|---|
| Home › Dashboard, Agency dashboard, Producers, Compare, Team setup | Home (Today, Agency, Compare); Producers and Team setup → Business › Team |
| Work › Inbound, Inbound team, Dialer, Callbacks, Calendar, Appointments & setters | Call (Dialer, Inbound, Callbacks, Calendar, Floor, Setters) |
| Partners › Partner chat | Call › Chat |
| Leads › Lead workspace | Leads › My leads / All leads, Board |
| Leads › Lead flow (Source, Import, Review, Clean, Route, Recycle rail) + Vendors & campaigns + List import + Lead routing (×2) + Lead recycling + Duplicate check | Leads › Bring in (sources, vendors, imports, forms), Hand out (routing, recycling), Duplicates |
| Sales › Applications, Pending cases, Quotes, Draft dates, Application review, Daily deal flow | Sales (In progress, Waiting on carrier, Issued, Quotes, Today's sales, Spot checks); Draft dates becomes a field and a step inside the application ("First payment date"), and the standalone page stays reachable from Quotes |
| Retention › Cases, Waiting on the carrier, Win-back | Clients › To save, Changes sent, Win back |
| Book › Carrier files, Policies, Commission ledger | Clients › Policies, Carrier files; the ledger → Money › More › Commission history |
| Carrier sync › Needs you, Lapse risk | Clients › To check, At risk |
| Carrier sync › Rate card, Carrier terms, Card moves, Agent codes, Files in | Settings › Clients & carriers (Commission rates, Carrier deadlines, Stage rules, Writing numbers, How files arrive) |
| Commissions (7 steps) + Accounting (9 steps) + My pay + My balance | Money (To do, Carrier money, Team pay, Bills & costs, Profit, More); producer: My pay, My balance, Lead refunds |
| Reports (10 views) | Business › Reports (cards, each opening its view) |
| Compliance (7 steps) | Business › Compliance (Overview, Do-not-call, Consent, Complaints, Delete requests, Proof pack, Licences); for an assistant or setter, Do-not-call and Consent sit in Call |
| Partners › Publishers | Business › Partners |
| Accounting settings, Retention settings, Compliance settings | Settings › Money, Clients, Calling (same routes) |
| Admin: Billing/Catalog/Monitoring/Platform workspaces + rails | Admin Billing, Catalog, System with tabs + More |
| Partner: Daily deal flow, Submit new lead (+ drafts) | My leads › Today, Drafts; Send a lead button |

Routes stay, and old paths redirect. Menu keys stay too, because team access and hidden pages store them.

## 7. Renames (pick 6; all or by row)

| Today | New | Today | New |
|---|---|---|---|
| Disposition / Call outcome | Call result | Lead flow / Lead sources | Bring in |
| Lead routing | Hand out | Lead recycling (Nurture) | Call again later (tab: Hand out) |
| Lead workspace | Leads | Pending cases | Waiting on carrier |
| Draft dates | First payment date | Application review | Spot checks |
| Daily deal flow | Today's sales | Book of business | Clients |
| Cases (Retention) | To save | Waiting on the carrier (Retention) | Changes sent |
| Win-back | Win back | Lapse risk | At risk |
| Needs you (Carrier sync) | To check | Rate card | Commission rates |
| Carrier terms | Carrier deadlines | Card moves | Stage rules |
| Agent codes | Writing numbers | Files in | How files arrive |
| Statements | Carrier statements | Pay issues | Short payments |
| Who gets the credit | Needs a name | Producer pay | Pay check |
| Team payouts | Pay the team | Commission splits | Shared policies |
| Commission ledger | Commission history | Vendor bills | Lead bills |
| Vendor returns | Lead refunds | True CPA | Cost per sale |
| Book scorecards / Persistency | Book health / Still paying | Queue scoring | Call order |
| Hierarchy & Overrides | Team structure | TCPA / DNC | Do-not-call |
| Consent locker | Consent records | Evidence report | Proof pack |
| Deletion requests | Delete requests | Carrier appointments | Licences |
| Tenants (admin) | Customers | Submit new lead (partner) | Send a lead |

Words salespeople already use stay: chargeback, override (in a tooltip), premium, carrier, inbound, callback.

## 8. Feature parity: every current page → its new home

Nothing is removed. Each row keeps its key, gate and address.

| Key | Today | New home |
|---|---|---|
| home.dashboard | Home › Dashboard | Home › Today |
| home.agency | Home › Agency | Home › Agency |
| team.producers | Home › Producers | Business › Team |
| (agency steps) compare, team-setup | Home › Agency rail | Home › Compare; Business › Team › Set up |
| leads.inbound | Work › Inbound | Call › Inbound |
| leads.floor | Inbound › Team | Call › Floor |
| leads.dialer | Work › Dialer | Call › Dialer |
| sell.callbacks | Work › Callbacks | Call › Callbacks |
| sell.calendar | Work › Calendar | Call › Calendar |
| sell.setters | Work › Appointments & setters | Call › Setters |
| leads.workspace | Leads › Lead workspace | Leads › My leads / All leads, Board |
| leads.import | Lead flow › Import (sheet) | Leads › Import a list (button) |
| leads.lists | Leads › Lead flow | Leads › Bring in |
| leads.campaigns | Lead flow › Vendors & campaigns | Leads › Bring in › Vendors |
| leads.assignments, team.routing | Lead flow › Route / Lead routing | Leads › Hand out |
| leads.nurture | Lead flow › Recycle | Leads › Hand out › Call again later |
| leads.duplicates | Lead flow › Clean | Leads › Duplicates |
| sell.applications | Sales › Applications | Sales › In progress |
| sell.pending | Applications › Pending | Sales › Waiting on carrier |
| sell.quoting | Applications › Quotes | Sales › Quotes |
| sell.draft-dates | Applications › Draft dates | Application step + Sales › Quotes › First payment date |
| team.review | Applications › Review | Sales › Spot checks |
| sell.deal-flow | Sales › Daily deal flow | Sales › Today's sales |
| retention.save-queue | Retention › Cases | Clients › To save |
| retention.payment-repair | Retention › Waiting on the carrier | Clients › Changes sent |
| retention.winback | Retention › Win-back | Clients › Win back |
| book.carrier_files | Book › Carrier files | Clients › Carrier files |
| book.policies | Book › Policies | Clients › Policies |
| book.ledger | Book › Commission ledger | Money › More › Commission history (producer: My pay) |
| book.needs_you | Carrier sync › Needs you | Clients › To check |
| retention.lapse-risk | Carrier sync › Lapse risk | Clients › At risk |
| book.setup, book.rate_card | Carrier sync › Rate card | Settings › Clients & carriers › Commission rates |
| book.carrier_terms | Carrier sync › Carrier terms | Settings › … › Carrier deadlines |
| book.card_moves | Carrier sync › Card moves | Settings › … › Stage rules |
| book.agent_codes | Carrier sync › Agent codes | Settings › … › Writing numbers |
| book.files_in | Carrier sync › Files in | Settings › … › How files arrive |
| book.statements | Commissions › Statements | Money › Carrier money › Statements |
| book.discrepancies | Commissions › Pay issues | Money › Carrier money › Short payments |
| commissions.attribution | Commissions › Who gets the credit | Money › Carrier money › Needs a name |
| commissions.producer_reconciliation | Commissions › Producer pay | Money › Team pay › Pay check |
| team.payouts | Commissions › Team payouts | Money › Team pay (Pay the team wizard) |
| team.splits | Commissions › Commission splits | Money › More › Shared policies |
| partners.payouts | Commissions › Partner payouts | Money › Team pay › Partners |
| commissions.my_pay | Commissions › My pay | Money › My pay |
| accounting.todo | Accounting › To do | Money › To do (also takes Commissions' queues) |
| accounting.invoices | Accounting › Vendor bills | Money › Bills & costs › Lead bills |
| insight.vendor-returns | Accounting › Vendor returns | Money › More › Lead refunds |
| accounting.expenses | Accounting › Expenses | Money › Bills & costs › Expenses |
| accounting.producer_splits | Accounting › Producer splits | Money › Team pay › Splits |
| accounting.my_balance | Accounting › My balance | Money › My balance |
| accounting.bank | Accounting › Bank deposits | Money › Carrier money › Bank |
| accounting.pnl | Accounting › Profit & loss | Money › Profit |
| accounting.tax | Accounting › Tax summaries | Money › More › Tax |
| partners.publishers | Partners › Publishers | Business › Partners |
| leads.partner-chat | Partners › Partner chat | Call › Chat |
| compliance.dashboard | Compliance › Overview | Business › Compliance |
| compliance.tcpa | Compliance › TCPA / DNC | Business › Compliance › Do-not-call (assistant/setter: Call) |
| compliance.consent | Compliance › Consent | Business › Compliance › Consent records (assistant: Call) |
| compliance.complaints | Compliance › Complaints | Business › Compliance › Complaints |
| compliance.deletions | Compliance › Deletions | Business › Compliance › Delete requests |
| compliance.litigation | Compliance › Evidence | Business › Compliance › Proof pack |
| book.appointments | Compliance › Licences & appointments | Business › Compliance › Licences |
| insight.sales-performance | Reports › Sales performance | Business › Reports › Sales |
| insight.activity | Reports › Team activity | Business › Reports › Activity (setter: Home › My results) |
| insight.scoring | Reports › Queue scoring | Business › Reports › Call order |
| insight.book-scorecards | Reports › Book scorecards | Business › Reports › Book health |
| insight.true-cpa | Reports › True CPA | Business › Reports › Cost per sale |
| partners.review | Reports › Partner quality | Business › Reports › Partners |
| retention.scorecard | Reports › Retention scorecard | Business › Reports › Saves (retention: Home › My saves) |
| retention.results | Reports › Retention results | Business › Reports › Saves › Results |
| team.scorecards | Reports › Producer scorecards | Business › Reports › Team |
| team.hierarchy | Reports › Hierarchy & Overrides | Business › Reports › Team structure |
| accounting.settings, retention.settings | Settings (off-menu) | Settings › Money, Settings › Clients |
| settings.root (all sections, §3 of the inventory) | Settings | Settings: nine plain-language cards (Your profile, Your business, Calling, Leads, Selling, Clients, Money, Team, Connections) + search + setup progress |
| Route sheets (10) and the New menu | as today | unchanged; the New menu gains "Upload a carrier file" and "Pay the team" |
| Admin: every page in §1 of the inventory | Billing, Catalog, Monitoring, Platform rails | Same pages as tabs under Billing, Catalog, System; roles unchanged |
| Partner: Overview, Submit new lead (+ drafts), Lead pipeline (+ record), Daily deal flow, Messages, Commissions, Team performance, Team access, Settings | | Home, Send a lead, My leads (+ Drafts, Today), Chat, Money, Team, Settings |

## 9. Wizards

| Wizard | Steps | Where | Today |
|---|---|---|---|
| Call result | How did it go? (6 big answers, keys 1–6, More results) → only if needed: when to call back / what was sold | Dialog over the call; bottom sheet on phone | Exists (`disposition-wizard`); restyle the first question |
| Add a lead | Who → How to reach them (+ consent in plain words) → What they want (More options: source, owner, pipeline, tags) | Right sheet | A form |
| Start a sale (application) | Check the client → Health questions → Quote → Application → Beneficiaries → Payment → Disclosures → Review → Submit | Full page, steps listed on the right (A) or a line on top (B) | Exists, 10 steps in 4 stages; drop the stage tabs, keep the steps |
| Save a policy | What's wrong → Why → What you'll do | Right sheet | Spread over the case page |
| Upload a carrier file | Carrier → File → What we read / what needs you → Done | Right sheet | A form on Statements / Files in |
| Pay the team | Month → Check each person → Approve | Right sheet | Team payouts page |
| Invite someone | Who → What they'll do (roles in plain words; More options: team, manager, pay plan) | Right sheet | Invite producer sheet |
| Refund or credit (admin) | Which invoice → How much and how → Confirm | Right sheet | Refunds & credits page |
| Send a lead (partner) | Who (+ consent) → What they want (fields by partner type) | Right sheet | The full form |

Every wizard: progress bar, Back always works, answers are kept (leaving says so and Home lists the job), advanced
fields behind **More options**, never removed.

## 10. Picks

1. Menu: **A** jobs menu (recommended) or B two groups.
2. Home: **A** Do next (recommended) or B day timeline.
3. Rails become the sub-page bar + More (recommended), or keep the rails.
4. Call result: **A** dialog (recommended) or B in place.
5. Application: **A** full page with step list (recommended) or B centred card.
6. Renames: all (recommended) or row by row.

## 11. Build order once picked (for later; not started)

**Overlap (2026-11-18):** the roles-r1 build (owner said "Build 1, 2 and 3") is now changing the dashboard money
leaks, the compact per-role homes at `/app/dashboard` and the partner portal by `partner_type`. It owns
`app/app/(shell)/dashboard/*`, `components/app/home/**`, `lib/dashboard/**`, `app/partner/**`,
`components/partner/**`, `lib/partnerAuth/*` and `lib/partnerLeads/*`. If Do next homes (§5.6) or the partner menu
(§4) are picked here, build them on top of what that work lands. Don't rebuild them in parallel.

1. Menu + redirects (`definition.ts` sections → 7 items, `sidebar.ts` areas, keys kept), and the `firstOpenable` /
   `money.view` fixes.
2. Rails → sub-page bar + More in `StepFrame` (one change reaches 7 modules), Settings keeps its list.
3. Do next home per role on `ROLE_HOMES`; Guide me on every page.
4. Wizards, one at a time: Add a lead, Upload a carrier file, Pay the team, Save a policy, Invite, then the restyles.
5. Renames (labels only; keys and routes unchanged), with the uiConsistency/designDocs tests updated.
6. Admin and partner menus (`partner_type` into `resolvePartnerContext` first).
