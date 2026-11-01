# Tasks: Partner portal — Daily deal flow

Plan: [plan.md](plan.md). Decisions, the access rule and the page design live there; this file is
what to do, in order.

**Access, in one line:** nothing changes. A partner admin sees the whole partner organisation, a
partner user sees only what they submitted, and this page calls the same `effectiveCloser` /
`canSeeLead` Pipeline already calls.

**Standing bar for every task** — it is not done until all of these hold:

- `npm test` passes. Baseline on this checkout is **3480 tests, 3460 pass, 20 fail**; those 20 are
  pre-existing SQL-text assertions against migration files checked out with CRLF endings. No task
  may add a twenty-first.
- `npm run lint` and `npm run build` are clean; `npx tsc --noEmit` reports 0 errors.
- `git diff --stat` shows no whole-file rewrite on an edited file (line endings).
- Nothing new in `lib/design/uiOffenders.json`. The baseline only goes down.
- Anything visual is checked on its `/design` preview at **1536×826**, 1366×657 and 375 wide, on
  the worktree's dev server at **localhost:3000**.

---

## Phase 1: The read

### Task 1: The partner deal-flow service — **done, 1 Nov**

**Description:** One day of `deal_flow` for one partner, under the portal's existing access rule,
with an explicit partner-safe select list (plan D1, D2, D3).

**Acceptance criteria:**
- [ ] `listPartnerDealFlow(tenantId, partnerId, { day, filters }, access)` returns rows, the four
      figures, and the filter options.
- [ ] Scoping comes from `effectiveCloser(access, filters)` — imported from
      `lib/partnerLeads/scope.ts`, not reimplemented. A null (admin) applies no closer filter; an
      id applies `.eq("agent_leads.created_by", id)`.
- [ ] The select list contains no agency-internal column: no `notes`, `worked_by`, `buffer_agent`,
      `campaign_*`, `vendor_name`, `source`, `disposition_by`, `tracking_id`, `submission_id`,
      `manual_entry`.
- [ ] `day` is matched against `deal_flow.local_date` in the partner organisation's timezone.
- [ ] Any value taken from lead `values` passes through `maskSensitiveValues`.

**Verification:**
- [ ] Tests pass: `node --experimental-strip-types --test lib/partnerDealFlow/*.test.mjs`
- [ ] A test at a fixed instant in `Pacific/Honolulu` proves the day boundary is local, not UTC
- [ ] A test asserts the select list against a literal allow-list, so a new column cannot be added
      by accident

**Dependencies:** None

**Files likely touched:**
- `lib/partnerDealFlow/types.ts`
- `lib/partnerDealFlow/service.ts`
- `lib/partnerDealFlow/service.test.mjs`
- `lib/partnerDealFlow/localDay.test.mjs`

**Estimated scope:** Medium

---

### Task 2: The API route — **done, 1 Nov**

**Description:** `GET /api/partner/deal-flow`, open to both roles, read-only, with a CSV variant for
the day.

**Acceptance criteria:**
- [ ] `requirePartner()` with no role list — both roles may read; `effectiveCloser` does the
      narrowing, exactly as on the pipeline route.
- [ ] `?partner_id=` that is not the caller's returns 403, as the pipeline route already does.
- [ ] `?day=` accepts `YYYY-MM-DD`, defaults to today in the partner's timezone, and rejects a
      future day.
