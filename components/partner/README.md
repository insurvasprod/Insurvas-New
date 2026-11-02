# components/partner

Screens and parts of the partner portal (`/partner/*`), including its sign-in and invite frames.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md): the same rules as the agent
app (§2, §4/§4a, §6/§6a, §8, §10, §11, §12, §14). The auth screens here (`partner-auth-frame.tsx`,
`partner-login-form.tsx`, the invite and set-password forms) follow §13.
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

Use the shared parts in [`components/ui`](../ui/README.md). The partner portal is not a separate
design system: it differs only in its menu and story copy.

## The Pipeline board's columns (2026-10-30)

`partner-lead-pipeline.tsx` draws its board from the **four shared lanes** — New · Claimed · On a
call · Converted, plus Closed when it holds something (`PARTNER_BOARD_COLUMNS` in
[`lib/partnerLeads/view.ts`](../../lib/partnerLeads/view.ts)) — not the agency's configured stage
names.

This reverses LA-1.17. The counters above the board have always spoken the lane vocabulary
(`lib/partnerLeads/counters.ts`), so with stage columns the page contradicted itself on screen:
"Claimed 1" over a column headed "New lead". Both are generated from the lane figures now, so they
cannot disagree.

The agency's own stage name is **not** lost: it is on every card, is a column in the table view, and
is still a filter. It stopped being the thing that sorts the board, nothing more.
`lib/partnerLeads/board.test.mjs` holds both halves of that.

Check a change on `/design/pipeline` (development only): busy, quiet, SLA-flagged, many pipelines,
empty and error, for both roles and three payout models, at 1536×826, 1366×657 and 375 wide.

## Messages (2026-10-30)

A messenger, built from the kit — not a document with a form under it.

- **The thread** is [`chat-message.tsx`](chat-message.tsx), drawing what
  [`lib/partnerChat/thread.ts`](../../lib/partnerChat/thread.ts) returns: days, then runs of
  messages from one sender. That module is pure and tested; the component only draws it. Change
  *what groups with what* there, not here.
- **The composer** is the shared [`ChatComposer`](../ui/chat-composer.tsx): one bar, paperclip
  inside on the left, send on the right. Enter sends, Shift+Enter breaks the line.
- **Two panes, not three.** Conversation details is a `Sheet` (§11) opened from the thread's
  header. Below `md` it is one pane: the list, then the conversation, with a back control.
- **No avatars for channels** (§10). A Lucide glyph says agent channel, direct message or team
  channel.
- **No page CSS.** The 147 `.portal-agent-chat-*` rules are gone (§9). Keep it that way.

`viewerId` comes from `/api/partner/chat` — the caller's own id, from the session. Without it the
thread cannot tell your messages from the agency's, and draws everything on the received side
rather than guessing.

Check a change on `/design/messages` (development only): busy, quiet and empty, both roles, at
1536×826 and 375 wide. The development database has one channel and no reply, so two sides, a run,
a day separator and an attachment exist only there.

## Organization and Overview (2026-10-30)

Every figure in the portal is now a v3 `StatCard` (§4a) — Team review's six, Team access's three,
Statements' three — and there is no `StatStrip` left here. Every chart is the shared kit
([`components/ui/chart.tsx`](../ui/chart.tsx)).

- **One series, one helper.** Overview and Team review draw submissions over time from
  [`lib/partnerLeads/trend.ts`](../../lib/partnerLeads/trend.ts), and the share breakdown from
  [`lib/partnerLeads/overview.ts`](../../lib/partnerLeads/overview.ts), whose lane names come from
  `PARTNER_BOARD_COLUMNS`. Change the arithmetic there, not in a component.
- **No new reads.** The Overview's 30-day window is the pipeline endpoint Team review already
  asks for the same chart, on its own slower clock so it never blocks the stat cards.
- **Say what was not read.** A figure that did not arrive is "—", never 0; a panel whose read
  failed says so while the rest of the page stays live. Time to claim is not drawn at all —
  no partner-visible read carries it.
- **Team review takes `?from=&to=`**, so a chart elsewhere can link to the window it was drawn over.

Check a change on `/design/overview` (busy, quiet, empty, error; both roles; three payout models)
and `/design/organization` (Team review and Statements). Team access and Settings have no preview:
their figures are the shared cards and their data is a single list.

## Daily deal flow (2026-11-01, scope revised 2026-11-02)

`partner-deal-flow.tsx` — what the agency did with this partner's leads, over a range that defaults
to today.

**It is the agent app's `/app/deal-flow`, same design** (owner, 1 Nov: "exactly the same design").
`components/app/deal-flow-workspace.tsx` is the reference: the same header row, the same four
figures with the same icons and Show actions, the same toolbar of search / from / to / Today, the
same inline filter panel, the same 40px head and 44px rows (`st` from
[`settings/primitives`](../app/settings/primitives.tsx)), the same `PremiumBar`, the same pager.
**Change one and look at the other.**

