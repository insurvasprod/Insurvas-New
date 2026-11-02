# Session Handoff

**Date:** 2026-10-30
**Branch:** `redesign/partner-pipeline` — pushed, **PR [#34](https://github.com/insurvasprod/Insurvas-New/pull/34)** open against `main` (ready for review, Auto-fix on)

## Summary

The whole **partner portal** redesigned over three rounds with the owner, 29–30 Oct: Pipeline,
Messages, Overview, and the Organization pages (Team review, Team access, Statements, Settings).
16 commits, 54 files, +6,623 / −678 against `main`. `origin/main` is merged in, so the branch is
0 behind.

Read `CLAUDE.md` → `AGENTS.md` first. `docs/design/UI-CONSISTENCY.md` is the design authority and
`lib/design/*.test.mjs` enforces it — **including `sidebarLook.test.mjs`, which fails any build that
undoes the owner's 30 Oct look (§16).** Round plans and per-task acceptance criteria are in
`tasks/partner-pipeline/todo.md` and `tasks/partner-portal-round-3/{plan,todo}.md`.

## What Was Accomplished

**Pipeline (rounds 1–2, `d45c59f0`…`952b83f1`)**
- The board's columns spoke agency stage names while the counters above spoke shared lanes — the page
  contradicted itself ("Claimed 1" over a column headed "New lead"). Both come from the lane figures
  now; `lib/partnerLeads/board.test.mjs` holds the rule. The agency stage stays on the card, in the
  table and as a filter.
- Partner isolation named in `lib/partnerLeads/scope.ts` and proved by a mutation-checked test.
- `payoutLabel` moved out from behind `import "server-only"` so the partner can see their own rate.
- SLA tones read the tenant's real ladder (partner 300s, expire 4h), not an invented one.
- A lead opens as a page; the record is two columns; the board paginates per lane; **no native
  `<select>` left in the portal**; phone layouts at 320–430.

**Messages (round 3, `1dbadd75`…`5697ab5a`)**
- One composer bar (paperclip left, send right; Enter sends, Shift+Enter breaks).
- The thread reads as a conversation — sides, sender grouping, day separators, quieter system cards.
- Two panes, Details as a `Sheet`; on a phone: list → thread → back.
- Typing anywhere starts a message; the page reaches the bottom margin.
- **163 hand-rolled CSS rules retired** (127 `.portal-agent-chat-*`, 16 `.portal-partner-messages-page`).

**Overview (round 3, `67daca71`)** — a real analytical page from reads that already existed: a 30-day
submission series, a lane share bar, the agency's speed, earnings. **No new endpoint, no migration.**

**Organization (round 3, `4c3e7da7`)** — Team review, Team access and Statements on the shared
figures; **no `StatStrip` left in `components/partner/**`**. Statements' dates read as months.

**Sweep + merge (`828a00fd`, `d4d2de6a`, `bddfcfc9`)** — 320/430/1366/1536 across five surfaces,
then `origin/main` merged in.

## Key Decisions

- **No chart dependency.** `components/ui/chart.tsx` is one file with a narrow surface, in the house
  style, so a real library can replace it later without touching a page. MagicUI was rejected: its
  hex colours and local surfaces trip the `hex-colour` / `local-surface` ratchets and look alien.
- **One series, one helper.** `lib/partnerLeads/trend.ts` is pure and tested; Overview and Team
  review both draw from it so they cannot disagree about a week a partner sees on both.
- **§16 does not undo round 3.** `main` rewrote `StatCard`/`StatRow` to render `StatStrip`/`StatTile`
  under the same props, so the migration stands and the figures wear the owner's strip.
- **Previews, not fixtures-in-prod.** Each redesigned surface takes an optional `sample` prop used
  only by `/design/*`; with it set the component reads and writes nothing.

## Current State

Everything committed and pushed. PR #34 open, mergeable, Auto-fix on.

**Modified files:** none, except `.claude/launch.json` — **deliberately uncommitted**: it holds a
hardcoded path to `.claude/worktrees/foundation-v3` on this machine.

**Staged changes:** None

**Stash entries:** `stash@{0}` — WIP on `redesign/my-profile`, unrelated to this branch.

## Known Issues

- **Never exercised: sending a message, and creating a conversation.** Both write to the owner's live
  agent channel. Each request is byte-identical to the one before the rework (checked by diff).
  Worth one real send before merge.
- **Team access and Settings have no preview page.** Their change was three stat tiles becoming the
  shared cards plus an (i) per section.
- **20 tests fail** in 15 files (`lib/ingestion`, `lib/scoring`, `lib/transferInbox`, …) — all SQL /
  migration assertions, **failing identically on `main`**. Not caused by this branch.
- The browser pane loses its partner session when the dev server restarts; signed-in pages can only
  be checked on `/design/*` from here. The owner's own Chrome keeps the session.
- The brand green is 1.70:1 on white, so chart fills sit under 3:1 there. Every chart in the product
  always has; the legend carries name, count and share in text at 5.71:1. A brand decision, not a
  chart one.

## Next Steps

Suggested — the owner has not directed these:

1. **Send one real message and create one conversation** on `/partner/messages` while signed in.
   The only untested paths.
2. Watch PR #34 — Auto-fix is on, so CI failures and review comments come back to this session.
3. If the owner wants charts from a library, swap Recharts in behind `components/ui/chart.tsx`
   alone; nothing else imports a chart primitive.
4. Round 2's `tasks/partner-pipeline/todo.md` task 21 is closed; nothing is left open there.

## Daily deal flow (1 Nov, in progress)

A fifth workspace page, `/partner/deal-flow`: one day of what the agency did with this partner's
leads — stage, carrier, monthly premium, draft date — read-only, defaulting to today in the partner
organisation's timezone. Plan and tasks in `tasks/partner-daily-deal-flow/{plan,todo}.md`.

**Access is unchanged.** A partner admin sees the whole organisation and a partner user sees their
own submissions, exactly as on Pipeline: the service calls `effectiveCloser` / `canSeeLead` from
`lib/partnerLeads/scope.ts` rather than restating the rule, and
`lib/partnerDealFlow/isolation.test.mjs` fails the build if it starts deciding for itself.

> An earlier draft of the plan read the owner's answer as "narrow every page to the admin's own
> team" and built it — a team rule from `partner_users.partner_admin_user_id` across Pipeline, the
> lead record, the export, Overview and Team review, with a migration to carry a list of ids into
> the pipeline read model. That was the wrong reading and was **reverted in full** on the same day.
> Nothing of it remains; the team-scoping question is closed.

Built so far: the read (`lib/partnerDealFlow/`, with pure `localDay.ts` and `figures.ts`), the API
route, the page, the sidebar entry and the `/design/deal-flow` preview. **Not yet verified:** the
day stepper's fetch and the CSV download, both of which need a signed-in session.

## Agency dashboard redesign (2 Nov, in progress)

`/app/agency` rebuilt as an analytics front door. Spec, plan and tasks in
`tasks/agency-dashboard-redesign/`. Phases 1–4 done, Phase 5 (docs and the signed-in walkthrough)
in progress.

The research that shaped it: this page is the agency module's **front door**, not its analytics —
`book-scorecards` already owns persistency, chargeback ratios and true cost per sale, and
`/app/producer-scorecards` owns per-producer profitability. So the page answers one question and
every figure is a door. Separately, it was **discarding six figures the system already computes
for it** (`leadSpendCents`, `costPerIssued`, `costPerPersisting`, `chargebackTax`, `m13`,
`chargebackCents`) — the route returns `readDashboard` unchanged and the client had never typed
them, so the new "At risk" card and money split needed no API change at all.

What changed: the `<h1>` names the page rather than the agency; four cards (Written, Your
override, At risk, Needs you) with month-over-month change, Seats removed from the strip; a
ranked producer standing as a `BarSeries` beside a `ShareBar` of where the money went; the
producers table ranked with month-13 alongside month-4; and a new agency that reads as new rather
than broken.

Two shared components gained something rather than being copied: **`BarSeries` has a categorical
label mode** (`labels="all"` — its axis only ever drew first, middle and last, which is wrong when
every bar is a person), and the arithmetic lives in **`lib/agency/dashboardCore.ts`**, pure and
tested, beside the `*Core` / `*Store` pairs the module already uses.

**Not verified:** the page has never been opened signed in. It needs an agency-typed plan and a
session; `scripts/seed-qa-agency.mjs` seeds exactly that on the LA-1.25 Alert Demo tenant, and
`npm run session -- tenant --email demo.agent@insurvas.test --js` mints the cookie.

## Relevant Files

| File | Why |
|---|---|
| `tasks/agency-dashboard-redesign/SPEC.md` | The agency dashboard's audit, the information-architecture research, and the decisions |
| `lib/agency/dashboardCore.ts` | `periodChange`, `standing`, `moneySplit` — the dashboard's arithmetic, pure and tested |
| `app/design/agency/page.tsx` | Dev-only preview; the live agency is empty, so this is the only place the page can be seen with data |
| `tasks/partner-daily-deal-flow/plan.md` | Daily deal flow: the decisions, what was cut from the agency's version, and why |
| `lib/partnerDealFlow/types.ts` | `PARTNER_DEAL_FLOW_COLUMNS` — the literal allow-list that keeps the agency's notes, closers and vendors off the partner's page |
| `lib/partnerDealFlow/localDay.ts` | The local-date boundary; `deal_flow.local_date` is local, and a UTC read is off by one for part of every day |
| `lib/partnerDealFlow/figures.ts` | The four cards' arithmetic — change it here, not in the component |
| `tasks/partner-portal-round-3/plan.md` | Round 3's reasoning, risks and the three-library decision |
| `tasks/partner-pipeline/todo.md` | Rounds 1–2, with the measured before/after tables |
| `components/partner/README.md` | What each partner screen is built from, and where to change behaviour |
| `docs/design/UI-CONSISTENCY.md` | The authority; §4a figures, §5b kit, §9 CSS, §11 overlays, §16 the owner's look |
| `lib/partnerLeads/trend.ts` | The submission series both Overview and Team review draw |
| `lib/partnerLeads/overview.ts` | Lane shares, named with the Pipeline's own words |
| `lib/partnerChat/thread.ts` | How the thread groups into days and runs — change grouping here |
| `components/ui/chart.tsx` | The chart kit; the one file to replace with a library |
| `components/ui/chat-composer.tsx` | The message bar, incl. type-anywhere capture |
| `components/partner/chat-message.tsx` | The thread's drawing only; shape comes from `thread.ts` |
| `components/partner/partner-portal-overview.tsx` | The Overview page |
| `components/partner/partner-lead-pipeline.tsx` | The Pipeline board and table |
| `lib/partnerLeads/fixtures.ts`, `lib/partnerChat/fixtures.ts` | Sample data behind every `/design/*` preview |
| `app/design/{messages,overview,organization,pipeline,deal-flow}/page.tsx` | Dev-only previews — the only place these pages can be seen with data |

---

_Supersedes the 29 Oct handoff for `redesign/sidebar-and-lead-sources` (that work is merged to
`main`; the old file is in git history)._
