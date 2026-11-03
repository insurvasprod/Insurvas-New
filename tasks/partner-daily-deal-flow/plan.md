# Implementation Plan: Partner portal — Daily deal flow

**Branch:** `redesign/partner-pipeline` (current) or a fresh `redesign/partner-deal-flow` off `main`
**Task list:** [todo.md](todo.md) in this folder. The repo's top-level `tasks/plan.md` /
`tasks/todo.md` belong to the sidebar + Lead Sources round and still hold 120 unchecked items —
untouched by this plan.
**Status:** planned, not started.

---

## The owner's decisions (2026-11-01)

| Question | Answer |
|---|---|
| Who sees what? | **Nothing changes about today's access.** A partner admin sees the whole partner organisation, exactly as they do now on Pipeline, Overview and Team review. A partner user sees only the leads they submitted. Daily deal flow follows the same rule — "the same for daily deal flow". |
| Can partners write on this page? | **Read-only.** No edit dialog, no manual deals. |

**A correction, recorded so it is not repeated.** An earlier draft of this plan read the first
answer as "narrow every page to the admin's own team" and built it: a team rule from
`partner_users.partner_admin_user_id`, applied across Pipeline, the lead record, the export,
Overview and Team review, plus a migration to carry a list of ids into the pipeline read model.
That was the wrong reading. It has been reverted in full — the working tree is back at `main`'s
behaviour, the new files are deleted, and the test suite is back at its baseline. The team-scoping
question is closed; if it is ever reopened it starts from scratch.

Consequently the question about members with no admin assigned is moot: an admin sees the whole
organisation, so an unassigned member's leads reach them like anyone else's.

---

## Overview

The partner portal gets a fifth workspace page, **Daily deal flow** at `/partner/deal-flow`: one
day of what the agency actually did with the leads this partner sent — stage, carrier, monthly
premium, draft date — read-only, defaulting to today in the partner organisation's own timezone.

It introduces **no new access rule**. It reuses the one the portal already has, unchanged.

## What already exists (verified, 2026-11-01)

- **The roles**: `partner_admin`, `partner_user` ([lib/partnerAuth/roles.ts](../../lib/partnerAuth/roles.ts)).
- **The access rule**: [lib/partnerLeads/scope.ts](../../lib/partnerLeads/scope.ts) —
  `effectiveCloser` returns the viewer's own id for a `partner_user` and `null` ("everyone in this
  partner") for a `partner_admin`; `canSeeLead` guards a record. This page calls the same two
  functions, so it cannot drift from Pipeline.
- **The agency's own Daily deal flow**: `/app/deal-flow`, owner + producer, feature key
  `daily_deal_flow`, built on the `list_deal_flow_report` RPC. It can edit deals, add manual deals,
  show a dial funnel and export CSV.
- **The table**: `deal_flow`, one row per lead (`unique (lead_id)`), carrying `partner_id`,
  `local_date` (the **local** date, not UTC — see `lib/dealFlow/localDate.ts`), `status`, `carrier`,
  `monthly_premium_cents`, `face_amount_cents`, `draft_date`, and agency-internal columns.
- **The partner read pattern**: [lib/partnerLeads/service.ts](../../lib/partnerLeads/service.ts)
  already composes `lead_queue` + `agent_leads` + `deal_flow` + stages for the partner plane, with
  `maskSensitiveValues` over lead values. The new service is built the same way.

## Architecture decisions

**D1 — Reuse the access rule; do not restate it.** The service takes the same `PartnerLeadAccess`
Pipeline takes and calls `effectiveCloser` and `canSeeLead`. A second copy of "who may see what",
however faithful on the day it is written, is the thing that drifts.

