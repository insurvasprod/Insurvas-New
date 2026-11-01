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
