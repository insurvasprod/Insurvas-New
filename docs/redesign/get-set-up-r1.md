# Get set up · round 1: research, analysis, three directions

2026-11-12. Research and mockups only; nothing is built until the owner picks.
Mockups: [`docs/la4/mockups-r7/get-set-up.html`](../la4/mockups-r7/get-set-up.html) (open in a browser).

The owner's brief: Get set up is "one of the last things of UI UX changes, and one of the most important".
It is a walkthrough of the whole SaaS, covering only the modules the account pays for. Each kind of user
(owner, producer, setter, assistant, bookkeeper, retention, partner) gets their own setup, so each person can
set up everything by themselves. Insurvas defaults already exist to keep setup short.

## 1. What exists today

| Piece | Where | What it does |
|---|---|---|
| Setup page | `app/app/(shell)/setup/page.tsx` | "Get set up" for the owner, "Get started" for a member. One meter, then three folded groups: Start working, Get paid right, Fine-tune later. A "Find money the carriers owe you" row leads on money plans. |
| Step catalogue | `lib/dashboard/checklist.ts` | 17 owner steps and 5 member steps. Plan gating is `STEP_FEATURES` / `STEP_ANY_OF`; seats, the sign-up profile and solo mode are also applied. Each step has a minutes estimate and an (i) explaining why. Skip and done marks are stored in `tenant_setup_guide`. |
| Facts | `lib/dashboard/setupProgress.ts` | A step ticks itself from real data (carrier active, import batch done, and so on). Nothing is ticked on a click. |
| Guide bar | `components/app/setup/setup-guide-bar.tsx` | `?guide=<step>` on the real screen. It is a slim tab in the right margin that outlines the `data-guide` control and turns into "Done · next step". |
| Finish | `setup-celebration.tsx` | A one-time overlay. `setup_checklist_completed_at` closes setup for good (LA-0.3). |
| Producer checklist | AG-1.10, `lib/agency/onboardingStore.ts` | Licence, appointments, contracting and W-9 feed `can_submit`. It lives on the Producers screen and is **not** part of Get set up. |

Notion has no separate setup task beyond LA-0.3 ("Setup checklist pinned until complete … disappears once
complete and does not come back") and *Basic Idea, Individual Agent* §5 step 8 ("a checklist, not a wall;
Ray can skip any step and come back"; personalised from the business profile; the activation moment is
"You appear to be owed $X"). The member walkthrough, the module grouping and the guide bar are outside Notion.

### Gaps found in today's build

1. **Defaults are invisible.** Calling hours, disclosures, call results to stages, claim times, retention
   and compliance all work on Insurvas defaults (DEFAULTS.md). They are still listed as unchecked work in
   "Fine-tune later", so the page looks longer than the work really is.
2. **Members get almost nothing.** There are 5 steps in all. The setter has 2 and the assistant has 1. The
   retention role, agency managers and partner users have none. The producer's own licence, states and
   contracting (the things that decide whether they *can submit*) are on another screen.
3. **No idea of "ready".** Setup counts steps, but an agency wants to know: *can we dial? take transfers?
   submit? check commissions?* Insurvas already knows each of those (dial window, `can_submit`, statements).
4. **Missing steps** (from setup-walkthrough-build.md): vendor and campaign, state licences, two-step
   sign-in, a calendar, producer pay plans, a bank account, carrier field maps.
5. **No hand-off.** The owner cannot give a step to the bookkeeper or a manager.
6. **Every step leaves the page.** Short confirmations (accept the default calling hours) cost a page load
   and a guide bar.

## 2. Research (sources)

Sourced notes from a web pass plus pages read in the built-in browser (Stripe and the Shopify docs).
"Unverified" marks third-party write-ups.