**D2 — No migration, no RPC change.** The page gets its own service,
`lib/partnerDealFlow/service.ts`, reading `deal_flow` joined to `agent_leads` with an explicit,
partner-safe select list. `effectiveCloser` gives one id or null, which maps straight onto
`.eq("agent_leads.created_by", id)` or no filter at all — the same shape
`lib/partnerLeads/service.ts` already uses. Reusing the agency's `list_deal_flow_report` would mean
stripping agency-internal columns in TypeScript, and the next column added to that RPC would leak
by default. One day of one partner's deals is a small read; it needs no SQL-side paging or KPIs.

**D3 — Fields the partner API never sends.** `notes`, `worked_by` / `agent_name`, `buffer_agent`,
`campaign_id` / `campaign_name`, `vendor_name`, `source`, `disposition_by`, `tracking_id`,
`submission_id`, `manual_entry`. Who at the agency worked a lead is agency staffing, not the
partner's business. Enforced by the select list, not by omission in the component.

**D4 — ~~The page is a day, not a range.~~ Superseded 1 Nov: the page is the agent's page.**
The owner asked for "exactly the same design" as `/app/deal-flow`, which takes a from/to range
defaulting to today. The day stepper this plan originally specified is gone, replaced by the
agent's two date inputs and Today button. The worry behind the old D4 — that a range makes this a
second Pipeline — is answered by the columns rather than the range: this page shows what the
agency *did* with a lead (carrier, premium, draft date), Pipeline shows where it *is*.

**D5 — No detail panel.** A row's customer cell links to `/partner/pipeline/[leadId]`, the record
page that already exists and already applies scoping and masking. One record surface in the portal,
not two.

---

## The access rule, as it stands

```
partner_user   -> only deals on leads where agent_leads.created_by = their own id
partner_admin  -> every deal belonging to the partner organisation
```

Unchanged from Pipeline, and enforced the same way:

- `tenantId` and `partnerId` come from the signed session, never from the request.
- A `?partner_id=` that is not the caller's is refused with 403.
- A `partner_user` passing `?submitted_by=<a colleague>` is still pinned to themselves — that is
  `effectiveCloser`'s promise, already proved in `lib/partnerLeads/isolation.test.mjs`.
- An admin may use `?submitted_by=` to narrow to one person in their organisation.

---

## The page

**Route** `/partner/deal-flow` · **Sidebar** "Deal flow" (`ClipboardList`, the icon the agent menu
already uses for `sell.deal-flow`), between Pipeline and Messages in the workspace group · **Title**
"Daily deal flow", description behind the (i): *"What the agency did with the leads you sent."*

Built only from `components/ui`, per [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md):
one `PageHeader` (§2), one `StatRow` of `StatCard`s (§4a), one `TableCard` with `DataToolbar`,
`FilterPanel`, `ActiveFilters` and `Pager` in the footer (§6, §6a, §16), `StatusChip` (§12),
`tabular-nums` and right-aligned money (§14), `page-states` for every state (§7).

### The range, as the agent draws it

Two `<input type="date">` and a Today button in the toolbar, both capped at today, both defaulting
to it. In the partner organisation's timezone (`PartnerContext.partnerTimezone`, already resolved
on every request), matched against `deal_flow.local_date`.

### Figures — one row, four cards

| Card | Value | Footer fact |
|---|---|---|
| Deals worked | count for the day | admin: "across N people"; user: "all yours" |
| Won | count | `$X/mo · $Y annualised` |
| In progress | count, `tone="warn"` when the oldest is ≥ 2 days | "oldest N days" |
| Lost | count | the day's most common call result, when there is one |

No funnel, no chart. Team review already owns partner-side performance over time; this page owns
today.

### The table

| Customer | Product | Stage | Carrier | Monthly premium | Draft date | Submitted by* | Updated |
|---|---|---|---|---|---|---|---|

\* admin only — the same column Pipeline already shows an admin, over the same organisation.

Customer links to `/partner/pipeline/[leadId]`. Money right-aligned, `tabular-nums`, `$1,284.00`.
Under 768px the rows become cards, mirroring Pipeline's `LeadCard` rather than inventing a second
mobile pattern.

