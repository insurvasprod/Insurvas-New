# Implementation Plan: Partner portal round 3 — Messages, Overview, Organization

**Raised by the owner, 30 Oct.** Three surfaces, in this order: **Messages** ("make it feel like
texting on WhatsApp, but with a good design" — the attach button sitting next to Send while the
writing box is above it "looks so bad"), **Overview** ("an analytical page… relevant information,
nice charts, nice analytical cards"), then **Organization** ("redesign those as well, in the same
style").

Tasks: [`todo.md`](todo.md). Branch `redesign/partner-pipeline` (rounds 1–2 shipped there).
Round 2's task 21 is still open in [`../partner-pipeline/todo.md`](../partner-pipeline/todo.md) —
untouched by this plan.

---

## A · Messages

### What is wrong

Inspected live at 1536×826 with one channel open.

**The composer, which is what the owner named.** It is three stacked rows: a full-width textarea,
then a row with "Attach files" on the left and "Send message" on the right, then a third line with
"0 / 2,000". Nothing about it reads as a message bar. A chat composer is **one bar**: the attach
control inside it on the left, the text growing in the middle, send on the right.

**The thread is not a conversation.** Every message is a full-width block. There is no side — your
own messages and the agency's sit in the same column with the same ground, so you cannot tell at a
glance who said what. There are no date separators and no grouping of consecutive messages from one
sender. System cards ("Automatic update") are full-width bordered panels that dominate the thread.

**127 hand-rolled CSS rules.** `.portal-agent-chat-*` and `.portal-chat-*` in `app/globals.css`,
against §9 ("New screens use Tailwind and the shared components; do not add page-specific
`.portal-*` rules"). It is the largest hand-rolled block left in the portal, and it is why this
page looks unlike the rest.

**Three panels at once.** Conversations, thread and Details all on screen. On a phone that cannot
work, and even at 1536 Details is mostly empty — all-caps labels (CHANNEL, AGENT, SUPPORT, PHONE,
RELATED LEADS) with "Not set by your agency" under most of them, and an "Open pipeline" link
floating out of alignment.

**Avatars for channels.** The list draws initials circles for channels. §10 reserves avatars for
staff users with a photo.

### The design

**A messenger, built from the kit.**

- **One composer bar.** A rounded field with the paperclip inside it on the left, the textarea
  growing with the content (one line to a cap of about six), and a circular send button on the
  right. The counter appears only as the cap approaches — not a permanent "0 / 2,000". Attachments
  chosen show as removable chips *inside* the bar, above the text. Enter sends, Shift+Enter breaks.
- **Bubbles with a side.** Yours right, aligned to the brand surface; theirs left on the card
  surface. Consecutive messages from one sender group under a single name and time. Date separators
  ("Today", "Yesterday", "28 Oct") between days.
- **System cards stay, quieter.** An automatic update is a fact the partner relies on, so it keeps
  its own treatment — but centred, narrower and calmer, so the thread reads as a conversation with
  notices in it rather than a wall of panels.
- **Two panes, not three.** Conversations beside the thread. Details becomes a `Sheet` opened from
  the header's "Details" button — it is reference, not something you read while typing. On a phone
  it is one pane: the list, and the thread as the next screen.
- **No avatars for channels** (§10). The channel's name is the identifier; a Lucide icon can say
  whether it is a direct message or a team channel.

---

## B · Overview

### What is wrong

The four v3 stat cards at the top are right (round 2 moved them). Below them the page is thin:

- **"Lead pipeline · share of submissions"** — a panel roughly 300px tall drawing *one* bar at
  100%. It is a stage breakdown with nothing to break down.
- **"Team response · 30 days"** — three rows reading "—", "0", "0".
- **"Quick actions"** — three link tiles (Messages, Team, Statements).

Nothing on the page shows a **trend**, a **rate**, or **money over time**, which is what an
analytical page is for. A partner opens it to answer: *am I sending more or less than last week; do
my leads convert; how fast does the agency pick them up; what am I earning.*

### What data actually exists — the good news

Team review already derives **a daily submission series client-side** from
`/api/partner/leads/pipeline?limit=5000&date_from&date_to` and buckets it in the browser
(`partner-team-review-workspace.tsx`, the `trend` memo). It also computes a **conversion rate** and
reads **average reply time** from `/api/partner/team-review/pulse`.

So the Overview's charts need **no new server read**. The work is to lift that bucketing out of
Team review into a tested pure helper and draw it properly in both places.

Money history is real too: `/api/partner/payouts` returns published statements with `netCents` and
periods, and round 1 put the partner's rate on the page (`terms`).

### The design

A partner's Overview, top to bottom:

1. **Header** — greeting, `LiveStamp`, **Submit a lead** (as now).
2. **Needs you** — the unclaimed-lead row and workspace alerts, only when there is something.
3. **Four stat cards** — as now (they are right).
4. **Submissions over time** — the hero. A daily bar series over 30 days with the 7-day total and
   its change against the previous 7, and the best day. Links into Team review for the date range.
5. **Where they end up** — a share breakdown by lane (New / With a closer / On a call / Converted /
   Closed) as a horizontal stacked bar with a legend, replacing the one-bar stage panel. Plus the
   conversion rate as a figure with its comparison.
6. **Speed** — how long the agency takes: average time to claim, and average reply in chat. This is
   the partner's experience of the agency, and nothing surfaces it today.
7. **Earnings** — statements over the last periods as a small bar series with the latest figure and
   the rate, linking to Statements.
8. **Jump to** — the one-line shortcut list (§4b's pattern), replacing the three tiles.

### On the three libraries

The owner asked for [MagicUI](https://magicui.design/docs/components),
[21st.dev](https://21st.dev/) and [shadcn/ui](https://ui.shadcn.com/charts).

**What I am taking:** shadcn's **chart vocabulary** — the set of shapes worth having (area/line for
a trend, stacked bar for a share, radial for a rate) and the idea of theming them from CSS
variables. From MagicUI, the **number ticker** (the kit already has `CountUp`), the **bento grid**
as a layout idea for the panel row, and the **animated list** idea for recent activity.

**What I am not doing, and why:** importing MagicUI components. They ship their own hex colours,
gradients and local surfaces, which would trip the `hex-colour` and `local-surface` ratchets in
`lib/design/uiConsistency.test.mjs`, contradict §5b ("one kit, one look"), and — the practical
point — look like a different product bolted onto this one. The repo has **no chart library at all**
today: the agent dashboard's 14-day chart is 85 lines of CSS bars inside `HomePanel`
(`components/app/home/home-activity.tsx`). That is the house precedent, and the partner Overview
already uses `HomePanel`.

**The one reversible call:** the share and rate shapes are painful to hand-roll well. Task B1 builds
a small shared chart kit in `components/ui/chart.tsx` in the house style, **no new dependency**. If
the owner would rather have Recharts (the shadcn standard, themes from CSS variables), it swaps in
behind that one file — that is why the kit is one file with a narrow surface.

---

## C · Organization

Statements, Team review and Team access, plus Settings.

**The consistency gap:** Pipeline and Overview moved to the v3 glossy stat cards; **Team review and
Team access are still on the old §4 `StatStrip`/`StatTile`** — the uppercase-label strip. Team
review shows six of them (LEADS SUBMITTED, IN PROGRESS, APPLICATIONS, CONVERSION RATE, AVG RESPONSE
TIME, ACTIVE MEMBERS). Round 2 removed that pattern from two pages; these are the ones left.

**Team review also hand-rolls its surfaces and its chart:** `<section className="rounded-lg border
border-border bg-card p-4">` instead of `Card`, and its own bar markup. Both become the shared
chart kit from B1, so Overview and Team review draw the same chart from the same helper.

**Statements** and **Settings** get a consistency pass rather than a redesign: v3 cards where they
show figures, the house date format, and the §6a toolbar where they list.

---

## Architecture decisions

| Decision | Rationale |
|---|---|
| Messages rebuilt from `components/ui`, not patched | 127 CSS rules is why the page looks foreign. Patching the composer alone leaves the thread looking like a document. |
| Details becomes a `Sheet`, the layout two panes | §11: a record beside a list is a `DetailPanel`, over the page a `Sheet`. Details is reference, and three panes cannot survive a phone. |
| Chart kit in the house style, one file, no new dependency | The repo has none, the agent home sets the precedent, and the ratchets would reject imported components. Swappable for Recharts behind one file. |
| Trend bucketing extracted and unit-tested | It exists once in Team review as a `useMemo`; Overview needs the same numbers. Two copies would drift. |
| Overview charts from the existing pipeline API | Team review already proves it: 5,000 rows for a date range, bucketed client-side. No migration, no new endpoint. |
| Organization gets consistency, not reinvention | The pages work; they are on last year's stat pattern. The win is them matching, not new ideas. |

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Rebuilding Messages breaks sending, attachments or the system cards | **High** | Keep every API call and payload as-is; change only presentation. Send, attach, create-conversation exercised before the commit. |
| The agent app shares the chat CSS | **High** | `components/app/lead-workspace.tsx` and the agent chat may use `.portal-agent-chat-*`. Check before deleting any rule; delete only what nothing else uses (round 2's approach). |
| A 5,000-row fetch for the Overview chart is slow for a big partner | Med | It is what Team review already does. Bound the window, show the chart when it lands, never block the cards on it. |
| Charts drawn from thin dev data look fine but break with real volume | Med | Extend `/design/pipeline`'s fixture approach to an Overview preview with busy / quiet / empty. |
| The owner wanted the component libraries used literally | Med | Stated above, with what is taken from each and the one-file escape hatch to Recharts. |
| Phone work on three more surfaces | Med | Round 2's sizes and method apply: 320–430, measured, no horizontal scroll. |

---

## Open questions

1. **Recharts or the house chart kit?** Plan builds the house kit; one file to swap.
2. **Should Overview absorb Team review?** They overlap (trend, conversion, response time). The plan
   keeps them separate — Overview answers "how am I doing" at a glance, Team review is the date
   range and the export — with Overview linking in. Worth confirming.
3. **The (i) buttons at 16–20px** (round 2, task 21) are still under WCAG 2.2's 24×24, in a shared
   component. Unchanged here.