| Product | Surface | Progress | Role or plan aware | Idea worth taking | Source |
|---|---|---|---|---|---|
| Stripe | Account checklist before going live | Ticks | Partly: says which items to skip for an apps-only account | Says plainly which items don't apply. A deep link opens setup at the right step | docs.stripe.com/get-started/account/checklist · docs.stripe.com/stripe-apps/patterns/onboarding-experience |
| Shopify | Setup guide on Home or a dedicated page: steps expand, can be dismissed or collapsed | "N of M steps completed", a toast on each step | Separate checklists by business type | At most 5 steps a list. Steps tick themselves. "Remind me later" for complex steps | shopify.dev/docs/api/app-home/patterns/compositions/setup-guide · shopify.dev/docs/apps/design/user-experience/onboarding |
| HubSpot | A user-guide landing page that the dashboard replaces later | — | Yes: by permission and by subscription tier, split by hub | The admin's setup (secure, invite, connect) is separate from each user's starter screen | knowledge.hubspot.com/get-started/set-up-your-account |
| Linear | About 7 quick screens, no tour, ends on a real first issue | none | Admin and member guides are separate | Learn by doing the real work | linear.app/docs/start-guide |
| Notion | Sign-up questions, then a Getting Started page that is itself a checklist | Ticks on the page | By role and by solo or team | The checklist is the product | goodux.appcues.com/blog/notions-lightweight-onboarding |
| Intercom | A checklist in the Messenger (launcher) | Steps resolve from events. Confetti at the end | Duplicated per audience | A step done at **company level** counts for everyone. Each step has a time estimate | intercom.com/help/en/articles/6661022 |
| Gusto | Company setup, then a checklist per new hire | — | Contractors vs W-2 | Each new hire has their own list | support.gusto.com (snippet) |
| Rippling | A 7-field assistant, then a 15-step checklist in sections | Steps unlock in order | Company · Bank · People · Payroll | Fields are pre-filled from sign-up. Separate steps to invite other admins | rippling.com/en-AU/blog/how-to-sign-up-for-rippling-payroll |
| Salesforce SLDS | Setup Assistant, welcome mat, docked prompts, empty states | Per prompt | By audience | Which kind of help fits which moment. Avoid "pop-up-alooza" | lightningdesignsystem.com/guidelines/user-engagement/overview |
| Attio | A setup playbook in 5 phases | "0 / 4" per phase | By use case | Phases run from structure to people. The team learns where data lands, not how it was set up | attio.com/setup |
| ClickUp / monday | Persona questions at sign-up | — | Solo hides team features | Hide what doesn't apply (Insurvas solo mode already does this) | third-party, unverified |
| Pendo | Resource-centre onboarding module | Per guide | By segment | A launcher that is always there | support.pendo.io/hc/en-us/articles/14600804167067 |
| GoHighLevel | A per-plan "snapshot" plus a chosen first-login screen (wizard, welcome or checklist) | — | Per plan | Configuration done for you, by plan | unverified |
| Close | Product guide; connect email and calendar first; white-glove setup | — | Teammates on a trusted domain join themselves | A real prerequisite with lead time (A2P 10DLC) is shown | help.close.com/v1/docs/setup-implementation |
| Insurance CRMs: EZLynx, Applied Epic, AgencyZoom, Insureio, Radiusbob, Ringy | Mostly human onboarding: kickoff calls, webinars, import specialists | — | AgencyZoom's bootcamp has an admin-only part | Order matters: upline before downline, contracting before commissions. CSV import first. "We'll do it" offered on imports | ezlynx.com/why-ezlynx/onboarding-support · insureio.com/services/onboarding · help.radiusbob.com/en/articles/2988754 · support.agencyzoom.com/en/articles/5197909 |

**Numbers.**

- Checklist completion averages 19.2% (median 10.1%) across 188 companies. FinTech and insurance score
  highest, at 24.5%; CRM and sales score 13.2% (userpilot.com/blog/saas-onboarding-benchmarks).
- Tours that users start themselves complete at 64%, against 33.5% for all tours. Completion falls after 4
  steps (chameleon.io/benchmark-report-24).
- Appcues advises 6 items or fewer, ticked by the action, and one list per persona
  (docs.appcues.com/checklists/checklist-best-practices).
- Endowed progress: 34% finished a card that started with 2 stamps pre-filled, against 19% for an empty
  card (Nunes & Drèze 2006, read from secondary sources).
- NN/g: people who read tutorials showed no gain, so help belongs in context and in empty states
  (nngroup.com/articles/mobile-tutorials, …/empty-state-interface-design).

**What we take from it.**

1. Tick a step from real data (we already do).
2. Count defaults as done, honestly, with a Review link. This is endowed progress without faking anything.
3. Keep about 5 items to a group.
4. Build the list from plan × role, and hide what doesn't apply.
5. Give the owner and each member a separate list.
6. Use a path people start themselves, not a pop-up tour.
7. Let people defer a step without losing it.
8. Each step is one action on the real screen, with a time estimate.
9. Show waiting states that have real lead time (carrier contracting, appointments).
10. Empty states are the second layer.
11. Offer "hand it to someone" or "we'll do it".