### Filters — closed by default, as the agent draws them

- **Status**, **Product** and, for an admin, **Submitted by**, inside the inline `FilterPanel`,
  with `ActiveFilters` chips under it — native `<select>` in a `FilterField`, as the agent draws
  them (owner, 1 Nov).
- The stage chips this plan originally specified are gone: the agent puts status in the panel, and
  the four stat cards carry a **Show** action that narrows to their own deals instead.

Search (`ToolbarSearch`) stays, because Pipeline has it and a partner doing fifty deals a day needs
it. Export CSV is the page's only action, in the header — it is how a partner reconciles a day
against a statement.

### What was deliberately left out

The agency's version of this page carries a dial-funnel tab, an edit dialog, manual deal creation,
a from/to range, agency staffing columns and a row detail panel. None of them survive here: the
funnel duplicates Team review, the writes contradict the read-only decision, the range duplicates
Pipeline, the staffing columns are not the partner's business (D3), and the detail panel duplicates
the lead record (D5). What is left is one day, four figures, one table.

### States

| State | What it says |
|---|---|
| Loading | `PageLoading`, then `SectionLoading` in the card on a day change |
| No deals on this day | "Nothing worked on Monday 2 November." + "Leads you send appear here once the agency works them." |
| Partner user who has never submitted | the same frame, with a link to Submit lead |
| Filters match nothing | `NoMatches` with a clear-filters action |
| Read failed | `ErrorState` with retry |
| Organisation not active | the layout's existing banner already covers it; nothing new here |

Checked on `/design/deal-flow` at **1536×826**, 1366×657 and 375 wide before any task is called done.

---

## Task List

See [todo.md](todo.md) for acceptance criteria, verification and file lists.

### Phase 1: The read
- [ ] Task 1: `lib/partnerDealFlow/` — types and service
- [ ] Task 2: `GET /api/partner/deal-flow` (+ CSV)
- [ ] Task 3: isolation tests for the new read

### Checkpoint A: the read is correct and cannot be widened

### Phase 2: The page
- [ ] Task 4: route, page and sidebar entry
- [ ] Task 5: `partner-deal-flow.tsx` — the workspace
- [ ] Task 6: every state drawn
- [ ] Task 7: fixtures and the `/design/deal-flow` preview

### Checkpoint B: the page works end to end

### Phase 3: Finish
- [ ] Task 8: READMEs and docs
- [ ] Task 9: both roles walked on the dev server

### Checkpoint C: ready for review

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A second copy of the access rule drifts from Pipeline's | High | D1: call `effectiveCloser` and `canSeeLead`, do not restate them. Task 3 asserts the service imports them rather than reimplementing. |
| An agency-internal column reaches the partner | High | D3: an explicit select list, with a test asserting it against a literal allow-list so a new column cannot be added by accident. |
| `local_date` is the **local** date; a UTC read is off by one for part of every day | Medium | Use the partner organisation's timezone, as `lib/dealFlow/localDate.ts` documents. Test at a fixed instant in a non-UTC zone. |
| The page becomes a second Pipeline | Medium | D4: one day, no range. If a range is ever wanted, it belongs on Pipeline. |
| A new page adds `uiConsistency` offenders | Low | `npm test` fails on a new offender; the baseline only goes down. Compose from `components/ui`, hand-roll nothing. |
| Line endings flip on edited files | Low | `git diff --stat` after each edit to an existing file. |
| 20 tests already fail on this checkout | Low, but noisy | All are SQL-text assertions against migration files checked out with CRLF endings. Unrelated to this work, and they hide a real failure when one appears. Worth fixing separately. |

## Open Questions

1. **Entitlement gating.** The page is planned behind the portal's existing `publisher_records`
   check only. If the agency's plan lacks `daily_deal_flow`, the agency cannot see its own version
   but the `deal_flow` rows still exist, so the partner would. Say if the partner page should be
   gated on `daily_deal_flow` as well.