- [ ] `?submitted_by=` narrows for an admin and is ignored for a partner user (that is
      `effectiveCloser`'s existing promise, not new code).
- [ ] `?format=csv` returns the same rows as the page, with the same columns.
- [ ] There is no POST, PATCH or DELETE on this route.

**Verification:**
- [ ] Manual check: `curl` the route signed in as each role and diff the row sets
- [ ] A request with another partner's `partner_id` returns 403
- [ ] `npm run build`

**Dependencies:** Task 1

**Files likely touched:**
- `app/api/partner/deal-flow/route.ts`

**Estimated scope:** Small

---

### Task 3: Isolation tests for the new read — **done, 1 Nov**

**Description:** The same protection `lib/partnerLeads/isolation.test.mjs` gives Pipeline, for this
page — so a change that weakens it fails the build instead of being noticed by a partner.

**Acceptance criteria:**
- [ ] A partner user's request with `?submitted_by=<a colleague>` returns their own rows only.
- [ ] A request with another partner's `partner_id` is refused.
- [ ] The service is asserted to import `effectiveCloser` / `canSeeLead` rather than deciding
      access itself — the drift this guards against (plan D1).
- [ ] The select-list allow-list test from Task 1 is referenced here so the two cannot drift.

**Verification:**
- [ ] Tests pass: `node --experimental-strip-types --test lib/partnerDealFlow/isolation.test.mjs`
- [ ] `npm test` — still exactly 20 failures

**Dependencies:** Task 2

**Files likely touched:**
- `lib/partnerDealFlow/isolation.test.mjs`

**Estimated scope:** Small

---

### Checkpoint A: the read is correct and cannot be widened — **passed, 1 Nov**

- [x] Both roles return the right rows, proved by test, not by eye — the service calls
      `effectiveCloser` and a test asserts it never branches on the role itself
- [x] No agency-internal field is reachable through the route or the CSV — the select string is
      built from `PARTNER_DEAL_FLOW_COLUMNS`, and a test names the fourteen columns it excludes
- [x] `npm test` 3513 / 3493 pass / **20 fail** (unchanged, all pre-existing); `eslint` clean,
      `tsc --noEmit` 0 errors, `npm run build` exit 0

**Built beyond the task list, because the figures needed it:** `localDay.ts` (10 tests) and
`figures.ts` (13 tests) are pure modules split out of the service so the day boundary and the four
cards' arithmetic can be tested at a fixed instant without a database. `PartnerDealFlowPayload`
also gained `capped`, because figures computed over a truncated read would be silently wrong.

**One design change from the plan:** the "In progress" card's age runs from the **lead's
submission** to the day on screen. The plan borrowed "oldest in progress" from the agency page,
which measures over a date range — on a single day that is always nought. A deal worked today on a
lead sent five days ago is five days old, which is the fact worth showing.

---

## Phase 2: The page

### Task 4: Route, page and sidebar entry — **done, 1 Nov**

**Description:** The page shell and its way in. No data rendering yet beyond the header — this task
is the frame, so the next one is purely the workspace.

**Acceptance criteria:**
- [ ] `/partner/deal-flow` resolves the partner context and redirects to `/partner/login` without one.
- [ ] Both roles reach it; no role redirect.
- [ ] "Deal flow" appears in the sidebar's workspace group between Pipeline and Messages, with
      `ClipboardList`, in the drawer and the desktop rail alike.
- [ ] One `PageHeader`, title "Daily deal flow", description behind the (i).

**Verification:**
- [ ] `npm test` (`sidebarLook`, `designDocs` and `uiConsistency` all run)
- [ ] Manual check: the nav item is active on the page and on nothing else

**Dependencies:** Task 2

**Files likely touched:**
- `app/partner/(portal)/deal-flow/page.tsx`
- `app/partner/(portal)/section-page.tsx`
- `components/partner/partner-sidebar.tsx`
- `app/partner/README.md`

**Estimated scope:** Small

---

### Task 5: The workspace — **done, 1 Nov**

**Description:** The page itself. **Rebuilt 1 Nov on the agent page's design** (owner: "exactly the
same design as the agents site") — `components/app/deal-flow-workspace.tsx` is the reference.

**Acceptance criteria:**
- [x] ~~Day stepper~~ → the agent's two `<input type="date">` and Today button, both capped at
      today (verified: `max="2026-11-02"` on both).
- [ ] One `StatRow` of four `StatCard`s: Deals worked, Won (money as the fact), In progress
      (`tone="warn"` when the oldest is ≥ 2 days), Lost.
- [ ] One `TableCard`: Customer, Product, Stage, Carrier, Monthly premium, Draft date,
      Submitted by (admin only), Updated — with `Pager` in the footer and `useFittingPageSize`.
- [ ] Customer links to `/partner/pipeline/[leadId]`. No detail panel on this page.
- [x] `FilterPanel` closed by default: Status, Product and — for an admin — Submitted by, with
      `ActiveFilters` chips under it, as the agent arranges them. ~~Stage ToggleChips~~ dropped;
      the stat cards' **Show** actions narrow instead, as on the agent page.
- [ ] Money right-aligned with `tabular-nums`, `$1,284.00`; the annualised figure is named as such.
- [ ] Export CSV is the header's only action.
- [ ] Under 768px rows become cards, matching Pipeline's existing card.

**Verification:**
- [ ] Manual check on `/design/deal-flow` at 1536×826, 1366×657 and 375 wide
- [ ] `npm test` — no new `uiConsistency` offender, no `raw-table`, no `hand-pager`, no hex colour
- [x] The table is the agent's: `st.table` inside a `TableCard` (the `raw-table` ratchet is
      waived inside one), 40px head, 44px rows, `PremiumBar` in the premium column
- [ ] Keyboard: the date inputs, the filter menus and the pager are all reachable and labelled

**Dependencies:** Task 4, Task 7 (the preview is how this is checked — build them together)

**Files likely touched:**
- `components/partner/partner-deal-flow.tsx`
- `components/partner/lead-format.ts` (reuse, extend only if needed)

**Estimated scope:** Medium

---

### Task 6: Every state — **done, 1 Nov**

**Description:** The states this page can actually reach, each said in words rather than shown as
an empty table.