Nobody in the insurance category ships an in-app setup that knows plan and role. That is the gap to own.

## 3. Analysis

### 3.1 What gets an agency selling, in order

| # | Capability (what the agency can do once it's set up) | Steps it needs | Default that covers part of it |
|---|---|---|---|
| 1 | **Sell the right products** | Carriers and contract levels → states and appointments → products | Products switched on from sign-up's "What do you sell?" |
| 2 | **Get leads in** | Publishers (transfers) or vendors and campaigns (lists) → first import | — |
| 3 | **Dial and take calls** | Caller phone, calling hours, disclosures, call results to stages, transfer claim times | Hours 9–8 lead-local with no Sundays, Insurvas disclosures, same-name routing, the SLA ladder, DNC scrub always on |
| 4 | **Submit applications** | Each producer's licence, states, contracting and W-9 (`can_submit`) | Insurvas underwriting, quote and field-set templates (FE and Term) |
| 5 | **Get paid right** | Book import → first carrier statement → producer pay plans → bank account | — |
| 6 | **Run the team** | Invite people → hierarchy and comp levels → lead routing | — |
| 7 | **Keep it** | Retention rules, record keeping | Retention bands and compliance retention defaults |

Capability 1 blocks everything. Capability 3 is mostly done by defaults: the owner only has to **confirm**.
Capability 4 is the one people miss, because it sits on another screen today.

### 3.2 By module (only what the plan pays for)

- **Ledger (money only):** 1 (carriers, states) → 5. No leads, no dialing, no team.
- **Outbound:** 2 (vendors, campaign, import) and 3 (hours, disclosures, results).
- **Inbound:** 2 (publishers) and 3 (claim times). If transfers come in, the inbound team needs routing.
- **Applications:** 4, plus a disclosures review.
- **Book / Commissions / Carrier sync:** 5.
- **Retention:** 7 (rules, on defaults). **Compliance:** 7 (record keeping, on defaults).
- **Accounting:** bank account and invoice tolerance (on default).
- **Agency (team_hierarchy):** 6 (hierarchy, comp levels, pay plans).

### 3.3 By role

| Who | Their setup (own list, ≤ 6 rows) | "Ready" means |
|---|---|---|
| Owner, agency plan | Capabilities 1–7 for the modules bought; can hand any step to a manager or bookkeeper | The agency can dial, take transfers, submit and check commissions |
| Owner, solo agent | 1, 2, 3, 4 (their own licence), 5. No team, no routing, no hierarchy (solo mode) | "You can dial" plus "you can submit" plus "statements checked" |
| Agency admin / manager | Whatever steps the owner handed them, plus their own profile | Their handed steps are done |
| Producer | Profile and two-step sign-in → licence and NPN → states and appointments → contracting and W-9 (owner approves) → calendar → first call or transfer → first application | Can dial · can submit |
| Setter | Profile → first call → book an appointment for a producer → callbacks | Can dial |
| Assistant | Profile → claim a transfer → calendar | Can take transfers |
| Bookkeeper | Profile → bank account (if handed) → review a statement → ledger | Statements checked |
| Retention | Profile → save-queue rules (read) → work a first case | Can work cases |
| Partner user (portal) | Their team → submission setup → send a first lead or transfer → chat | Can send leads |

### 3.4 Navigation

- **A separate page** gives one place to see it all. It needs a way back from each screen; today's guide
  bar already does that.
- **A side panel** (launcher) keeps context and is good for short confirmations. It is cramped for carriers
  or imports and adds chrome to every page.
- **Inline tours** are banned by our rules (no explainer cards) and the evidence is weak (NN/g, Chameleon).
- **The mix that fits Insurvas:** one dedicated page as the spine. Short things (confirm a default, invite,
  pick carriers) are done **in place** on that page or in a dialog. Long things (an import, the hierarchy)
  open the real screen with the guide bar. Empty states on every page link back.

## 4. The three directions

- **A · Checklist page.** Today's page done right. A one-line table of steps, with the parts of setup as the
  sub-page bar. Defaults show as "On defaults" and count as done. Each row opens the real screen with the
  guide bar; ⋯ gives Hand to… / Skip / Review default.