2. **Statement reconciliation.** Partner admins also see Statements. If the day's won premium should
   tie back to a statement line, that link belongs in Task 5 — it is the one cross-page connection
   a partner would actually want.

---

# Round 3: team scoping, on Daily deal flow only (2 Nov)

**Status:** planned, not started. **Awaiting approval.**

## What was asked

> "the publisher admin account can see the leads for their team, while the user can only see their
> leads, so nobody else's."

A `partner_admin` sees their own team's deals; a `partner_user` sees only their own. On **Daily
deal flow**.

## This was built once and reverted — read this before starting

On 1 Nov I built exactly this rule and applied it across the whole portal, then reverted it in
full when the owner said to leave organisation-wide access as it was. Nothing of it survives in
the tree. What survives is the knowledge, and it changes the shape of the work:

**The expensive part was never Daily deal flow.** It was Pipeline. `partner_lead_pipeline_page` is
an RPC that takes `p_closer_id uuid` — one id, where `null` means "everyone in this partner" — so
narrowing it to a list needed a migration across several SQL functions, modelled on
`20261019400000_ag_scoped_deal_flow_in_sql.sql`. **Daily deal flow uses no RPC at all.** Its
service filters in TypeScript:

```ts
if (closerId) query = query.eq("agent_leads.created_by", closerId);
```

Turning that into `.in("agent_leads.created_by", ids)` is a one-line change. **Round 3 needs no
migration and no SQL.**

**Teams already exist in the data.** `partner_users.partner_admin_user_id`, from migration
`20260915190000`, with a trigger that forbids self-assignment and requires the target to be a
`partner_admin` in the same organisation. The agency's Partners panel already shows "Reports to …"
and groups members into Partner admins / Partner users / Unassigned. The reporting line is a live,
managed concept that has never governed what anyone can see.

## Architecture decisions

**D1 — The rule is one pure function, in one file.** `lib/partnerAuth/team.ts`:
`visibleSubmitters(viewer, members)` returns the `created_by` ids this viewer may see. No database,
no server imports, so it is unit-testable — the same reason `partnerLeads/scope.ts` exists.

**D2 — Daily deal flow only. `lib/partnerLeads/scope.ts` is not touched.** This is the decision
that went wrong last time: I changed the shared `scope.ts`, which silently changed Pipeline, the
lead record, the export, Overview and Team review too. Round 3's rule is additive and confined —
the deal-flow service takes its own access object carrying the id list, and `effectiveCloser` keeps
its current meaning for every other page.

**The consequence, stated once:** a partner admin will see a lead on Pipeline that is absent from
Daily deal flow. That is what "Daily deal flow only" means. It is the owner's call and the plan
proceeds on it; if the portal should be consistent later, Pipeline is a separate job with a
migration attached.

**D3 — Deactivated members stay visible to their admin.** The membership read must **not** filter
`status = 'active'`. Deactivating someone must not hide the deals they already submitted: the leads
exist, the agency worked them, the partner is paid for them. Whether somebody may sign in is a
different question, already answered for the viewer's own row in `readPartnerContext`.

**D4 — The list always holds the viewer, so it is never empty.** A caller turns it into
`.in("agent_leads.created_by", ids)`, and `[]` there matches nothing — or worse, invites a future
caller to treat "empty" as "no filter" and open the whole organisation. Asserted in the tests.

**D5 — Admins are peers.** The trigger keeps `partner_admin_user_id` null on admin rows, so there
is no chain to walk: an admin sees their team and themselves, never another admin's submissions or
another admin's team.

**D6 — The "Submitted by" filter offers only the team.** Otherwise the control names people whose
rows the page would then refuse to show.

## The rule

```
partner_user   -> [their own id]
partner_admin  -> [their own id] + [members whose partner_admin_user_id is this admin]
```

## Dependency graph