**Acceptance criteria:**
- [ ] Loading: `PageLoading` first, `SectionLoading` inside the card on a day change.
- [ ] Empty day: "Nothing worked on <day>." with the line about leads appearing once worked.
- [ ] A partner user who has never submitted: the same frame with a link to Submit lead.
- [ ] Filters match nothing: `NoMatches` with a clear action.
- [ ] Read failed: `ErrorState` with retry.

**Verification:**
- [ ] Each state reachable on `/design/deal-flow?state=…`
- [ ] `npm test`

**Dependencies:** Task 5

**Files likely touched:**
- `components/partner/partner-deal-flow.tsx`
- `lib/partnerDealFlow/fixtures.ts`

**Estimated scope:** Small

---

### Task 7: Fixtures and the `/design/deal-flow` preview — **done, 1 Nov**

**Description:** The dev database holds one lead, so without sample data "verified" only ever means
"the happy path with one row". Same seam as `/design/pipeline`.

**Acceptance criteria:**
- [ ] `/design/deal-flow` renders in the real partner frame, development only (`notFound()` in
      production).
- [ ] `?role=partner_admin|partner_user`, `?state=busy|quiet|empty|error`, `?day=`.
- [ ] The component neither fetches nor polls when a preview is supplied.

**Verification:**
- [ ] Every combination renders at 1536×826 and 375 wide
- [ ] `npm test` (`designDocs` checks the preview's links)

**Dependencies:** Task 1

**Files likely touched:**
- `app/design/deal-flow/page.tsx`
- `lib/partnerDealFlow/fixtures.ts`

**Estimated scope:** Small

---

### Checkpoint B: the page works end to end — **reached on previews, 1 Nov**

- [x] A partner user sees only deals on leads they submitted — on `/design/deal-flow?role=partner_user`
      the figures drop from 9/3/3/3 to 3/1/1/1 and the "Submitted by" column is absent (checked with
      `find`, which matched only the stat card's "Oldest submitted")
- [x] A partner admin sees the organisation's, as they do on Pipeline
- [ ] Changing the day changes the rows and the figures together — **not verified.** The preview is
      a fixed sample day; the date inputs' fetch path only runs signed in. Task 9.
- [ ] The CSV matches the table — **not verified**, same reason. Task 9.
- [x] `npm test` 3514 / 3494 pass / **20 fail** (unchanged, all pre-existing); `tsc --noEmit` 0
      errors; `npm run build` exit 0; `eslint` clean on every new file
- [x] No horizontal overflow at 375, 1366×657 or 1536×826; the table hides and the cards show
      below 768px (computed `display`, checked in the browser)

**Notes from building it:**

1. **The table card has no title.** `TableCard`'s title is optional and the Pipeline passes none.
   A "Deals Worked" heading sat directly under a "DEALS WORKED" stat card — the third naming of the
   same thing on one screen. Dropped, which also dropped its `info`; the page header's (i) carries
   the explanation.
2. **The unpriced-sales caveat moved behind the Won card's (i).** As a third clause in the fact line
   it made the card unreadable; as an (i) it is there when it matters.
3. **Two things that look like bugs and are not:** the kit title-cases table heads, chips and card
   titles centrally (`titleCaseNode`), so "Monthly Premium" is house style, not this page; and
   `StatTile` renders its figure twice (`CountUp` plus a static copy), which is why a text dump
   shows "9 9".
4. **Screenshots of this page are unreliable while the browser pane is backgrounded** — the
   `m-stagger` entrance animation stalls and every shot catches it mid-fade. `read_page` and
   computed styles are the trustworthy checks there.

---

## Phase 3: Finish

### Task 8: READMEs and docs — **done, 1 Nov**

**Description:** The signposts the repo enforces.

**Acceptance criteria:**
- [ ] `app/partner/README.md` names the new route and the components it uses.
- [ ] `components/partner/README.md` names `partner-deal-flow.tsx`.
- [ ] `HANDOFF.md` records the new page.

**Verification:**
- [ ] Tests pass: `node --experimental-strip-types --test lib/design/designDocs.test.mjs`
- [ ] Every relative link in the touched docs resolves

**Dependencies:** Task 6

**Files likely touched:**
- `app/partner/README.md`
- `components/partner/README.md`
- `HANDOFF.md`

**Estimated scope:** Small

---

### Task 9: Both roles walked on the dev server — **partly done, 1 Nov; the signed-in half is blocked**

**Description:** Previews prove the drawing; the real app proves the read. Sample data cannot catch
a wrong column name or a timezone read from the wrong place.

**Acceptance criteria:**
- [ ] Signed in as a partner user: the day's rows are theirs only, the figures match the table.
- [ ] Signed in as a partner admin: the organisation's rows, the "Submitted by" filter works.
- [x] The range crosses midnight correctly for a partner not on UTC — proved in
      `localDay.test.mjs` at fixed instants (the same date is "the future" in Honolulu and "today"
      in Sydney). The date inputs are capped at the partner's today, not the server's.
- [x] The CSV matches the table — `csv.test.mjs` (11 tests) holds the file to the rows it is given:
      one line per row in order, money in units not cents, unpriced cells empty rather than zero,
      and a customer name beginning `=` neutralised.

**Verification done without a session:**
- [x] `GET /api/partner/deal-flow` unauthenticated → **401** `{"error":"Not authenticated"}`, and
      `&format=csv` → **401 as JSON**, so the format parameter leaks nothing
- [x] `POST` / `PATCH` / `PUT` / `DELETE` → **405**. Read-only confirmed by the server, not by
      reading the source.

**Still blocked, and this is the real gap:** no query has ever run against this app's database.
The column names, the `agent_leads!inner` embed and the `tenant_pipeline_stages` join are checked
against the migrations and the types, not executed. Signing in needs a partner session this machine
cannot mint, and the Supabase MCP connector is pointed at a different account — this app's project
(`iiimdgizjwnihpyrukbu`) is not among the ones it can reach. **Someone with a partner login should
open `/partner/deal-flow` once before this ships.**

**Dependencies:** Task 8

**Files likely touched:** none (verification only)

**Estimated scope:** Small

---

### Checkpoint C: ready for review — **1 Nov, with one gap**

- [x] All nine tasks' acceptance criteria met, except the signed-in walkthrough in Task 9
- [x] `npm test` **3525 / 3505 pass / 20 fail** — the same 20 pre-existing SQL-vs-CRLF failures,
      none new; `tsc --noEmit` 0 errors; `npm run build` exit 0; `uiOffenders.json` unchanged
- [ ] The two open questions in [plan.md](plan.md) answered or explicitly deferred
- [ ] Reviewed with the owner

**Found while testing, worth knowing:** writing `csv.test.mjs` caught a real bug in the page.
`money()` formatted the raw cents, so a $84.50 premium rendered as **$8,450.00** — a hundred times
too much, on the page a partner reads to check what they are owed. It now goes through the shared
`formatCentsAsCurrency`. The figure strip was wrong the same way ($14,650.00 a month instead of
$146.50). This is the argument for Task 9: the bug was invisible to every check that did not
compare a number against what it should be.

`partnerDealFlowCsv` also moved out of `service.ts` into its own `csv.ts`, because `service.ts` is
`server-only` and therefore cannot be imported by a test — the CSV is pure and is the half most
worth testing, since a partner reconciles a statement against it.


---

## Round 2: match the agent page exactly (1 Nov)

The owner looked at the finished page and asked for "exactly the same design as the agents site".
`components/app/deal-flow-workspace.tsx` became the reference and the page was rebuilt on it.

**What changed**

- The day stepper became the agent's **from/to date inputs + Today**; the payload and the service
  took a range (`from`/`to`) in place of a single `day`, and each row now carries its own `day` so
  the CSV can name it.
- The header became the agent's **two-part row** — title left, actions right — instead of
  `PageHeader actions`.
- The figures became the agent's: **icons** (Handshake, BadgeCheck, Hourglass, XCircle), the
  **Annualised / Oldest / Of deals worked** facts, and a **Show** action on each card that narrows
  the list to its own deals.
- The shared `Table` kit became the agent's **`st.table`** markup — 40px head, 44px rows, fixed
  column widths, `m-seq` / `m-row`. The `raw-table` ratchet counts 0 inside a file that uses
  `TableCard`, so this is allowed and the two pages now draw the same table.
- The stage `ToggleChip` row went into the **filter panel** as a Status menu, as on the agent.
- `PremiumBar` moved from the agent file into **`components/ui/premium-bar.tsx`** and both pages
  import it, rather than the partner page carrying a copy.
- The mobile card layout went: the agent scrolls its table inside the card, and so does this one
  (verified: no page overflow at 375).

**What stayed different, and why**

| Difference | Reason |
|---|---|
| No edit dialog, no "Add deal update", no detail panel | The owner's read-only decision, 1 Nov. The API has no write method. |
| No Campaign, Vendor, Owner or Notes columns | Agency-internal (`PARTNER_DEAL_FLOW_COLUMNS`). Replaced by Carrier, Product and Submitted by. |
| No "By partner" or "Dial funnel" tabs | A partner is one partner; Team review already owns performance over time. |
| ~~`SelectMenu` instead of native `<select>`~~ | **Resolved 1 Nov: made native.** The dropdowns are now the agent's native `<select>` in a shared `FilterField`. This is the only native `<select>` in the partner portal, and `components/partner/README.md` records it as the one exception to the 29 Oct rule. |