Two differences, both the owner's own earlier decisions rather than design choices:

- **Read-only.** No edit dialog, no "Add deal update", no detail panel. The agency records what
  happened to a lead and the partner reads it; `/api/partner/deal-flow` has no write method.
- **None of the agency's own columns.** No campaign, vendor, owner or notes — who worked a lead and
  where the agency bought it is not the partner's business
  ([`PARTNER_DEAL_FLOW_COLUMNS`](../../lib/partnerDealFlow/types.ts)). Those four are replaced by
  carrier, product and, for an admin, which of their people submitted it.

The dropdowns are the agent's **native `<select>`** (owner, 1 Nov), which makes this the one page
in the portal with one — see Controls below.

- **This page is deliberately narrower than the rest of the portal.** A `partner_user` sees the
  deals on leads they submitted; a `partner_admin` sees **their own team's and their own** — the
  members whose `partner_admin_user_id` points at them (owner, 2 Nov). The rule is
  [`lib/partnerAuth/team.ts`](../../lib/partnerAuth/team.ts): the route works the id list out from
  the session and hands the service ids, so neither the component nor the service ever sees a role.

  Everywhere else an admin still sees the **whole partner organisation** —
  [`lib/partnerLeads/scope.ts`](../../lib/partnerLeads/scope.ts) is untouched, and Pipeline, the
  lead record, the CSV export, Overview and Team review are unchanged. So an admin can open a lead
  on Pipeline that is absent from here. **That is the decision, not a bug to fix.** Bringing
  Pipeline into line would take a migration — `partner_lead_pipeline_page` takes one `p_closer_id`,
  not a list — which is why the two are out of step rather than both moved at once. If the rule
  ever does spread, it spreads from `team.ts`; editing `scope.ts` silently rescopes five surfaces,
  which is what had to be reverted on 1 Nov.

  `lib/partnerAuth/team.test.mjs` holds the rule and `lib/partnerDealFlow/isolation.test.mjs` holds
  the wiring — including that `scope.ts` still opens the organisation to an admin, so a future edit
  cannot quietly take Pipeline with it.
- **A member nobody has assigned reaches no admin here.** With a null `partner_admin_user_id` they
  are on no team, so on this page their deals go to no admin at all. They stay visible to an admin
  on every other partner surface, which is why the agency is not warned about it.
- **The page says "your team", not "your organisation".** Two strings depend on the scope: the
  Deals worked card's footer and the empty state's hint. No test asserts copy against the scope, so
  if the boundary moves again, read them.
- **The arithmetic is pure and lives apart.** The local-date boundary is
  [`localDay.ts`](../../lib/partnerDealFlow/localDay.ts) — `deal_flow.local_date` is a local date,
  and a UTC read is off by one for part of every day — and the four figures are
  [`figures.ts`](../../lib/partnerDealFlow/figures.ts). Change the arithmetic there, not here.
  "In progress" ages from the lead's **submission** to the end of the range.
- **A row opens the lead record** at `/partner/pipeline/[leadId]` — one record surface in the
  portal, already scoped and already masked.

Check a change on `/design/deal-flow` (busy, quiet, empty, error; both roles) at 1536×826,
1366×657 and 375 wide.

The sample organisation has **two admins with their own reports and one unassigned member**, and
the day holds deals from all six. That is not decoration: on a flat list of submitters the scoping
rule is invisible, because a build that had lost it entirely would look exactly like one that kept
it. The caption above the table says who is viewing and how much is being withheld — "Rion Test
sees 9 of 12 — team: Dana Whitfield, Sam Okafor · not theirs: Noor Haddad, Theo Lindqvist, Orla
Byrne" — and it is computed from the same membership rows the rule reads, so it cannot drift from
the table beneath it.

Note that the entrance animation (`m-stagger`) stalls while the browser pane is backgrounded, so a
screenshot taken then catches it mid-fade and the page looks blank — read the accessibility tree or
computed styles instead, or disable animations before the shot.

## Controls (2026-10-30)

Every dropdown is `SelectMenu` — the searchable one the owner approved on 2026-10-29 — a two-way
choice is a `Segmented`, and picking several people is `MultiPicker`. UI-CONSISTENCY §5b carries
the rule. Native date inputs remain, for the reason §5b gives.

**One exception, owner 2026-11-01:** Daily deal flow's filter panel uses native `<select>`, because
that page is held to the agent app's design rather than to this portal's own. It is the only native
`<select>` in the portal; do not take it as licence for another.

Do not: introduce partner-only colours, controls or table styles, or a native `<select>` anywhere
but Daily deal flow.