```
team.ts + tests          (T1)   pure, no dependencies
      │
      └── membership loader     (T2)   cached per request
                │
                ├── deal-flow service takes the list   (T3)
                │        └── route builds it from the session   (T4)
                │                 └── isolation tests            (T5)
                ├── the Submitted-by facet narrows     (T3)
                └── fixtures + preview show a team     (T6) → docs (T7)
```

Build order: **T1 → T2 → T3 → T4 → T5 → T6 → T7.** T6 can start any time after T1.

## Task list

See [todo.md](todo.md), Round 3 section.

### Phase 1: The rule
- [ ] Task R1: `lib/partnerAuth/team.ts` — the pure predicate, with tests
- [ ] Task R2: the per-request membership loader

### Checkpoint R-A: the rule stands alone, nothing consumes it yet

### Phase 2: Daily deal flow reads it
- [ ] Task R3: the service and its facets take the id list
- [ ] Task R4: the route builds the access from the session
- [ ] Task R5: isolation tests

### Checkpoint R-B: an admin sees their team and nobody else's

### Phase 3: Reviewable and written down
- [ ] Task R6: fixtures and the preview show two teams
- [ ] Task R7: docs

### Checkpoint R-C: ready for review

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Touching `lib/partnerLeads/scope.ts` silently rescopes Pipeline, the lead record, the export, Overview and Team review | **High — this is how it went wrong on 1 Nov** | D2: the deal-flow service carries its own access type. A test asserts `scope.ts` is unchanged and that `effectiveCloser` still returns null for an admin. |
| An empty id list read as "no filter" opens the organisation | **Critical** | D4: the viewer is always in their own list, so `[]` is unreachable. Asserted. |
| Deactivating a member hides their past deals from their admin | High | D3: the membership read does not filter on status. |
| The portal contradicts itself — org-wide on Pipeline, team-only here | Medium, and intended | The owner's decision. Recorded in the component's docblock and the README so the next person does not "fix" it. |
| A partner user's `?submitted_by=` widens their view | **Critical** | The list is built from the session; a requested id can only narrow within it, never add to it. Asserted. |
| Line endings flip on edited files | Low | `git diff --stat` after each edit. One file in this area, `app/partner/(portal)/payouts/page.tsx`, is CRLF in HEAD — leave it CRLF. |

## Open questions

1. **Members with no admin assigned.** The agency's Partners panel has an "Unassigned users"
   bucket, so this is a live state. On 1 Nov the owner chose **"nobody but themselves"** — their
   deals reach no admin at all. That still stands unless you say otherwise, but it is worth
   re-confirming, because it is a silent hole: a lead submitted by an unassigned member would be
   invisible to every admin on this page.
2. **Should the agency be told?** If 1 stands, the agency's Partners panel could raise its
   "Unassigned users" count from a filter option to a visible warning, so somebody can close the
   hole. One extra task; say if you want it.
3. **Pipeline later?** Not in this round. Say if you want it queued as its own job — it carries the
   migration this one does not.

## Open questions — answered 2 Nov ("your recommendations")

| # | Decision |
|---|---|
| 1 | **Unassigned members: nobody but themselves.** Carried forward from 1 Nov. A member with no `partner_admin_user_id` appears in no admin's team on this page. |
| 2 | **No warning in the agency's Partners panel. My recommendation changed — here is why.** When this rule was planned portal-wide, an unassigned member's leads would have been invisible to every admin everywhere, which is a genuine hole worth flagging to the agency. Scoped to Daily deal flow alone, the leads are **not** invisible: an admin still sees them on Pipeline, the lead record, the export and Overview. The gap is one page, not the portal, and changing an agent-app screen to warn about it would be out of proportion to a gap that size. Revisit only if Pipeline ever follows. |
| 3 | **Pipeline stays organisation-wide.** Not queued as a task, recorded as a known follow-up in Task R7's note so the inconsistency reads as a decision rather than an oversight. It carries a migration across several SQL functions; Round 3 does not. |