- **B · Setup panel.** A "Set up · 7 left" button on the title line of every page opens a 420px panel.
  Short steps are done inside the panel; long ones open the screen and the panel stays open. No dedicated
  page apart from a list view.
- **C · Ready-to-sell path.** A dedicated page with a rail of capabilities ("Sell the right products · Get
  leads in · Dial and take calls · Submit applications · Get paid right · Run the team"). Each capability
  shows its steps as one-line rows with inline confirmation for defaults; the rail shows Ready / 2 to do.
  "All steps" is a tab (A's table). Long steps use the guide bar. A member's path is the same frame with
  their capabilities.

## 5. Critique and recommendation

| | A · Checklist page | B · Setup panel | C · Ready-to-sell path |
|---|---|---|---|
| Fits UI-CONSISTENCY | Yes: PageHeader, ViewTabs, TableCard | Partly: a panel on every page, plus a new button on every title line | Yes: StepFrame + rail (as in Commissions/Accounting), title line, one-line rows |
| Defaults shorten it | Yes, as rows that are already done | Yes | Best: one "Looks right" for a whole capability |
| Says "can I sell yet?" | No, only counts | No | Yes: the rail is the readiness |
| Role and plan aware | Yes | Yes | Yes, and members see their own capabilities |
| Clicks to confirm defaults | 1 per row (dialog) | 1 per row in the panel | 1 per capability |
| Heavy steps (import, carriers) | Real screen + guide bar | Real screen; panel too narrow | Carriers in place; import on the real screen + guide bar |
| Build size | Small (reuses today's catalogue) | Medium (a new panel in the shell, quick forms) | Medium-large (frame, capability model, in-place carrier list) |
| Risk | Feels like a to-do list; low completion (benchmarks 10–25%) | Clutters every page; mobile is a sheet | Duplicates some settings forms unless the forms are shared components |

**Recommendation: C, with A's table as its "All steps" tab and the existing guide bar for long steps.**

- It answers what an owner actually asks ("can we dial yet?").
- It turns the defaults into one confirmation per capability.
- It brings the producer's `can_submit` checklist into their own setup.
- It reuses the StepFrame the money areas already use.

What C needs that today lacks:

- a capability model over the step catalogue;
- "On defaults" as a fact (no agency value saved);
- a "Hand to" mark per step;
- member lists for setter, assistant, bookkeeper, retention and partner users;
- the producer's AG-1.10 items as setup steps.

Open questions for the owner:

1. Does finishing Get set up still hide it for good (LA-0.3), or does it stay as "Ready" under Home?
2. Does handing a step to someone send them a bell alert and add the step to their list?
3. Does a partner user's setup live in the partner portal (recommended) or in the agent app?

## 6. Round 2 (owner, 2026-11-12): C picked, grown into three phases

The owner said: "I really like how you think about ready to sell path." They want setup to cover the rest of the
company's configuration and a first-visit walkthrough too, organised as phases. Mockups: section **R2** of
`docs/la4/mockups-r7/get-set-up.html`.

| Phase | Owner (agency) | Member (e.g. producer) | Counts toward "ready" |
|---|---|---|---|
| 1 · Ready to sell / Ready to work | C's capabilities | Their own capabilities (C·5, C·6) | Yes, the only phase that does |
| 2 · Run it your way / Your preferences | Every Settings area the plan owns (`lib/settings/sections.ts`), each "On defaults" until reviewed or changed. The Settings section is embedded; "Looks right · next area"; Mark all reviewed | Time zone, languages, notifications, quiet hours, calendar, working hours, two-step sign-in | No |
| 3 · Learn Insurvas / Learn your pages | One walkthrough per module bought, plus **Your team's setup** | The pages their role's menu shows | No |

- **First-visit walkthrough:** each page plays a ≤5-step tour the first time each person opens it. It is
  remembered per page per person and can be replayed from the page's (i) › Show me around or from Phase 3. Two
  styles are drawn for the owner to pick:
  - **R2·3, the side-tab guide:** today's guide bar, which fits the rules.
  - **R2·4, a pointer tour:** a Popover plus dimming. It needs an exception in UI-CONSISTENCY §3 and in
    `noNoticeCards.test.mjs`.
- **Reports › Team setup (R2·6, R2·7):** shown on agency plans to the owner, admins and managers (a manager sees
  their downline).
  - Tabs: Everyone, Not finished, Blocked on you.
  - A figure strip: Invited, Finished, In progress, Not started, Blocked on you.
  - One row per person: Person, Role, Ready to work chip, Setup N of M, Last active, and the next step
    (Approve, Nudge or Resend invite).
  - A row opens a read-only Dialog 2xl showing the person's three phases. Nudge sends a bell alert and email
    after a dialog or confirm. Hidden on solo plans.
- **Solo (R2·9):** three phases with no team rows; Phase 2 lists only the settings the plan owns.

Still open for the owner:

1. Which walkthrough style: R2·3 or R2·4?
2. Does finishing Phase 1 still hide Get set up from the sidebar (LA-0.3), with phases 2–3 reachable from Home
   and the (i)?
3. Should Nudge email as well as raise a bell alert?

## 7. Round 3: guided setup (owner, 2026-11-12)

**Owner's critique of round 2:** "too tabley", "so many clicks", "no redirection on what to do next". When he clicks
*Add your carriers* and lands in Settings, it should walk him through it: click this first, then this, then do this.
Every step should work this way. Mockups: `docs/la4/mockups-r7/get-set-up.html#r3`.

**What changes**

- **Get set up home** has no tables and no tabs. It has one *Next step* panel with **Start ›**, and below it the
  three phases as a plain path, one line per step with its minutes. Done steps fold into one line. Clicking any line
  starts that step.
- **Guided mode.** Start opens the real page. Under the title line sits a setup bar: "Setting up · Step 9 of 17 ·
  Add your carriers", with move pips and *Exit setup*. The page dims except for one control, and a coach beside it
  names that control in bold, using the page's own label.
- **The guide moves on when the person does the action**, so there is no Next button. It detects a click on the
  target, a dialog opening, a field losing focus, a route change, or the step's own fact flipping (`setupProgress.ts`).
  The only buttons are on check-only moves (*Looks right*) and on optional fields (*Skip this*). Errors are pointed at
  where they happen.
- **Done goes straight on.** A toast plus "Done · Next: <step> ›" opens that page with its guide running, so the person
  never has to come back to Get set up.
- **The same guide everywhere.** "Guide me" sits in every page's (i) menu, and a first visit to a page offers it once
  in a toast. This settles R2's walkthrough choice: the pointer style wins, now guiding real work.
- **Kept from R2:** the three phases, with only phase 1 counting toward "ready", and Reports › Team setup.

**Storyboards drawn (R3·1 full size, R3·2 small frames).** All labels were read from the components on 2026-11-12.

| Step | Moves (real labels) |
|---|---|
| Add your carriers | Start set-up › tick carriers › Level / Writing number (optional) › Next: Set Up States |
| Add your states | Open set-up › a state tile › tick carriers › Finish set-up |
| Connect your phone number | Business phone › Partner support email/phone (optional) › Save changes |
| Add your publishers | Add publisher › Company name, What they do for you › How you pay them › Add publisher |
| Invite your team | Invite someone › Name, Email › Role › Invite teammate |
| Create a campaign | New Vendor › Add vendor (only if none) › New Campaign › Vendor, Name, spend › Create campaign |
| Import your leads | Into › Choose a file › Columns, Looks right › Continue to Review › Import N leads |
| Assign leads | Edit rules (optional) › Hand out N now |
| Calling hours | Earliest/Latest › No Sunday / holidays › Save changes or Looks right |
| Call results | Set up on Sales pipeline › Outcomes › an outcome's Lead stage (optional) › Save changes |
| Disclosures | Open a document › Try a case (optional) › Add a document (optional) › Looks right |
| Claim times | The ladder › Who gets the next transfer › Save changes |
| Import your book | Bring it in › drop file › Date on the file, Upload › next carrier |
| First statement | (dialog auto-opens) file › Carrier, Period › Policy number, Amount › Import N lines for review |
| Retention | Radar › The save queue takes › choice › Save |
| Compliance | Records › a record (optional) › Add a rule (optional) › Looks right |
| Accounting | Bills & expenses › Flag a bill that differs… › More than › Save |
| Hierarchy | More › Change a manager › Producer, Reports to, From › Save |
| Producer (AG-1.10) | licence › appointments › W-9 and contracting handed to the owner |
| Owner approves | level and writing number › Upload W-9 › Approve |
| First call / outcome / caller | Serve next lead › DNC check › I read this disclosure › Start call · Outcome tile · Start taking calls › Take this call |
| Phase 2 areas | per area: point at what Insurvas set › change or Looks right › recorded in Settings history |

**Found while reading the pages (fix in the build)**

1. `#carriers` doesn't open the carrier set-up. The guide must start at `#carriers/carriers-setup`.
2. "Connect your phone number" anchors to Partner support phone. The business line is `identity-phone`.
3. A producer can't complete her W-9 or contracting rows (owner-only). Her guide hands them to the owner as a bell item.
4. These steps have no `data-guide` target yet: statement, book, retention, compliance, accounting, hierarchy, states,
   disclosures and phone. The guide needs one per move, not one per step.

**Rule it needs:** an exception in UI-CONSISTENCY §3 ("a guide the person started, pinned to one control, always
exitable"), plus a matching allowance in `lib/design/noNoticeCards.test.mjs`.

**How a build would work:** extend `components/app/setup/setup-guide-bar.tsx` from one target per step to an ordered
list of moves per step (`{target, say, advanceOn}`) next to `STEP_FEATURES` in `lib/dashboard/checklist.ts`. Reuse the
existing `?guide=` handoff and `tenant_setup_guide` marks. The setup bar and coach replace the side tab.

**Still open:** whether finishing phase 1 hides Get set up (LA-0.3), and whether Nudge also sends an email.

## 8. Round 3.1: required only for Ready to sell, plus Learn (owner, 2026-11-13)

**Owner:** the walkthrough is mandatory only for Ready to sell. Phases 2 and 3 are optional. He also wants a new
docs-style page, like Vercel's docs. It isn't product documentation: it helps people get set up in insurance, has a
place for a video on every topic, and reads page by page as you scroll. He picked "guide always on, no skip" and
"inside the app".

**Required (phase 1, Ready to sell / Ready to work):**
- Every step always opens guided.
- There's no "Skip this step", only Pause. Pause keeps your place and shows Resume.
- "Skip this" stays only on a single field the form marks optional, such as a writing number.

**Optional (phases 2 and 3, "Guide me", first-visit offer):**
- The guide offers "Skip this area" and "Stop guide".
- The first-visit offer shows on optional pages only.
- Nothing optional ever counts toward "ready".

**How a paused required step keeps asking (R3·3b):**
- the sidebar count on Get set up;
- a Resume chip on the paused step's title line;
- the Next step panel;
- one toast a day at sign-in.

Nothing new is locked. "Finish Ready to sell first" appears only where Insurvas already refuses today: no disclosures
means no calls, and no licence or contracting means no application.

**Learn (`/app/learn`, R3·5):**
- **Layout:** in the app shell, with the title line plus ⌘K search, and three columns: chapter/page nav, reading
  column, "On this page".
- **Scrolling:** each page has its own URL. At its end a Next band appears, and the next page loads underneath, so
  scrolling carries straight on. The nav, TOC and URL follow the page at the top. Back and refresh behave per page.
- **Page anatomy:**
  1. Breadcrumb, title, and read/watch time.
  2. One video slot.
  3. Short sections.
  4. Key terms.
  5. "Do it in Insurvas" (starts that step's guide), or "Done in your agency" (who and when).
- **Video slot data:** `{key, title, videoUrl?, chapters?, transcript?}`, keyed per page (e.g. `setup.pipelines`).
  Insurvas staff attach videos. Until then the slot shows "Video coming".
- **Chapters (draft copy, owner to check the facts):**
  1. Getting into insurance
  2. Getting contracted
  3. Set up Insurvas to sell (one page per Ready to sell step, keyed to `checklist.ts`)
  4. Selling within the rules
  5. After the sale
  6. Running an agency (agency plans only)
- **Handoff (R3·5g):** Learn → the real page with the guide ("Step 9 of 17 · from Learn") → Done offers "Back to
  Learn".
- **No callout boxes.** Tips are plain sentences.

**Build notes:**
- Pages are content files: MDX or a typed list next to `checklist.ts`, so the "Set up Insurvas" chapter can't drift
  from the steps.
- Search covers Learn pages, Insurvas pages with a guide, and key terms.
- The required/optional flag is the step's phase, so no new column is needed.
